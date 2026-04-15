import type {
  ConfidenceLevel,
  EvidenceLevel,
  MemoryKind,
  MemoryScope,
  MemoryStatus,
  PromotionStatus,
  VisibilityLevel,
} from "../shared/types.js";

export interface MemoryRecord {
  id: string;
  scope: MemoryScope;
  kind: MemoryKind;
  title: string;
  summary: string;
  content: string;
  tags: string[];
  sourceRefs: string[];
  evidenceLevel: EvidenceLevel;
  confidence: ConfidenceLevel;
  status: MemoryStatus;
  visibility: VisibilityLevel;
  promotionStatus: PromotionStatus;
  ownerAgent: string;
  userId: string;
  projectId: string;
  groupId: string;
  needsReview: boolean;
  lastVerifiedAt?: string;
  reviewDueAt?: string;
  supersedes: string[];
  supersededBy?: string;
  derivedFrom: string[];
  conflictsWith: string[];
  validatedBy: string[];
  excerpt: string;
  namespace?: string;
  createdAt: string;
  updatedAt: string;
  source: string;
}

export interface MemoryRecallInput {
  query: string;
  scopes: MemoryScope[];
  limit?: number;
  userId?: string;
  projectId?: string;
  groupId?: string;
  includeNeedsReview?: boolean;
}

export interface MemoryCommitResult {
  committed: MemoryRecord[];
  skipped: string[];
}

export interface MemoryReviewInput {
  id: string;
  status?: MemoryStatus;
  needsReview?: boolean;
  reviewDueAt?: string;
  supersededBy?: string;
  conflictsWith?: string[];
  validatedBy?: string[];
  visibility?: VisibilityLevel;
  promotionStatus?: PromotionStatus;
}

export interface MemoryPromotionInput {
  id: string;
  targetScope: MemoryScope;
  targetVisibility?: VisibilityLevel;
  approvedBy?: string;
  userId?: string;
  projectId?: string;
  groupId?: string;
}

export interface MemoryLogEntry {
  id: string;
  action: "commit" | "review" | "promote" | "compact" | "forget";
  recordId: string;
  timestamp: string;
  metadata: Record<string, unknown>;
}
