import type { StageResult } from "../../shared/StageContracts.js";
import { BaseSpecialistAgent, type SpecialistRunInput } from "../SpecialistAgent.js";

export class ExperimentDesignAgent extends BaseSpecialistAgent {
  id = "experiment_design_agent";
  stage = "experiment_design" as const;
  description = "Designs experiment portfolios, quality gates, and resource-aware execution plans.";

  async run(input: SpecialistRunInput): Promise<StageResult> {
    const summary = await this.modelStep(input, {
      prompt: [
        `Design a discriminative experiment portfolio for: ${input.plan.objective}.`,
        "Write the output in English. Preserve technical terms, paper titles, method names, URLs, and identifiers in their original form.",
        "Include quality gates and resource tradeoffs.",
      ].join("\n"),
    });
    return {
      stage: this.stage,
      specialistId: this.id,
      summary,
      evidence: [],
      hypotheses: [],
      artifacts: [{ id: "experiment_portfolio_draft", kind: "experiment_plan", uri: "memory://experiment_portfolio_draft" }],
      memoryProposals: [
        {
          scope: "project",
          title: "Experiment portfolio draft",
          summary: summary.slice(0, 220),
          content: summary,
          tags: ["experiment", "portfolio"],
        },
      ],
      graphProposals: [],
      decision: {
        status: "advance",
        nextStage: "execution_planning",
        reason: "Experiment design is ready for executor planning.",
        confidence: "medium",
      },
    };
  }
}
