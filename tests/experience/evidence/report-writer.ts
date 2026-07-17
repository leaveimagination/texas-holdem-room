import { randomUUID } from "node:crypto";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { isAbsolute, join } from "node:path";

import { EXPERIENCE_CASES } from "../case-catalog";
import {
  ArtifactRecordSchema,
  CaseReportSchema,
  EXPERIENCE_THRESHOLDS,
  EvidenceEventSchema,
  PlaneResultSchema,
  RunReportSchema,
  RunResourceRecordSchema,
  type ArtifactRecord,
  type CaseReport,
  type EvidenceEvent,
  type PlaneResult,
  type PlaneResultInput,
  type RunReport,
  type RunResourceRecord
} from "./contracts";
import { redactForEvidence, type KnownSecret } from "./redaction";
import { deriveCaseVerdict, deriveRunVerdict } from "./verdict";

type PlaneName = keyof CaseReport["results"];

export interface WriteExperienceReportInput {
  outputRoot: string;
  runId: string;
  startedAt: string;
  finishedAt: string;
  cases: readonly CaseReport[];
  events: readonly EvidenceEvent[];
  resources?: readonly RunResourceRecord[];
  artifacts?: readonly ArtifactRecord[];
  runResults: {
    product: PlaneResultInput;
    harness: PlaneResultInput;
    environment: PlaneResultInput;
  };
  knownSecrets?: readonly KnownSecret[];
}

const PLANE_NAMES = ["product", "harness", "environment"] as const;

async function atomicWrite(path: string, contents: string): Promise<void> {
  const temporaryPath = `${path}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporaryPath, contents, "utf8");
  try {
    await rename(temporaryPath, path);
  } catch (error) {
    await rm(temporaryPath, { force: true });
    throw error;
  }
}

function json(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function sortedEvents(events: readonly EvidenceEvent[]): EvidenceEvent[] {
  return [...events].sort(
    (left, right) =>
      left.caseId.localeCompare(right.caseId) ||
      left.attemptId.localeCompare(right.attemptId) ||
      left.seq - right.seq ||
      left.id.localeCompare(right.id)
  );
}

function aggregatePlane(
  plane: PlaneName,
  base: PlaneResult,
  cases: readonly CaseReport[]
): PlaneResult {
  const sources = [
    { label: "run", result: base },
    ...cases.map((caseReport) => ({
      label: `${caseReport.caseId}/${caseReport.attemptId}`,
      result: caseReport.results[plane]
    }))
  ];
  const status = sources.some(({ result }) => result.status === "fail")
    ? "fail"
    : sources.some(({ result }) => result.status === "inconclusive")
      ? "inconclusive"
      : "pass";
  const summaries = sources
    .filter(({ result }) => status === "pass" || result.status !== "pass")
    .map(({ label, result }) => `${label}: ${result.summary}`);
  const evidenceEventIds = [
    ...new Set(sources.flatMap(({ result }) => result.evidenceEventIds))
  ];

  return PlaneResultSchema.parse({
    status,
    summary: summaries.join(" "),
    evidenceEventIds
  });
}

function assertRelativeArtifactPaths(report: RunReport): void {
  const artifacts = [
    ...report.artifacts,
    ...report.cases.flatMap((caseReport) => caseReport.artifacts)
  ];

  for (const artifact of artifacts) {
    const segments = artifact.path.split(/[\\/]+/);
    if (
      isAbsolute(artifact.path) ||
      /^[a-z][a-z\d+.-]*:/i.test(artifact.path) ||
      segments.includes("..")
    ) {
      throw new Error(
        `Artifact path must be relative to the run directory: ${artifact.path}`
      );
    }
  }
}

function escapeHtml(value: unknown): string {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function artifactHref(path: string): string {
  return path
    .replaceAll("\\", "/")
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

function divergentEvidenceIds(caseReport: CaseReport): Set<string> {
  return new Set([
    ...PLANE_NAMES.flatMap((plane) =>
      caseReport.results[plane].status === "pass"
        ? []
        : caseReport.results[plane].evidenceEventIds
    ),
    ...caseReport.assertions.flatMap((assertion) =>
      assertion.outcome === "pass" ? [] : assertion.evidenceEventIds
    ),
    ...caseReport.failures.flatMap(({ evidenceEventIds }) => evidenceEventIds)
  ]);
}

function earliestDivergentEvent(
  caseReport: CaseReport,
  events: readonly EvidenceEvent[]
): EvidenceEvent | undefined {
  const evidenceIds = divergentEvidenceIds(caseReport);
  const caseEvents = events.filter(
    ({ caseId, attemptId }) =>
      caseId === caseReport.caseId && attemptId === caseReport.attemptId
  );
  return (
    caseEvents.find(({ id }) => evidenceIds.has(id)) ??
    caseEvents.find(
      ({ status }) => !["ok", "pass", "passed", "success"].includes(status.toLowerCase())
    )
  );
}

function renderPlane(plane: PlaneName, result: PlaneResult): string {
  return `<li><strong>${escapeHtml(plane)}</strong>: ${escapeHtml(result.status)} — ${escapeHtml(result.summary)}</li>`;
}

function renderArtifacts(artifacts: readonly ArtifactRecord[]): string {
  return artifacts.length
    ? `<ul>${artifacts
        .map(
          (artifact) =>
            `<li><a href="${escapeHtml(artifactHref(artifact.path))}">${escapeHtml(artifact.description)}</a></li>`
        )
        .join("")}</ul>`
    : "<p>None recorded</p>";
}

function renderCase(caseReport: CaseReport, events: readonly EvidenceEvent[]): string {
  const divergence = earliestDivergentEvent(caseReport, events);
  const divergenceHtml = divergence
    ? `<code>${escapeHtml(divergence.id)}</code> — ${escapeHtml(divergence.stage)} / ${escapeHtml(divergence.type)} / ${escapeHtml(divergence.status)}`
    : "None recorded";

  return `<section>
    <h2>${escapeHtml(caseReport.caseId)} / ${escapeHtml(caseReport.attemptId)} — ${escapeHtml(caseReport.verdict)}</h2>
    <h3>Three-plane status</h3>
    <ul>${PLANE_NAMES.map((plane) => renderPlane(plane, caseReport.results[plane])).join("")}</ul>
    <p><strong>Earliest divergent event:</strong> ${divergenceHtml}</p>
    <h3>Artifacts</h3>
    ${renderArtifacts(caseReport.artifacts)}
  </section>`;
}

function renderHtml(report: RunReport, events: readonly EvidenceEvent[]): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Experience report ${escapeHtml(report.runId)}</title>
</head>
<body>
  <main>
    <h1>Experience run ${escapeHtml(report.runId)} — ${escapeHtml(report.verdict)}</h1>
    <h2>Run three-plane status</h2>
    <ul>${PLANE_NAMES.map((plane) => renderPlane(plane, report.results[plane])).join("")}</ul>
    <h2>Run artifacts</h2>
    ${renderArtifacts(report.artifacts)}
    ${report.cases.map((caseReport) => renderCase(caseReport, events)).join("\n")}
  </main>
</body>
</html>
`;
}

export async function writeExperienceReport(
  input: WriteExperienceReportInput
): Promise<RunReport> {
  const cases = CaseReportSchema.array()
    .parse(input.cases)
    .map((caseReport) =>
      CaseReportSchema.parse(
        redactForEvidence(
          {
            ...caseReport,
            verdict: deriveCaseVerdict(caseReport)
          },
          input.knownSecrets
        )
      )
    );
  const events = sortedEvents(
    EvidenceEventSchema.array()
      .parse(input.events)
      .map((entry) =>
        EvidenceEventSchema.parse(
          redactForEvidence(entry, input.knownSecrets)
        )
      )
  );
  const resources = RunResourceRecordSchema.array()
    .parse(input.resources ?? [])
    .map((resource) =>
      RunResourceRecordSchema.parse(
        redactForEvidence(resource, input.knownSecrets)
      )
    );
  const artifacts = ArtifactRecordSchema.array()
    .parse(input.artifacts ?? [])
    .map((artifact) =>
      ArtifactRecordSchema.parse(
        redactForEvidence(artifact, input.knownSecrets)
      )
    );
  const baseResults = Object.fromEntries(
    PLANE_NAMES.map((plane) => [
      plane,
      PlaneResultSchema.parse(
        redactForEvidence(
          PlaneResultSchema.parse(input.runResults[plane]),
          input.knownSecrets
        )
      )
    ])
  ) as CaseReport["results"];
  const results: CaseReport["results"] = {
    product: aggregatePlane("product", baseResults.product, cases),
    harness: aggregatePlane("harness", baseResults.harness, cases),
    environment: aggregatePlane("environment", baseResults.environment, cases)
  };
  const report = RunReportSchema.parse({
    schemaVersion: "1.0",
    runId: input.runId,
    startedAt: input.startedAt,
    finishedAt: input.finishedAt,
    verdict: deriveRunVerdict({ cases, results }),
    results,
    thresholds: EXPERIENCE_THRESHOLDS,
    cases,
    resources,
    artifacts
  });
  assertRelativeArtifactPaths(report);

  const rootManifest = {
    schemaVersion: "1.0",
    runId: report.runId,
    startedAt: report.startedAt,
    finishedAt: report.finishedAt,
    thresholds: report.thresholds,
    cases: EXPERIENCE_CASES
  };

  await mkdir(input.outputRoot, { recursive: true });
  await atomicWrite(join(input.outputRoot, "case-manifest.json"), json(rootManifest));
  await atomicWrite(join(input.outputRoot, "events.json"), json(events));
  await atomicWrite(join(input.outputRoot, "report.json"), json(report));
  await atomicWrite(join(input.outputRoot, "report.html"), renderHtml(report, events));

  return report;
}
