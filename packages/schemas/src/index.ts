import { z } from "zod";

export const schemaVersion = 1 as const;
const id = z.string().min(1).max(160);
const timestamp = z.iso.datetime({ offset: true });
const version = z.literal(schemaVersion);
const extensions = z.record(
  z.string().regex(/^[a-z0-9]+(?:[.-][a-z0-9]+)+$/),
  z.unknown()
).default({});

export const taskStatusSchema = z.enum([
  "draft",
  "ready",
  "working",
  "validating",
  "review",
  "blocked",
  "needs_user",
  "quarantined",
  "done",
  "failed"
]);

export const taskSchema = z.strictObject({
  schemaVersion: version,
  id,
  title: z.string().min(1).max(500),
  status: taskStatusSchema,
  revision: z.number().int().nonnegative(),
  extensions
});

export const legacyTaskV0Schema = z.strictObject({
  id,
  summary: z.string().min(1).max(500),
  state: z.enum(["queued", "active", "complete"])
});

export function migrateTaskV0(input: unknown): Task {
  const legacy = legacyTaskV0Schema.parse(input);
  const status = {
    queued: "ready",
    active: "working",
    complete: "done"
  }[legacy.state] as Task["status"];
  return taskSchema.parse({
    schemaVersion,
    id: legacy.id,
    title: legacy.summary,
    status,
    revision: 0,
    extensions: { "studio.migration.source": "task-v0" }
  });
}

export const dependencySchema = z.strictObject({
  schemaVersion: version,
  taskId: id,
  dependsOnTaskId: id,
  requiredStatus: z.literal("done")
}).refine((value) => value.taskId !== value.dependsOnTaskId, "Self-dependency is invalid.");

export const leaseSchema = z.strictObject({
  schemaVersion: version,
  taskId: id,
  leaseId: id,
  ownerId: id,
  acquiredAt: timestamp,
  expiresAt: timestamp
}).refine((value) => Date.parse(value.expiresAt) > Date.parse(value.acquiredAt), "Lease expiry must be later.");

const callBase = {
  schemaVersion: version,
  id,
  taskId: id,
  status: z.enum(["requested", "running", "succeeded", "failed", "cancelled"]),
  idempotencyKey: id
};

export const modelCallSchema = z.strictObject({
  ...callBase,
  provider: id,
  model: id,
  privacyClass: z.enum(["public_test", "non_personal_test", "sensitive_local"]),
  verified: z.literal(false)
});

export const toolCallSchema = z.strictObject({
  ...callBase,
  tool: id,
  effect: z.enum(["read", "reversible_write", "irreversible_write"]),
  approvalId: id.nullable()
});

export const approvalSchema = z.strictObject({
  schemaVersion: version,
  id,
  taskId: id,
  actionDigest: z.string().regex(/^[a-f0-9]{64}$/),
  status: z.enum(["requested", "approved", "denied", "expired"]),
  decidedBy: id.nullable(),
  expiresAt: timestamp.nullable()
});

export const paidUseGrantSchema = z.strictObject({
  schemaVersion: version,
  authorizationId: id,
  providerConnectionId: id,
  providerId: id,
  modelId: id,
  projectId: id,
  currency: z.enum(["USD", "EUR", "GBP"]),
  maximumSpendMinor: z.number().int().positive(),
  spentMinor: z.number().int().nonnegative(),
  connectionApproved: z.literal(true),
  routeApproved: z.literal(true),
  finalConfirmationDigest: z.string().regex(/^[a-f0-9]{64}$/),
  approvedAt: z.number().int().nonnegative(),
  expiresAt: z.number().int().positive(),
  revokedAt: z.number().int().nonnegative().nullable()
}).refine(
  (value) => value.expiresAt > value.approvedAt,
  "Paid-use authorization expiry must be later than approval."
).refine(
  (value) => value.spentMinor <= value.maximumSpendMinor,
  "Recorded spend cannot exceed the hard budget."
);

export const costPolicySchema = z.strictObject({
  schemaVersion: version,
  mode: z.enum(["free_only", "paid_authorized"]),
  paidUseGrants: z.array(paidUseGrantSchema)
}).superRefine((value, context) => {
  if (value.mode === "free_only" && value.paidUseGrants.length > 0) {
    context.addIssue({
      code: "custom",
      message: "Free-only policy cannot contain paid-use grants.",
      path: ["paidUseGrants"]
    });
  }
});

export const artifactSchema = z.strictObject({
  schemaVersion: version,
  id,
  taskId: id,
  mediaType: z.string().min(1),
  digest: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  sizeBytes: z.number().int().nonnegative()
});

export const validationSchema = z.strictObject({
  schemaVersion: version,
  id,
  taskId: id,
  validator: id,
  outcome: z.enum(["passed", "failed", "skipped"]),
  evidenceArtifactIds: z.array(id)
});

export const reviewSchema = z.strictObject({
  schemaVersion: version,
  id,
  taskId: id,
  reviewer: id,
  outcome: z.enum(["approved", "changes_requested", "abstained"]),
  findingCount: z.number().int().nonnegative()
});

export const recoverySchema = z.strictObject({
  schemaVersion: version,
  id,
  taskId: id,
  cause: z.enum(["interrupted", "lease_expired", "provider", "validation", "effect_unknown"]),
  action: z.enum(["retry", "fallback", "rollback", "quarantine", "needs_user"]),
  attempt: z.number().int().positive()
});

export const operationalMetricKindSchema = z.enum([
  "throughput",
  "stage_duration",
  "queue",
  "active_leases",
  "retries",
  "provider_calls",
  "input_tokens",
  "output_tokens",
  "quota_remaining",
  "fallbacks",
  "validations",
  "reviews",
  "healing",
  "needs_user",
  "quarantined",
  "recoveries"
]);

export const operationalMetricSchema = z.strictObject({
  schemaVersion: version,
  id,
  kind: operationalMetricKindSchema,
  label: z.string().min(1).max(120),
  value: z.number().finite().nullable(),
  unit: z.enum(["tasks", "calls", "tokens", "milliseconds", "percent", "count"]),
  scope: z.strictObject({
    projectId: id,
    from: timestamp,
    to: timestamp
  }).refine(
    (value) => Date.parse(value.to) > Date.parse(value.from),
    "Metric scope end must be later than its start."
  ),
  provenance: z.strictObject({
    eventTypes: z.array(z.string().min(1).max(160)).min(1),
    observedAt: timestamp.nullable(),
    freshness: z.enum(["fresh", "stale", "missing"]),
    aggregation: z.enum(["count", "sum", "ratio", "duration", "latest"]),
    estimated: z.boolean()
  })
}).superRefine((value, context) => {
  if (value.provenance.freshness === "missing" && value.value !== null) {
    context.addIssue({
      code: "custom",
      message: "Missing metrics cannot be silently converted to zero or another value.",
      path: ["value"]
    });
  }
  if (value.provenance.freshness !== "missing" && value.provenance.observedAt === null) {
    context.addIssue({
      code: "custom",
      message: "Observed metrics require an evidence timestamp.",
      path: ["provenance", "observedAt"]
    });
  }
});

export const externalEffectSchema = z.strictObject({
  schemaVersion: version,
  id,
  taskId: id,
  connector: id,
  operation: id,
  idempotencyKey: id,
  reversibility: z.enum(["reversible", "compensatable", "irreversible"]),
  postcondition: z.enum(["unknown", "observed", "not_observed"])
});

export const providerAttemptRecordSchema = z.strictObject({
  idempotencyKey: id,
  runNumber: z.number().int().positive(),
  candidateId: id,
  providerId: id,
  modelId: id,
  status: z.enum(["started", "failed", "succeeded"]),
  startedAt: z.number().int().nonnegative(),
  finishedAt: z.number().int().nonnegative().nullable(),
  failureClass: z.string().min(1).max(160).nullable(),
  failureCode: z.string().min(1).max(160).nullable(),
  retryAt: z.number().int().nonnegative().nullable(),
  outputDigest: z.string().regex(/^sha256:[a-f0-9]{64}$/).nullable(),
  inputTokens: z.number().int().nonnegative().nullable(),
  outputTokens: z.number().int().nonnegative().nullable()
});

const providerCapacityPolicySchema = z.strictObject({
  unit: z.enum(["requests", "tokens", "neurons", "provider_reported", "unmetered"]),
  requestsPerMinute: z.number().positive().optional(),
  requestsPerDay: z.number().positive().optional(),
  tokensPerMinute: z.number().positive().optional(),
  tokensPerDay: z.number().positive().optional(),
  freeUnitsPerDay: z.number().positive().optional(),
  inputUnitsPerMillion: z.number().positive().optional(),
  outputUnitsPerMillion: z.number().positive().optional()
});

const providerCapacityUsageSchema = z.strictObject({
  requestsToday: z.number().int().nonnegative(),
  tokensToday: z.number().int().nonnegative(),
  inputTokensToday: z.number().int().nonnegative(),
  outputTokensToday: z.number().int().nonnegative(),
  freeUnitsToday: z.number().nonnegative().optional(),
  requestTimestamps: z.array(z.number().int().nonnegative()),
  tokenSamples: z.array(z.strictObject({
    at: z.number().int().nonnegative(),
    tokens: z.number().int().nonnegative()
  })),
  providerRemainingRequests: z.number().int().nonnegative().nullable().optional(),
  providerRemainingTokens: z.number().int().nonnegative().nullable().optional(),
  providerResetAt: z.number().int().nonnegative().nullable().optional()
});

export const recordedProviderCandidateSchema = z.strictObject({
  id,
  providerId: id,
  modelId: id,
  priority: z.number().finite(),
  configured: z.boolean(),
  privacy: z.enum(["training_eligible", "no_training", "zero_retention", "local"]),
  location: z.enum(["local", "external"]),
  paid: z.boolean(),
  costClass: z.enum(["free", "paid", "unknown"]).optional(),
  billingMode: z.enum(["free_tier", "billing_enabled", "unknown"]).optional(),
  providerConnectionId: id.optional(),
  projectId: id.optional(),
  estimatedCostMinor: z.number().int().nonnegative().optional(),
  lifecycle: z.enum(["active", "retiring", "retired"]).optional(),
  retiresAt: z.number().int().nonnegative().nullable().optional(),
  replacementProviderIds: z.array(id).readonly().optional(),
  roles: z.array(id),
  kinds: z.array(id),
  dataClasses: z.array(z.enum([
    "public_test",
    "non_personal_test",
    "source_code",
    "personal",
    "credential"
  ])),
  contextWindowTokens: z.number().int().positive(),
  maxOutputTokens: z.number().int().positive(),
  capacity: providerCapacityPolicySchema,
  usage: providerCapacityUsageSchema,
  circuitOpenUntil: z.number().int().nonnegative()
});

export const recordedRouteRequestSchema = z.strictObject({
  role: id,
  kind: id,
  dataClass: z.enum([
    "public_test",
    "non_personal_test",
    "source_code",
    "personal",
    "credential"
  ]),
  minimumPrivacy: z.enum(["training_eligible", "no_training", "zero_retention", "local"]),
  estimatedInputTokens: z.number().int().nonnegative(),
  requestedOutputTokens: z.number().int().positive(),
  allowPaid: z.boolean(),
  costPolicy: costPolicySchema.optional(),
  paidConfirmationDigest: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  now: z.number().int().nonnegative(),
  preferredProviderIds: z.array(id).optional(),
  avoidedProviderIds: z.array(id).optional()
});

const providerEventBase = {
  sequence: z.number().int().positive(),
  eventId: id,
  taskId: id,
  occurredAt: z.number().int().nonnegative()
};

export const providerJournalEventSchema = z.discriminatedUnion("type", [
  z.strictObject({
    ...providerEventBase,
    type: z.literal("provider.task_initialized"),
    workUnitId: id,
    requestDigest: z.string().regex(/^[a-f0-9]{64}$/)
  }),
  z.strictObject({
    ...providerEventBase,
    type: z.literal("provider.run_started"),
    runNumber: z.number().int().positive()
  }),
  z.strictObject({
    ...providerEventBase,
    type: z.literal("provider.route_recorded"),
    runNumber: z.number().int().positive(),
    request: recordedRouteRequestSchema,
    candidates: z.array(recordedProviderCandidateSchema).min(1)
  }),
  z.strictObject({
    ...providerEventBase,
    type: z.literal("provider.call_started"),
    attempt: providerAttemptRecordSchema
  }),
  z.strictObject({
    ...providerEventBase,
    type: z.literal("provider.call_failed"),
    idempotencyKey: id,
    failureClass: z.string().min(1).max(160),
    failureCode: z.string().min(1).max(160),
    retryAt: z.number().int().nonnegative().nullable()
  }),
  z.strictObject({
    ...providerEventBase,
    type: z.literal("provider.call_succeeded"),
    idempotencyKey: id,
    outputDigest: z.string().regex(/^sha256:[a-f0-9]{64}$/),
    inputTokens: z.number().int().nonnegative(),
    outputTokens: z.number().int().nonnegative()
  }),
  z.strictObject({
    ...providerEventBase,
    type: z.literal("provider.task_deferred"),
    retryAt: z.number().int().nonnegative(),
    reason: z.string().min(1).max(1_000)
  }),
  z.strictObject({
    ...providerEventBase,
    type: z.literal("provider.task_needs_user"),
    reason: z.string().min(1).max(1_000)
  })
]);

export const providerJournalDocumentSchema = z.strictObject({
  schemaVersion: version,
  taskId: id,
  workUnitId: id,
  requestDigest: z.string().regex(/^[a-f0-9]{64}$/),
  events: z.array(providerJournalEventSchema)
});

export const commandSchema = z.strictObject({
  schemaVersion: version,
  commandId: id,
  idempotencyKey: id,
  issuedAt: timestamp,
  type: z.enum(["task.create", "task.change_status", "lease.grant", "lease.release"]),
  payload: z.record(z.string(), z.unknown())
});

export const eventSchema = z.discriminatedUnion("type", [
  z.strictObject({ schemaVersion: version, sequence: z.number().int().positive(), eventId: id, occurredAt: timestamp, type: z.literal("task.created"), payload: taskSchema }),
  z.strictObject({ schemaVersion: version, sequence: z.number().int().positive(), eventId: id, occurredAt: timestamp, type: z.literal("task.status_changed"), payload: z.strictObject({ taskId: id, status: taskStatusSchema, revision: z.number().int().positive() }) }),
  z.strictObject({ schemaVersion: version, sequence: z.number().int().positive(), eventId: id, occurredAt: timestamp, type: z.literal("lease.granted"), payload: leaseSchema }),
  z.strictObject({ schemaVersion: version, sequence: z.number().int().positive(), eventId: id, occurredAt: timestamp, type: z.literal("lease.released"), payload: z.strictObject({ taskId: id, leaseId: id }) })
]);

const modelFindingSchema = z.strictObject({
  severity: z.enum(["info", "minor", "major", "critical"]),
  path: z.string().min(1).nullable(),
  message: z.string().min(1).max(2_000)
});

export const modelResultEnvelopeSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    schemaVersion: version,
    requestId: id,
    kind: z.literal("plan"),
    result: z.strictObject({
      summary: z.string().min(1).max(2_000),
      files: z.array(z.strictObject({
        path: z.string().min(1),
        reason: z.string().min(1).max(1_000)
      })).min(1),
      steps: z.array(z.string().min(1)).min(1),
      risks: z.array(z.string().min(1))
    })
  }),
  z.strictObject({
    schemaVersion: version,
    requestId: id,
    kind: z.literal("implementation"),
    result: z.strictObject({
      summary: z.string().min(1).max(2_000),
      edits: z.array(z.strictObject({
        path: z.string().min(1),
        expectedSha256: z.string().regex(/^[a-f0-9]{64}$/).nullable(),
        content: z.string()
      })).min(1),
      notes: z.array(z.string())
    })
  }),
  z.strictObject({
    schemaVersion: version,
    requestId: id,
    kind: z.literal("review"),
    result: z.strictObject({
      verdict: z.enum(["pass", "fail", "needs_user"]),
      summary: z.string().min(1).max(2_000),
      findings: z.array(modelFindingSchema)
    })
  })
]);

export const safeErrorSchema = z.strictObject({
  schemaVersion: version,
  code: z.enum(["INVALID_INPUT", "PERMISSION_DENIED", "QUOTA_EXHAUSTED", "DEPENDENCY_BLOCKED", "PROVIDER_UNAVAILABLE", "VALIDATION_FAILED", "EFFECT_UNKNOWN", "INTERNAL"]),
  owner: z.enum(["user", "project", "provider", "connector", "worker", "platform"]),
  safeMessage: z.string().min(1).max(500),
  nextAction: z.string().min(1).max(500),
  retryable: z.boolean(),
  diagnosticId: id
});

export const localDiagnosticSchema = z.strictObject({
  diagnosticId: id,
  code: safeErrorSchema.shape.code,
  owner: safeErrorSchema.shape.owner,
  safeMessage: safeErrorSchema.shape.safeMessage,
  nextAction: safeErrorSchema.shape.nextAction,
  retryable: z.boolean(),
  localDetail: z.string().max(10_000),
  cause: z.unknown().optional()
});

export const conversationReferenceSchema = z.strictObject({
  kind: z.enum(["task", "event", "artifact", "citation", "approval", "action"]),
  id,
  digest: z.string().regex(/^sha256:[a-f0-9]{64}$/).nullable()
});

export const conversationClaimSchema = z.discriminatedUnion("classification", [
  z.strictObject({
    classification: z.literal("evidence"),
    references: z.array(conversationReferenceSchema).min(1)
  }),
  z.strictObject({
    classification: z.enum(["explanation", "inference"]),
    references: z.array(conversationReferenceSchema)
  })
]);

export const intentContractSchema = z.strictObject({
  schemaVersion: version,
  intentId: id,
  sourceMessageId: id,
  outcome: z.string().min(1).max(2_000),
  targetProjectId: id,
  constraints: z.array(z.string().min(1).max(1_000)),
  acceptanceCriteria: z.array(z.string().min(1).max(1_000)),
  status: z.enum(["draft", "clarifying", "accepted", "superseded"])
});

export const citationContractSchema = z.strictObject({
  schemaVersion: version,
  citationId: id,
  sourceKind: z.enum(["url", "repository_file", "artifact", "event", "user_attachment"]),
  sourceId: id,
  locator: z.string().min(1).max(2_000),
  contentDigest: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  trust: z.enum(["user_provided", "observed", "verified"]),
  capturedAt: timestamp
});

export const conversationActionSchema = z.strictObject({
  schemaVersion: version,
  actionId: id,
  sourceMessageId: id,
  taskId: id.nullable(),
  effect: z.enum(["read", "reversible_write", "irreversible_write"]),
  status: z.enum(["proposed", "approval_required", "approved", "running", "observed", "failed", "cancelled"]),
  approvalId: id.nullable(),
  idempotencyKey: id,
  evidenceEventIds: z.array(id),
  postcondition: z.enum(["not_attempted", "unknown", "observed", "not_observed"])
}).superRefine((value, context) => {
  if (value.status === "observed" && (value.postcondition !== "observed" || value.evidenceEventIds.length === 0)) {
    context.addIssue({
      code: "custom",
      message: "Observed actions require an observed postcondition and event evidence."
    });
  }
  if (value.effect === "irreversible_write" && !value.approvalId) {
    context.addIssue({
      code: "custom",
      message: "Irreversible actions require approval.",
      path: ["approvalId"]
    });
  }
});

export const conversationArtifactReferenceSchema = z.strictObject({
  schemaVersion: version,
  artifactId: id,
  taskId: id,
  digest: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  mediaType: z.string().min(1).max(200),
  label: z.string().min(1).max(500)
});

export const conversationMessageSchema = z.strictObject({
  schemaVersion: version,
  messageId: id,
  conversationId: id,
  branchId: id,
  sequence: z.number().int().positive(),
  createdAt: timestamp,
  type: z.enum([
    "user",
    "assistant",
    "system",
    "tool",
    "question",
    "plan",
    "approval",
    "progress",
    "result",
    "error"
  ]),
  displayText: z.string().min(1).max(50_000),
  claim: conversationClaimSchema.nullable(),
  intentIds: z.array(id),
  citationIds: z.array(id),
  actionIds: z.array(id),
  artifactIds: z.array(id),
  approvalIds: z.array(id),
  taskIds: z.array(id),
  eventIds: z.array(id),
  retryOfMessageId: id.nullable(),
  redaction: z.enum(["none", "partial", "full"]),
  redactedDisplayText: z.string().min(1).max(50_000).nullable()
}).superRefine((value, context) => {
  if (
    ["assistant", "system", "tool", "plan", "approval", "progress", "result", "error"].includes(value.type) &&
    value.claim === null
  ) {
    context.addIssue({
      code: "custom",
      message: "Operational and assistant messages must classify claims as evidence, explanation, or inference.",
      path: ["claim"]
    });
  }
  if (
    ["progress", "result"].includes(value.type) &&
    value.claim?.classification !== "evidence"
  ) {
    context.addIssue({
      code: "custom",
      message: "Progress and result messages require evidence references.",
      path: ["claim"]
    });
  }
  if (value.redaction === "none" && value.redactedDisplayText !== null) {
    context.addIssue({
      code: "custom",
      message: "Unredacted messages cannot provide a substitute display.",
      path: ["redactedDisplayText"]
    });
  }
  if (value.redaction !== "none" && value.redactedDisplayText === null) {
    context.addIssue({
      code: "custom",
      message: "Redacted messages require a safe substitute display.",
      path: ["redactedDisplayText"]
    });
  }
  if (value.redaction === "full" && value.redactedDisplayText !== "[redacted]") {
    context.addIssue({
      code: "custom",
      message: "Fully redacted messages must use the canonical redaction marker.",
      path: ["redactedDisplayText"]
    });
  }
});

const conversationEventBase = {
  schemaVersion: version,
  sequence: z.number().int().positive(),
  eventId: id,
  conversationId: id,
  occurredAt: timestamp
};

export const conversationJournalEventSchema = z.discriminatedUnion("type", [
  z.strictObject({
    ...conversationEventBase,
    type: z.literal("conversation.created"),
    projectId: id,
    rootBranchId: id,
    retention: z.strictObject({
      mode: z.enum(["keep", "delete_at"]),
      deleteAt: timestamp.nullable()
    })
  }),
  z.strictObject({
    ...conversationEventBase,
    type: z.literal("conversation.branch_created"),
    branchId: id,
    parentBranchId: id,
    parentMessageId: id
  }),
  z.strictObject({
    ...conversationEventBase,
    type: z.literal("conversation.message_appended"),
    message: conversationMessageSchema
  }),
  z.strictObject({
    ...conversationEventBase,
    type: z.literal("conversation.display_edited"),
    messageId: id,
    displayText: z.string().min(1).max(50_000)
  }),
  z.strictObject({
    ...conversationEventBase,
    type: z.literal("conversation.display_deleted"),
    messageId: id,
    reason: z.enum(["user_request", "retention", "privacy_redaction"])
  })
]);

export const conversationJournalSchema = z.strictObject({
  schemaVersion: version,
  conversationId: id,
  events: z.array(conversationJournalEventSchema)
});

export function toSafeError(input: unknown): SafeError {
  const diagnostic = localDiagnosticSchema.parse(input);
  return safeErrorSchema.parse({
    schemaVersion,
    code: diagnostic.code,
    owner: diagnostic.owner,
    safeMessage: diagnostic.safeMessage,
    nextAction: diagnostic.nextAction,
    retryable: diagnostic.retryable,
    diagnosticId: diagnostic.diagnosticId
  });
}

export type Task = z.infer<typeof taskSchema>;
export type DomainEvent = z.infer<typeof eventSchema>;
export type SafeError = z.infer<typeof safeErrorSchema>;
export type OperationalMetric = z.infer<typeof operationalMetricSchema>;
export type ProviderAttemptRecord = z.infer<typeof providerAttemptRecordSchema>;
export type ProviderJournalEvent = z.infer<typeof providerJournalEventSchema>;
export type ProviderJournalDocument = z.infer<typeof providerJournalDocumentSchema>;
export type ConversationMessage = z.infer<typeof conversationMessageSchema>;
export type ConversationJournalEvent = z.infer<typeof conversationJournalEventSchema>;
export type ConversationJournal = z.infer<typeof conversationJournalSchema>;
