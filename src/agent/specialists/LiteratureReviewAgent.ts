import { makeId } from "../../shared/ids.js";
import type { ArtifactRef, StageResult } from "../../shared/StageContracts.js";
import type { LiteratureReviewSynthesisInput, LiteratureStructuredExtraction } from "../../literature/LiteratureReviewRuntimeStore.js";
import {
  type PaperDigest,
  type PaperDigestResult,
} from "../../literature/PaperDigest.js";
import { PaperIngest, type PaperIngestBatchResult, type PaperIngestInput } from "../../literature/PaperIngest.js";
import { WikiRetrieve } from "../../literature/WikiRetrieval.js";
import type { PaperSource } from "./literature/PaperSource.js";
import type { LiteratureSearchPaper } from "../../shared/LiteratureSearchTypes.js";
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
    const providedSources = this.readProvidedSources(input);
    const task = input.plan.inputs.task as { question?: string; discipline?: string } | undefined;
    const problemFrameArtifact = this.findLatestProblemFrameArtifact(input);
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
    const screenedQueries = await this.screenGeneratedLiteratureQueries(input, generatedPlan.plan.queries, problemFrame);
    const searchSettings = literatureSearchSettings(input);
    const searchQueries = screenedQueries.accepted.slice(0, searchSettings.maxAcceptedQueries);
    const deferredQueries = screenedQueries.accepted.slice(searchSettings.maxAcceptedQueries);
    if (searchQueries.length === 0) {
      return this.missingGeneratedSearchPlan(input, task, generatedPlan, screenedQueries.rejected);
    }
    input.onProgress?.({
      label: "Validate literature queries",
      detail: "Accepted model-generated queries and rejected low-quality or unsupported query strings.",
      data: {
        queryCount: searchQueries.length,
        queries: searchQueries.map((item) => `[${item.language}] ${item.query}`),
        deferredQueries: deferredQueries.map((item) => `[${item.language}] ${item.query}`),
        rejectedQueries: screenedQueries.rejected,
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
    const retrievalResults = await this.searchLiterature(input, searchSteps.steps, searchSettings.perQueryLimit, 0);
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
        disciplineScope: item.disciplineScope,
        tools: searchSteps.tools,
      }));
      const roundResults = await this.searchLiterature(input, expansionSteps, searchSettings.perQueryLimit, round);
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
        note: "Current retrieval tools do not expose parsed reference lists, so this round uses seed title/abstract-based neighborhood expansion.",
      });
    }
    usefulPapers = await this.downloadUsefulPapers(input, usefulPapers);
    const paperDigestRun = await this.ingestUsefulPapers(input, usefulPapers, problemFrame.discipline);
    const paperDigests = paperDigestRun.digests;
    const retrievedSourceContext = renderUsefulPaperContext(usefulPapers);
    const paperDigestContext = renderPaperDigestContext(paperDigests);
    const paperDigestFailureContext = renderPaperDigestFailureContext(paperDigestRun.failures);
    const providedSourceContext = renderProvidedSourceContext(providedSources);
    const evidenceContext = [retrievedSourceContext, paperDigestContext, paperDigestFailureContext, providedSourceContext].filter(Boolean).join("\n\n");
    input.onProgress?.({
      label: "Collect candidate sources",
      detail: "Collected, screened, expanded, and downloaded useful literature sources for digest synthesis.",
      data: {
        plannedQueryCount: searchSteps.steps.length,
        retrievedSourceCount: retrievalResults.reduce((count, result) => count + (literatureResultCount(result.output) ?? 0), 0),
        initialCandidateCount: initialCandidates.length,
        usefulPaperCount: usefulPapers.length,
        downloadedPaperCount: usefulPapers.filter((paper) => paper.localPath).length,
        paperDigestCount: paperDigests.length,
        paperDigestFailureCount: paperDigestRun.failures.length,
        paperWikiWriteStatus: paperDigestRun.wikiIngest.write.status,
        paperWikiWrittenFileCount: paperDigestRun.wikiIngest.write.writtenFiles.length,
        referenceExpansionRounds: expansionSummaries,
        providedSourceCount: providedSources.length,
      },
    });
    const digestMarkdown = await this.modelStep(input, {
      prompt: [
        `Create a literature review digest for: ${input.plan.objective}.`,
        "Write the digest in English. Preserve technical terms, paper titles, method names, URLs, and identifiers in their original form.",
        "Search plan:",
        renderSearchPlanForPrompt(generatedPlan.plan.search_strategy, searchQueries),
        `Language policy: primary=${problemFrame.languagePolicy.primarySearchLanguage}; input=${problemFrame.languagePolicy.inputLanguage}; reason=${problemFrame.languagePolicy.reason}`,
        "Use only the source context below. Do not add papers, claims, or URLs that are not visible in this context.",
        `Source context:\n${evidenceContext || "No retrieved or user-provided source context was available."}`,
        "Include search scope, source selection, consensus claims, conflicts, quality caveats, and evidence gaps.",
      ].join("\n"),
    });
    input.onProgress?.({
      label: "Digest literature evidence",
      detail: "Synthesized retrieved/planned literature context into a review digest.",
      data: {
        providedSources: providedSources.map((item) => item.title),
        digestTool: "literature_digest_synthesis",
      },
    });
    const modelStep = (options: Parameters<ModelStepRunner>[0]) => this.modelStep(input, options);
    const structuredExtraction = await extractStructuredLiteratureReview(digestMarkdown, evidenceContext, searchQueries, modelStep);
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
      label: "Update literature runtime store",
      detail: "Recorded review synthesis, provisional claims, quality grades, and conflict groups in the literature runtime store.",
      data: {
        reviewId: reviewSynthesis?.id,
        sourceCount: reviewSynthesis?.sourceCount ?? 0,
        claimCount: reviewSynthesis?.claimIds.length ?? 0,
        conflictGroupCount: reviewSynthesis?.conflictGroupIds.length ?? 0,
      },
    });
    const summary = this.renderResultMarkdown({
      digestMarkdown,
      providedSourceTitles: providedSources.map((item) => item.title),
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
              rejectedQueries: screenedQueries.rejected,
              searchSteps,
              retrievalResults: summarizeRetrievalResults(retrievalResults),
              relevanceScreening: {
                initialCandidateCount: initialCandidates.length,
                usefulPaperCount: usefulPapers.length,
                usefulPapers: usefulPapers.map(summarizeUsefulPaper),
                paperDigests: paperDigests.map(summarizePaperDigest),
                paperDigestFailures: paperDigestRun.failures,
                paperWikiIngest: paperDigestRun.wikiIngest,
              },
              referenceExpansionRounds: expansionSummaries,
              note: "Literature retrieval used the configured live search tools and kept results in the shared literature-search output contract.",
            },
          },
        },
        ...(providedSources.length > 0
          ? [{
              label: "Read provided sources",
              status: "completed" as const,
              detail: "Included explicitly provided literature sources as additional source context.",
              data: {
                sourceCount: providedSources.length,
                sourceTitles: providedSources.map((item) => item.title),
                sourceIds: providedSources.map((item) => item.id),
              },
            }]
          : []),
        {
          label: "Synthesize digest",
          status: "completed",
          detail: "Asked the literature specialist model to summarize consensus, conflicts, and gaps.",
          data: {
            digestPreview: digestMarkdown.slice(0, 420),
            reviewSynthesis,
            structuredExtraction,
            paperDigests: paperDigests.map(summarizePaperDigest),
            paperDigestFailures: paperDigestRun.failures,
            paperWikiIngest: paperDigestRun.wikiIngest,
          },
        },
        {
          label: "Record literature knowledge",
          status: "completed",
          detail: "Marked the review as provisional until real search tools return source-backed claims.",
          data: {
            caveat: "The review is source-backed by retrieved metadata and downloaded PDFs when available; claims remain provisional until paper-level reading is expanded.",
              retrieval: summarizeRetrievalResults(retrievalResults),
              literatureRuntimeStore: input.literature
                ? {
                    claimTable: input.literature.renderClaimTable(),
                    conflictMap: input.literature.renderConflictMap(),
                  }
                : undefined,
              storage: {
                literatureRuntimeStore: ["citation library", "runtime review records", "claim/conflict runtime state"],
                paperDigests: ["paper digest cache", "paper digest failures"],
                literatureWiki: input.literatureWikiRoot,
                memory: "project/reference memory proposal titled Literature review digest",
            },
          },
        },
      ],
      evidence: [
        {
          id: makeId("evidence-literature"),
          claim: retrievalResults.some((result) => (literatureResultCount(result.output) ?? 0) > 0)
            ? "Literature review used live scholarly retrieval results and should preserve source-backed uncertainty."
            : "Literature review attempted live retrieval but found no usable source records.",
          source: "literature_review_agent",
          strength: retrievalResults.some((result) => (literatureResultCount(result.output) ?? 0) > 0) ? "medium" : "unknown",
          uncertainty: "Metadata-level retrieval is incomplete coverage and should be complemented by paper-level reading and source-specific search",
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
                paperDigests,
                paperDigestFailures: paperDigestRun.failures,
                paperWikiIngest: paperDigestRun.wikiIngest,
                referenceExpansionRounds: expansionSummaries,
                rejectedQueries: screenedQueries.rejected,
                claimTable: input.literature?.renderClaimTable(),
                conflictMap: input.literature?.renderConflictMap(),
              },
            },
          ]
        : [],
      memoryProposals: [
        {
          scope: "project",
          kind: "reference",
          title: "Literature review digest",
          summary: firstMarkdownParagraph(digestMarkdown).slice(0, 220) || digestMarkdown.slice(0, 220),
          content: `${summary}\n\n## Source Context\n${evidenceContext}`,
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

  private readProvidedSources(input: SpecialistRunInput): PaperSource[] {
    const task = input.plan.inputs.task as { constraints?: Record<string, unknown> } | undefined;
    const sourcesFromTask = task?.constraints?.literatureSources;
    return Array.isArray(sourcesFromTask) ? (sourcesFromTask as PaperSource[]) : [];
  }

  private findLatestProblemFrameArtifact(input: SpecialistRunInput): ArtifactRef | undefined {
    const artifacts = input.researchState.artifactRefs ?? [];
    for (let index = artifacts.length - 1; index >= 0; index -= 1) {
      const artifact = artifacts[index];
      if (artifact.id === "problem_frame" || artifact.kind === "problem_frame") {
        return artifact;
      }
    }
    return undefined;
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
      "Generate candidate literature search queries from the framed scientific problem.",
      "",
      "Your job is to propose a diverse candidate query pool, not to write the final review.",
      "",
      "Use the framed problem to cover these retrieval intents:",
      "1. broad conceptual background",
      "2. mechanism / method / architecture",
      "3. evaluation / benchmark / empirical evidence",
      "4. limitations / failure modes / controversies",
      "5. exact terminology or named concept, only when justified by the frame",
      "",
      `Discipline: ${problemFrame.discipline}`,
      "Output/query language: English.",
      `Original user question: ${originalQuestion}`,
      "",
      "Problem frame:",
      problemFrame.renderedMarkdown,
      "",
      "Query rules:",
      "- Return up to 10 English database-ready search strings.",
      "- Write all purpose, scope, rationale, search_strategy, and exclusion text in English.",
      "- For each query, include disciplineScope: the scientific/domain scope this query is intended to cover, e.g. artificial_intelligence, mathematics, physics, chemistry, chemical_engineering, cross_disciplinary, or a concise method-domain label such as artificial_intelligence/mechanistic_interpretability.",
      "- Use disciplineScope to make coverage explicit; do not put discipline labels into the query string unless they are useful search terms.",
      "- Each query must be directly usable in arXiv, Semantic Scholar, Google Scholar, or similar scholarly search.",
      "- Prefer robust keyword-style queries over natural-language questions.",
      "- Prefer broad-to-focused coverage rather than many near-duplicate narrow queries.",
      "- Include at least one broad/context query unless the framed problem is already extremely narrow.",
      "- Use exact quoted phrases only when the exact phrase appears in the original question or problem frame.",
      "- If the original user question includes paper links, treat them as source, baseline, and terminology anchors.",
      "- Include at most one source-anchor query aimed at recovering the linked paper or its exact terminology; do not include URLs in query strings.",
      "- Use the remaining queries to explore related mechanisms, method families, evaluations, limitations, and improvement directions from the framed problem.",
      "- Do not invent obscure acronyms, paper names, benchmark names, method names, or aliases. Standard field terminology is allowed when supported by the framed problem or original question.",
      "- Do not include instructions such as \"find papers about\".",
      "- Do not include Chinese text in query strings.",
      "- Do not include URLs.",
      "- Do not include more than one very narrow exact-match query unless the frame explicitly requires it.",
      "- If the framed problem is ambiguous, include one query that helps disambiguate the term.",
      "",
      schemaInstruction(LITERATURE_QUERY_PLAN_SCHEMA),
    ].join("\n");
    const raw = await this.modelStep(input, {
      stepId: "literature_query_planning_model",
      prompt,
      includeRenderedContext: false,
      stageUserInputPolicy: [
        "Use handoff notes as literature retrieval guidance: source hints, baseline papers, terminology anchors, coverage priorities, scope constraints, or exclusions.",
        "If notes include paper links, treat them as source, baseline, and terminology anchors, but do not include raw URLs in search query strings.",
        "Use linked-paper titles, methods, benchmarks, authors, venues, or exact terminology only when visible in the notes or prompt; do not invent missing details.",
        "Keep the accepted problem frame as the main research frame; if notes conflict with it, reflect the conflict in search_strategy or exclusions instead of silently changing the research problem.",
      ],
    });
    const modelStep = (options: Parameters<ModelStepRunner>[0]) => this.modelStep(input, options);
    return { raw, plan: await parseOrRepairLiteratureQueryPlan(raw, modelStep) };
  }

  private async screenGeneratedLiteratureQueries(
    input: SpecialistRunInput,
    queries: LiteratureQueryPlanItem[],
    problemFrame: ProblemFrameArtifactView,
  ): Promise<{ accepted: NormalizedSearchQuery[]; rejected: Array<{ query: string; reason: string }> }> {
    const task = input.plan.inputs.task as { question?: string } | undefined;
    const originalQuestion = task?.question ?? input.plan.objective;
    const candidateQueries = queries.map((item) => ({
      purpose: item.purpose,
      query: item.query,
      scope: item.scope,
      disciplineScope: item.disciplineScope,
      rationale: item.rationale,
    }));
    const prompt = [
      "Curate the final literature search query set for a scientific literature review.",
      "",
      "You are given:",
      "1. the framed scientific problem",
      "2. candidate queries generated by a query planner",
      "",
      "Your job is to produce the final retrieval set.",
      "",
      "Evaluate each candidate query for:",
      "- relevance to the framed objective",
      "- coverage of key variables and mechanisms",
      "- likely retrieval precision",
      "- likely retrieval recall",
      "- redundancy with other queries",
      "- risk of being too narrow, too broad, ambiguous, or noisy",
      "- whether it introduces unsupported terminology",
      "",
      "Final query set requirements:",
      "- Return exactly 5 final English database-ready search strings unless the problem is genuinely underspecified.",
      "- Write all purpose, rationale, and rejection reason text in English.",
      "- If fewer than 5 candidate queries are high quality, generate replacement queries.",
      "- The final set should balance:",
      "  1. broad context",
      "  2. mechanism / method",
      "  3. evaluation / evidence",
      "  4. limitations / failure modes / controversy",
      "  5. exact term / disambiguation when justified",
      "- For each final query, include disciplineScope: the scientific/domain scope this query is intended to cover, e.g. artificial_intelligence, mathematics, physics, chemistry, chemical_engineering, cross_disciplinary, or a concise method-domain label such as artificial_intelligence/mechanistic_interpretability.",
      "- Use disciplineScope to make coverage explicit; do not put discipline labels into the query string unless they are useful search terms.",
      "- Do not simply preserve the original candidate order.",
      "- Do not include redundant variants of the same query.",
      "- Do not include natural-language questions.",
      "- Do not include instructions such as \"find papers about\".",
      "- Do not include Chinese text in query strings.",
      "- Do not invent acronyms, paper names, benchmark names, method names, or aliases not present in the framed problem unless they are clearly standard field terminology.",
      "- If the original user question includes paper links, preserve the linked-paper context as a retrieval anchor while keeping URLs out of final query strings.",
      "- Prefer queries that will retrieve papers, not blog posts or generic web pages.",
      "",
      "Original user question:",
      originalQuestion,
      "",
      "Problem frame:",
      problemFrame.renderedMarkdown,
      "",
      "Candidate queries:",
      JSON.stringify(candidateQueries, null, 2),
      "",
      schemaInstruction(QUERY_CURATION_SCHEMA),
    ].join("\n");
    const raw = await this.modelStep(input, {
      stepId: "literature_query_curation_model",
      system: "You are a strict scientific literature-search query curator. Return valid JSON only.",
      prompt,
      includeRenderedContext: false,
      stream: false,
      stageUserInputPolicy: [
        "Use user notes to accept, reject, or replace candidate queries.",
        "Prefer final queries that satisfy note-based scope constraints, source hints, linked-paper anchors, exclusions, or coverage priorities.",
        "If notes include paper links, preserve linked-paper context as source, baseline, and terminology anchors while keeping raw URLs out of final query strings.",
        "Reject or rewrite candidate queries that violate explicit note-based constraints or ignore important note-based source hints.",
      ],
    });
    const curation = await parseOrRepairQueryCuration(raw, (options) => this.modelStep(input, options));
    const normalized = curation.queries
      .map((item) => normalizeCuratedQuery(item, problemFrame.languagePolicy))
      .filter((item): item is NormalizedSearchQuery => Boolean(item));
    const accepted = dedupeQueries(normalized).slice(0, 5);
    input.onProgress?.({
      label: "Curate literature queries",
      detail: "Used an LLM query curator to judge candidate queries, replace weak ones, and produce the final search set.",
      data: {
        candidateCount: candidateQueries.length,
        acceptedCount: accepted.length,
        rejectedCount: curation.rejected.length,
        acceptedQueries: accepted,
        rejectedQueries: curation.rejected,
        strategy: curation.strategy,
      },
    });
    return {
      accepted,
      rejected: curation.rejected,
    };
  }

  private async searchLiterature(
    input: SpecialistRunInput,
    steps: Array<{ index: number; query: string; language: string; purpose: string; disciplineScope?: string; tools: string[] }>,
    limit: number,
    round: number,
  ): Promise<RetrievalResult[]> {
    const retrievalResults: RetrievalResult[] = [];
    for (const step of steps) {
      const toolResults: RetrievalResult[] = [];
      for (const tool of step.tools) {
        const result = await input.tools.call({
          name: tool,
          arguments: {
            query: step.query,
            limit,
          },
        });
        const retrievalResult = {
          query: step.query,
          purpose: step.purpose,
          disciplineScope: step.disciplineScope,
          tool,
          status: result.status,
          output: result.output,
          error: result.error,
        };
        toolResults.push(retrievalResult);
        retrievalResults.push(retrievalResult);
      }
      input.onProgress?.({
        label: round > 0 ? `Reference expansion ${round}: query ${step.index}/${steps.length}` : `Search query ${step.index}/${steps.length}`,
        detail: step.query,
        data: {
          language: step.language,
          purpose: step.purpose,
          disciplineScope: step.disciplineScope,
          tools: step.tools,
          resultsByTool: toolResults.map((result) => ({
            tool: result.tool,
            status: result.status,
            resultCount: literatureResultCount(result.output),
            topResults: literatureTopResults(result.output),
            error: result.error,
          })),
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
      "Write all purpose and rationale text in English.",
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

  private async ingestUsefulPapers(
    input: SpecialistRunInput,
    usefulPapers: UsefulLiteraturePaper[],
    disciplineHint?: string,
  ): Promise<PaperDigestBatchResult> {
    if (!input.paperDigests) {
      throw new Error("LiteratureReviewAgent requires PaperDigests for paper ingest.");
    }
    if (!input.literatureWikiRoot) {
      throw new Error("LiteratureReviewAgent requires literatureWikiRoot for paper ingest.");
    }
    const discipline = normalizeDigestDisciplineHint(disciplineHint);
    const service = new PaperIngest(
      (options) => this.modelStep(input, options),
      input.paperDigests,
      new WikiRetrieve(),
      {
        pdfUrlReadSupport: input.model.pdfUrlReadSupport ?? "unsupported",
        pdfFileReadSupport: input.model.pdfFileReadSupport ?? "unsupported",
      },
    );
    const paperInputs = usefulPapers.map((paper) => paperIngestInputFromUsefulPaper(paper, disciplineHint));
    const uniqueInputs = dedupeByKey(paperInputs, paperIngestInputCacheKey);
    const ingestResult = await service.ingestBatch(uniqueInputs.map((paper) => ({
      paper,
      wikiRoot: input.literatureWikiRoot!,
      ...(discipline ? { discipline } : {}),
    })));
    const failures = ingestResult.failures.flatMap((failure) => failure.digestFailure ? [failure.digestFailure] : []);
    for (const digest of ingestResult.digests) {
      input.onProgress?.({
        label: ingestResult.completed.some((item) => item.digest.id === digest.id) ? "Ingest paper into wiki" : "Reuse ingested paper",
        detail: digest.title || digest.sourceId,
        data: {
          sourceId: digest.sourceId,
          canonicalPaperKey: digest.canonicalPaperKey,
          digestId: digest.id,
          sourceKind: digest.sourceKind,
          contentLevel: digest.contentLevel,
          pdfUrl: findPdfUrlIngestInput(paperInputs, digest.sourceId)?.pdfUrl,
          notesIncluded: false,
          wikiRoot: input.literatureWikiRoot,
          wikiPages: ingestResult.lookupIndex[digest.canonicalPaperKey]?.length ?? 0,
        },
      });
    }
    return {
      digests: ingestResult.digests,
      failures,
      wikiIngest: ingestResult,
    };
  }

  private planSearchSteps(searchQueries: Array<{ query: string; language: string; purpose: string; disciplineScope?: string }>) {
    const tools = ["arxiv_search"];
    return {
      tools,
      steps: searchQueries.map((item, index) => ({
        index: index + 1,
        query: item.query,
        language: item.language,
        purpose: item.purpose,
        disciplineScope: item.disciplineScope,
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
  disciplineScope: string;
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
  disciplineScope: string;
}

interface CuratedLiteratureQuery {
  query: string;
  purpose: string;
  coverageRole: string;
  disciplineScope: string;
  source: "kept" | "replaced" | "generated";
  rationale: string;
}

interface QueryCurationResult {
  strategy: string;
  queries: CuratedLiteratureQuery[];
  rejected: Array<{ query: string; reason: string }>;
}

interface RetrievalResult {
  query: string;
  purpose: string;
  disciplineScope?: string;
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
  categories?: string[];
  sourceType: string;
  query: string;
  purpose: string;
  disciplineScope?: string;
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
  disciplineScope?: string;
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

interface PaperDigestBatchResult {
  digests: PaperDigest[];
  failures: Array<Extract<PaperDigestResult, { status: "failed" }>>;
  wikiIngest: PaperIngestBatchResult;
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
          required: ["purpose", "query", "scope", "disciplineScope", "rationale"],
          properties: {
            purpose: { type: "string" },
            query: { type: "string" },
            scope: {
              type: "string",
              description: "One of: broad, focused, exact.",
            },
            disciplineScope: {
              type: "string",
              description: "Scientific/domain scope covered by this query, such as artificial_intelligence, mathematics, physics, chemistry, chemical_engineering, cross_disciplinary, or artificial_intelligence/mechanistic_interpretability.",
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

const QUERY_CURATION_SCHEMA: StructuredSchema = {
  name: "literature_query_curation",
  description: "Final curated literature search queries selected or generated from candidate queries.",
  schema: {
    type: "object",
    required: ["strategy", "queries", "rejected"],
    properties: {
      strategy: {
        type: "string",
        description: "Concise explanation of how the final query set covers the framed problem.",
      },
      queries: {
        type: "array",
        description: "Exactly 5 final search queries when possible.",
        items: {
          type: "object",
          required: ["query", "purpose", "coverageRole", "disciplineScope", "source", "rationale"],
          properties: {
            query: { type: "string" },
            coverageRole: { type: "string", description: "One of: broad_context, mechanism_method, evaluation_limitations, exact_term, background, reject." },
            purpose: { type: "string" },
            disciplineScope: {
              type: "string",
              description: "Primary discipline or method domain covered by this final query.",
            },
            source: { type: "string", description: "One of: kept, replaced, generated." },
            rationale: { type: "string" },
          },
        },
      },
      rejected: {
        type: "array",
        items: {
          type: "object",
          required: ["query", "reason"],
          properties: {
            query: { type: "string" },
            reason: { type: "string" },
          },
        },
      },
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
          required: ["query", "purpose", "disciplineScope", "seedPaperIds", "rationale"],
          properties: {
            query: { type: "string" },
            purpose: { type: "string" },
            disciplineScope: { type: "string" },
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
            disciplineScope: asString(record.disciplineScope),
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
  searchQueries: Array<{ query: string; language: string; purpose: string; disciplineScope?: string }>,
  modelStep: ModelStepRunner,
): Promise<LiteratureStructuredExtraction | undefined> {
  const prompt = [
    "Extract a structured systematic-review style evidence table from the literature digest and retrieved source context.",
    "Write all extracted claim, note, attribution, evidence-gap, and summary text in English.",
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
    "Source context index:",
    compactSourceContext(sourceContext),
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

async function parseOrRepairQueryCuration(rawText: string, modelStep: ModelStepRunner): Promise<QueryCurationResult> {
  try {
    return coerceQueryCuration(parseStructuredOutput(rawText, QUERY_CURATION_SCHEMA));
  } catch (error) {
    try {
      return coerceQueryCuration(salvageStructuredOutput(rawText, QUERY_CURATION_SCHEMA));
    } catch {
      const repaired = await modelStep({
        stepId: "literature_query_curation_repair_model",
        system: "You repair invalid literature query curation outputs into valid JSON.",
        prompt: repairInstruction(
          QUERY_CURATION_SCHEMA,
          rawText,
          error instanceof Error ? error.message : String(error),
        ),
        includeRenderedContext: false,
        stream: false,
      });
      return coerceQueryCuration(parseStructuredOutput(repaired, QUERY_CURATION_SCHEMA));
    }
  }
}

function coerceQueryCuration(value: Record<string, unknown>): QueryCurationResult {
  return {
    strategy: asString(value.strategy),
    queries: Array.isArray(value.queries)
      ? value.queries.map((item) => {
          const record = isRecord(item) ? item : {};
          return {
            query: asString(record.query),
            purpose: asString(record.purpose),
            coverageRole: asString(record.coverageRole) || "background",
            disciplineScope: asString(record.disciplineScope),
            source: normalizeEnum(record.source, ["kept", "replaced", "generated"]),
            rationale: asString(record.rationale),
          };
        }).filter((item) => item.query)
      : [],
    rejected: Array.isArray(value.rejected)
      ? value.rejected.map((item) => {
          const record = isRecord(item) ? item : {};
          return {
            query: asString(record.query),
            reason: asString(record.reason),
          };
        }).filter((item) => item.query)
      : [],
  };
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
            disciplineScope: asString(record.disciplineScope),
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

function collectCandidatePapers(results: RetrievalResult[], round: number, discoveryMethod: LiteraturePaperCandidate["discoveryMethod"]): LiteraturePaperCandidate[] {
  const candidates = results.flatMap((result) =>
    readLiteratureSearchPapers(result.output).map((item) => ({
      id: item.id,
      title: item.title,
      link: item.link,
      summary: item.summary,
      authors: item.authors,
      publishedAt: item.publishedAt,
      categories: item.categories,
      sourceType: result.tool,
      query: result.query,
      purpose: result.purpose,
      disciplineScope: result.disciplineScope,
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
  const byQuery = new Map<string, { tool: string; query: string; purpose: string; disciplineScope?: string; papers: UsefulLiteraturePaper[] }>();
  for (const paper of papers) {
    const key = JSON.stringify([paper.sourceType, paper.query, paper.disciplineScope]);
    const current = byQuery.get(key) ?? {
      tool: paper.sourceType,
      query: paper.query,
      purpose: paper.purpose,
      disciplineScope: paper.disciplineScope,
      papers: [],
    };
    current.papers.push(paper);
    byQuery.set(key, current);
  }
  return [...byQuery.values()].map((group) => {
    return {
      query: group.query,
      purpose: group.purpose,
      disciplineScope: group.disciplineScope,
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
    categories: paper.categories,
    query: paper.query,
    purpose: paper.purpose,
    disciplineScope: paper.disciplineScope,
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
    disciplineScope: paper.disciplineScope,
    discoveryRound: paper.discoveryRound,
    discoveryMethod: paper.discoveryMethod,
    localPath: paper.localPath,
  };
}

function summarizePaperDigest(digest: PaperDigest): Record<string, unknown> {
  return {
    id: digest.id,
    sourceId: digest.sourceId,
    canonicalPaperKey: digest.canonicalPaperKey,
    sourceKind: digest.sourceKind,
    discipline: digest.discipline,
    schemaFamily: digest.schemaFamily,
    selectionReason: digest.selectionReason,
    doi: digest.doi,
    arxivId: digest.arxivId,
    title: digest.title,
    contentLevel: digest.contentLevel,
    usefulAs: digest.literatureReviewUse.usefulAs,
    searchTerms: digest.literatureReviewUse.searchTerms.slice(0, 8),
    uncertainty: digest.uncertainty.slice(0, 5),
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

function paperPdfUrl(paper: UsefulLiteraturePaper): string | undefined {
  const link = paper.link?.trim();
  if (!link) return undefined;
  if (link.includes("arxiv.org/abs/")) return link.replace("/abs/", "/pdf/");
  return link;
}

function paperIngestInputFromUsefulPaper(paper: UsefulLiteraturePaper, disciplineHint?: string): PaperIngestInput {
  const normalizedDisciplineHint = normalizeDigestDisciplineHint(disciplineHint);
  const pdfUrl = paperPdfUrl(paper);
  if (!pdfUrl) {
    return {
      kind: "pdf_url",
      sourceId: paper.id,
      pdfUrl: "",
      ...(normalizedDisciplineHint ? { disciplineHint: normalizedDisciplineHint } : {}),
    };
  }
  return {
    kind: "pdf_url",
    sourceId: paper.id,
    pdfUrl,
    ...(normalizedDisciplineHint ? { disciplineHint: normalizedDisciplineHint } : {}),
  };
}

function findPdfUrlIngestInput(inputs: PaperIngestInput[], sourceId: string): Extract<PaperIngestInput, { kind: "pdf_url" }> | undefined {
  return inputs.find((item): item is Extract<PaperIngestInput, { kind: "pdf_url" }> => item.sourceId === sourceId && item.kind === "pdf_url");
}

function dedupeByKey<T>(items: T[], keyOf: (item: T) => string): T[] {
  const byKey = new Map<string, T>();
  for (const item of items) {
    const key = keyOf(item);
    if (!byKey.has(key)) byKey.set(key, item);
  }
  return [...byKey.values()];
}

function paperIngestInputCacheKey(input: PaperIngestInput): string {
  if (input.kind === "pdf_url") {
    return `pdf_url:${input.pdfUrl.trim().toLowerCase()}`;
  }
  return `pdf_file:${input.path.trim().toLowerCase()}`;
}

function normalizeDigestDisciplineHint(value?: string):
  | "artificial_intelligence"
  | "mathematics"
  | "chemistry"
  | "chemical_engineering"
  | "physics"
  | "general_science"
  | "unknown"
  | undefined {
  const normalized = String(value ?? "").trim().toLowerCase().replace(/[\s-]+/g, "_");
  return [
    "artificial_intelligence",
    "mathematics",
    "chemistry",
    "chemical_engineering",
    "physics",
    "general_science",
    "unknown",
  ].includes(normalized)
    ? normalized as
        | "artificial_intelligence"
        | "mathematics"
        | "chemistry"
        | "chemical_engineering"
        | "physics"
        | "general_science"
        | "unknown"
    : undefined;
}

function renderUsefulPaperContext(papers: UsefulLiteraturePaper[]): string {
  const lines: string[] = [];
  for (const paper of papers) {
    lines.push(`## ${paper.title}`);
    lines.push(`- id: ${paper.id}`);
    lines.push(`- url: ${paper.link ?? "no url"}`);
    lines.push(`- local_pdf: ${paper.localPath ?? "not downloaded"}`);
    lines.push(`- discovery: ${paper.discoveryMethod}, round ${paper.discoveryRound}, query="${paper.query}"`);
    if (paper.disciplineScope) lines.push(`- discipline_scope: ${paper.disciplineScope}`);
    lines.push(`- relevance: ${paper.relevance}; role=${paper.role}; reason=${paper.relevanceReason}`);
    if (paper.authors?.length) lines.push(`- authors: ${paper.authors.join(", ")}`);
    if (paper.publishedAt) lines.push(`- published: ${paper.publishedAt}`);
    if (paper.categories?.length) lines.push(`- categories: ${paper.categories.join(", ")}`);
    if (paper.summary) lines.push(`abstract: ${paper.summary.slice(0, 900)}`);
    lines.push("");
  }
  return lines.join("\n").trim();
}

function renderPaperDigestContext(digests: PaperDigest[]): string {
  if (digests.length === 0) return "";
  const lines = ["# Paper Digests", ""];
  for (const digest of digests) {
    lines.push(`## ${digest.title}`);
    lines.push(`- digest_id: ${digest.id}`);
    lines.push(`- source_id: ${digest.sourceId}`);
    lines.push(`- canonical_paper_key: ${digest.canonicalPaperKey}`);
    lines.push(`- source_kind: ${digest.sourceKind}`);
    lines.push(`- content_level: ${digest.contentLevel}`);
    lines.push(`- discipline: ${digest.discipline}`);
    lines.push(`- schema_family: ${digest.schemaFamily}`);
    lines.push(`- schema_family_reason: ${digest.selectionReason}`);
    if (digest.citationLine) lines.push(`- citation: ${digest.citationLine}`);
    lines.push(`- summary: ${digest.oneSentenceSummary}`);
    if (digest.researchProblem) lines.push(`- problem: ${digest.researchProblem}`);
    if (digest.approach) lines.push(`- approach: ${digest.approach}`);
    if (digest.keyContributions.length) lines.push(`- contributions: ${digest.keyContributions.join("; ")}`);
    if (digest.keyClaims.length) lines.push(`- claims: ${digest.keyClaims.join("; ")}`);
    if (digest.importantTerms.length) lines.push(`- important_terms: ${digest.importantTerms.join(", ")}`);
    if (digest.findings.length) lines.push(`- findings: ${digest.findings.join("; ")}`);
    if (digest.limitations.length) lines.push(`- limitations: ${digest.limitations.join("; ")}`);
    const computational = digest.specialized.computationalEmpirical;
    const experimental = digest.specialized.experimentalEmpirical;
    const methodological = digest.specialized.methodologicalOrInstrumentation;
    const theoretical = digest.specialized.theoreticalOrMathematical;
    const review = digest.specialized.reviewOrSurvey;
    if (computational.methods.length) lines.push(`- methods: ${computational.methods.join(", ")}`);
    if (computational.methodFamily.length) lines.push(`- method_family: ${computational.methodFamily.join(", ")}`);
    if (computational.datasets.length) lines.push(`- datasets: ${computational.datasets.join(", ")}`);
    if (computational.benchmarks.length) lines.push(`- benchmarks: ${computational.benchmarks.join(", ")}`);
    if (computational.metrics.length) lines.push(`- metrics: ${computational.metrics.join(", ")}`);
    if (computational.comparators.length) lines.push(`- comparators: ${computational.comparators.join("; ")}`);
    if (computational.failureModesOrRisks.length) lines.push(`- failure_modes_or_risks: ${computational.failureModesOrRisks.join("; ")}`);
    if (experimental.studySystemOrSamples.length) lines.push(`- study_system_or_samples: ${experimental.studySystemOrSamples.join("; ")}`);
    if (experimental.experimentalDesign.length) lines.push(`- experimental_design: ${experimental.experimentalDesign.join("; ")}`);
    if (experimental.protocolsOrAssays.length) lines.push(`- protocols_or_assays: ${experimental.protocolsOrAssays.join("; ")}`);
    if (experimental.measurementEndpoints.length) lines.push(`- measurement_endpoints: ${experimental.measurementEndpoints.join("; ")}`);
    if (experimental.controlsOrComparators.length) lines.push(`- controls_or_comparators: ${experimental.controlsOrComparators.join("; ")}`);
    if (experimental.sourcesOfBias.length) lines.push(`- sources_of_bias: ${experimental.sourcesOfBias.join("; ")}`);
    if (methodological.resourceType.length) lines.push(`- resource_type: ${methodological.resourceType.join("; ")}`);
    if (methodological.resourceScope.length) lines.push(`- resource_scope: ${methodological.resourceScope.join("; ")}`);
    if (methodological.primaryUseCases.length) lines.push(`- primary_use_cases: ${methodological.primaryUseCases.join("; ")}`);
    if (methodological.evaluationSetup.length) lines.push(`- evaluation_setup: ${methodological.evaluationSetup.join("; ")}`);
    if (methodological.comparators.length) lines.push(`- methodological_comparators: ${methodological.comparators.join("; ")}`);
    if (methodological.adoptionConstraints.length) lines.push(`- adoption_constraints: ${methodological.adoptionConstraints.join("; ")}`);
    if (theoretical.formalSetting.length) lines.push(`- formal_setting: ${theoretical.formalSetting.join("; ")}`);
    if (theoretical.assumptions.length) lines.push(`- assumptions: ${theoretical.assumptions.join("; ")}`);
    if (theoretical.mainResults.length) lines.push(`- main_results: ${theoretical.mainResults.join("; ")}`);
    if (theoretical.proofStrategy.length) lines.push(`- proof_strategy: ${theoretical.proofStrategy.join("; ")}`);
    if (theoretical.scopeOfApplicability.length) lines.push(`- scope_of_applicability: ${theoretical.scopeOfApplicability.join("; ")}`);
    if (theoretical.openProblems.length) lines.push(`- open_problems: ${theoretical.openProblems.join("; ")}`);
    if (review.reviewScope.length) lines.push(`- review_scope: ${review.reviewScope.join("; ")}`);
    if (review.selectionCriteria.length) lines.push(`- selection_criteria: ${review.selectionCriteria.join("; ")}`);
    if (review.taxonomy.length) lines.push(`- taxonomy: ${review.taxonomy.join("; ")}`);
    if (review.synthesisMethod.length) lines.push(`- synthesis_method: ${review.synthesisMethod.join("; ")}`);
    if (review.evidenceGaps.length) lines.push(`- evidence_gaps: ${review.evidenceGaps.join("; ")}`);
    if (review.controversies.length) lines.push(`- controversies: ${review.controversies.join("; ")}`);
    if (digest.literatureReviewUse.usefulAs.length) lines.push(`- general_literature_review_use: ${digest.literatureReviewUse.usefulAs.join(", ")}`);
    if (digest.literatureReviewUse.searchTerms.length) lines.push(`- reusable_search_terms: ${digest.literatureReviewUse.searchTerms.join(", ")}`);
    if (digest.literatureReviewUse.expansionDirections.length) lines.push(`- expansion_directions: ${digest.literatureReviewUse.expansionDirections.join("; ")}`);
    if (digest.uncertainty.length) lines.push(`- uncertainty: ${digest.uncertainty.join("; ")}`);
    lines.push("");
  }
  return lines.join("\n").trim();
}

function renderPaperDigestFailureContext(failures: Array<Extract<PaperDigestResult, { status: "failed" }>>): string {
  if (failures.length === 0) return "";
  const lines = ["# Paper Digest Failures", ""];
  for (const failure of failures) {
    lines.push(`- source_id: ${failure.sourceId}; source_kind: ${failure.sourceKind}; reason: ${failure.reason}; retryable: ${String(failure.retryable)}; detail: ${failure.detail}`);
  }
  return lines.join("\n").trim();
}

function renderProvidedSourceContext(sources: PaperSource[]): string {
  const lines: string[] = [];
  for (const source of sources) {
    lines.push(`## ${source.title}`);
    lines.push(`- id: ${source.id}`);
    lines.push(`- source_type: ${source.sourceType}`);
    if (source.url) lines.push(`- url: ${source.url}`);
    if (source.authors?.length) lines.push(`- authors: ${source.authors.join(", ")}`);
    if (source.publishedAt) lines.push(`- published: ${source.publishedAt}`);
    if (source.doi) lines.push(`- doi: ${source.doi}`);
    if (source.content) lines.push(source.content.slice(0, 1200));
    lines.push("");
  }
  return lines.join("\n").trim();
}

function renderSearchPlanForPrompt(
  strategy: string,
  queries: Array<{ query: string; language: string; purpose: string; disciplineScope?: string }>,
): string {
  return [
    `- strategy: ${strategy || "Use accepted literature queries to cover the framed problem."}`,
    ...queries.map((item, index) => `- query ${index + 1} [${item.language}; scope=${item.disciplineScope || "unspecified"}]: ${item.query} - ${item.purpose}`),
  ].join("\n");
}

function renderSearchQueriesForPrompt(queries: Array<{ query: string; language: string; purpose: string; disciplineScope?: string }>): string {
  return queries.map((item, index) => `${index + 1}. [${item.language}; scope=${item.disciplineScope || "unspecified"}] ${item.query} - ${item.purpose}`).join("\n");
}

function compactSourceContext(sourceContext: string): string {
  const lines = sourceContext
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !line.startsWith("abstract:"));
  return lines.length > 0 ? lines.join("\n") : "No source context available.";
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
    disciplineScope: item.disciplineScope || "unspecified",
  };
}

function normalizeCuratedQuery(
  item: CuratedLiteratureQuery,
  languagePolicy?: { primarySearchLanguage: string },
): NormalizedSearchQuery | undefined {
  const normalized = normalizeGeneratedQuery(
    {
      purpose: item.purpose || item.coverageRole,
      query: item.query,
      scope: "focused",
      disciplineScope: item.disciplineScope,
      rationale: item.rationale,
    },
    languagePolicy,
  );
  return normalized;
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

function literatureResultCount(output: unknown): number | undefined {
  const results = isRecord(output) && Array.isArray(output.results) ? output.results : undefined;
  return results ? results.length : undefined;
}

function literatureTopResults(output: unknown): Array<{ title: string; link?: string }> {
  return readLiteratureSearchPapers(output).slice(0, 3).map((item) => ({
    title: item.title,
    link: item.link,
  }));
}

function readLiteratureSearchPapers(output: unknown): LiteratureSearchPaper[] {
  if (!isRecord(output) || !Array.isArray(output.results)) return [];
  return output.results.map((item) => {
    const record = isRecord(item) ? item : {};
    const id = asString(record.id);
    const title = asString(record.title);
    return {
      id: id || `${title}:${asString(record.publishedAt)}`,
      title: title || id || "Untitled source",
      link: asString(record.link) || undefined,
      summary: asString(record.summary) || undefined,
      authors: asStringArray(record.authors),
      publishedAt: asString(record.publishedAt) || undefined,
      categories: asStringArray(record.categories),
    };
  });
}

function summarizeRetrievalResults(results: Array<{ query: string; purpose: string; disciplineScope?: string; tool: string; status: string; output?: unknown; error?: string }>) {
  return results.map((result) => ({
    query: result.query,
    purpose: result.purpose,
    disciplineScope: result.disciplineScope,
    tool: result.tool,
    status: result.status,
    resultCount: literatureResultCount(result.output) ?? 0,
    topResults: literatureTopResults(result.output),
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

function nullableString(value: unknown): string | null {
  const text = asString(value);
  if (!text || text.toLowerCase() === "null") return null;
  return text;
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
