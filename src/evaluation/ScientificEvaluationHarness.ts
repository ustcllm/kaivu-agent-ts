import type { ArtifactRef, EvidenceItem, HypothesisItem, ScientificStage } from "../shared/types.js";

export type ScientificEvaluationAxisId =
  | "problem_framing"
  | "literature_review"
  | "hypothesis_generation"
  | "experiment_design"
  | "memory_graph"
  | "runtime_observability";

export interface ScientificEvaluationInput {
  completedStages?: ScientificStage[];
  evidence?: EvidenceItem[];
  hypotheses?: HypothesisItem[];
  artifacts?: ArtifactRef[];
  trajectory?: unknown[];
  finalState?: Record<string, unknown>;
}

export interface ScientificEvaluationAxisScore {
  axis: ScientificEvaluationAxisId;
  score: number;
  rationale: string;
  missing: string[];
}

export interface ScientificEvaluationResult {
  overallScore: number;
  decisionState: "pass" | "needs_revision" | "blocked";
  axisScores: ScientificEvaluationAxisScore[];
  blockers: string[];
  regressionHints: string[];
}

export class ScientificEvaluationHarness {
  evaluate(input: ScientificEvaluationInput): ScientificEvaluationResult {
    const completedStages = new Set(input.completedStages ?? []);
    const evidence = input.evidence ?? [];
    const hypotheses = input.hypotheses ?? [];
    const artifacts = input.artifacts ?? [];
    const trajectory = input.trajectory ?? [];

    const axisScores: ScientificEvaluationAxisScore[] = [
      scoreAxis("problem_framing", completedStages.has("problem_framing") ? 0.8 : 0.25, [
        completedStages.has("problem_framing") ? "" : "problem framing stage is missing",
      ]),
      scoreAxis("literature_review", evidence.length >= 3 ? 0.85 : evidence.length > 0 ? 0.55 : 0.2, [
        evidence.length >= 3 ? "" : "literature evidence is too sparse for robust synthesis",
      ]),
      scoreAxis("hypothesis_generation", hypotheses.length >= 2 ? 0.85 : hypotheses.length === 1 ? 0.6 : 0.2, [
        hypotheses.length >= 2 ? "" : "hypothesis portfolio lacks alternatives",
      ]),
      scoreAxis("experiment_design", completedStages.has("experiment_design") ? 0.75 : 0.3, [
        completedStages.has("experiment_design") ? "" : "experiment design has not been completed",
      ]),
      scoreAxis("memory_graph", artifacts.some((artifact) => artifact.kind.includes("graph")) ? 0.75 : 0.45, [
        artifacts.some((artifact) => artifact.kind.includes("graph")) ? "" : "graph or provenance artifact is not visible",
      ]),
      scoreAxis("runtime_observability", trajectory.length >= 5 ? 0.8 : trajectory.length > 0 ? 0.55 : 0.25, [
        trajectory.length >= 5 ? "" : "trajectory is too short for replay or regression debugging",
      ]),
    ];

    const overallScore = round2(axisScores.reduce((sum, axis) => sum + axis.score, 0) / axisScores.length);
    const blockers = axisScores.flatMap((axis) => axis.score < 0.4 ? axis.missing : []);
    const decisionState =
      blockers.length > 0 ? "blocked" : overallScore >= 0.72 ? "pass" : "needs_revision";

    return {
      overallScore,
      decisionState,
      axisScores,
      blockers,
      regressionHints: axisScores
        .filter((axis) => axis.score < 0.7)
        .map((axis) => `Improve ${axis.axis}: ${axis.missing.join("; ") || axis.rationale}`),
    };
  }
}

function scoreAxis(
  axis: ScientificEvaluationAxisId,
  score: number,
  missing: string[],
): ScientificEvaluationAxisScore {
  const cleanedMissing = missing.filter(Boolean);
  return {
    axis,
    score: round2(score),
    rationale: cleanedMissing.length === 0 ? "sufficient signal available" : cleanedMissing.join("; "),
    missing: cleanedMissing,
  };
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
