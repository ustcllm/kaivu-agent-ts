import type {
  ScientificStage,
  ScientificTask,
} from "../shared/ScientificLifecycle.js";
import type { ResearchState } from "../shared/ResearchStateTypes.js";
import type { StageResult } from "../shared/StageContracts.js";

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
    pendingStageInputs: {},
    blockers: [],
    done: false,
  };
}

export function applyStageResult(state: ResearchState, result: StageResult, fallbackNextStage?: ScientificStage): ResearchState {
  const nextStage = result.decision.nextStage ?? fallbackNextStage ?? state.currentStage;
  const done = result.decision.status === "stop";
  const task = applyProblemFramingTaskUpdate(state.task, result);
  return {
    ...state,
    task,
    currentStage: nextStage,
    completedStages: [...state.completedStages, result.stage],
    iteration: state.iteration + 1,
    evidence: [...state.evidence, ...result.evidence],
    hypotheses: [...state.hypotheses, ...result.hypotheses],
    artifacts: [...state.artifacts, ...result.artifacts.map((artifact) => artifact.id)],
    artifactRefs: [...(state.artifactRefs ?? []), ...result.artifacts],
    pendingStageInputs: {
      ...(state.pendingStageInputs ?? {}),
      [result.stage]: [],
    },
    done,
    stopReason: done ? result.decision.reason : state.stopReason,
  };
}

function applyProblemFramingTaskUpdate(task: ScientificTask, result: StageResult): ScientificTask {
  if (result.stage !== "problem_framing") return task;
  const problemFrame = result.artifacts.find((artifact) => artifact.kind === "problem_frame" || artifact.id === "problem_frame");
  if (!problemFrame?.metadata || typeof problemFrame.metadata !== "object") return task;
  const metadata = problemFrame.metadata as Record<string, unknown>;
  const structuredFrame = typeof metadata.structuredFrame === "object" && metadata.structuredFrame !== null
    ? metadata.structuredFrame as Record<string, unknown>
    : undefined;
  const discipline = stringField(structuredFrame?.discipline) ?? stringField(metadata.discipline);
  if (!discipline) return task;
  return {
    ...task,
    discipline,
  };
}

function stringField(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
