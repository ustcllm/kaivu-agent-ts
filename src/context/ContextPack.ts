import type { LiteratureReviewRuntimeStore } from "../literature/LiteratureReviewRuntimeStore.js";
import type { SciMemory } from "../memory/SciMemory.js";
import type { ScientificStage } from "../shared/ScientificLifecycle.js";
import type { ResearchGraphRegistry } from "../graph/ResearchGraph.js";
import { buildScientificContextPolicy, type ScientificContextPolicy } from "./ContextPolicy.js";

export interface ContextPackItem {
  id: string;
  type: "memory" | "failed_attempt" | "literature" | "graph";
  title: string;
  summary: string;
  sourceRef?: string;
  score?: number;
  estimatedTokens?: number;
  metadata?: Record<string, unknown>;
}

export interface ContextPack {
  id: string;
  query: string;
  createdAt: string;
  policy: ScientificContextPolicy;
  memoryItems: ContextPackItem[];
  literatureItems: ContextPackItem[];
  graphItems: ContextPackItem[];
  failedAttemptItems: ContextPackItem[];
  exclusions: string[];
  omittedItems: Array<{ type: ContextPackItem["type"]; title: string; reason: string }>;
  estimatedTokens: number;
  budgetExceeded: boolean;
  renderPromptContext(maxChars?: number): string;
}

export interface ContextPackBuilderInput {
  query: string;
  topic: string;
  stage: ScientificStage | string;
  memory: SciMemory;
  literature?: LiteratureReviewRuntimeStore;
  graph?: ResearchGraphRegistry;
  userId?: string;
  projectId?: string;
  groupId?: string;
}

export class ContextPackBuilder {
  async build(input: ContextPackBuilderInput): Promise<ContextPack> {
    const graphSummary = input.graph?.summary(input.projectId);
    const policy = buildScientificContextPolicy({
      topic: input.topic,
      stage: input.stage,
      graphSummary,
    });
    const memory = await input.memory.recall({
      query: input.query,
      scopes: ["instruction", "personal", "project", "group", "public", "agent", "session"],
      limit: policy.budget.maxMemoryRecords + policy.budget.maxFailedAttemptRecords,
      userId: input.userId,
      projectId: input.projectId,
      groupId: input.groupId,
      includeNeedsReview: true,
    });
    const failed = memory.filter((record) => record.kind === "warning" || record.tags.includes("failed-attempt") || record.tags.includes("negative-result"));
    const normal = memory.filter((record) => !failed.includes(record));
    const literaturePages = input.literature?.search(input.query, 6) ?? [];
    const graphItems = input.graph?.search(input.query, { projectId: input.projectId, limit: 8 }) ?? [];
    const queryTerms = termsOf(input.query);

    const memoryItems = normal.slice(0, policy.budget.maxMemoryRecords).map((record) => ({
      id: record.id,
      type: "memory" as const,
      title: record.title,
      summary: record.summary,
      sourceRef: record.source,
      score: relevanceScore(queryTerms, [record.title, record.summary, record.content, record.tags.join(" ")]),
      estimatedTokens: estimateTokens(`${record.title}\n${record.summary}`),
      metadata: { scope: record.scope, kind: record.kind, status: record.status, confidence: record.confidence },
    }));
    const failedAttemptItems = failed.slice(0, policy.budget.maxFailedAttemptRecords).map((record) => ({
      id: record.id,
      type: "failed_attempt" as const,
      title: record.title,
      summary: record.summary,
      sourceRef: record.source,
      score: relevanceScore(queryTerms, [record.title, record.summary, record.content, record.tags.join(" ")]),
      estimatedTokens: estimateTokens(`${record.title}\n${record.summary}`),
      metadata: { scope: record.scope, status: record.status, conflictsWith: record.conflictsWith },
    }));
    const literatureItems = literaturePages.map((page) => ({
      id: page.id,
      type: "literature" as const,
      title: page.title,
      summary: page.summary,
      score: relevanceScore(queryTerms, [page.title, page.summary, page.tags.join(" ")]),
      estimatedTokens: estimateTokens(`${page.title}\n${page.summary}`),
      metadata: { tags: page.tags, sourceIds: page.sourceIds },
    }));
    const selectedGraphItems = graphItems.map((item) => ({
      id: item.id,
      type: "graph" as const,
      title: item.label,
      summary: item.summary,
      score: relevanceScore(queryTerms, [item.label, item.summary, JSON.stringify(item.metadata)]),
      estimatedTokens: estimateTokens(`${item.label}\n${item.summary}`),
      metadata: item.metadata,
    }));
    const selected = fitItemsToBudget({
      targetTokens: policy.budget.targetTokens,
      memoryItems,
      failedAttemptItems,
      literatureItems,
      graphItems: selectedGraphItems,
    });

    return makeContextPack({
      id: policy.id,
      query: input.query,
      createdAt: new Date().toISOString(),
      policy,
      memoryItems: selected.memoryItems,
      failedAttemptItems: selected.failedAttemptItems,
      literatureItems: selected.literatureItems,
      graphItems: selected.graphItems,
      exclusions: [
        "raw runtime trajectories are excluded unless replay is requested",
        "raw executor stdout is excluded unless debugging execution failures",
      ],
      omittedItems: selected.omittedItems,
      estimatedTokens: selected.estimatedTokens,
      budgetExceeded: selected.budgetExceeded,
    });
  }
}

function makeContextPack(data: Omit<ContextPack, "renderPromptContext">): ContextPack {
  return {
    ...data,
    renderPromptContext(maxChars = 12_000): string {
      const sections = [
        "# Scientific Context Pack",
        "",
        `- Pack id: ${data.id}`,
        `- Created at: ${data.createdAt}`,
        `- Query: ${data.query}`,
        `- Stage: ${data.policy.stage}`,
        `- Policy: ${data.policy.id}`,
        `- Estimated tokens: ${data.estimatedTokens}/${data.policy.budget.targetTokens}`,
        ...renderItems("Relevant Memory", data.memoryItems),
        ...renderItems("Failed Attempts / Negative Results", data.failedAttemptItems),
        ...renderItems("Literature Notes", data.literatureItems),
        ...renderItems("Graph Facts", data.graphItems),
        "",
        "## Exclusions",
        ...data.exclusions.map((item) => `- ${item}`),
        ...renderOmissions(data.omittedItems),
      ];
      const rendered = sections.join("\n").trim();
      return rendered.length > maxChars ? `${rendered.slice(0, maxChars - 40).trim()}\n\n[context truncated]` : rendered;
    },
  };
}

function renderItems(title: string, items: ContextPackItem[]): string[] {
  if (items.length === 0) return [];
  return ["", `## ${title}`, ...items.map((item) => `- ${item.title}: ${item.summary}`)];
}

function renderOmissions(items: ContextPack["omittedItems"]): string[] {
  if (items.length === 0) return [];
  return ["", "## Omitted Context", ...items.map((item) => `- ${item.type}/${item.title}: ${item.reason}`)];
}

function fitItemsToBudget(input: {
  targetTokens: number;
  memoryItems: ContextPackItem[];
  failedAttemptItems: ContextPackItem[];
  literatureItems: ContextPackItem[];
  graphItems: ContextPackItem[];
}): Pick<ContextPack, "memoryItems" | "failedAttemptItems" | "literatureItems" | "graphItems" | "omittedItems" | "estimatedTokens" | "budgetExceeded"> {
  const reserveTokens = 900;
  const budget = Math.max(800, input.targetTokens - reserveTokens);
  const selected: ContextPackItem[] = [];
  const omittedItems: ContextPack["omittedItems"] = [];
  let estimatedTokens = 0;
  const ranked = [
    ...input.failedAttemptItems.map((item) => ({ ...item, priority: 4 })),
    ...input.memoryItems.map((item) => ({ ...item, priority: 3 })),
    ...input.literatureItems.map((item) => ({ ...item, priority: 2 })),
    ...input.graphItems.map((item) => ({ ...item, priority: 1 })),
  ].sort((a, b) => b.priority - a.priority || (b.score ?? 0) - (a.score ?? 0));

  for (const item of ranked) {
    const itemTokens = item.estimatedTokens ?? estimateTokens(`${item.title}\n${item.summary}`);
    if (estimatedTokens + itemTokens > budget) {
      omittedItems.push({ type: item.type, title: item.title, reason: "context budget exceeded" });
      continue;
    }
    selected.push(item);
    estimatedTokens += itemTokens;
  }

  return {
    memoryItems: selected.filter((item) => item.type === "memory"),
    failedAttemptItems: selected.filter((item) => item.type === "failed_attempt"),
    literatureItems: selected.filter((item) => item.type === "literature"),
    graphItems: selected.filter((item) => item.type === "graph"),
    omittedItems,
    estimatedTokens,
    budgetExceeded: omittedItems.length > 0,
  };
}

function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}

function termsOf(text: string): string[] {
  return text.toLowerCase().split(/[^a-z0-9\u4e00-\u9fff]+/u).filter((term) => term.length >= 2);
}

function relevanceScore(queryTerms: string[], fields: string[]): number {
  if (queryTerms.length === 0) return 0;
  const text = fields.join(" ").toLowerCase();
  return queryTerms.reduce((score, term) => score + (text.includes(term) ? 1 : 0), 0) / queryTerms.length;
}
