import type { ScientificDecisionSummary } from "../decision/ScientificDecisionEngine.js";
import type { EvidenceReviewSummary } from "../review/EvidenceReviewEngine.js";
import type { ExperimentCandidate } from "./ExperimentExecutionLoop.js";

export interface ScheduledExperiment {
  experimentId: string;
  rank: number;
  scheduleState: "ready_to_schedule" | "needs_human_approval" | "needs_protocol" | "blocked";
  portfolioScore: number;
  selectionScore: number;
  action: string;
  requiredBeforeExecution: string[];
  recommendedAgents: string[];
  mctsLikePath: string[];
  schedulerNodeId: string;
  selectionReason: string;
  acquisition: {
    posteriorMean: number;
    uncertainty: number;
    expectedImprovement: number;
    costRiskPenalty: number;
    score: number;
  };
}

export interface ExperimentSchedulerInput {
  topic: string;
  candidates: ExperimentCandidate[];
  decisionSummary?: ScientificDecisionSummary;
  evidenceReview?: EvidenceReviewSummary;
  failedRouteIds?: string[];
  autonomyLevel?: "L0" | "L1" | "L2" | "L3" | "L4";
}

export interface ExperimentSchedulerSummary {
  schedulerId: string;
  topic: string;
  schedulerState: "ready_to_schedule" | "needs_candidates" | "needs_human_approval" | "needs_protocol" | "blocked";
  topExperimentId: string;
  topAction: string;
  candidateCount: number;
  executionQueue: ScheduledExperiment[];
  blockedExperiments: ScheduledExperiment[];
  mctsLikeSearch: {
    rootState: string;
    candidateCount: number;
    outcomeScenarios: string[];
    bestPath: string[];
    bestNodeId: string;
    boPolicy: string;
  };
}

const OUTCOME_SCENARIOS = ["positive_support", "negative_falsification", "ambiguous_result", "failed_execution", "quality_blocked"];

export class ExperimentScheduler {
  schedule(input: ExperimentSchedulerInput): ExperimentSchedulerSummary {
    const failedRoutes = new Set(input.failedRouteIds ?? []);
    const scored = input.candidates
      .map((candidate, index) => this.scheduleCandidate(candidate, index + 1, input, failedRoutes))
      .sort((a, b) => b.selectionScore - a.selectionScore);
    const executionQueue = scored.filter((item) => item.scheduleState === "ready_to_schedule").map((item, index) => ({ ...item, rank: index + 1 }));
    const blockedExperiments = scored.filter((item) => item.scheduleState !== "ready_to_schedule");
    const top = executionQueue[0];
    return {
      schedulerId: `experiment-scheduler:${slug(input.topic)}`,
      topic: input.topic,
      schedulerState: schedulerState(scored, executionQueue, blockedExperiments),
      topExperimentId: top?.experimentId ?? "",
      topAction: top?.action ?? "",
      candidateCount: input.candidates.length,
      executionQueue: executionQueue.slice(0, 12),
      blockedExperiments: blockedExperiments.slice(0, 20),
      mctsLikeSearch: {
        rootState: `decision=${input.decisionSummary?.decisionState ?? "unknown"}; evidence=${input.evidenceReview?.reviewReadiness ?? "unknown"}`,
        candidateCount: input.candidates.length,
        outcomeScenarios: OUTCOME_SCENARIOS,
        bestPath: top?.mctsLikePath ?? [],
        bestNodeId: top?.schedulerNodeId ?? "",
        boPolicy: "expected_improvement_plus_uncertainty_minus_cost_risk_failure",
      },
    };
  }

  private scheduleCandidate(
    candidate: ExperimentCandidate,
    rankPrior: number,
    input: ExperimentSchedulerInput,
    failedRoutes: Set<string>,
  ): ScheduledExperiment {
    const acquisition = acquisitionOf(candidate, failedRoutes);
    const qualityGates = qualityGatesFor(candidate, input.evidenceReview);
    const needsHumanApproval = candidate.riskLevel === "high" || input.decisionSummary?.mustPauseForHumanReview || input.autonomyLevel === "L1";
    const needsProtocol = qualityGates.length > 0 && !candidate.protocol.trim();
    const blockedByEvidence = input.evidenceReview?.reviewReadiness === "draft" && candidate.riskLevel !== "low";
    const scheduleState: ScheduledExperiment["scheduleState"] = blockedByEvidence
      ? "blocked"
      : needsHumanApproval
        ? "needs_human_approval"
        : needsProtocol
          ? "needs_protocol"
          : "ready_to_schedule";
    const portfolioScore = portfolioScoreOf(candidate);
    const selectionScore = portfolioScore + acquisition.score - (scheduleState === "ready_to_schedule" ? 0 : 3);
    return {
      experimentId: candidate.id,
      rank: rankPrior,
      scheduleState,
      portfolioScore: round2(portfolioScore),
      selectionScore: round2(selectionScore),
      action: `schedule_${experimentType(candidate)}`,
      requiredBeforeExecution: qualityGates,
      recommendedAgents: agentsFor(candidate),
      mctsLikePath: ["select_candidate", experimentType(candidate), "expand_outcomes", "execution_gate", "backpropagate_result"],
      schedulerNodeId: `scheduler-node:${slug(candidate.id)}`,
      selectionReason: selectionReason(candidate, acquisition, scheduleState),
      acquisition,
    };
  }
}

function acquisitionOf(candidate: ExperimentCandidate, failedRoutes: Set<string>): ScheduledExperiment["acquisition"] {
  const posteriorMean = portfolioScoreOf(candidate);
  const uncertainty = candidate.hypothesisIds.length === 0 ? 1.5 : 0.8;
  const expectedImprovement = Math.max(0, posteriorMean - 3) + uncertainty * 0.5;
  const repeatFailurePenalty = candidate.hypothesisIds.some((id) => failedRoutes.has(id)) ? 2 : 0;
  const costRiskPenalty = (candidate.costEstimate ? Math.log10(candidate.costEstimate + 1) : 0) + riskPenalty(candidate) + repeatFailurePenalty;
  return {
    posteriorMean: round2(posteriorMean),
    uncertainty: round2(uncertainty),
    expectedImprovement: round2(expectedImprovement),
    costRiskPenalty: round2(costRiskPenalty),
    score: round2(expectedImprovement - costRiskPenalty),
  };
}

function portfolioScoreOf(candidate: ExperimentCandidate): number {
  return candidate.hypothesisIds.length * 2 + candidate.expectedArtifacts.length + (candidate.protocol ? 1 : 0) - riskPenalty(candidate);
}

function riskPenalty(candidate: ExperimentCandidate): number {
  if (candidate.riskLevel === "high") return 2;
  if (candidate.riskLevel === "medium") return 1;
  return 0;
}

function qualityGatesFor(candidate: ExperimentCandidate, review?: EvidenceReviewSummary): string[] {
  const gates = ["protocol_version_recorded", "success_failure_criteria_recorded", "artifact_provenance_recorded"];
  if (/parameter|tuning|sweep|optimization/i.test(`${candidate.title} ${candidate.objective}`)) gates.push("search_space_frozen", "confirmatory_evaluation_split_frozen");
  if (review && review.reviewReadiness !== "decision_ready") gates.push("evidence_review_not_decision_ready");
  return [...new Set(gates)];
}

function experimentType(candidate: ExperimentCandidate): string {
  const text = `${candidate.title} ${candidate.objective}`.toLowerCase();
  if (/parameter|tuning|sweep|optimization/.test(text)) return "parameter_optimization";
  if (/ablation|control|baseline/.test(text)) return "control_or_ablation";
  if (/repeat|replicate|reproduce/.test(text)) return "reproducibility_check";
  return "discriminative_experiment";
}

function agentsFor(candidate: ExperimentCandidate): string[] {
  const type = experimentType(candidate);
  if (type === "parameter_optimization") return ["experiment_scheduler", "run_manager", "quality_reviewer"];
  if (type === "control_or_ablation") return ["experiment_designer", "quality_reviewer", "result_interpreter"];
  return ["experiment_designer", "run_manager", "quality_reviewer"];
}

function selectionReason(candidate: ExperimentCandidate, acquisition: ScheduledExperiment["acquisition"], state: ScheduledExperiment["scheduleState"]): string {
  const reasons = [];
  if (candidate.hypothesisIds.length > 0) reasons.push("tests active hypotheses");
  if (candidate.expectedArtifacts.length > 0) reasons.push("produces registered artifacts");
  if (acquisition.uncertainty > 1) reasons.push("reduces uncertainty");
  if (state !== "ready_to_schedule") reasons.push(`gated by ${state}`);
  return reasons.join("; ") || `acquisition score=${acquisition.score}`;
}

function schedulerState(scored: ScheduledExperiment[], queue: ScheduledExperiment[], blocked: ScheduledExperiment[]): ExperimentSchedulerSummary["schedulerState"] {
  if (queue.length > 0) return "ready_to_schedule";
  if (scored.length === 0) return "needs_candidates";
  if (blocked.some((item) => item.scheduleState === "needs_human_approval")) return "needs_human_approval";
  if (blocked.some((item) => item.scheduleState === "needs_protocol")) return "needs_protocol";
  return "blocked";
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/gu, "-").replace(/^-|-$/g, "") || "experiment";
}
