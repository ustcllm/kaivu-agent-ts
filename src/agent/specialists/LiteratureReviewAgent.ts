import { makeId } from "../../shared/ids.js";
import type { ArtifactRef, StageResult } from "../../shared/types.js";
import type { LiteratureSource } from "../../literature/LiteraturePolicy.js";
import { BaseSpecialistAgent, type SpecialistRunInput } from "../SpecialistAgent.js";

export class LiteratureReviewAgent extends BaseSpecialistAgent {
  id = "literature_review_agent";
  stage = "literature_review" as const;
  description = "Builds literature digests, claim tables, conflict maps, and evidence gaps.";

  async run(input: SpecialistRunInput): Promise<StageResult> {
    const sourceIngests = this.ingestProvidedSources(input);
    const task = input.plan.inputs.task as { question?: string; discipline?: string } | undefined;
    const framedPlan = this.extractFramedLiteraturePlan(input);
    const languagePolicy = framedPlan.languagePolicy;
    const searchQueries = framedPlan.searchQueries;
    if (searchQueries.length === 0 || !languagePolicy) {
      return this.missingFramedSearchPlan(input, task);
    }
    input.onProgress?.({
      label: "Use framed literature queries",
      detail: "Loaded Immediate Literature Queries produced by the problem framing stage.",
      data: {
        queryCount: searchQueries.length,
        queries: searchQueries.map((item) => `[${item.language}] ${item.query}`),
      },
    });
    const searchSteps = this.planSearchSteps(searchQueries);
    input.onProgress?.({
      label: "Prepare literature search",
      detail: "Mapped each framed query to literature retrieval tools.",
      data: {
        tools: searchSteps.tools,
        queryCount: searchSteps.steps.length,
      },
    });
    for (const step of searchSteps.steps) {
      input.onProgress?.({
        label: `Search query ${step.index}/${searchSteps.steps.length}`,
        detail: step.query,
        data: {
          language: step.language,
          purpose: step.purpose,
          tools: step.tools,
          status: "planned retrieval",
        },
      });
    }
    input.onProgress?.({
      label: "Collect candidate sources",
      detail: "Queued retrieval results and provided sources for digest synthesis.",
      data: {
        plannedQueryCount: searchSteps.steps.length,
        providedSourceCount: sourceIngests.length,
      },
    });
    const summary = await this.modelSummary(
      input,
      [
        `Create a literature review digest for: ${input.plan.objective}.`,
        `Use these initial search queries as the search plan: ${searchQueries.map((item) => `[${item.language}] ${item.query}`).join(" | ")}.`,
        `Language policy: primary=${languagePolicy.primarySearchLanguage}; input=${languagePolicy.inputLanguage}; reason=${languagePolicy.reason}`,
        "Include search scope, source selection, consensus claims, conflicts, quality caveats, and evidence gaps.",
      ].join("\n"),
    );
    input.onProgress?.({
      label: "Digest literature evidence",
      detail: "Synthesized retrieved/planned literature context into a review digest.",
      data: {
        providedSources: sourceIngests.map((item) => item.source.title),
        digestTool: "literature_digest_synthesis",
      },
    });
    const literatureSummary =
      sourceIngests.length > 0
        ? `\n\nIngested literature sources: ${sourceIngests.map((item) => item.source.title).join("; ")}`
        : "";
    return {
      stage: this.stage,
      specialistId: this.id,
      summary: `${summary}${literatureSummary}`,
      processTrace: [
        {
          label: "Build search plan",
          status: "completed",
          detail: "Derived targeted literature queries from the framed problem.",
          data: {
            input: {
              framedQuestion: task?.question ?? input.plan.objective,
              discipline: task?.discipline ?? "general_science",
              languagePolicy,
            },
            output: {
              searchQueries,
              searchSteps,
              note: "Search execution is displayed as planned retrieval steps until real search tools are connected.",
            },
          },
        },
        {
          label: "Check provided sources",
          status: sourceIngests.length > 0 ? "completed" : "skipped",
          detail: sourceIngests.length > 0 ? "Ingested user-provided sources before synthesis." : "No user-provided sources were attached to this task.",
          data: {
            sourceCount: sourceIngests.length,
            sourceTitles: sourceIngests.map((item) => item.source.title),
            literatureWrites: sourceIngests.map((item) => ({
              sourceId: item.source.id,
              title: item.source.title,
              digestId: item.digest.id,
              digestConfirmed: item.digest.confirmed,
              wikiPageId: `source:${item.source.id}`,
              memoryTargetScope: item.memoryProposal.scope,
              memoryTitle: item.memoryProposal.title,
              requiresReview: item.memoryProposal.needsReview ?? false,
            })),
          },
        },
        {
          label: "Synthesize digest",
          status: "completed",
          detail: "Asked the literature specialist model to summarize consensus, conflicts, and gaps.",
          data: {
            digestPreview: summary.slice(0, 420),
          },
        },
        {
          label: "Extract evidence gaps",
          status: "completed",
          detail: "Marked the review as provisional until real search tools return source-backed claims.",
          data: {
            caveat: "External literature search tools are represented as runtime capabilities; actual search execution is still scaffolded.",
            storage: {
              literatureKnowledgeBase: ["citation library", "digest records", "source wiki pages"],
              memory: "project/reference memory proposal titled Literature review digest",
            },
          },
        },
      ],
      evidence: [
        {
          id: makeId("evidence-literature"),
          claim: "Literature review requires source-backed claims and explicit uncertainty.",
          source: "literature_review_agent",
          strength: "unknown",
          uncertainty: "placeholder until real literature tools are connected",
        },
      ],
      hypotheses: [],
      artifacts: [],
      memoryProposals: [
        ...sourceIngests.map((item) => item.memoryProposal),
        {
          scope: "project",
          kind: "reference",
          title: "Literature review digest",
          summary: summary.slice(0, 220),
          content: summary,
          tags: ["literature", "digest"],
        },
      ],
      graphProposals: [],
      decision: {
        status: "advance",
        nextStage: "hypothesis_generation",
        reason: "Initial literature digest is available for hypothesis generation.",
        confidence: "medium",
      },
    };
  }

  private ingestProvidedSources(input: SpecialistRunInput) {
    if (!input.literature) {
      return [];
    }
    const task = input.plan.inputs.task as { constraints?: Record<string, unknown> } | undefined;
    const sourcesFromPlan = input.plan.inputs.literatureSources;
    const sourcesFromTask = task?.constraints?.literatureSources;
    const sources = Array.isArray(sourcesFromPlan)
      ? (sourcesFromPlan as LiteratureSource[])
      : Array.isArray(sourcesFromTask)
        ? (sourcesFromTask as LiteratureSource[])
        : [];
    return sources.map((source) =>
      input.literature!.ingest({
        source,
        mode: input.plan.inputs.literatureIngestMode === "autonomous" ? "autonomous" : "auto",
        targetScope: "project",
        confidence: "medium",
        researchMode: input.plan.inputs.researchMode === "autonomous" ? "autonomous" : "interactive",
      }),
    );
  }

  private extractFramedLiteraturePlan(input: SpecialistRunInput): {
    searchQueries: Array<{ query: string; language: string; purpose: string }>;
    languagePolicy?: { inputLanguage: string; primarySearchLanguage: string; reason: string };
  } {
    const state = input.researchState as { artifactRefs?: ArtifactRef[] };
    const problemFrame = state.artifactRefs?.find((artifact) => artifact.id === "problem_frame");
    const metadata = problemFrame?.metadata ?? {};
    const searchQueries = Array.isArray(metadata.searchQueries)
      ? metadata.searchQueries.filter(isSearchQuery)
      : [];
    const languagePolicy = isLanguagePolicy(metadata.languagePolicy) ? metadata.languagePolicy : undefined;
    return { searchQueries, languagePolicy };
  }

  private planSearchSteps(searchQueries: Array<{ query: string; language: string; purpose: string }>) {
    const tools = ["arxiv_search", "crossref_search", "pubmed_search"];
    return {
      tools,
      steps: searchQueries.map((item, index) => ({
        index: index + 1,
        query: item.query,
        language: item.language,
        purpose: item.purpose,
        tools,
      })),
    };
  }

  private missingFramedSearchPlan(input: SpecialistRunInput, task?: { question?: string; discipline?: string }): StageResult {
    const summary = "Literature review cannot start because the previous problem framing output did not provide Immediate Literature Queries.";
    return {
      stage: this.stage,
      specialistId: this.id,
      summary,
      processTrace: [
        {
          label: "Load framed literature queries",
          status: "blocked",
          detail: "Expected problem_frame.metadata.searchQueries from the problem framing stage, but it was missing or empty.",
          data: {
            framedQuestion: task?.question ?? input.plan.objective,
            discipline: task?.discipline ?? "general_science",
            requiredSection: "Immediate Literature Queries",
          },
        },
      ],
      evidence: [],
      hypotheses: [],
      artifacts: [],
      memoryProposals: [],
      graphProposals: [],
      decision: {
        status: "needs_human_review",
        nextStage: "problem_framing",
        reason: "Please revise problem framing so it includes Immediate Literature Queries before continuing literature review.",
        confidence: "high",
      },
    };
  }
}

function isSearchQuery(value: unknown): value is { query: string; language: string; purpose: string } {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as Record<string, unknown>).query === "string" &&
    typeof (value as Record<string, unknown>).language === "string" &&
    typeof (value as Record<string, unknown>).purpose === "string"
  );
}

function isLanguagePolicy(value: unknown): value is { inputLanguage: string; primarySearchLanguage: string; reason: string } {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as Record<string, unknown>).inputLanguage === "string" &&
    typeof (value as Record<string, unknown>).primarySearchLanguage === "string" &&
    typeof (value as Record<string, unknown>).reason === "string"
  );
}
