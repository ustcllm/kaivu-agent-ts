import type { ArtifactRef, EvidenceItem, HypothesisItem, ScientificStage, ScientificTask, StageResult } from "../shared/types.js";

export interface ResearchState {
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

export function createInitialResearchState(task: ScientificTask, initialStage: ScientificStage): ResearchState {
  return {
    task,
    currentStage: initialStage,
    completedStages: [],
    iteration: 0,
    evidence: [],
    hypotheses: [],
    artifacts: [],
    artifactRefs: [],
    blockers: [],
    done: false,
  };
}

export function applyStageResult(state: ResearchState, result: StageResult, fallbackNextStage?: ScientificStage): ResearchState {
  const nextStage = result.decision.nextStage ?? fallbackNextStage ?? state.currentStage;
  const done = result.decision.status === "stop";
  return {
    ...state,
    currentStage: nextStage,
    completedStages: [...state.completedStages, result.stage],
    iteration: state.iteration + 1,
    evidence: [...state.evidence, ...result.evidence],
    hypotheses: [...state.hypotheses, ...result.hypotheses],
    artifacts: [...state.artifacts, ...result.artifacts.map((artifact) => artifact.id)],
    artifactRefs: [...(state.artifactRefs ?? []), ...result.artifacts],
    done,
    stopReason: done ? result.decision.reason : state.stopReason,
  };
}
