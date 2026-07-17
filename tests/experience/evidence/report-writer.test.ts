import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { EXPERIENCE_CASES } from "../case-catalog";
import {
  EvidenceEventSchema,
  RunReportSchema,
  type ArtifactRecord,
  type CaseReport,
  type EvidenceEvent
} from "./contracts";
import * as reportWriter from "./report-writer";
import { validateEvidencePack } from "./validator";

const { writeExperienceReport } = reportWriter;

const roots: string[] = [];
const STARTED_AT = "2026-07-17T01:00:00.000Z";
const FINISHED_AT = "2026-07-17T01:01:00.000Z";

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true })));
});

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "experience-report-"));
  roots.push(root);
  return root;
}

function event(
  caseId: string,
  attemptId: string,
  seq: number,
  status = "ok"
): EvidenceEvent {
  return EvidenceEventSchema.parse({
    id: `${caseId}-${attemptId}-E-${String(seq).padStart(6, "0")}`,
    runId: "RUN-001",
    caseId,
    attemptId,
    actor: "host",
    seq,
    timestamp: new Date(Date.parse(STARTED_AT) + seq * 1_000).toISOString(),
    monotonicMs: seq * 1_000,
    stage: seq === 2 ? "<script>settlement</script>" : "room-ready",
    type: "assertion",
    status,
    details: {},
    artifactIds: status === "fail" ? ["ART-FAILURE"] : []
  });
}

function caseReport(
  caseId: string,
  attemptId: string,
  outcome: "pass" | "fail",
  artifact?: ArtifactRecord
): CaseReport {
  const evidenceEventIds =
    outcome === "fail" ? [`${caseId}-${attemptId}-E-000002`] : [];
  return {
    schemaVersion: "1.0",
    runId: "RUN-001",
    caseId,
    attemptId,
    startedAt: STARTED_AT,
    finishedAt: FINISHED_AT,
    verdict: outcome === "pass" ? "PASS" : "FAIL",
    results: {
      product: {
        status: outcome,
        summary:
          outcome === "pass"
            ? "Product behavior passed."
            : "Product rendered <script>too early</script>.",
        evidenceEventIds
      },
      harness: {
        status: "pass",
        summary: "Harness evidence passed.",
        evidenceEventIds: []
      },
      environment: {
        status: "pass",
        summary: "Environment checks passed.",
        evidenceEventIds: []
      }
    },
    assertions: [
      {
        id: `${caseId}-A01`,
        outcome,
        evidenceEventIds,
        summary: outcome === "pass" ? "Assertion passed." : "Assertion failed."
      }
    ],
    failures:
      outcome === "fail"
        ? [
            {
              code: "EARLY_SETTLEMENT",
              summary: "Settlement appeared before the final card.",
              stage: "settlement",
              evidenceEventIds
            }
          ]
        : [],
    artifacts: artifact ? [artifact] : []
  };
}

function inconclusiveCaseReport(caseId: string): CaseReport {
  const report = caseReport(caseId, "A-001", "pass");
  return {
    ...report,
    verdict: "INCONCLUSIVE",
    results: {
      ...report.results,
      product: {
        status: "inconclusive",
        summary: "Product evidence was incomplete.",
        evidenceEventIds: []
      }
    },
    assertions: report.assertions.map((assertion) => ({
      ...assertion,
      outcome: "inconclusive",
      summary: "The assertion could not be judged."
    }))
  };
}

function runResults(
  productStatus: "pass" | "inconclusive" = "pass"
): CaseReport["results"] {
  return {
    product: {
      status: productStatus,
      summary:
        productStatus === "pass"
          ? "Run-level product checks passed."
          : "Run-level product evidence was incomplete.",
      evidenceEventIds: []
    },
    harness: {
      status: "pass",
      summary: "Run-level harness checks passed.",
      evidenceEventIds: []
    },
    environment: {
      status: "pass",
      summary: "Run-level environment checks passed.",
      evidenceEventIds: []
    }
  };
}

async function writeSingleCaseRunPack(
  outputRoot: string,
  caseId = "EXP-001"
): Promise<void> {
  await writeExperienceReport({
    outputRoot,
    runId: "RUN-001",
    startedAt: STARTED_AT,
    finishedAt: FINISHED_AT,
    cases: [caseReport(caseId, "A-001", "pass")],
    events: [event(caseId, "A-001", 1)],
    resources: [],
    artifacts: [],
    runResults: runResults()
  });
}

describe("writeExperienceReport", () => {
  it("classifies artifact paths independently of the host path flavor", () => {
    const isRunRelativeArtifactPath = (
      reportWriter as unknown as {
        isRunRelativeArtifactPath?: (path: string) => boolean;
      }
    ).isRunRelativeArtifactPath;

    expect(isRunRelativeArtifactPath).toBeTypeOf("function");
    for (const path of [
      "/outside.png",
      "\\outside.png",
      "C:\\outside.png",
      "\\\\server\\share\\outside.png",
      "//server/share/outside.png",
      "file:///outside.png",
      "screenshots/../../outside.png"
    ]) {
      expect(isRunRelativeArtifactPath?.(path), path).toBe(false);
    }
    for (const path of [
      "screenshots/failure.png",
      "screenshots\\failure.png",
      "..foo.png"
    ]) {
      expect(isRunRelativeArtifactPath?.(path), path).toBe(true);
    }
  });

  it("writes a strict root run pack accepted by evidence validation", async () => {
    const outputRoot = await temporaryRoot();
    await writeSingleCaseRunPack(outputRoot);

    await expect(validateEvidencePack(outputRoot, [])).resolves.toMatchObject({
      artifactCount: 0
    });
  });

  it("honors an aborted signal before writing the evidence pack", async () => {
    const outputRoot = await temporaryRoot();
    const controller = new AbortController();
    controller.abort(new Error("report stage cancelled"));

    await expect(
      writeExperienceReport(
        {
          outputRoot,
          runId: "RUN-001",
          startedAt: STARTED_AT,
          finishedAt: FINISHED_AT,
          cases: [caseReport("EXP-001", "A-001", "pass")],
          events: [event("EXP-001", "A-001", 1)],
          resources: [],
          artifacts: [],
          runResults: runResults()
        },
        { signal: controller.signal }
      )
    ).rejects.toThrow(/report stage cancelled|abort/i);
  });

  it("rejects a root manifest owned by a different run", async () => {
    const outputRoot = await temporaryRoot();
    await writeSingleCaseRunPack(outputRoot);
    const manifestPath = join(outputRoot, "case-manifest.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    await writeFile(
      manifestPath,
      JSON.stringify({ ...manifest, runId: "RUN-OTHER" })
    );

    await expect(validateEvidencePack(outputRoot, [])).rejects.toThrow(
      /manifest run RUN-OTHER does not match report run RUN-001/i
    );
  });

  it("rejects a run report case absent from the root manifest catalog", async () => {
    const outputRoot = await temporaryRoot();
    await writeSingleCaseRunPack(outputRoot, "EXP-999");

    await expect(validateEvidencePack(outputRoot, [])).rejects.toThrow(
      /report case EXP-999 is absent from root manifest/i
    );
  });

  it.each(["run-level", "case-level"] as const)(
    "preserves %s product uncertainty alongside a proven product failure",
    async (uncertaintySource) => {
      const outputRoot = await temporaryRoot();
      const cases = [caseReport("EXP-001", "A-001", "fail")];
      if (uncertaintySource === "case-level") {
        cases.push(inconclusiveCaseReport("EXP-002"));
      }

      const report = await writeExperienceReport({
        outputRoot,
        runId: "RUN-001",
        startedAt: STARTED_AT,
        finishedAt: FINISHED_AT,
        cases,
        events: [],
        resources: [],
        artifacts: [],
        runResults: runResults(
          uncertaintySource === "run-level" ? "inconclusive" : "pass"
        )
      });

      expect(report.results.product.status).toBe("inconclusive");
      expect(report.verdict).toBe("INCONCLUSIVE");
    }
  );

  it("writes the catalog, sorted events, validated JSON report, and escaped HTML", async () => {
    const outputRoot = await temporaryRoot();
    const artifact: ArtifactRecord = {
      id: "ART-FAILURE",
      path: "screenshots/EXP-002 failure.png",
      description: "Failure <script>alert(1)</script>",
      kind: "screenshot",
      mediaType: "image/png",
      required: true
    };
    const runArtifact: ArtifactRecord = {
      id: "ART-DOCKER",
      path: "diagnostics/docker.txt",
      description: "Docker diagnostics",
      kind: "diagnostic",
      mediaType: "text/plain",
      required: true
    };
    const events = [
      event("EXP-002", "A-001", 2, "fail"),
      event("EXP-002", "A-001", 1, "fail"),
      event("EXP-001", "A-001", 2),
      event("EXP-001", "A-001", 1)
    ];

    const report = await writeExperienceReport({
      outputRoot,
      runId: "RUN-001",
      startedAt: STARTED_AT,
      finishedAt: FINISHED_AT,
      cases: [
        caseReport("EXP-001", "A-001", "pass"),
        caseReport("EXP-002", "A-001", "fail", artifact)
      ],
      events,
      resources: [],
      artifacts: [runArtifact],
      runResults: {
        product: {
          status: "pass",
          summary: "Run-level product checks passed.",
          evidenceEventIds: []
        },
        harness: {
          status: "pass",
          summary: "Run-level harness checks passed.",
          evidenceEventIds: []
        },
        environment: {
          status: "pass",
          summary: "Run-level environment checks passed.",
          evidenceEventIds: []
        }
      }
    });

    const manifest = JSON.parse(
      await readFile(join(outputRoot, "case-manifest.json"), "utf8")
    ) as {
      runId: string;
      cases: typeof EXPERIENCE_CASES;
    };
    const writtenEvents = JSON.parse(
      await readFile(join(outputRoot, "events.json"), "utf8")
    ) as EvidenceEvent[];
    const writtenReport = JSON.parse(
      await readFile(join(outputRoot, "report.json"), "utf8")
    );
    const html = await readFile(join(outputRoot, "report.html"), "utf8");

    expect(manifest.runId).toBe("RUN-001");
    expect(manifest.cases).toEqual(EXPERIENCE_CASES);
    expect(writtenEvents.map(({ id }) => id)).toEqual([
      "EXP-001-A-001-E-000001",
      "EXP-001-A-001-E-000002",
      "EXP-002-A-001-E-000001",
      "EXP-002-A-001-E-000002"
    ]);
    expect(RunReportSchema.parse(writtenReport)).toEqual(report);
    expect(report.verdict).toBe("FAIL");
    expect(report.results.product.status).toBe("fail");

    expect(html).toContain("EXP-001");
    expect(html).toContain("PASS");
    expect(html).toContain("EXP-002");
    expect(html).toContain("FAIL");
    expect(html).toContain("product");
    expect(html).toContain("harness");
    expect(html).toContain("environment");
    expect(html).toContain("Earliest divergent event");
    expect(html).toContain("EXP-002-A-001-E-000001");
    expect(html).toContain("room-ready");
    expect(html).toContain(
      "Product rendered &lt;script&gt;too early&lt;/script&gt;."
    );
    expect(html).toContain("Failure &lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).not.toContain("<script>");
    expect(html).toContain('href="screenshots/EXP-002%20failure.png"');
    expect(html).toContain('href="diagnostics/docker.txt"');
    expect(html).not.toContain(outputRoot);
  });

  it.each([
    ["POSIX root", "/outside.png"],
    ["Windows rooted path", "\\outside.png"],
    ["Windows drive root", "C:\\outside.png"],
    ["UNC root", "\\\\server\\share\\outside.png"],
    ["forward-slash network root", "//server/share/outside.png"],
    ["URI", "file:///outside.png"],
    ["traversal", "screenshots/../../outside.png"]
  ])("rejects a %s artifact path", async (_kind, artifactPath) => {
    const outputRoot = await temporaryRoot();
    const artifact: ArtifactRecord = {
      id: "ART-FAILURE",
      path: artifactPath,
      description: "Unsafe artifact",
      required: true
    };

    await expect(
      writeExperienceReport({
        outputRoot,
        runId: "RUN-001",
        startedAt: STARTED_AT,
        finishedAt: FINISHED_AT,
        cases: [caseReport("EXP-002", "A-001", "fail", artifact)],
        events: [event("EXP-002", "A-001", 2, "fail")],
        resources: [],
        artifacts: [],
        runResults: runResults()
      })
    ).rejects.toThrow(/artifact path must be relative to the run directory/i);
  });
});
