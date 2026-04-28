import { appendFile, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import {
  parseStructuredOutput,
  repairInstruction,
  salvageStructuredOutput,
  type StructuredSchema,
} from "../structured/StructuredOutput.js";
import {
  PaperDigests,
  type LiteratureDiscipline,
  type PaperDigest,
  type PaperDigestCapabilities,
  type PaperDigestInput,
  type PaperDigestPdfFileInput,
  type PaperDigestPdfUrlInput,
  type PaperDigestResult,
  type PaperDigestSchemaFamily,
} from "./PaperDigest.js";
import {
  buildLiteratureWikiLookupResult,
  literatureWikiPageLinks,
  literatureWikiPageDirectory,
  literatureWikiPagePath,
  parseLiteratureWikiPageMarkdown,
  renderLiteratureWikiPageMarkdown,
  type LiteratureWikiBenchmarkPage,
  type LiteratureWikiClaimPage,
  type LiteratureWikiFindingPage,
  type LiteratureWikiFormalResultPage,
  type LiteratureWikiLookupIndex,
  type LiteratureWikiMethodPage,
  type LiteratureWikiPage,
  type LiteratureWikiPaperPage,
  type LiteratureWikiResearchQuestionPage,
  type LiteratureWikiSynthesisPage,
  type LiteratureWikiTopicPage,
} from "./LiteratureWikiPage.js";
import { WikiRetrieve, type WikiRetrieveMode, type WikiRetrievePage } from "./WikiRetrieval.js";

export type PaperIngestWikiPageKind =
  | "paper"
  | "research_question"
  | "method"
  | "benchmark"
  | "finding"
  | "formal_result"
  | "claim"
  | "topic"
  | "synthesis";

export type PaperIngestWriteAction = "create" | "update" | "append";

export interface PaperIngestPageUpdate {
  pageKind: PaperIngestWikiPageKind;
  pageKey: string;
  title: string;
  action: PaperIngestWriteAction;
  rationale: string;
  priority: "primary" | "secondary";
  patchOutline: string[];
}

export interface PaperIngestClaimUpdate {
  claimKey: string;
  claimText: string;
  action: "create" | "update";
  effect: "supports" | "contradicts" | "qualifies" | "organizes";
  rationale: string;
  evidenceNotes: string[];
}

export interface PaperIngestTopicUpdate {
  topicKey: string;
  title: string;
  action: "create" | "update";
  rationale: string;
  topicThreads: string[];
}

export interface PaperIngestLogEntry {
  title: string;
  summary: string;
  affectedPageKeys: string[];
  notes: string[];
}

export interface PaperIngestExistingPageHint {
  pageKind: PaperIngestWikiPageKind;
  pageKey: string;
  title: string;
  summary?: string;
  sourcePaperKeys?: string[];
  relatedPageKeys?: string[];
  keyFacts?: string[];
}

export interface PaperIngestPlan {
  paperKey: string;
  paperTitle: string;
  schemaFamily: PaperDigestSchemaFamily;
  ingestObjective: string;
  summary: string;
  pageUpdates: PaperIngestPageUpdate[];
  claimUpdates: PaperIngestClaimUpdate[];
  topicUpdates: PaperIngestTopicUpdate[];
  logEntry: PaperIngestLogEntry;
}

export interface PaperIngestPlanModelOutput extends PaperIngestPlan {}

export const PAPER_INGEST_PLAN_MODEL_OUTPUT_SHAPE = {
  paperKey: "string",
  paperTitle: "string",
  schemaFamily: "computational_empirical | experimental_empirical | methodological_or_instrumentation | theoretical_or_mathematical | review_or_survey",
  ingestObjective: "string",
  summary: "string",
  pageUpdates: [
    {
      pageKind: "paper | research_question | method | benchmark | finding | formal_result | claim | topic | synthesis",
      pageKey: "string",
      title: "string",
      action: "create | update | append",
      rationale: "string",
      priority: "primary | secondary",
      patchOutline: ["string"],
    },
  ],
  claimUpdates: [
    {
      claimKey: "string",
      claimText: "string",
      action: "create | update",
      effect: "supports | contradicts | qualifies | organizes",
      rationale: "string",
      evidenceNotes: ["string"],
    },
  ],
  topicUpdates: [
    {
      topicKey: "string",
      title: "string",
      action: "create | update",
      rationale: "string",
      topicThreads: ["string"],
    },
  ],
  logEntry: {
    title: "string",
    summary: "string",
    affectedPageKeys: ["string"],
    notes: ["string"],
  },
} as const;

export function renderPaperIngestPlanPrompt(input: {
  digest: PaperDigest;
  existingPageHints?: PaperIngestExistingPageHint[];
}): string {
  const existingPageHints = renderExistingPageHints(input.existingPageHints ?? []);

  return [
    "You are planning how to ingest one research paper into a persistent literature wiki.",
    "",
    "This is not the final wiki-writing step.",
    "Your job is to decide which wiki pages should be created, updated, or appended, and why.",
    "",
    "Plan the ingest so that the wiki becomes more useful over time.",
    "Do not merely restate the paper digest.",
    "Use the digest to decide how the paper should change the compiled knowledge base.",
    "",
    "Wiki modeling guidance:",
    "- page kinds are cross-disciplinary and may include paper, research_question, method, benchmark, finding, formal_result, claim, topic, and synthesis",
    "- create or update a paper page for this source",
    "- update research questions, methods, benchmarks, findings, formal results, claims, and topics only when the digest clearly supports doing so",
    "- claim pages should capture support, contradiction, qualification, or organization of existing debates",
    "- topic pages should organize the problem area, scope, active threads, and open questions for that topic",
    "- synthesis pages should capture durable cross-page comparisons, reusable analyses, or higher-order takeaways that do not belong naturally to one topic or one claim",
    "- log.md is maintained separately as the global chronological record; do not plan separate log pages",
    "- do not invent pages that the digest does not justify",
    "",
    "Claim / topic / synthesis disambiguation:",
    "- claim: use this when the update is a proposition, judgment, or debate position that can be supported, contradicted, or qualified by papers",
    "- topic: use this when the update is about organizing an area of inquiry, its scope, recurring subthreads, and open questions",
    "- research_question: use this for an explicit question the literature is trying to answer",
    "- benchmark: use this for datasets, benchmark suites, challenge sets, or standardized evaluation resources",
    "- finding: use this for empirical, observational, or reported scientific findings grounded in evidence",
    "- formal_result: use this for theorems, lemmas, corollaries, propositions, bounds, guarantees, or conjectures",
    "- synthesis: use this only when the update creates a durable view across multiple topics, claims, methods, or evaluation frames",
    "- do not create a claim page for a generic theme label",
    "- do not create a synthesis page for a topic's normal current picture; update the topic page instead",
    "- do not create a synthesis page for a claim's support, contradiction, qualification, or evidence list; update the claim page instead",
    "- do not create a synthesis page merely because multiple papers touch the same topic",
    "- if the paper only adds one more example or detail to an existing topic, prefer updating the topic page over creating a new synthesis page",
    "- if the paper materially changes the state of an existing debate, prefer updating or creating claim pages unless the durable insight spans multiple claims or topics",
    "",
    "Existing page context guidance:",
    "- prefer reusing an existing pageKey when the paper updates, supports, qualifies, contradicts, or extends that existing page",
    "- use the existing page summary, source papers, related pages, and key facts to decide whether the new paper should create a new page or update an old one",
    "- if an existing claim is already contested or qualified, choose the effect that reflects how this paper changes that debate",
    "- if an existing topic, method, benchmark, finding, formal result, or research question already covers the same object, update that page instead of creating a near-duplicate",
    "",
    "Prioritization guidance:",
    "- every plan should include one primary paper page update",
    "- include a small number of high-value secondary updates instead of many weak ones",
    "- a single paper commonly affects around 5 to 15 pages, but prefer precision over page count",
    "",
    "Output requirements:",
    "- pageKey, claimKey, and topicKey should be stable slug-like identifiers",
    "- rationale should explain why the page should change",
    "- patchOutline should describe what should be added, revised, linked, or re-framed on that page",
    "- for synthesis pages, patchOutline should read like a compact integrated view: lead with the main takeaway, then the current state of play, then the most important comparison points or tensions",
    "- summary should explain the overall ingest impact in 2 to 4 sentences",
    "",
    "# Paper Digest",
    "",
    renderPaperDigestForIngestPrompt(input.digest),
    "",
    "# Existing Page Hints",
    "",
    existingPageHints || "No existing page hints were provided.",
    "",
    "# Output",
    "",
    "Return valid JSON only.",
    "Do not include Markdown.",
    "Do not include comments.",
    "Match this JSON shape exactly:",
    "",
    JSON.stringify(PAPER_INGEST_PLAN_MODEL_OUTPUT_SHAPE, null, 2),
  ].join("\n");
}

function renderExistingPageHints(
  hints: PaperIngestExistingPageHint[],
): string {
  if (hints.length === 0) return "No existing page hints were provided.";

  const orderedKinds: PaperIngestWikiPageKind[] = [
    "claim",
    "topic",
    "synthesis",
    "paper",
    "research_question",
    "method",
    "benchmark",
    "finding",
    "formal_result",
  ];

  const lines: string[] = [];
  for (const kind of orderedKinds) {
    const group = hints
      .filter((item) => item.pageKind === kind)
      .sort((left, right) => left.title.localeCompare(right.title));
    if (group.length === 0) continue;
    lines.push(`## ${kindLabelFromIngestPageKind(kind)}`, "");
    for (const item of group) {
      lines.push(`- [[${item.pageKey}]] (${item.title})`);
      if (item.summary) lines.push(`  - summary: ${item.summary}`);
      if (item.sourcePaperKeys && item.sourcePaperKeys.length > 0) {
        lines.push(`  - source papers: ${item.sourcePaperKeys.slice(0, 8).map((key) => `[[${key}]]`).join(", ")}`);
      }
      if (item.relatedPageKeys && item.relatedPageKeys.length > 0) {
        lines.push(`  - related pages: ${item.relatedPageKeys.slice(0, 10).map((key) => `[[${key}]]`).join(", ")}`);
      }
      for (const fact of item.keyFacts?.slice(0, 8) ?? []) {
        lines.push(`  - ${fact}`);
      }
    }
    lines.push("");
  }

  return lines.join("\n").trim();
}

interface PaperIngestPlanRequest {
  digest: PaperDigest;
  discipline?: LiteratureDiscipline;
  wikiRoot?: string;
  existingPageHints?: PaperIngestExistingPageHint[];
}

export interface PaperIngestPdfUrlInput extends PaperDigestPdfUrlInput {}

export interface PaperIngestPdfFileInput extends PaperDigestPdfFileInput {}

export type PaperIngestInput = PaperIngestPdfUrlInput | PaperIngestPdfFileInput;

export interface PaperIngestRequest {
  paper: PaperIngestInput;
  wikiRoot: string;
  discipline?: LiteratureDiscipline;
  existingPageHints?: PaperIngestExistingPageHint[];
}

export interface PaperIngestPlannerModelStepOptions {
  stepId?: string;
  system?: string;
  prompt: string;
  includeRenderedContext?: boolean;
  stream?: boolean;
  attachments?: Array<{ kind: "pdf_url" | "pdf_file"; url?: string; path?: string; filename?: string; mediaType?: "application/pdf" }>;
  stageUserInputPolicy?: string | string[] | false;
}

export type PaperIngestPlannerModelStepRunner = (
  options: PaperIngestPlannerModelStepOptions,
) => Promise<string>;

export interface PaperIngestMaterializationResult {
  pages: LiteratureWikiPage[];
  skippedUpdates: Array<{ pageKind: string; pageKey: string; title: string; reason: string }>;
}

export interface PaperIngestWriteStatus {
  status: "written" | "reused_existing";
  writtenFiles: string[];
  skippedUpdates: Array<{ pageKind: string; pageKey: string; title: string; reason: string }>;
  indexPath?: string;
  logPath?: string;
  hotPath?: string;
  disciplineHotPaths?: string[];
}

interface PaperIngestManifestRecord {
  canonicalPaperKey: string;
  pageFiles: string[];
  updatedAt: string;
}

interface PersistedPaperIngestManifestFile {
  schemaVersion: 1;
  updatedAt: string;
  records: PaperIngestManifestRecord[];
}

export interface PaperIngestWriteResult {
  lookup: LiteratureWikiPage[];
  write: PaperIngestWriteStatus;
}

export interface PreparedPaperIngest extends PaperIngestMaterializationResult {
  digest: PaperDigest;
  plan: PaperIngestPlan;
  usedExplicitPageHints: boolean;
}

export interface BatchCrossReferenceResult {
  pages: LiteratureWikiPage[];
  notes: string[];
}

export interface PaperIngestBatchResult {
  digests: PaperDigest[];
  completed: PreparedPaperIngest[];
  failures: Array<{
    paper: PaperIngestInput;
    digest?: PaperDigest;
    error: string;
    digestFailure?: Extract<PaperDigestResult, { status: "failed" }>;
  }>;
  lookupIndex: LiteratureWikiLookupIndex;
  crossReference: BatchCrossReferenceResult;
  write: PaperIngestWriteStatus;
}

export interface PaperIngestBatchPaperSummary {
  canonicalPaperKey: string;
  title: string;
  status: "ingested" | "reused_existing";
  summary: string;
  affectedPageKeys: string[];
}

export interface PaperIngestBatchFailureSummary {
  sourceId: string;
  sourceKind: PaperIngestInput["kind"];
  canonicalPaperKey?: string;
  title?: string;
  error: string;
}

export interface PaperIngestBatchSummaryCitation {
  pageKey: string;
  title: string;
  pageKind: LiteratureWikiPage["kind"];
  rationale: string;
}

export interface PaperIngestBatchSummaryResult {
  summary: string;
  summaryTitle: string;
  summaryMarkdown: string;
  citations: PaperIngestBatchSummaryCitation[];
  synthesis: {
    integratedTakeaway: string;
    stateOfPlay: string[];
    tensions: string[];
    openQuestions: string[];
  };
  totalPapers: number;
  ingestedPapers: number;
  reusedExistingPapers: number;
  failedPapers: number;
  papers: PaperIngestBatchPaperSummary[];
  failures: PaperIngestBatchFailureSummary[];
  write: {
    status: PaperIngestWriteStatus["status"];
    indexPath?: string;
    logPath?: string;
    hotPath?: string;
  };
}

export const PAPER_INGEST_BATCH_SUMMARY_MODEL_OUTPUT_SHAPE = {
  summaryTitle: "string",
  summary: "string",
  summaryMarkdown: "string",
  citations: [
    {
      pageKey: "string",
      title: "string",
      pageKind: "paper | research_question | method | benchmark | finding | formal_result | claim | topic | synthesis",
      rationale: "string",
    },
  ],
  synthesis: {
    integratedTakeaway: "string",
    stateOfPlay: ["string"],
    tensions: ["string"],
    openQuestions: ["string"],
  },
} as const;

export class PaperIngest {
  constructor(
    private readonly modelStep: PaperIngestPlannerModelStepRunner,
    private readonly paperDigests: PaperDigests,
    private readonly wikiRetrieve?: WikiRetrieve,
    private readonly digestCapabilities: PaperDigestCapabilities = {
      pdfUrlReadSupport: "unsupported",
      pdfFileReadSupport: "unsupported",
    },
  ) {}

  private async plan(input: PaperIngestPlanRequest): Promise<PaperIngestPlan> {
    const existingPageHints = input.existingPageHints ?? await this.retrieveExistingPageHints(input);
    const raw = await this.modelStep({
      stepId: `paper_ingest_plan_${safeStepId(input.digest.canonicalPaperKey)}`,
      system: "You produce structured paper-ingest plans for a literature wiki as valid JSON.",
      prompt: renderPaperIngestPlanPrompt({
        ...input,
        existingPageHints,
      }),
      includeRenderedContext: false,
      stageUserInputPolicy: false,
      stream: false,
    });
      return parseOrRepairPaperIngestPlan(raw, (options) => this.modelStep({
        ...options,
        stageUserInputPolicy: false,
      }));
  }

  private async digestPaper(input: PaperIngestRequest): Promise<PaperDigestResult> {
    const digestInput = paperDigestInputFromIngestInput(input.paper);
    const cached = this.paperDigests.lookupPaperDigest(digestInput);
    if (cached) {
      return {
        status: "completed",
        digest: cached,
      };
    }

    const service = new PaperDigests(
      (options) => this.modelStep(options),
      undefined,
      this.digestCapabilities,
    );
    const result = await service.digest(digestInput);
    if (result.status === "completed") {
      this.paperDigests.recordPaperDigest(digestInput, result.digest);
      this.paperDigests.resolvePaperDigestFailureByCanonicalKey(result.digest.canonicalPaperKey, result.digest.sourceKind);
      this.paperDigests.resolvePaperDigestFailure(result.digest.sourceId, result.digest.sourceKind);
    } else {
      this.paperDigests.recordPaperDigestFailure(result);
    }
    return result;
  }

  private async retrieveExistingPageHints(
    input: PaperIngestPlanRequest,
  ): Promise<PaperIngestExistingPageHint[]> {
    if (!this.wikiRetrieve || !input.wikiRoot) return [];

    const discipline = input.discipline ?? input.digest.discipline;
    const scope = discipline ? [discipline] : [];
    if (scope.length === 0) return [];

    const query = buildPaperIngestRetrieveQuery(input.digest);
    const mode = decidePaperIngestRetrieveMode(input.digest);
    const retrieved = await this.wikiRetrieve.retrieve({
      wikiRoot: input.wikiRoot,
      query,
      disciplineScope: scope,
      mode,
      limit: 8,
      expandLinks: true,
    });

    const hints: PaperIngestExistingPageHint[] = [];
    const seen = new Set<string>();
    for (const page of [...retrieved.primaryPages, ...retrieved.expandedPages]) {
      if (!isPaperIngestWikiPageKind(page.kind)) continue;
      const key = `${page.kind}:${page.pageKey}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const existing = await readExistingPage(join(input.wikiRoot, page.path));
      hints.push(existing && isPaperIngestWikiPage(existing)
        ? buildExistingPageHint(existing)
        : {
          pageKind: page.kind,
          pageKey: page.pageKey,
          title: page.title,
        });
      if (hints.length >= 12) break;
    }
    return hints;
  }

  materialize(input: { digest: PaperDigest; plan: PaperIngestPlan; discipline?: LiteratureDiscipline }): PaperIngestMaterializationResult {
    const { digest, plan } = input;
    const discipline = input.discipline ?? digest.discipline ?? "general_science";
    const pages: LiteratureWikiPage[] = [];
    const skippedUpdates: PaperIngestMaterializationResult["skippedUpdates"] = [];
    const now = new Date().toISOString();

    pages.push(buildPaperPage(digest, plan, now, discipline));
    for (const claim of plan.claimUpdates) pages.push(buildClaimPage(digest, plan, claim, now, discipline));
    for (const update of plan.pageUpdates) {
      const page = buildResearchPage(digest, plan, update, now, discipline);
      if (page) pages.push(page);
    }
    for (const topic of plan.topicUpdates) pages.push(buildTopicPage(digest, plan, topic, now, discipline));
    for (const synthesis of buildSynthesisPages(digest, plan, now, discipline)) pages.push(synthesis);

    for (const update of plan.pageUpdates) {
      if (
        update.pageKind === "paper"
        || update.pageKind === "research_question"
        || update.pageKind === "method"
        || update.pageKind === "benchmark"
        || update.pageKind === "finding"
        || update.pageKind === "formal_result"
        || update.pageKind === "claim"
        || update.pageKind === "topic"
        || update.pageKind === "synthesis"
      ) {
        continue;
      }
      skippedUpdates.push({
        pageKind: update.pageKind,
        pageKey: update.pageKey,
        title: update.title,
        reason: "No file-page schema is implemented yet for this page kind.",
      });
    }

    return { pages: dedupePagesByKey(pages), skippedUpdates };
  }

  private async prepareDigest(input: PaperIngestRequest, digest: PaperDigest): Promise<PreparedPaperIngest> {
    const plan = await this.plan({
      digest,
      discipline: input.discipline,
      wikiRoot: input.wikiRoot,
      existingPageHints: input.existingPageHints,
    });
    return {
      digest,
      plan,
      usedExplicitPageHints: Boolean(input.existingPageHints && input.existingPageHints.length > 0),
      ...this.materialize({ digest, plan, discipline: input.discipline }),
    };
  }

  async prepare(input: PaperIngestRequest): Promise<PreparedPaperIngest> {
    const digestResult = await this.digestPaper(input);
    if (digestResult.status === "failed") {
      const error = new Error(digestResult.detail);
      Object.assign(error, { digestFailure: digestResult });
      throw error;
    }
    return this.prepareDigest(input, digestResult.digest);
  }

  async crossReferenceBatch(prepared: PreparedPaperIngest[], wikiRoot: string): Promise<BatchCrossReferenceResult> {
    const now = new Date().toISOString();
    const pages: LiteratureWikiPage[] = [];
    const notes: string[] = [];
    const retrievedHistoricalPages = await this.retrieveCrossReferencePages(prepared, wikiRoot);
    const historicalResearchQuestionsByKey = new Map<string, LiteratureWikiResearchQuestionPage[]>();
    const historicalMethodsByKey = new Map<string, LiteratureWikiMethodPage[]>();
    const historicalBenchmarksByKey = new Map<string, LiteratureWikiBenchmarkPage[]>();
    const historicalFindingsByKey = new Map<string, LiteratureWikiFindingPage[]>();
    const historicalFormalResultsByKey = new Map<string, LiteratureWikiFormalResultPage[]>();
    const historicalTopicsByKey = new Map<string, LiteratureWikiTopicPage[]>();
    const historicalClaimsByKey = new Map<string, LiteratureWikiClaimPage[]>();
    for (const page of retrievedHistoricalPages) {
      if (page.kind === "research_question") {
        const key = pageIdentity(page);
        historicalResearchQuestionsByKey.set(key, [...(historicalResearchQuestionsByKey.get(key) ?? []), page]);
      } else if (page.kind === "method") {
        const key = pageIdentity(page);
        historicalMethodsByKey.set(key, [...(historicalMethodsByKey.get(key) ?? []), page]);
      } else if (page.kind === "benchmark") {
        const key = pageIdentity(page);
        historicalBenchmarksByKey.set(key, [...(historicalBenchmarksByKey.get(key) ?? []), page]);
      } else if (page.kind === "finding") {
        const key = pageIdentity(page);
        historicalFindingsByKey.set(key, [...(historicalFindingsByKey.get(key) ?? []), page]);
      } else if (page.kind === "formal_result") {
        const key = pageIdentity(page);
        historicalFormalResultsByKey.set(key, [...(historicalFormalResultsByKey.get(key) ?? []), page]);
      } else if (page.kind === "topic") {
        const key = pageIdentity(page);
        historicalTopicsByKey.set(key, [...(historicalTopicsByKey.get(key) ?? []), page]);
      } else if (page.kind === "claim") {
        const key = pageIdentity(page);
        historicalClaimsByKey.set(key, [...(historicalClaimsByKey.get(key) ?? []), page]);
      }
    }

    const researchQuestionGroups = new Map<string, LiteratureWikiResearchQuestionPage[]>();
    const methodGroups = new Map<string, LiteratureWikiMethodPage[]>();
    const benchmarkGroups = new Map<string, LiteratureWikiBenchmarkPage[]>();
    const findingGroups = new Map<string, LiteratureWikiFindingPage[]>();
    const formalResultGroups = new Map<string, LiteratureWikiFormalResultPage[]>();
    const topicGroups = new Map<string, LiteratureWikiTopicPage[]>();
    const claimGroups = new Map<string, LiteratureWikiClaimPage[]>();
    for (const page of prepared.flatMap((item) => item.pages)) {
      if (page.kind === "research_question") {
        const key = pageIdentity(page);
        researchQuestionGroups.set(key, [...(researchQuestionGroups.get(key) ?? []), page]);
      } else if (page.kind === "method") {
        const key = pageIdentity(page);
        methodGroups.set(key, [...(methodGroups.get(key) ?? []), page]);
      } else if (page.kind === "benchmark") {
        const key = pageIdentity(page);
        benchmarkGroups.set(key, [...(benchmarkGroups.get(key) ?? []), page]);
      } else if (page.kind === "finding") {
        const key = pageIdentity(page);
        findingGroups.set(key, [...(findingGroups.get(key) ?? []), page]);
      } else if (page.kind === "formal_result") {
        const key = pageIdentity(page);
        formalResultGroups.set(key, [...(formalResultGroups.get(key) ?? []), page]);
      } else if (page.kind === "topic") {
        const key = pageIdentity(page);
        topicGroups.set(key, [...(topicGroups.get(key) ?? []), page]);
      } else if (page.kind === "claim") {
        const key = pageIdentity(page);
        claimGroups.set(key, [...(claimGroups.get(key) ?? []), page]);
      }
    }

    for (const [researchQuestionGroupKey, researchQuestionPages] of researchQuestionGroups) {
      const historicalPages = historicalResearchQuestionsByKey.get(researchQuestionGroupKey) ?? [];
      const allPages = [...researchQuestionPages, ...historicalPages];
      const batchSourcePaperKeys = dedupe(researchQuestionPages.flatMap((page) => page.sourcePaperKeys));
      const sourcePaperKeys = dedupe(allPages.flatMap((page) => page.sourcePaperKeys));
      if (batchSourcePaperKeys.length < 2 && historicalPages.length === 0) continue;
      const representative = researchQuestionPages[0]!;
      const linkedSourcePapers = sourcePaperKeys.map((key) => `[[${key}]]`).join(", ");
      const linkedBatchPapers = batchSourcePaperKeys.map((key) => `[[${key}]]`).join(", ");
      const merged = allPages.slice(1).reduce(
        (acc, page) => mergeLiteratureWikiPages(acc, page) as LiteratureWikiResearchQuestionPage,
        representative,
      );
      pages.push({
        ...merged,
        updatedAt: now,
        summary: `Cross-referenced research question view spanning ${sourcePaperKeys.length} papers.`,
        sourcePaperKeys,
        domainScope: dedupe(allPages.flatMap((page) => page.domainScope)),
        openSubquestions: dedupe([
          ...merged.openSubquestions,
          `Batch cross-reference: ${linkedBatchPapers} now inform this research question.`,
        ]),
        relatedPageKeys: dedupe([...merged.relatedPageKeys, ...sourcePaperKeys]),
      });
      notes.push(`Cross-referenced research question [[${representative.pageKey}]] across ${linkedSourcePapers}${historicalPages.length > 0 ? " with retrieved historical context" : ""}.`);
    }

    for (const [methodGroupKey, methodPages] of methodGroups) {
      const historicalPages = historicalMethodsByKey.get(methodGroupKey) ?? [];
      const allPages = [...methodPages, ...historicalPages];
      const batchSourcePaperKeys = dedupe(methodPages.flatMap((page) => page.sourcePaperKeys));
      const sourcePaperKeys = dedupe(allPages.flatMap((page) => page.sourcePaperKeys));
      if (batchSourcePaperKeys.length < 2 && historicalPages.length === 0) continue;
      const representative = methodPages[0]!;
      const linkedSourcePapers = sourcePaperKeys.map((key) => `[[${key}]]`).join(", ");
      const linkedBatchPapers = batchSourcePaperKeys.map((key) => `[[${key}]]`).join(", ");
      const merged = allPages.slice(1).reduce(
        (acc, page) => mergeLiteratureWikiPages(acc, page) as LiteratureWikiMethodPage,
        representative,
      );
      pages.push({
        ...merged,
        updatedAt: now,
        summary: `Cross-referenced method view spanning ${sourcePaperKeys.length} papers.`,
        sourcePaperKeys,
        domainScope: dedupe(allPages.flatMap((page) => page.domainScope)),
        failureModes: dedupe([
          ...merged.failureModes,
          `Batch cross-reference: ${linkedBatchPapers} now provide method evidence or variants.`,
        ]),
        relatedPageKeys: dedupe([...merged.relatedPageKeys, ...sourcePaperKeys]),
      });
      notes.push(`Cross-referenced method [[${representative.pageKey}]] across ${linkedSourcePapers}${historicalPages.length > 0 ? " with retrieved historical context" : ""}.`);
    }

    for (const [benchmarkGroupKey, benchmarkPages] of benchmarkGroups) {
      const historicalPages = historicalBenchmarksByKey.get(benchmarkGroupKey) ?? [];
      const allPages = [...benchmarkPages, ...historicalPages];
      const batchSourcePaperKeys = dedupe(benchmarkPages.flatMap((page) => page.sourcePaperKeys));
      const sourcePaperKeys = dedupe(allPages.flatMap((page) => page.sourcePaperKeys));
      if (batchSourcePaperKeys.length < 2 && historicalPages.length === 0) continue;
      const representative = benchmarkPages[0]!;
      const linkedSourcePapers = sourcePaperKeys.map((key) => `[[${key}]]`).join(", ");
      const linkedBatchPapers = batchSourcePaperKeys.map((key) => `[[${key}]]`).join(", ");
      const merged = allPages.slice(1).reduce(
        (acc, page) => mergeLiteratureWikiPages(acc, page) as LiteratureWikiBenchmarkPage,
        representative,
      );
      pages.push({
        ...merged,
        updatedAt: now,
        summary: `Cross-referenced benchmark view spanning ${sourcePaperKeys.length} papers.`,
        sourcePaperKeys,
        domainScope: dedupe(allPages.flatMap((page) => page.domainScope)),
        knownCaveats: dedupe([
          ...merged.knownCaveats,
          `Batch cross-reference: ${linkedBatchPapers} now use or contextualize this benchmark.`,
        ]),
        usedByPaperKeys: dedupe([...merged.usedByPaperKeys, ...sourcePaperKeys]),
        relatedPageKeys: dedupe([...merged.relatedPageKeys, ...sourcePaperKeys]),
      });
      notes.push(`Cross-referenced benchmark [[${representative.pageKey}]] across ${linkedSourcePapers}${historicalPages.length > 0 ? " with retrieved historical context" : ""}.`);
    }

    for (const [findingGroupKey, findingPages] of findingGroups) {
      const historicalPages = historicalFindingsByKey.get(findingGroupKey) ?? [];
      const allPages = [...findingPages, ...historicalPages];
      const batchSourcePaperKeys = dedupe(findingPages.flatMap((page) => page.sourcePaperKeys));
      const sourcePaperKeys = dedupe(allPages.flatMap((page) => page.sourcePaperKeys));
      if (batchSourcePaperKeys.length < 2 && historicalPages.length === 0) continue;
      const representative = findingPages[0]!;
      const linkedSourcePapers = sourcePaperKeys.map((key) => `[[${key}]]`).join(", ");
      const linkedBatchPapers = batchSourcePaperKeys.map((key) => `[[${key}]]`).join(", ");
      const merged = allPages.slice(1).reduce(
        (acc, page) => mergeLiteratureWikiPages(acc, page) as LiteratureWikiFindingPage,
        representative,
      );
      pages.push({
        ...merged,
        updatedAt: now,
        summary: `Cross-referenced finding view spanning ${sourcePaperKeys.length} papers.`,
        sourcePaperKeys,
        domainScope: dedupe(allPages.flatMap((page) => page.domainScope)),
        supportingPaperKeys: dedupe([...merged.supportingPaperKeys, ...sourcePaperKeys]),
        caveats: dedupe([
          ...merged.caveats,
          `Batch cross-reference: ${linkedBatchPapers} now support, qualify, or contextualize this finding.`,
        ]),
        relatedPageKeys: dedupe([...merged.relatedPageKeys, ...sourcePaperKeys]),
      });
      notes.push(`Cross-referenced finding [[${representative.pageKey}]] across ${linkedSourcePapers}${historicalPages.length > 0 ? " with retrieved historical context" : ""}.`);
    }

    for (const [formalResultGroupKey, formalResultPages] of formalResultGroups) {
      const historicalPages = historicalFormalResultsByKey.get(formalResultGroupKey) ?? [];
      const allPages = [...formalResultPages, ...historicalPages];
      const batchSourcePaperKeys = dedupe(formalResultPages.flatMap((page) => page.sourcePaperKeys));
      const sourcePaperKeys = dedupe(allPages.flatMap((page) => page.sourcePaperKeys));
      if (batchSourcePaperKeys.length < 2 && historicalPages.length === 0) continue;
      const representative = formalResultPages[0]!;
      const linkedSourcePapers = sourcePaperKeys.map((key) => `[[${key}]]`).join(", ");
      const linkedBatchPapers = batchSourcePaperKeys.map((key) => `[[${key}]]`).join(", ");
      const merged = allPages.slice(1).reduce(
        (acc, page) => mergeLiteratureWikiPages(acc, page) as LiteratureWikiFormalResultPage,
        representative,
      );
      pages.push({
        ...merged,
        updatedAt: now,
        summary: `Cross-referenced formal result view spanning ${sourcePaperKeys.length} papers.`,
        sourcePaperKeys,
        domainScope: dedupe(allPages.flatMap((page) => page.domainScope)),
        limitations: dedupe([
          ...merged.limitations,
          `Batch cross-reference: ${linkedBatchPapers} now connect to this formal result.`,
        ]),
        relatedPageKeys: dedupe([...merged.relatedPageKeys, ...sourcePaperKeys]),
      });
      notes.push(`Cross-referenced formal result [[${representative.pageKey}]] across ${linkedSourcePapers}${historicalPages.length > 0 ? " with retrieved historical context" : ""}.`);
    }

    for (const [topicGroupKey, topicPages] of topicGroups) {
      const historicalTopicPages = historicalTopicsByKey.get(topicGroupKey) ?? [];
      const allTopicPages = [...topicPages, ...historicalTopicPages];
      const batchSourcePaperKeys = dedupe(topicPages.flatMap((page) => page.sourcePaperKeys));
      const sourcePaperKeys = dedupe(allTopicPages.flatMap((page) => page.sourcePaperKeys));
      if (batchSourcePaperKeys.length < 2 && historicalTopicPages.length === 0) continue;
      const representative = topicPages[0]!;
      const topicKey = representative.pageKey;
      const combinedThreads = dedupe(allTopicPages.flatMap((page) => page.currentThreads));
      const combinedClaimPageKeys = dedupe(allTopicPages.flatMap((page) => page.claimPageKeys));
      const linkedSourcePapers = sourcePaperKeys.map((key) => `[[${key}]]`).join(", ");
      const linkedBatchPapers = batchSourcePaperKeys.map((key) => `[[${key}]]`).join(", ");
      const mergedTopic: LiteratureWikiTopicPage = {
        ...representative,
        discipline: mergeDisciplines(allTopicPages.map((page) => page.discipline)),
        updatedAt: now,
        summary: `Cross-referenced topic view spanning ${sourcePaperKeys.length} papers.`,
        sourcePaperKeys,
        domainScope: dedupe(allTopicPages.flatMap((page) => page.domainScope)),
        scopeNotes: dedupe(allTopicPages.flatMap((page) => page.scopeNotes)),
        currentThreads: dedupe([
          ...combinedThreads,
          `Batch cross-reference: ${linkedBatchPapers} now contribute to this topic thread.`,
        ]),
        keyPageKeys: dedupe(allTopicPages.flatMap((page) => page.keyPageKeys)),
        claimPageKeys: combinedClaimPageKeys,
        openTensions: dedupe([
          ...allTopicPages.flatMap((page) => page.openTensions),
          sourcePaperKeys.length >= 2
            ? `This topic is now informed by ${linkedSourcePapers}, so disagreements and boundary conditions should remain visible.`
            : "",
        ]),
        openQuestions: dedupe(allTopicPages.flatMap((page) => page.openQuestions)),
      };
      pages.push(mergedTopic);
      notes.push(`Cross-referenced topic [[${topicKey}]] across ${linkedSourcePapers}${historicalTopicPages.length > 0 ? " with retrieved historical context" : ""}; batch-level synthesis is returned by ingestBatchSummary instead of being written as a synthesis page.`);
    }

    for (const [claimGroupKey, claimPages] of claimGroups) {
      const historicalClaimPages = historicalClaimsByKey.get(claimGroupKey) ?? [];
      const allClaimPages = [...claimPages, ...historicalClaimPages];
      const batchSourcePaperKeys = dedupe(claimPages.flatMap((page) => page.sourcePaperKeys));
      const sourcePaperKeys = dedupe(allClaimPages.flatMap((page) => page.sourcePaperKeys));
      if (batchSourcePaperKeys.length < 2 && historicalClaimPages.length === 0) continue;
      const supportPaperKeys = dedupe(allClaimPages.flatMap((page) => page.supportPaperKeys));
      const contradictPaperKeys = dedupe(allClaimPages.flatMap((page) => page.contradictPaperKeys));
      const qualifyPaperKeys = dedupe(allClaimPages.flatMap((page) => page.qualifyPaperKeys));
      const topicPageKeys = dedupe(allClaimPages.flatMap((page) => page.topicPageKeys));
      const linkedSourcePapers = sourcePaperKeys.map((key) => `[[${key}]]`).join(", ");
      const linkedBatchPapers = batchSourcePaperKeys.map((key) => `[[${key}]]`).join(", ");
      const notesForClaim = dedupe([
        ...allClaimPages.flatMap((page) => page.notes),
        `Batch cross-reference consolidated evidence from ${linkedBatchPapers}.`,
      ]);
      const contradictions = dedupe(allClaimPages.flatMap((page) => page.contradictions));
      const tensions = dedupe([
        ...allClaimPages.flatMap((page) => page.tensions),
        ...buildClaimTensionsFromEvidence(supportPaperKeys, contradictPaperKeys, qualifyPaperKeys, topicPageKeys),
      ]);
      const representative = claimPages[0]!;
      const claimKey = representative.pageKey;
      pages.push({
        ...representative,
        discipline: mergeDisciplines(allClaimPages.map((page) => page.discipline)),
        updatedAt: now,
        sourcePaperKeys,
        summary: `Cross-referenced claim view spanning ${sourcePaperKeys.length} papers.`,
        domainScope: dedupe(allClaimPages.flatMap((page) => page.domainScope)),
        supportPaperKeys,
        contradictPaperKeys,
        qualifyPaperKeys,
        topicPageKeys,
        contradictions,
        tensions,
        notes: notesForClaim,
        claimStatus: deriveBatchClaimStatus(representative.claimStatus, supportPaperKeys, contradictPaperKeys, qualifyPaperKeys, notesForClaim),
      });
      notes.push(`Cross-referenced claim [[${claimKey}]] across ${linkedSourcePapers}${historicalClaimPages.length > 0 ? " with retrieved historical context" : ""} and re-evaluated its debate status conservatively.`);
    }

    return { pages: dedupePagesByKey(pages), notes };
  }

  private async retrieveCrossReferencePages(
    prepared: PreparedPaperIngest[],
    wikiRoot: string,
  ): Promise<LiteratureWikiPage[]> {
    if (!this.wikiRetrieve) return [];

    const loaded: LiteratureWikiPage[] = [];
    const seen = new Set<string>();
    for (const item of prepared) {
      const query = dedupe([
        item.plan.paperTitle,
        item.plan.summary,
        ...item.plan.pageUpdates.map((page) => page.title),
        ...item.plan.pageUpdates.map((page) => page.rationale),
        ...item.plan.topicUpdates.map((topic) => topic.title),
        ...item.plan.claimUpdates.map((claim) => claim.claimText),
      ]).join(" | ");
      if (!query.trim()) continue;

      const mode: WikiRetrieveMode =
        item.plan.claimUpdates.length > 0 ? "claim_first" :
          item.plan.topicUpdates.length > 0 ? "topic_first" :
            "landscape";

      const retrieved = await this.wikiRetrieve.retrieve({
        wikiRoot,
        query,
        disciplineScope: [item.digest.discipline],
        mode,
        limit: 8,
        expandLinks: true,
      });

      for (const page of [...retrieved.primaryPages, ...retrieved.expandedPages]) {
        const key = pageIdentity(page);
        if (seen.has(key)) continue;
        const existing = await readExistingPage(join(wikiRoot, page.path));
        if (!existing) continue;
        if (
          existing.kind !== "research_question"
          && existing.kind !== "method"
          && existing.kind !== "benchmark"
          && existing.kind !== "finding"
          && existing.kind !== "formal_result"
          && existing.kind !== "topic"
          && existing.kind !== "claim"
          && existing.kind !== "synthesis"
        ) {
          continue;
        }
        loaded.push(existing);
        seen.add(key);
      }
    }
    return loaded;
  }

  async commitBatch(
    wikiRoot: string,
    prepared: PreparedPaperIngest[],
    crossReference: BatchCrossReferenceResult = { pages: [], notes: [] },
  ): Promise<PaperIngestBatchResult> {
    const writtenFiles: string[] = [];
    const combinedPages = dedupePagesByKey([
      ...prepared.flatMap((item) => item.pages),
      ...crossReference.pages,
    ]);
    const combinedSkipped = prepared.flatMap((item) => item.skippedUpdates);
    const changedPageKeys = new Set(combinedPages.map((page) => pageIdentity(page)));
    const existingPages = await loadExistingWikiPages(wikiRoot);
    const mergedByKey = new Map<string, LiteratureWikiPage>();

    for (const page of existingPages) {
      mergedByKey.set(pageIdentity(page), page);
    }
    for (const page of combinedPages) {
      const key = pageIdentity(page);
      const current = mergedByKey.get(key);
      mergedByKey.set(key, current ? mergeLiteratureWikiPages(current, page) : page);
    }

    const mergedPages = [...mergedByKey.values()];
    const pagesToWrite = mergedPages.filter((page) => changedPageKeys.has(pageIdentity(page)));
    for (const page of pagesToWrite) {
      const path = literatureWikiPagePath(wikiRoot, page.discipline, page.kind, page.pageKey);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, renderLiteratureWikiPageMarkdown(page), "utf-8");
      writtenFiles.push(path);
    }

    const finalPages = mergedPages;
    const indexPath = join(wikiRoot, "index.md");
    await mkdir(dirname(indexPath), { recursive: true });
    await writeFile(indexPath, renderLiteratureWikiIndex(finalPages), "utf-8");
    writtenFiles.push(indexPath);

    const subIndexFiles = await writeLiteratureWikiSubIndexes(wikiRoot, finalPages, pagesToWrite);
    writtenFiles.push(...subIndexFiles);

    const logPath = join(wikiRoot, "log.md");
    await mkdir(dirname(logPath), { recursive: true });
    await appendFile(logPath, renderLiteratureWikiBatchLogEntry(prepared, crossReference));
    writtenFiles.push(logPath);

    const hotPath = join(wikiRoot, "hot.md");
    await mkdir(dirname(hotPath), { recursive: true });
    await writeFile(hotPath, renderLiteratureWikiBatchHotCache(prepared, finalPages, crossReference), "utf-8");
    writtenFiles.push(hotPath);

    const disciplineHotPaths = await writeDisciplineHotCaches(wikiRoot, prepared, finalPages, crossReference);
    writtenFiles.push(...disciplineHotPaths);

    const lookupIndex = prepared.reduce<LiteratureWikiLookupIndex>((acc, item) => {
      const lookup = buildLiteratureWikiLookupResult(item.digest.canonicalPaperKey, mergedPages);
      acc[item.digest.canonicalPaperKey] = lookup;
      return acc;
    }, {});
    await persistPaperIngestManifest(wikiRoot, lookupIndex);
    return {
      digests: prepared.map((item) => item.digest),
      completed: prepared,
      failures: [],
      lookupIndex,
      crossReference,
      write: {
        status: "written",
        writtenFiles,
        skippedUpdates: combinedSkipped,
        indexPath,
        logPath,
        hotPath,
        disciplineHotPaths,
      },
    };
  }

  private async writePrepared(wikiRoot: string, prepared: PreparedPaperIngest): Promise<PaperIngestWriteResult> {
    const crossReference = await this.crossReferenceBatch([prepared], wikiRoot);
    const committed = await this.commitBatch(wikiRoot, [prepared], crossReference);
    return {
      lookup: committed.lookupIndex[prepared.digest.canonicalPaperKey]
        ? committed.lookupIndex[prepared.digest.canonicalPaperKey]
        : buildLiteratureWikiLookupResult(prepared.digest.canonicalPaperKey, prepared.pages),
      write: committed.write,
    };
  }

  async ingest(input: PaperIngestRequest): Promise<PaperIngestWriteResult & { plan: PaperIngestPlan }> {
    const digestResult = await this.digestPaper(input);
    if (digestResult.status === "failed") {
      throw new Error(digestResult.detail);
    }
    const digest = digestResult.digest;
    const manifest = await readPaperIngestManifest(input.wikiRoot);
    const existingRecord = manifest[digest.canonicalPaperKey];
    if (existingRecord) {
      const existingLookup = await loadPagesFromIngestManifestRecord(input.wikiRoot, existingRecord);
      if (existingLookup.length > 0) {
        return {
          plan: buildNoopPaperIngestPlan(digest),
          lookup: existingLookup,
          write: {
            status: "reused_existing",
            writtenFiles: [],
            skippedUpdates: [],
          },
        };
      }
    }
    const plan = await this.plan({
      digest,
      discipline: input.discipline,
      wikiRoot: input.wikiRoot,
      existingPageHints: input.existingPageHints,
    });
    const prepared: PreparedPaperIngest = {
      digest,
      plan,
      usedExplicitPageHints: Boolean(input.existingPageHints && input.existingPageHints.length > 0),
      ...this.materialize({ digest, plan, discipline: input.discipline }),
    };
    const written = await this.writePrepared(input.wikiRoot, prepared);
    return {
      ...written,
      plan,
    };
  }

  async ingestBatchSummary(inputs: PaperIngestRequest[]): Promise<PaperIngestBatchSummaryResult> {
    const detailed = await this.ingestBatchDetailed(inputs);
    return this.summarizeIngestBatchPages(detailed);
  }

  async ingestBatch(inputs: PaperIngestRequest[]): Promise<PaperIngestBatchResult> {
    return this.ingestBatchDetailed(inputs);
  }

  async ingestBatchDetailed(inputs: PaperIngestRequest[]): Promise<PaperIngestBatchResult> {
    if (inputs.length === 0) {
      return { digests: [], completed: [], failures: [], lookupIndex: {}, crossReference: { pages: [], notes: [] }, write: { status: "reused_existing", writtenFiles: [], skippedUpdates: [] } };
    }
    const wikiRoot = inputs[0]!.wikiRoot;
    for (const input of inputs) {
      if (input.wikiRoot !== wikiRoot) {
        throw new Error("PaperIngest.ingestBatchDetailed requires all inputs to use the same wikiRoot.");
      }
    }
    const existingManifest = await readPaperIngestManifest(wikiRoot);
    const lookupIndex: LiteratureWikiLookupIndex = {};
    const digests: PaperDigest[] = [];
    const completed: PreparedPaperIngest[] = [];
    const failures: PaperIngestBatchResult["failures"] = [];
    const pendingInputs: Array<{ input: PaperIngestRequest; digest: PaperDigest }> = [];
    for (const input of inputs) {
      const digestResult = await this.digestPaper(input);
      if (digestResult.status === "failed") {
        failures.push({
          paper: input.paper,
          error: digestResult.detail,
          digestFailure: digestResult,
        });
        continue;
      }
      const digest = digestResult.digest;
      digests.push(digest);
      const existingRecord = existingManifest[digest.canonicalPaperKey];
      if (!existingRecord) {
        pendingInputs.push({ input, digest });
        continue;
      }
      const existingLookup = await loadPagesFromIngestManifestRecord(input.wikiRoot, existingRecord);
      if (existingLookup.length > 0) {
        lookupIndex[digest.canonicalPaperKey] = existingLookup;
        continue;
      }
      pendingInputs.push({ input, digest });
    }
    const results = await Promise.allSettled(pendingInputs.map(({ input, digest }) => this.prepareDigest(input, digest)));
    for (let index = 0; index < results.length; index += 1) {
      const result = results[index];
      const pending = pendingInputs[index];
      if (!pending) continue;
      if (result?.status === "fulfilled") {
        completed.push(result.value);
      } else {
        failures.push({
          paper: pending.input.paper,
          digest: pending.digest,
          error: result?.reason instanceof Error ? result.reason.message : String(result?.reason ?? "Unknown batch ingest failure"),
        });
      }
    }
    if (completed.length === 0) {
      return { digests, completed, failures, lookupIndex, crossReference: { pages: [], notes: [] }, write: { status: "reused_existing", writtenFiles: [], skippedUpdates: [] } };
    }
    const crossReference = await this.crossReferenceBatch(completed, wikiRoot);
    const committed = await this.commitBatch(wikiRoot, completed, crossReference);
    return {
      ...committed,
      digests,
      failures,
      lookupIndex: {
        ...lookupIndex,
        ...committed.lookupIndex,
      },
    };
  }

  private async summarizeIngestBatchPages(result: PaperIngestBatchResult): Promise<PaperIngestBatchSummaryResult> {
    const pages = collectPaperIngestBatchSummaryPages(result);
    const raw = await this.modelStep({
      stepId: "paper_ingest_batch_summary",
      system: "You synthesize literature wiki pages after a paper-ingest batch as valid JSON.",
      prompt: renderPaperIngestBatchSummaryPrompt({ result, pages }),
      includeRenderedContext: false,
      stageUserInputPolicy: false,
      stream: false,
    });
    const output = await parseOrRepairPaperIngestBatchSummary(raw, (options) => this.modelStep({
      ...options,
      stageUserInputPolicy: false,
    }));
    return summarizePaperIngestBatchResult(result, output);
  }
}

function summarizePaperIngestBatchResult(
  result: PaperIngestBatchResult,
  output: PaperIngestBatchSummaryModelOutput,
): PaperIngestBatchSummaryResult {
  const completedByKey = new Map(result.completed.map((item) => [item.digest.canonicalPaperKey, item] as const));
  const papers = result.digests.map<PaperIngestBatchPaperSummary>((digest) => {
    const completed = completedByKey.get(digest.canonicalPaperKey);
    const lookup = result.lookupIndex[digest.canonicalPaperKey] ?? [];
    return {
      canonicalPaperKey: digest.canonicalPaperKey,
      title: digest.title,
      status: completed ? "ingested" : "reused_existing",
      summary: completed?.plan.summary ?? digest.oneSentenceSummary,
      affectedPageKeys: dedupe([
        ...(completed ? completed.pages.map((page) => page.pageKey) : []),
        ...lookup.map((page) => page.pageKey),
        ...result.crossReference.pages.map((page) => page.pageKey),
      ]),
    };
  });
  const ingestedPapers = papers.filter((paper) => paper.status === "ingested").length;
  const reusedExistingPapers = papers.filter((paper) => paper.status === "reused_existing").length;
  const failedPapers = result.failures.length;
  const citations = output.citations.length > 0
    ? output.citations
    : collectFallbackBatchSummaryCitations(result);
  return {
    summary: output.summary,
    summaryTitle: output.summaryTitle,
    summaryMarkdown: ensureBatchSummaryMarkdownLinks(output.summaryMarkdown, citations),
    citations,
    synthesis: output.synthesis,
    totalPapers: result.digests.length + failedPapers,
    ingestedPapers,
    reusedExistingPapers,
    failedPapers,
    papers,
    failures: result.failures.map((failure) => ({
      sourceId: failure.digest?.sourceId ?? failure.paper.sourceId,
      sourceKind: failure.paper.kind,
      canonicalPaperKey: failure.digest?.canonicalPaperKey,
      title: failure.digest?.title,
      error: failure.error,
    })),
    write: {
      status: result.write.status,
      indexPath: result.write.indexPath,
      logPath: result.write.logPath,
      hotPath: result.write.hotPath,
    },
  };
}

function collectFallbackBatchSummaryCitations(result: PaperIngestBatchResult): PaperIngestBatchSummaryCitation[] {
  const pages = collectPaperIngestBatchSummaryPages(result)
    .map((item) => item.page);
  return dedupeByKey(pages, (page) => `${page.kind}:${page.pageKey}`)
    .slice(0, 12)
    .map((page) => ({
      pageKey: page.pageKey,
      title: page.title,
      pageKind: page.kind,
      rationale: "Relevant page touched or retrieved during this batch ingest.",
    }));
}

function ensureBatchSummaryMarkdownLinks(
  markdown: string,
  citations: PaperIngestBatchSummaryCitation[],
): string {
  const trimmed = markdown.trim();
  const hasWikiLinks = /\[\[[^\]]+\]\]/u.test(trimmed);
  if (hasWikiLinks || citations.length === 0) return trimmed;
  const citationLines = citations
    .slice(0, 8)
    .map((item) => `- [[${item.pageKey}]] (${item.pageKind}): ${item.rationale}`);
  return [
    trimmed,
    "",
    "## Cited Wiki Pages",
    "",
    ...citationLines,
  ].join("\n");
}

interface PaperIngestBatchSummaryModelOutput {
  summaryTitle: string;
  summary: string;
  summaryMarkdown: string;
  citations: PaperIngestBatchSummaryCitation[];
  synthesis: {
    integratedTakeaway: string;
    stateOfPlay: string[];
    tensions: string[];
    openQuestions: string[];
  };
}

interface PaperIngestBatchSummaryPageContext {
  page: LiteratureWikiPage;
  markdown: string;
}

const PAPER_INGEST_BATCH_SUMMARY_SCHEMA: StructuredSchema = {
  name: "paper_ingest_batch_summary",
  description: "A synthesized summary of the wiki pages touched by a paper-ingest batch.",
  schema: {
    type: "object",
    required: ["summaryTitle", "summary", "summaryMarkdown", "citations", "synthesis"],
    properties: {
      summaryTitle: { type: "string" },
      summary: { type: "string" },
      summaryMarkdown: { type: "string" },
      citations: {
        type: "array",
        items: {
          type: "object",
          required: ["pageKey", "title", "pageKind", "rationale"],
          properties: {
            pageKey: { type: "string" },
            title: { type: "string" },
            pageKind: { type: "string" },
            rationale: { type: "string" },
          },
        },
      },
      synthesis: {
        type: "object",
        required: ["integratedTakeaway", "stateOfPlay", "tensions", "openQuestions"],
        properties: {
          integratedTakeaway: { type: "string" },
          stateOfPlay: { type: "array", items: { type: "string" } },
          tensions: { type: "array", items: { type: "string" } },
          openQuestions: { type: "array", items: { type: "string" } },
        },
      },
    },
  },
};

function renderPaperIngestBatchSummaryPrompt(input: {
  result: PaperIngestBatchResult;
  pages: PaperIngestBatchSummaryPageContext[];
}): string {
  const paperLines = input.result.digests.map((digest) => {
    const completed = input.result.completed.find((item) => item.digest.canonicalPaperKey === digest.canonicalPaperKey);
    const status = completed ? "ingested" : "reused_existing";
    return `- ${status}: ${digest.title} ([[${digest.canonicalPaperKey}]])`;
  });
  const pageBlocks = input.pages.map(({ page, markdown }, index) => [
    `## Page ${index + 1}: [[${page.pageKey}]]`,
    `kind: ${page.kind}`,
    `title: ${page.title}`,
    `summary: ${page.summary}`,
    "",
    markdown.trim(),
  ].join("\n"));

  return [
    "You are synthesizing the result of a paper-ingest batch for a persistent literature wiki.",
    "",
    "Do not summarize the operation mechanically.",
    "Read the touched wiki pages and explain the integrated knowledge update: what changed in the wiki's understanding, what claims or topics moved, and what tensions or open questions are now visible.",
    "Write summaryMarkdown like a compact literature review: group evidence by research question, method, benchmark, finding, formal result, claim, and topic when those pages exist.",
    "Prefer comparative language across papers and pages: common conclusions, disagreements, boundary conditions, and remaining gaps.",
    "This is similar to a query answer or a synthesis page, but it should be returned to the caller only; do not assume it will be written as a wiki page.",
    "Use citations with wiki page keys such as [[page_key]] inside summaryMarkdown. Every substantive paragraph should cite at least one wiki page.",
    "The Touched Wiki Pages section includes both pages produced by this batch and pages loaded from the ingest lookup index for reused or affected papers; use those existing pages as context when they are relevant.",
    "",
    "# Batch Papers",
    "",
    paperLines.join("\n") || "- no completed or reused papers",
    "",
    "# Failures",
    "",
    input.result.failures.map((failure) => `- ${failure.paper.sourceId}: ${failure.error}`).join("\n") || "- none",
    "",
    "# Touched Wiki Pages",
    "",
    pageBlocks.join("\n\n---\n\n") || "No wiki pages were available for synthesis.",
    "",
    "# Output",
    "",
    "Return valid JSON only.",
    "Do not include Markdown fences.",
    "Match this JSON shape exactly:",
    "",
    JSON.stringify(PAPER_INGEST_BATCH_SUMMARY_MODEL_OUTPUT_SHAPE, null, 2),
  ].join("\n");
}

async function parseOrRepairPaperIngestBatchSummary(
  rawText: string,
  modelStep: PaperIngestPlannerModelStepRunner,
): Promise<PaperIngestBatchSummaryModelOutput> {
  try {
    return coercePaperIngestBatchSummary(parseStructuredOutput(rawText, PAPER_INGEST_BATCH_SUMMARY_SCHEMA));
  } catch (error) {
    try {
      return coercePaperIngestBatchSummary(salvageStructuredOutput(rawText, PAPER_INGEST_BATCH_SUMMARY_SCHEMA));
    } catch {
      const repaired = await modelStep({
        stepId: "paper_ingest_batch_summary_repair",
        system: "You repair invalid paper-ingest batch summaries into valid JSON.",
        prompt: repairInstruction(
          PAPER_INGEST_BATCH_SUMMARY_SCHEMA,
          rawText,
          error instanceof Error ? error.message : String(error),
        ),
        includeRenderedContext: false,
        stream: false,
      });
      return coercePaperIngestBatchSummary(parseStructuredOutput(repaired, PAPER_INGEST_BATCH_SUMMARY_SCHEMA));
    }
  }
}

function coercePaperIngestBatchSummary(value: Record<string, unknown>): PaperIngestBatchSummaryModelOutput {
  const synthesis = isRecord(value.synthesis) ? value.synthesis : {};
  return {
    summaryTitle: asString(value.summaryTitle),
    summary: asString(value.summary),
    summaryMarkdown: asString(value.summaryMarkdown),
    citations: asObjectArray(value.citations).map((item) => ({
      pageKey: asString(item.pageKey),
      title: asString(item.title),
      pageKind: normalizePageKindForSummary(asString(item.pageKind)),
      rationale: asString(item.rationale),
    })),
    synthesis: {
      integratedTakeaway: asString(synthesis.integratedTakeaway),
      stateOfPlay: asStringArray(synthesis.stateOfPlay),
      tensions: asStringArray(synthesis.tensions),
      openQuestions: asStringArray(synthesis.openQuestions),
    },
  };
}

function collectPaperIngestBatchSummaryPages(result: PaperIngestBatchResult): PaperIngestBatchSummaryPageContext[] {
  const byKey = new Map<string, LiteratureWikiPage>();
  for (const item of result.completed) {
    for (const page of item.pages) byKey.set(pageIdentity(page), page);
  }
  for (const page of result.crossReference.pages) {
    byKey.set(pageIdentity(page), page);
  }
  for (const pages of Object.values(result.lookupIndex)) {
    for (const page of pages) byKey.set(pageIdentity(page), page);
  }
  return [...byKey.values()]
    .sort((left, right) => pageKindOrder().indexOf(left.kind) - pageKindOrder().indexOf(right.kind))
    .map((page) => ({
      page,
      markdown: renderLiteratureWikiPageMarkdown(page),
    }));
}

function normalizePageKindForSummary(value: string): LiteratureWikiPage["kind"] {
  return normalizeEnum(value, [
    "paper",
    "research_question",
    "method",
    "benchmark",
    "finding",
    "formal_result",
    "claim",
    "topic",
    "synthesis",
  ], "synthesis");
}

const PAPER_INGEST_PLAN_SCHEMA: StructuredSchema = {
  name: "paper_ingest_plan",
  description: "A structured plan describing how one paper digest should update a persistent literature wiki.",
  schema: {
    type: "object",
    required: ["paperKey", "paperTitle", "schemaFamily", "ingestObjective", "summary", "pageUpdates", "claimUpdates", "topicUpdates", "logEntry"],
    properties: {
      paperKey: { type: "string" },
      paperTitle: { type: "string" },
      schemaFamily: { type: "string" },
      ingestObjective: { type: "string" },
      summary: { type: "string" },
      pageUpdates: {
        type: "array",
        items: {
          type: "object",
          required: ["pageKind", "pageKey", "title", "action", "rationale", "priority", "patchOutline"],
          properties: {
            pageKind: { type: "string" },
            pageKey: { type: "string" },
            title: { type: "string" },
            action: { type: "string" },
            rationale: { type: "string" },
            priority: { type: "string" },
            patchOutline: { type: "array", items: { type: "string" } },
          },
        },
      },
      claimUpdates: {
        type: "array",
        items: {
          type: "object",
          required: ["claimKey", "claimText", "action", "effect", "rationale", "evidenceNotes"],
          properties: {
            claimKey: { type: "string" },
            claimText: { type: "string" },
            action: { type: "string" },
            effect: { type: "string" },
            rationale: { type: "string" },
            evidenceNotes: { type: "array", items: { type: "string" } },
          },
        },
      },
      topicUpdates: {
        type: "array",
        items: {
          type: "object",
          required: ["topicKey", "title", "action", "rationale", "topicThreads"],
          properties: {
            topicKey: { type: "string" },
            title: { type: "string" },
            action: { type: "string" },
            rationale: { type: "string" },
            topicThreads: { type: "array", items: { type: "string" } },
          },
        },
      },
      logEntry: {
        type: "object",
        required: ["title", "summary", "affectedPageKeys", "notes"],
        properties: {
          title: { type: "string" },
          summary: { type: "string" },
          affectedPageKeys: { type: "array", items: { type: "string" } },
          notes: { type: "array", items: { type: "string" } },
        },
      },
    },
  },
};

async function parseOrRepairPaperIngestPlan(
  rawText: string,
  modelStep: PaperIngestPlannerModelStepRunner,
): Promise<PaperIngestPlan> {
  try {
    return coercePaperIngestPlan(parseStructuredOutput(rawText, PAPER_INGEST_PLAN_SCHEMA));
  } catch (error) {
    try {
      return coercePaperIngestPlan(salvageStructuredOutput(rawText, PAPER_INGEST_PLAN_SCHEMA));
    } catch {
      const repaired = await modelStep({
        stepId: "paper_ingest_plan_repair_model",
        system: "You repair invalid paper-ingest-plan outputs into valid JSON.",
        prompt: repairInstruction(
          PAPER_INGEST_PLAN_SCHEMA,
          rawText,
          error instanceof Error ? error.message : String(error),
        ),
        includeRenderedContext: false,
        stream: false,
      });
      return coercePaperIngestPlan(parseStructuredOutput(repaired, PAPER_INGEST_PLAN_SCHEMA));
    }
  }
}

function coercePaperIngestPlan(value: Record<string, unknown>): PaperIngestPlan {
  return {
    paperKey: asString(value.paperKey),
    paperTitle: asString(value.paperTitle),
    schemaFamily: normalizeSchemaFamily(value.schemaFamily),
    ingestObjective: asString(value.ingestObjective),
    summary: asString(value.summary),
    pageUpdates: asObjectArray(value.pageUpdates).map(coercePageUpdate),
    claimUpdates: asObjectArray(value.claimUpdates).map(coerceClaimUpdate),
    topicUpdates: asObjectArray(value.topicUpdates).map(coerceTopicUpdate),
    logEntry: coerceLogEntry(isRecord(value.logEntry) ? value.logEntry : {}),
  };
}

function coercePageUpdate(value: Record<string, unknown>): PaperIngestPageUpdate {
  return {
    pageKind: normalizePageKind(value.pageKind),
    pageKey: asString(value.pageKey),
    title: asString(value.title),
    action: normalizeEnum(asString(value.action), ["create", "update", "append"], "update"),
    rationale: asString(value.rationale),
    priority: normalizeEnum(asString(value.priority), ["primary", "secondary"], "secondary"),
    patchOutline: asStringArray(value.patchOutline),
  };
}

function coerceClaimUpdate(value: Record<string, unknown>): PaperIngestClaimUpdate {
  return {
    claimKey: asString(value.claimKey),
    claimText: asString(value.claimText),
    action: normalizeEnum(asString(value.action), ["create", "update"], "update"),
    effect: normalizeEnum(asString(value.effect), ["supports", "contradicts", "qualifies", "organizes"], "organizes"),
    rationale: asString(value.rationale),
    evidenceNotes: asStringArray(value.evidenceNotes),
  };
}

function coerceTopicUpdate(value: Record<string, unknown>): PaperIngestTopicUpdate {
  return {
    topicKey: asString(value.topicKey),
    title: asString(value.title),
    action: normalizeEnum(asString(value.action), ["create", "update"], "update"),
    rationale: asString(value.rationale),
    topicThreads: asStringArray(value.topicThreads),
  };
}

function coerceLogEntry(value: Record<string, unknown>): PaperIngestLogEntry {
  return {
    title: asString(value.title),
    summary: asString(value.summary),
    affectedPageKeys: asStringArray(value.affectedPageKeys),
    notes: asStringArray(value.notes),
  };
}

function normalizeSchemaFamily(value: unknown): PaperDigestSchemaFamily {
  return normalizeEnum(asString(value), [
    "computational_empirical",
    "experimental_empirical",
    "methodological_or_instrumentation",
    "theoretical_or_mathematical",
    "review_or_survey",
  ], "computational_empirical") as PaperDigestSchemaFamily;
}

function normalizePageKind(value: unknown): PaperIngestWikiPageKind {
  return normalizeEnum(asString(value), [
    "paper",
    "research_question",
    "method",
    "benchmark",
    "finding",
    "formal_result",
    "claim",
    "topic",
    "synthesis",
  ], "paper") as PaperIngestWikiPageKind;
}

function buildPaperPage(digest: PaperDigest, plan: PaperIngestPlan, updatedAt: string, discipline: LiteratureDiscipline): LiteratureWikiPaperPage {
  return {
    schemaVersion: "kaivu-literature-wiki-page-v1",
    discipline,
    kind: "paper",
    pageKey: plan.paperKey,
    title: plan.paperTitle,
    summary: digest.oneSentenceSummary || plan.summary,
    tags: dedupe([
      "paper",
      "literature",
      digest.schemaFamily,
      ...digest.importantTerms.slice(0, 6).map((item) => slug(item)),
    ]),
    aliases: dedupe([digest.title, ...(digest.citationLine ? [digest.citationLine] : [])]),
    sourcePaperKeys: [digest.canonicalPaperKey],
    updatedAt,
    domainScope: inferPaperDomainScope(digest),
    canonicalPaperKey: digest.canonicalPaperKey,
    schemaFamily: digest.schemaFamily,
    selectionReason: digest.selectionReason,
    citationLine: digest.citationLine,
    researchProblem: digest.researchProblem,
    approach: digest.approach,
    keyContributions: digest.keyContributions,
    keyClaims: digest.keyClaims,
    findings: digest.findings,
    limitations: digest.limitations,
    importantTerms: digest.importantTerms,
    relatedPageKeys: dedupe([
      ...plan.pageUpdates.filter((item) => item.pageKey !== plan.paperKey).map((item) => item.pageKey),
      ...plan.claimUpdates.map((item) => item.claimKey),
      ...plan.topicUpdates.map((item) => item.topicKey),
    ]),
  };
}

function buildResearchPage(
  digest: PaperDigest,
  plan: PaperIngestPlan,
  update: PaperIngestPlan["pageUpdates"][number],
  updatedAt: string,
  discipline: LiteratureDiscipline,
): LiteratureWikiPage | null {
  switch (update.pageKind) {
    case "research_question":
      return buildResearchQuestionPage(digest, plan, update, updatedAt, discipline);
    case "method":
      return buildMethodPage(digest, plan, update, updatedAt, discipline);
    case "benchmark":
      return buildBenchmarkPage(digest, plan, update, updatedAt, discipline);
    case "finding":
      return buildFindingPage(digest, plan, update, updatedAt, discipline);
    case "formal_result":
      return buildFormalResultPage(digest, plan, update, updatedAt, discipline);
    default:
      return null;
  }
}

function buildResearchQuestionPage(
  digest: PaperDigest,
  plan: PaperIngestPlan,
  update: PaperIngestPlan["pageUpdates"][number],
  updatedAt: string,
  discipline: LiteratureDiscipline,
): LiteratureWikiResearchQuestionPage {
  return {
    schemaVersion: "kaivu-literature-wiki-page-v1",
    discipline,
    kind: "research_question",
    pageKey: update.pageKey,
    title: update.title,
    summary: update.rationale,
    tags: dedupe(["research_question", "literature", digest.schemaFamily, update.priority]),
    aliases: [],
    sourcePaperKeys: [digest.canonicalPaperKey],
    updatedAt,
    domainScope: inferPaperDomainScope(digest),
    question: update.patchOutline[0] || update.title,
    motivation: update.rationale || digest.motivation,
    currentAnswer: digest.oneSentenceSummary,
    relatedTopicKeys: plan.topicUpdates.map((item) => item.topicKey),
    claimPageKeys: plan.claimUpdates.map((item) => item.claimKey),
    findingPageKeys: plan.pageUpdates
      .filter((item) => item.pageKind === "finding")
      .map((item) => item.pageKey),
    methodPageKeys: plan.pageUpdates
      .filter((item) => item.pageKind === "method")
      .map((item) => item.pageKey),
    benchmarkKeys: plan.pageUpdates
      .filter((item) => item.pageKind === "benchmark")
      .map((item) => item.pageKey),
    openSubquestions: dedupe([
      ...update.patchOutline.slice(1),
      ...digest.uncertainty,
      ...digest.relatedWorkSignals.followUpDirections,
    ]).slice(0, 10),
    relatedPageKeys: dedupe([
      plan.paperKey,
      ...plan.claimUpdates.map((item) => item.claimKey),
      ...plan.topicUpdates.map((item) => item.topicKey),
      ...plan.pageUpdates
        .filter((item) => item.pageKey !== update.pageKey)
        .map((item) => item.pageKey),
    ]),
  };
}

function buildBenchmarkPage(
  digest: PaperDigest,
  plan: PaperIngestPlan,
  update: PaperIngestPlan["pageUpdates"][number],
  updatedAt: string,
  discipline: LiteratureDiscipline,
): LiteratureWikiBenchmarkPage {
  return {
    schemaVersion: "kaivu-literature-wiki-page-v1",
    discipline,
    kind: "benchmark",
    pageKey: update.pageKey,
    title: update.title,
    summary: update.rationale,
    tags: dedupe(["benchmark", "literature", digest.schemaFamily, update.priority]),
    aliases: [],
    sourcePaperKeys: [digest.canonicalPaperKey],
    updatedAt,
    domainScope: inferPaperDomainScope(digest),
    benchmarkStatement: update.patchOutline[0] || update.title,
    evaluates: dedupe([
      ...digest.literatureReviewUse.searchTerms,
      ...digest.specialized.computationalEmpirical.benchmarks,
      ...digest.specialized.methodologicalOrInstrumentation.evaluationSetup,
    ]).slice(0, 10),
    datasetOrSuite: dedupe([
      ...digest.specialized.computationalEmpirical.datasets,
      ...digest.specialized.experimentalEmpirical.studySystemOrSamples,
      update.title,
    ])[0] ?? update.title,
    metrics: dedupe([
      ...digest.specialized.computationalEmpirical.metrics,
      ...digest.specialized.experimentalEmpirical.measurementEndpoints,
      ...digest.importantTerms.filter((term) => /metric|score|accuracy|f1|auc|bleu|rouge|loss|error|measure/i.test(term)),
    ]).slice(0, 10),
    knownCaveats: dedupe([
      ...digest.limitations,
      ...digest.uncertainty,
      ...digest.specialized.computationalEmpirical.failureModesOrRisks,
      ...digest.specialized.experimentalEmpirical.sourcesOfBias,
    ]).slice(0, 10),
    usedByPaperKeys: [digest.canonicalPaperKey],
    relatedMethodKeys: plan.pageUpdates
      .filter((item) => item.pageKind === "method")
      .map((item) => item.pageKey),
    relatedFindingKeys: plan.pageUpdates
      .filter((item) => item.pageKind === "finding")
      .map((item) => item.pageKey),
    relatedPageKeys: relatedPlanPageKeys(plan, update.pageKey),
  };
}

function buildFindingPage(
  digest: PaperDigest,
  plan: PaperIngestPlan,
  update: PaperIngestPlan["pageUpdates"][number],
  updatedAt: string,
  discipline: LiteratureDiscipline,
): LiteratureWikiFindingPage {
  return {
    schemaVersion: "kaivu-literature-wiki-page-v1",
    discipline,
    kind: "finding",
    pageKey: update.pageKey,
    title: update.title,
    summary: update.rationale,
    tags: dedupe(["finding", "literature", digest.schemaFamily, update.priority]),
    aliases: [],
    sourcePaperKeys: [digest.canonicalPaperKey],
    updatedAt,
    domainScope: inferPaperDomainScope(digest),
    findingStatement: update.patchOutline[0] || update.rationale || update.title,
    evidenceType: digest.schemaFamily,
    supportingPaperKeys: [digest.canonicalPaperKey],
    relatedMethodKeys: plan.pageUpdates
      .filter((item) => item.pageKind === "method")
      .map((item) => item.pageKey),
    relatedBenchmarkKeys: plan.pageUpdates
      .filter((item) => item.pageKind === "benchmark")
      .map((item) => item.pageKey),
    supportsClaimKeys: plan.claimUpdates
      .filter((item) => item.effect === "supports")
      .map((item) => item.claimKey),
    qualifiesClaimKeys: plan.claimUpdates
      .filter((item) => item.effect === "qualifies")
      .map((item) => item.claimKey),
    contradictsClaimKeys: plan.claimUpdates
      .filter((item) => item.effect === "contradicts")
      .map((item) => item.claimKey),
    caveats: dedupe([
      ...update.patchOutline.slice(1),
      ...digest.limitations,
      ...digest.uncertainty,
    ]).slice(0, 10),
    relatedPageKeys: relatedPlanPageKeys(plan, update.pageKey),
  };
}

function buildFormalResultPage(
  digest: PaperDigest,
  plan: PaperIngestPlan,
  update: PaperIngestPlan["pageUpdates"][number],
  updatedAt: string,
  discipline: LiteratureDiscipline,
): LiteratureWikiFormalResultPage {
  return {
    schemaVersion: "kaivu-literature-wiki-page-v1",
    discipline,
    kind: "formal_result",
    pageKey: update.pageKey,
    title: update.title,
    summary: update.rationale,
    tags: dedupe(["formal_result", "literature", digest.schemaFamily, update.priority]),
    aliases: [],
    sourcePaperKeys: [digest.canonicalPaperKey],
    updatedAt,
    domainScope: inferPaperDomainScope(digest),
    formalResultType: inferFormalResultType(update),
    statement: update.patchOutline[0] || update.rationale || update.title,
    assumptions: dedupe([
      ...digest.specialized.theoreticalOrMathematical.assumptions,
      ...digest.limitations,
      ...digest.uncertainty,
    ]).slice(0, 10),
    proofIdea: dedupe([
      ...digest.specialized.theoreticalOrMathematical.proofStrategy,
      digest.approach,
    ])[0] ?? digest.approach,
    dependsOnResultKeys: plan.pageUpdates
      .filter((item) => item.pageKind === "formal_result" && item.pageKey !== update.pageKey)
      .map((item) => item.pageKey),
    supportsClaimKeys: plan.claimUpdates.map((item) => item.claimKey),
    relatedMethodKeys: plan.pageUpdates
      .filter((item) => item.pageKind === "method")
      .map((item) => item.pageKey),
    limitations: dedupe([
      ...digest.specialized.theoreticalOrMathematical.scopeOfApplicability,
      ...digest.limitations,
      ...digest.uncertainty,
    ]).slice(0, 10),
    relatedPageKeys: relatedPlanPageKeys(plan, update.pageKey),
  };
}

function relatedPlanPageKeys(plan: PaperIngestPlan, currentPageKey: string): string[] {
  return dedupe([
    plan.paperKey,
    ...plan.claimUpdates.map((item) => item.claimKey),
    ...plan.topicUpdates.map((item) => item.topicKey),
    ...plan.pageUpdates
      .filter((item) => item.pageKey !== currentPageKey)
      .map((item) => item.pageKey),
  ]);
}

function inferFormalResultType(
  update: PaperIngestPlan["pageUpdates"][number],
): LiteratureWikiFormalResultPage["formalResultType"] {
  const text = `${update.title} ${update.rationale} ${update.patchOutline.join(" ")}`.toLowerCase();
  if (/\btheorem\b/u.test(text)) return "theorem";
  if (/\blemma\b/u.test(text)) return "lemma";
  if (/\bcorollary\b/u.test(text)) return "corollary";
  if (/\bproposition\b/u.test(text)) return "proposition";
  if (/\bconjecture\b/u.test(text)) return "conjecture";
  if (/\bbound\b|\blower bound\b|\bupper bound\b/u.test(text)) return "bound";
  if (/\bguarantee\b|\bguarantees\b/u.test(text)) return "guarantee";
  return "other";
}

function buildClaimPage(
  digest: PaperDigest,
  plan: PaperIngestPlan,
  claim: PaperIngestPlan["claimUpdates"][number],
  updatedAt: string,
  discipline: LiteratureDiscipline,
): LiteratureWikiClaimPage {
  return {
    schemaVersion: "kaivu-literature-wiki-page-v1",
    discipline,
    kind: "claim",
    pageKey: claim.claimKey,
    title: claim.claimText.slice(0, 120),
    summary: claim.rationale,
    tags: dedupe(["claim", "literature", claim.effect]),
    aliases: [],
    sourcePaperKeys: [digest.canonicalPaperKey],
    updatedAt,
    domainScope: inferPaperDomainScope(digest),
    claimText: claim.claimText,
    claimStatus: claim.effect === "contradicts" ? "needs_revisit" : "provisional",
    supportPaperKeys: claim.effect === "supports" ? [digest.canonicalPaperKey] : [],
    contradictPaperKeys: claim.effect === "contradicts" ? [digest.canonicalPaperKey] : [],
    qualifyPaperKeys: claim.effect === "qualifies" ? [digest.canonicalPaperKey] : [],
    topicPageKeys: plan.topicUpdates
      .filter((topic) => isClaimRelatedToTopic(claim, topic))
      .map((topic) => topic.topicKey),
    contradictions: buildClaimContradictions(claim),
    tensions: buildClaimTensions(claim),
    notes: claim.evidenceNotes,
  };
}

function buildMethodPage(
  digest: PaperDigest,
  plan: PaperIngestPlan,
  update: PaperIngestPlan["pageUpdates"][number],
  updatedAt: string,
  discipline: LiteratureDiscipline,
): LiteratureWikiMethodPage | null {
  if (update.pageKind !== "method") return null;
  const outline = update.patchOutline;
  return {
    schemaVersion: "kaivu-literature-wiki-page-v1",
    discipline,
    kind: "method",
    pageKey: update.pageKey,
    title: update.title,
    summary: update.rationale,
    tags: dedupe(["method", "literature", digest.schemaFamily, update.priority]),
    aliases: [],
    sourcePaperKeys: [digest.canonicalPaperKey],
    updatedAt,
    domainScope: inferPaperDomainScope(digest),
    methodStatement: outline[0] || update.rationale || update.title,
    mechanism: dedupe([
      ...outline.slice(1),
      digest.approach,
      ...digest.keyContributions,
    ]).slice(0, 8),
    assumptions: dedupe([
      ...digest.limitations,
      ...digest.uncertainty,
    ]).slice(0, 8),
    inputs: dedupe(digest.importantTerms.filter((term) => /data|input|context|prompt|sample|source|dataset/i.test(term))).slice(0, 8),
    outputs: dedupe(digest.importantTerms.filter((term) => /output|prediction|answer|score|embedding|proof|result/i.test(term))).slice(0, 8),
    variants: dedupe(digest.relatedWorkSignals.competingApproaches).slice(0, 8),
    baselines: dedupe(digest.relatedWorkSignals.namedPriorWork).slice(0, 8),
    failureModes: dedupe([
      ...digest.limitations,
      ...digest.uncertainty,
    ]).slice(0, 8),
    relatedBenchmarkKeys: plan.pageUpdates
      .filter((item) => item.pageKind === "benchmark")
      .map((item) => item.pageKey),
    relatedFindingKeys: plan.pageUpdates
      .filter((item) => item.pageKind === "finding")
      .map((item) => item.pageKey),
    relatedFormalResultKeys: plan.pageUpdates
      .filter((item) => item.pageKind === "formal_result")
      .map((item) => item.pageKey),
    relatedPageKeys: dedupe([
      plan.paperKey,
      ...plan.claimUpdates.map((item) => item.claimKey),
      ...plan.topicUpdates.map((item) => item.topicKey),
      ...plan.pageUpdates
        .filter((item) => item.pageKey !== update.pageKey)
        .map((item) => item.pageKey),
    ]),
  };
}

function buildTopicPage(
  digest: PaperDigest,
  plan: PaperIngestPlan,
  topic: PaperIngestPlan["topicUpdates"][number],
  updatedAt: string,
  discipline: LiteratureDiscipline,
): LiteratureWikiTopicPage {
  return {
    schemaVersion: "kaivu-literature-wiki-page-v1",
    discipline,
    kind: "topic",
    pageKey: topic.topicKey,
    title: topic.title,
    summary: topic.rationale,
    tags: dedupe(["topic", "literature", digest.schemaFamily]),
    aliases: [],
    sourcePaperKeys: [digest.canonicalPaperKey],
    updatedAt,
    domainScope: inferPaperDomainScope(digest),
    topicStatement: topic.rationale,
    scopeNotes: plan.pageUpdates
      .filter((item) => item.pageKind === "topic" && item.pageKey === topic.topicKey)
      .flatMap((item) => item.patchOutline),
    currentThreads: topic.topicThreads,
      keyPageKeys: dedupe([
        plan.paperKey,
        ...plan.pageUpdates
        .filter((item) => item.pageKey !== topic.topicKey && item.pageKind !== "topic")
        .map((item) => item.pageKey),
      ]),
    claimPageKeys: plan.claimUpdates
      .filter((claim) => isClaimRelatedToTopic(claim, topic))
      .map((claim) => claim.claimKey),
    openTensions: buildTopicOpenTensions(plan, topic, digest),
    openQuestions: digest.uncertainty,
  };
}

function buildSynthesisPages(
  digest: PaperDigest,
  plan: PaperIngestPlan,
  updatedAt: string,
  discipline: LiteratureDiscipline,
): LiteratureWikiSynthesisPage[] {
  const synthesisFromPageUpdates = plan.pageUpdates
    .filter((update) => update.pageKind === "synthesis")
    .map((update) => ({
      schemaVersion: "kaivu-literature-wiki-page-v1" as const,
      discipline,
      kind: "synthesis" as const,
      pageKey: update.pageKey,
      title: update.title,
      summary: update.rationale,
      tags: dedupe(["synthesis", "literature", digest.schemaFamily, update.priority]),
      aliases: [],
      sourcePaperKeys: [digest.canonicalPaperKey],
      updatedAt,
      domainScope: inferPaperDomainScope(digest),
      synthesisStatement: update.rationale,
      integratedTakeaway: update.patchOutline[0] ?? update.rationale,
      scopeNotes: [],
      stateOfPlay: update.patchOutline.slice(1, 4),
      synthesis: update.patchOutline,
      keyPageKeys: dedupe([
        plan.paperKey,
        ...plan.pageUpdates.filter((item) => item.pageKey !== update.pageKey).map((item) => item.pageKey),
      ]),
      claimPageKeys: plan.claimUpdates.map((claim) => claim.claimKey),
      contradictions: collectPlanContradictions(plan),
      tensions: collectPlanSynthesisTensions(plan, digest),
      openQuestions: digest.uncertainty,
    }));

  return dedupePagesByKey([
    ...synthesisFromPageUpdates,
  ]) as LiteratureWikiSynthesisPage[];
}

function buildClaimContradictions(
  claim: PaperIngestPlan["claimUpdates"][number],
): string[] {
  if (claim.effect === "contradicts") {
    return [`This paper presents evidence that pushes against the current form of this claim.`];
  }
  if (claim.effect === "qualifies") {
    return [`This paper introduces boundary conditions that narrow how broadly this claim should be read.`];
  }
  return [];
}

function buildTopicOpenTensions(
  plan: PaperIngestPlan,
  topic: PaperIngestPlan["topicUpdates"][number],
  digest: PaperDigest,
): string[] {
  const relatedClaims = plan.claimUpdates.filter((claim) => isClaimRelatedToTopic(claim, topic));
  const lines = dedupe([
    ...relatedClaims
      .filter((claim) => claim.effect === "contradicts")
      .map((claim) => `[[${claim.claimKey}]] introduces explicit contradiction within this topic.`),
    ...relatedClaims
      .filter((claim) => claim.effect === "qualifies")
      .map((claim) => `[[${claim.claimKey}]] narrows the scope of what currently seems to hold in this topic.`),
    ...digest.uncertainty.slice(0, 3),
  ]);
  return lines.slice(0, 6);
}

function buildClaimTensions(
  claim: PaperIngestPlan["claimUpdates"][number],
): string[] {
  const tensions = [...claim.evidenceNotes];
  if (claim.effect === "contradicts") {
    tensions.push("The evidence base is now split between support and contradiction, so this claim should be read as an active debate position.");
  } else if (claim.effect === "qualifies") {
    tensions.push("The main tension is not outright contradiction but scope: where the claim holds, and where it weakens.");
  }
  return dedupe(tensions);
}

function collectPlanContradictions(plan: PaperIngestPlan): string[] {
  return dedupe(plan.claimUpdates.flatMap((claim) => buildClaimContradictions(claim)));
}

function collectPlanSynthesisTensions(plan: PaperIngestPlan, digest: PaperDigest): string[] {
  return dedupe([
    ...plan.claimUpdates.flatMap((claim) => buildClaimTensions(claim)),
    ...plan.topicUpdates.flatMap((topic) => topic.topicThreads),
    ...digest.uncertainty,
  ]).slice(0, 8);
}

function buildClaimTensionsFromEvidence(
  supportPaperKeys: string[],
  contradictPaperKeys: string[],
  qualifyPaperKeys: string[],
  topicPageKeys: string[],
): string[] {
  const lines: string[] = [];
  if (supportPaperKeys.length > 0 && contradictPaperKeys.length > 0) {
    lines.push("This claim is now supported and contradicted by different papers, so the disagreement should remain explicit.");
  }
  if (qualifyPaperKeys.length > 0) {
    lines.push("Some evidence narrows the claim to specific settings or boundary conditions rather than supporting it without qualification.");
  }
  if (topicPageKeys.length > 0) {
    lines.push(`The main debate context is tracked in ${topicPageKeys.map((key) => `[[${key}]]`).join(", ")}.`);
  }
  return dedupe(lines);
}

function dedupePagesByKey(pages: LiteratureWikiPage[]): LiteratureWikiPage[] {
  const byKey = new Map<string, LiteratureWikiPage>();
  for (const page of pages) {
    const key = pageIdentity(page);
    const current = byKey.get(key);
    byKey.set(key, current ? mergeLiteratureWikiPages(current, page) : page);
  }
  return [...byKey.values()];
}

function pageIdentity(page: Pick<LiteratureWikiPage, "discipline" | "kind" | "pageKey">): string {
  return `${page.discipline}:${page.kind}:${page.pageKey}`;
}

function paperDigestInputFromIngestInput(input: PaperIngestInput): PaperDigestInput {
  return input.kind === "pdf_url"
    ? {
        kind: "pdf_url",
        sourceId: input.sourceId,
        pdfUrl: input.pdfUrl,
        ...(input.disciplineHint ? { disciplineHint: input.disciplineHint } : {}),
      }
    : {
        kind: "pdf_file",
        sourceId: input.sourceId,
        path: input.path,
        ...(input.disciplineHint ? { disciplineHint: input.disciplineHint } : {}),
      };
}

function dedupeByKey<T>(items: T[], keyFn: (item: T) => string): T[] {
  const byKey = new Map<string, T>();
  for (const item of items) {
    const key = keyFn(item);
    if (!byKey.has(key)) byKey.set(key, item);
  }
  return [...byKey.values()];
}

function buildPaperIngestRetrieveQuery(digest: PaperDigest): string {
  return dedupe([
    digest.title,
    digest.researchProblem,
    digest.oneSentenceSummary,
    ...digest.importantTerms.slice(0, 6),
    ...digest.literatureReviewUse.searchTerms.slice(0, 4),
  ])
    .filter(Boolean)
    .join(" | ");
}

function isPaperIngestWikiPageKind(kind: LiteratureWikiPage["kind"]): kind is PaperIngestWikiPageKind {
  return true;
}

function isPaperIngestWikiPage(page: LiteratureWikiPage): page is LiteratureWikiPage & { kind: PaperIngestWikiPageKind } {
  return isPaperIngestWikiPageKind(page.kind);
}

function buildExistingPageHint(page: LiteratureWikiPage & { kind: PaperIngestWikiPageKind }): PaperIngestExistingPageHint {
  return {
    pageKind: page.kind,
    pageKey: page.pageKey,
    title: page.title,
    summary: page.summary,
    sourcePaperKeys: page.sourcePaperKeys,
    relatedPageKeys: dedupe(literatureWikiPageLinks(page)),
    keyFacts: extractExistingPageHintFacts(page),
  };
}

function extractExistingPageHintFacts(page: LiteratureWikiPage & { kind: PaperIngestWikiPageKind }): string[] {
  switch (page.kind) {
    case "paper":
      return compactHintFacts([
        `research problem: ${page.researchProblem}`,
        `approach: ${page.approach}`,
        ...page.keyClaims.map((claim) => `claim: ${claim}`),
        ...page.findings.map((finding) => `finding: ${finding}`),
        ...page.limitations.map((limitation) => `limitation: ${limitation}`),
      ]);
    case "research_question":
      return compactHintFacts([
        `question: ${page.question}`,
        `current answer: ${page.currentAnswer}`,
        ...page.openSubquestions.map((question) => `open subquestion: ${question}`),
      ]);
    case "method":
      return compactHintFacts([
        `method statement: ${page.methodStatement}`,
        ...page.mechanism.map((item) => `mechanism: ${item}`),
        ...page.assumptions.map((item) => `assumption: ${item}`),
        ...page.failureModes.map((item) => `failure mode: ${item}`),
      ]);
    case "benchmark":
      return compactHintFacts([
        `benchmark statement: ${page.benchmarkStatement}`,
        `dataset or suite: ${page.datasetOrSuite}`,
        ...page.metrics.map((item) => `metric: ${item}`),
        ...page.knownCaveats.map((item) => `caveat: ${item}`),
      ]);
    case "finding":
      return compactHintFacts([
        `finding: ${page.findingStatement}`,
        `evidence type: ${page.evidenceType}`,
        ...page.caveats.map((item) => `caveat: ${item}`),
      ]);
    case "formal_result":
      return compactHintFacts([
        `result type: ${page.formalResultType}`,
        `statement: ${page.statement}`,
        `proof idea: ${page.proofIdea}`,
        ...page.assumptions.map((item) => `assumption: ${item}`),
        ...page.limitations.map((item) => `limitation: ${item}`),
      ]);
    case "claim":
      return compactHintFacts([
        `claim: ${page.claimText}`,
        `status: ${page.claimStatus}`,
        ...page.contradictions.map((item) => `contradiction: ${item}`),
        ...page.tensions.map((item) => `tension: ${item}`),
        ...page.notes.map((item) => `note: ${item}`),
      ]);
    case "topic":
      return compactHintFacts([
        `topic statement: ${page.topicStatement}`,
        ...page.currentThreads.map((item) => `thread: ${item}`),
        ...page.openTensions.map((item) => `tension: ${item}`),
        ...page.openQuestions.map((item) => `open question: ${item}`),
      ]);
    case "synthesis":
      return compactHintFacts([
        `synthesis statement: ${page.synthesisStatement}`,
        `integrated takeaway: ${page.integratedTakeaway}`,
        ...page.stateOfPlay.map((item) => `state of play: ${item}`),
        ...page.tensions.map((item) => `tension: ${item}`),
        ...page.openQuestions.map((item) => `open question: ${item}`),
      ]);
  }
}

function compactHintFacts(values: string[]): string[] {
  return dedupe(values.map((value) => value.trim()).filter((value) => value.length > 0 && !value.endsWith(":"))).slice(0, 12);
}

function decidePaperIngestRetrieveMode(digest: PaperDigest): WikiRetrieveMode {
  if (digest.keyClaims.length > 0) return "claim_first";
  if (digest.researchProblem || digest.literatureReviewUse.searchTerms.length > 0) return "topic_first";
  return "landscape";
}

function buildNoopPaperIngestPlan(digest: PaperDigest): PaperIngestPlan {
  return {
    paperKey: digest.canonicalPaperKey,
    paperTitle: digest.title,
    schemaFamily: digest.schemaFamily,
    ingestObjective: "Reuse the existing wiki compilation for this paper.",
    summary: "This paper was already ingested into the literature wiki, so no new wiki write was needed.",
    pageUpdates: [],
    claimUpdates: [],
    topicUpdates: [],
    logEntry: {
      title: `Reuse existing ingest for ${digest.title}`,
      summary: "The literature wiki already contains a paper page for this canonical paper key.",
      affectedPageKeys: [],
      notes: [],
    },
  };
}

async function readExistingPage(path: string): Promise<LiteratureWikiPage | null> {
  try {
    const raw = await readFile(path, "utf-8");
    return parseLiteratureWikiPageMarkdown(raw);
  } catch {
    return null;
  }
}

async function loadExistingWikiPages(root: string): Promise<LiteratureWikiPage[]> {
  try {
    const files = await collectMarkdownFiles(root);
    const pages: LiteratureWikiPage[] = [];
    for (const file of files) {
      const raw = await readFile(file, "utf-8");
      const page = parseLiteratureWikiPageMarkdown(raw);
      if (page) pages.push(page);
    }
    return pages;
  } catch {
    return [];
  }
}

async function readPaperIngestManifest(root: string): Promise<Record<string, PaperIngestManifestRecord>> {
  try {
    const raw = await readFile(paperIngestManifestPath(root), "utf-8");
    const parsed = JSON.parse(raw) as Partial<PersistedPaperIngestManifestFile>;
    if (parsed.schemaVersion !== 1 || !Array.isArray(parsed.records)) return {};
    const index: Record<string, PaperIngestManifestRecord> = {};
    for (const record of parsed.records) {
      if (!isRecord(record)) continue;
      const canonicalPaperKey = asString(record.canonicalPaperKey);
      if (!canonicalPaperKey) continue;
      index[canonicalPaperKey] = {
        canonicalPaperKey,
        pageFiles: asStringArray(record.pageFiles),
        updatedAt: asString(record.updatedAt),
      };
    }
    return index;
  } catch {
    return {};
  }
}

async function persistPaperIngestManifest(root: string, lookupIndex: LiteratureWikiLookupIndex): Promise<void> {
  const existing = await readPaperIngestManifest(root);
  const updatedAt = new Date().toISOString();
  for (const [canonicalPaperKey, pages] of Object.entries(lookupIndex)) {
    existing[canonicalPaperKey] = {
      canonicalPaperKey,
      pageFiles: dedupe(
        pages.map((page) =>
          relative(root, literatureWikiPagePath(root, page.discipline, page.kind, page.pageKey)).replace(/\\/g, "/"),
        ),
      ),
      updatedAt,
    };
  }
  const records = Object.values(existing).sort((left, right) => left.canonicalPaperKey.localeCompare(right.canonicalPaperKey));
  await writeFile(
    paperIngestManifestPath(root),
    JSON.stringify({
      schemaVersion: 1,
      updatedAt,
      records,
    } satisfies PersistedPaperIngestManifestFile, null, 2),
    "utf-8",
  );
}

async function loadPagesFromIngestManifestRecord(
  root: string,
  record: PaperIngestManifestRecord,
): Promise<LiteratureWikiPage[]> {
  const pages: LiteratureWikiPage[] = [];
  for (const relativePath of record.pageFiles) {
    const page = await readExistingPage(join(root, relativePath));
    if (page) pages.push(page);
  }
  return pages;
}

function paperIngestManifestPath(root: string): string {
  return join(root, "paper-ingest.manifest.json");
}

async function collectMarkdownFiles(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...await collectMarkdownFiles(path));
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith(".md")) {
      files.push(path);
    }
  }
  return files;
}

function mergeLiteratureWikiPages(existing: LiteratureWikiPage, incoming: LiteratureWikiPage): LiteratureWikiPage {
  if (existing.kind !== incoming.kind || existing.pageKey !== incoming.pageKey) return incoming;
  const base = {
    ...incoming,
    discipline: mergeDisciplines([existing.discipline, incoming.discipline]),
    summary: preferLonger(existing.summary, incoming.summary),
    tags: dedupe([...existing.tags, ...incoming.tags]),
    aliases: dedupe([...existing.aliases, ...incoming.aliases]),
    sourcePaperKeys: dedupe([...existing.sourcePaperKeys, ...incoming.sourcePaperKeys]),
    domainScope: dedupe([...existing.domainScope, ...incoming.domainScope]),
    updatedAt: incoming.updatedAt,
  };

  switch (incoming.kind) {
    case "paper":
      return {
        ...base,
        kind: incoming.kind,
        canonicalPaperKey: incoming.canonicalPaperKey,
        schemaFamily: incoming.schemaFamily,
        selectionReason: preferLonger(existing.kind === "paper" ? existing.selectionReason : "", incoming.selectionReason),
        citationLine: incoming.citationLine ?? (existing.kind === "paper" ? existing.citationLine : null),
        researchProblem: preferLonger(existing.kind === "paper" ? existing.researchProblem : "", incoming.researchProblem),
        approach: preferLonger(existing.kind === "paper" ? existing.approach : "", incoming.approach),
        keyContributions: dedupe([...(existing.kind === "paper" ? existing.keyContributions : []), ...incoming.keyContributions]),
        keyClaims: dedupe([...(existing.kind === "paper" ? existing.keyClaims : []), ...incoming.keyClaims]),
        findings: dedupe([...(existing.kind === "paper" ? existing.findings : []), ...incoming.findings]),
        limitations: dedupe([...(existing.kind === "paper" ? existing.limitations : []), ...incoming.limitations]),
        importantTerms: dedupe([...(existing.kind === "paper" ? existing.importantTerms : []), ...incoming.importantTerms]),
        relatedPageKeys: dedupe([...(existing.kind === "paper" ? existing.relatedPageKeys : []), ...incoming.relatedPageKeys]),
      };
    case "claim": {
      const supportPaperKeys = dedupe([...(existing.kind === "claim" ? existing.supportPaperKeys : []), ...incoming.supportPaperKeys]);
      const contradictPaperKeys = dedupe([...(existing.kind === "claim" ? existing.contradictPaperKeys : []), ...incoming.contradictPaperKeys]);
      const qualifyPaperKeys = dedupe([...(existing.kind === "claim" ? existing.qualifyPaperKeys : []), ...incoming.qualifyPaperKeys]);
      const topicPageKeys = dedupe([...(existing.kind === "claim" ? existing.topicPageKeys : []), ...incoming.topicPageKeys]);
      const contradictions = dedupe([...(existing.kind === "claim" ? existing.contradictions : []), ...incoming.contradictions]);
      const tensions = dedupe([...(existing.kind === "claim" ? existing.tensions : []), ...incoming.tensions]);
      const notes = dedupe([...(existing.kind === "claim" ? existing.notes : []), ...incoming.notes]);
      return {
        ...base,
        kind: incoming.kind,
        claimText: preferLonger(existing.kind === "claim" ? existing.claimText : "", incoming.claimText),
        claimStatus: deriveMergedClaimStatus(
          existing.kind === "claim" ? existing.claimStatus : undefined,
          supportPaperKeys,
          contradictPaperKeys,
          qualifyPaperKeys,
          notes,
        ),
        supportPaperKeys,
        contradictPaperKeys,
        qualifyPaperKeys,
        topicPageKeys,
        contradictions,
        tensions,
        notes,
      };
    }
    case "research_question":
      return {
        ...base,
        kind: incoming.kind,
        question: preferLonger(existing.kind === "research_question" ? existing.question : "", incoming.question),
        motivation: preferLonger(existing.kind === "research_question" ? existing.motivation : "", incoming.motivation),
        currentAnswer: preferLonger(existing.kind === "research_question" ? existing.currentAnswer : "", incoming.currentAnswer),
        relatedTopicKeys: dedupe([...(existing.kind === "research_question" ? existing.relatedTopicKeys : []), ...incoming.relatedTopicKeys]),
        claimPageKeys: dedupe([...(existing.kind === "research_question" ? existing.claimPageKeys : []), ...incoming.claimPageKeys]),
        findingPageKeys: dedupe([...(existing.kind === "research_question" ? existing.findingPageKeys : []), ...incoming.findingPageKeys]),
        methodPageKeys: dedupe([...(existing.kind === "research_question" ? existing.methodPageKeys : []), ...incoming.methodPageKeys]),
        benchmarkKeys: dedupe([...(existing.kind === "research_question" ? existing.benchmarkKeys : []), ...incoming.benchmarkKeys]),
        openSubquestions: dedupe([...(existing.kind === "research_question" ? existing.openSubquestions : []), ...incoming.openSubquestions]),
        relatedPageKeys: dedupe([...(existing.kind === "research_question" ? existing.relatedPageKeys : []), ...incoming.relatedPageKeys]),
      };
    case "benchmark":
      return {
        ...base,
        kind: incoming.kind,
        benchmarkStatement: preferLonger(existing.kind === "benchmark" ? existing.benchmarkStatement : "", incoming.benchmarkStatement),
        evaluates: dedupe([...(existing.kind === "benchmark" ? existing.evaluates : []), ...incoming.evaluates]),
        datasetOrSuite: preferLonger(existing.kind === "benchmark" ? existing.datasetOrSuite : "", incoming.datasetOrSuite),
        metrics: dedupe([...(existing.kind === "benchmark" ? existing.metrics : []), ...incoming.metrics]),
        knownCaveats: dedupe([...(existing.kind === "benchmark" ? existing.knownCaveats : []), ...incoming.knownCaveats]),
        usedByPaperKeys: dedupe([...(existing.kind === "benchmark" ? existing.usedByPaperKeys : []), ...incoming.usedByPaperKeys]),
        relatedMethodKeys: dedupe([...(existing.kind === "benchmark" ? existing.relatedMethodKeys : []), ...incoming.relatedMethodKeys]),
        relatedFindingKeys: dedupe([...(existing.kind === "benchmark" ? existing.relatedFindingKeys : []), ...incoming.relatedFindingKeys]),
        relatedPageKeys: dedupe([...(existing.kind === "benchmark" ? existing.relatedPageKeys : []), ...incoming.relatedPageKeys]),
      };
    case "finding":
      return {
        ...base,
        kind: incoming.kind,
        findingStatement: preferLonger(existing.kind === "finding" ? existing.findingStatement : "", incoming.findingStatement),
        evidenceType: preferLonger(existing.kind === "finding" ? existing.evidenceType : "", incoming.evidenceType),
        supportingPaperKeys: dedupe([...(existing.kind === "finding" ? existing.supportingPaperKeys : []), ...incoming.supportingPaperKeys]),
        relatedMethodKeys: dedupe([...(existing.kind === "finding" ? existing.relatedMethodKeys : []), ...incoming.relatedMethodKeys]),
        relatedBenchmarkKeys: dedupe([...(existing.kind === "finding" ? existing.relatedBenchmarkKeys : []), ...incoming.relatedBenchmarkKeys]),
        supportsClaimKeys: dedupe([...(existing.kind === "finding" ? existing.supportsClaimKeys : []), ...incoming.supportsClaimKeys]),
        qualifiesClaimKeys: dedupe([...(existing.kind === "finding" ? existing.qualifiesClaimKeys : []), ...incoming.qualifiesClaimKeys]),
        contradictsClaimKeys: dedupe([...(existing.kind === "finding" ? existing.contradictsClaimKeys : []), ...incoming.contradictsClaimKeys]),
        caveats: dedupe([...(existing.kind === "finding" ? existing.caveats : []), ...incoming.caveats]),
        relatedPageKeys: dedupe([...(existing.kind === "finding" ? existing.relatedPageKeys : []), ...incoming.relatedPageKeys]),
      };
    case "formal_result":
      return {
        ...base,
        kind: incoming.kind,
        formalResultType: incoming.formalResultType,
        statement: preferLonger(existing.kind === "formal_result" ? existing.statement : "", incoming.statement),
        assumptions: dedupe([...(existing.kind === "formal_result" ? existing.assumptions : []), ...incoming.assumptions]),
        proofIdea: preferLonger(existing.kind === "formal_result" ? existing.proofIdea : "", incoming.proofIdea),
        dependsOnResultKeys: dedupe([...(existing.kind === "formal_result" ? existing.dependsOnResultKeys : []), ...incoming.dependsOnResultKeys]),
        supportsClaimKeys: dedupe([...(existing.kind === "formal_result" ? existing.supportsClaimKeys : []), ...incoming.supportsClaimKeys]),
        relatedMethodKeys: dedupe([...(existing.kind === "formal_result" ? existing.relatedMethodKeys : []), ...incoming.relatedMethodKeys]),
        limitations: dedupe([...(existing.kind === "formal_result" ? existing.limitations : []), ...incoming.limitations]),
        relatedPageKeys: dedupe([...(existing.kind === "formal_result" ? existing.relatedPageKeys : []), ...incoming.relatedPageKeys]),
      };
    case "method":
      return {
        ...base,
        kind: incoming.kind,
        methodStatement: preferLonger(existing.kind === "method" ? existing.methodStatement : "", incoming.methodStatement),
        mechanism: dedupe([...(existing.kind === "method" ? existing.mechanism : []), ...incoming.mechanism]),
        assumptions: dedupe([...(existing.kind === "method" ? existing.assumptions : []), ...incoming.assumptions]),
        inputs: dedupe([...(existing.kind === "method" ? existing.inputs : []), ...incoming.inputs]),
        outputs: dedupe([...(existing.kind === "method" ? existing.outputs : []), ...incoming.outputs]),
        variants: dedupe([...(existing.kind === "method" ? existing.variants : []), ...incoming.variants]),
        baselines: dedupe([...(existing.kind === "method" ? existing.baselines : []), ...incoming.baselines]),
        failureModes: dedupe([...(existing.kind === "method" ? existing.failureModes : []), ...incoming.failureModes]),
        relatedBenchmarkKeys: dedupe([...(existing.kind === "method" ? existing.relatedBenchmarkKeys : []), ...incoming.relatedBenchmarkKeys]),
        relatedFindingKeys: dedupe([...(existing.kind === "method" ? existing.relatedFindingKeys : []), ...incoming.relatedFindingKeys]),
        relatedFormalResultKeys: dedupe([...(existing.kind === "method" ? existing.relatedFormalResultKeys : []), ...incoming.relatedFormalResultKeys]),
        relatedPageKeys: dedupe([...(existing.kind === "method" ? existing.relatedPageKeys : []), ...incoming.relatedPageKeys]),
      };
    case "topic":
      return {
        ...base,
        kind: incoming.kind,
        topicStatement: preferLonger(existing.kind === "topic" ? existing.topicStatement : "", incoming.topicStatement),
        scopeNotes: dedupe([...(existing.kind === "topic" ? existing.scopeNotes : []), ...incoming.scopeNotes]),
        currentThreads: dedupe([...(existing.kind === "topic" ? existing.currentThreads : []), ...incoming.currentThreads]),
        keyPageKeys: dedupe([...(existing.kind === "topic" ? existing.keyPageKeys : []), ...incoming.keyPageKeys]),
        claimPageKeys: dedupe([...(existing.kind === "topic" ? existing.claimPageKeys : []), ...incoming.claimPageKeys]),
        openTensions: dedupe([...(existing.kind === "topic" ? existing.openTensions : []), ...incoming.openTensions]),
        openQuestions: dedupe([...(existing.kind === "topic" ? existing.openQuestions : []), ...incoming.openQuestions]),
      };
    case "synthesis":
      return {
        ...base,
        kind: incoming.kind,
        synthesisStatement: preferLonger(existing.kind === "synthesis" ? existing.synthesisStatement : "", incoming.synthesisStatement),
        integratedTakeaway: preferLonger(existing.kind === "synthesis" ? existing.integratedTakeaway : "", incoming.integratedTakeaway),
        scopeNotes: dedupe([...(existing.kind === "synthesis" ? existing.scopeNotes : []), ...incoming.scopeNotes]),
        stateOfPlay: dedupe([...(existing.kind === "synthesis" ? existing.stateOfPlay : []), ...incoming.stateOfPlay]),
        synthesis: dedupe([...(existing.kind === "synthesis" ? existing.synthesis : []), ...incoming.synthesis]),
        keyPageKeys: dedupe([...(existing.kind === "synthesis" ? existing.keyPageKeys : []), ...incoming.keyPageKeys]),
        claimPageKeys: dedupe([...(existing.kind === "synthesis" ? existing.claimPageKeys : []), ...incoming.claimPageKeys]),
        contradictions: dedupe([...(existing.kind === "synthesis" ? existing.contradictions : []), ...incoming.contradictions]),
        tensions: dedupe([...(existing.kind === "synthesis" ? existing.tensions : []), ...incoming.tensions]),
        openQuestions: dedupe([...(existing.kind === "synthesis" ? existing.openQuestions : []), ...incoming.openQuestions]),
      };
  }
}

function deriveMergedClaimStatus(
  previousStatus: LiteratureWikiClaimPage["claimStatus"] | undefined,
  supportPaperKeys: string[],
  contradictPaperKeys: string[],
  qualifyPaperKeys: string[],
  notes: string[],
): LiteratureWikiClaimPage["claimStatus"] {
  if (contradictPaperKeys.length > 0 && supportPaperKeys.length === 0 && qualifyPaperKeys.length === 0) return "superseded";
  if (contradictPaperKeys.length > 0 && supportPaperKeys.length > 0) return "contested";
  if (qualifyPaperKeys.length > 0 || notes.some((note) => /stale|supersed|revisit|outdated/i.test(note))) return "needs_revisit";
  if (previousStatus === "stale" && supportPaperKeys.length <= 1) return "stale";
  if (supportPaperKeys.length > 0) return "active";
  return previousStatus ?? "provisional";
}

function deriveBatchClaimStatus(
  previousStatus: LiteratureWikiClaimPage["claimStatus"] | undefined,
  supportPaperKeys: string[],
  contradictPaperKeys: string[],
  qualifyPaperKeys: string[],
  notes: string[],
): LiteratureWikiClaimPage["claimStatus"] {
  if (contradictPaperKeys.length > 0 && supportPaperKeys.length === 0) return "superseded";
  if (contradictPaperKeys.length > 0 && supportPaperKeys.length > 0) return "contested";
  if (qualifyPaperKeys.length > 0) return "needs_revisit";
  if (supportPaperKeys.length >= 2) return "active";
  if (supportPaperKeys.length === 1) {
    return previousStatus === "active" ? "active" : "provisional";
  }
  if (notes.some((note) => /stale|supersed|revisit|outdated/i.test(note))) return "needs_revisit";
  return previousStatus ?? "provisional";
}

function preferLonger(left: string, right: string): string {
  return right.length >= left.length ? right : left;
}

export function renderLiteratureWikiIndex(pages: LiteratureWikiPage[]): string {
  const grouped = new Map<string, LiteratureWikiPage[]>();
  const categoryGroups: Array<{
    title: string;
    description: string;
    kinds: Array<{ kind: LiteratureWikiPage["kind"]; title: string }>;
  }> = [
    {
      title: "Entry Points",
      description: "Synthesis and topic pages to read first when orienting to the wiki.",
      kinds: [
        { kind: "synthesis", title: "Syntheses" },
        { kind: "topic", title: "Topics" },
      ],
    },
    {
      title: "Claims And Debates",
      description: "Claim pages and other debate-oriented views that track where evidence supports, qualifies, or contradicts current understanding.",
      kinds: [
        { kind: "research_question", title: "Research Questions" },
        { kind: "claim", title: "Claims" },
        { kind: "finding", title: "Findings" },
        { kind: "formal_result", title: "Formal Results" },
      ],
    },
    {
      title: "Sources",
      description: "Paper pages representing source documents that have been compiled into the wiki.",
      kinds: [
        { kind: "paper", title: "Papers" },
      ],
    },
    {
      title: "Methods And Evaluation",
      description: "Cross-source reference pages for methods, benchmarks, and other reusable evaluation objects.",
      kinds: [
        { kind: "method", title: "Methods" },
        { kind: "benchmark", title: "Benchmarks" },
      ],
    },
  ];

  for (const page of pages) {
    grouped.set(page.kind, [...(grouped.get(page.kind) ?? []), page]);
  }

  const lines = [
    "# Literature Wiki Index",
    "",
    "This index is the content-oriented catalog for the literature wiki. Start here to find relevant pages, then drill into them.",
    "",
    "Suggested reading order: start with `Research Questions`, `Syntheses`, and `Topics`, then drill into `Claims`, `Findings`, `Papers`, `Methods`, and `Benchmarks`.",
    "",
    "## Navigation Layers",
    "",
    "- [[indexes/by-page-kind]]: sub-index entry point for page-kind folders",
    "- [[indexes/by-discipline]]: top-level navigation by discipline",
    "- [[log]]: chronological timeline of ingests and maintenance passes",
    "- [[hot]]: recent-context cache for the newest active threads",
  ];

  for (const group of categoryGroups) {
    const groupItems = group.kinds.flatMap((category) => grouped.get(category.kind) ?? []);
    if (groupItems.length === 0) continue;
    lines.push("", `## ${group.title}`, "", group.description);
    for (const category of group.kinds) {
      const items = (grouped.get(category.kind) ?? [])
        .sort((left, right) => left.title.localeCompare(right.title));
      if (items.length === 0) continue;
      lines.push("", `### ${category.title}`, "");
      for (const page of items) {
        const sourceCount = page.sourcePaperKeys.length;
        const metadata: string[] = [];
        if (page.updatedAt) metadata.push(`updated ${page.updatedAt.slice(0, 10)}`);
        if (sourceCount > 0) metadata.push(`${sourceCount} source${sourceCount === 1 ? "" : "s"}`);
        const metaLine = metadata.length > 0 ? ` (${metadata.join(" | ")})` : "";
        lines.push(`- [[${page.pageKey}]]${metaLine}: ${page.summary}`);
      }
    }
  }

  return `${lines.join("\n")}\n`;
}

async function writeLiteratureWikiSubIndexes(
  root: string,
  pages: LiteratureWikiPage[],
  changedPages: LiteratureWikiPage[],
): Promise<string[]> {
  const written: string[] = [];
  const changedDisciplines = new Set(changedPages.map((page) => page.discipline));
  const changedFolderKeys = new Set(changedPages.map((page) => `${page.discipline}:${page.kind}`));
  for (const discipline of disciplineOrder()) {
    if (!changedDisciplines.has(discipline)) continue;
    const disciplinePages = pages.filter((page) => page.discipline === discipline);
    if (disciplinePages.length === 0) continue;
    for (const kind of pageKindOrder()) {
      if (!changedFolderKeys.has(`${discipline}:${kind}`)) continue;
      const kindPages = disciplinePages.filter((page) => page.kind === kind);
      if (kindPages.length === 0) continue;
      const directory = join(root, literatureWikiPageDirectory(discipline, kind));
      const path = join(directory, "_index.md");
      await mkdir(directory, { recursive: true });
      await writeFile(path, renderLiteratureWikiFolderIndex(discipline, kind, kindPages), "utf-8");
      written.push(path);
    }
  }

  const byPageKindIndexPath = join(root, "indexes", "by-page-kind.md");
  await mkdir(dirname(byPageKindIndexPath), { recursive: true });
  await writeFile(byPageKindIndexPath, renderLiteratureWikiByPageKindIndex(pages), "utf-8");
  written.push(byPageKindIndexPath);

  const disciplineIndexPath = join(root, "indexes", "by-discipline.md");
  await mkdir(dirname(disciplineIndexPath), { recursive: true });
  await writeFile(disciplineIndexPath, renderLiteratureWikiDisciplineIndex(pages), "utf-8");
  written.push(disciplineIndexPath);

  for (const discipline of disciplineOrder()) {
    if (!changedDisciplines.has(discipline)) continue;
    const disciplinePages = pages.filter((page) => page.discipline === discipline);
    if (disciplinePages.length === 0) continue;
    const disciplineDetailPath = join(root, discipline, "_index.md");
    await mkdir(dirname(disciplineDetailPath), { recursive: true });
    await writeFile(disciplineDetailPath, renderLiteratureWikiDisciplineDetailIndex(discipline, disciplinePages), "utf-8");
    written.push(disciplineDetailPath);
  }

  return written;
}

function renderLiteratureWikiFolderIndex(
  discipline: LiteratureDiscipline,
  kind: LiteratureWikiPage["kind"],
  pages: LiteratureWikiPage[],
): string {
  const sortedPages = pages.slice().sort((left, right) => left.title.localeCompare(right.title));
  const title = `${kindLabel(kind)} Index`;
  const lines = [
    "# " + title,
    "",
    `Discipline: \`${discipline}\``,
    "",
    folderIndexDescription(kind),
    "",
    `See also: [[index]], [[${discipline}/_index]], [[indexes/by-page-kind]], [[indexes/by-discipline]]`,
  ];

  lines.push("", "## All Pages", "");
  for (const page of sortedPages) {
    const metadata: string[] = [];
    if (page.updatedAt) metadata.push(`updated ${page.updatedAt.slice(0, 10)}`);
    if (page.sourcePaperKeys.length > 0) metadata.push(`${page.sourcePaperKeys.length} source${page.sourcePaperKeys.length === 1 ? "" : "s"}`);
    const meta = metadata.length > 0 ? ` (${metadata.join(" | ")})` : "";
    lines.push(`- [[${page.pageKey}]]${meta}: ${page.summary}`);
  }

  return `${lines.join("\n")}\n`;
}

function renderLiteratureWikiByPageKindIndex(pages: LiteratureWikiPage[]): string {
  const kinds: Array<LiteratureWikiPage["kind"]> = [
    "paper",
    "research_question",
    "claim",
    "finding",
    "formal_result",
    "topic",
    "synthesis",
    "method",
    "benchmark",
  ];
  const lines = [
    "# By Page Kind",
    "",
    "This index organizes the literature wiki by page kind. Use it when you know what kind of page you want to browse.",
    "",
    "See also: [[index]], [[indexes/by-discipline]]",
  ];

  for (const kind of kinds) {
    const kindPages = pages.filter((page) => page.kind === kind);
    if (kindPages.length === 0) continue;
    lines.push(
      "",
      `## ${kindLabel(kind)}`,
      "",
      `- Page count: ${kindPages.length}`,
      `- Summary: ${folderIndexDescription(kind)}`,
      `- Disciplines: ${dedupe(kindPages.map((page) => page.discipline)).map((value) => `[[${value}/_index]]`).join(", ")}`,
    );
  }

  return `${lines.join("\n")}\n`;
}

function renderLiteratureWikiDisciplineIndex(pages: LiteratureWikiPage[]): string {
  const lines = [
    "# By Discipline",
    "",
    "This index organizes the literature wiki first by discipline, then by page kind.",
    "",
    "See also: [[index]], [[indexes/by-page-kind]]",
  ];

  for (const discipline of disciplineOrder()) {
    const disciplinePages = pages
      .filter((page) => page.discipline === discipline)
      .sort((left, right) => left.title.localeCompare(right.title));
    if (disciplinePages.length === 0) continue;
    lines.push("", `## ${disciplineLabel(discipline)}`, "", `- Detail index: [[${discipline}/_index]]`);
    lines.push("");
    for (const page of disciplinePages) {
      lines.push(`- [[${page.pageKey}]] (\`${page.kind}\`): ${page.summary}`);
    }
  }

  return `${lines.join("\n")}\n`;
}

function renderLiteratureWikiDisciplineDetailIndex(
  discipline: LiteratureDiscipline,
  pages: LiteratureWikiPage[],
): string {
  const grouped = new Map<LiteratureWikiPage["kind"], LiteratureWikiPage[]>();
  for (const page of pages) {
    grouped.set(page.kind, [...(grouped.get(page.kind) ?? []), page]);
  }
  const lines = [
    `# ${disciplineLabel(discipline)}`,
    "",
    "This index groups wiki pages that are associated with the same discipline.",
    "",
    "See also: [[index]], [[indexes/by-discipline]], [[indexes/by-page-kind]]",
  ];

  for (const kind of [
    "paper",
    "research_question",
    "claim",
    "finding",
    "formal_result",
    "topic",
    "synthesis",
    "method",
    "benchmark",
  ] satisfies Array<LiteratureWikiPage["kind"]>) {
    const kindPages = (grouped.get(kind) ?? []).sort((left, right) => left.title.localeCompare(right.title));
    if (kindPages.length === 0) continue;
    lines.push("", `## ${kindLabel(kind)}`, "");
    for (const page of kindPages) {
      lines.push(`- [[${page.pageKey}]]: ${page.summary}`);
    }
  }

  return `${lines.join("\n")}\n`;
}

function renderLiteratureWikiLogEntry(
  digest: PaperDigest,
  plan: PaperIngestPlan,
  writtenPages: LiteratureWikiPage[],
): string {
  const now = new Date().toISOString();
  const dateLabel = now.slice(0, 10);
  const affectedPageKeys = dedupe([
    ...writtenPages.map((page) => page.pageKey),
  ]);
  const changes = dedupe([
    ...plan.pageUpdates.map((item) => `${item.action} ${item.pageKind}:${item.pageKey}`),
    ...plan.claimUpdates.map((item) => `${item.action} claim:${item.claimKey} (${item.effect})`),
    ...plan.topicUpdates.map((item) => `${item.action} topic:${item.topicKey}`),
    "update index:index",
  ]);
  const lines = [
    `## [${dateLabel}] ingest | ${digest.title}`,
    "",
    `- Canonical paper: [[${digest.canonicalPaperKey}]]`,
    `- Paper page: [[${plan.paperKey}]]`,
    `- Summary: ${plan.summary}`,
    `- Affected pages: ${affectedPageKeys.map((key) => `[[${key}]]`).join(", ")}`,
    "",
    "### Changes",
    ...changes.map((item) => `- ${item}`),
  ];
  if (plan.logEntry.notes.length > 0) {
    lines.push("", "### Notes", ...plan.logEntry.notes.map((item) => `- ${item}`));
  }
  return `\n${lines.join("\n")}\n`;
}

function renderLiteratureWikiHotCache(
  digest: PaperDigest,
  plan: PaperIngestPlan,
  pages: LiteratureWikiPage[],
): string {
  const now = new Date().toISOString();
  const keyClaims = plan.claimUpdates.slice(0, 4).map((item) => item.claimText);
  const activeTopics = plan.topicUpdates.slice(0, 4).map((item) => item.title);
  const synthesisPages = pages.filter((page): page is LiteratureWikiSynthesisPage => page.kind === "synthesis");
  const createdOrUpdated = dedupe([
    plan.paperKey,
    ...plan.pageUpdates.map((item) => item.pageKey),
    ...plan.claimUpdates.map((item) => item.claimKey),
    ...plan.topicUpdates.map((item) => item.topicKey),
  ]).slice(0, 12);

  const lines = [
    "---",
    'type: "meta"',
    'title: "Hot Cache"',
    `updated: "${now}"`,
    "---",
    "",
    "# Recent Context",
    "",
    "## Last Updated",
    `${now.slice(0, 10)} - Ingested or updated knowledge from ${digest.title}`,
  ];

  if (keyClaims.length > 0) {
    lines.push("", "## Key Recent Facts", ...keyClaims.map((item) => `- ${item}`));
  }

  lines.push(
    "",
    "## Recent Changes",
    `- Paper: [[${plan.paperKey}]]`,
    `- Updated pages: ${createdOrUpdated.map((key) => `[[${key}]]`).join(", ")}`,
  );

  if (activeTopics.length > 0 || synthesisPages.length > 0) {
    lines.push("", "## Active Threads");
    for (const topic of activeTopics) lines.push(`- Topic in motion: ${topic}`);
    for (const page of synthesisPages.slice(0, 3)) lines.push(`- Active synthesis: [[${page.pageKey}]]`);
  }

  if (digest.uncertainty.length > 0) {
    lines.push("", "## Open Questions", ...digest.uncertainty.slice(0, 5).map((item) => `- ${item}`));
  }

  return `${lines.join("\n")}\n`;
}

function renderLiteratureWikiBatchLogEntry(
  prepared: PreparedPaperIngest[],
  crossReference: BatchCrossReferenceResult,
): string {
  const now = new Date().toISOString();
  const dateLabel = now.slice(0, 10);
  const paperTitles = prepared.map((item) => item.digest.title).filter(Boolean);
  const affectedPageKeys = dedupe([
    ...prepared.flatMap((item) => item.pages.map((page) => page.pageKey)),
    ...crossReference.pages.map((page) => page.pageKey),
  ]);
  const createdOrUpdated = dedupe([
    ...prepared.flatMap((item) => item.plan.pageUpdates.map((update) => `${update.action} ${update.pageKind}:${update.pageKey}`)),
    ...prepared.flatMap((item) => item.plan.claimUpdates.map((claim) => `${claim.action} claim:${claim.claimKey} (${claim.effect})`)),
    ...prepared.flatMap((item) => item.plan.topicUpdates.map((topic) => `${topic.action} topic:${topic.topicKey}`)),
    ...crossReference.pages.map((page) => `cross-reference ${page.kind}:${page.pageKey}`),
    "update index:index",
    "update hot:hot",
  ]);
  const lines = [
    `## [${dateLabel}] ingest-batch | ${prepared.length} paper${prepared.length === 1 ? "" : "s"}`,
    "",
    `- Papers: ${paperTitles.map((title) => `[[${title}]]`).join(", ")}`,
    `- Canonical papers: ${prepared.map((item) => `[[${item.digest.canonicalPaperKey}]]`).join(", ")}`,
    `- Affected pages: ${affectedPageKeys.map((key) => `[[${key}]]`).join(", ")}`,
    "",
    "### Batch Summary",
    ...prepared.map((item) => `- ${item.plan.paperTitle}: ${item.plan.summary}`),
  ];
  if (crossReference.notes.length > 0) {
    lines.push("", "### Cross-Reference Pass", ...crossReference.notes.map((note) => `- ${note}`));
  }
  lines.push("", "### Changes", ...createdOrUpdated.map((item) => `- ${item}`));
  return `\n${lines.join("\n")}\n`;
}

function renderLiteratureWikiBatchHotCache(
  prepared: PreparedPaperIngest[],
  pages: LiteratureWikiPage[],
  crossReference: BatchCrossReferenceResult,
): string {
  const now = new Date().toISOString();
  const recentFacts = dedupe(prepared.flatMap((item) => item.plan.claimUpdates.map((claim) => claim.claimText))).slice(0, 6);
  const updatedPageKeys = dedupe([
    ...prepared.flatMap((item) => [item.plan.paperKey, ...item.plan.pageUpdates.map((update) => update.pageKey), ...item.plan.claimUpdates.map((claim) => claim.claimKey), ...item.plan.topicUpdates.map((topic) => topic.topicKey)]),
  ]).slice(0, 16);
  const activeTopics = dedupe(prepared.flatMap((item) => item.plan.topicUpdates.map((topic) => topic.title))).slice(0, 6);
  const synthesisPages = pages.filter((page): page is LiteratureWikiSynthesisPage => page.kind === "synthesis").slice(0, 4);
  const openQuestions = dedupe(prepared.flatMap((item) => item.digest.uncertainty)).slice(0, 6);

  const lines = [
    "---",
    'type: "meta"',
    'title: "Hot Cache"',
    `updated: "${now}"`,
    "---",
    "",
    "# Recent Context",
    "",
    "## Last Updated",
    `${now.slice(0, 10)} - Batch-ingested ${prepared.length} paper${prepared.length === 1 ? "" : "s"} into the literature wiki`,
  ];

  if (recentFacts.length > 0) {
    lines.push("", "## Key Recent Facts", ...recentFacts.map((item) => `- ${item}`));
  }

  lines.push(
    "",
    "## Recent Changes",
    `- Papers: ${prepared.map((item) => `[[${item.plan.paperKey}]]`).join(", ")}`,
    `- Updated pages: ${updatedPageKeys.map((key) => `[[${key}]]`).join(", ")}`,
  );

  if (activeTopics.length > 0 || synthesisPages.length > 0) {
    lines.push("", "## Active Threads");
    for (const topic of activeTopics) lines.push(`- Topic in motion: ${topic}`);
    for (const page of synthesisPages) lines.push(`- Active synthesis: [[${page.pageKey}]]`);
  }

  if (crossReference.notes.length > 0) {
    lines.push("", "## Cross-Reference Pass", ...crossReference.notes.slice(0, 6).map((note) => `- ${note}`));
  }

  if (openQuestions.length > 0) {
    lines.push("", "## Open Questions", ...openQuestions.map((item) => `- ${item}`));
  }

  return `${lines.join("\n")}\n`;
}

async function writeDisciplineHotCaches(
  wikiRoot: string,
  prepared: PreparedPaperIngest[],
  pages: LiteratureWikiPage[],
  crossReference: BatchCrossReferenceResult,
): Promise<string[]> {
  const written: string[] = [];
  for (const discipline of disciplineOrder()) {
    const disciplinePrepared = prepared.filter((item) => item.digest.discipline === discipline);
    if (disciplinePrepared.length === 0) continue;
    const disciplinePages = pages.filter((page) => page.discipline === discipline);
    const path = join(wikiRoot, discipline, "hot.md");
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, renderDisciplineLiteratureWikiHotCache(discipline, disciplinePrepared, disciplinePages, crossReference), "utf-8");
    written.push(path);
  }
  return written;
}

function renderDisciplineLiteratureWikiHotCache(
  discipline: LiteratureDiscipline,
  prepared: PreparedPaperIngest[],
  pages: LiteratureWikiPage[],
  crossReference: BatchCrossReferenceResult,
): string {
  const now = new Date().toISOString();
  const recentFacts = dedupe(prepared.flatMap((item) => item.plan.claimUpdates.map((claim) => claim.claimText))).slice(0, 6);
  const updatedPageKeys = dedupe([
    ...prepared.flatMap((item) => [
      item.plan.paperKey,
      ...item.plan.pageUpdates.map((update) => update.pageKey),
      ...item.plan.claimUpdates.map((claim) => claim.claimKey),
      ...item.plan.topicUpdates.map((topic) => topic.topicKey),
    ]),
  ]).slice(0, 16);
  const activeTopics = dedupe(prepared.flatMap((item) => item.plan.topicUpdates.map((topic) => topic.title))).slice(0, 6);
  const synthesisPages = pages.filter((page): page is LiteratureWikiSynthesisPage => page.kind === "synthesis").slice(0, 4);
  const openQuestions = dedupe(prepared.flatMap((item) => item.digest.uncertainty)).slice(0, 6);
  const disciplinePageKeys = new Set(updatedPageKeys);
  const disciplineCrossReferenceNotes = crossReference.notes
    .filter((note) => [...disciplinePageKeys].some((pageKey) => note.includes(`[[${pageKey}]]`)))
    .slice(0, 6);

  const lines = [
    "---",
    'type: "meta"',
    `title: "${disciplineLabel(discipline)} Hot Cache"`,
    `updated: "${now}"`,
    `discipline: "${discipline}"`,
    "---",
    "",
    `# ${disciplineLabel(discipline)} Recent Context`,
    "",
    "## Last Updated",
    `${now.slice(0, 10)} - Updated ${disciplineLabel(discipline).toLowerCase()} knowledge from ${prepared.length} paper${prepared.length === 1 ? "" : "s"}`,
  ];

  if (recentFacts.length > 0) {
    lines.push("", "## Key Recent Facts", ...recentFacts.map((item) => `- ${item}`));
  }

  lines.push(
    "",
    "## Recent Changes",
    `- Papers: ${prepared.map((item) => `[[${item.plan.paperKey}]]`).join(", ")}`,
    `- Updated pages: ${updatedPageKeys.map((key) => `[[${key}]]`).join(", ")}`,
  );

  if (activeTopics.length > 0 || synthesisPages.length > 0) {
    lines.push("", "## Active Threads");
    for (const topic of activeTopics) lines.push(`- Topic in motion: ${topic}`);
    for (const page of synthesisPages) lines.push(`- Active synthesis: [[${page.pageKey}]]`);
  }

  if (disciplineCrossReferenceNotes.length > 0) {
    lines.push("", "## Cross-Reference Pass", ...disciplineCrossReferenceNotes.map((note) => `- ${note}`));
  }

  if (openQuestions.length > 0) {
    lines.push("", "## Open Questions", ...openQuestions.map((item) => `- ${item}`));
  }

  return `${lines.join("\n")}\n`;
}

function normalizeEnum<T extends string>(value: string, allowed: readonly T[], fallback: T): T {
  return allowed.includes(value as T) ? value as T : fallback;
}

function kindLabelFromIngestPageKind(kind: PaperIngestWikiPageKind): string {
  switch (kind) {
    case "paper":
      return "Papers";
    case "research_question":
      return "Research Questions";
    case "method":
      return "Methods";
    case "benchmark":
      return "Benchmarks";
    case "finding":
      return "Findings";
    case "formal_result":
      return "Formal Results";
    case "claim":
      return "Claims";
    case "topic":
      return "Topics";
    case "synthesis":
      return "Syntheses";
  }
}

function kindLabel(kind: LiteratureWikiPage["kind"]): string {
  switch (kind) {
    case "paper":
      return "Papers";
    case "research_question":
      return "Research Questions";
    case "method":
      return "Methods";
    case "benchmark":
      return "Benchmarks";
    case "finding":
      return "Findings";
    case "formal_result":
      return "Formal Results";
    case "claim":
      return "Claims";
    case "topic":
      return "Topics";
    case "synthesis":
      return "Syntheses";
  }
}

function pageKindOrder(): Array<LiteratureWikiPage["kind"]> {
  return [
    "paper",
    "research_question",
    "claim",
    "finding",
    "formal_result",
    "topic",
    "synthesis",
    "method",
    "benchmark",
  ];
}

function folderIndexDescription(kind: LiteratureWikiPage["kind"]): string {
  switch (kind) {
    case "paper":
      return "Paper pages are the source anchors of the wiki. Each page captures one ingested paper and links outward to the claims, topics, and syntheses it affects.";
    case "research_question":
      return "Research question pages track explicit questions the literature is trying to answer, along with related papers, claims, findings, and open subquestions.";
    case "claim":
      return "Claim pages track debate positions, propositions, and judgments that can be supported, contradicted, or qualified by evidence.";
    case "finding":
      return "Finding pages track empirical, observational, or reported scientific findings grounded in source evidence.";
    case "formal_result":
      return "Formal result pages track theorems, lemmas, corollaries, propositions, bounds, guarantees, and conjectures.";
    case "topic":
      return "Topic pages organize areas of inquiry: scope, recurring threads, and open questions.";
    case "benchmark":
      return "Benchmark pages track datasets, benchmark suites, challenge sets, standardized evaluation resources, and their caveats.";
    case "synthesis":
      return "Synthesis pages maintain cross-paper integrated views, comparisons, and evolving takeaways.";
    default:
      return `${kindLabel(kind)} pages are cross-source reference pages maintained by the literature wiki.`;
  }
}

function disciplineOrder(): LiteratureDiscipline[] {
  return [
    "artificial_intelligence",
    "mathematics",
    "chemistry",
    "chemical_engineering",
    "physics",
    "general_science",
    "unknown",
  ];
}

function disciplineLabel(value: LiteratureDiscipline): string {
  switch (value) {
    case "artificial_intelligence":
      return "Artificial Intelligence";
    case "mathematics":
      return "Mathematics";
    case "chemistry":
      return "Chemistry";
    case "chemical_engineering":
      return "Chemical Engineering";
    case "physics":
      return "Physics";
    case "general_science":
      return "General Science";
    case "unknown":
      return "Unknown";
  }
  return "Unknown";
}

function inferPaperDomainScope(digest: PaperDigest): string[] {
  return dedupe([
    ...digest.importantTerms.slice(0, 8).map((item) => slug(item)),
    ...digest.literatureReviewUse.searchTerms.slice(0, 4).map((item) => slug(item)),
  ]);
}

function mergeDisciplines(values: LiteratureDiscipline[]): LiteratureDiscipline {
  const distinct = dedupe(values.filter(Boolean));
  if (distinct.length === 1) return distinct[0] as LiteratureDiscipline;
  if (distinct.length > 1) return "general_science";
  return "unknown";
}

function dedupe(items: string[]): string[] {
  return [...new Set(items.map((item) => item.trim()).filter(Boolean))];
}

function slug(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "item";
}

function containsLoose(haystack: string, needle: string): boolean {
  const left = haystack.trim().toLowerCase();
  const right = needle.trim().toLowerCase();
  return Boolean(left && right) && (left.includes(right) || right.includes(left));
}

function isClaimRelatedToTopic(
  claim: PaperIngestPlan["claimUpdates"][number],
  topic: PaperIngestPlan["topicUpdates"][number],
): boolean {
  const topicText = [
    topic.topicKey,
    topic.title,
    topic.rationale,
    ...topic.topicThreads,
  ].join(" ");
  const claimText = [
    claim.claimKey,
    claim.claimText,
    claim.rationale,
    ...claim.evidenceNotes,
  ].join(" ");
  if (hasExplicitKeyReference(topicText, claim.claimKey) || hasExplicitKeyReference(claimText, topic.topicKey)) return true;
  if (containsLoose(topicText, claim.claimText)) return true;

  const topicTokens = significantTokens(topicText);
  const claimTokens = significantTokens(claimText);
  const shared = claimTokens.filter((token) => topicTokens.includes(token));
  return shared.length >= 2;
}

function hasExplicitKeyReference(text: string, key: string): boolean {
  const normalizedKey = key.trim().toLowerCase();
  if (normalizedKey.length < 4) return false;
  return containsLoose(text, normalizedKey);
}

function significantTokens(value: string): string[] {
  const stopWords = new Set([
    "about",
    "after",
    "also",
    "between",
    "claim",
    "could",
    "from",
    "into",
    "literature",
    "method",
    "paper",
    "result",
    "results",
    "should",
    "study",
    "that",
    "their",
    "there",
    "these",
    "this",
    "topic",
    "using",
    "when",
    "where",
    "which",
    "with",
  ]);
  return dedupe(
    value
      .toLowerCase()
      .split(/[^a-z0-9_]+/u)
      .map((token) => token.trim())
      .filter((token) => token.length >= 4 && !stopWords.has(token)),
  );
}

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : String(value ?? "").trim();
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map(asString).filter(Boolean);
}

function asObjectArray(value: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) return [];
  return value.filter(isRecord);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function safeStepId(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 80) || "ingest_plan";
}

function renderPaperDigestForIngestPrompt(digest: PaperDigest): string {
  const lines = [
    `paper_key: ${digest.canonicalPaperKey}`,
    `paper_title: ${digest.title}`,
    `schema_family: ${digest.schemaFamily}`,
    `schema_family_reason: ${digest.selectionReason}`,
    `one_sentence_summary: ${digest.oneSentenceSummary}`,
    `research_problem: ${digest.researchProblem}`,
    `motivation: ${digest.motivation}`,
    `approach: ${digest.approach}`,
  ];
  if (digest.keyContributions.length) lines.push(`key_contributions: ${digest.keyContributions.join("; ")}`);
  if (digest.keyClaims.length) lines.push(`key_claims: ${digest.keyClaims.join("; ")}`);
  if (digest.findings.length) lines.push(`findings: ${digest.findings.join("; ")}`);
  if (digest.limitations.length) lines.push(`limitations: ${digest.limitations.join("; ")}`);
  if (digest.importantTerms.length) lines.push(`important_terms: ${digest.importantTerms.join(", ")}`);
  if (digest.relatedWorkSignals.namedPriorWork.length) lines.push(`named_prior_work: ${digest.relatedWorkSignals.namedPriorWork.join("; ")}`);
  if (digest.relatedWorkSignals.competingApproaches.length) lines.push(`competing_approaches: ${digest.relatedWorkSignals.competingApproaches.join("; ")}`);
  if (digest.relatedWorkSignals.followUpDirections.length) lines.push(`follow_up_directions: ${digest.relatedWorkSignals.followUpDirections.join("; ")}`);
  if (digest.relatedWorkSignals.applicationAreas.length) lines.push(`application_areas: ${digest.relatedWorkSignals.applicationAreas.join("; ")}`);
  if (digest.literatureReviewUse.searchTerms.length) lines.push(`search_terms: ${digest.literatureReviewUse.searchTerms.join(", ")}`);
  if (digest.literatureReviewUse.expansionDirections.length) lines.push(`expansion_directions: ${digest.literatureReviewUse.expansionDirections.join("; ")}`);
  if (digest.uncertainty.length) lines.push(`uncertainty: ${digest.uncertainty.join("; ")}`);
  return lines.join("\n");
}
