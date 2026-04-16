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
    const retrievalResults = [];
    for (const step of searchSteps.steps) {
      const arxivResult = await input.tools.call({
        name: "arxiv_search",
        arguments: {
          query: step.query,
          limit: 5,
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
        label: `Search query ${step.index}/${searchSteps.steps.length}`,
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
    const sourceContext = renderRetrievalContext(retrievalResults);
    input.onProgress?.({
      label: "Collect candidate sources",
      detail: "Collected live arXiv retrieval results and provided sources for digest synthesis.",
      data: {
        plannedQueryCount: searchSteps.steps.length,
        retrievedSourceCount: retrievalResults.reduce((count, result) => count + (arxivResultCount(result.output) ?? 0), 0),
        providedSourceCount: sourceIngests.length,
      },
    });
    const summary = await this.modelSummary(
      input,
      [
        `Create a literature review digest for: ${input.plan.objective}.`,
        `Use these initial search queries as the search plan: ${searchQueries.map((item) => `[${item.language}] ${item.query}`).join(" | ")}.`,
        `Language policy: primary=${languagePolicy.primarySearchLanguage}; input=${languagePolicy.inputLanguage}; reason=${languagePolicy.reason}`,
        `Retrieved source context:\n${sourceContext || "No live retrieval results were available."}`,
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
    const structuredExtraction = await extractStructuredLiteratureReview(input, summary, sourceContext, searchQueries);
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
      summaryMarkdown: summary,
      queries: searchQueries,
      retrievedSources: toReviewSynthesisSources(retrievalResults),
      evidenceGaps: structuredExtraction?.evidenceGaps ?? inferEvidenceGapsFromDigest(summary),
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
              retrievalResults: summarizeRetrievalResults(retrievalResults),
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
            digestPreview: summary.slice(0, 420),
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
        summary: summary.slice(0, 220),
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

async function extractStructuredLiteratureReview(
  input: SpecialistRunInput,
  summary: string,
  sourceContext: string,
  searchQueries: Array<{ query: string; language: string; purpose: string }>,
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
    JSON.stringify(searchQueries, null, 2),
    "",
    "Literature digest:",
    summary,
    "",
    "Retrieved source context:",
    sourceContext || "No retrieved source context available.",
    "",
    schemaInstruction(LITERATURE_EXTRACTION_SCHEMA),
  ].join("\n");
  input.onModelPrompt?.({
    specialistId: "literature_structured_extractor",
    system: "You extract decision-grade scientific literature evidence tables as valid JSON.",
    user: prompt,
  });
  const raw = await input.model.complete(
    [
      {
        role: "system",
        content: "You extract decision-grade scientific literature evidence tables as valid JSON.",
      },
      { role: "user", content: prompt },
    ],
    {
      onStatus: input.onModelStatus,
      onTextDelta: input.onModelDelta,
    },
  );
  return parseOrRepairLiteratureExtraction(input, raw.text);
}

async function parseOrRepairLiteratureExtraction(input: SpecialistRunInput, rawText: string): Promise<LiteratureStructuredExtraction | undefined> {
  try {
    return coerceLiteratureExtraction(parseStructuredOutput(rawText, LITERATURE_EXTRACTION_SCHEMA));
  } catch (error) {
    try {
      return coerceLiteratureExtraction(salvageStructuredOutput(rawText, LITERATURE_EXTRACTION_SCHEMA));
    } catch {
      try {
        const repaired = await input.model.complete(
          [
            {
              role: "system",
              content: "You repair invalid structured scientific literature extraction outputs into valid JSON.",
            },
            {
              role: "user",
              content: repairInstruction(
                LITERATURE_EXTRACTION_SCHEMA,
                rawText,
                error instanceof Error ? error.message : String(error),
              ),
            },
          ],
          {
            onStatus: input.onModelStatus,
            onTextDelta: input.onModelDelta,
          },
        );
        return coerceLiteratureExtraction(parseStructuredOutput(repaired.text, LITERATURE_EXTRACTION_SCHEMA));
      } catch {
        return undefined;
      }
    }
  }
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

function toReviewSynthesisSources(
  results: Array<{ query: string; purpose: string; tool: string; status: string; output?: unknown; error?: string }>,
): LiteratureReviewSynthesisInput["retrievedSources"] {
  return results.map((result) => ({
    query: result.query,
    purpose: result.purpose,
    tool: result.tool,
    status: result.status,
    results: arxivResultItems(result.output).map((item) => ({
      id: item.id,
      title: item.title,
      link: item.link,
      summary: item.summary,
      authors: item.authors,
      publishedAt: item.publishedAt,
      sourceType: result.tool,
    })),
  }));
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
