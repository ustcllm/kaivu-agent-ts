export interface ScientificToolPolicyDecision {
  toolName: string;
  action: string;
  decision: "allow" | "draft_only" | "review_required" | "deny";
  allowed: boolean;
  reason: string;
  riskLevel: "low" | "medium" | "high";
  auditRequired: boolean;
  requiredApprovals: string[];
}

const TOOL_ACTION_MAP: Record<string, { action: string; riskLevel: "low" | "medium" | "high"; targetScope: string }> = {
  read_file: { action: "inspect_workspace", riskLevel: "low", targetScope: "local" },
  openai_hosted_web_search: { action: "hosted_web_search", riskLevel: "low", targetScope: "public" },
  arxiv_search: { action: "literature_query", riskLevel: "low", targetScope: "public" },
  crossref_search: { action: "literature_query", riskLevel: "low", targetScope: "public" },
  pubmed_search: { action: "literature_query", riskLevel: "low", targetScope: "public" },
  search_memory: { action: "memory_recall", riskLevel: "low", targetScope: "project" },
  query_typed_graph: { action: "graph_query", riskLevel: "low", targetScope: "project" },
  python_exec: { action: "execute_computation", riskLevel: "medium", targetScope: "local" },
  shell: { action: "execute_computation", riskLevel: "high", targetScope: "local" },
  write_file: { action: "write_artifact", riskLevel: "medium", targetScope: "project" },
  save_memory: { action: "memory_write", riskLevel: "medium", targetScope: "project" },
  review_memory: { action: "memory_governance", riskLevel: "medium", targetScope: "project" },
  forget_memory: { action: "memory_delete", riskLevel: "high", targetScope: "project" },
  ingest_literature_source: { action: "literature_ingest", riskLevel: "medium", targetScope: "project" },
};

export function evaluateScientificToolCall(input: {
  toolName: string;
  arguments?: Record<string, unknown>;
  autonomyLevel?: "L0" | "L1" | "L2" | "L3" | "L4";
  destructive?: boolean;
  enforceReview?: boolean;
}): ScientificToolPolicyDecision {
  const mapped = TOOL_ACTION_MAP[input.toolName] ?? {
    action: "tool_call",
    riskLevel: input.destructive ? "high" : "medium",
    targetScope: "project",
  };
  const autonomy = input.autonomyLevel ?? "L2";
  const highRisk = mapped.riskLevel === "high" || input.destructive;
  const reviewRequired = highRisk || (mapped.riskLevel === "medium" && autonomy !== "L4");
  const decision: ScientificToolPolicyDecision["decision"] =
    highRisk && autonomy === "L0" ? "deny" : reviewRequired ? "review_required" : "allow";
  return {
    toolName: input.toolName,
    action: mapped.action,
    decision,
    allowed: decision === "allow" || (decision === "review_required" && !input.enforceReview),
    reason: reviewRequired ? `Tool ${input.toolName} requires review under autonomy ${autonomy}.` : `Tool ${input.toolName} is allowed under autonomy ${autonomy}.`,
    riskLevel: mapped.riskLevel,
    auditRequired: mapped.riskLevel !== "low",
    requiredApprovals: reviewRequired ? ["scientific_operator"] : [],
  };
}
