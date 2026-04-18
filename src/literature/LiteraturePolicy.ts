import type { ConfidenceLevel, MemoryScope } from "../shared/MemoryTypes.js";

export type LiteratureIngestMode = "auto" | "autonomous" | "guided" | "review_gated";
export type LiteratureWriteTarget = "raw_source" | "digest_draft" | "ingest_proposal";
export type LiteratureSourceType = "paper" | "preprint" | "article" | "web" | "dataset" | "report" | "unknown";

export interface LiteratureSource {
  id: string;
  title: string;
  sourceType: LiteratureSourceType;
  content: string;
  url?: string;
  doi?: string;
  authors?: string[];
  publishedAt?: string;
  metadata?: Record<string, unknown>;
}

export interface LiteratureIngestRequest {
  mode?: LiteratureIngestMode;
  source: LiteratureSource;
  targetScope?: MemoryScope;
  confidence?: ConfidenceLevel;
  hasHighImpactClaim?: boolean;
  hasConflict?: boolean;
  actorRole?: "owner" | "member" | "curator" | "admin" | "guest";
  researchMode?: "interactive" | "autonomous";
}

export interface LiteratureIngestPolicy {
  mode: Exclude<LiteratureIngestMode, "auto">;
  targetScope: MemoryScope;
  writeTarget: LiteratureWriteTarget;
  requiresConfirmation: boolean;
  needsReview: boolean;
  reasons: string[];
}

export function decideLiteratureIngestPolicy(request: LiteratureIngestRequest): LiteratureIngestPolicy {
  const targetScope = request.targetScope ?? "project";
  const actorRole = request.actorRole ?? "member";
  const reasons: string[] = [];
  let mode: Exclude<LiteratureIngestMode, "auto"> =
    request.mode && request.mode !== "auto" ? request.mode : request.researchMode === "interactive" ? "guided" : "autonomous";

  if ((targetScope === "group" || targetScope === "public") && actorRole !== "curator" && actorRole !== "admin") {
    mode = "review_gated";
    reasons.push("shared group/public literature requires curator or admin review");
  }

  if (request.hasHighImpactClaim || request.hasConflict || request.confidence === "low" || request.confidence === "uncertain") {
    mode = mode === "autonomous" ? "guided" : "review_gated";
    reasons.push("high-impact, conflicting, or low-confidence literature should not be silently committed");
  }

  if ((request.source.sourceType === "web" || request.source.sourceType === "article") && request.confidence !== "high") {
    reasons.push("non-scholarly or weakly validated source should become a digest or proposal first");
    if (mode === "autonomous") mode = "guided";
  }

  const writeTarget: LiteratureWriteTarget =
    mode === "autonomous" ? "raw_source" : mode === "guided" ? "digest_draft" : "ingest_proposal";

  return {
    mode,
    targetScope,
    writeTarget,
    requiresConfirmation: mode !== "autonomous",
    needsReview: mode !== "autonomous" || targetScope === "group" || targetScope === "public",
    reasons: reasons.length > 0 ? reasons : ["default literature ingest policy"],
  };
}

export function renderLiteratureDigest(request: LiteratureIngestRequest, policy: LiteratureIngestPolicy): string {
  const source = request.source;
  const authors = source.authors?.length ? source.authors.join(", ") : "unknown";
  const identifiers = [
    source.doi ? `DOI: ${source.doi}` : "",
    source.url ? `URL: ${source.url}` : "",
  ].filter(Boolean);
  const excerpt = source.content.trim().slice(0, 1200);

  return [
    `# Literature Digest: ${source.title}`,
    "",
    "## Source",
    `- Type: ${source.sourceType}`,
    `- Authors: ${authors}`,
    source.publishedAt ? `- Published: ${source.publishedAt}` : "",
    ...identifiers.map((item) => `- ${item}`),
    "",
    "## Ingest Policy",
    `- Mode: ${policy.mode}`,
    `- Target scope: ${policy.targetScope}`,
    `- Write target: ${policy.writeTarget}`,
    `- Requires confirmation: ${String(policy.requiresConfirmation)}`,
    `- Needs review: ${String(policy.needsReview)}`,
    `- Reasons: ${policy.reasons.join("; ")}`,
    "",
    "## Digest",
    excerpt || "No source excerpt available yet.",
    "",
    "## Curator Checklist",
    "- Are the main claims traceable to this source?",
    "- Are conflicts with existing literature or memory recorded?",
    "- Is the evidence quality sufficient for the target scope?",
  ]
    .filter(Boolean)
    .join("\n");
}
