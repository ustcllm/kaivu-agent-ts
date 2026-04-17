import type { SciAgent } from "../agent/SciAgent.js";
import type { ResearchGraphRegistry } from "../graph/ResearchGraph.js";
import type { SciMemory } from "../memory/SciMemory.js";
import type { SciRuntime } from "../runtime/SciRuntime.js";
import type { ResearchMode, ResearchState, ScientificTask } from "../shared/types.js";
import { applyStageResult, createInitialResearchState } from "./ResearchState.js";
import { ResearchTrajectory, type TrajectoryEvent } from "./Trajectory.js";

export interface ResearchRunInput {
  task: ScientificTask;
  agent: SciAgent;
  mode: ResearchMode;
  maxIterations?: number;
  pauseAfterStage?: boolean;
  initialState?: ResearchState;
  onEvent?: (event: TrajectoryEvent) => void;
}

export interface ResearchRunResult {
  state: ResearchState;
  trajectory: TrajectoryEvent[];
}

export class SciLoop {
  constructor(
    private readonly runtime: SciRuntime,
    private readonly memory: SciMemory,
    private readonly graph?: ResearchGraphRegistry,
  ) {}

  async run(input: ResearchRunInput): Promise<ResearchRunResult> {
    let state = input.initialState ?? createInitialResearchState(input.task, input.agent.initialStage());
    const trajectory = new ResearchTrajectory();
    const maxIterations = input.maxIterations ?? 12;
    let iterationsThisRun = 0;

    while (!state.done && iterationsThisRun < maxIterations) {
      const stage = state.currentStage;
      this.emit(input, trajectory.recordLoopDecision(stage, `Selected stage ${stage} at iteration ${state.iteration}.`));
      const plan = input.agent.buildStagePlan(state.task, stage, state);
      this.emit(
        input,
        trajectory.record("stage_plan", {
          stage,
          specialistId: plan.specialistId,
          objective: plan.objective,
          requiredCapabilities: plan.requiredCapabilities,
          expectedOutputs: plan.expectedOutputs,
        }),
      );
      const specialist = input.agent.specialistFor(stage);
      const runtimeResult = await this.runtime.runStage({
        agent: input.agent,
        specialist,
        plan,
        researchState: state,
        memory: this.memory,
        onEvent: (event) => {
          this.emit(input, trajectory.recordRuntimeEvents([event]));
        },
      });
      this.emit(
        input,
        trajectory.record("stage_output", {
          stage,
          specialistId: specialist.id,
          input: {
            objective: plan.objective,
            previousEvidenceCount: state.evidence.length,
            previousHypothesisCount: state.hypotheses.length,
          },
          output: {
            summary: runtimeResult.stageResult.summary,
            decision: runtimeResult.stageResult.decision,
            artifacts: runtimeResult.stageResult.artifacts,
            evidence: runtimeResult.stageResult.evidence,
            hypotheses: runtimeResult.stageResult.hypotheses,
          },
          observability: {
            processTrace: runtimeResult.stageResult.processTrace ?? [],
          },
          runtime: summarizeRuntimeForStageOutput(runtimeResult.runtime),
          review: input.pauseAfterStage
            ? {
                required: true,
                message: "Review this stage output before continuing to the next research stage.",
              }
            : {
                required: false,
              },
        }),
      );
      const memoryCommit = await this.memory.commit(
        runtimeResult.stageResult.memoryProposals,
        `${input.agent.id}:${specialist.id}:${stage}`,
      );
      this.emit(
        input,
        trajectory.record("memory_commit", {
          committedCount: memoryCommit.committed.length,
          committed: memoryCommit.committed.map((record) => ({
            id: record.id,
            scope: record.scope,
            kind: record.kind,
            title: record.title,
            summary: record.summary,
            tags: record.tags,
            visibility: record.visibility,
            promotionStatus: record.promotionStatus,
            needsReview: record.needsReview,
            source: record.source,
          })),
          skipped: memoryCommit.skipped,
        }),
      );
      if (this.graph && runtimeResult.stageResult.graphProposals.length > 0) {
        const facts = this.graph.applyGraphProposals(
          runtimeResult.stageResult.graphProposals,
          `${input.agent.id}:${specialist.id}:${stage}`,
        );
        this.emit(
          input,
          trajectory.record("graph_update", {
            factCount: facts.length,
            proposalCount: runtimeResult.stageResult.graphProposals.length,
            facts: facts.map((fact) => ({
              id: fact.id,
              subjectId: fact.subjectId,
              predicate: fact.predicate,
              objectId: fact.objectId,
              confidence: fact.confidence,
              producedBy: fact.producedBy,
              status: fact.status,
            })),
          }),
        );
      }
      const fallbackNextStage = input.agent.nextStageAfter(stage);
      state = applyStageResult(state, runtimeResult.stageResult, fallbackNextStage);
      this.emit(input, trajectory.recordStateUpdate(runtimeResult.stageResult));

      if (runtimeResult.stageResult.decision.status === "needs_human_review") {
        state = { ...state, done: true, stopReason: runtimeResult.stageResult.decision.reason };
      }
      if (!state.done && input.pauseAfterStage && input.mode === "interactive") {
        state = { ...state, done: true, stopReason: `paused_after_${stage}` };
      }
      iterationsThisRun += 1;
    }

    if (!state.done && iterationsThisRun >= maxIterations) {
      state = { ...state, done: true, stopReason: "max_iterations_reached" };
    }
    this.emit(
      input,
      trajectory.record("final_result", {
        done: state.done,
        stopReason: state.stopReason,
        iteration: state.iteration,
        currentStage: state.currentStage,
      }),
    );
    return { state, trajectory: trajectory.snapshot() };
  }

  private emit(input: ResearchRunInput, event: TrajectoryEvent): void {
    input.onEvent?.(event);
  }
}

function summarizeRuntimeForStageOutput(runtime: { model: string; tools: Record<string, unknown>; contextPack?: Record<string, unknown> }): Record<string, unknown> {
  return {
    model: runtime.model,
    tools: runtime.tools,
    contextPack: runtime.contextPack,
  };
}
