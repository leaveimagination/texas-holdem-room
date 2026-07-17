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
import {
  strFromU8,
  unzip,
  type AsyncTerminable,
  type UnzipCallback,
  type Unzipped
} from "fflate";

import {
  CaseReportSchema,
  EvidenceEventSchema,
  ExperienceCaseManifestSchema,
  ExperienceRunManifestSchema,
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

export interface EvidenceValidationOptions {
  signal?: AbortSignal;
  startUnzip?: EvidenceUnzipStarter;
}

export type EvidenceUnzipStarter = (
  data: Uint8Array,
  callback: UnzipCallback
) => AsyncTerminable;

const startDefaultUnzip: EvidenceUnzipStarter = (data, callback) =>
  unzip(data, callback);

async function unzipWithSignal(
  data: Uint8Array,
  signal: AbortSignal | undefined,
  startUnzip: EvidenceUnzipStarter
): Promise<Unzipped> {
  signal?.throwIfAborted();
  return await new Promise<Unzipped>((resolve, reject) => {
    let finished = false;
    let terminate: AsyncTerminable | undefined;
    const removeAbortListener = () => {
      signal?.removeEventListener("abort", onAbort);
    };
    const onAbort = () => {
      if (finished) {
        return;
      }
      finished = true;
      terminate?.();
      removeAbortListener();
      reject(signal?.reason ?? new Error("Evidence ZIP decompression aborted"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
    try {
      terminate = startUnzip(data, (error, entries) => {
        if (finished) {
          return;
        }
        finished = true;
        removeAbortListener();
        if (error !== null) {
          reject(error);
          return;
        }
        resolve(entries);
      });
      if (finished && signal?.aborted) {
        terminate();
      }
    } catch (error) {
      if (!finished) {
        finished = true;
        removeAbortListener();
        reject(error);
      }
    }
    if (signal?.aborted) {
      onAbort();
    }
  });
}

async function listFiles(root: string, signal?: AbortSignal): Promise<string[]> {
  const files: string[] = [];
  const visit = async (directory: string): Promise<void> => {
    signal?.throwIfAborted();
    const entries = await readdir(directory, { withFileTypes: true });
    signal?.throwIfAborted();
    for (const entry of entries) {
      signal?.throwIfAborted();
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
  let percentDecoded = content;
  for (let pass = 0; pass < 3; pass += 1) {
    const decoded = percentDecoded.replace(
      /(?:%[0-9a-f]{2})+/gi,
      (encoded) => {
        try {
          return decodeURIComponent(encoded);
        } catch {
          return encoded;
        }
      }
    );
    if (decoded === percentDecoded) {
      break;
    }
    percentDecoded = decoded;
  }

  if (
    secrets.some(
      (secret) => content.includes(secret) || percentDecoded.includes(secret)
    )
  ) {
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
  const previousByContext = new Map<string, EvidenceEvent>();
  for (const event of events) {
    const context = JSON.stringify([
      event.runId,
      event.caseId,
      event.attemptId
    ]);
    const previous = previousByContext.get(context);
    if (previous && event.seq <= previous.seq) {
      throw new Error(
        `Event sequence must be strictly increasing in ${source}`
      );
    }
    if (previous && event.monotonicMs < previous.monotonicMs) {
      throw new Error(
        `Monotonic timestamp must be nondecreasing in ${source}`
      );
    }
    previousByContext.set(context, event);
  }
}

function isOutsideRoot(relativePath: string): boolean {
  return isAbsolute(relativePath) || relativePath.split(/[\\/]+/, 1)[0] === "..";
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
  if (isOutsideRoot(fromRoot)) {
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

interface ParsedManifest {
  kind: "case" | "run";
  runId?: string;
  caseIds: string[];
}

function parseManifest(manifest: unknown): ParsedManifest {
  const caseResult = ExperienceCaseManifestSchema.safeParse(manifest);
  if (caseResult.success) {
    return {
      kind: "case",
      caseIds: [caseResult.data.caseId]
    };
  }

  const runManifest = ExperienceRunManifestSchema.parse(manifest);
  return {
    kind: "run",
    runId: runManifest.runId,
    caseIds: runManifest.cases.map(({ caseId }) => caseId)
  };
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

async function parseJson(path: string, signal?: AbortSignal): Promise<unknown> {
  try {
    return JSON.parse(
      await readFile(path, { encoding: "utf8", signal })
    );
  } catch (error) {
    throw new Error(`Invalid JSON in ${path}`, { cause: error });
  }
}

export async function validateEvidencePack(
  outputRoot: string,
  knownSecrets: readonly KnownSecret[] = [],
  options: EvidenceValidationOptions = {}
): Promise<EvidenceValidationResult> {
  const { signal, startUnzip = startDefaultUnzip } = options;
  signal?.throwIfAborted();
  const canonicalRoot = await realpath(outputRoot);
  signal?.throwIfAborted();
  const files = await listFiles(canonicalRoot, signal);
  const secrets = normalizeSecrets(knownSecrets);
  const artifacts: ArtifactRecord[] = [];
  const events: EvidenceEvent[] = [];
  let parsedManifest: ParsedManifest | undefined;
  const reports: ParsedReport[] = [];
  const reportEventReferences: ReportEventReference[] = [];
  let manifestCount = 0;
  let eventStreamCount = 0;
  let reportCount = 0;
  let textEntriesScanned = 0;

  for (const path of files) {
    signal?.throwIfAborted();
    const name = basename(path).toLowerCase();
    if (name === "case-manifest.json") {
      manifestCount += 1;
      parsedManifest = parseManifest(await parseJson(path, signal));
    } else if (name === "events.json") {
      eventStreamCount += 1;
      const parsed = EvidenceEventSchema.array().min(1).parse(
        await parseJson(path, signal)
      );
      assertMonotonicEvents(parsed, path);
      events.push(...parsed);
    } else if (name === "report.json") {
      reportCount += 1;
      const report = parseReport(await parseJson(path, signal));
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

  const manifest = parsedManifest as ParsedManifest;
  const report = reports[0];
  if (manifest.kind === "case") {
    const manifestCaseId = manifest.caseIds[0];
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
  } else {
    if (report.kind !== "run") {
      throw new Error("Root run manifest requires a run report");
    }
    if (manifest.runId !== report.runId) {
      throw new Error(
        `Manifest run ${manifest.runId} does not match report run ${report.runId}`
      );
    }
    const manifestCaseIds = new Set(manifest.caseIds);
    for (const { caseId } of report.cases) {
      if (!manifestCaseIds.has(caseId)) {
        throw new Error(`Report case ${caseId} is absent from root manifest`);
      }
    }
  }
  for (const event of events) {
    signal?.throwIfAborted();
    const matchesCase = report.cases.some(
      (caseContext) =>
        event.caseId === caseContext.caseId &&
        event.attemptId === caseContext.attemptId
    );
    const matchesReport =
      event.runId === report.runId &&
      matchesCase;
    if (!matchesReport) {
      if (report.kind === "run" && event.runId === report.runId) {
        throw new Error(
          `Evidence event ${event.id} does not match any run report case`
        );
      }
      throw new Error(
        `Evidence event ${event.id} does not match report context`
      );
    }
  }

  const artifactsById = new Map<string, ArtifactRecord>();
  for (const artifact of artifacts) {
    signal?.throwIfAborted();
    if (artifactsById.has(artifact.id)) {
      throw new Error(`Duplicate artifact ID: ${artifact.id}`);
    }
    artifactsById.set(artifact.id, artifact);
  }
  const eventsById = new Map<string, EvidenceEvent>();
  for (const event of events) {
    signal?.throwIfAborted();
    if (eventsById.has(event.id)) {
      throw new Error(`Duplicate evidence event ID: ${event.id}`);
    }
    eventsById.set(event.id, event);
  }
  for (const event of events) {
    signal?.throwIfAborted();
    for (const artifactId of event.artifactIds) {
      if (!artifactsById.has(artifactId)) {
        throw new Error(`Event references unknown artifact: ${artifactId}`);
      }
    }
  }
  for (const reference of reportEventReferences) {
    signal?.throwIfAborted();
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
    signal?.throwIfAborted();
    const artifactPath = safeArtifactPath(canonicalRoot, artifact.path);
    let stats;
    try {
      stats = await lstat(artifactPath);
      signal?.throwIfAborted();
    } catch (error) {
      throw new Error(`Missing artifact: ${artifact.path}`, { cause: error });
    }
    if (!stats.isFile()) {
      throw new Error(`Artifact is not a file: ${artifact.path}`);
    }
    const canonicalArtifact = await realpath(artifactPath);
    signal?.throwIfAborted();
    const fromRoot = relative(canonicalRoot, canonicalArtifact);
    if (isOutsideRoot(fromRoot)) {
      throw new Error(`Artifact path traversal rejected: ${artifact.path}`);
    }
  }

  for (const path of files) {
    signal?.throwIfAborted();
    if (path.toLowerCase().endsWith(".zip")) {
      let entries: Record<string, Uint8Array>;
      try {
        entries = await unzipWithSignal(
          new Uint8Array(await readFile(path, { signal })),
          signal,
          startUnzip
        );
      } catch (error) {
        if (signal?.aborted) {
          throw signal.reason ?? error;
        }
        throw new Error(`Invalid trace ZIP: ${path}`, { cause: error });
      }
      for (const [entryName, bytes] of Object.entries(entries)) {
        signal?.throwIfAborted();
        const content = strFromU8(bytes);
        assertNoKnownSecret(content, `${path}!${entryName}`, secrets);
        if (isLikelyText(bytes)) {
          textEntriesScanned += 1;
        }
      }
    } else {
      const bytes = new Uint8Array(await readFile(path, { signal }));
      const content = strFromU8(bytes);
      assertNoKnownSecret(content, path, secrets);
      if (isLikelyText(bytes)) {
        textEntriesScanned += 1;
      }
    }
  }

  return {
    filesScanned: files.length,
    textEntriesScanned,
    artifactCount: artifacts.length
  };
}
