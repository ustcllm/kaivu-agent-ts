import {
  DEFAULT_STAGE_ORDER,
  type ScientificStage,
  type ScientificTask,
} from "../shared/ScientificLifecycle.js";
import type { ResearchState } from "../shared/ResearchStateTypes.js";
import type { StagePlan } from "../shared/StageContracts.js";
import type { SpecialistAgent } from "./SpecialistAgent.js";

export interface SciAgentConfig {
  id: string;
  discipline: string;
  specialists: SpecialistAgent[];
  stageOrder?: ScientificStage[];
}

export class SciAgent {
  readonly id: string;
  readonly discipline: string;
  private readonly stageOrder: ScientificStage[];
  private readonly specialistsByStage = new Map<ScientificStage, SpecialistAgent>();

  constructor(config: SciAgentConfig) {
    this.id = config.id;
    this.discipline = config.discipline;
    this.stageOrder = config.stageOrder ?? DEFAULT_STAGE_ORDER;
    for (const specialist of config.specialists) {
      this.specialistsByStage.set(specialist.stage, specialist);
    }
  }

  lifecycle(): ScientificStage[] {
    return [...this.stageOrder];
  }

  specialistFor(stage: ScientificStage): SpecialistAgent {
    const specialist = this.specialistsByStage.get(stage);
    if (!specialist) {
      throw new Error(`No specialist registered for stage: ${stage}`);
    }
    return specialist;
  }

  buildStagePlan(task: ScientificTask, stage: ScientificStage, researchState: ResearchState): StagePlan {
    const specialist = this.specialistFor(stage);
    const discipline = task.discipline ?? this.discipline;
    return {
      stage,
      specialistId: specialist.id,
      objective: `${stage}: advance "${task.title}" for ${discipline}. Question: ${task.question}`,
      inputs: {
        task,
        discipline,
        researchState,
        stageUserInputs: researchState.pendingStageInputs?.[stage] ?? [],
      },
      expectedOutputs: this.expectedOutputs(stage),
      requiredCapabilities: this.requiredCapabilities(stage),
      stopHints: ["stop if this stage has enough evidence to support a next-stage decision"],
    };
  }

  initialStage(): ScientificStage {
    return this.stageOrder[0] ?? "problem_framing";
  }

  nextStageAfter(stage: ScientificStage): ScientificStage | undefined {
    const index = this.stageOrder.indexOf(stage);
    return index >= 0 ? this.stageOrder[index + 1] : undefined;
  }

  private expectedOutputs(stage: ScientificStage): string[] {
    const defaults: Record<ScientificStage, string[]> = {
      problem_framing: ["problem statement", "constraints", "success criteria"],
      literature_review: ["digest", "claim table", "conflict map", "evidence gaps"],
      hypothesis_generation: ["candidate hypotheses", "assumptions", "predictions", "rivals"],
      hypothesis_validation: ["novelty check", "feasibility check", "falsifiability check"],
      experiment_design: ["experiment portfolio", "quality gates", "resource estimate"],
      execution_planning: ["executor handoff plan", "run manifest", "risk policy"],
      result_interpretation: ["evidence interpretation", "failure classification", "belief update"],
      memory_graph_update: ["memory proposals", "graph proposals", "provenance links"],
      next_action_decision: ["continue/revise/stop decision", "next stage"],
      reporting: ["research summary", "limitations", "next work"],
    };
    return defaults[stage];
  }

  private requiredCapabilities(stage: ScientificStage): string[] {
    const defaults: Partial<Record<ScientificStage, string[]>> = {
      problem_framing: ["concept_grounding"],
      literature_review: ["literature_search", "citation_resolution"],
      experiment_design: ["experiment_planning"],
      execution_planning: ["executor_handoff"],
      memory_graph_update: ["memory_write", "graph_update"],
    };
    return defaults[stage] ?? [];
  }
}
