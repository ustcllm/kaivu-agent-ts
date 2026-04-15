import { makeId } from "../shared/ids.js";
import type { MemoryWriteProposal } from "../shared/types.js";
import {
  decideLiteratureIngestPolicy,
  renderLiteratureDigest,
  type LiteratureIngestPolicy,
  type LiteratureIngestRequest,
  type LiteratureSource,
} from "./LiteraturePolicy.js";

export interface CitationRecord {
  key: string;
  title: string;
  doi?: string;
  url?: string;
  authors: string[];
  publishedAt?: string;
  sourceType: string;
  abstract?: string;
}

export interface LiteratureDigestRecord {
  id: string;
  sourceId: string;
  title: string;
  digestMarkdown: string;
  policy: LiteratureIngestPolicy;
  createdAt: string;
  confirmed: boolean;
}

export interface LiteratureWikiPage {
  id: string;
  title: string;
  summary: string;
  sourceIds: string[];
  tags: string[];
  updatedAt: string;
}

export interface LiteratureIngestResult {
  source: LiteratureSource;
  digest: LiteratureDigestRecord;
  memoryProposal: MemoryWriteProposal;
  autoCommitted: boolean;
}

export class LiteratureKnowledgeBase {
  private readonly citations = new Map<string, CitationRecord>();
  private readonly digests: LiteratureDigestRecord[] = [];
  private readonly pages = new Map<string, LiteratureWikiPage>();

  ingest(request: LiteratureIngestRequest): LiteratureIngestResult {
    const policy = decideLiteratureIngestPolicy(request);
    const citation = toCitationRecord(request.source);
    this.citations.set(citation.key, citation);

    const digest: LiteratureDigestRecord = {
      id: makeId("literature-digest"),
      sourceId: request.source.id,
      title: request.source.title,
      digestMarkdown: renderLiteratureDigest(request, policy),
      policy,
      createdAt: new Date().toISOString(),
      confirmed: !policy.requiresConfirmation,
    };
    this.digests.push(digest);

    const page = this.upsertSourcePage(request.source, digest);
    const memoryProposal: MemoryWriteProposal = {
      scope: policy.targetScope,
      kind: "reference",
      title: `Literature: ${request.source.title}`,
      summary: page.summary,
      content: digest.digestMarkdown,
      tags: ["literature", "digest", request.source.sourceType],
      evidenceLevel: request.source.sourceType === "paper" ? "peer_reviewed" : request.source.sourceType === "preprint" ? "preprint" : "unknown",
      confidence: request.confidence ?? "medium",
      status: policy.needsReview ? "draft" : "active",
      visibility: policy.targetScope === "group" ? "group" : policy.targetScope === "public" ? "public" : policy.targetScope === "project" ? "project" : "private",
      promotionStatus: policy.needsReview ? "candidate" : "approved",
      sourceRefs: [citation.key],
      needsReview: policy.needsReview,
    };

    return {
      source: request.source,
      digest,
      memoryProposal,
      autoCommitted: !policy.requiresConfirmation,
    };
  }

  confirmDigest(digestId: string): LiteratureDigestRecord | undefined {
    const digest = this.digests.find((item) => item.id === digestId);
    if (!digest) return undefined;
    digest.confirmed = true;
    return digest;
  }

  search(query: string, limit = 6): LiteratureWikiPage[] {
    const terms = query.toLowerCase().split(/[^a-z0-9\u4e00-\u9fff]+/u).filter(Boolean);
    return [...this.pages.values()]
      .map((page) => {
        const haystack = `${page.title} ${page.summary} ${page.tags.join(" ")}`.toLowerCase();
        const score = terms.reduce((count, term) => count + (haystack.includes(term) ? 1 : 0), 0);
        return { page, score };
      })
      .filter((item) => item.score > 0 || terms.length === 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map((item) => item.page);
  }

  renderIndex(): string {
    const lines = ["# Literature Wiki Index", ""];
    for (const page of this.pages.values()) {
      lines.push(`- ${page.title} (${page.id}) - ${page.summary}`);
    }
    return lines.join("\n");
  }

  citationLibrary(): CitationRecord[] {
    return [...this.citations.values()];
  }

  digestSnapshot(): LiteratureDigestRecord[] {
    return this.digests.map((digest) => ({ ...digest, policy: { ...digest.policy, reasons: [...digest.policy.reasons] } }));
  }

  private upsertSourcePage(source: LiteratureSource, digest: LiteratureDigestRecord): LiteratureWikiPage {
    const pageId = `source:${source.id}`;
    const page: LiteratureWikiPage = {
      id: pageId,
      title: source.title,
      summary: summarizeSource(source),
      sourceIds: [source.id],
      tags: ["source", source.sourceType, digest.policy.writeTarget],
      updatedAt: new Date().toISOString(),
    };
    this.pages.set(pageId, page);
    return page;
  }
}

function toCitationRecord(source: LiteratureSource): CitationRecord {
  const normalizedDoi = source.doi?.trim().toLowerCase();
  const key = normalizedDoi ? `doi:${normalizedDoi}` : source.url ? `url:${source.url.toLowerCase()}` : `title:${source.title.toLowerCase()}`;
  return {
    key,
    title: source.title,
    doi: normalizedDoi,
    url: source.url,
    authors: source.authors ?? [],
    publishedAt: source.publishedAt,
    sourceType: source.sourceType,
    abstract: source.content.slice(0, 1000),
  };
}

function summarizeSource(source: LiteratureSource): string {
  const clipped = source.content.trim().replace(/\s+/g, " ").slice(0, 260);
  return clipped || `${source.sourceType} source awaiting digest`;
}
