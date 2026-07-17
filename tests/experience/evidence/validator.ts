import {
  lstat,
  readFile,
  readdir,
  realpath
} from "node:fs/promises";
import {
  basename,
  isAbsolute,
  relative,
  resolve
} from "node:path";
import { strFromU8, unzipSync } from "fflate";

import {
  CaseReportSchema,
  EvidenceEventSchema,
  ExperienceCaseManifestSchema,
  RunReportSchema,
  type ArtifactRecord,
  type CaseReport,
  type EvidenceEvent
} from "./contracts";
import type { KnownSecret } from "./redaction";

export interface EvidenceValidationResult {
  filesScanned: number;
  textEntriesScanned: number;
  artifactCount: number;
}

async function listFiles(root: string): Promise<string[]> {
  const files: string[] = [];
  const visit = async (directory: string): Promise<void> => {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const path = resolve(directory, entry.name);
      if (entry.isDirectory()) {
        await visit(path);
      } else {
        files.push(path);
      }
    }
  };
  await visit(root);
  return files;
}

function normalizeSecrets(knownSecrets: readonly KnownSecret[]): string[] {
  return knownSecrets
    .map((secret) =>
      typeof secret === "string" ? secret : Buffer.from(secret).toString("utf8")
    )
    .filter((secret) => secret.length > 0);
}

function assertNoKnownSecret(
  content: string,
  source: string,
  secrets: readonly string[]
): void {
  if (secrets.some((secret) => content.includes(secret))) {
    throw new Error(`Known secret found in evidence: ${source}`);
  }
}

function isLikelyText(bytes: Uint8Array): boolean {
  if (bytes.length === 0) {
    return true;
  }
  let controlCharacters = 0;
  for (const byte of bytes) {
    if (byte === 0) {
      return false;
    }
    if (byte < 9 || (byte > 13 && byte < 32)) {
      controlCharacters += 1;
    }
  }
  return controlCharacters / bytes.length < 0.01;
}

function assertMonotonicEvents(events: readonly EvidenceEvent[], source: string): void {
  for (let index = 1; index < events.length; index += 1) {
    if (events[index].seq <= events[index - 1].seq) {
      throw new Error(
        `Event sequence must be strictly increasing in ${source}`
      );
    }
    if (events[index].monotonicMs < events[index - 1].monotonicMs) {
      throw new Error(
        `Monotonic timestamp must be nondecreasing in ${source}`
      );
    }
  }
}

function safeArtifactPath(outputRoot: string, artifactPath: string): string {
  if (
    isAbsolute(artifactPath) ||
    artifactPath.split(/[\\/]+/).includes("..")
  ) {
    throw new Error(`Artifact path traversal rejected: ${artifactPath}`);
  }

  const resolved = resolve(outputRoot, artifactPath);
  const fromRoot = relative(outputRoot, resolved);
  if (fromRoot.startsWith("..") || isAbsolute(fromRoot)) {
    throw new Error(`Artifact path traversal rejected: ${artifactPath}`);
  }
  return resolved;
}

interface ReportEventReference {
  id: string;
  runId: string;
  caseId?: string;
  attemptId?: string;
}

interface ParsedReport {
  kind: "case" | "run";
  runId: string;
  cases: Array<{
    runId: string;
    caseId: string;
    attemptId: string;
  }>;
  artifacts: ArtifactRecord[];
  eventReferences: ReportEventReference[];
}

function caseReportReferences(report: CaseReport): ReportEventReference[] {
  const ids = [
    ...Object.values(report.results).flatMap(
      (result) => result.evidenceEventIds
    ),
    ...report.assertions.flatMap((assertion) => assertion.evidenceEventIds),
    ...report.failures.flatMap((failure) => failure.evidenceEventIds)
  ];
  return ids.map((id) => ({
    id,
    runId: report.runId,
    caseId: report.caseId,
    attemptId: report.attemptId
  }));
}

function parseReport(report: unknown): ParsedReport {
  const caseResult = CaseReportSchema.safeParse(report);
  if (caseResult.success) {
    return {
      kind: "case",
      runId: caseResult.data.runId,
      cases: [
        {
          runId: caseResult.data.runId,
          caseId: caseResult.data.caseId,
          attemptId: caseResult.data.attemptId
        }
      ],
      artifacts: caseResult.data.artifacts,
      eventReferences: caseReportReferences(caseResult.data)
    };
  }

  const runResult = RunReportSchema.parse(report);
  for (const caseReport of runResult.cases) {
    if (caseReport.runId !== runResult.runId) {
      throw new Error(
        `Nested case ${caseReport.caseId} has runId ${caseReport.runId}, not parent runId ${runResult.runId}`
      );
    }
  }
  const runReferences = Object.values(runResult.results).flatMap((result) =>
    result.evidenceEventIds.map((id) => ({ id, runId: runResult.runId }))
  );
  return {
    kind: "run",
    runId: runResult.runId,
    cases: runResult.cases.map((caseReport) => ({
      runId: caseReport.runId,
      caseId: caseReport.caseId,
      attemptId: caseReport.attemptId
    })),
    artifacts: [
      ...runResult.artifacts,
      ...runResult.cases.flatMap((caseReport) => caseReport.artifacts)
    ],
    eventReferences: [
      ...runReferences,
      ...runResult.cases.flatMap(caseReportReferences)
    ]
  };
}

async function parseJson(path: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    throw new Error(`Invalid JSON in ${path}`, { cause: error });
  }
}

export async function validateEvidencePack(
  outputRoot: string,
  knownSecrets: readonly KnownSecret[] = []
): Promise<EvidenceValidationResult> {
  const canonicalRoot = await realpath(outputRoot);
  const files = await listFiles(canonicalRoot);
  const secrets = normalizeSecrets(knownSecrets);
  const artifacts: ArtifactRecord[] = [];
  const events: EvidenceEvent[] = [];
  const manifestCaseIds: string[] = [];
  const reports: ParsedReport[] = [];
  const reportEventReferences: ReportEventReference[] = [];
  let manifestCount = 0;
  let eventStreamCount = 0;
  let reportCount = 0;
  let textEntriesScanned = 0;

  for (const path of files) {
    const name = basename(path).toLowerCase();
    if (name === "case-manifest.json") {
      manifestCount += 1;
      const manifest = ExperienceCaseManifestSchema.parse(await parseJson(path));
      manifestCaseIds.push(manifest.caseId);
    } else if (name === "events.json") {
      eventStreamCount += 1;
      const parsed = EvidenceEventSchema.array().min(1).parse(await parseJson(path));
      assertMonotonicEvents(parsed, path);
      events.push(...parsed);
    } else if (name === "report.json") {
      reportCount += 1;
      const report = parseReport(await parseJson(path));
      reports.push(report);
      artifacts.push(...report.artifacts);
      reportEventReferences.push(...report.eventReferences);
    }
  }

  const missingFiles = [
    manifestCount === 0 ? "case-manifest.json" : undefined,
    eventStreamCount === 0 ? "events.json" : undefined,
    reportCount === 0 ? "report.json" : undefined
  ].filter((name): name is string => name !== undefined);
  if (missingFiles.length > 0) {
    throw new Error(
      `Missing required evidence files: ${missingFiles.join(", ")}`
    );
  }
  for (const [name, count] of [
    ["case-manifest.json", manifestCount],
    ["events.json", eventStreamCount],
    ["report.json", reportCount]
  ] as const) {
    if (count > 1) {
      throw new Error(`Duplicate required evidence file: ${name}`);
    }
  }

  const manifestCaseId = manifestCaseIds[0];
  const report = reports[0];
  if (report.kind === "case" && report.cases[0].caseId !== manifestCaseId) {
    throw new Error(
      `Manifest case ${manifestCaseId} does not match report case ${report.cases[0].caseId}`
    );
  }
  if (
    report.kind === "run" &&
    report.cases.length > 0 &&
    !report.cases.some((caseContext) => caseContext.caseId === manifestCaseId)
  ) {
    throw new Error(
      `Manifest case ${manifestCaseId} is absent from run report ${report.runId}`
    );
  }
  for (const event of events) {
    const matchesReport =
      event.runId === report.runId &&
      (report.kind === "run" ||
        report.cases.some(
          (caseContext) =>
            event.caseId === caseContext.caseId &&
            event.attemptId === caseContext.attemptId
        ));
    if (!matchesReport) {
      throw new Error(
        `Evidence event ${event.id} does not match report context`
      );
    }
  }

  const artifactsById = new Map<string, ArtifactRecord>();
  for (const artifact of artifacts) {
    if (artifactsById.has(artifact.id)) {
      throw new Error(`Duplicate artifact ID: ${artifact.id}`);
    }
    artifactsById.set(artifact.id, artifact);
  }
  const eventsById = new Map<string, EvidenceEvent>();
  for (const event of events) {
    if (eventsById.has(event.id)) {
      throw new Error(`Duplicate evidence event ID: ${event.id}`);
    }
    eventsById.set(event.id, event);
  }
  for (const event of events) {
    for (const artifactId of event.artifactIds) {
      if (!artifactsById.has(artifactId)) {
        throw new Error(`Event references unknown artifact: ${artifactId}`);
      }
    }
  }
  for (const reference of reportEventReferences) {
    const event = eventsById.get(reference.id);
    if (!event) {
      throw new Error(
        `Report references unknown evidence event: ${reference.id}`
      );
    }
    if (
      event.runId !== reference.runId ||
      (reference.caseId !== undefined && event.caseId !== reference.caseId) ||
      (reference.attemptId !== undefined &&
        event.attemptId !== reference.attemptId)
    ) {
      throw new Error(
        `Evidence event ${reference.id} does not match report context`
      );
    }
  }

  for (const artifact of artifacts) {
    const artifactPath = safeArtifactPath(canonicalRoot, artifact.path);
    let stats;
    try {
      stats = await lstat(artifactPath);
    } catch (error) {
      throw new Error(`Missing artifact: ${artifact.path}`, { cause: error });
    }
    if (!stats.isFile()) {
      throw new Error(`Artifact is not a file: ${artifact.path}`);
    }
    const canonicalArtifact = await realpath(artifactPath);
    const fromRoot = relative(canonicalRoot, canonicalArtifact);
    if (fromRoot.startsWith("..") || isAbsolute(fromRoot)) {
      throw new Error(`Artifact path traversal rejected: ${artifact.path}`);
    }
  }

  for (const path of files) {
    if (path.toLowerCase().endsWith(".zip")) {
      let entries: Record<string, Uint8Array>;
      try {
        entries = unzipSync(new Uint8Array(await readFile(path)));
      } catch (error) {
        throw new Error(`Invalid trace ZIP: ${path}`, { cause: error });
      }
      for (const [entryName, bytes] of Object.entries(entries)) {
        if (isLikelyText(bytes)) {
          textEntriesScanned += 1;
          assertNoKnownSecret(
            strFromU8(bytes),
            `${path}!${entryName}`,
            secrets
          );
        }
      }
    } else {
      const bytes = new Uint8Array(await readFile(path));
      if (isLikelyText(bytes)) {
        textEntriesScanned += 1;
        assertNoKnownSecret(strFromU8(bytes), path, secrets);
      }
    }
  }

  return {
    filesScanned: files.length,
    textEntriesScanned,
    artifactCount: artifacts.length
  };
}
