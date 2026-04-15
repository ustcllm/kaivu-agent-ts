import { makeId } from "../shared/ids.js";
import type { GraphWriteProposal } from "../shared/types.js";

export interface ResearchGraphNode {
  id: string;
  type: string;
  label: string;
  projectId?: string;
  topic?: string;
  metadata: Record<string, unknown>;
}

export interface ResearchGraphEdge {
  id: string;
  sourceId: string;
  targetId: string;
  relation: string;
  projectId?: string;
  topic?: string;
  metadata: Record<string, unknown>;
}

export interface ProvenanceFact {
  id: string;
  type: string;
  subjectId: string;
  predicate: string;
  objectId?: string;
  value?: unknown;
  projectId?: string;
  topic?: string;
  confidence: number;
  sourceRefs: string[];
  producedBy?: string;
  status: "active" | "revised" | "deprecated" | "rejected";
  metadata: Record<string, unknown>;
}

export interface ProvenanceEvent {
  id: string;
  type: string;
  factIds: string[];
  actor?: string;
  action?: string;
  projectId?: string;
  topic?: string;
  metadata: Record<string, unknown>;
  timestamp: string;
}

export interface GraphSearchResult {
  id: string;
  label: string;
  summary: string;
  metadata: Record<string, unknown>;
}

export class ResearchGraphRegistry {
  private readonly nodes = new Map<string, ResearchGraphNode>();
  private readonly edges = new Map<string, ResearchGraphEdge>();
  private readonly facts = new Map<string, ProvenanceFact>();
  private readonly events: ProvenanceEvent[] = [];

  upsertNode(input: Omit<ResearchGraphNode, "id"> & { id?: string }): ResearchGraphNode {
    const id = input.id ?? makeId(`node-${input.type}`);
    const node: ResearchGraphNode = { ...input, id, metadata: { ...input.metadata } };
    this.nodes.set(id, node);
    return node;
  }

  addEdge(input: Omit<ResearchGraphEdge, "id"> & { id?: string }): ResearchGraphEdge {
    const id = input.id ?? makeId(`edge-${input.relation}`);
    const edge: ResearchGraphEdge = { ...input, id, metadata: { ...input.metadata } };
    this.edges.set(id, edge);
    return edge;
  }

  addFact(input: Omit<ProvenanceFact, "id"> & { id?: string }): ProvenanceFact {
    const id = input.id ?? makeId(`fact-${input.type}`);
    const fact: ProvenanceFact = {
      ...input,
      id,
      confidence: input.confidence ?? 1,
      sourceRefs: [...input.sourceRefs],
      status: input.status ?? "active",
      metadata: { ...input.metadata },
    };
    this.facts.set(id, fact);
    return fact;
  }

  recordEvent(input: Omit<ProvenanceEvent, "id" | "timestamp"> & { id?: string }): ProvenanceEvent {
    const event: ProvenanceEvent = {
      ...input,
      id: input.id ?? makeId(`provenance-event-${input.type}`),
      timestamp: new Date().toISOString(),
      factIds: [...input.factIds],
      metadata: { ...input.metadata },
    };
    this.events.push(event);
    return event;
  }

  applyGraphProposals(proposals: GraphWriteProposal[], source: string): ProvenanceFact[] {
    const facts = proposals.map((proposal) =>
      this.addFact({
        type: "graph_proposal",
        subjectId: proposal.subject,
        predicate: proposal.predicate,
        objectId: proposal.object,
        confidence: 0.8,
        sourceRefs: proposal.evidenceIds,
        producedBy: source,
        status: "active",
        metadata: {},
      }),
    );
    this.recordEvent({
      type: "graph_update",
      factIds: facts.map((fact) => fact.id),
      actor: source,
      action: "apply_graph_proposals",
      metadata: { proposalCount: proposals.length },
    });
    return facts;
  }

  search(query: string, options: { projectId?: string; limit?: number } = {}): GraphSearchResult[] {
    const terms = query.toLowerCase().split(/[^a-z0-9\u4e00-\u9fff]+/u).filter(Boolean);
    return [...this.nodes.values()]
      .filter((node) => !options.projectId || node.projectId === options.projectId)
      .map((node) => {
        const summary = String(node.metadata.summary ?? JSON.stringify(node.metadata));
        const haystack = `${node.label} ${node.type} ${summary}`.toLowerCase();
        const score = terms.reduce((count, term) => count + (haystack.includes(term) ? 1 : 0), 0);
        return { node, summary, score };
      })
      .filter((item) => item.score > 0 || terms.length === 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, options.limit ?? 8)
      .map(({ node, summary }) => ({
        id: node.id,
        label: node.label,
        summary,
        metadata: { type: node.type, projectId: node.projectId, topic: node.topic, ...node.metadata },
      }));
  }

  summary(projectId?: string): { claimCount: number; hypothesisCount: number; negativeResultCount: number; nodeCount: number; edgeCount: number; factCount: number } {
    const nodes = [...this.nodes.values()].filter((node) => !projectId || node.projectId === projectId);
    const facts = [...this.facts.values()].filter((fact) => !projectId || fact.projectId === projectId);
    return {
      claimCount: nodes.filter((node) => node.type === "claim").length + facts.filter((fact) => fact.type === "claim").length,
      hypothesisCount: nodes.filter((node) => node.type === "hypothesis").length + facts.filter((fact) => fact.type === "hypothesis").length,
      negativeResultCount: nodes.filter((node) => node.type === "negative_result").length,
      nodeCount: nodes.length,
      edgeCount: [...this.edges.values()].filter((edge) => !projectId || edge.projectId === projectId).length,
      factCount: facts.length,
    };
  }

  snapshot() {
    return {
      nodes: [...this.nodes.values()],
      edges: [...this.edges.values()],
      facts: [...this.facts.values()],
      events: [...this.events],
    };
  }
}
