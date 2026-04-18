import type { ScientificStage } from "../shared/ScientificLifecycle.js";

export interface ScientificContextPolicyInput {
  topic: string;
  stage?: ScientificStage | string;
  researchState?: Record<string, unknown>;
  graphSummary?: {
    claimCount?: number;
    hypothesisCount?: number;
    negativeResultCount?: number;
  };
  schedulerFailureMemoryCount?: number;
}

export interface ScientificContextBudget {
  targetTokens: number;
  hardCapTokens: number;
  maxRawSources: number;
  maxMemoryRecords: number;
  maxFailedAttemptRecords: number;
}

export interface ScientificContextPolicy {
  id: string;
  topic: string;
  stage: string;
  budget: ScientificContextBudget;
  requiredPacks: string[];
  optionalPacks: string[];
  deprioritizedPacks: string[];
  compressionRules: string[];
  recallSignals: Record<string, unknown>;
}

export function buildScientificContextPolicy(input: ScientificContextPolicyInput): ScientificContextPolicy {
  const stage = normalizeStage(input.stage ?? String(input.researchState?.currentStage ?? "literature_review"));
  const packs = packsForStage(stage);
  const signals = {
    claimCount: input.graphSummary?.claimCount ?? 0,
    hypothesisCount: input.graphSummary?.hypothesisCount ?? 0,
    negativeResultCount: input.graphSummary?.negativeResultCount ?? 0,
    schedulerFailureMemoryCount: input.schedulerFailureMemoryCount ?? 0,
  };
  return {
    id: `scientific-context-policy:${slug(input.topic)}:${stage}`,
    topic: input.topic,
    stage,
    budget: budgetForStage(stage, signals),
    requiredPacks: packs.required,
    optionalPacks: packs.optional,
    deprioritizedPacks: packs.deprioritized,
    compressionRules: [
      "Keep claim, evidence, hypothesis, experiment, decision, and provenance ids verbatim.",
      "Summarize literature by controversy, mechanism, method, and evidence grade.",
      "Collapse repeated failed attempts into route-level failure memories.",
      "Never compress away safety blockers, permission gates, or quality failures.",
    ],
    recallSignals: signals,
  };
}

function packsForStage(stage: string): { required: string[]; optional: string[]; deprioritized: string[] } {
  if (stage.includes("literature")) {
    return {
      required: ["literature_wiki_index", "claim_compiler", "source_quality_table"],
      optional: ["controversy_pages", "citation_library"],
      deprioritized: ["executor_trace_details", "hyperparameter_trials"],
    };
  }
  if (stage.includes("hypothesis")) {
    return {
      required: ["hypothesis_tree", "failed_attempts", "evidence_conflicts"],
      optional: ["mechanism_families", "counterfactual_experiments"],
      deprioritized: ["raw_source_chunks_without_claims"],
    };
  }
  if (stage.includes("experiment") || stage.includes("execution")) {
    return {
      required: ["experiment_scheduler", "discipline_toolchain", "risk_permission_gate"],
      optional: ["value_of_information", "scheduler_memory_context"],
      deprioritized: ["long_literature_summaries"],
    };
  }
  if (stage.includes("decision") || stage.includes("review")) {
    return {
      required: ["agent_stance_continuity", "benchmark_quality", "release_gate"],
      optional: ["formal_review_records", "route_scheduler"],
      deprioritized: ["raw_executor_stdout"],
    };
  }
  return {
    required: ["research_state", "provenance_graph", "memory_distill"],
    optional: ["report_outline"],
    deprioritized: ["raw_scratchpads"],
  };
}

function budgetForStage(stage: string, signals: Record<string, number>): ScientificContextBudget {
  let targetTokens = 12_000;
  if (stage.includes("literature")) targetTokens = 18_000;
  if (stage.includes("experiment") || signals.negativeResultCount >= 3) targetTokens = 16_000;
  return {
    targetTokens,
    hardCapTokens: Math.floor(targetTokens * 1.5),
    maxRawSources: stage.includes("literature") ? 8 : 3,
    maxMemoryRecords: 12,
    maxFailedAttemptRecords: 10,
  };
}

function normalizeStage(stage: string): string {
  return stage.trim().toLowerCase().replace(/\s+/g, "_") || "literature_review";
}

function slug(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/gu, "-").replace(/^-|-$/g, "") || "context";
}
