import type { ArtifactRef, EvidenceItem, HypothesisItem, ScientificDecision } from "../shared/types.js";

export type ExperimentExecutionState =
  | "candidate"
  | "planned"
  | "approved"
  | "running"
  | "analyzing"
  | "succeeded"
  | "failed"
  | "rejected";

export interface ExperimentCandidate {
  id: string;
  title: string;
  objective: string;
  hypothesisIds: string[];
  protocol: string;
  expectedArtifacts: string[];
  costEstimate?: number;
  riskLevel?: "low" | "medium" | "high";
  metadata?: Record<string, unknown>;
}

export interface ExperimentRunRecord {
  id: string;
  candidateId: string;
  state: ExperimentExecutionState;
  startedAt?: string;
  completedAt?: string;
  observations: string[];
  artifacts: ArtifactRef[];
  evidence: EvidenceItem[];
  failureMode?: string;
  qualityNotes?: string[];
}

export interface ExperimentExecutionLoopState {
  queue: ExperimentCandidate[];
  runs: ExperimentRunRecord[];
  currentRun?: ExperimentRunRecord;
  decision: ScientificDecision;
}

export class ExperimentExecutionLoop {
  plan(candidates: ExperimentCandidate[]): ExperimentExecutionLoopState {
    const queue = [...candidates].sort((a, b) => this.priority(b) - this.priority(a));
    return {
      queue,
      runs: [],
      decision: {
        status: queue.length > 0 ? "continue" : "needs_human_review",
        reason: queue.length > 0 ? "experiment queue prepared" : "no executable experiment candidates",
        confidence: queue.length > 0 ? "medium" : "low",
        nextStage: queue.length > 0 ? "execution_planning" : "experiment_design",
      },
    };
  }

  approveNext(state: ExperimentExecutionLoopState, reviewer = "system"): ExperimentExecutionLoopState {
    const [candidate, ...rest] = state.queue;
    if (!candidate) {
      return {
        ...state,
        decision: { status: "needs_human_review", reason: "no experiment candidate to approve", confidence: "low" },
      };
    }
    const now = new Date().toISOString();
    const run: ExperimentRunRecord = {
      id: `${candidate.id}-run-${state.runs.length + 1}`,
      candidateId: candidate.id,
      state: "approved",
      startedAt: now,
      observations: [`approved by ${reviewer}`],
      artifacts: [],
      evidence: [],
    };
    return {
      queue: rest,
      runs: [...state.runs, run],
      currentRun: run,
      decision: { status: "continue", reason: "experiment approved for execution", confidence: "medium" },
    };
  }

  recordRun(
    state: ExperimentExecutionLoopState,
    update: Partial<Omit<ExperimentRunRecord, "id" | "candidateId">>,
  ): ExperimentExecutionLoopState {
    if (!state.currentRun) {
      return {
        ...state,
        decision: { status: "needs_human_review", reason: "no active experiment run to update", confidence: "low" },
      };
    }
    const nextRun: ExperimentRunRecord = {
      ...state.currentRun,
      ...update,
      observations: [...state.currentRun.observations, ...(update.observations ?? [])],
      artifacts: [...state.currentRun.artifacts, ...(update.artifacts ?? [])],
      evidence: [...state.currentRun.evidence, ...(update.evidence ?? [])],
      qualityNotes: [...(state.currentRun.qualityNotes ?? []), ...(update.qualityNotes ?? [])],
    };
    return {
      ...state,
      runs: state.runs.map((run) => run.id === nextRun.id ? nextRun : run),
      currentRun: nextRun,
      decision: this.decideNext(nextRun, state.queue.length),
    };
  }

  summarizeEvidence(runs: ExperimentRunRecord[]): { evidence: EvidenceItem[]; hypotheses: HypothesisItem[] } {
    const evidence = runs.flatMap((run) => run.evidence);
    const hypotheses: HypothesisItem[] = runs
      .filter((run) => run.state === "failed" && run.failureMode)
      .map((run) => ({
        id: `${run.id}-failure-hypothesis`,
        statement: `Failure mode requires follow-up: ${run.failureMode}`,
        assumptions: run.qualityNotes ?? [],
        predictions: ["A revised protocol should reduce this failure mode."],
        falsificationTests: ["Repeat with the revised protocol and compare failure frequency."],
        status: "candidate",
      }));
    return { evidence, hypotheses };
  }

  private decideNext(run: ExperimentRunRecord, queuedCount: number): ScientificDecision {
    if (run.state === "succeeded") {
      return { status: "advance", reason: "experiment succeeded; interpret results next", confidence: "medium", nextStage: "result_interpretation" };
    }
    if (run.state === "failed") {
      return {
        status: queuedCount > 0 ? "revise" : "needs_human_review",
        reason: run.failureMode ? `experiment failed: ${run.failureMode}` : "experiment failed without classified failure mode",
        confidence: run.failureMode ? "medium" : "low",
        nextStage: queuedCount > 0 ? "execution_planning" : "experiment_design",
      };
    }
    return { status: "continue", reason: `experiment is ${run.state}`, confidence: "medium" };
  }

  private priority(candidate: ExperimentCandidate): number {
    const riskPenalty = candidate.riskLevel === "high" ? 2 : candidate.riskLevel === "medium" ? 1 : 0;
    const costPenalty = candidate.costEstimate ? Math.log10(candidate.costEstimate + 1) : 0;
    return candidate.hypothesisIds.length * 2 + candidate.expectedArtifacts.length - riskPenalty - costPenalty;
  }
}
