import type { MemoryScope, VisibilityLevel } from "../shared/MemoryTypes.js";
import type { MemoryRecord } from "./MemoryRecord.js";
import type { SciMemory } from "./SciMemory.js";

export type MemoryMigrationAction = "auto_promote" | "propose" | "block";
export type MemoryMigrationRisk = "low" | "medium" | "high";
export type MemoryAutomationMode = "safe" | "propose_only" | "dry_run";

export interface MemoryMigrationPlanInput {
  records: MemoryRecord[];
  targetScope: MemoryScope;
  userId?: string;
  projectId?: string;
  groupId?: string;
  automationMode?: MemoryAutomationMode;
  maxItems?: number;
}

export interface MemoryMigrationDecision {
  recordId: string;
  title: string;
  sourceScope: MemoryScope;
  targetScope: MemoryScope;
  action: MemoryMigrationAction;
  riskLevel: MemoryMigrationRisk;
  confidenceScore: number;
  reasons: string[];
  requiredRole: "contributor" | "curator" | "admin";
  targetVisibility: VisibilityLevel;
}

export interface MemoryMigrationApplyResult {
  migrationState: "completed" | "failed";
  dryRun: boolean;
  applied: MemoryMigrationDecision[];
  proposed: MemoryMigrationDecision[];
  blocked: MemoryMigrationDecision[];
  failed: Array<MemoryMigrationDecision & { error: string }>;
}

export function planMemoryMigrations(input: MemoryMigrationPlanInput): MemoryMigrationDecision[] {
  const decisions = input.records
    .filter((record) => inRequestedScope(record, input))
    .filter((record) => record.scope !== input.targetScope)
    .map((record) => decisionForRecord(record, input.targetScope, input.automationMode ?? "safe"));
  return decisions
    .sort((left, right) => actionRank(left.action) - actionRank(right.action) || right.confidenceScore - left.confidenceScore)
    .slice(0, input.maxItems ?? 25);
}

export async function applyMemoryMigrationDecisions(input: {
  memory: SciMemory;
  decisions: MemoryMigrationDecision[];
  actor?: string;
  dryRun?: boolean;
}): Promise<MemoryMigrationApplyResult> {
  const dryRun = input.dryRun ?? false;
  const applied: MemoryMigrationDecision[] = [];
  const proposed: MemoryMigrationDecision[] = [];
  const blocked: MemoryMigrationDecision[] = [];
  const failed: Array<MemoryMigrationDecision & { error: string }> = [];

  for (const decision of input.decisions) {
    try {
      if (decision.action === "auto_promote") {
        if (!dryRun) {
          const promoted = await input.memory.promote({
            id: decision.recordId,
            targetScope: decision.targetScope,
            targetVisibility: decision.targetVisibility,
            approvedBy: migrationAuditTag(decision, input.actor ?? "memory-governance"),
          });
          if (!promoted) {
            failed.push({ ...decision, error: "memory record not found" });
            continue;
          }
        }
        applied.push(decision);
        continue;
      }
      if (decision.action === "propose") {
        if (!dryRun) {
          await input.memory.review({
            id: decision.recordId,
            needsReview: true,
            visibility: decision.targetVisibility,
            validatedBy: [migrationAuditTag(decision, input.actor ?? "memory-governance")],
          });
        }
        proposed.push(decision);
        continue;
      }
      if (!dryRun) {
        await input.memory.review({
          id: decision.recordId,
          needsReview: true,
          validatedBy: [migrationAuditTag(decision, input.actor ?? "memory-governance")],
        });
      }
      blocked.push(decision);
    } catch (error) {
      failed.push({ ...decision, error: error instanceof Error ? error.message : String(error) });
    }
  }

  return {
    migrationState: failed.length > 0 && applied.length === 0 && proposed.length === 0 && blocked.length === 0 ? "failed" : "completed",
    dryRun,
    applied,
    proposed,
    blocked,
    failed,
  };
}

export function migrationAuditTag(decision: MemoryMigrationDecision, actor: string): string {
  return `${decision.action}:${decision.sourceScope}->${decision.targetScope}:by:${actor}:at:${new Date().toISOString()}`;
}

function decisionForRecord(record: MemoryRecord, targetScope: MemoryScope, automationMode: MemoryAutomationMode): MemoryMigrationDecision {
  const reasons: string[] = [];
  let action: MemoryMigrationAction = "auto_promote";
  let riskLevel: MemoryMigrationRisk = "low";
  let requiredRole: MemoryMigrationDecision["requiredRole"] = requiredRoleFor(targetScope);
  const confidenceScore = confidenceScoreFor(record);

  if (record.status === "deprecated" || record.status === "rejected") {
    action = "block";
    riskLevel = "high";
    reasons.push(`record status is ${record.status}`);
  }
  if (record.conflictsWith.length > 0) {
    action = "block";
    riskLevel = "high";
    reasons.push("record has unresolved conflicts");
  }
  if (record.needsReview) {
    action = action === "block" ? action : "propose";
    riskLevel = maxRisk(riskLevel, "medium");
    reasons.push("record already requires review");
  }
  if (record.confidence === "low" || record.confidence === "uncertain" || record.evidenceLevel === "anecdotal" || record.evidenceLevel === "unknown") {
    action = action === "block" ? action : "propose";
    riskLevel = maxRisk(riskLevel, "medium");
    reasons.push("record has weak evidence or confidence");
  }
  if (isFailureOrNegativeResult(record) && (targetScope === "group" || targetScope === "public")) {
    action = action === "block" ? action : "propose";
    riskLevel = maxRisk(riskLevel, "medium");
    reasons.push("failed attempts and negative results require review before broader sharing");
  }
  if (record.scope === "personal" && ["project", "group", "public"].includes(targetScope)) {
    action = action === "block" ? action : "propose";
    riskLevel = maxRisk(riskLevel, "medium");
    reasons.push("personal memory requires review before broader sharing");
  }
  if (targetScope === "public") {
    action = action === "block" ? action : "propose";
    riskLevel = maxRisk(riskLevel, "high");
    requiredRole = "admin";
    reasons.push("public promotion always requires review");
  }
  if (looksSensitive(record)) {
    action = targetScope === "group" || targetScope === "public" ? "block" : "propose";
    riskLevel = "high";
    reasons.push("memory appears sensitive or private");
  }
  if (automationMode === "propose_only" && action === "auto_promote") {
    action = "propose";
    reasons.push("automation mode is propose_only");
  }
  if (confidenceScore < 0.72 && action === "auto_promote") {
    action = "propose";
    riskLevel = maxRisk(riskLevel, "medium");
    reasons.push("confidence score below auto-promotion threshold");
  }
  if (automationMode === "dry_run") {
    reasons.push("dry_run mode does not mutate memory");
  }
  if (action === "auto_promote" && targetScope === "group") {
    requiredRole = "curator";
  }
  if (reasons.length === 0) {
    reasons.push("record is active, non-conflicting, and sufficiently trusted");
  }

  return {
    recordId: record.id,
    title: record.title,
    sourceScope: record.scope,
    targetScope,
    action,
    riskLevel,
    confidenceScore,
    reasons: reasons.slice(0, 8),
    requiredRole,
    targetVisibility: visibilityFor(targetScope),
  };
}

function confidenceScoreFor(record: MemoryRecord): number {
  const evidence = {
    validated: 0.92,
    replicated: 0.88,
    peer_reviewed: 0.82,
    preprint: 0.68,
    unknown: 0.45,
    anecdotal: 0.25,
  }[record.evidenceLevel];
  const confidence = { high: 0.9, medium: 0.65, low: 0.25, uncertain: 0.35 }[record.confidence];
  const status = { active: 0.9, revised: 0.72, draft: 0.52, deprecated: 0.1, rejected: 0.0 }[record.status];
  const validationBonus = Math.min(0.12, record.validatedBy.length * 0.03);
  const conflictPenalty = record.conflictsWith.length > 0 ? 0.2 : 0;
  const reviewPenalty = record.needsReview ? 0.12 : 0;
  return round3(Math.max(0, Math.min(1, (evidence + confidence + status) / 3 + validationBonus - conflictPenalty - reviewPenalty)));
}

function inRequestedScope(record: MemoryRecord, input: MemoryMigrationPlanInput): boolean {
  if (input.userId && record.userId && record.userId !== input.userId) return false;
  if (input.projectId && record.projectId && record.projectId !== input.projectId) return false;
  if (input.groupId && record.groupId && record.groupId !== input.groupId) return false;
  return true;
}

function looksSensitive(record: MemoryRecord): boolean {
  const haystack = [record.title, record.summary, record.excerpt, record.tags.join(" "), record.kind, record.visibility].join(" ").toLowerCase();
  return ["private", "personal", "secret", "credential", "password", "token", "api key", "unpublished", "confidential", "patient", "human subject"].some((term) => haystack.includes(term));
}

function isFailureOrNegativeResult(record: MemoryRecord): boolean {
  const haystack = [record.title, record.summary, record.excerpt, record.tags.join(" "), record.kind].join(" ").toLowerCase();
  return record.kind === "warning" || ["failed-attempt", "negative-result", "negative result", "failed experiment", "did not replicate", "null result"].some((term) => haystack.includes(term));
}

function requiredRoleFor(scope: MemoryScope): MemoryMigrationDecision["requiredRole"] {
  if (scope === "group") return "curator";
  if (scope === "public") return "admin";
  return "contributor";
}

function visibilityFor(scope: MemoryScope): VisibilityLevel {
  if (scope === "public") return "public";
  if (scope === "group") return "group";
  if (scope === "project") return "project";
  return "private";
}

function actionRank(action: MemoryMigrationAction): number {
  return { auto_promote: 0, propose: 1, block: 2 }[action];
}

function maxRisk(left: MemoryMigrationRisk, right: MemoryMigrationRisk): MemoryMigrationRisk {
  const rank = { low: 0, medium: 1, high: 2 };
  return rank[left] >= rank[right] ? left : right;
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}
