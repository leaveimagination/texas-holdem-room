import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { strToU8, zipSync } from "fflate";
import { afterEach, describe, expect, it } from "vitest";

import {
  EvidenceEventSchema,
  EXPERIENCE_THRESHOLDS
} from "./contracts";
import * as EvidenceContracts from "./contracts";
import { redactForEvidence } from "./redaction";
import { EvidenceRecorder, renameWithTransientRetry } from "./recorder";
import {
  validateEvidencePack,
  type EvidenceUnzipStarter
} from "./validator";

const temporaryRoots: string[] = [];

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "holdem-evidence-"));
  temporaryRoots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) =>
      rm(root, { recursive: true, force: true })
    )
  );
});

it("durably preserves multiple product failures and safe privacy counts", async () => {
  const root = await temporaryRoot();
  const recorder = new EvidenceRecorder({ outputRoot: root, runId: "RUN-MULTI", caseId: "EXP-008", attemptId: "A-001", actor: "scenario" });
  const first = await recorder.recordEvent({ stage: "EXP-008-A01", type: "product-assertion", status: "fail", details: { unauthorizedVisibleCount: 0, boardCount: 3 } });
  const second = await recorder.recordEvent({ stage: "EXP-008-A03", type: "product-assertion", status: "fail", details: { duplicateCount: 1 } });
  const report = await recorder.finishCase({
    verdict: "FAIL",
    results: {
      product: { status: "fail", summary: "Two product assertions failed.", evidenceEventIds: [first.id, second.id] },
      harness: { status: "pass", summary: "Harness remained trustworthy.", evidenceEventIds: [first.id, second.id] },
      environment: { status: "pass", summary: "Environment remained healthy.", evidenceEventIds: [] }
    },
    assertions: [
      { id: "EXP-008-A01", outcome: "fail", evidenceEventIds: [first.id], summary: "Guidance missed.", details: { unauthorizedVisibleCount: 0 } },
      { id: "EXP-008-A03", outcome: "fail", evidenceEventIds: [second.id], summary: "Duplicate observed.", details: { duplicateCount: 1 } }
    ],
    failures: [
      { code: "PRODUCT_ASSERTION_FAILED", summary: "Guidance missed.", stage: "EXP-008-A01", evidenceEventIds: [first.id] },
      { code: "PRODUCT_ASSERTION_FAILED", summary: "Duplicate observed.", stage: "EXP-008-A03", evidenceEventIds: [second.id] }
    ]
  });
  expect(report.assertions).toHaveLength(2);
  expect(report.failures).toHaveLength(2);
  const durable = JSON.parse(await readFile(join(root, "report.json"), "utf8"));
  expect(durable.verdict).toBe("FAIL");
  expect(durable.assertions[0].details).toEqual({ unauthorizedVisibleCount: 0 });
});

it("keeps numeric privacy counters but summarizes concrete card payloads", () => {
  const redacted = redactForEvidence({ unauthorizedVisibleCount: 0, boardCount: 5, privateCards: ["As", "Kd"] });
  expect(redacted).toEqual({ unauthorizedVisibleCount: 0, boardCount: 5, privateCards: { visible: true, cardCount: 2 } });
  expect(JSON.stringify(redacted)).not.toMatch(/As|Kd/);
});

const event = {
  id: "E-001",
  runId: "RUN-001",
  caseId: "EXP-001",
  attemptId: "A-001",
  actor: "host",
  seq: 1,
  timestamp: "2026-07-17T00:00:00.000Z",
  monotonicMs: 10,
  stage: "entrypoint",
  type: "case.started",
  status: "ok",
  details: {},
  artifactIds: []
};

const passingPlanes = {
  product: { status: "pass", summary: "Product behavior was proven." },
  harness: { status: "pass", summary: "Evidence capture was healthy." },
  environment: { status: "pass", summary: "Dependencies were healthy." }
} as const;

async function writePack(
  root: string,
  artifacts: Array<{
    id: string;
    path: string;
    description: string;
    kind?: string;
  }> = [],
  events: unknown[] = [event]
): Promise<void> {
  await writeFile(
    join(root, "case-manifest.json"),
    JSON.stringify({
      schemaVersion: "1.0",
      caseId: "EXP-001",
      objective: "Create and enter a poker room.",
      entrypoint: "The public create-room page.",
      fixture: {
        description: "A deterministic six-player room.",
        expectedFacts: ["The host enters the room."]
      },
      assertions: [
        { id: "A-001", description: "The room is visible to the host." }
      ],
      forbiddenOutcomes: ["A credential appears in evidence."],
      acceptableAlternatives: [],
      stopConditions: {
        overallTimeoutMs: 120_000,
        noProgressTimeoutMs: 3_000
      }
    })
  );
  await writeFile(join(root, "events.json"), JSON.stringify(events));
  await writeFile(
    join(root, "report.json"),
    JSON.stringify({
      schemaVersion: "1.0",
      runId: "RUN-001",
      caseId: "EXP-001",
      attemptId: "A-001",
      startedAt: "2026-07-17T00:00:00.000Z",
      finishedAt: "2026-07-17T00:00:01.000Z",
      verdict: "PASS",
      results: passingPlanes,
      assertions: [
        {
          id: "A-001",
          outcome: "pass",
          evidenceEventIds: ["E-001"],
          summary: "The room was visible."
        }
      ],
      failures: [],
      artifacts
    })
  );
}

describe("evidence contracts", () => {
  it("defines a strict root run manifest contract composed from case manifests", async () => {
    const root = await temporaryRoot();
    await writePack(root);
    const manifest = JSON.parse(
      await readFile(join(root, "case-manifest.json"), "utf8")
    );
    const runManifest = {
      schemaVersion: "1.0",
      runId: "RUN-001",
      startedAt: "2026-07-17T00:00:00.000Z",
      finishedAt: "2026-07-17T00:00:01.000Z",
      thresholds: EXPERIENCE_THRESHOLDS,
      cases: [manifest]
    };
    const schema = (
      EvidenceContracts as unknown as {
        ExperienceRunManifestSchema?: {
          parse(value: unknown): unknown;
        };
      }
    ).ExperienceRunManifestSchema;

    expect(schema).toBeTypeOf("object");
    expect(schema?.parse(runManifest)).toEqual(runManifest);
    expect(() => schema?.parse({ ...runManifest, unexpected: true })).toThrow();
    expect(() =>
      schema?.parse({
        ...runManifest,
        cases: [{ ...manifest, unexpected: true }]
      })
    ).toThrow();
    expect(() =>
      schema?.parse({ ...runManifest, cases: [manifest, manifest] })
    ).toThrow(/duplicate experience case id.*EXP-001/i);
  });

  it.each([
    "runId",
    "caseId",
    "attemptId",
    "actor",
    "timestamp",
    "monotonicMs"
  ] as const)("requires %s on every evidence event", (field) => {
    const incomplete = { ...event };
    delete incomplete[field];

    expect(EvidenceEventSchema.safeParse(incomplete).success).toBe(false);
  });

  it("exports the approved experience thresholds", () => {
    expect(EXPERIENCE_THRESHOLDS).toEqual({
      localFeedbackMs: 800,
      crossViewConvergenceMs: 1_000,
      unexplainedDeadStateMs: 3_000,
      timedPhaseToleranceMs: 400,
      handSummaryTargetMs: 2_000,
      mobileHitTargetPx: 44
    });
  });

  it("rejects unknown top-level event fields", () => {
    expect(
      EvidenceEventSchema.safeParse({ ...event, rawPrivateCards: ["AS", "KD"] })
        .success
    ).toBe(false);
  });
});

describe("EvidenceRecorder", () => {
  it("retries transient Windows rename locks without hiding non-transient failures", async () => {
    let attempts = 0;
    await renameWithTransientRetry("events.tmp", "events.json", {
      rename: async () => {
        attempts += 1;
        if (attempts < 3) {
          throw Object.assign(new Error("target is temporarily locked"), { code: "EPERM" });
        }
      },
      wait: async () => undefined
    });
    expect(attempts).toBe(3);

    const permanent = Object.assign(new Error("invalid target"), { code: "EINVAL" });
    const rename = async () => { throw permanent; };
    await expect(renameWithTransientRetry("events.tmp", "events.json", {
      rename,
      wait: async () => undefined
    })).rejects.toBe(permanent);
  });

  it("assigns monotonic sequence numbers and persists every transition", async () => {
    const root = await temporaryRoot();
    const recorder = new EvidenceRecorder({
      outputRoot: root,
      runId: "RUN-001",
      caseId: "EXP-001",
      attemptId: "A-001",
      actor: "host"
    });

    const first = await recorder.recordEvent({
      stage: "entrypoint",
      type: "case.started",
      status: "ok",
      details: {}
    });
    const persistedAfterFirst = JSON.parse(
      await readFile(join(root, "events.json"), "utf8")
    );
    const second = await recorder.recordEvent({
      stage: "room",
      type: "room.entered",
      status: "ok",
      details: {}
    });
    const persistedAfterSecond = JSON.parse(
      await readFile(join(root, "events.json"), "utf8")
    );

    expect([first.seq, second.seq]).toEqual([1, 2]);
    expect(persistedAfterFirst.map((item: { seq: number }) => item.seq)).toEqual([
      1
    ]);
    expect(persistedAfterSecond.map((item: { seq: number }) => item.seq)).toEqual([
      1, 2
    ]);
    expect(EvidenceEventSchema.parse(first)).toEqual(first);
    expect(EvidenceEventSchema.parse(second)).toEqual(second);
  });

  it("serializes concurrent telemetry event persistence into one durable timeline", async () => {
    const root = await temporaryRoot();
    const recorder = new EvidenceRecorder({
      outputRoot: root,
      runId: "RUN-001",
      caseId: "EXP-003",
      attemptId: "A-002",
      actor: "browser"
    });

    const recorded = await Promise.all(Array.from({ length: 24 }, (_, index) =>
      recorder.recordEvent({
        actor: `actor-${index % 6}`,
        stage: "browser-telemetry",
        type: "websocket-message",
        status: "observed",
        details: { index }
      })
    ));
    const persisted = JSON.parse(await readFile(join(root, "events.json"), "utf8"));

    expect(recorded.map(({ seq }) => seq)).toEqual(Array.from({ length: 24 }, (_, index) => index + 1));
    expect(persisted.map(({ seq }: { seq: number }) => seq)).toEqual(
      Array.from({ length: 24 }, (_, index) => index + 1)
    );
  });

  it("records artifacts and finishes a redacted case report", async () => {
    const root = await temporaryRoot();
    const recorder = new EvidenceRecorder({
      outputRoot: root,
      runId: "RUN-001",
      caseId: "EXP-001",
      attemptId: "A-001",
      actor: "host",
      knownSecrets: ["host-secret"]
    });
    await mkdir(join(root, "screenshots"));
    await writeFile(join(root, "screenshots", "room.png"), "image");

    await recorder.recordArtifact({
      id: "ART-001",
      path: "screenshots/room.png",
      description: "Host token host-secret is absent from the screenshot.",
      kind: "screenshot"
    });
    const report = await recorder.finishCase({
      verdict: "PASS",
      results: passingPlanes,
      assertions: [],
      failures: []
    });
    const persisted = JSON.parse(
      await readFile(join(root, "report.json"), "utf8")
    );

    expect(report.artifacts).toHaveLength(1);
    expect(JSON.stringify(report)).not.toContain("host-secret");
    expect(persisted).toEqual(report);
  });

  it("does not retain an event when its atomic write fails", async () => {
    const root = await temporaryRoot();
    const recorder = new EvidenceRecorder({
      outputRoot: root,
      runId: "RUN-001",
      caseId: "EXP-001",
      attemptId: "A-001",
      actor: "host"
    });
    await mkdir(join(root, "events.json"));

    await expect(
      recorder.recordEvent({
        stage: "entrypoint",
        type: "write.failed",
        status: "fail",
        details: {}
      })
    ).rejects.toThrow();
    await rm(join(root, "events.json"), { recursive: true });

    const recorded = await recorder.recordEvent({
      stage: "entrypoint",
      type: "write.recovered",
      status: "ok",
      details: {}
    });
    const persisted = JSON.parse(
      await readFile(join(root, "events.json"), "utf8")
    );

    expect(recorded.seq).toBe(1);
    expect(persisted).toHaveLength(1);
    expect(persisted[0].type).toBe("write.recovered");
  });

  it("does not retain an artifact when its atomic write fails", async () => {
    const root = await temporaryRoot();
    const recorder = new EvidenceRecorder({
      outputRoot: root,
      runId: "RUN-001",
      caseId: "EXP-001",
      attemptId: "A-001",
      actor: "host"
    });
    await mkdir(join(root, "artifacts.json"));

    await expect(
      recorder.recordArtifact({
        id: "ART-FAILED",
        path: "screenshots/failed.png",
        description: "This write fails."
      })
    ).rejects.toThrow();
    await rm(join(root, "artifacts.json"), { recursive: true });

    await recorder.recordArtifact({
      id: "ART-RECOVERED",
      path: "screenshots/recovered.png",
      description: "This write succeeds."
    });
    const persisted = JSON.parse(
      await readFile(join(root, "artifacts.json"), "utf8")
    );

    expect(persisted).toHaveLength(1);
    expect(persisted[0].id).toBe("ART-RECOVERED");
  });

  it("redacts known secrets from every string-bearing event field", async () => {
    const root = await temporaryRoot();
    const secret = "host-credential";
    const recorder = new EvidenceRecorder({
      outputRoot: root,
      runId: `RUN-${secret}`,
      caseId: `EXP-${secret}`,
      attemptId: `A-${secret}`,
      actor: `actor-${secret}`,
      knownSecrets: [secret]
    });

    const recorded = await recorder.recordEvent({
      actor: `override-${secret}`,
      stage: `stage-${secret}`,
      type: `type-${secret}`,
      status: `status-${secret}`,
      details: {},
      artifactIds: [`ART-${secret}`]
    });
    const persisted = await readFile(join(root, "events.json"), "utf8");

    expect(JSON.stringify(recorded)).not.toContain(secret);
    expect(persisted).not.toContain(secret);
    expect(EvidenceEventSchema.parse(recorded)).toEqual(recorded);
  });
});

describe("redactForEvidence", () => {
  it("redacts nested tokens, credentials, URL secrets, and private cards", () => {
    const redacted = redactForEvidence(
      {
        auth: {
          participantToken: "participant-secret",
          apiKey: "known-api-key"
        },
        databaseUrl:
          "postgresql://poker:database-secret@database:5432/poker?sslmode=disable",
        redisUrl: "redis://:redis-secret@redis:6379/0",
        inviteUrl:
          "https://poker.test/room/1?host=host-secret&participantToken=participant-secret&safe=kept",
        diagnostics: "request failed for known-byte-secret",
        privateCards: ["AS", "KD"]
      },
      ["known-api-key", Buffer.from("known-byte-secret")]
    );
    const serialized = JSON.stringify(redacted);

    expect(serialized).not.toContain("participant-secret");
    expect(serialized).not.toContain("known-api-key");
    expect(serialized).not.toContain("database-secret");
    expect(serialized).not.toContain("redis-secret");
    expect(serialized).not.toContain("host-secret");
    expect(serialized).not.toContain("known-byte-secret");
    expect(redacted).toMatchObject({
      databaseUrl: expect.stringContaining("database:5432/poker"),
      redisUrl: expect.stringContaining("redis:6379/0"),
      inviteUrl: expect.stringContaining("safe=kept"),
      privateCards: { visible: true, cardCount: 2 }
    });
  });

  it("handles cyclic arrays without retaining their contents", () => {
    const cyclic: unknown[] = [];
    cyclic.push(cyclic);

    expect(redactForEvidence(cyclic, [])).toEqual(["[Circular]"]);
  });

  it("derives private-card visibility and count from concrete cards", () => {
    expect(
      redactForEvidence(
        {
          privateCards: {
            visible: false,
            cardCount: 0,
            cards: ["AS", "KD"]
          }
        },
        []
      )
    ).toEqual({ privateCards: { visible: true, cardCount: 2 } });
  });

  it("counts repository-shaped private cards without retaining participant payloads", () => {
    expect(
      redactForEvidence(
        {
          holeCardsByParticipantId: {
            participantOne: ["AS", "KD"],
            participantTwo: ["QC", "QH"]
          }
        },
        []
      )
    ).toEqual({
      holeCardsByParticipantId: { visible: true, cardCount: 4 }
    });
  });

  it("summarizes private cards serialized inside string evidence", () => {
    const redacted = redactForEvidence(
      {
        responseBody: JSON.stringify({
          status: "ok",
          holeCards: ["AS", "KD"]
        })
      },
      []
    ) as { responseBody: string };

    expect(redacted.responseBody).not.toContain("AS");
    expect(redacted.responseBody).not.toContain("KD");
    expect(JSON.parse(redacted.responseBody)).toEqual({
      status: "ok",
      holeCards: { visible: true, cardCount: 2 }
    });
  });
});

describe("validateEvidencePack", () => {
  it("rejects a pack with no manifest, event stream, or report", async () => {
    const root = await temporaryRoot();

    await expect(validateEvidencePack(root, [])).rejects.toThrow(
      /missing required evidence files.*case-manifest\.json.*events\.json.*report\.json/i
    );
  });

  it("rejects duplicate core evidence files", async () => {
    const root = await temporaryRoot();
    await writePack(root);
    await mkdir(join(root, "duplicate"));
    await writeFile(
      join(root, "duplicate", "case-manifest.json"),
      await readFile(join(root, "case-manifest.json"), "utf8")
    );

    await expect(validateEvidencePack(root, [])).rejects.toThrow(
      /duplicate required evidence file.*case-manifest\.json/i
    );
  });

  it("rejects a referenced artifact that is missing", async () => {
    const root = await temporaryRoot();
    await writePack(root, [
      {
        id: "ART-404",
        path: "screenshots/missing.png",
        description: "Required checkpoint"
      }
    ]);

    await expect(validateEvidencePack(root, [])).rejects.toThrow(
      /missing artifact.*screenshots[\\/]missing\.png/i
    );
  });

  it("rejects artifact path traversal", async () => {
    const root = await temporaryRoot();
    await writePack(root, [
      {
        id: "ART-OUTSIDE",
        path: "../outside.txt",
        description: "Invalid artifact"
      }
    ]);

    await expect(validateEvidencePack(root, [])).rejects.toThrow(/path traversal/i);
  });

  it("allows an in-root artifact whose name begins with two dots", async () => {
    const root = await temporaryRoot();
    await writeFile(join(root, "..foo.txt"), "safe evidence");
    await writePack(root, [
      {
        id: "ART-SAFE",
        path: "..foo.txt",
        description: "Safe in-root artifact"
      }
    ]);

    await expect(validateEvidencePack(root, [])).resolves.toMatchObject({
      artifactCount: 1
    });
  });

  it("rejects non-monotonic event sequence numbers", async () => {
    const root = await temporaryRoot();
    await writePack(root, [], [event, { ...event, id: "E-002", seq: 1 }]);

    await expect(validateEvidencePack(root, [])).rejects.toThrow(
      /event sequence.*strictly increasing/i
    );
  });

  it("accepts sequence and monotonic resets for each case and attempt group", async () => {
    const root = await temporaryRoot();
    await writePack(root);
    const manifestPath = join(root, "case-manifest.json");
    const reportPath = join(root, "report.json");
    const eventsPath = join(root, "events.json");
    const firstManifest = JSON.parse(await readFile(manifestPath, "utf8"));
    const secondManifest = {
      ...firstManifest,
      caseId: "EXP-002",
      assertions: [
        { id: "A-002", description: "The second case is visible." }
      ]
    };
    const firstCaseReport = JSON.parse(await readFile(reportPath, "utf8"));
    const nestedCase = (
      caseId: string,
      attemptId: string,
      assertionId: string,
      eventId: string
    ) => ({
      ...firstCaseReport,
      caseId,
      attemptId,
      assertions: [
        {
          ...firstCaseReport.assertions[0],
          id: assertionId,
          evidenceEventIds: [eventId]
        }
      ]
    });

    await writeFile(
      manifestPath,
      JSON.stringify({
        schemaVersion: "1.0",
        runId: "RUN-001",
        startedAt: "2026-07-17T00:00:00.000Z",
        finishedAt: "2026-07-17T00:00:01.000Z",
        thresholds: EXPERIENCE_THRESHOLDS,
        cases: [firstManifest, secondManifest]
      })
    );
    await writeFile(
      eventsPath,
      JSON.stringify([
        event,
        {
          ...event,
          id: "E-002",
          attemptId: "A-002",
          seq: 1,
          monotonicMs: 5
        },
        {
          ...event,
          id: "E-003",
          caseId: "EXP-002",
          seq: 1,
          monotonicMs: 1
        }
      ])
    );
    await writeFile(
      reportPath,
      JSON.stringify({
        schemaVersion: "1.0",
        runId: "RUN-001",
        startedAt: "2026-07-17T00:00:00.000Z",
        finishedAt: "2026-07-17T00:00:01.000Z",
        verdict: "PASS",
        results: passingPlanes,
        thresholds: EXPERIENCE_THRESHOLDS,
        cases: [
          nestedCase("EXP-001", "A-001", "A-001", "E-001"),
          nestedCase("EXP-001", "A-002", "A-001", "E-002"),
          nestedCase("EXP-002", "A-001", "A-002", "E-003")
        ],
        resources: [],
        artifacts: []
      })
    );

    await expect(validateEvidencePack(root, [])).resolves.toMatchObject({
      artifactCount: 0
    });
  });

  it("rejects decreasing monotonic event timestamps", async () => {
    const root = await temporaryRoot();
    await writePack(root, [], [
      event,
      { ...event, id: "E-002", seq: 2, monotonicMs: 9 }
    ]);

    await expect(validateEvidencePack(root, [])).rejects.toThrow(
      /monotonic timestamp.*nondecreasing/i
    );
  });

  it("rejects duplicate event IDs", async () => {
    const root = await temporaryRoot();
    await writePack(root, [], [event, { ...event, seq: 2, monotonicMs: 11 }]);

    await expect(validateEvidencePack(root, [])).rejects.toThrow(
      /duplicate evidence event id.*E-001/i
    );
  });

  it("rejects report evidence references to unknown events", async () => {
    const root = await temporaryRoot();
    await writePack(root);
    const reportPath = join(root, "report.json");
    const report = JSON.parse(await readFile(reportPath, "utf8"));
    report.assertions[0].evidenceEventIds = ["E-404"];
    await writeFile(reportPath, JSON.stringify(report));

    await expect(validateEvidencePack(root, [])).rejects.toThrow(
      /report references unknown evidence event.*E-404/i
    );
  });

  it("rejects report evidence references from another attempt", async () => {
    const root = await temporaryRoot();
    await writePack(root);
    const reportPath = join(root, "report.json");
    const report = JSON.parse(await readFile(reportPath, "utf8"));
    report.attemptId = "A-002";
    await writeFile(reportPath, JSON.stringify(report));

    await expect(validateEvidencePack(root, [])).rejects.toThrow(
      /evidence event.*E-001.*does not match report context/i
    );
  });

  it("rejects a case report for a different manifest case", async () => {
    const root = await temporaryRoot();
    await writePack(root);
    const reportPath = join(root, "report.json");
    const report = JSON.parse(await readFile(reportPath, "utf8"));
    report.caseId = "EXP-999";
    await writeFile(reportPath, JSON.stringify(report));

    await expect(validateEvidencePack(root, [])).rejects.toThrow(
      /manifest case EXP-001 does not match report case EXP-999/i
    );
  });

  it("rejects a nested case owned by another run", async () => {
    const root = await temporaryRoot();
    await writePack(root);
    const reportPath = join(root, "report.json");
    const caseReport = JSON.parse(await readFile(reportPath, "utf8"));
    caseReport.runId = "RUN-OTHER";
    await writeFile(
      reportPath,
      JSON.stringify({
        schemaVersion: "1.0",
        runId: "RUN-001",
        startedAt: "2026-07-17T00:00:00.000Z",
        finishedAt: "2026-07-17T00:00:01.000Z",
        verdict: "PASS",
        results: passingPlanes,
        thresholds: EXPERIENCE_THRESHOLDS,
        cases: [caseReport],
        resources: [],
        artifacts: []
      })
    );

    await expect(validateEvidencePack(root, [])).rejects.toThrow(
      /nested case EXP-001 has runId RUN-OTHER.*parent runId RUN-001/i
    );
  });

  it("rejects unrelated case events from a run report", async () => {
    const root = await temporaryRoot();
    await writePack(root, [], [
      event,
      {
        ...event,
        id: "E-UNRELATED",
        caseId: "EXP-999",
        attemptId: "A-999",
        seq: 2,
        monotonicMs: 11
      }
    ]);
    const reportPath = join(root, "report.json");
    const caseReport = JSON.parse(await readFile(reportPath, "utf8"));
    await writeFile(
      reportPath,
      JSON.stringify({
        schemaVersion: "1.0",
        runId: "RUN-001",
        startedAt: "2026-07-17T00:00:00.000Z",
        finishedAt: "2026-07-17T00:00:01.000Z",
        verdict: "PASS",
        results: passingPlanes,
        thresholds: EXPERIENCE_THRESHOLDS,
        cases: [caseReport],
        resources: [],
        artifacts: []
      })
    );

    await expect(validateEvidencePack(root, [])).rejects.toThrow(
      /evidence event E-UNRELATED does not match any run report case/i
    );
  });

  it("rejects duplicate artifact IDs", async () => {
    const root = await temporaryRoot();
    await mkdir(join(root, "screenshots"));
    await writeFile(join(root, "screenshots", "one.png"), "one");
    await writeFile(join(root, "screenshots", "two.png"), "two");
    await writePack(root, [
      {
        id: "ART-DUPLICATE",
        path: "screenshots/one.png",
        description: "First"
      },
      {
        id: "ART-DUPLICATE",
        path: "screenshots/two.png",
        description: "Second"
      }
    ]);

    await expect(validateEvidencePack(root, [])).rejects.toThrow(
      /duplicate artifact id.*ART-DUPLICATE/i
    );
  });

  it("rejects a known secret in an ordinary text artifact", async () => {
    const root = await temporaryRoot();
    await mkdir(join(root, "diagnostics"));
    await writeFile(
      join(root, "diagnostics", "server.log"),
      "participant token: participant-secret"
    );
    await writePack(root);

    await expect(
      validateEvidencePack(root, ["participant-secret"])
    ).rejects.toThrow(/known secret.*diagnostics[\\/]server\.log/i);
  });

  it("scans text content even when its extension is not allow-listed", async () => {
    const root = await temporaryRoot();
    await mkdir(join(root, "diagnostics"));
    await writeFile(
      join(root, "diagnostics", "browser.har"),
      '{"url":"https://poker.test/?participantToken=participant-secret"}'
    );
    await writePack(root);

    await expect(
      validateEvidencePack(root, ["participant-secret"])
    ).rejects.toThrow(/known secret.*diagnostics[\\/]browser\.har/i);
  });

  it("rejects a known secret in NUL-prefixed evidence bytes", async () => {
    const root = await temporaryRoot();
    await mkdir(join(root, "diagnostics"));
    await writeFile(
      join(root, "diagnostics", "nul-prefixed.bin"),
      Buffer.concat([Buffer.from([0]), Buffer.from("participant-secret")])
    );
    await writePack(root);

    await expect(
      validateEvidencePack(root, ["participant-secret"])
    ).rejects.toThrow(/known secret.*diagnostics[\\/]nul-prefixed\.bin/i);
  });

  it.each([
    { query: "host", secret: "host-trace-secret" },
    { query: "participantToken", secret: "participant-trace-secret" }
  ])("rejects a known $query token in a decompressed trace entry", async ({
    query,
    secret
  }) => {
    const root = await temporaryRoot();
    await mkdir(join(root, "traces"));
    await writeFile(
      join(root, "traces", "EXP-001-host.zip"),
      zipSync({
        "trace.trace": strToU8(
          `{"url":"https://poker.test/room/1?${query}=${secret}"}`
        )
      })
    );
    await writePack(root, [
      {
        id: "ART-TRACE",
        path: "traces/EXP-001-host.zip",
        description: "Host trace",
        kind: "trace"
      }
    ]);

    await expect(validateEvidencePack(root, [secret])).rejects.toThrow(
      /known secret.*trace\.trace/i
    );
  });

  it("terminates a delayed ZIP worker when evidence validation is aborted", async () => {
    const root = await temporaryRoot();
    await mkdir(join(root, "traces"));
    await writeFile(
      join(root, "traces", "EXP-001-delayed.zip"),
      zipSync({ "trace.trace": strToU8('{"event":"room-ready"}') })
    );
    await writePack(root, [
      {
        id: "ART-DELAYED-TRACE",
        path: "traces/EXP-001-delayed.zip",
        description: "Delayed hostile trace",
        kind: "trace"
      }
    ]);
    const controller = new AbortController();
    let terminated = false;
    const startUnzip: EvidenceUnzipStarter = () => {
      queueMicrotask(() => controller.abort(new Error("ZIP evidence timeout")));
      return () => {
        terminated = true;
      };
    };

    await expect(
      validateEvidencePack(
        root,
        [],
        { signal: controller.signal, startUnzip }
      )
    ).rejects.toThrow(/ZIP evidence timeout/i);
    expect(terminated).toBe(true);
  });

  it("rejects a percent-encoded known token in a decompressed trace entry", async () => {
    const root = await temporaryRoot();
    const secret = "host/trace?secret";
    await mkdir(join(root, "traces"));
    await writeFile(
      join(root, "traces", "EXP-001-encoded.zip"),
      zipSync({
        "trace.trace": strToU8(
          `{"url":"https://poker.test/?host=${encodeURIComponent(secret)}"}`
        )
      })
    );
    await writePack(root, [
      {
        id: "ART-ENCODED-TRACE",
        path: "traces/EXP-001-encoded.zip",
        description: "Encoded trace",
        kind: "trace"
      }
    ]);

    await expect(validateEvidencePack(root, [secret])).rejects.toThrow(
      /known secret.*trace\.trace/i
    );
  });
});
