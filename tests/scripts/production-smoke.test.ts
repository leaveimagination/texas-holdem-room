import { describe, expect, test, vi } from "vitest";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EvidenceRecorder } from "../experience/evidence/recorder";
import { validateEvidencePack } from "../experience/evidence/validator";
import { writeExperienceReport } from "../experience/evidence/report-writer";
import { CaseReportSchema } from "../experience/evidence/contracts";

import {
  buildProductionCleanupCommand,
  combineProductFailureWithRetainedCleanup,
  combineSmokeFailureWithRetainedCleanup,
  augmentSmokeResultWithRetainedCleanup,
  discoverProductionAppContainer,
  runExactProductionCleanup,
  type DockerCommandRunner
} from "../../scripts/site-test/production-smoke";

describe("production smoke container discovery", () => {
  test("discovers the one running default production app by exact Compose labels", async () => {
    const run = scriptedDocker([
      { stdout: "app-123\n" },
      { stdout: JSON.stringify([{ State: { Health: { Status: "healthy" } }, Image: "sha256:image-1" }]) }
    ]);

    await expect(discoverProductionAppContainer({ expectedImageId: "sha256:image-1", run }))
      .resolves.toEqual({ containerId: "app-123", imageId: "sha256:image-1" });
    expect(run).toHaveBeenNthCalledWith(1, "docker", [
      "ps", "--filter", "status=running",
      "--filter", "label=com.docker.compose.project=texas-holdem",
      "--filter", "label=com.docker.compose.service=app",
      "--format", "{{.ID}}"
    ]);
  });

  test.each(["", "app-1\napp-2\n"])("rejects zero or multiple production app matches: %j", async (stdout) => {
    await expect(discoverProductionAppContainer({
      expectedImageId: "sha256:image-1",
      run: scriptedDocker([{ stdout }])
    })).rejects.toThrow(/exactly one running app container/);
  });

  test.each([
    [{ State: { Health: { Status: "unhealthy" } }, Image: "sha256:image-1" }, /not healthy/],
    [{ State: { Health: { Status: "healthy" } }, Image: "sha256:other" }, /image ID mismatch/]
  ])("rejects an unsafe discovered container", async (inspection, message) => {
    await expect(discoverProductionAppContainer({
      expectedImageId: "sha256:image-1",
      run: scriptedDocker([{ stdout: "app-123\n" }, { stdout: JSON.stringify([inspection]) }])
    })).rejects.toThrow(message);
  });

  test("allows an explicit disposable project override without weakening the default", async () => {
    const run = scriptedDocker([
      { stdout: "disposable-app\n" },
      { stdout: JSON.stringify([{ State: { Health: { Status: "healthy" } }, Image: "sha256:unique" }]) }
    ]);
    await discoverProductionAppContainer({
      project: "holdem-site-task11-ab12cd",
      expectedImageId: "sha256:unique",
      run
    });
    expect(run).toHaveBeenNthCalledWith(1, "docker", expect.arrayContaining([
      "label=com.docker.compose.project=holdem-site-task11-ab12cd"
    ]));
  });
});

describe("production smoke exact cleanup command", () => {
  test("uses a docker exec argument array with the cleanup marker and exact identifiers", () => {
    expect(buildProductionCleanupCommand({
      containerId: "app-123",
      roomId: "room;not-shell",
      runId: "run$(not-shell)"
    })).toEqual({
      command: "docker",
      args: [
        "exec", "-e", "SITE_TEST_CLEANUP_ALLOWED=1", "app-123",
        "./node_modules/.bin/tsx", "src/server/site-test-cleanup.ts",
        "room;not-shell", "run$(not-shell)"
      ]
    });
  });

  test("accepts only a matching JSON result that deleted the exact room", async () => {
    const run = scriptedDocker([{
      stdout: `${JSON.stringify({ deleted: true, retainedReason: null, roomId: "room-1", runId: "run-1", cleanupStatus: "deleted", failureReason: null })}\n`
    }]);
    await expect(runExactProductionCleanup({
      containerId: "app-123", roomId: "room-1", runId: "run-1", run
    })).resolves.toMatchObject({ deleted: true, roomId: "room-1", runId: "run-1" });
  });

  test.each([
    ["not-json", /valid cleanup JSON/],
    [JSON.stringify({ deleted: false, retainedReason: "ownership-marker-not-found", roomId: "room-1", runId: "run-1" }), /ownership-marker-not-found/],
    [JSON.stringify({ deleted: true, retainedReason: null, roomId: "other", runId: "run-1" }), /identity mismatch/]
  ])("retains the exact room when cleanup cannot be proven", async (stdout, message) => {
    await expect(runExactProductionCleanup({
      containerId: "app-123", roomId: "room-1", runId: "run-1",
      run: scriptedDocker([{ stdout }])
    })).rejects.toThrow(message);
  });

  test("reports partial cleanup distinctly from retained cleanup", async () => {
    await expect(runExactProductionCleanup({
      containerId: "app-123", roomId: "room-1", runId: "run-1",
      run: scriptedDocker([{ stdout: JSON.stringify({ deleted: false, retainedReason: null, roomId: "room-1", runId: "run-1", cleanupStatus: "partial", failureReason: "redis-restore-not-proven" }) }])
    })).rejects.toMatchObject({ cleanupStatus: "partial" });
  });

  test("reports a post-invocation process failure as partial cleanup", async () => {
    await expect(runExactProductionCleanup({
      containerId: "app-123", roomId: "room-1", runId: "run-1",
      run: async () => { throw new Error("docker exec timed out after start"); }
    })).rejects.toMatchObject({
      cleanupStatus: "partial",
      message: expect.stringMatching(/process outcome.*partial/i)
    });
  });
});

test("keeps a proven product FAIL while reporting exact retained cleanup", () => {
  const result = combineProductFailureWithRetainedCleanup({
    productFailure: {
      assertionId: "EXP-010-A03",
      message: "seat claim failed",
      actor: "player",
      measuredValue: false,
      threshold: true,
      artifactIds: []
    },
    roomId: "room-1",
    ownershipMarker: "SITE-run-1-smoke-player",
    cleanupReason: "ownership-marker-not-found"
  });
  expect(result.verdict).toBe("FAIL");
  expect(result.results.product.status).toBe("fail");
  expect(result.results.environment.status).toBe("inconclusive");
  expect(result.failures).toContainEqual(expect.objectContaining({
    code: "EXACT_CLEANUP_RETAINED",
    details: expect.objectContaining({ roomId: "room-1" })
  }));
});

test("preserves FAIL through report aggregation only for exact cleanup-only uncertainty", async () => {
  const root = await mkdtemp(join(tmpdir(), "smoke-cleanup-aggregate-"));
  const prior = combineProductFailureWithRetainedCleanup({
    productFailure: { assertionId: "EXP-010-A03", message: "seat claim failed", actor: "player", measuredValue: false, threshold: true, artifactIds: [] },
    roomId: "room-1", ownershipMarker: "SITE-run-1-smoke-player", cleanupReason: "ownership-marker-not-found"
  });
  const report = await writeExperienceReport({
    outputRoot: root,
    runId: "run-1",
    startedAt: "2026-07-17T00:00:00.000Z",
    finishedAt: "2026-07-17T00:01:00.000Z",
    cases: [CaseReportSchema.parse({ schemaVersion: "1.0", runId: "run-1", caseId: "EXP-010", attemptId: "A-001", startedAt: "2026-07-17T00:00:00.000Z", finishedAt: "2026-07-17T00:01:00.000Z", artifacts: [], ...prior })],
    events: [], resources: [], artifacts: [],
    runResults: {
      product: { status: "pass", summary: "runner" },
      harness: { status: "pass", summary: "runner" },
      environment: { status: "pass", summary: "runner" }
    }
  });
  expect(report).toMatchObject({ verdict: "FAIL", results: { product: { status: "fail" }, harness: { status: "inconclusive" }, environment: { status: "inconclusive" } } });

  const malformed = structuredClone(report.cases[0]);
  malformed.failures.push({ code: "HARNESS_RUNTIME_FAILURE", summary: "browser crashed", stage: "runtime", evidenceEventIds: [] });
  const malformedReport = await writeExperienceReport({
    outputRoot: root, runId: "run-1", startedAt: report.startedAt, finishedAt: report.finishedAt,
    cases: [malformed], events: [], resources: [], artifacts: [],
    runResults: { product: { status: "pass", summary: "runner" }, harness: { status: "pass", summary: "runner" }, environment: { status: "pass", summary: "runner" } }
  });
  expect(malformedReport.verdict).toBe("INCONCLUSIVE");

  const unrelatedUncertainty = structuredClone(report.cases[0]);
  unrelatedUncertainty.assertions.push({
    id: "EXP-010-A02",
    outcome: "inconclusive",
    summary: "seat observation was unavailable",
    evidenceEventIds: []
  });
  const unrelatedReport = await writeExperienceReport({
    outputRoot: root, runId: "run-1", startedAt: report.startedAt, finishedAt: report.finishedAt,
    cases: [unrelatedUncertainty], events: [], resources: [], artifacts: [],
    runResults: { product: { status: "pass", summary: "runner" }, harness: { status: "pass", summary: "runner" }, environment: { status: "pass", summary: "runner" } }
  });
  expect(unrelatedReport.verdict).toBe("INCONCLUSIVE");
});

test.each([
  [undefined, "INCONCLUSIVE", "pass"],
  [{ kind: "timeout" as const, message: "navigation timed out" }, "INCONCLUSIVE", "inconclusive"],
  [{ kind: "harness" as const, message: "browser crashed" }, "INCONCLUSIVE", "inconclusive"],
  [{ kind: "product" as const, assertionId: "EXP-010-A03", message: "seat failed", actor: "player", measuredValue: false, threshold: true, artifactIds: [] }, "FAIL", "fail"]
])("retained cleanup preserves every prior error class: %j", (priorFailure, verdict, productStatus) => {
  const result = combineSmokeFailureWithRetainedCleanup({
    priorFailure, roomId: "room-exact", ownershipMarker: "SITE-run-smoke-player", cleanupReason: "CLI missing"
  });
  expect(result.verdict).toBe(verdict);
  expect(result.results.product.status).toBe(productStatus);
  expect(result.results.harness.status).toBe("inconclusive");
  expect(result.results.environment.status).toBe("inconclusive");
  expect(result.failures.at(-1)).toMatchObject({ code: "EXACT_CLEANUP_RETAINED", details: { roomId: "room-exact" } });
});

test("augments an exact prior result without dropping evidence or failure details", () => {
  const prior = { verdict: "FAIL" as const, results: { product: { status: "fail" as const, summary: "proven", evidenceEventIds: ["E-fail"] }, harness: { status: "pass" as const, summary: "captured", evidenceEventIds: ["E-harness"] }, environment: { status: "pass" as const, summary: "available", evidenceEventIds: [] } }, assertions: [{ id: "EXP-010-A01", outcome: "pass" as const, evidenceEventIds: ["E-pass"], summary: "passed" }, { id: "EXP-010-A03", outcome: "fail" as const, evidenceEventIds: ["E-fail"], summary: "failed", details: { exact: true } }], failures: [{ code: "PRODUCT_ASSERTION_FAILED", summary: "failed", stage: "EXP-010-A03", evidenceEventIds: ["E-fail"], details: { exact: true } }] };
  const result = augmentSmokeResultWithRetainedCleanup(prior, { roomId: "room-exact", ownershipMarker: "SITE-run-smoke-player", cleanupReason: "CLI missing" });
  expect(result.assertions.filter(({ id }) => id !== "EXP-010-A04")).toEqual(prior.assertions);
  expect(result.assertions.find(({ id }) => id === "EXP-010-A04")).toMatchObject({ outcome: "inconclusive", details: { roomId: "room-exact" } });
  expect(result.failures[0]).toEqual(prior.failures[0]);
  expect(result.results.product).toEqual(prior.results.product);
  expect(result.verdict).toBe("FAIL");
  expect(result.failures.at(-1)).toMatchObject({ code: "EXACT_CLEANUP_RETAINED", details: { roomId: "room-exact" } });
});

test("classifies partial cleanup as failed state with exact room details", () => {
  const result = augmentSmokeResultWithRetainedCleanup({
    verdict: "FAIL",
    results: {
      product: { status: "fail", summary: "proven", evidenceEventIds: [] },
      harness: { status: "pass", summary: "captured", evidenceEventIds: [] },
      environment: { status: "pass", summary: "healthy", evidenceEventIds: [] }
    },
    assertions: [{ id: "EXP-010-A03", outcome: "fail", evidenceEventIds: [], summary: "failed" }],
    failures: [{ code: "PRODUCT_ASSERTION_FAILED", summary: "failed", stage: "EXP-010-A03", evidenceEventIds: [] }]
  }, {
    roomId: "room-exact", ownershipMarker: "SITE-run-player",
    cleanupReason: "redis-restore-not-proven", cleanupStatus: "partial"
  });
  expect(result.failures.at(-1)).toMatchObject({
    code: "EXACT_CLEANUP_PARTIAL",
    stage: "EXP-010-A04",
    details: { roomId: "room-exact", cleanupStatus: "partial" }
  });
  expect(result.results.harness.status).toBe("inconclusive");
  expect(result.results.environment.status).toBe("inconclusive");
});

test("redacts a host token learned after recorder construction from navigation failure pack", async () => {
  const root = await mkdtemp(join(tmpdir(), "smoke-secrets-"));
  const secrets: string[] = [];
  const recorder = new EvidenceRecorder({ outputRoot: root, runId: "run-1", caseId: "EXP-010", attemptId: "A-001", actor: "host", knownSecrets: secrets });
  const token = "host_token_learned_late";
  await recorder.recordEvent({ stage: "host-navigation", type: "failure", status: "failure-durable", details: { message: `socket closed for ${token}` } });
  secrets.push(token);
  await recorder.finishCase({ verdict: "INCONCLUSIVE", results: { product: { status: "inconclusive", summary: `navigation ${token}`, evidenceEventIds: [] }, harness: { status: "inconclusive", summary: `navigation ${token}`, evidenceEventIds: [] }, environment: { status: "pass", summary: "available", evidenceEventIds: [] } }, assertions: [], failures: [{ code: "HARNESS_RUNTIME_FAILURE", summary: `navigation ${token}`, evidenceEventIds: [] }] });
  await writeFile(join(root, "case-manifest.json"), JSON.stringify({ schemaVersion: "1.0", caseId: "EXP-010", objective: "Smoke deployment", entrypoint: "public site", fixture: { description: "public room", expectedFacts: ["room exists"] }, assertions: [{ id: "EXP-010-A01", description: "entry responds" }], forbiddenOutcomes: ["secret leaks"], acceptableAlternatives: [], stopConditions: { overallTimeoutMs: 120000, noProgressTimeoutMs: 15000 } }));
  const pack = `${await readFile(join(root, "events.json"), "utf8")}\n${await readFile(join(root, "report.json"), "utf8")}`;
  expect(pack).not.toContain(token);
  expect(pack).toContain("[REDACTED]");
  await expect(validateEvidencePack(root, [token])).resolves.toMatchObject({ filesScanned: 4, artifactCount: 0 });
});

function scriptedDocker(outputs: Array<{ stdout: string; stderr?: string; exitCode?: number }>): DockerCommandRunner {
  return vi.fn(async () => {
    const next = outputs.shift();
    if (!next) throw new Error("Unexpected Docker call");
    return { exitCode: next.exitCode ?? 0, stdout: next.stdout, stderr: next.stderr ?? "" };
  });
}
