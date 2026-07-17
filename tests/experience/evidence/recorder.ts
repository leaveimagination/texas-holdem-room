import { randomUUID } from "node:crypto";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { setTimeout as delay } from "node:timers/promises";

import {
  ArtifactRecordSchema,
  CaseReportSchema,
  EvidenceEventSchema,
  type ArtifactRecord,
  type CaseReport,
  type EvidenceEvent,
  type OverallVerdict,
  type PlaneResultInput
} from "./contracts";
import { redactForEvidence, type KnownSecret } from "./redaction";

export interface EvidenceRecorderOptions {
  outputRoot: string;
  runId: string;
  caseId: string;
  attemptId: string;
  actor: string;
  knownSecrets?: readonly KnownSecret[];
}

export interface RecordEventInput {
  actor?: string;
  timestamp?: string;
  monotonicMs?: number;
  stage: string;
  type: string;
  status: string;
  details: Record<string, unknown>;
  handNumber?: number;
  flowSequence?: number;
  artifactIds?: string[];
}

export type RecordArtifactInput = Omit<ArtifactRecord, "required"> & {
  required?: boolean;
};

export interface FinishCaseInput {
  verdict: OverallVerdict;
  results: {
    product: PlaneResultInput;
    harness: PlaneResultInput;
    environment: PlaneResultInput;
  };
  assertions: CaseReport["assertions"];
  failures: CaseReport["failures"];
}

interface TransientRenameRetryOptions {
  rename?: typeof rename;
  wait?: (milliseconds: number) => Promise<unknown>;
  maxAttempts?: number;
}

export async function renameWithTransientRetry(
  source: string,
  target: string,
  options: TransientRenameRetryOptions = {}
): Promise<void> {
  const renameFile = options.rename ?? rename;
  const wait = options.wait ?? delay;
  const maxAttempts = options.maxAttempts ?? 5;
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1) {
    throw new Error("Transient rename retry requires at least one attempt");
  }

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      await renameFile(source, target);
      return;
    } catch (error) {
      if (!isTransientRenameError(error) || attempt === maxAttempts) throw error;
      await wait(10 * 2 ** (attempt - 1));
    }
  }
}

function isTransientRenameError(error: unknown): boolean {
  const code = typeof error === "object" && error !== null && "code" in error
    ? (error as { code?: unknown }).code
    : undefined;
  return code === "EPERM" || code === "EACCES" || code === "EBUSY";
}

async function atomicWriteJson(path: string, value: unknown): Promise<void> {
  const temporaryPath = `${path}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  try {
    await renameWithTransientRetry(temporaryPath, path);
  } catch (error) {
    await rm(temporaryPath, { force: true });
    throw error;
  }
}

export class EvidenceRecorder {
  private readonly events: EvidenceEvent[] = [];
  private readonly artifacts: ArtifactRecord[] = [];
  private readonly startedAt = new Date().toISOString();
  private operation = Promise.resolve();

  constructor(private readonly options: EvidenceRecorderOptions) {}

  recordEvent(input: RecordEventInput): Promise<EvidenceEvent> {
    return this.enqueue(async () => {
      await mkdir(this.options.outputRoot, { recursive: true });
      const seq = this.events.length + 1;
      const event = EvidenceEventSchema.parse(
        redactForEvidence(
          {
            id: `${this.options.caseId}-${this.options.attemptId}-E-${String(seq).padStart(6, "0")}`,
            runId: this.options.runId,
            caseId: this.options.caseId,
            attemptId: this.options.attemptId,
            actor: input.actor ?? this.options.actor,
            seq,
            timestamp: input.timestamp ?? new Date().toISOString(),
            monotonicMs: input.monotonicMs ?? performance.now(),
            stage: input.stage,
            type: input.type,
            status: input.status,
            details: input.details,
            handNumber: input.handNumber,
            flowSequence: input.flowSequence,
            artifactIds: input.artifactIds ?? []
          },
          this.options.knownSecrets
        )
      );
      const events = [...this.events, event];
      await atomicWriteJson(join(this.options.outputRoot, "events.json"), events);
      this.events.push(event);
      return event;
    });
  }

  recordArtifact(input: RecordArtifactInput): Promise<ArtifactRecord> {
    return this.enqueue(async () => {
      await mkdir(this.options.outputRoot, { recursive: true });
      const artifact = ArtifactRecordSchema.parse(
        redactForEvidence(input, this.options.knownSecrets)
      );
      const artifacts = [...this.artifacts, artifact];
      await atomicWriteJson(
        join(this.options.outputRoot, "artifacts.json"),
        artifacts
      );
      this.artifacts.push(artifact);
      return artifact;
    });
  }

  finishCase(input: FinishCaseInput): Promise<CaseReport> {
    return this.enqueue(async () => {
      await mkdir(this.options.outputRoot, { recursive: true });
      const report = CaseReportSchema.parse(
        redactForEvidence(
          {
            schemaVersion: "1.0",
            runId: this.options.runId,
            caseId: this.options.caseId,
            attemptId: this.options.attemptId,
            startedAt: this.startedAt,
            finishedAt: new Date().toISOString(),
            verdict: input.verdict,
            results: input.results,
            assertions: input.assertions,
            failures: input.failures,
            artifacts: this.artifacts
          },
          this.options.knownSecrets
        )
      );

      await atomicWriteJson(join(this.options.outputRoot, "events.json"), this.events);
      await atomicWriteJson(
        join(this.options.outputRoot, "artifacts.json"),
        this.artifacts
      );
      await atomicWriteJson(join(this.options.outputRoot, "report.json"), report);
      return report;
    });
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.operation.then(operation, operation);
    this.operation = result.then(
      () => undefined,
      () => undefined
    );
    return result;
  }
}
