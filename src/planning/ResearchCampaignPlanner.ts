import type { ScientificStage, ScientificTask } from "../shared/ScientificLifecycle.js";

export type ResearchCampaignStage =
  | "question_framing"
  | "literature_mapping"
  | "hypothesis_portfolio"
  | "experiment_portfolio"
  | "execution"
  | "theory_integration"
  | "reporting";

export interface ResearchCampaignPlannerInput {
  task: ScientificTask;
  completedStages?: ScientificStage[];
  evidenceCount?: number;
  hypothesisCount?: number;
  budgetHint?: string;
  riskTolerance?: "low" | "medium" | "high";
}

export interface ResearchCampaignPlanStep {
  campaignStage: ResearchCampaignStage;
  scientificStage: ScientificStage;
  objective: string;
  exitCriteria: string[];
  requiredSignals: string[];
}

export interface ResearchCampaignPlan {
  taskId: string;
  currentCampaignStage: ResearchCampaignStage;
  steps: ResearchCampaignPlanStep[];
  pivotRules: string[];
  killRules: string[];
  replicationRules: string[];
  multiStepRoutePlan: ScientificStage[];
}

export class ResearchCampaignPlanner {
  build(input: ResearchCampaignPlannerInput): ResearchCampaignPlan {
    const completed = new Set(input.completedStages ?? []);
    const steps: ResearchCampaignPlanStep[] = [
      {
        campaignStage: "question_framing",
        scientificStage: "problem_framing",
        objective: "Turn the user request into a bounded scientific problem with success criteria.",
        exitCriteria: ["research question is explicit", "constraints and target evidence are stated"],
        requiredSignals: ["task type", "discipline assumptions", "immediate literature queries"],
      },
      {
        campaignStage: "literature_mapping",
        scientificStage: "literature_review",
        objective: "Build an evidence map, claim table, citation trail, and conflict map.",
        exitCriteria: ["enough sources for first-pass synthesis", "major conflicts are visible"],
        requiredSignals: ["source quality", "claim polarity", "method limitations"],
      },
      {
        campaignStage: "hypothesis_portfolio",
        scientificStage: "hypothesis_generation",
        objective: "Generate rival hypotheses with predictions and falsification routes.",
        exitCriteria: ["at least two rival hypotheses", "testable predictions exist"],
        requiredSignals: ["assumptions", "predictions", "failure modes"],
      },
      {
        campaignStage: "experiment_portfolio",
        scientificStage: "experiment_design",
        objective: "Design experiments or computational tests that discriminate between hypotheses.",
        exitCriteria: ["protocol candidates exist", "quality gates and risks are defined"],
        requiredSignals: ["cost", "risk", "expected artifact", "decision threshold"],
      },
      {
        campaignStage: "execution",
        scientificStage: "execution_planning",
        objective: "Select executable work packages and prepare handoff to runtime tools.",
        exitCriteria: ["executor is selected", "run state is reproducible"],
        requiredSignals: ["inputs", "environment", "artifact paths", "rollback plan"],
      },
      {
        campaignStage: "theory_integration",
        scientificStage: "result_interpretation",
        objective: "Interpret results, update beliefs, and classify failed attempts.",
        exitCriteria: ["evidence changes are explicit", "uncertainty is updated"],
        requiredSignals: ["effect size", "negative result", "surprise", "scope condition"],
      },
      {
        campaignStage: "reporting",
        scientificStage: "reporting",
        objective: "Produce a decision-oriented research report with provenance.",
        exitCriteria: ["claims are evidence-linked", "next actions are justified"],
        requiredSignals: ["citation links", "artifact registry", "open questions"],
      },
    ];

    return {
      taskId: input.task.id,
      currentCampaignStage: this.currentStage(steps, completed),
      steps,
      pivotRules: [
        "Pivot when new evidence invalidates a core assumption or when surprise signals repeat.",
        "Pivot from broad literature search to focused validation once conflicting claims are localized.",
      ],
      killRules: [
        "Stop a hypothesis branch when falsification evidence is strong and no rescue assumption is testable.",
        `Stop or pause execution if risk exceeds ${input.riskTolerance ?? "medium"} tolerance or budget hint is violated.`,
      ],
      replicationRules: [
        "Do not treat a single noisy run as strong support.",
        "Promote claims only after independent source, repeated run, or explicit reviewer acceptance.",
      ],
      multiStepRoutePlan: steps.map((step) => step.scientificStage),
    };
  }

  private currentStage(steps: ResearchCampaignPlanStep[], completed: Set<ScientificStage>): ResearchCampaignStage {
    return steps.find((step) => !completed.has(step.scientificStage))?.campaignStage ?? "reporting";
  }
}
