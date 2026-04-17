import type { ArtifactRef, EvidenceItem, HypothesisItem, ScientificStage, ScientificTask, StageExchangeView, StageResult } from "../shared/types.js";

export interface ResearchState {
  task: ScientificTask;
  currentStage: ScientificStage;
  completedStages: ScientificStage[];
  iteration: number;
  evidence: EvidenceItem[];
  hypotheses: HypothesisItem[];
  artifacts: string[];
  artifactRefs: ArtifactRef[];
  exchangeViews: StageExchangeView[];
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
    exchangeViews: [],
    blockers: [],
    done: false,
  };
}

export function applyStageResult(state: ResearchState, result: StageResult, fallbackNextStage?: ScientificStage): ResearchState {
  const nextStage = result.decision.nextStage ?? fallbackNextStage ?? state.currentStage;
  const done = result.decision.status === "stop";
  const task = applyProblemFramingTaskUpdate(state.task, result);
  const exchangeView = createStageExchangeView(result);
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
    exchangeViews: [...(state.exchangeViews ?? []), exchangeView],
    done,
    stopReason: done ? result.decision.reason : state.stopReason,
  };
}

export function createStageExchangeView(result: StageResult): StageExchangeView {
  return {
    stage: result.stage,
    specialistId: result.specialistId,
    summary: result.summary,
    evidence: result.evidence,
    hypotheses: result.hypotheses,
    artifacts: result.artifacts.map(sanitizeArtifactForExchange),
    decision: result.decision,
  };
}

export function buildAgentResearchStateView(state: ResearchState): Record<string, unknown> {
  const exchangeViews = state.exchangeViews ?? [];
  const artifactRefs = exchangeViews.length > 0
    ? exchangeViews.flatMap((exchange) => exchange.artifacts)
    : (state.artifactRefs ?? []).map(sanitizeArtifactForExchange);
  return {
    task: state.task,
    currentStage: state.currentStage,
    completedStages: state.completedStages,
    iteration: state.iteration,
    evidence: state.evidence,
    hypotheses: state.hypotheses,
    artifactRefs,
    exchanges: exchangeViews,
    blockers: state.blockers,
  };
}

function sanitizeArtifactForExchange(artifact: ArtifactRef): ArtifactRef {
  if (!artifact.metadata) return artifact;
  return {
    ...artifact,
    metadata: sanitizeMetadataForExchange(artifact.metadata),
  };
}

function sanitizeMetadataForExchange(metadata: Record<string, unknown>): Record<string, unknown> {
  const observabilityOnly = new Set([
    "groundingResults",
    "retrievalResults",
    "toolOutputs",
    "rawToolOutputs",
    "rawModelOutput",
    "processTrace",
    "runtime",
    "prompts",
  ]);
  return Object.fromEntries(Object.entries(metadata).filter(([key]) => !observabilityOnly.has(key)));
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
