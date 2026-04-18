export type MemoryScope = "instruction" | "personal" | "project" | "group" | "public" | "agent" | "session";
export type MemoryKind =
  | "fact"
  | "hypothesis"
  | "method"
  | "decision"
  | "dataset_note"
  | "warning"
  | "preference"
  | "reference";
export type EvidenceLevel = "anecdotal" | "preprint" | "peer_reviewed" | "replicated" | "validated" | "unknown";
export type ConfidenceLevel = "low" | "medium" | "high" | "uncertain";
export type MemoryStatus = "active" | "revised" | "deprecated" | "rejected" | "draft";
export type VisibilityLevel = "private" | "project" | "group" | "public";
export type PromotionStatus = "local_only" | "candidate" | "approved" | "shared";

export interface MemoryWriteProposal {
  scope: MemoryScope;
  kind?: MemoryKind;
  title: string;
  summary: string;
  content: string;
  tags: string[];
  evidenceLevel?: EvidenceLevel;
  confidence?: ConfidenceLevel;
  status?: MemoryStatus;
  visibility?: VisibilityLevel;
  promotionStatus?: PromotionStatus;
  sourceRefs?: string[];
  ownerAgent?: string;
  userId?: string;
  projectId?: string;
  groupId?: string;
  needsReview?: boolean;
  conflictsWith?: string[];
  supersedes?: string[];
  derivedFrom?: string[];
}
