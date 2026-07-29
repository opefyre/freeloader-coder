import { z } from "zod";

const timestamp = z.number().int().nonnegative();
export const searchScopeSchema = z.enum(["workspace", "request", "decision", "attention", "activity", "project", "provider", "evidence", "settings"]);
export const searchQuerySchema = z.strictObject({
  query: z.string().normalize("NFKC").trim().max(80).default(""),
  scopes: z.array(searchScopeSchema).max(8).default([]),
  limit: z.number().int().min(5).max(50).default(24),
});
export const searchReferenceSchema = z.strictObject({
  surface: z.enum(["overview", "projects", "conversation", "work", "decisions", "attention", "activity", "providers", "integrations", "evidence", "help", "launch", "releases", "trust", "accessibility", "settings"]),
  path: z.string().regex(/^\/(?:projects|conversation|work|decisions|attention|activity|providers|integrations|evidence|help|launch|releases|trust|accessibility|settings)?(?:\?[a-zA-Z0-9._~!$&'()*+,;=:@%/?-]*)?$/).max(400),
  label: z.string().trim().min(1).max(80),
});
export const searchHighlightSchema = z.strictObject({
  field: z.enum(["title", "subtitle"]),
  start: z.number().int().nonnegative().max(500),
  end: z.number().int().positive().max(500),
}).refine((value) => value.end > value.start, "Highlight end must follow start.");
export const universalSearchResultSchema = z.strictObject({
  id: z.string().regex(/^search_[a-f0-9]{20}$/),
  scope: searchScopeSchema,
  title: z.string().trim().min(1).max(160),
  subtitle: z.string().trim().min(1).max(300),
  state: z.string().trim().min(1).max(80),
  score: z.number().int().min(0).max(10_000),
  matchReason: z.enum(["suggested", "exact", "prefix", "phrase", "tokens", "contains"]),
  observedAt: timestamp.nullable(),
  sourceRecordId: z.string().trim().min(1).max(160),
  highlights: z.array(searchHighlightSchema).max(8),
  reference: searchReferenceSchema,
});
const facetSchema = z.array(z.strictObject({ value: searchScopeSchema, count: z.number().int().nonnegative().max(500) })).max(8);
export const universalSearchSnapshotSchema = z.strictObject({
  schemaVersion: z.literal(1),
  provenance: z.literal("local_universal_search"),
  observedAt: timestamp,
  validForMs: z.number().int().min(1_000).max(60_000),
  automaticSpendLimitUsd: z.literal(0),
  query: searchQuerySchema,
  summary: z.strictObject({
    queryLength: z.number().int().nonnegative().max(80),
    matched: z.number().int().nonnegative().max(500),
    returned: z.number().int().nonnegative().max(50),
    truncated: z.boolean(),
    scopes: facetSchema,
  }),
  completeness: z.literal("bounded_current_state"),
  results: z.array(universalSearchResultSchema).max(50),
});

export type SearchScope = z.infer<typeof searchScopeSchema>;
export type SearchQuery = z.infer<typeof searchQuerySchema>;
export type SearchResult = z.infer<typeof universalSearchResultSchema>;
export type UniversalSearchSnapshot = z.infer<typeof universalSearchSnapshotSchema>;
