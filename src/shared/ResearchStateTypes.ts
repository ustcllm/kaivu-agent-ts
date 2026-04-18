import type { ScientificStage, ScientificTask } from "./ScientificLifecycle.js";
import type { ArtifactRef, EvidenceItem, HypothesisItem } from "./StageContracts.js";

export interface PendingStageInput {
  id: string;
  createdAt: string;
  sourceStage: ScientificStage;
  targetStage: ScientificStage;
  action: "revise_current_stage" | "proceed_to_next_stage";
  message: string;
}

export interface ResearchState {
  /** Full long-lived scientific loop state passed directly across stages. */
  task: ScientificTask;
  currentStage: ScientificStage;
  completedStages: ScientificStage[];
  iteration: number;
  evidence: EvidenceItem[];
  hypotheses: HypothesisItem[];
  artifacts: string[];
  artifactRefs: ArtifactRef[];
  pendingStageInputs?: Partial<Record<ScientificStage, PendingStageInput[]>>;
  blockers: string[];
  done: boolean;
  stopReason?: string;
}
