import type {
  LiteratureClaimRecord,
  LiteratureConflictGroup,
  LiteratureReviewSynthesisRecord,
} from "../literature/LiteratureKnowledgeBase.js";

export interface EvidenceReviewEngineInput {
  topic: string;
  projectId?: string;
  claims?: LiteratureClaimRecord[];
  conflictGroups?: LiteratureConflictGroup[];
  reviewSyntheses?: LiteratureReviewSynthesisRecord[];
  protocol?: {
    reviewQuestion?: string;
    inclusionLogic?: string[];
    exclusionLogic?: string[];
    evidenceTableFocus?: string[];
    screeningDecisions?: string[];
    exclusionReasons?: string[];
  };
}

export interface EvidenceReviewAssessmentRecord {
  evidenceId: string;
  claimId: string;
  qualityGrade: string;
  biasRisk: string;
  evidenceDirection: string;
  sourceCount: number;
}

export interface EvidenceReviewSummary {
  id: string;
  topic: string;
  reviewQuestion: string;
  reviewReadiness: "draft" | "screening_ready" | "analysis_ready" | "decision_ready";
  reviewQualityState: "record_building" | "needs_review" | "analysis_grade" | "decision_grade";
  protocolCompletenessScore: number;
  screeningQualityScore: number;
  evidenceGradeBalance: Record<"high" | "moderate" | "low" | "unclear", number>;
  biasRiskSummary: {
    riskCounts: Record<"high" | "moderate" | "low" | "unclear", number>;
    highRiskCount: number;
    moderateOrHighRiskCount: number;
  };
  conflictResolutionState: "none" | "mapped" | "unresolved" | "adjudication_needed";
  blockers: string[];
  recommendedActions: string[];
  assessmentRecords: EvidenceReviewAssessmentRecord[];
  needsHumanAdjudication: boolean;
}

export class EvidenceReviewEngine {
  review(input: EvidenceReviewEngineInput): EvidenceReviewSummary {
    const claims = input.claims ?? [];
    const conflicts = input.conflictGroups ?? [];
    const protocol = input.protocol ?? {};
    const protocolScore = scoreBooleans([
      Boolean(protocol.reviewQuestion),
      Boolean(protocol.inclusionLogic?.length),
      Boolean(protocol.exclusionLogic?.length),
      Boolean(protocol.evidenceTableFocus?.length),
    ]);
    const screeningScore = scoreBooleans([
      claims.length > 0,
      Boolean(protocol.screeningDecisions?.length),
      Boolean(protocol.exclusionReasons?.length),
      claims.some((claim) => claim.sourceIds.length > 0),
    ]);
    const gradeBalance = gradeBalanceOf(claims);
    const biasRiskSummary = biasRiskOf(claims);
    const conflictResolutionState = conflictStateOf(conflicts);
    const blockers = blockersOf(protocolScore, screeningScore, gradeBalance, biasRiskSummary, conflictResolutionState);
    const reviewReadiness = readinessOf(protocolScore, screeningScore, gradeBalance, biasRiskSummary, conflictResolutionState, blockers);
    const reviewQualityState = qualityStateOf(reviewReadiness, protocolScore, screeningScore, biasRiskSummary);
    return {
      id: `evidence-review:${slug(input.projectId ?? "workspace")}:${slug(input.topic)}`,
      topic: input.topic,
      reviewQuestion: protocol.reviewQuestion ?? input.reviewSyntheses?.at(-1)?.topic ?? input.topic,
      reviewReadiness,
      reviewQualityState,
      protocolCompletenessScore: protocolScore,
      screeningQualityScore: screeningScore,
      evidenceGradeBalance: gradeBalance,
      biasRiskSummary,
      conflictResolutionState,
      blockers,
      recommendedActions: recommendedActionsOf(blockers, conflictResolutionState, biasRiskSummary, gradeBalance),
      assessmentRecords: claims.map((claim) => ({
        evidenceId: claim.sourceIds[0] ?? "",
        claimId: claim.id,
        qualityGrade: claim.qualityGrade,
        biasRisk: claim.biasRisk,
        evidenceDirection: claim.evidenceDirection,
        sourceCount: claim.sourceIds.length,
      })),
      needsHumanAdjudication: conflictResolutionState === "adjudication_needed" || biasRiskSummary.highRiskCount > 0,
    };
  }
}

function scoreBooleans(values: boolean[]): number {
  return Math.round((values.filter(Boolean).length / Math.max(1, values.length)) * 1000) / 1000;
}

function gradeBalanceOf(claims: LiteratureClaimRecord[]): EvidenceReviewSummary["evidenceGradeBalance"] {
  const counts = { high: 0, moderate: 0, low: 0, unclear: 0 };
  for (const claim of claims) counts[claim.qualityGrade] += 1;
  return counts;
}

function biasRiskOf(claims: LiteratureClaimRecord[]): EvidenceReviewSummary["biasRiskSummary"] {
  const riskCounts = { high: 0, moderate: 0, low: 0, unclear: 0 };
  for (const claim of claims) riskCounts[claim.biasRisk] += 1;
  return {
    riskCounts,
    highRiskCount: riskCounts.high,
    moderateOrHighRiskCount: riskCounts.high + riskCounts.moderate,
  };
}

function conflictStateOf(conflicts: LiteratureConflictGroup[]): EvidenceReviewSummary["conflictResolutionState"] {
  if (conflicts.some((item) => item.status === "adjudication_needed")) return "adjudication_needed";
  if (conflicts.some((item) => item.status === "unresolved")) return "unresolved";
  if (conflicts.some((item) => item.status === "mapped")) return "mapped";
  return "none";
}

function blockersOf(
  protocolScore: number,
  screeningScore: number,
  gradeBalance: EvidenceReviewSummary["evidenceGradeBalance"],
  bias: EvidenceReviewSummary["biasRiskSummary"],
  conflictState: EvidenceReviewSummary["conflictResolutionState"],
): string[] {
  const blockers: string[] = [];
  if (protocolScore < 0.75) blockers.push("Review protocol is incomplete.");
  if (screeningScore < 0.7) blockers.push("Screening and evidence table records are incomplete.");
  if (!Object.values(gradeBalance).some((count) => count > 0)) blockers.push("No evidence has been graded yet.");
  if (bias.highRiskCount > 0) blockers.push("High bias-risk evidence requires adjudication before decision use.");
  if (conflictState === "unresolved" || conflictState === "adjudication_needed") blockers.push("Evidence conflicts need resolution or explicit attribution.");
  return blockers;
}

function readinessOf(
  protocolScore: number,
  screeningScore: number,
  gradeBalance: EvidenceReviewSummary["evidenceGradeBalance"],
  bias: EvidenceReviewSummary["biasRiskSummary"],
  conflictState: EvidenceReviewSummary["conflictResolutionState"],
  blockers: string[],
): EvidenceReviewSummary["reviewReadiness"] {
  const highOrModerate = gradeBalance.high + gradeBalance.moderate;
  if (protocolScore >= 0.75 && screeningScore >= 0.7 && highOrModerate > 0) {
    if (blockers.length === 0 || (bias.highRiskCount === 0 && ["none", "mapped"].includes(conflictState))) return "decision_ready";
    return "analysis_ready";
  }
  if (protocolScore >= 0.6 && (screeningScore >= 0.4 || highOrModerate > 0)) return "analysis_ready";
  if (protocolScore >= 0.5) return "screening_ready";
  return "draft";
}

function qualityStateOf(
  readiness: EvidenceReviewSummary["reviewReadiness"],
  protocolScore: number,
  screeningScore: number,
  bias: EvidenceReviewSummary["biasRiskSummary"],
): EvidenceReviewSummary["reviewQualityState"] {
  if (readiness === "decision_ready") return "decision_grade";
  if (readiness === "analysis_ready" && bias.highRiskCount === 0) return "analysis_grade";
  if (protocolScore < 0.5 || screeningScore < 0.4) return "record_building";
  return "needs_review";
}

function recommendedActionsOf(
  blockers: string[],
  conflictState: EvidenceReviewSummary["conflictResolutionState"],
  bias: EvidenceReviewSummary["biasRiskSummary"],
  gradeBalance: EvidenceReviewSummary["evidenceGradeBalance"],
): string[] {
  const actions = blockers.map((blocker) => `Repair blocker: ${blocker}`);
  if (!Object.values(gradeBalance).some((count) => count > 0)) actions.push("Grade evidence quality for each cited source or claim.");
  if (bias.moderateOrHighRiskCount > 0) actions.push("Attach bias mitigation notes or downgrade affected evidence.");
  if (conflictState !== "none") actions.push("Run conflict attribution and record why sources disagree.");
  if (actions.length === 0) actions.push("Use this review to prioritize discriminative hypotheses and experiments.");
  return [...new Set(actions)].slice(0, 10);
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/gu, "-").replace(/^-|-$/g, "") || "review";
}
