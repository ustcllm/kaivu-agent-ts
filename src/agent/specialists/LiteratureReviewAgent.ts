import { makeId } from "../../shared/ids.js";
import type { ArtifactRef, StageResult } from "../../shared/types.js";
import type { LiteratureReviewSynthesisInput, LiteratureStructuredExtraction } from "../../literature/LiteratureKnowledgeBase.js";
import type { LiteratureSource } from "../../literature/LiteraturePolicy.js";
import {
  parseStructuredOutput,
  repairInstruction,
  salvageStructuredOutput,
  schemaInstruction,
  type StructuredSchema,
} from "../../structured/StructuredOutput.js";
import { BaseSpecialistAgent, type ModelStepRunner, type SpecialistRunInput } from "../SpecialistAgent.js";

export class LiteratureReviewAgent extends BaseSpecialistAgent {
  id = "literature_review_agent";
  stage = "literature_review" as const;
  description = "Builds literature digests, claim tables, conflict maps, and evidence gaps.";

  async run(input: SpecialistRunInput): Promise<StageResult> {
    const sourceIngests = this.ingestProvidedSources(input);
    const task = input.plan.inputs.task as { question?: string; discipline?: string } | undefined;
    const problemFrameArtifact = this.findProblemFrameArtifact(input);
    if (!hasProblemFrameArtifactMetadata(problemFrameArtifact?.metadata)) {
      return this.missingProblemFrame(input, task);
    }
    const problemFrame = readProblemFrameArtifact(problemFrameArtifact);
    input.onProgress?.({
      label: "Generate literature query plan",
      detail: "Using the framed problem to ask the literature agent model for database-ready English search queries.",
      data: {
        discipline: problemFrame.discipline,
        objective: problemFrame.objective,
        successCriteria: problemFrame.successCriteria,
      },
    });
    const generatedPlan = await this.generateLiteratureQueryPlan(input, problemFrame);
    const normalizedQueries = normalizeGeneratedLiteratureQueries(generatedPlan.plan.queries, problemFrame);
    const searchSettings = literatureSearchSettings(input);
    const searchQueries = normalizedQueries.accepted.slice(0, searchSettings.maxAcceptedQueries);
    const deferredQueries = normalizedQueries.accepted.slice(searchSettings.maxAcceptedQueries);
    if (searchQueries.length === 0) {
      return this.missingGeneratedSearchPlan(input, task, generatedPlan, normalizedQueries.rejected);
    }
    input.onProgress?.({
      label: "Validate literature queries",
      detail: "Accepted model-generated queries and rejected low-quality or unsupported query strings.",
      data: {
        queryCount: searchQueries.length,
        queries: searchQueries.map((item) => `[${item.language}] ${item.query}`),
        deferredQueries: deferredQueries.map((item) => `[${item.language}] ${item.query}`),
        rejectedQueries: normalizedQueries.rejected,
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
    const retrievalResults = await this.searchArxiv(input, searchSteps.steps, searchSettings.perQueryLimit, 0);
    const initialCandidates = collectCandidatePapers(retrievalResults, 0, "query_search");
    const initialScreening = await this.screenCandidatePapers(input, problemFrame, initialCandidates, "initial_search");
    let usefulPapers = initialScreening.usefulPapers;
    const expansionSummaries: LiteratureExpansionSummary[] = [];
    for (let round = 1; round <= searchSettings.referenceExpansionRounds; round += 1) {
      const expansionQueries = await this.generateReferenceExpansionQueries(input, problemFrame, usefulPapers, round);
      if (expansionQueries.length === 0) {
        expansionSummaries.push({ round, queries: [], searchedPaperCount: 0, usefulPaperCount: 0, note: "No reference-expansion queries were generated from useful seed papers." });
        break;
      }
      const expansionSteps = expansionQueries.slice(0, searchSettings.maxExpansionQueriesPerRound).map((item, index) => ({
        index: index + 1,
        query: item.query,
        language: "en",
        purpose: item.purpose,
        tools: ["arxiv_search"],
      }));
      const roundResults = await this.searchArxiv(input, expansionSteps, searchSettings.perQueryLimit, round);
      retrievalResults.push(...roundResults);
      const roundCandidates = collectCandidatePapers(roundResults, round, "reference_title_expansion");
      const roundScreening = await this.screenCandidatePapers(input, problemFrame, roundCandidates, `reference_expansion_round_${round}`);
      const before = usefulPapers.length;
      usefulPapers = mergeUsefulPapers(usefulPapers, roundScreening.usefulPapers);
      expansionSummaries.push({
        round,
        queries: expansionQueries,
        searchedPaperCount: roundCandidates.length,
        usefulPaperCount: usefulPapers.length - before,
        note: "arXiv does not expose reference lists directly, so this round uses title/abstract-based reference-expansion queries.",
      });
    }
    usefulPapers = await this.downloadUsefulPapers(input, usefulPapers);
    const sourceContext = renderUsefulPaperContext(usefulPapers);
    input.onProgress?.({
      label: "Collect candidate sources",
      detail: "Collected, screened, expanded, and downloaded useful literature sources for digest synthesis.",
      data: {
        plannedQueryCount: searchSteps.steps.length,
        retrievedSourceCount: retrievalResults.reduce((count, result) => count + (arxivResultCount(result.output) ?? 0), 0),
        initialCandidateCount: initialCandidates.length,
        usefulPaperCount: usefulPapers.length,
        downloadedPaperCount: usefulPapers.filter((paper) => paper.localPath).length,
        referenceExpansionRounds: expansionSummaries,
        providedSourceCount: sourceIngests.length,
      },
    });
    const digestMarkdown = await this.modelStep(input, {
      prompt: [
        `Create a literature review digest for: ${input.plan.objective}.`,
        "Search plan:",
        renderSearchPlanForPrompt(generatedPlan.plan.search_strategy, searchQueries),
        `Language policy: primary=${problemFrame.languagePolicy.primarySearchLanguage}; input=${problemFrame.languagePolicy.inputLanguage}; reason=${problemFrame.languagePolicy.reason}`,
        `Retrieved source context:\n${sourceContext || "No live retrieval results were available."}`,
        "Include search scope, source selection, consensus claims, conflicts, quality caveats, and evidence gaps.",
      ].join("\n"),
    });
    input.onProgress?.({
      label: "Digest literature evidence",
      detail: "Synthesized retrieved/planned literature context into a review digest.",
      data: {
        providedSources: sourceIngests.map((item) => item.source.title),
        digestTool: "literature_digest_synthesis",
      },
    });
    const modelStep = (options: Parameters<ModelStepRunner>[0]) => this.modelStep(input, options);
    const structuredExtraction = await extractStructuredLiteratureReview(digestMarkdown, sourceContext, searchQueries, modelStep);
    input.onProgress?.({
      label: "Extract structured review table",
      detail: structuredExtraction
        ? "Extracted structured claims, evidence quality, bias risks, conflict groups, and evidence gaps."
        : "Structured extraction was unavailable; the knowledge base will use heuristic claim and conflict extraction.",
      data: {
        structured: Boolean(structuredExtraction),
        claimCount: structuredExtraction?.claims.length ?? 0,
        conflictGroupCount: structuredExtraction?.conflictGroups?.length ?? 0,
        evidenceGapCount: structuredExtraction?.evidenceGaps?.length ?? 0,
      },
    });
    const reviewSynthesis = input.literature?.recordReviewSynthesis({
      topic: input.plan.objective,
      summaryMarkdown: digestMarkdown,
      queries: searchQueries,
      retrievedSources: toReviewSynthesisSourcesFromPapers(usefulPapers),
      evidenceGaps: structuredExtraction?.evidenceGaps ?? inferEvidenceGapsFromDigest(digestMarkdown),
      structuredExtraction,
      createdBy: this.id,
    });
    input.onProgress?.({
      label: "Update literature knowledge base",
      detail: "Recorded review synthesis, provisional claims, quality grades, and conflict groups in the literature knowledge base.",
      data: {
        reviewId: reviewSynthesis?.id,
        sourceCount: reviewSynthesis?.sourceCount ?? 0,
        claimCount: reviewSynthesis?.claimIds.length ?? 0,
        conflictGroupCount: reviewSynthesis?.conflictGroupIds.length ?? 0,
      },
    });
    const summary = this.renderResultMarkdown({
      digestMarkdown,
      providedSourceTitles: sourceIngests.map((item) => item.source.title),
    });
    return {
      stage: this.stage,
      specialistId: this.id,
      summary,
      processTrace: [
        {
          label: "Build search plan",
          status: "completed",
          detail: "Derived targeted literature queries from the framed problem.",
          data: {
            input: {
              framedQuestion: task?.question ?? input.plan.objective,
              discipline: problemFrame.discipline,
              problemFrame: problemFrame.structuredFrame,
              languagePolicy: problemFrame.languagePolicy,
            },
            output: {
              generatedQueryPlan: generatedPlan.plan,
              searchQueries,
              deferredQueries,
              rejectedQueries: normalizedQueries.rejected,
              searchSteps,
              retrievalResults: summarizeRetrievalResults(retrievalResults),
              relevanceScreening: {
                initialCandidateCount: initialCandidates.length,
                usefulPaperCount: usefulPapers.length,
                usefulPapers: usefulPapers.map(summarizeUsefulPaper),
              },
              referenceExpansionRounds: expansionSummaries,
              note: "arXiv retrieval is executed live; Crossref/PubMed remain registered capability stubs.",
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
            digestPreview: digestMarkdown.slice(0, 420),
            reviewSynthesis,
            structuredExtraction,
          },
        },
        {
          label: "Extract evidence gaps",
          status: "completed",
          detail: "Marked the review as provisional until real search tools return source-backed claims.",
          data: {
            caveat: "External literature search tools are represented as runtime capabilities; actual search execution is still scaffolded.",
              retrieval: summarizeRetrievalResults(retrievalResults),
              literatureKnowledgeBase: input.literature
                ? {
                    claimTable: input.literature.renderClaimTable(),
                    conflictMap: input.literature.renderConflictMap(),
                  }
                : undefined,
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
          claim: retrievalResults.some((result) => (arxivResultCount(result.output) ?? 0) > 0)
            ? "Literature review used live arXiv retrieval results and should preserve source-backed uncertainty."
            : "Literature review attempted live retrieval but found no usable source records.",
          source: "literature_review_agent",
          strength: retrievalResults.some((result) => (arxivResultCount(result.output) ?? 0) > 0) ? "medium" : "unknown",
          uncertainty: "arXiv retrieval is incomplete coverage and should be complemented by Crossref/PubMed/source-specific search",
        },
      ],
      hypotheses: [],
      artifacts: reviewSynthesis
        ? [
            {
              id: "literature_review_synthesis",
              kind: "literature_review_synthesis",
              uri: `literature://review/${reviewSynthesis.id}`,
              metadata: {
                reviewSynthesis,
                queryPlan: generatedPlan.plan,
                searchQueries,
                usefulPapers: usefulPapers.map(summarizeUsefulPaper),
                referenceExpansionRounds: expansionSummaries,
                rejectedQueries: normalizedQueries.rejected,
                claimTable: input.literature?.renderClaimTable(),
                conflictMap: input.literature?.renderConflictMap(),
              },
            },
          ]
        : [],
      memoryProposals: [
        ...sourceIngests.map((item) => item.memoryProposal),
        {
          scope: "project",
          kind: "reference",
          title: "Literature review digest",
          summary: firstMarkdownParagraph(digestMarkdown).slice(0, 220) || digestMarkdown.slice(0, 220),
          content: `${summary}\n\n## Retrieved Source Context\n${sourceContext}`,
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

  private findProblemFrameArtifact(input: SpecialistRunInput): ArtifactRef | undefined {
    return input.researchState.artifactRefs.find((artifact) => artifact.id === "problem_frame");
  }

  protected override renderResultMarkdown(result: unknown): string {
    if (!isRecord(result)) return super.renderResultMarkdown(result);
    const digestMarkdown = asString(result.digestMarkdown);
    const providedSourceTitles = asStringArray(result.providedSourceTitles);
    const sections = [digestMarkdown.trim()];
    if (providedSourceTitles.length > 0) {
      sections.push([
        "## Ingested Literature Sources",
        ...providedSourceTitles.map((title) => `- ${title}`),
      ].join("\n"));
    }
    return sections.filter(Boolean).join("\n\n");
  }

  private async generateLiteratureQueryPlan(input: SpecialistRunInput, problemFrame: ProblemFrameArtifactView): Promise<{ raw: string; plan: LiteratureQueryPlan }> {
    const task = input.plan.inputs.task as { question?: string } | undefined;
    const originalQuestion = task?.question ?? input.plan.objective;
    const prompt = [
      "Generate a literature search query plan from the framed scientific problem.",
      "This is a dedicated literature-review planning step. Do not rewrite the problem frame.",
      "",
      `Discipline: ${problemFrame.discipline}`,
      `Language policy: primary=${problemFrame.languagePolicy.primarySearchLanguage}; input=${problemFrame.languagePolicy.inputLanguage}; reason=${problemFrame.languagePolicy.reason}`,
      originalQuestion && originalQuestion !== problemFrame.objective ? `Original user question: ${originalQuestion}` : "",
      "",
      "Problem frame for query planning:",
      problemFrame.renderedMarkdown,
      "",
      "Query rules:",
      "- Return up to 10 English database-ready search strings. The runtime will keep at most 5 after validation.",
      "- Prefer robust broad-to-focused queries over brittle one-off strings.",
      "- Use exact phrases only when they appear in the user question or problem frame.",
      "- Do not invent acronyms, abbreviations, benchmark names, paper names, method names, or aliases not present in the problem frame.",
      "- Avoid over-specific synthetic phrases such as invented CamelCase names or unexplained abbreviations.",
      "- Each query should be usable directly in arXiv/Semantic Scholar/Google Scholar style retrieval.",
      "- Include at least one broad conceptual query, one mechanism/query about causes or methods, and one evaluation/limitation query when relevant.",
      "- Do not return natural-language questions or instructions like 'find papers about'.",
      "",
      schemaInstruction(LITERATURE_QUERY_PLAN_SCHEMA),
    ].join("\n");
    const raw = await this.modelStep(input, {
      stepId: "literature_query_planning_model",
      prompt,
      includeRenderedContext: false,
    });
    const modelStep = (options: Parameters<ModelStepRunner>[0]) => this.modelStep(input, options);
    return { raw, plan: await parseOrRepairLiteratureQueryPlan(raw, modelStep) };
  }

  private async searchArxiv(
    input: SpecialistRunInput,
    steps: Array<{ index: number; query: string; language: string; purpose: string; tools: string[] }>,
    limit: number,
    round: number,
  ): Promise<RetrievalResult[]> {
    const retrievalResults: RetrievalResult[] = [];
    for (const step of steps) {
      const arxivResult = await input.tools.call({
        name: "arxiv_search",
        arguments: {
          query: step.query,
          limit,
        },
      });
      retrievalResults.push({
        query: step.query,
        purpose: step.purpose,
        tool: "arxiv_search",
        status: arxivResult.status,
        output: arxivResult.output,
        error: arxivResult.error,
      });
      input.onProgress?.({
        label: round > 0 ? `Reference expansion ${round}: query ${step.index}/${steps.length}` : `Search query ${step.index}/${steps.length}`,
        detail: step.query,
        data: {
          language: step.language,
          purpose: step.purpose,
          tools: ["arxiv_search"],
          status: arxivResult.status,
          resultCount: arxivResultCount(arxivResult.output),
          topResults: arxivTopResults(arxivResult.output),
          note: arxivResult.error,
        },
      });
    }
    return retrievalResults;
  }

  private async screenCandidatePapers(
    input: SpecialistRunInput,
    problemFrame: ProblemFrameArtifactView,
    candidates: LiteraturePaperCandidate[],
    stage: string,
  ): Promise<{ usefulPapers: UsefulLiteraturePaper[]; rejectedPapers: Array<{ id: string; title: string; reason: string }> }> {
    if (candidates.length === 0) return { usefulPapers: [], rejectedPapers: [] };
    const prompt = [
      "Judge whether each retrieved paper is useful for the framed research problem.",
      "Use only metadata below: title, abstract/summary, query, and URL. Do not infer experimental results not present in metadata.",
      "Keep only papers with a clear role for the framed problem: background, mechanism, method, evaluation, limitation, conflicting evidence, or benchmark.",
      "Reject papers that are merely keyword-overlap, off-topic, too generic, or unrelated to the framed objective.",
      "",
      "Problem frame:",
      problemFrame.renderedMarkdown,
      "",
      "Candidate papers:",
      JSON.stringify(candidates.map(compactPaperForPrompt), null, 2),
      "",
      schemaInstruction(PAPER_RELEVANCE_SCHEMA),
    ].join("\n");
    const raw = await this.modelStep(input, {
      stepId: `literature_paper_relevance_${stage}`,
      system: "You are a careful scientific literature screener. Return valid JSON only.",
      prompt,
      includeRenderedContext: false,
      stream: false,
    });
    const screening = await parseOrRepairPaperRelevance(raw, (options) => this.modelStep(input, options));
    const decisions = new Map(screening.decisions.map((item) => [item.id, item]));
    const usefulPapers: UsefulLiteraturePaper[] = [];
    const rejectedPapers: Array<{ id: string; title: string; reason: string }> = [];
    for (const paper of candidates) {
      const decision = decisions.get(paper.id) ?? fallbackPaperDecision(paper, problemFrame);
      if (decision.useful && decision.relevance !== "none" && decision.relevance !== "weak") {
        usefulPapers.push({
          ...paper,
          relevance: decision.relevance,
          role: decision.role,
          relevanceReason: decision.reason,
        });
      } else {
        rejectedPapers.push({ id: paper.id, title: paper.title, reason: decision.reason || "Paper did not have a clear role for the framed problem." });
      }
    }
    input.onProgress?.({
      label: `Screen papers for relevance (${stage})`,
      detail: "Judged each retrieved paper against the framed problem and kept only papers with a clear research role.",
      data: {
        candidateCount: candidates.length,
        usefulCount: usefulPapers.length,
        rejectedCount: rejectedPapers.length,
        usefulPapers: usefulPapers.map(summarizeUsefulPaper),
      },
    });
    return { usefulPapers, rejectedPapers };
  }

  private async generateReferenceExpansionQueries(
    input: SpecialistRunInput,
    problemFrame: ProblemFrameArtifactView,
    usefulPapers: UsefulLiteraturePaper[],
    round: number,
  ): Promise<ReferenceExpansionQuery[]> {
    if (usefulPapers.length === 0) return [];
    const prompt = [
      "Propose reference-expansion literature search queries from the useful seed papers.",
      "Goal: recover likely foundational, prior, or closely related papers that the seed papers may cite or build on.",
      "Use only the seed paper titles, abstracts, and the problem frame. Do not invent exact reference titles unless the words appear in seed metadata.",
      "Return at most 5 English database-ready search strings. Prefer title/keyphrase style queries.",
      "",
      `Expansion round: ${round}`,
      "",
      "Problem frame:",
      problemFrame.renderedMarkdown,
      "",
      "Useful seed papers:",
      JSON.stringify(usefulPapers.map(compactPaperForPrompt), null, 2),
      "",
      schemaInstruction(REFERENCE_EXPANSION_QUERY_SCHEMA),
    ].join("\n");
    const raw = await this.modelStep(input, {
      stepId: `literature_reference_expansion_query_round_${round}`,
      system: "You generate conservative literature reference-expansion queries as valid JSON.",
      prompt,
      includeRenderedContext: false,
      stream: false,
    });
    const parsed = await parseOrRepairReferenceExpansionQueries(raw, (options) => this.modelStep(input, options));
    return parsed.queries.slice(0, 5);
  }

  private async downloadUsefulPapers(input: SpecialistRunInput, usefulPapers: UsefulLiteraturePaper[]): Promise<UsefulLiteraturePaper[]> {
    const downloaded: UsefulLiteraturePaper[] = [];
    for (const paper of usefulPapers) {
      if (!paper.link) {
        downloaded.push(paper);
        continue;
      }
      const result = await input.tools.call({
        name: "download_paper_pdf",
        arguments: {
          id: paper.id,
          title: paper.title,
          url: paper.link,
        },
      });
      const output = isRecord(result.output) ? result.output : {};
      downloaded.push({
        ...paper,
        localPath: result.status === "completed" ? asString(output.path) : undefined,
        downloadStatus: result.status,
        downloadError: result.error,
      });
      input.onProgress?.({
        label: "Download useful paper",
        detail: paper.title,
        data: {
          status: result.status,
          path: output.path,
          error: result.error,
        },
      });
    }
    return downloaded;
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

  private missingProblemFrame(input: SpecialistRunInput, task?: { question?: string; discipline?: string }): StageResult {
    const summary = "Literature review cannot start because the previous problem framing output is missing or incomplete.";
    return {
      stage: this.stage,
      specialistId: this.id,
      summary,
      processTrace: [
        {
          label: "Load problem frame",
          status: "blocked",
          detail: "Expected problem_frame.metadata.structuredFrame, renderedProblemFrame, and languagePolicy from the problem framing stage.",
          data: {
            framedQuestion: task?.question ?? input.plan.objective,
            discipline: task?.discipline ?? "general_science",
            requiredArtifact: "problem_frame",
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
        reason: "Please revise problem framing so it includes a structured problem frame and language policy before continuing literature review.",
        confidence: "high",
      },
    };
  }

  private missingGeneratedSearchPlan(
    input: SpecialistRunInput,
    task: { question?: string; discipline?: string } | undefined,
    generatedPlan: { raw: string; plan: LiteratureQueryPlan },
    rejectedQueries: Array<{ query: string; reason: string }>,
  ): StageResult {
    const summary = "Literature review generated a query plan, but no query passed quality checks.";
    return {
      stage: this.stage,
      specialistId: this.id,
      summary,
      processTrace: [
        {
          label: "Generate literature query plan",
          status: "blocked",
          detail: "The literature-review model produced queries, but all were rejected as non-English, too vague, instructional, or unsupported by the framed problem.",
          data: {
            framedQuestion: task?.question ?? input.plan.objective,
            discipline: task?.discipline ?? "general_science",
            generatedQueryPlan: generatedPlan.plan,
            rejectedQueries,
            rawPreview: generatedPlan.raw.slice(0, 800),
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
        nextStage: "literature_review",
        reason: "Please revise the literature query plan or broaden the framed problem before retrieval.",
        confidence: "high",
      },
    };
  }
}

interface LiteratureQueryPlanItem {
  purpose: string;
  query: string;
  scope: "broad" | "focused" | "exact";
  rationale: string;
}

interface LiteratureQueryPlan {
  search_strategy: string;
  queries: LiteratureQueryPlanItem[];
  exclusions: string[];
}

interface ProblemFrameArtifactView {
  structuredFrame: Record<string, unknown>;
  renderedMarkdown: string;
  languagePolicy: {
    inputLanguage: string;
    primarySearchLanguage: string;
    reason: string;
  };
  discipline: string;
  objective: string;
  successCriteria: string[];
}

interface NormalizedSearchQuery {
  query: string;
  language: string;
  purpose: string;
}

interface RetrievalResult {
  query: string;
  purpose: string;
  tool: string;
  status: string;
  output?: unknown;
  error?: string;
}

interface LiteratureSearchSettings {
  maxAcceptedQueries: number;
  perQueryLimit: number;
  referenceExpansionRounds: number;
  maxExpansionQueriesPerRound: number;
}

interface LiteraturePaperCandidate {
  id: string;
  title: string;
  link?: string;
  summary?: string;
  authors?: string[];
  publishedAt?: string;
  sourceType: string;
  query: string;
  purpose: string;
  discoveryRound: number;
  discoveryMethod: "query_search" | "reference_title_expansion";
}

interface UsefulLiteraturePaper extends LiteraturePaperCandidate {
  relevance: "strong" | "moderate" | "weak" | "none";
  role: string;
  relevanceReason: string;
  localPath?: string;
  downloadStatus?: string;
  downloadError?: string;
}

interface PaperRelevanceDecision {
  id: string;
  useful: boolean;
  relevance: "strong" | "moderate" | "weak" | "none";
  role: string;
  reason: string;
}

interface PaperRelevanceResult {
  decisions: PaperRelevanceDecision[];
}

interface ReferenceExpansionQuery {
  query: string;
  purpose: string;
  seedPaperIds: string[];
  rationale: string;
}

interface ReferenceExpansionQueryResult {
  queries: ReferenceExpansionQuery[];
}

interface LiteratureExpansionSummary {
  round: number;
  queries: ReferenceExpansionQuery[];
  searchedPaperCount: number;
  usefulPaperCount: number;
  note: string;
}

const LITERATURE_QUERY_PLAN_SCHEMA: StructuredSchema = {
  name: "literature_query_plan",
  description: "A model-generated literature search plan based on a structured problem frame.",
  schema: {
    type: "object",
    required: ["search_strategy", "queries", "exclusions"],
    properties: {
      search_strategy: {
        type: "string",
        description: "Concise explanation of how the queries cover the framed problem.",
      },
      queries: {
        type: "array",
        description: "Up to 10 candidate literature search queries before runtime validation.",
        items: {
          type: "object",
          required: ["purpose", "query", "scope", "rationale"],
          properties: {
            purpose: { type: "string" },
            query: { type: "string" },
            scope: {
              type: "string",
              description: "One of: broad, focused, exact.",
            },
            rationale: { type: "string" },
          },
        },
      },
      exclusions: { type: "array", items: { type: "string" } },
    },
  },
};

const LITERATURE_EXTRACTION_SCHEMA: StructuredSchema = {
  name: "literature_structured_extraction",
  description: "A structured evidence table extracted from a literature review digest and retrieved source context.",
  schema: {
    type: "object",
    required: ["claims", "conflictGroups", "evidenceGaps", "screeningNotes"],
    properties: {
      claims: {
        type: "array",
        items: {
          type: "object",
          required: ["claim", "sourceIds", "query", "evidenceDirection", "qualityGrade", "biasRisk", "conflictGroup", "notes"],
          properties: {
            claim: { type: "string" },
            sourceIds: { type: "array", items: { type: "string" } },
            query: { type: "string" },
            evidenceDirection: { type: "string" },
            qualityGrade: { type: "string" },
            biasRisk: { type: "string" },
            conflictGroup: { type: "string" },
            notes: { type: "string" },
          },
        },
      },
      conflictGroups: {
        type: "array",
        items: {
          type: "object",
          required: ["topic", "claimTexts", "status", "attribution"],
          properties: {
            topic: { type: "string" },
            claimTexts: { type: "array", items: { type: "string" } },
            status: { type: "string" },
            attribution: { type: "string" },
          },
        },
      },
      evidenceGaps: { type: "array", items: { type: "string" } },
      screeningNotes: { type: "array", items: { type: "string" } },
    },
  },
};

const PAPER_RELEVANCE_SCHEMA: StructuredSchema = {
  name: "paper_relevance_screening",
  description: "Paper-level usefulness judgments against a framed research problem.",
  schema: {
    type: "object",
    required: ["decisions"],
    properties: {
      decisions: {
        type: "array",
        items: {
          type: "object",
          required: ["id", "useful", "relevance", "role", "reason"],
          properties: {
            id: { type: "string" },
            useful: { type: "boolean" },
            relevance: { type: "string", description: "One of: strong, moderate, weak, none." },
            role: { type: "string", description: "One of: background, mechanism, method, evaluation, limitation, conflict, benchmark, unrelated." },
            reason: { type: "string" },
          },
        },
      },
    },
  },
};

const REFERENCE_EXPANSION_QUERY_SCHEMA: StructuredSchema = {
  name: "reference_expansion_queries",
  description: "Conservative search queries for reference/citation-neighborhood expansion.",
  schema: {
    type: "object",
    required: ["queries"],
    properties: {
      queries: {
        type: "array",
        items: {
          type: "object",
          required: ["query", "purpose", "seedPaperIds", "rationale"],
          properties: {
            query: { type: "string" },
            purpose: { type: "string" },
            seedPaperIds: { type: "array", items: { type: "string" } },
            rationale: { type: "string" },
          },
        },
      },
    },
  },
};

async function parseOrRepairLiteratureQueryPlan(rawText: string, modelStep: ModelStepRunner): Promise<LiteratureQueryPlan> {
  try {
    return coerceLiteratureQueryPlan(parseStructuredOutput(rawText, LITERATURE_QUERY_PLAN_SCHEMA));
  } catch (error) {
    try {
      return coerceLiteratureQueryPlan(salvageStructuredOutput(rawText, LITERATURE_QUERY_PLAN_SCHEMA));
    } catch {
      const repaired = await modelStep({
        stepId: "literature_query_plan_repair_model",
        system: "You repair invalid scientific literature query plans into valid JSON.",
        prompt: repairInstruction(
          LITERATURE_QUERY_PLAN_SCHEMA,
          rawText,
          error instanceof Error ? error.message : String(error),
        ),
        includeRenderedContext: false,
        stream: false,
      });
      return coerceLiteratureQueryPlan(parseStructuredOutput(repaired, LITERATURE_QUERY_PLAN_SCHEMA));
    }
  }
}

function coerceLiteratureQueryPlan(value: Record<string, unknown>): LiteratureQueryPlan {
  return {
    search_strategy: asString(value.search_strategy),
    queries: Array.isArray(value.queries)
      ? value.queries.map((item) => {
          const record = isRecord(item) ? item : {};
          return {
            purpose: asString(record.purpose),
            query: asString(record.query),
            scope: normalizeEnum(record.scope, ["broad", "focused", "exact"]),
            rationale: asString(record.rationale),
          };
        }).filter((item) => item.query)
      : [],
    exclusions: asStringArray(value.exclusions),
  };
}

async function extractStructuredLiteratureReview(
  summary: string,
  sourceContext: string,
  searchQueries: Array<{ query: string; language: string; purpose: string }>,
  modelStep: ModelStepRunner,
): Promise<LiteratureStructuredExtraction | undefined> {
  const prompt = [
    "Extract a structured systematic-review style evidence table from the literature digest and retrieved source context.",
    "Use only information present in the digest or source context. Do not invent papers, URLs, or results.",
    "For evidenceDirection use one of: supports, contradicts, contextual, mixed, unknown.",
    "For qualityGrade use one of: high, moderate, low, unclear.",
    "For biasRisk use one of: low, moderate, high, unclear.",
    "For conflict status use one of: none, mapped, unresolved, adjudication_needed.",
    "Prefer 3-8 concise claims. Link claims to source ids/URLs/titles when visible in the source context.",
    "",
    "Search queries:",
    renderSearchQueriesForPrompt(searchQueries),
    "",
    "Literature digest:",
    summary,
    "",
    "Retrieved source index:",
    compactRetrievedSourceContext(sourceContext),
    "",
    schemaInstruction(LITERATURE_EXTRACTION_SCHEMA),
  ].join("\n");
  const raw = await modelStep({
    stepId: "literature_structured_extractor",
    system: "You extract decision-grade scientific literature evidence tables as valid JSON.",
    prompt,
    includeRenderedContext: false,
  });
  return parseOrRepairLiteratureExtraction(raw, modelStep);
}

async function parseOrRepairLiteratureExtraction(rawText: string, modelStep: ModelStepRunner): Promise<LiteratureStructuredExtraction | undefined> {
  try {
    return coerceLiteratureExtraction(parseStructuredOutput(rawText, LITERATURE_EXTRACTION_SCHEMA));
  } catch (error) {
    try {
      return coerceLiteratureExtraction(salvageStructuredOutput(rawText, LITERATURE_EXTRACTION_SCHEMA));
    } catch {
      try {
        const repaired = await modelStep({
          stepId: "literature_structured_extraction_repair_model",
          system: "You repair invalid structured scientific literature extraction outputs into valid JSON.",
          prompt: repairInstruction(
            LITERATURE_EXTRACTION_SCHEMA,
            rawText,
            error instanceof Error ? error.message : String(error),
          ),
          includeRenderedContext: false,
          stream: false,
        });
        return coerceLiteratureExtraction(parseStructuredOutput(repaired, LITERATURE_EXTRACTION_SCHEMA));
      } catch {
        return undefined;
      }
    }
  }
}

async function parseOrRepairPaperRelevance(rawText: string, modelStep: ModelStepRunner): Promise<PaperRelevanceResult> {
  try {
    return coercePaperRelevance(parseStructuredOutput(rawText, PAPER_RELEVANCE_SCHEMA));
  } catch (error) {
    try {
      return coercePaperRelevance(salvageStructuredOutput(rawText, PAPER_RELEVANCE_SCHEMA));
    } catch {
      const repaired = await modelStep({
        stepId: "paper_relevance_repair_model",
        system: "You repair invalid scientific paper relevance screening outputs into valid JSON.",
        prompt: repairInstruction(
          PAPER_RELEVANCE_SCHEMA,
          rawText,
          error instanceof Error ? error.message : String(error),
        ),
        includeRenderedContext: false,
        stream: false,
      });
      return coercePaperRelevance(parseStructuredOutput(repaired, PAPER_RELEVANCE_SCHEMA));
    }
  }
}

function coercePaperRelevance(value: Record<string, unknown>): PaperRelevanceResult {
  return {
    decisions: Array.isArray(value.decisions)
      ? value.decisions.map((item) => {
          const record = isRecord(item) ? item : {};
          return {
            id: asString(record.id),
            useful: Boolean(record.useful),
            relevance: normalizeEnum(record.relevance, ["strong", "moderate", "weak", "none"]),
            role: asString(record.role) || "unrelated",
            reason: asString(record.reason),
          };
        }).filter((item) => item.id)
      : [],
  };
}

async function parseOrRepairReferenceExpansionQueries(rawText: string, modelStep: ModelStepRunner): Promise<ReferenceExpansionQueryResult> {
  try {
    return coerceReferenceExpansionQueries(parseStructuredOutput(rawText, REFERENCE_EXPANSION_QUERY_SCHEMA));
  } catch (error) {
    try {
      return coerceReferenceExpansionQueries(salvageStructuredOutput(rawText, REFERENCE_EXPANSION_QUERY_SCHEMA));
    } catch {
      const repaired = await modelStep({
        stepId: "reference_expansion_query_repair_model",
        system: "You repair invalid literature reference-expansion query outputs into valid JSON.",
        prompt: repairInstruction(
          REFERENCE_EXPANSION_QUERY_SCHEMA,
          rawText,
          error instanceof Error ? error.message : String(error),
        ),
        includeRenderedContext: false,
        stream: false,
      });
      return coerceReferenceExpansionQueries(parseStructuredOutput(repaired, REFERENCE_EXPANSION_QUERY_SCHEMA));
    }
  }
}

function coerceReferenceExpansionQueries(value: Record<string, unknown>): ReferenceExpansionQueryResult {
  return {
    queries: Array.isArray(value.queries)
      ? value.queries.map((item) => {
          const record = isRecord(item) ? item : {};
          return {
            query: asString(record.query),
            purpose: asString(record.purpose) || "reference expansion",
            seedPaperIds: asStringArray(record.seedPaperIds),
            rationale: asString(record.rationale),
          };
        }).filter((item) => item.query && !containsCjk(item.query))
      : [],
  };
}

function coerceLiteratureExtraction(value: Record<string, unknown>): LiteratureStructuredExtraction {
  return {
    claims: Array.isArray(value.claims)
      ? value.claims.map((item) => {
          const record = isRecord(item) ? item : {};
          return {
            claim: asString(record.claim),
            sourceIds: asStringArray(record.sourceIds),
            query: asString(record.query),
            evidenceDirection: normalizeEnum(record.evidenceDirection, ["supports", "contradicts", "contextual", "mixed", "unknown"]),
            qualityGrade: normalizeEnum(record.qualityGrade, ["high", "moderate", "low", "unclear"]),
            biasRisk: normalizeEnum(record.biasRisk, ["low", "moderate", "high", "unclear"]),
            conflictGroup: asString(record.conflictGroup),
            notes: asString(record.notes),
          };
        }).filter((item) => item.claim)
      : [],
    conflictGroups: Array.isArray(value.conflictGroups)
      ? value.conflictGroups.map((item) => {
          const record = isRecord(item) ? item : {};
          return {
            topic: asString(record.topic),
            claimTexts: asStringArray(record.claimTexts),
            status: normalizeEnum(record.status, ["none", "mapped", "unresolved", "adjudication_needed"]),
            attribution: asString(record.attribution),
          };
        }).filter((item) => item.topic)
      : [],
    evidenceGaps: asStringArray(value.evidenceGaps),
    screeningNotes: asStringArray(value.screeningNotes),
  };
}

function normalizeGeneratedLiteratureQueries(
  queries: LiteratureQueryPlanItem[],
  problemFrame: ProblemFrameArtifactView,
): { accepted: NormalizedSearchQuery[]; rejected: Array<{ query: string; reason: string }> } {
  const accepted: NormalizedSearchQuery[] = [];
  const rejected: Array<{ query: string; reason: string }> = [];
  const allowedTerms = buildAllowedSpecialTerms(problemFrame);
  for (const item of queries) {
    const normalized = normalizeGeneratedQuery(item, problemFrame.languagePolicy);
    if (!normalized) continue;
    const rejectionReason = queryQualityRejectionReason(normalized.query, allowedTerms);
    if (rejectionReason) {
      rejected.push({ query: normalized.query, reason: rejectionReason });
      continue;
    }
    accepted.push(normalized);
  }
  return { accepted: dedupeQueries(accepted), rejected };
}

function collectCandidatePapers(results: RetrievalResult[], round: number, discoveryMethod: LiteraturePaperCandidate["discoveryMethod"]): LiteraturePaperCandidate[] {
  const candidates = results.flatMap((result) =>
    arxivResultItems(result.output).map((item) => ({
      id: item.id ?? item.link ?? `${result.query}:${item.title}`,
      title: item.title,
      link: item.link,
      summary: item.summary,
      authors: item.authors,
      publishedAt: item.publishedAt,
      sourceType: result.tool,
      query: result.query,
      purpose: result.purpose,
      discoveryRound: round,
      discoveryMethod,
    })),
  );
  return dedupePaperCandidates(candidates);
}

function dedupePaperCandidates<T extends LiteraturePaperCandidate>(papers: T[]): T[] {
  const seen = new Set<string>();
  const unique: T[] = [];
  for (const paper of papers) {
    const key = paper.id || paper.link || paper.title.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(paper);
  }
  return unique;
}

function mergeUsefulPapers(existing: UsefulLiteraturePaper[], incoming: UsefulLiteraturePaper[]): UsefulLiteraturePaper[] {
  return dedupePaperCandidates([...existing, ...incoming]);
}

function toReviewSynthesisSourcesFromPapers(papers: UsefulLiteraturePaper[]): LiteratureReviewSynthesisInput["retrievedSources"] {
  const byQuery = new Map<string, { tool: string; query: string; purpose: string; papers: UsefulLiteraturePaper[] }>();
  for (const paper of papers) {
    const key = JSON.stringify([paper.sourceType, paper.query]);
    const current = byQuery.get(key) ?? { tool: paper.sourceType, query: paper.query, purpose: paper.purpose, papers: [] };
    current.papers.push(paper);
    byQuery.set(key, current);
  }
  return [...byQuery.values()].map((group) => {
    return {
      query: group.query,
      purpose: group.purpose,
      tool: group.tool,
      status: "completed",
      results: group.papers.map((paper) => ({
        id: paper.id,
        title: paper.title,
        link: paper.link,
        summary: paper.summary,
        authors: paper.authors,
        publishedAt: paper.publishedAt,
        sourceType: paper.sourceType,
      })),
    };
  });
}

function compactPaperForPrompt(paper: LiteraturePaperCandidate): Record<string, unknown> {
  return {
    id: paper.id,
    title: paper.title,
    link: paper.link,
    summary: paper.summary?.slice(0, 900),
    authors: paper.authors?.slice(0, 6),
    publishedAt: paper.publishedAt,
    query: paper.query,
    purpose: paper.purpose,
    discoveryRound: paper.discoveryRound,
    discoveryMethod: paper.discoveryMethod,
  };
}

function summarizeUsefulPaper(paper: UsefulLiteraturePaper): Record<string, unknown> {
  return {
    id: paper.id,
    title: paper.title,
    link: paper.link,
    relevance: paper.relevance,
    role: paper.role,
    reason: paper.relevanceReason,
    discoveryRound: paper.discoveryRound,
    discoveryMethod: paper.discoveryMethod,
    localPath: paper.localPath,
  };
}

function fallbackPaperDecision(paper: LiteraturePaperCandidate, problemFrame: ProblemFrameArtifactView): PaperRelevanceDecision {
  const haystack = `${paper.title} ${paper.summary ?? ""}`.toLowerCase();
  const frameTerms = [
    problemFrame.objective,
    asString(problemFrame.structuredFrame.scope),
    ...asStringArray(problemFrame.structuredFrame.key_variables),
  ].join(" ").toLowerCase().match(/[a-z][a-z0-9-]{3,}/g) ?? [];
  const overlap = new Set(frameTerms.filter((term) => haystack.includes(term)));
  const useful = overlap.size >= 2;
  return {
    id: paper.id,
    useful,
    relevance: useful ? "moderate" : "none",
    role: useful ? "background" : "unrelated",
    reason: useful
      ? `Fallback relevance screening found overlapping technical terms: ${[...overlap].slice(0, 5).join(", ")}.`
      : "Fallback relevance screening found insufficient technical overlap with the framed problem.",
  };
}

function renderUsefulPaperContext(papers: UsefulLiteraturePaper[]): string {
  const lines: string[] = [];
  for (const paper of papers) {
    lines.push(`## ${paper.title}`);
    lines.push(`- id: ${paper.id}`);
    lines.push(`- url: ${paper.link ?? "no url"}`);
    lines.push(`- local_pdf: ${paper.localPath ?? "not downloaded"}`);
    lines.push(`- discovery: ${paper.discoveryMethod}, round ${paper.discoveryRound}, query="${paper.query}"`);
    lines.push(`- relevance: ${paper.relevance}; role=${paper.role}; reason=${paper.relevanceReason}`);
    if (paper.authors?.length) lines.push(`- authors: ${paper.authors.join(", ")}`);
    if (paper.publishedAt) lines.push(`- published: ${paper.publishedAt}`);
    if (paper.summary) lines.push(`abstract: ${paper.summary.slice(0, 900)}`);
    lines.push("");
  }
  return lines.join("\n").trim();
}

function renderSearchPlanForPrompt(
  strategy: string,
  queries: Array<{ query: string; language: string; purpose: string }>,
): string {
  return [
    `- strategy: ${strategy || "Use accepted literature queries to cover the framed problem."}`,
    ...queries.map((item, index) => `- query ${index + 1} [${item.language}]: ${item.query} - ${item.purpose}`),
  ].join("\n");
}

function renderSearchQueriesForPrompt(queries: Array<{ query: string; language: string; purpose: string }>): string {
  return queries.map((item, index) => `${index + 1}. [${item.language}] ${item.query} - ${item.purpose}`).join("\n");
}

function compactRetrievedSourceContext(sourceContext: string): string {
  const lines = sourceContext
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !line.startsWith("abstract:"));
  return lines.length > 0 ? lines.join("\n") : "No retrieved source context available.";
}

function normalizeGeneratedQuery(
  item: LiteratureQueryPlanItem,
  languagePolicy?: { primarySearchLanguage: string },
): NormalizedSearchQuery | undefined {
  const query = item.query
    .replace(/^\s*[-*]\s*/, "")
    .replace(/^\d+[.)]\s*/, "")
    .replace(/\*\*/g, "")
    .replace(/^["']+|["']+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!query || query.length < 4) return undefined;
  return {
    query,
    language: languagePolicy?.primarySearchLanguage ?? "en",
    purpose: item.purpose || `${item.scope} literature query`,
  };
}

function dedupeQueries(queries: NormalizedSearchQuery[]): NormalizedSearchQuery[] {
  const seen = new Set<string>();
  const unique: NormalizedSearchQuery[] = [];
  for (const query of queries) {
    const key = query.query.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(query);
  }
  return unique;
}

function queryQualityRejectionReason(query: string, allowedSpecialTerms: Set<string>): string | undefined {
  const normalized = query.toLowerCase().replace(/\s+/g, " ").trim();
  if (containsCjk(query)) return "Literature search queries must be English.";
  if (normalized.length > 180) return "Query is too long to be a focused literature search string.";
  if (/^(find|search|look for|look up|identify|understand|review|summarize|investigate)\b/.test(normalized)) {
    return "Query must be concrete search terms, not an instruction.";
  }
  if (/\b(this topic|the topic|user query|research query|the problem|this problem)\b/.test(normalized)) {
    return "Query must name the technical target explicitly.";
  }
  if (/^(what|why|how|when|where|which)\b/.test(normalized) || normalized.endsWith("?")) {
    return "Query must be keyword-style search terms, not a natural-language question.";
  }
  const unsupportedSpecialTerms = inventedSpecialTerms(query, allowedSpecialTerms);
  if (unsupportedSpecialTerms.length > 0) {
    return `Query appears to introduce unsupported abbreviation or special name: ${unsupportedSpecialTerms.join(", ")}.`;
  }
  const tokens = normalized.match(/[a-z][a-z0-9-]{2,}/g) ?? [];
  const generic = new Set([
    "article",
    "articles",
    "current",
    "evidence",
    "latest",
    "literature",
    "method",
    "methods",
    "paper",
    "papers",
    "problem",
    "query",
    "recent",
    "research",
    "review",
    "scientific",
    "source",
    "sources",
    "studies",
    "study",
    "topic",
  ]);
  const specificTerms = tokens.filter((token) => !generic.has(token) && token.length >= 4);
  const hasQuotedPhrase = /"[^"]{4,}"/.test(query);
  if (specificTerms.length < 2 && !hasQuotedPhrase) {
    return "Query must include at least two concrete technical terms or one quoted exact phrase.";
  }
  return undefined;
}

function inventedSpecialTerms(query: string, allowedSpecialTerms: Set<string>): string[] {
  const tokens = query.match(/\b[A-Z][a-z]{1,}[A-Z][A-Za-z0-9]*\b|\b[A-Z]{2,}[a-z][A-Za-z0-9]*\b/g) ?? [];
  return [...new Set(tokens.filter((token) => !allowedSpecialTerms.has(token.toLowerCase())))];
}

function buildAllowedSpecialTerms(problemFrame: ProblemFrameArtifactView): Set<string> {
  const frame = problemFrame.structuredFrame;
  const text = [
    problemFrame.discipline,
    asString(frame.objective),
    asString(frame.scope),
    ...asStringArray(frame.key_variables),
    ...asStringArray(frame.constraints),
    ...problemFrame.successCriteria,
    ...asStringArray(frame.ambiguities),
  ].filter(Boolean).join(" ");
  const terms = new Set<string>();
  for (const match of text.matchAll(/\b[A-Z][A-Za-z0-9-]{1,}\b|\b[A-Z][a-z]{1,}[A-Z][A-Za-z0-9]*\b/g)) {
    terms.add(match[0].toLowerCase());
  }
  for (const match of text.matchAll(/"([^"]{3,80})"/g)) {
    terms.add(match[1].toLowerCase());
  }
  return terms;
}

function containsCjk(text: string): boolean {
  return /[\u3400-\u9fff\uf900-\ufaff]/u.test(text);
}

function hasProblemFrameArtifactMetadata(metadata: unknown): metadata is Record<string, unknown> {
  if (!isRecord(metadata)) return false;
  const frame = metadata.structuredFrame;
  const languagePolicy = metadata.languagePolicy;
  return (
    isRecord(frame) &&
    typeof metadata.renderedProblemFrame === "string" &&
    typeof frame.objective === "string" &&
    typeof frame.scope === "string" &&
    Array.isArray(frame.success_criteria) &&
    isRecord(languagePolicy) &&
    typeof languagePolicy.primarySearchLanguage === "string" &&
    typeof languagePolicy.inputLanguage === "string" &&
    typeof languagePolicy.reason === "string"
  );
}

function readProblemFrameArtifact(artifact: ArtifactRef): ProblemFrameArtifactView {
  const metadata = artifact.metadata ?? {};
  const structuredFrame = isRecord(metadata.structuredFrame) ? metadata.structuredFrame : {};
  const languagePolicy = isRecord(metadata.languagePolicy) ? metadata.languagePolicy : {};
  const normalizedLanguagePolicy = {
    inputLanguage: asString(languagePolicy.inputLanguage) || "mixed_or_unknown",
    primarySearchLanguage: asString(languagePolicy.primarySearchLanguage) || "en",
    reason: asString(languagePolicy.reason) || "No language policy reason was recorded.",
  };
  const successCriteria = asStringArray(metadata.successCriteria).length > 0
    ? asStringArray(metadata.successCriteria)
    : asStringArray(structuredFrame.success_criteria);
  return {
    structuredFrame,
    renderedMarkdown: asString(metadata.renderedProblemFrame),
    languagePolicy: normalizedLanguagePolicy,
    discipline: asString(metadata.discipline) || asString(structuredFrame.discipline) || "general_science",
    objective: asString(structuredFrame.objective),
    successCriteria,
  };
}

function literatureSearchSettings(input: SpecialistRunInput): LiteratureSearchSettings {
  const task = input.plan.inputs.task as { constraints?: Record<string, unknown> } | undefined;
  const constraints = task?.constraints ?? {};
  return {
    maxAcceptedQueries: clampInteger(input.plan.inputs.maxAcceptedLiteratureQueries ?? constraints.maxAcceptedLiteratureQueries, 5, 1, 5),
    perQueryLimit: clampInteger(input.plan.inputs.literatureResultsPerQuery ?? constraints.literatureResultsPerQuery, 5, 1, 5),
    referenceExpansionRounds: clampInteger(input.plan.inputs.referenceExpansionRounds ?? constraints.referenceExpansionRounds, 2, 0, 5),
    maxExpansionQueriesPerRound: clampInteger(input.plan.inputs.maxExpansionQueriesPerRound ?? constraints.maxExpansionQueriesPerRound, 5, 1, 5),
  };
}

function clampInteger(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = typeof value === "number" ? value : Number(value ?? fallback);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(parsed)));
}

function arxivResultCount(output: unknown): number | undefined {
  const results = isRecord(output) && Array.isArray(output.results) ? output.results : undefined;
  return results ? results.length : undefined;
}

function arxivTopResults(output: unknown): Array<{ title: string; link?: string }> {
  if (!isRecord(output) || !Array.isArray(output.results)) return [];
  return output.results.slice(0, 3).map((item) => {
    const record = isRecord(item) ? item : {};
    return {
      title: String(record.title ?? record.id ?? "Untitled source"),
      link: typeof record.link === "string" ? record.link : typeof record.id === "string" ? record.id : undefined,
    };
  });
}

function arxivResultItems(output: unknown): Array<{ id?: string; title: string; link?: string; summary?: string; authors?: string[]; publishedAt?: string }> {
  if (!isRecord(output) || !Array.isArray(output.results)) return [];
  return output.results.map((item) => {
    const record = isRecord(item) ? item : {};
    return {
      id: typeof record.id === "string" ? record.id : undefined,
      title: String(record.title ?? record.id ?? "Untitled source"),
      link: typeof record.link === "string" ? record.link : typeof record.id === "string" ? record.id : undefined,
      summary: typeof record.summary === "string" ? record.summary : typeof record.abstract === "string" ? record.abstract : undefined,
      authors: Array.isArray(record.authors) ? record.authors.map(String) : undefined,
      publishedAt: typeof record.publishedAt === "string" ? record.publishedAt : typeof record.published === "string" ? record.published : undefined,
    };
  });
}

function renderRetrievalContext(results: Array<{ query: string; purpose: string; tool: string; status: string; output?: unknown; error?: string }>): string {
  const lines: string[] = [];
  for (const result of results) {
    lines.push(`## ${result.tool}: ${result.query}`);
    lines.push(`- purpose: ${result.purpose}`);
    lines.push(`- status: ${result.status}`);
    if (result.error) lines.push(`- error: ${result.error}`);
    if (isRecord(result.output) && Array.isArray(result.output.results)) {
      for (const item of result.output.results.slice(0, 5)) {
        const record = isRecord(item) ? item : {};
        lines.push(`- ${String(record.title ?? "Untitled source")} (${String(record.link ?? record.id ?? "no url")})`);
        if (record.summary) lines.push(`  abstract: ${String(record.summary).slice(0, 700)}`);
      }
    }
    lines.push("");
  }
  return lines.join("\n").trim();
}

function summarizeRetrievalResults(results: Array<{ query: string; purpose: string; tool: string; status: string; output?: unknown; error?: string }>) {
  return results.map((result) => ({
    query: result.query,
    purpose: result.purpose,
    tool: result.tool,
    status: result.status,
    resultCount: arxivResultCount(result.output) ?? 0,
    topResults: arxivTopResults(result.output),
    error: result.error,
  }));
}

function inferEvidenceGapsFromDigest(summary: string): string[] {
  return summary
    .split(/\r?\n/)
    .map((line) => line.replace(/^[-*]\s+/, "").trim())
    .filter((line) => /gap|missing|unclear|unknown|future|need|limitation/i.test(line))
    .map((line) => line.slice(0, 300))
    .slice(0, 10);
}

function firstMarkdownParagraph(markdown: string): string {
  for (const block of markdown.split(/\n\s*\n/)) {
    const normalized = block
      .split(/\r?\n/)
      .map((line) => line.replace(/^#{1,6}\s+/, "").replace(/^[-*]\s+/, "").trim())
      .filter(Boolean)
      .join(" ");
    if (normalized) return normalized;
  }
  return "";
}

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : String(value ?? "").trim();
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map(asString).filter(Boolean);
}

function normalizeEnum<T extends string>(value: unknown, allowed: T[]): T {
  const text = asString(value);
  return allowed.includes(text as T) ? text as T : allowed[allowed.length - 1];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
