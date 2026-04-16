import type { ScientificEvaluationResult } from "../evaluation/ScientificEvaluationHarness.js";
import type { ExperimentExecutionLoopState } from "../execution/ExperimentExecutionLoop.js";
import type { CompiledTheoryObject } from "../hypothesis/HypothesisTheoryCompiler.js";

export interface ScientificDecisionCandidate {
  id: string;
  targetId: string;
  targetType: "hypothesis" | "evidence_review" | "experiment" | "governance" | "research_topic";
  action:
    | "run_discriminative_test"
    | "revise_theory_object"
    | "strengthen_evidence_review"
    | "resolve_evidence_conflicts"
    | "request_human_review"
    | "continue_current_route"
    | "retire_or_freeze_route";
  priority: "low" | "medium" | "high" | "governance_blocking";
  informationGainScore: number;
  costScore: number;
  timeScore: number;
  riskScore: number;
  governanceBurdenScore: number;
  routeValueScore: number;
  rationale: string[];
  prerequisites: string[];
  recommendedAgents: string[];
  evidenceTrace: Array<{ sourceType: string; sourceId: string; reason: string }>;
  humanReviewRequired: boolean;
}

export interface ScientificDecisionEngineInput {
  topic: string;
  theoryObjects?: CompiledTheoryObject[];
  evaluation?: ScientificEvaluationResult;
  experimentState?: ExperimentExecutionLoopState;
  evidenceReview?: {
    reviewReadiness?: string;
    conflictResolutionState?: string;
    needsHumanAdjudication?: boolean;
    blockers?: string[];
  };
  costPressure?: "low" | "medium" | "high";
  timePressure?: "low" | "medium" | "high";
}

export interface ScientificDecisionSummary {
  topic: string;
  decisionCount: number;
  recommendedNextAction: ScientificDecisionCandidate["action"];
  recommendedTargetId: string;
  decisionState:
    | "ready_to_execute"
    | "needs_theory_revision"
    | "needs_evidence_review"
    | "human_review_required"
    | "continue"
    | "no_decision";
  mustPauseForHumanReview: boolean;
  decisionQueue: ScientificDecisionCandidate[];
}

export class ScientificDecisionEngine {
  build(input: ScientificDecisionEngineInput): ScientificDecisionSummary {
    const decisions = [
      ...this.decisionsForTheoryObjects(input),
      ...this.decisionsForEvidenceReview(input),
      ...this.decisionsForEvaluation(input),
      ...this.decisionsForExperimentState(input),
    ].sort((a, b) => b.routeValueScore - a.routeValueScore);

    if (decisions.length === 0) {
      decisions.push(this.makeDecision({
        targetId: input.topic,
        targetType: "research_topic",
        action: "continue_current_route",
        informationGain: 2,
        cost: 1,
        time: 1,
        risk: 1,
        governance: 0,
        rationale: ["no blocking scientific governance signal was detected"],
        prerequisites: ["continue collecting evidence and hypotheses"],
        recommendedAgents: ["chief_scientist"],
      }));
    }

    const top = decisions[0];
    return {
      topic: input.topic,
      decisionCount: decisions.length,
      recommendedNextAction: top?.action ?? "continue_current_route",
      recommendedTargetId: top?.targetId ?? input.topic,
      decisionState: this.overallState(decisions),
      mustPauseForHumanReview: decisions.slice(0, 3).some((item) => item.humanReviewRequired),
      decisionQueue: decisions.slice(0, 12),
    };
  }

  private decisionsForTheoryObjects(input: ScientificDecisionEngineInput): ScientificDecisionCandidate[] {
    return (input.theoryObjects ?? []).map((item) => {
      if (item.formalState === "predictive" && item.discriminatingTests.length > 0) {
        return this.makeDecision({
          targetId: item.hypothesisId,
          targetType: "hypothesis",
          action: "run_discriminative_test",
          informationGain: 5,
          cost: pressureScore(input.costPressure),
          time: pressureScore(input.timePressure),
          risk: item.missingFormalFields.length > 0 ? 2 : 1,
          governance: 0,
          rationale: ["theory object is predictive and has discriminating tests"],
          prerequisites: item.discriminatingTests.map((test) => test.testLogic).slice(0, 4),
          recommendedAgents: ["experiment_designer", "experiment_scheduler", "quality_reviewer"],
          evidenceTrace: [{ sourceType: "theory_object", sourceId: item.compiledTheoryId, reason: "decision target" }],
        });
      }
      return this.makeDecision({
        targetId: item.hypothesisId || item.compiledTheoryId,
        targetType: "hypothesis",
        action: "revise_theory_object",
        informationGain: 4,
        cost: 1,
        time: 1,
        risk: 1,
        governance: 0,
        rationale: [`theory object is ${item.formalState}`, `missing fields: ${item.missingFormalFields.join(", ") || "none"}`],
        prerequisites: item.missingFormalFields.map((field) => `formalize ${field}`),
        recommendedAgents: ["hypothesis_generator", "theory_formalizer", "critic"],
        evidenceTrace: [{ sourceType: "theory_object", sourceId: item.compiledTheoryId, reason: "needs formalization" }],
      });
    });
  }

  private decisionsForEvidenceReview(input: ScientificDecisionEngineInput): ScientificDecisionCandidate[] {
    const review = input.evidenceReview;
    if (!review) return [];
    if (review.needsHumanAdjudication || review.conflictResolutionState === "adjudication_needed") {
      return [this.makeDecision({
        targetId: "evidence-review",
        targetType: "evidence_review",
        action: "resolve_evidence_conflicts",
        informationGain: 5,
        cost: 1,
        time: 1,
        risk: 2,
        governance: 2,
        rationale: ["evidence conflicts require adjudication before decision-grade use"],
        prerequisites: review.blockers ?? ["resolve conflict attribution"],
        recommendedAgents: ["literature_reviewer", "conflict_resolver", "lab_meeting_moderator"],
        humanReviewRequired: Boolean(review.needsHumanAdjudication),
      })];
    }
    if (review.reviewReadiness && review.reviewReadiness !== "decision_ready") {
      return [this.makeDecision({
        targetId: "evidence-review",
        targetType: "evidence_review",
        action: "strengthen_evidence_review",
        informationGain: 4,
        cost: 1,
        time: 1,
        risk: 1,
        governance: 0,
        rationale: [`evidence review readiness is ${review.reviewReadiness}`],
        prerequisites: review.blockers ?? ["complete protocol and screening records"],
        recommendedAgents: ["literature_reviewer", "evidence_curator"],
      })];
    }
    return [];
  }

  private decisionsForEvaluation(input: ScientificDecisionEngineInput): ScientificDecisionCandidate[] {
    if (input.evaluation?.decisionState !== "blocked") return [];
    return [this.makeDecision({
      targetId: "evaluation-blockers",
      targetType: "governance",
      action: "request_human_review",
      informationGain: 3,
      cost: 0,
      time: 1,
      risk: 1,
      governance: 3,
      rationale: input.evaluation.blockers,
      prerequisites: input.evaluation.regressionHints,
      recommendedAgents: ["quality_reviewer", "chief_scientist"],
      humanReviewRequired: true,
    })];
  }

  private decisionsForExperimentState(input: ScientificDecisionEngineInput): ScientificDecisionCandidate[] {
    const decision = input.experimentState?.decision;
    if (!decision || decision.status !== "needs_human_review") return [];
    return [this.makeDecision({
      targetId: "experiment-loop",
      targetType: "experiment",
      action: "request_human_review",
      informationGain: 3,
      cost: 0,
      time: 1,
      risk: 2,
      governance: 3,
      rationale: [decision.reason],
      prerequisites: ["classify failure mode before more execution"],
      recommendedAgents: ["run_manager", "quality_reviewer"],
      humanReviewRequired: true,
    })];
  }

  private makeDecision(input: {
    targetId: string;
    targetType: ScientificDecisionCandidate["targetType"];
    action: ScientificDecisionCandidate["action"];
    informationGain: number;
    cost: number;
    time: number;
    risk: number;
    governance: number;
    rationale: string[];
    prerequisites: string[];
    recommendedAgents: string[];
    evidenceTrace?: ScientificDecisionCandidate["evidenceTrace"];
    humanReviewRequired?: boolean;
  }): ScientificDecisionCandidate {
    const routeValue = input.informationGain * 3 - input.cost - input.time - input.risk - input.governance;
    return {
      id: `decision:${slug(input.targetType)}:${slug(input.targetId)}:${slug(input.action)}`,
      targetId: input.targetId,
      targetType: input.targetType,
      action: input.action,
      priority: input.humanReviewRequired ? "governance_blocking" : routeValue >= 10 ? "high" : routeValue >= 6 ? "medium" : "low",
      informationGainScore: input.informationGain,
      costScore: input.cost,
      timeScore: input.time,
      riskScore: input.risk,
      governanceBurdenScore: input.governance,
      routeValueScore: routeValue,
      rationale: dedupe(input.rationale).slice(0, 8),
      prerequisites: dedupe(input.prerequisites).slice(0, 8),
      recommendedAgents: dedupe(input.recommendedAgents).slice(0, 6),
      evidenceTrace: input.evidenceTrace ?? [],
      humanReviewRequired: input.humanReviewRequired ?? false,
    };
  }

  private overallState(decisions: ScientificDecisionCandidate[]): ScientificDecisionSummary["decisionState"] {
    if (decisions.length === 0) return "no_decision";
    if (decisions.slice(0, 3).some((item) => item.humanReviewRequired)) return "human_review_required";
    const action = decisions[0]?.action;
    if (action === "run_discriminative_test") return "ready_to_execute";
    if (action === "revise_theory_object") return "needs_theory_revision";
    if (action === "strengthen_evidence_review" || action === "resolve_evidence_conflicts") return "needs_evidence_review";
    return "continue";
  }
}

function pressureScore(value: ScientificDecisionEngineInput["costPressure"]): number {
  if (value === "high") return 2;
  if (value === "low") return 0;
  return 1;
}

function dedupe(values: string[]): string[] {
  return [...new Set(values.map((item) => item.trim()).filter(Boolean))];
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/gu, "-").replace(/^-|-$/g, "") || "item";
}
