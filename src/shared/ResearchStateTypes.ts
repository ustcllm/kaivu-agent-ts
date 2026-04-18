import type { ScientificStage, ScientificTask } from "./ScientificLifecycle.js";
import type { ArtifactRef, EvidenceItem, HypothesisItem } from "./StageContracts.js";

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
  blockers: string[];
  done: boolean;
  stopReason?: string;
}
