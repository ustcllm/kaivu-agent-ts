import type { ExperimentRunRecord } from "../execution/ExperimentExecutionLoop.js";
import type { ResearchState } from "../loop/ResearchState.js";
import type { EvidenceItem, HypothesisItem } from "../shared/types.js";

export type ScientificSurpriseKind =
  | "contradictory_evidence"
  | "unexpected_failure"
  | "weak_support"
  | "artifact_gap"
  | "hypothesis_collapse";

export interface ScientificSurprise {
  id: string;
  kind: ScientificSurpriseKind;
  severity: "low" | "medium" | "high";
  summary: string;
  recommendedAction: string;
  evidenceRefs: string[];
}

export interface AnomalySurpriseDetectorInput {
  state: ResearchState;
  experimentRuns?: ExperimentRunRecord[];
}

export class AnomalySurpriseDetector {
  detect(input: AnomalySurpriseDetectorInput): ScientificSurprise[] {
    const surprises: ScientificSurprise[] = [
      ...this.detectContradictoryEvidence(input.state.evidence),
      ...this.detectWeakHypothesisSupport(input.state.hypotheses, input.state.evidence),
      ...this.detectArtifactGaps(input.state),
      ...this.detectExperimentFailures(input.experimentRuns ?? []),
    ];
    return surprises.sort((a, b) => severityWeight(b.severity) - severityWeight(a.severity));
  }

  private detectContradictoryEvidence(evidence: EvidenceItem[]): ScientificSurprise[] {
    const byClaim = new Map<string, EvidenceItem[]>();
    for (const item of evidence) {
      const key = normalizeClaim(item.claim);
      byClaim.set(key, [...(byClaim.get(key) ?? []), item]);
    }
    return [...byClaim.entries()]
      .filter(([, items]) => new Set(items.map((item) => item.strength)).size > 1)
      .map(([claim, items]) => ({
        id: `surprise-contradiction-${claim.slice(0, 24)}`,
        kind: "contradictory_evidence",
        severity: "medium",
        summary: `Evidence about "${claim}" has conflicting strength labels.`,
        recommendedAction: "Create a conflict map and ask literature review to resolve source-quality differences.",
        evidenceRefs: items.map((item) => item.id),
      }));
  }

  private detectWeakHypothesisSupport(hypotheses: HypothesisItem[], evidence: EvidenceItem[]): ScientificSurprise[] {
    if (hypotheses.length === 0 || evidence.length > 0) {
      return [];
    }
    return [{
      id: "surprise-hypothesis-without-evidence",
      kind: "weak_support",
      severity: "high",
      summary: "Hypotheses exist before any evidence has been recorded.",
      recommendedAction: "Route back to literature review or mark hypotheses as speculative.",
      evidenceRefs: [],
    }];
  }

  private detectArtifactGaps(state: ResearchState): ScientificSurprise[] {
    if (state.completedStages.includes("experiment_design") && state.artifactRefs.length === 0) {
      return [{
        id: "surprise-experiment-artifact-gap",
        kind: "artifact_gap",
        severity: "medium",
        summary: "Experiment design completed but no artifact references are attached.",
        recommendedAction: "Register protocols, execution plans, or expected artifact manifests.",
        evidenceRefs: [],
      }];
    }
    return [];
  }

  private detectExperimentFailures(runs: ExperimentRunRecord[]): ScientificSurprise[] {
    return runs
      .filter((run) => run.state === "failed")
      .map((run) => ({
        id: `surprise-failed-run-${run.id}`,
        kind: "unexpected_failure",
        severity: run.failureMode ? "medium" : "high",
        summary: run.failureMode ? `Experiment failed: ${run.failureMode}` : "Experiment failed without classified failure mode.",
        recommendedAction: "Classify failure before scheduling more runs.",
        evidenceRefs: run.evidence.map((item) => item.id),
      }));
  }
}

function normalizeClaim(claim: string): string {
  return claim.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/gu, " ").trim();
}

function severityWeight(severity: ScientificSurprise["severity"]): number {
  if (severity === "high") return 3;
  if (severity === "medium") return 2;
  return 1;
}
