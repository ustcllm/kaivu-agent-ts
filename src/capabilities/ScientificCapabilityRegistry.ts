export interface ScientificCapabilitySpec {
  name: string;
  description: string;
  candidateTools: string[];
  executionMode: "runtime_tool_call" | "runtime_policy_checked_code" | "runtime_policy_checked_write" | "external_executor_handoff" | "runtime_policy_checked_review";
  pack: string;
  disciplineTags: string[];
  requiresApproval: boolean;
  readOnlyPreferred: boolean;
}

export class ScientificCapabilityRegistry {
  private readonly capabilities = new Map<string, ScientificCapabilitySpec>();

  constructor(capabilities: ScientificCapabilitySpec[] = defaultScientificCapabilities()) {
    for (const capability of capabilities) {
      this.register(capability);
    }
  }

  register(capability: ScientificCapabilitySpec): void {
    this.capabilities.set(capability.name, capability);
  }

  get(name: string): ScientificCapabilitySpec | undefined {
    return this.capabilities.get(name);
  }

  resolveTools(name: string): string[] {
    return [...(this.get(name)?.candidateTools ?? [])];
  }

  listForDiscipline(discipline: string): ScientificCapabilitySpec[] {
    const normalized = discipline.trim().toLowerCase();
    return [...this.capabilities.values()].filter(
      (capability) => capability.disciplineTags.includes(normalized) || capability.disciplineTags.includes("general_science"),
    );
  }

  listPack(pack: string): ScientificCapabilitySpec[] {
    return [...this.capabilities.values()].filter((capability) => capability.pack === pack);
  }

  summary(): Record<string, string[]> {
    const packs: Record<string, string[]> = {};
    for (const capability of this.capabilities.values()) {
      packs[capability.pack] ??= [];
      packs[capability.pack].push(capability.name);
    }
    return packs;
  }
}

export function defaultScientificCapabilities(): ScientificCapabilitySpec[] {
  return [
    capability("concept_grounding", "Clarify unfamiliar scientific terms before framing a research problem.", ["openai_hosted_web_search"], "problem_framing_pack", ["general_science", "artificial_intelligence", "chemistry", "physics", "mathematics"]),
    capability("literature_search", "Retrieve scientific sources for claims, methods, and conflicts.", ["arxiv_search", "crossref_search", "pubmed_search"], "literature_review_pack", ["general_science", "artificial_intelligence", "chemistry", "physics", "mathematics"]),
    capability("citation_resolution", "Resolve DOI/PMID/URL metadata into stable citation records.", ["resolve_citation"], "literature_review_pack", ["general_science"]),
    capability("memory_recall", "Recall scoped scientific memory.", ["search_memory"], "knowledge_pack", ["general_science"]),
    capability("memory_write", "Persist validated decisions, failures, and claim updates.", ["save_memory", "review_memory"], "knowledge_pack", ["general_science"], true, false, "runtime_policy_checked_write"),
    capability("graph_query", "Query typed scientific provenance graph context.", ["query_typed_graph"], "knowledge_pack", ["general_science"]),
    capability("graph_update", "Persist provenance links among scientific objects.", ["research_graph_registry"], "knowledge_pack", ["general_science"], true, false, "runtime_policy_checked_write"),
    capability("python_analysis", "Run reproducible computational checks or statistical analysis.", ["python_exec"], "computation_pack", ["general_science", "artificial_intelligence", "kaggle_competition", "physics", "mathematics"], true, false, "runtime_policy_checked_code"),
    capability("experiment_planning", "Design experiment portfolios, quality gates, and resource estimates.", ["experiment_plan_builder"], "execution_pack", ["general_science", "artificial_intelligence", "chemistry", "chemical_engineering", "physics", "mathematics"], false, true),
    capability("executor_handoff", "Handoff an approved protocol to an external research executor.", ["scientific_executor"], "execution_pack", ["general_science"], true, false, "external_executor_handoff"),
    capability("ai_training_execution", "Run AI training or evaluation under a frozen protocol.", ["ai_training_executor"], "ai_research_pack", ["artificial_intelligence", "kaggle_competition"], true, false, "external_executor_handoff"),
    capability("kaggle_submission_dry_run", "Validate Kaggle submission schema without a live submission.", ["kaggle_submission_validator"], "kaggle_pack", ["kaggle_competition"], true, false, "runtime_policy_checked_write"),
    capability("proof_checking", "Check proof obligations and proof gaps.", ["proof_checker"], "mathematics_pack", ["mathematics"]),
    capability("counterexample_search", "Search for mathematical counterexamples under bounded assumptions.", ["counterexample_search"], "mathematics_pack", ["mathematics"]),
    capability("chemistry_safety_review", "Review chemical hazards and safety envelopes.", ["chemistry_safety_checker"], "chemistry_pack", ["chemistry", "chemical_engineering"], true, true, "runtime_policy_checked_review"),
  ];
}

function capability(
  name: string,
  description: string,
  candidateTools: string[],
  pack: string,
  disciplineTags: string[],
  requiresApproval = false,
  readOnlyPreferred = true,
  executionMode: ScientificCapabilitySpec["executionMode"] = "runtime_tool_call",
): ScientificCapabilitySpec {
  return { name, description, candidateTools, pack, disciplineTags, requiresApproval, readOnlyPreferred, executionMode };
}
