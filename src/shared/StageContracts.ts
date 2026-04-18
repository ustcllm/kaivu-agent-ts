import type { GraphWriteProposal } from "./GraphTypes.js";
import type { MemoryWriteProposal } from "./MemoryTypes.js";
import type { ScientificStage } from "./ScientificLifecycle.js";

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
