import { makeId } from "../../shared/ids.js";
import type { StageResult } from "../../shared/types.js";
import { BaseSpecialistAgent, type SpecialistRunInput } from "../SpecialistAgent.js";

export class HypothesisGenerationAgent extends BaseSpecialistAgent {
  id = "hypothesis_generation_agent";
  stage = "hypothesis_generation" as const;
  description = "Generates testable hypotheses, assumptions, predictions, and rival explanations.";

  async run(input: SpecialistRunInput): Promise<StageResult> {
    const summary = await this.modelSummary(
      input,
      `Generate testable scientific hypotheses for: ${input.plan.objective}. Make assumptions and falsification tests explicit.`,
    );
    return {
      stage: this.stage,
      specialistId: this.id,
      summary,
      evidence: [],
      hypotheses: [
        {
          id: makeId("hypothesis"),
          statement: summary.slice(0, 260),
          assumptions: ["Assumptions must be validated by downstream review."],
          predictions: ["Predictions should be compiled before experiment design."],
          falsificationTests: ["Define one observation that would reject or revise the hypothesis."],
          status: "candidate",
        },
      ],
      artifacts: [],
      memoryProposals: [
        {
          scope: "project",
          title: "Candidate hypothesis",
          summary: summary.slice(0, 220),
          content: summary,
          tags: ["hypothesis", "candidate"],
        },
      ],
      graphProposals: [],
      decision: {
        status: "advance",
        nextStage: "hypothesis_validation",
        reason: "Candidate hypotheses are ready for validation.",
        confidence: "medium",
      },
    };
  }
}
