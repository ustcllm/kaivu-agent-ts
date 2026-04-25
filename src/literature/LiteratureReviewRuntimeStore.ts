import { makeId } from "../shared/ids.js";
import type { PaperSource } from "../agent/specialists/literature/PaperSource.js";

export interface CitationRecord {
  key: string;
  title: string;
  doi?: string;
  url?: string;
  authors: string[];
  publishedAt?: string;
  sourceType: string;
  abstract?: string;
}

export interface LiteratureRuntimePage {
  id: string;
  title: string;
  summary: string;
  sourceIds: string[];
  tags: string[];
  updatedAt: string;
}

export type LiteratureQualityGrade = "high" | "moderate" | "low" | "unclear";
export type LiteratureBiasRisk = "low" | "moderate" | "high" | "unclear";
export type LiteratureEvidenceDirection = "supports" | "contradicts" | "contextual" | "mixed" | "unknown";

export interface LiteratureClaimRecord {
  id: string;
  claim: string;
  sourceIds: string[];
  query?: string;
  evidenceDirection: LiteratureEvidenceDirection;
  qualityGrade: LiteratureQualityGrade;
  biasRisk: LiteratureBiasRisk;
  conflictGroup?: string;
  notes?: string;
  createdAt: string;
}

export interface LiteratureConflictGroup {
  id: string;
  topic: string;
  claimIds: string[];
  directions: LiteratureEvidenceDirection[];
  status: "none" | "mapped" | "unresolved" | "adjudication_needed";
  attribution: string;
  updatedAt: string;
}

export interface LiteratureReviewSynthesisInput {
  topic: string;
  summaryMarkdown: string;
  queries: Array<{ query: string; purpose?: string; language?: string; disciplineScope?: string }>;
  retrievedSources: Array<{
    query: string;
    purpose?: string;
    disciplineScope?: string;
    tool: string;
    status: string;
    results: Array<{
      id?: string;
      title: string;
      link?: string;
      summary?: string;
      authors?: string[];
      publishedAt?: string;
      sourceType?: string;
    }>;
  }>;
  evidenceGaps?: string[];
  structuredExtraction?: LiteratureStructuredExtraction;
  createdBy?: string;
}

export interface LiteratureStructuredExtraction {
  claims: Array<{
    claim: string;
    sourceIds?: string[];
    query?: string;
    evidenceDirection?: LiteratureEvidenceDirection;
    qualityGrade?: LiteratureQualityGrade;
    biasRisk?: LiteratureBiasRisk;
    conflictGroup?: string;
    notes?: string;
  }>;
  conflictGroups?: Array<{
    topic: string;
    claimTexts?: string[];
    status?: LiteratureConflictGroup["status"];
    attribution?: string;
  }>;
  evidenceGaps?: string[];
  screeningNotes?: string[];
}

export interface LiteratureReviewSynthesisRecord {
  id: string;
  topic: string;
  summaryMarkdown: string;
  queryCount: number;
  sourceCount: number;
  claimIds: string[];
  conflictGroupIds: string[];
  evidenceGaps: string[];
  createdBy: string;
  createdAt: string;
}

/**
 * Runtime working state for literature review execution.
 *
 * Intended role:
 * - keep citation and retrieval-side structured records available to agents
 * - store review-time pages, claims, conflict groups, and synthesized review records
 * - support execution-time lookup and orchestration during literature review
 *
 * Not the long-term source of truth for the persistent literature wiki.
 * Not responsible for persistent paper-digest assets; those live in PaperDigests.
 * Paper pages, claim pages, topic synthesis pages, and other compiled wiki
 * knowledge should progressively live in the literature wiki file layer.
 */
export class LiteratureReviewRuntimeStore {
  private readonly citations = new Map<string, CitationRecord>();
  private readonly pages = new Map<string, LiteratureRuntimePage>();
  private readonly claims: LiteratureClaimRecord[] = [];
  private readonly conflictGroups = new Map<string, LiteratureConflictGroup>();
  private readonly reviewSyntheses: LiteratureReviewSynthesisRecord[] = [];
  private readonly log: Array<{ timestamp: string; action: string; targetId: string; detail: string }> = [];

  recordReviewSynthesis(input: LiteratureReviewSynthesisInput): LiteratureReviewSynthesisRecord {
    const now = new Date().toISOString();
    const normalizedSources = input.retrievedSources.flatMap((batch) =>
      batch.results.map((result) => {
        const source: PaperSource = {
          id: result.id ?? result.link ?? `${batch.tool}:${result.title}`,
          title: result.title,
          sourceType: toPaperSourceType(result.sourceType ?? batch.tool),
          content: result.summary ?? "",
          url: result.link ?? result.id,
          authors: result.authors,
          publishedAt: result.publishedAt,
          metadata: {
            query: batch.query,
            purpose: batch.purpose,
            disciplineScope: batch.disciplineScope,
            tool: batch.tool,
            retrievalStatus: batch.status,
          },
        };
        const citation = toCitationRecord(source);
        this.citations.set(citation.key, citation);
        this.upsertRetrievedSourcePage(source, batch.query, batch.tool, now);
        return { source, batch };
      }),
    );
    const sourceIds = normalizedSources.map((item) => item.source.id);
    const claimIds = input.structuredExtraction
      ? this.recordStructuredClaims(input, sourceIds, now)
      : this.deriveClaimsFromSynthesis(input, sourceIds, now);
    const conflictGroupIds = this.rebuildConflictGroups(now, input.structuredExtraction);
    const record: LiteratureReviewSynthesisRecord = {
      id: makeId("literature-review"),
      topic: input.topic,
      summaryMarkdown: input.summaryMarkdown,
      queryCount: input.queries.length,
      sourceCount: normalizedSources.length,
      claimIds,
      conflictGroupIds,
      evidenceGaps: input.structuredExtraction?.evidenceGaps?.length
        ? input.structuredExtraction.evidenceGaps
        : input.evidenceGaps ?? inferEvidenceGaps(input.summaryMarkdown),
      createdBy: input.createdBy ?? "literature_review_agent",
      createdAt: now,
    };
    this.reviewSyntheses.push(record);
    this.upsertSynthesisPage(record, input);
    this.appendLog("review_synthesis_recorded", record.id, `${record.topic}; claims=${claimIds.length}; sources=${record.sourceCount}`);
    return record;
  }

  search(query: string, limit = 6): LiteratureRuntimePage[] {
    const terms = query.toLowerCase().split(/[^a-z0-9\u4e00-\u9fff]+/u).filter(Boolean);
    return [...this.pages.values()]
      .map((page) => {
        const haystack = `${page.title} ${page.summary} ${page.tags.join(" ")}`.toLowerCase();
        const score = terms.reduce((count, term) => count + (haystack.includes(term) ? 1 : 0), 0);
        return { page, score };
      })
      .filter((item) => item.score > 0 || terms.length === 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map((item) => item.page);
  }

  renderIndex(): string {
    const lines = ["# Literature Wiki Index", ""];
    for (const page of this.pages.values()) {
      lines.push(`- ${page.title} (${page.id}) - ${page.summary}`);
    }
    return lines.join("\n");
  }

  renderClaimTable(): string {
    const lines = [
      "# Literature Claim Table",
      "",
      "| Claim | Direction | Quality | Bias Risk | Sources | Conflict Group |",
      "| --- | --- | --- | --- | --- | --- |",
    ];
    for (const claim of this.claims) {
      lines.push(`| ${escapeTable(claim.claim)} | ${claim.evidenceDirection} | ${claim.qualityGrade} | ${claim.biasRisk} | ${claim.sourceIds.length} | ${claim.conflictGroup ?? ""} |`);
    }
    return lines.join("\n");
  }

  renderConflictMap(): string {
    const lines = ["# Literature Conflict Map", ""];
    if (this.conflictGroups.size === 0) {
      lines.push("No conflicts mapped yet.");
      return lines.join("\n");
    }
    for (const group of this.conflictGroups.values()) {
      lines.push(
        `## ${group.topic}`,
        `- Status: ${group.status}`,
        `- Directions: ${group.directions.join(", ") || "unknown"}`,
        `- Claims: ${group.claimIds.length}`,
        `- Attribution: ${group.attribution}`,
        "",
      );
    }
    return lines.join("\n").trim();
  }

  renderLog(): string {
    return this.log
      .map((entry) => `## [${entry.timestamp}] ${entry.action} | ${entry.targetId}\n${entry.detail}`)
      .join("\n\n");
  }

  citationLibrary(): CitationRecord[] {
    return [...this.citations.values()];
  }

  claimSnapshot(): LiteratureClaimRecord[] {
    return this.claims.map((claim) => ({ ...claim, sourceIds: [...claim.sourceIds] }));
  }

  conflictSnapshot(): LiteratureConflictGroup[] {
    return [...this.conflictGroups.values()].map((group) => ({
      ...group,
      claimIds: [...group.claimIds],
      directions: [...group.directions],
    }));
  }

  reviewSynthesisSnapshot(): LiteratureReviewSynthesisRecord[] {
    return this.reviewSyntheses.map((record) => ({
      ...record,
      claimIds: [...record.claimIds],
      conflictGroupIds: [...record.conflictGroupIds],
      evidenceGaps: [...record.evidenceGaps],
    }));
  }

  private upsertRetrievedSourcePage(source: PaperSource, query: string, tool: string, now: string): LiteratureRuntimePage {
    const pageId = `source:${source.id}`;
    const existing = this.pages.get(pageId);
    const page: LiteratureRuntimePage = {
      id: pageId,
      title: source.title,
      summary: summarizeSource(source),
      sourceIds: [...new Set([...(existing?.sourceIds ?? []), source.id])],
      tags: [...new Set([...(existing?.tags ?? []), "source", source.sourceType, tool, "retrieved-literature"])],
      updatedAt: now,
    };
    this.pages.set(pageId, page);
    this.appendLog("retrieved_source_indexed", pageId, `${source.title}; query=${query}; tool=${tool}`);
    return page;
  }

  private upsertSynthesisPage(record: LiteratureReviewSynthesisRecord, input: LiteratureReviewSynthesisInput): void {
    const pageId = `review:${record.id}`;
    this.pages.set(pageId, {
      id: pageId,
      title: `Review synthesis: ${record.topic}`,
      summary: firstMarkdownParagraph(input.summaryMarkdown).slice(0, 500) || `${record.sourceCount} sources; ${record.claimIds.length} claims; ${record.evidenceGaps.length} gaps.`,
      sourceIds: [...new Set(input.retrievedSources.flatMap((batch) => batch.results.map((item) => item.id ?? item.link ?? item.title)))],
      tags: ["review", "synthesis", "claim-table", "conflict-map"],
      updatedAt: record.createdAt,
    });
  }

  private deriveClaimsFromSynthesis(input: LiteratureReviewSynthesisInput, sourceIds: string[], now: string): string[] {
    const candidates = extractClaimCandidates(input.summaryMarkdown);
    const claimIds: string[] = [];
    for (const candidate of candidates.slice(0, 12)) {
      const existing = this.claims.find((claim) => normalizeText(claim.claim) === normalizeText(candidate));
      if (existing) {
        existing.sourceIds = [...new Set([...existing.sourceIds, ...sourceIds])];
        claimIds.push(existing.id);
        continue;
      }
      const claim: LiteratureClaimRecord = {
        id: makeId("literature-claim"),
        claim: candidate,
        sourceIds,
        query: input.queries.map((item) => item.query).join(" | "),
        evidenceDirection: inferEvidenceDirection(candidate),
        qualityGrade: inferQualityGrade(sourceIds, input.summaryMarkdown),
        biasRisk: inferBiasRisk(candidate),
        conflictGroup: inferConflictTopic(candidate),
        notes: "Auto-derived from literature review synthesis; needs structured extraction for decision-grade use.",
        createdAt: now,
      };
      this.claims.push(claim);
      claimIds.push(claim.id);
    }
    return claimIds;
  }

  private recordStructuredClaims(input: LiteratureReviewSynthesisInput, defaultSourceIds: string[], now: string): string[] {
    const claimIds: string[] = [];
    for (const item of input.structuredExtraction?.claims ?? []) {
      const claimText = item.claim.trim();
      if (!claimText) continue;
      const existing = this.claims.find((claim) => normalizeText(claim.claim) === normalizeText(claimText));
      const sourceIds = item.sourceIds?.length ? item.sourceIds : defaultSourceIds;
      if (existing) {
        existing.sourceIds = [...new Set([...existing.sourceIds, ...sourceIds])];
        existing.evidenceDirection = normalizeEvidenceDirection(item.evidenceDirection) ?? existing.evidenceDirection;
        existing.qualityGrade = normalizeQualityGrade(item.qualityGrade) ?? existing.qualityGrade;
        existing.biasRisk = normalizeBiasRisk(item.biasRisk) ?? existing.biasRisk;
        existing.conflictGroup = item.conflictGroup || existing.conflictGroup;
        existing.notes = item.notes || existing.notes;
        claimIds.push(existing.id);
        continue;
      }
      const claim: LiteratureClaimRecord = {
        id: makeId("literature-claim"),
        claim: claimText,
        sourceIds,
        query: item.query || input.queries.map((query) => query.query).join(" | "),
        evidenceDirection: normalizeEvidenceDirection(item.evidenceDirection) ?? "unknown",
        qualityGrade: normalizeQualityGrade(item.qualityGrade) ?? "unclear",
        biasRisk: normalizeBiasRisk(item.biasRisk) ?? "unclear",
        conflictGroup: item.conflictGroup || inferConflictTopic(claimText),
        notes: item.notes || "LLM-structured literature extraction; verify before decision-grade use.",
        createdAt: now,
      };
      this.claims.push(claim);
      claimIds.push(claim.id);
    }
    if (claimIds.length === 0) {
      return this.deriveClaimsFromSynthesis(input, defaultSourceIds, now);
    }
    return claimIds;
  }

  private rebuildConflictGroups(now: string, extraction?: LiteratureStructuredExtraction): string[] {
    this.conflictGroups.clear();
    const byTopic = new Map<string, LiteratureClaimRecord[]>();
    for (const claim of this.claims) {
      const topic = claim.conflictGroup || "general";
      const existing = byTopic.get(topic) ?? [];
      existing.push(claim);
      byTopic.set(topic, existing);
    }
    for (const [topic, claims] of byTopic) {
      const directions = [...new Set(claims.map((claim) => claim.evidenceDirection))];
      const hasDirectionalConflict = directions.includes("supports") && directions.some((direction) => direction === "contradicts" || direction === "mixed");
      const hasUncertainty = claims.some((claim) => /conflict|contradict|inconsistent|mixed|uncertain|caveat/i.test(claim.claim));
      const status: LiteratureConflictGroup["status"] = hasDirectionalConflict
        ? "adjudication_needed"
        : hasUncertainty
          ? "unresolved"
          : claims.length > 1
            ? "mapped"
            : "none";
      const group: LiteratureConflictGroup = {
        id: `conflict:${slug(topic)}`,
        topic,
        claimIds: claims.map((claim) => claim.id),
        directions,
        status,
        attribution: status === "none"
          ? "No explicit disagreement detected yet."
          : "Conflict attribution is provisional and should be checked against source methods, benchmarks, and evidence quality.",
        updatedAt: now,
      };
      this.conflictGroups.set(group.id, group);
    }
    for (const structured of extraction?.conflictGroups ?? []) {
      const topic = structured.topic.trim();
      if (!topic) continue;
      const claimIds = (structured.claimTexts ?? [])
        .map((claimText) => this.claims.find((claim) => normalizeText(claim.claim) === normalizeText(claimText))?.id)
        .filter((id): id is string => Boolean(id));
      const fallbackClaims = this.claims.filter((claim) => normalizeText(claim.conflictGroup ?? "") === normalizeText(topic));
      const resolvedClaimIds = claimIds.length ? claimIds : fallbackClaims.map((claim) => claim.id);
      const directions = [...new Set(this.claims.filter((claim) => resolvedClaimIds.includes(claim.id)).map((claim) => claim.evidenceDirection))];
      const group: LiteratureConflictGroup = {
        id: `conflict:${slug(topic)}`,
        topic,
        claimIds: resolvedClaimIds,
        directions,
        status: normalizeConflictStatus(structured.status) ?? "mapped",
        attribution: structured.attribution || "LLM-structured conflict attribution; verify source methods before decision use.",
        updatedAt: now,
      };
      this.conflictGroups.set(group.id, group);
    }
    return [...this.conflictGroups.keys()];
  }

  private appendLog(action: string, targetId: string, detail: string): void {
    this.log.push({
      timestamp: new Date().toISOString(),
      action,
      targetId,
      detail,
    });
  }
}

function toCitationRecord(source: PaperSource): CitationRecord {
  const normalizedDoi = source.doi?.trim().toLowerCase();
  const key = normalizedDoi ? `doi:${normalizedDoi}` : source.url ? `url:${source.url.toLowerCase()}` : `title:${source.title.toLowerCase()}`;
  return {
    key,
    title: source.title,
    doi: normalizedDoi,
    url: source.url,
    authors: source.authors ?? [],
    publishedAt: source.publishedAt,
    sourceType: source.sourceType,
    abstract: source.content.slice(0, 1000),
  };
}

function summarizeSource(source: PaperSource): string {
  const clipped = source.content.trim().replace(/\s+/g, " ").slice(0, 260);
  return clipped || `${source.sourceType} source awaiting digest`;
}

function toPaperSourceType(value: string): PaperSource["sourceType"] {
  const normalized = value.toLowerCase();
  if (normalized.includes("arxiv")) return "preprint";
  if (normalized.includes("crossref") || normalized.includes("paper")) return "paper";
  if (normalized.includes("pubmed")) return "paper";
  if (["paper", "preprint", "article", "web", "dataset", "report", "unknown"].includes(normalized)) {
    return normalized as PaperSource["sourceType"];
  }
  return "unknown";
}

function extractClaimCandidates(markdown: string): string[] {
  const lines = markdown
    .split(/\r?\n/)
    .map((line) => line.replace(/^[-*]\s+/, "").replace(/^\d+\.\s+/, "").trim())
    .filter((line) => line.length >= 40 && !line.startsWith("#") && !line.startsWith("|"));
  const prioritized = lines.filter((line) => /claim|find|show|suggest|indicat|evidence|conflict|gap|benchmark|method|result/i.test(line));
  return [...new Set([...(prioritized.length ? prioritized : lines)].map((line) => line.slice(0, 500)))];
}

function inferEvidenceDirection(text: string): LiteratureEvidenceDirection {
  if (/contradict|against|fails? to|not support|negative|null result/i.test(text)) return "contradicts";
  if (/mixed|conflict|inconsistent|uncertain|caveat/i.test(text)) return "mixed";
  if (/support|show|suggest|indicate|improve|evidence|consistent/i.test(text)) return "supports";
  return "contextual";
}

function normalizeEvidenceDirection(value: unknown): LiteratureEvidenceDirection | undefined {
  return ["supports", "contradicts", "contextual", "mixed", "unknown"].includes(String(value))
    ? String(value) as LiteratureEvidenceDirection
    : undefined;
}

function normalizeQualityGrade(value: unknown): LiteratureQualityGrade | undefined {
  return ["high", "moderate", "low", "unclear"].includes(String(value))
    ? String(value) as LiteratureQualityGrade
    : undefined;
}

function normalizeBiasRisk(value: unknown): LiteratureBiasRisk | undefined {
  return ["low", "moderate", "high", "unclear"].includes(String(value))
    ? String(value) as LiteratureBiasRisk
    : undefined;
}

function normalizeConflictStatus(value: unknown): LiteratureConflictGroup["status"] | undefined {
  return ["none", "mapped", "unresolved", "adjudication_needed"].includes(String(value))
    ? String(value) as LiteratureConflictGroup["status"]
    : undefined;
}

function inferQualityGrade(sourceIds: string[], text: string): LiteratureQualityGrade {
  if (/replicat|meta-analysis|systematic|benchmark suite|multiple studies/i.test(text)) return "high";
  if (sourceIds.length >= 3) return "moderate";
  if (/anecdotal|blog|unclear|weak/i.test(text)) return "low";
  return "unclear";
}

function inferBiasRisk(text: string): LiteratureBiasRisk {
  if (/leakage|selection bias|confound|high bias|uncontrolled|cherry-pick/i.test(text)) return "high";
  if (/small sample|single seed|limited|unclear|preliminary/i.test(text)) return "moderate";
  if (/replicat|controlled|ablation|calibrated/i.test(text)) return "low";
  return "unclear";
}

function inferConflictTopic(text: string): string {
  const lower = text.toLowerCase();
  if (lower.includes("benchmark")) return "benchmark validity";
  if (lower.includes("mechanism")) return "mechanism";
  if (lower.includes("dataset") || lower.includes("data")) return "data evidence";
  if (lower.includes("method") || lower.includes("model")) return "method comparison";
  if (lower.includes("conflict") || lower.includes("contradict")) return "explicit disagreement";
  return "general";
}

function inferEvidenceGaps(markdown: string): string[] {
  const lines = markdown.split(/\r?\n/).map((line) => line.replace(/^[-*]\s+/, "").trim());
  return lines
    .filter((line) => /gap|missing|unclear|unknown|future|need/i.test(line))
    .map((line) => line.slice(0, 300))
    .slice(0, 10);
}

function firstMarkdownParagraph(markdown: string): string {
  for (const block of markdown.split(/\n\s*\n/)) {
    const text = block.trim();
    if (text && !text.startsWith("#") && !text.startsWith("|")) return text.replace(/\s+/g, " ");
  }
  return "";
}

function normalizeText(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}

function slug(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/gu, "-").replace(/^-|-$/g, "") || "general";
}

function escapeTable(value: string): string {
  return value.replaceAll("|", "\\|").replace(/\s+/g, " ").trim();
}

function normalizeLocator(value: string): string {
  return value.trim().toLowerCase();
}
