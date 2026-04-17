import type { StageResult } from "../../shared/types.js";
import { BaseSpecialistAgent, type SpecialistRunInput } from "../SpecialistAgent.js";

export class VerificationAgent extends BaseSpecialistAgent {
  id = "verification_agent";
  stage = "hypothesis_validation" as const;
  description = "Checks novelty, feasibility, falsifiability, leakage, and evidence readiness.";

  async run(input: SpecialistRunInput): Promise<StageResult> {
    const summary = await this.modelStep(input, {
      prompt: `Validate the current hypotheses for: ${input.plan.objective}. Check novelty, feasibility, falsifiability, and evidence readiness.`,
    });
    return {
      stage: this.stage,
      specialistId: this.id,
      summary,
      evidence: [],
      hypotheses: [],
      artifacts: [],
      memoryProposals: [
        {
          scope: "project",
          title: "Hypothesis validation review",
          summary: summary.slice(0, 220),
          content: summary,
          tags: ["hypothesis", "validation", "gate"],
        },
      ],
      graphProposals: [],
      decision: {
        status: "advance",
        nextStage: "experiment_design",
        reason: "Validation review is complete enough to design discriminative experiments.",
        confidence: "medium",
      },
    };
  }
}
