import { mkdtemp, readFile, rm } from "node:fs/promises";
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
import { writeExperienceReport } from "./report-writer";

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

describe("writeExperienceReport", () => {
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
      event("EXP-002", "A-001", 1),
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
    expect(html).toContain("EXP-002-A-001-E-000002");
    expect(html).toContain("&lt;script&gt;settlement&lt;/script&gt;");
    expect(html).toContain("Failure &lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).not.toContain("<script>");
    expect(html).toContain('href="screenshots/EXP-002%20failure.png"');
    expect(html).toContain('href="diagnostics/docker.txt"');
    expect(html).not.toContain(outputRoot);
  });

  it("rejects artifact paths that escape the run directory", async () => {
    const outputRoot = await temporaryRoot();
    const artifact: ArtifactRecord = {
      id: "ART-FAILURE",
      path: "../outside.png",
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
      })
    ).rejects.toThrow(/artifact path must be relative to the run directory/i);
  });
});
