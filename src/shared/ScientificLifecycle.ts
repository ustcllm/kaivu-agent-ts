export type ScientificStage =
  | "problem_framing"
  | "literature_review"
  | "hypothesis_generation"
  | "hypothesis_validation"
  | "experiment_design"
  | "execution_planning"
  | "result_interpretation"
  | "memory_graph_update"
  | "next_action_decision"
  | "reporting";

export const DEFAULT_STAGE_ORDER: ScientificStage[] = [
  "problem_framing",
  "literature_review",
  "hypothesis_generation",
  "hypothesis_validation",
  "experiment_design",
  "execution_planning",
  "result_interpretation",
  "memory_graph_update",
  "next_action_decision",
  "reporting",
];

export type ResearchMode = "interactive" | "autonomous";

export interface ScientificTask {
  id: string;
  title: string;
  question: string;
  discipline?: string;
  taskType?: string;
  secondaryDisciplines?: string[];
  methodDomains?: string[];
  experimentalMode?: string;
  constraints?: Record<string, unknown>;
  successCriteria?: string[];
}
