import type { ScientificEvaluationResult } from "../evaluation/ScientificEvaluationHarness.js";
import type { ExperimentRunRecord } from "../execution/ExperimentExecutionLoop.js";
import type { MemoryRecord } from "../memory/MemoryRecord.js";
import type { ArtifactRef, EvidenceItem, HypothesisItem } from "../shared/types.js";

export type ScientificAssetKind =
  | "artifact"
  | "evidence"
  | "hypothesis"
  | "memory"
  | "experiment_run"
  | "evaluation";

export interface ScientificAsset {
  id: string;
  kind: ScientificAssetKind;
  title: string;
  summary: string;
  uri?: string;
  metadata: Record<string, unknown>;
}

export interface ScientificAssetLink {
  sourceId: string;
  predicate: "supports" | "tests" | "produced" | "derived_from" | "evaluates" | "records";
  targetId: string;
}

export interface ScientificAssetRegistryInput {
  artifacts?: ArtifactRef[];
  evidence?: EvidenceItem[];
  hypotheses?: HypothesisItem[];
  memory?: MemoryRecord[];
  experimentRuns?: ExperimentRunRecord[];
  evaluation?: ScientificEvaluationResult;
}

export interface ScientificAssetRegistrySnapshot {
  assets: ScientificAsset[];
  links: ScientificAssetLink[];
}

export class ScientificAssetRegistry {
  build(input: ScientificAssetRegistryInput): ScientificAssetRegistrySnapshot {
    const assets: ScientificAsset[] = [];
    const links: ScientificAssetLink[] = [];

    for (const artifact of input.artifacts ?? []) {
      assets.push({
        id: artifact.id,
        kind: "artifact",
        title: artifact.kind,
        summary: artifact.uri,
        uri: artifact.uri,
        metadata: artifact.metadata ?? {},
      });
    }
    for (const item of input.evidence ?? []) {
      assets.push({
        id: item.id,
        kind: "evidence",
        title: item.claim,
        summary: `${item.strength} evidence from ${item.source}`,
        metadata: { uncertainty: item.uncertainty ?? "" },
      });
    }
    for (const hypothesis of input.hypotheses ?? []) {
      assets.push({
        id: hypothesis.id,
        kind: "hypothesis",
        title: hypothesis.statement,
        summary: `status=${hypothesis.status}; predictions=${hypothesis.predictions.length}`,
        metadata: { assumptions: hypothesis.assumptions, falsificationTests: hypothesis.falsificationTests },
      });
      for (const evidence of input.evidence ?? []) {
        if (hypothesis.statement.toLowerCase().includes(evidence.claim.toLowerCase().slice(0, 24))) {
          links.push({ sourceId: evidence.id, predicate: "supports", targetId: hypothesis.id });
        }
      }
    }
    for (const memory of input.memory ?? []) {
      assets.push({
        id: memory.id,
        kind: "memory",
        title: memory.title,
        summary: memory.summary,
        metadata: {
          scope: memory.scope,
          confidence: memory.confidence,
          status: memory.status,
          sourceRefs: memory.sourceRefs,
        },
      });
      for (const sourceRef of memory.sourceRefs) {
        links.push({ sourceId: memory.id, predicate: "derived_from", targetId: sourceRef });
      }
    }
    for (const run of input.experimentRuns ?? []) {
      assets.push({
        id: run.id,
        kind: "experiment_run",
        title: `${run.candidateId} ${run.state}`,
        summary: run.failureMode ?? run.observations.at(-1) ?? "experiment run",
        metadata: { startedAt: run.startedAt, completedAt: run.completedAt, qualityNotes: run.qualityNotes ?? [] },
      });
      for (const artifact of run.artifacts) {
        links.push({ sourceId: run.id, predicate: "produced", targetId: artifact.id });
      }
      for (const evidence of run.evidence) {
        links.push({ sourceId: run.id, predicate: "produced", targetId: evidence.id });
      }
    }
    if (input.evaluation) {
      assets.push({
        id: "scientific-evaluation",
        kind: "evaluation",
        title: `evaluation ${input.evaluation.decisionState}`,
        summary: `overallScore=${input.evaluation.overallScore}`,
        metadata: { blockers: input.evaluation.blockers, axisScores: input.evaluation.axisScores },
      });
      for (const asset of assets.filter((item) => item.kind !== "evaluation")) {
        links.push({ sourceId: "scientific-evaluation", predicate: "evaluates", targetId: asset.id });
      }
    }

    return { assets: dedupeAssets(assets), links: dedupeLinks(links) };
  }
}

function dedupeAssets(assets: ScientificAsset[]): ScientificAsset[] {
  return [...new Map(assets.map((asset) => [asset.id, asset])).values()];
}

function dedupeLinks(links: ScientificAssetLink[]): ScientificAssetLink[] {
  return [...new Map(links.map((link) => [`${link.sourceId}:${link.predicate}:${link.targetId}`, link])).values()];
}
