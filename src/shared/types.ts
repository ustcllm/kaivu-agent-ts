export type ScientificStage =
  | "problem_framing"
  | "literature_review"
  | "hypothesis_generation"
  | "hypothesis_validation"
  | "experiment_design"
  | "execution_planning"
  | "result_interpretation"
  | "memory_graph_update"
  | "next_action_decision"
  | "reporting";

export const DEFAULT_STAGE_ORDER: ScientificStage[] = [
  "problem_framing",
  "literature_review",
  "hypothesis_generation",
  "hypothesis_validation",
  "experiment_design",
  "execution_planning",
  "result_interpretation",
  "memory_graph_update",
  "next_action_decision",
  "reporting",
];

export type ResearchMode = "interactive" | "autonomous";
export type MemoryScope = "instruction" | "personal" | "project" | "group" | "public" | "agent" | "session";
export type MemoryKind =
  | "fact"
  | "hypothesis"
  | "method"
  | "decision"
  | "dataset_note"
  | "warning"
  | "preference"
  | "reference";
export type EvidenceLevel = "anecdotal" | "preprint" | "peer_reviewed" | "replicated" | "validated" | "unknown";
export type ConfidenceLevel = "low" | "medium" | "high" | "uncertain";
export type MemoryStatus = "active" | "revised" | "deprecated" | "rejected" | "draft";
export type VisibilityLevel = "private" | "project" | "group" | "public";
export type PromotionStatus = "local_only" | "candidate" | "approved" | "shared";

export interface ScientificTask {
  id: string;
  title: string;
  question: string;
  discipline?: string;
  taskType?: string;
  secondaryDisciplines?: string[];
  methodDomains?: string[];
  experimentalMode?: string;
  constraints?: Record<string, unknown>;
  successCriteria?: string[];
}

export interface StagePlan {
  stage: ScientificStage;
  specialistId: string;
  objective: string;
  inputs: Record<string, unknown>;
  expectedOutputs: string[];
  requiredCapabilities: string[];
  stopHints: string[];
}

export interface EvidenceItem {
  id: string;
  claim: string;
  source: string;
  strength: "low" | "medium" | "high" | "unknown";
  uncertainty?: string;
}

export interface HypothesisItem {
  id: string;
  statement: string;
  assumptions: string[];
  predictions: string[];
  falsificationTests: string[];
  status: "candidate" | "active" | "revised" | "rejected" | "accepted";
}

export interface ArtifactRef {
  id: string;
  kind: string;
  uri: string;
  metadata?: Record<string, unknown>;
}

export interface StageTraceItem {
  label: string;
  status: "pending" | "running" | "completed" | "skipped" | "blocked";
  detail?: string;
  data?: Record<string, unknown>;
}

export interface MemoryWriteProposal {
  scope: MemoryScope;
  kind?: MemoryKind;
  title: string;
  summary: string;
  content: string;
  tags: string[];
  evidenceLevel?: EvidenceLevel;
  confidence?: ConfidenceLevel;
  status?: MemoryStatus;
  visibility?: VisibilityLevel;
  promotionStatus?: PromotionStatus;
  sourceRefs?: string[];
  ownerAgent?: string;
  userId?: string;
  projectId?: string;
  groupId?: string;
  needsReview?: boolean;
  conflictsWith?: string[];
  supersedes?: string[];
  derivedFrom?: string[];
}

export interface GraphWriteProposal {
  subject: string;
  predicate: string;
  object: string;
  evidenceIds: string[];
}

export interface ScientificDecision {
  status: "continue" | "advance" | "revise" | "stop" | "needs_human_review";
  nextStage?: ScientificStage;
  reason: string;
  confidence: "low" | "medium" | "high";
}

export interface StageResult {
  stage: ScientificStage;
  specialistId: string;
  summary: string;
  /**
   * Observability-only trace for UI, debugging, replay, and evaluation.
   * This should not be treated as agent-to-agent scientific exchange data.
   */
  processTrace?: StageTraceItem[];
  evidence: EvidenceItem[];
  hypotheses: HypothesisItem[];
  artifacts: ArtifactRef[];
  memoryProposals: MemoryWriteProposal[];
  graphProposals: GraphWriteProposal[];
  decision: ScientificDecision;
}

export interface StageExchangeView {
  stage: ScientificStage;
  specialistId: string;
  summary: string;
  evidence: EvidenceItem[];
  hypotheses: HypothesisItem[];
  artifacts: ArtifactRef[];
  decision: ScientificDecision;
}
