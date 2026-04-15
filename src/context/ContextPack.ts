import type { LiteratureKnowledgeBase } from "../literature/LiteratureKnowledgeBase.js";
import type { SciMemory } from "../memory/SciMemory.js";
import type { ScientificStage } from "../shared/types.js";
import type { ResearchGraphRegistry } from "../graph/ResearchGraph.js";
import { buildScientificContextPolicy, type ScientificContextPolicy } from "./ContextPolicy.js";

export interface ContextPackItem {
  id: string;
  type: "memory" | "failed_attempt" | "literature" | "graph";
  title: string;
  summary: string;
  sourceRef?: string;
  metadata?: Record<string, unknown>;
}

export interface ContextPack {
  id: string;
  query: string;
  policy: ScientificContextPolicy;
  memoryItems: ContextPackItem[];
  literatureItems: ContextPackItem[];
  graphItems: ContextPackItem[];
  failedAttemptItems: ContextPackItem[];
  exclusions: string[];
  renderPromptContext(maxChars?: number): string;
}

export interface ContextPackBuilderInput {
  query: string;
  topic: string;
  stage: ScientificStage | string;
  memory: SciMemory;
  literature?: LiteratureKnowledgeBase;
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

    return makeContextPack({
      id: policy.id,
      query: input.query,
      policy,
      memoryItems: normal.slice(0, policy.budget.maxMemoryRecords).map((record) => ({
        id: record.id,
        type: "memory",
        title: record.title,
        summary: record.summary,
        sourceRef: record.source,
        metadata: { scope: record.scope, kind: record.kind, status: record.status, confidence: record.confidence },
      })),
      failedAttemptItems: failed.slice(0, policy.budget.maxFailedAttemptRecords).map((record) => ({
        id: record.id,
        type: "failed_attempt",
        title: record.title,
        summary: record.summary,
        sourceRef: record.source,
        metadata: { scope: record.scope, status: record.status, conflictsWith: record.conflictsWith },
      })),
      literatureItems: literaturePages.map((page) => ({
        id: page.id,
        type: "literature",
        title: page.title,
        summary: page.summary,
        metadata: { tags: page.tags, sourceIds: page.sourceIds },
      })),
      graphItems: graphItems.map((item) => ({
        id: item.id,
        type: "graph",
        title: item.label,
        summary: item.summary,
        metadata: item.metadata,
      })),
      exclusions: [
        "raw runtime trajectories are excluded unless replay is requested",
        "raw executor stdout is excluded unless debugging execution failures",
      ],
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
        `- Query: ${data.query}`,
        `- Stage: ${data.policy.stage}`,
        `- Policy: ${data.policy.id}`,
        ...renderItems("Relevant Memory", data.memoryItems),
        ...renderItems("Failed Attempts / Negative Results", data.failedAttemptItems),
        ...renderItems("Literature Notes", data.literatureItems),
        ...renderItems("Graph Facts", data.graphItems),
        "",
        "## Exclusions",
        ...data.exclusions.map((item) => `- ${item}`),
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
