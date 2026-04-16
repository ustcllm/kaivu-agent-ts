import type { ScientificEvaluationResult } from "../evaluation/ScientificEvaluationHarness.js";
import type { ExperimentExecutionLoopState } from "../execution/ExperimentExecutionLoop.js";
import type { ResearchState } from "../loop/ResearchState.js";
import type { ScientificStage } from "../shared/types.js";

export interface AutonomousControllerInput {
  state: ResearchState;
  evaluation?: ScientificEvaluationResult;
  experimentState?: ExperimentExecutionLoopState;
  maxIterations?: number;
  humanReviewRequired?: boolean;
}

export interface AutonomousControllerDecision {
  action: "continue" | "pause_for_review" | "revise" | "stop";
  nextStage?: ScientificStage;
  reason: string;
  confidence: "low" | "medium" | "high";
  safeguards: string[];
}

export class AutonomousController {
  decide(input: AutonomousControllerInput): AutonomousControllerDecision {
    const maxIterations = input.maxIterations ?? 12;
    if (input.humanReviewRequired) {
      return {
        action: "pause_for_review",
        reason: "human review is required by policy",
        confidence: "high",
        safeguards: ["preserve current trajectory", "do not mutate memory until review is accepted"],
      };
    }
    if (input.state.iteration >= maxIterations) {
      return {
        action: "stop",
        reason: "iteration budget reached",
        confidence: "high",
        safeguards: ["emit final report", "store open questions as future work"],
      };
    }
    if (input.evaluation?.decisionState === "blocked") {
      return {
        action: "revise",
        nextStage: this.revisionStage(input.evaluation.blockers),
        reason: `evaluation blocked progress: ${input.evaluation.blockers.join("; ")}`,
        confidence: "medium",
        safeguards: ["keep blocker list attached to next prompt", "avoid promoting unsupported claims"],
      };
    }
    if (input.experimentState?.decision.status === "needs_human_review") {
      return {
        action: "pause_for_review",
        nextStage: input.experimentState.decision.nextStage,
        reason: input.experimentState.decision.reason,
        confidence: input.experimentState.decision.confidence,
        safeguards: ["do not schedule additional experiments until the failure mode is reviewed"],
      };
    }
    if (input.state.done) {
      return {
        action: "stop",
        reason: input.state.stopReason ?? "research state is complete",
        confidence: "medium",
        safeguards: ["finalize artifact registry", "make termination reason explicit"],
      };
    }
    return {
      action: "continue",
      nextStage: input.state.currentStage,
      reason: "no blocking governance signal detected",
      confidence: "medium",
      safeguards: ["record trajectory event", "re-evaluate after next stage"],
    };
  }

  private revisionStage(blockers: string[]): ScientificStage {
    const text = blockers.join(" ").toLowerCase();
    if (text.includes("literature") || text.includes("evidence")) return "literature_review";
    if (text.includes("hypothesis")) return "hypothesis_generation";
    if (text.includes("experiment")) return "experiment_design";
    if (text.includes("graph") || text.includes("provenance")) return "memory_graph_update";
    return "problem_framing";
  }
}
