import { z } from "zod";

const NonEmptyString = z.string().trim().min(1);
const IsoTimestamp = z.string().datetime({ offset: true });

export const ExperienceThresholdsSchema = z.object({
  localFeedbackMs: z.number().positive(),
  crossViewConvergenceMs: z.number().positive(),
  unexplainedDeadStateMs: z.number().positive(),
  timedPhaseToleranceMs: z.number().nonnegative(),
  handSummaryTargetMs: z.number().positive(),
  mobileHitTargetPx: z.number().positive()
}).strict();

export type ExperienceThresholds = z.infer<typeof ExperienceThresholdsSchema>;

export const EXPERIENCE_THRESHOLDS = ExperienceThresholdsSchema.parse({
  localFeedbackMs: 800,
  crossViewConvergenceMs: 1_000,
  unexplainedDeadStateMs: 3_000,
  timedPhaseToleranceMs: 400,
  handSummaryTargetMs: 2_000,
  mobileHitTargetPx: 44
}) satisfies ExperienceThresholds;

export const ExperienceCaseManifestSchema = z.object({
  schemaVersion: NonEmptyString,
  caseId: NonEmptyString,
  objective: NonEmptyString,
  entrypoint: NonEmptyString,
  fixture: z
    .object({
      description: NonEmptyString,
      path: NonEmptyString.optional(),
      expectedFacts: z.array(NonEmptyString).min(1)
    })
    .strict(),
  assertions: z
    .array(
      z
        .object({
          id: NonEmptyString,
          description: NonEmptyString
        })
        .strict()
    )
    .min(1),
  forbiddenOutcomes: z.array(NonEmptyString).min(1),
  acceptableAlternatives: z.array(NonEmptyString),
  stopConditions: z
    .object({
      overallTimeoutMs: z.number().int().positive(),
      noProgressTimeoutMs: z.number().int().positive()
    })
    .strict()
}).strict();

export type ExperienceCaseManifest = z.infer<
  typeof ExperienceCaseManifestSchema
>;

export const ExperienceRunManifestSchema = z
  .object({
    schemaVersion: NonEmptyString,
    runId: NonEmptyString,
    startedAt: IsoTimestamp,
    finishedAt: IsoTimestamp,
    thresholds: ExperienceThresholdsSchema,
    cases: z.array(ExperienceCaseManifestSchema).min(1)
  })
  .strict()
  .superRefine((manifest, context) => {
    const seenCaseIds = new Set<string>();
    manifest.cases.forEach(({ caseId }, index) => {
      if (seenCaseIds.has(caseId)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["cases", index, "caseId"],
          message: `Duplicate experience case ID: ${caseId}`
        });
      }
      seenCaseIds.add(caseId);
    });
  });

export type ExperienceRunManifest = z.infer<
  typeof ExperienceRunManifestSchema
>;

export const EvidenceEventSchema = z.object({
  id: NonEmptyString,
  runId: NonEmptyString,
  caseId: NonEmptyString,
  attemptId: NonEmptyString,
  actor: NonEmptyString,
  seq: z.number().int().positive(),
  timestamp: IsoTimestamp,
  monotonicMs: z.number().finite().nonnegative(),
  stage: NonEmptyString,
  type: NonEmptyString,
  status: NonEmptyString,
  details: z.record(z.unknown()),
  handNumber: z.number().int().positive().optional(),
  flowSequence: z.number().int().nonnegative().optional(),
  artifactIds: z.array(NonEmptyString)
}).strict();

export type EvidenceEvent = z.infer<typeof EvidenceEventSchema>;

export const ArtifactRecordSchema = z.object({
  id: NonEmptyString,
  path: NonEmptyString,
  description: NonEmptyString,
  kind: NonEmptyString.optional(),
  mediaType: NonEmptyString.optional(),
  required: z.boolean().default(true),
  metadata: z.record(z.unknown()).optional()
}).strict();

export type ArtifactRecord = z.infer<typeof ArtifactRecordSchema>;

export const PlaneResultSchema = z.object({
  status: z.enum(["pass", "fail", "inconclusive"]),
  summary: NonEmptyString,
  evidenceEventIds: z.array(NonEmptyString).default([])
}).strict();

export type PlaneResult = z.infer<typeof PlaneResultSchema>;
export type PlaneResultInput = z.input<typeof PlaneResultSchema>;

export const OverallVerdictSchema = z.enum(["PASS", "FAIL", "INCONCLUSIVE"]);

export type OverallVerdict = z.infer<typeof OverallVerdictSchema>;

const AssertionResultSchema = z.object({
  id: NonEmptyString,
  outcome: z.enum(["pass", "fail", "inconclusive"]),
  evidenceEventIds: z.array(NonEmptyString),
  summary: NonEmptyString,
  details: z.record(z.unknown()).optional()
}).strict();

const FailureRecordSchema = z.object({
  code: NonEmptyString,
  summary: NonEmptyString,
  stage: NonEmptyString.optional(),
  evidenceEventIds: z.array(NonEmptyString).default([]),
  details: z.record(z.unknown()).optional()
}).strict();

const PlaneResultsSchema = z.object({
  product: PlaneResultSchema,
  harness: PlaneResultSchema,
  environment: PlaneResultSchema
}).strict();

export const CaseReportSchema = z.object({
  schemaVersion: NonEmptyString,
  runId: NonEmptyString,
  caseId: NonEmptyString,
  attemptId: NonEmptyString,
  startedAt: IsoTimestamp,
  finishedAt: IsoTimestamp,
  verdict: OverallVerdictSchema,
  results: PlaneResultsSchema,
  assertions: z.array(AssertionResultSchema),
  failures: z.array(FailureRecordSchema),
  artifacts: z.array(ArtifactRecordSchema)
}).strict();

export type CaseReport = z.infer<typeof CaseReportSchema>;

export const RunResourceRecordSchema = z.object({
  runId: NonEmptyString,
  resourceType: NonEmptyString,
  resourceId: NonEmptyString,
  ownerRunId: NonEmptyString,
  cleanupStatus: z.enum(["pending", "cleaned", "retained", "failed"]),
  details: z.record(z.unknown()).default({})
}).strict();

export type RunResourceRecord = z.infer<typeof RunResourceRecordSchema>;

export const RunReportSchema = z.object({
  schemaVersion: NonEmptyString,
  runId: NonEmptyString,
  startedAt: IsoTimestamp,
  finishedAt: IsoTimestamp,
  verdict: OverallVerdictSchema,
  results: PlaneResultsSchema,
  thresholds: ExperienceThresholdsSchema,
  cases: z.array(CaseReportSchema),
  resources: z.array(RunResourceRecordSchema),
  artifacts: z.array(ArtifactRecordSchema).default([])
}).strict();

export type RunReport = z.infer<typeof RunReportSchema>;
