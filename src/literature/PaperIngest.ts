import { appendFile, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  parseStructuredOutput,
  repairInstruction,
  salvageStructuredOutput,
  type StructuredSchema,
} from "../structured/StructuredOutput.js";
import type { LiteratureDiscipline, PaperDigest, PaperDigestSchemaFamily } from "./PaperDigest.js";
import {
  buildLiteratureWikiOverviewPage,
  literatureWikiPageDirectory,
  literatureWikiPagePath,
  parseLiteratureWikiPageMarkdown,
  renderLiteratureWikiPageMarkdown,
  type LiteratureWikiClaimPage,
  type LiteratureWikiEntityPage,
  type LiteratureWikiOverviewPage,
  type LiteratureWikiPage,
  type LiteratureWikiPaperPage,
  type LiteratureWikiSynthesisPage,
  type LiteratureWikiTopicPage,
} from "./LiteratureWikiPage.js";
import { WikiRetrieve, type WikiRetrieveMode, type WikiRetrievePage } from "./WikiRetrieve.js";

export type PaperIngestWikiPageKind =
  | "paper"
  | "author"
  | "concept"
  | "method"
  | "task"
  | "evidence_source"
  | "evaluation_setup"
  | "measure"
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

export interface PaperIngestAuthorUpdate {
  authorKey: string;
  authorName: string;
  action: "create" | "update";
  rationale: string;
  updates: string[];
}

export interface PaperIngestLogEntry {
  title: string;
  summary: string;
  affectedPageKeys: string[];
  notes: string[];
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
  authorUpdates: PaperIngestAuthorUpdate[];
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
      pageKind: "paper | author | concept | method | task | evidence_source | evaluation_setup | measure | claim | topic | synthesis",
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
  authorUpdates: [
    {
      authorKey: "string",
      authorName: "string",
      action: "create | update",
      rationale: "string",
      updates: ["string"],
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
  existingPageHints?: Array<{ pageKind: PaperIngestWikiPageKind; pageKey: string; title: string }>;
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
    "- page kinds are cross-disciplinary and may include paper, author, concept, method, task, evidence_source, evaluation_setup, measure, claim, topic, and synthesis",
    "- create or update a paper page for this source",
    "- update concepts, methods, tasks, evidence sources, evaluation setups, measures, claims, and topics only when the digest clearly supports doing so",
    "- claim pages should capture support, contradiction, qualification, or organization of existing debates",
    "- topic pages should organize the problem area, scope, active threads, and open questions for that topic",
    "- synthesis pages should capture cross-source comparisons, evolving judgments, or broader integrated takeaways",
    "- log.md is maintained separately as the global chronological record; do not plan separate log pages",
    "- author pages should be updated only when the paper materially changes the author's visible profile in the wiki",
    "- do not invent pages that the digest does not justify",
    "",
    "Claim / topic / synthesis disambiguation:",
    "- claim: use this when the update is a proposition, judgment, or debate position that can be supported, contradicted, or qualified by papers",
    "- topic: use this when the update is about organizing an area of inquiry, its scope, recurring subthreads, and open questions",
    "- synthesis: use this when the update integrates multiple papers, compares approaches, summarizes a debate state, or records a higher-order takeaway worth maintaining over time",
    "- do not create a claim page for a generic theme label",
    "- do not use a topic page as a substitute for a synthesis page",
    "- do not create a synthesis page merely because a topic exists; create one only when the digest justifies a real integrated view",
    "- if the paper only adds one more example or detail to an existing topic, prefer updating the topic page over creating a new synthesis page",
    "- if the paper materially changes the state of an existing debate, prefer updating or creating claim pages and, when needed, one synthesis page that explains the new integrated picture",
    "",
    "Prioritization guidance:",
    "- every plan should include one primary paper page update",
    "- include a small number of high-value secondary updates instead of many weak ones",
    "- a single paper commonly affects around 5 to 15 pages, but prefer precision over page count",
    "",
    "Output requirements:",
    "- pageKey, claimKey, topicKey, and authorKey should be stable slug-like identifiers",
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
  hints: Array<{ pageKind: PaperIngestWikiPageKind; pageKey: string; title: string }>,
): string {
  if (hints.length === 0) return "No existing page hints were provided.";

  const orderedKinds: PaperIngestWikiPageKind[] = [
    "claim",
    "topic",
    "synthesis",
    "paper",
    "concept",
    "method",
    "task",
    "author",
    "evidence_source",
    "evaluation_setup",
    "measure",
  ];

  const lines: string[] = [];
  for (const kind of orderedKinds) {
    const group = hints
      .filter((item) => item.pageKind === kind)
      .sort((left, right) => left.title.localeCompare(right.title));
    if (group.length === 0) continue;
    lines.push(`## ${kindLabelFromIngestPageKind(kind)}`, "");
    for (const item of group) {
      lines.push(`- ${item.pageKey} (${item.title})`);
    }
    lines.push("");
  }

  return lines.join("\n").trim();
}

export interface PaperIngestPlanRequest {
  digest: PaperDigest;
  discipline?: LiteratureDiscipline;
  wikiRoot?: string;
  existingPageHints?: Array<{ pageKind: PaperIngestWikiPageKind; pageKey: string; title: string }>;
}

export interface PaperIngestRequest extends PaperIngestPlanRequest {
  wikiRoot: string;
}

export interface PaperIngestPlannerModelStepOptions {
  stepId?: string;
  system?: string;
  prompt: string;
  includeRenderedContext?: boolean;
  stream?: boolean;
  stageUserInputPolicy?: string | string[] | false;
}

export type PaperIngestPlannerModelStepRunner = (
  options: PaperIngestPlannerModelStepOptions,
) => Promise<string>;

export interface PaperIngestMaterializationResult {
  pages: LiteratureWikiPage[];
  skippedUpdates: Array<{ pageKind: string; pageKey: string; title: string; reason: string }>;
  overviewPage?: LiteratureWikiOverviewPage;
}

export interface PaperIngestWriteResult extends PaperIngestMaterializationResult {
  writtenFiles: string[];
  indexPath?: string;
  logPath?: string;
  hotPath?: string;
  disciplineHotPaths?: string[];
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
  completed: PreparedPaperIngest[];
  failures: Array<{ digest: PaperDigest; error: string }>;
  writtenFiles: string[];
  indexPath?: string;
  logPath?: string;
  hotPath?: string;
  disciplineHotPaths?: string[];
  overviewPage?: LiteratureWikiOverviewPage;
  pages: LiteratureWikiPage[];
  skippedUpdates: Array<{ pageKind: string; pageKey: string; title: string; reason: string }>;
}

export class PaperIngest {
  constructor(
    private readonly modelStep?: PaperIngestPlannerModelStepRunner,
    private readonly wikiRetrieve?: WikiRetrieve,
  ) {}

  async plan(input: PaperIngestPlanRequest): Promise<PaperIngestPlan> {
    if (!this.modelStep) {
      throw new Error("PaperIngest.plan requires a configured model step.");
    }
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
      return parseOrRepairPaperIngestPlan(raw, (options) => this.modelStep!({
        ...options,
        stageUserInputPolicy: false,
      }));
  }

  private async retrieveExistingPageHints(
    input: PaperIngestPlanRequest,
  ): Promise<Array<{ pageKind: PaperIngestWikiPageKind; pageKey: string; title: string }>> {
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

    return dedupeByKey(
      [...retrieved.primaryPages, ...retrieved.expandedPages]
        .filter((page): page is WikiRetrievePage & { kind: PaperIngestWikiPageKind } => page.kind !== "overview")
        .map((page) => ({
          pageKind: page.kind,
          pageKey: page.pageKey,
          title: page.title,
        })),
      (item) => `${item.pageKind}:${item.pageKey}`,
    ).slice(0, 12);
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
      const entityPage = buildEntityPage(digest, plan, update, now, discipline);
      if (entityPage) pages.push(entityPage);
    }
    for (const topic of plan.topicUpdates) pages.push(buildTopicPage(digest, plan, topic, now, discipline));
    for (const synthesis of buildSynthesisPages(digest, plan, now, discipline)) pages.push(synthesis);

    for (const update of plan.pageUpdates) {
      if (
        update.pageKind === "paper"
        || update.pageKind === "author"
        || update.pageKind === "concept"
        || update.pageKind === "method"
        || update.pageKind === "task"
        || update.pageKind === "evidence_source"
        || update.pageKind === "evaluation_setup"
        || update.pageKind === "measure"
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

  async prepare(input: PaperIngestRequest): Promise<PreparedPaperIngest> {
    const plan = await this.plan(input);
    return {
      digest: input.digest,
      plan,
      usedExplicitPageHints: Boolean(input.existingPageHints && input.existingPageHints.length > 0),
      ...this.materialize({ digest: input.digest, plan, discipline: input.discipline }),
    };
  }

  async crossReferenceBatch(prepared: PreparedPaperIngest[], wikiRoot: string): Promise<BatchCrossReferenceResult> {
    const now = new Date().toISOString();
    const pages: LiteratureWikiPage[] = [];
    const notes: string[] = [];
    const retrievedHistoricalPages = await this.retrieveCrossReferencePages(prepared, wikiRoot);
    const historicalTopicsByKey = new Map<string, LiteratureWikiTopicPage[]>();
    const historicalClaimsByKey = new Map<string, LiteratureWikiClaimPage[]>();
    for (const page of retrievedHistoricalPages) {
      if (page.kind === "topic") {
        historicalTopicsByKey.set(page.pageKey, [...(historicalTopicsByKey.get(page.pageKey) ?? []), page]);
      } else if (page.kind === "claim") {
        historicalClaimsByKey.set(page.pageKey, [...(historicalClaimsByKey.get(page.pageKey) ?? []), page]);
      }
    }

    const topicGroups = new Map<string, LiteratureWikiTopicPage[]>();
    const claimGroups = new Map<string, LiteratureWikiClaimPage[]>();
    for (const page of prepared.flatMap((item) => item.pages)) {
      if (page.kind === "topic") {
        topicGroups.set(page.pageKey, [...(topicGroups.get(page.pageKey) ?? []), page]);
      } else if (page.kind === "claim") {
        claimGroups.set(page.pageKey, [...(claimGroups.get(page.pageKey) ?? []), page]);
      }
    }

    for (const [topicKey, topicPages] of topicGroups) {
      const historicalTopicPages = historicalTopicsByKey.get(topicKey) ?? [];
      const allTopicPages = [...topicPages, ...historicalTopicPages];
      const batchSourcePaperKeys = dedupe(topicPages.flatMap((page) => page.sourcePaperKeys));
      const sourcePaperKeys = dedupe(allTopicPages.flatMap((page) => page.sourcePaperKeys));
      if (batchSourcePaperKeys.length < 2 && historicalTopicPages.length === 0) continue;
      const representative = topicPages[0]!;
      const combinedThreads = dedupe(allTopicPages.flatMap((page) => page.currentThreads));
      const combinedClaimPageKeys = dedupe(allTopicPages.flatMap((page) => page.claimPageKeys));
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
          `Batch cross-reference: ${batchSourcePaperKeys.length} papers in the current batch now contribute to this topic thread.`,
        ]),
        keyPageKeys: dedupe(allTopicPages.flatMap((page) => page.keyPageKeys)),
        claimPageKeys: combinedClaimPageKeys,
        openTensions: dedupe([
          ...allTopicPages.flatMap((page) => page.openTensions),
          sourcePaperKeys.length >= 2
            ? `This topic is now informed by ${sourcePaperKeys.length} papers, so disagreements and boundary conditions should remain visible.`
            : "",
        ]),
        openQuestions: dedupe(allTopicPages.flatMap((page) => page.openQuestions)),
      };
      pages.push(mergedTopic);

      const shouldCreateSynthesis =
        sourcePaperKeys.length >= 3
        || combinedClaimPageKeys.length >= 2
        || combinedThreads.length >= 4;

      if (shouldCreateSynthesis) {
        const synthesisPageKey = `synthesis_${topicKey}`;
        const synthesisPage: LiteratureWikiSynthesisPage = {
          schemaVersion: "kaivu-literature-wiki-page-v1",
          discipline: mergeDisciplines(allTopicPages.map((page) => page.discipline)),
          kind: "synthesis",
          pageKey: synthesisPageKey,
          title: `Synthesis: ${representative.title}`,
          summary: `Cross-paper synthesis for ${representative.title}.`,
          tags: dedupe(["synthesis", "literature", "batch"]),
          aliases: [],
          sourcePaperKeys,
          updatedAt: now,
          domainScope: dedupe(allTopicPages.flatMap((page) => page.domainScope)),
          synthesisStatement: `This synthesis integrates the current batch-level picture for ${representative.title}.`,
          integratedTakeaway: `${sourcePaperKeys.length} papers in the current batch converge on [[${topicKey}]] strongly enough to maintain an explicit synthesis page.`,
          scopeNotes: dedupe(allTopicPages.flatMap((page) => page.scopeNotes)).slice(0, 6),
          stateOfPlay: combinedThreads.slice(0, 6),
          synthesis: dedupe([
            `Shared topic: [[${topicKey}]]`,
            ...sourcePaperKeys.map((key) => `Paper in view: [[${key}]]`),
          ]),
          keyPageKeys: dedupe([topicKey, ...allTopicPages.flatMap((page) => page.keyPageKeys)]),
          claimPageKeys: combinedClaimPageKeys,
          contradictions: collectSynthesisContradictionsFromClaimKeys(combinedClaimPageKeys),
          tensions: collectSynthesisTensionsFromTopicPages(allTopicPages),
          openQuestions: dedupe(allTopicPages.flatMap((page) => page.openQuestions)),
        };
        pages.push(synthesisPage);
        notes.push(`Cross-referenced topic [[${topicKey}]] across ${sourcePaperKeys.length} papers${historicalTopicPages.length > 0 ? " with retrieved historical context" : ""} and generated [[${synthesisPageKey}]].`);
      } else {
        notes.push(`Cross-referenced topic [[${topicKey}]] across ${sourcePaperKeys.length} papers${historicalTopicPages.length > 0 ? " with retrieved historical context" : ""} without generating a synthesis page because the integrated view is still too thin.`);
      }
    }

    for (const [claimKey, claimPages] of claimGroups) {
      const historicalClaimPages = historicalClaimsByKey.get(claimKey) ?? [];
      const allClaimPages = [...claimPages, ...historicalClaimPages];
      const batchSourcePaperKeys = dedupe(claimPages.flatMap((page) => page.sourcePaperKeys));
      const sourcePaperKeys = dedupe(allClaimPages.flatMap((page) => page.sourcePaperKeys));
      if (batchSourcePaperKeys.length < 2 && historicalClaimPages.length === 0) continue;
      const supportPaperKeys = dedupe(allClaimPages.flatMap((page) => page.supportPaperKeys));
      const contradictPaperKeys = dedupe(allClaimPages.flatMap((page) => page.contradictPaperKeys));
      const qualifyPaperKeys = dedupe(allClaimPages.flatMap((page) => page.qualifyPaperKeys));
      const topicPageKeys = dedupe(allClaimPages.flatMap((page) => page.topicPageKeys));
      const notesForClaim = dedupe([
        ...allClaimPages.flatMap((page) => page.notes),
        `Batch cross-reference consolidated evidence from ${batchSourcePaperKeys.length} papers in the current batch.`,
      ]);
      const contradictions = dedupe(allClaimPages.flatMap((page) => page.contradictions));
      const tensions = dedupe([
        ...allClaimPages.flatMap((page) => page.tensions),
        ...buildClaimTensionsFromEvidence(supportPaperKeys, contradictPaperKeys, qualifyPaperKeys, topicPageKeys),
      ]);
      const representative = claimPages[0]!;
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
      notes.push(`Cross-referenced claim [[${claimKey}]] across ${sourcePaperKeys.length} papers${historicalClaimPages.length > 0 ? " with retrieved historical context" : ""} and re-evaluated its debate status conservatively.`);
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
    for (const item of prepared.filter((candidate) => !candidate.usedExplicitPageHints)) {
      const query = dedupe([
        item.plan.paperTitle,
        item.plan.summary,
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
        if (page.kind === "overview") continue;
        const key = `${page.kind}:${page.pageKey}`;
        if (seen.has(key)) continue;
        const existing = await readExistingPage(join(wikiRoot, page.path));
        if (!existing) continue;
        if (existing.kind !== "topic" && existing.kind !== "claim" && existing.kind !== "synthesis") continue;
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
    const existingPages = await loadExistingWikiPages(wikiRoot);
    const mergedByKey = new Map<string, LiteratureWikiPage>();

    for (const page of existingPages.filter((page) => page.kind !== "overview")) {
      mergedByKey.set(`${page.kind}:${page.pageKey}`, page);
    }
    for (const page of combinedPages) {
      const key = `${page.kind}:${page.pageKey}`;
      const current = mergedByKey.get(key);
      mergedByKey.set(key, current ? mergeLiteratureWikiPages(current, page) : page);
    }

    const mergedPages = [...mergedByKey.values()];
    for (const page of mergedPages) {
      const path = literatureWikiPagePath(wikiRoot, page);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, renderLiteratureWikiPageMarkdown(page), "utf-8");
      writtenFiles.push(path);
    }

    const overviewPages = buildOverviewPages(mergedPages);
    const overviewPage = overviewPages.find((page) => page.pageKey === "literature_overview") ?? overviewPages[0]!;
    for (const overview of overviewPages) {
      const overviewPath = literatureWikiPagePath(wikiRoot, overview);
      await mkdir(dirname(overviewPath), { recursive: true });
      await writeFile(overviewPath, renderLiteratureWikiPageMarkdown(overview), "utf-8");
      writtenFiles.push(overviewPath);
    }

    const finalPages = dedupePagesByKey([...mergedPages, ...overviewPages]);
    const indexPath = join(wikiRoot, "index.md");
    await mkdir(dirname(indexPath), { recursive: true });
    await writeFile(indexPath, renderLiteratureWikiIndex(finalPages), "utf-8");
    writtenFiles.push(indexPath);

    const subIndexFiles = await writeLiteratureWikiSubIndexes(wikiRoot, finalPages);
    writtenFiles.push(...subIndexFiles);

    const logPath = join(wikiRoot, "log.md");
    await mkdir(dirname(logPath), { recursive: true });
    await appendFile(logPath, renderLiteratureWikiBatchLogEntry(prepared, overviewPage, crossReference));

    const hotPath = join(wikiRoot, "hot.md");
    await mkdir(dirname(hotPath), { recursive: true });
    await writeFile(hotPath, renderLiteratureWikiBatchHotCache(prepared, finalPages, crossReference), "utf-8");
    writtenFiles.push(hotPath);

    const disciplineHotPaths = await writeDisciplineHotCaches(wikiRoot, prepared, finalPages, crossReference);
    writtenFiles.push(...disciplineHotPaths);

    return {
      completed: prepared,
      failures: [],
      writtenFiles,
      indexPath,
      logPath,
      hotPath,
      disciplineHotPaths,
      overviewPage,
      pages: mergedPages,
      skippedUpdates: combinedSkipped,
    };
  }

  async write(input: PaperIngestRequest & { plan: PaperIngestPlan }): Promise<PaperIngestWriteResult> {
    const prepared: PreparedPaperIngest = {
      digest: input.digest,
      plan: input.plan,
      usedExplicitPageHints: Boolean(input.existingPageHints && input.existingPageHints.length > 0),
      ...this.materialize({ digest: input.digest, plan: input.plan, discipline: input.discipline }),
    };
    const committed = await this.commitBatch(input.wikiRoot, [prepared]);
    return {
      pages: committed.pages,
      skippedUpdates: committed.skippedUpdates,
      overviewPage: committed.overviewPage,
      writtenFiles: committed.writtenFiles,
      indexPath: committed.indexPath,
      logPath: committed.logPath,
      hotPath: committed.hotPath,
      disciplineHotPaths: committed.disciplineHotPaths,
    };
  }

  async ingest(input: PaperIngestRequest): Promise<PaperIngestWriteResult & { plan: PaperIngestPlan }> {
    const plan = await this.plan(input);
    const written = await this.write({
      ...input,
      plan,
    });
    return {
      ...written,
      plan,
    };
  }

  async ingestBatch(inputs: PaperIngestRequest[]): Promise<PaperIngestBatchResult> {
    if (inputs.length === 0) {
      return { completed: [], failures: [], writtenFiles: [], pages: [], skippedUpdates: [] };
    }
    const completed: PreparedPaperIngest[] = [];
    const failures: Array<{ digest: PaperDigest; error: string }> = [];
    const results = await Promise.allSettled(inputs.map((input) => this.prepare(input)));
    for (let index = 0; index < results.length; index += 1) {
      const result = results[index];
      const input = inputs[index];
      if (!input) continue;
      if (result?.status === "fulfilled") {
        completed.push(result.value);
      } else {
        failures.push({
          digest: input.digest,
          error: result?.reason instanceof Error ? result.reason.message : String(result?.reason ?? "Unknown batch ingest failure"),
        });
      }
    }
    if (completed.length === 0) {
      return { completed, failures, writtenFiles: [], pages: [], skippedUpdates: [] };
    }
    const crossReference = await this.crossReferenceBatch(completed, inputs[0]!.wikiRoot);
    const committed = await this.commitBatch(inputs[0]!.wikiRoot, completed, crossReference);
    return { ...committed, failures };
  }
}

const PAPER_INGEST_PLAN_SCHEMA: StructuredSchema = {
  name: "paper_ingest_plan",
  description: "A structured plan describing how one paper digest should update a persistent literature wiki.",
  schema: {
    type: "object",
    required: ["paperKey", "paperTitle", "schemaFamily", "ingestObjective", "summary", "pageUpdates", "claimUpdates", "topicUpdates", "authorUpdates", "logEntry"],
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
      authorUpdates: {
        type: "array",
        items: {
          type: "object",
          required: ["authorKey", "authorName", "action", "rationale", "updates"],
          properties: {
            authorKey: { type: "string" },
            authorName: { type: "string" },
            action: { type: "string" },
            rationale: { type: "string" },
            updates: { type: "array", items: { type: "string" } },
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
    authorUpdates: asObjectArray(value.authorUpdates).map(coerceAuthorUpdate),
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

function coerceAuthorUpdate(value: Record<string, unknown>): PaperIngestAuthorUpdate {
  return {
    authorKey: asString(value.authorKey),
    authorName: asString(value.authorName),
    action: normalizeEnum(asString(value.action), ["create", "update"], "update"),
    rationale: asString(value.rationale),
    updates: asStringArray(value.updates),
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
    "author",
    "concept",
    "method",
    "task",
    "evidence_source",
    "evaluation_setup",
    "measure",
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

function buildEntityPage(
  digest: PaperDigest,
  plan: PaperIngestPlan,
  update: PaperIngestPlan["pageUpdates"][number],
  updatedAt: string,
  discipline: LiteratureDiscipline,
): LiteratureWikiEntityPage | null {
  if (
    update.pageKind !== "author"
    && update.pageKind !== "concept"
    && update.pageKind !== "method"
    && update.pageKind !== "task"
    && update.pageKind !== "evidence_source"
    && update.pageKind !== "evaluation_setup"
    && update.pageKind !== "measure"
  ) {
    return null;
  }

  return {
    schemaVersion: "kaivu-literature-wiki-page-v1",
    discipline,
    kind: update.pageKind,
    pageKey: update.pageKey,
    title: update.title,
    summary: update.rationale,
    tags: dedupe([update.pageKind, "literature", digest.schemaFamily, update.priority]),
    aliases: [],
    sourcePaperKeys: [digest.canonicalPaperKey],
    updatedAt,
    domainScope: inferPaperDomainScope(digest),
    statement: update.patchOutline[0] || update.title,
    rationale: update.rationale,
    relatedPageKeys: dedupe([
      plan.paperKey,
      ...plan.claimUpdates.map((item) => item.claimKey),
      ...plan.topicUpdates.map((item) => item.topicKey),
        ...plan.pageUpdates
          .filter((item) => item.pageKey !== update.pageKey)
          .map((item) => item.pageKey),
    ]),
    patchOutline: update.patchOutline,
  };
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
      .filter((topic) => topic.topicThreads.some((item) => containsLoose(item, claim.claimText)) || containsLoose(topic.rationale, claim.claimText))
      .map((topic) => topic.topicKey),
    contradictions: buildClaimContradictions(claim),
    tensions: buildClaimTensions(claim),
    notes: claim.evidenceNotes,
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
      .filter((claim) => containsLoose(topic.rationale, claim.claimText) || topic.topicThreads.some((item) => containsLoose(item, claim.claimText)))
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
  const relatedClaims = plan.claimUpdates.filter((claim) => (
    containsLoose(topic.rationale, claim.claimText)
      || topic.topicThreads.some((item) => containsLoose(item, claim.claimText))
  ));
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

function collectSynthesisContradictionsFromClaimKeys(claimPageKeys: string[]): string[] {
  return dedupe(
    claimPageKeys.map((pageKey) => `[[${pageKey}]] contains an active contradiction or unresolved challenge that should stay visible in this synthesis.`),
  ).slice(0, 8);
}

function collectSynthesisTensionsFromTopicPages(topicPages: LiteratureWikiTopicPage[]): string[] {
  return dedupe([
    ...topicPages.flatMap((page) => page.currentThreads),
    ...topicPages.flatMap((page) => page.openQuestions),
  ]).slice(0, 8);
}

function dedupePagesByKey(pages: LiteratureWikiPage[]): LiteratureWikiPage[] {
  const byKey = new Map<string, LiteratureWikiPage>();
  for (const page of pages) byKey.set(`${page.kind}:${page.pageKey}`, page);
  return [...byKey.values()];
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

function decidePaperIngestRetrieveMode(digest: PaperDigest): WikiRetrieveMode {
  if (digest.keyClaims.length > 0) return "claim_first";
  if (digest.researchProblem || digest.literatureReviewUse.searchTerms.length > 0) return "topic_first";
  return "landscape";
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
    case "author":
    case "concept":
    case "method":
    case "task":
    case "evidence_source":
    case "evaluation_setup":
    case "measure":
      return {
        ...base,
        kind: incoming.kind,
        statement: preferLonger(existing.kind === incoming.kind ? existing.statement : "", incoming.statement),
        rationale: preferLonger(existing.kind === incoming.kind ? existing.rationale : "", incoming.rationale),
        relatedPageKeys: dedupe([...(existing.kind === incoming.kind ? existing.relatedPageKeys : []), ...incoming.relatedPageKeys]),
        patchOutline: dedupe([...(existing.kind === incoming.kind ? existing.patchOutline : []), ...incoming.patchOutline]),
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
    case "overview":
      return incoming;
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

function renderLiteratureWikiIndex(pages: LiteratureWikiPage[]): string {
  const grouped = new Map<string, LiteratureWikiPage[]>();
  const overviewPages = pages
    .filter((page): page is LiteratureWikiOverviewPage => page.kind === "overview")
    .sort((left, right) => left.title.localeCompare(right.title));
  const globalOverview = overviewPages.find((page) => page.pageKey === "literature_overview");
  const disciplineOverviews = overviewPages.filter((page) => page.pageKey !== "literature_overview");
  const categoryGroups: Array<{
    title: string;
    description: string;
    kinds: Array<{ kind: LiteratureWikiPage["kind"]; title: string }>;
  }> = [
    {
      title: "Entry Points",
      description: "Top-level pages to read first when orienting to the wiki.",
      kinds: [
        { kind: "overview", title: "Overview" },
        { kind: "synthesis", title: "Syntheses" },
        { kind: "topic", title: "Topics" },
      ],
    },
    {
      title: "Claims And Debates",
      description: "Claim pages and other debate-oriented views that track where evidence supports, qualifies, or contradicts current understanding.",
      kinds: [
        { kind: "claim", title: "Claims" },
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
      title: "Concepts And Entities",
      description: "Cross-source reference pages for recurring concepts, methods, tasks, resources, and evaluation objects.",
      kinds: [
        { kind: "concept", title: "Concepts" },
        { kind: "author", title: "Authors" },
        { kind: "method", title: "Methods" },
        { kind: "task", title: "Tasks" },
        { kind: "evidence_source", title: "Evidence Sources" },
        { kind: "evaluation_setup", title: "Evaluation Setups" },
        { kind: "measure", title: "Measures" },
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
    "Suggested reading order: start with `Overview`, then scan `Syntheses` and `Topics`, then drill into `Claims`, `Papers`, and the relevant concept/entity pages.",
    "",
    "## Navigation Layers",
    "",
    "- [[overview/literature_overview]]: top-level executive summary of the wiki",
    "- [[indexes/by-page-kind]]: sub-index entry point for page-kind folders",
    "- [[indexes/by-discipline]]: top-level navigation by discipline",
    "- [[log]]: chronological timeline of ingests and maintenance passes",
    "- [[hot]]: recent-context cache for the newest active threads",
  ];

  if (globalOverview || disciplineOverviews.length > 0) {
    lines.push("", "## Overview Layers", "");
    if (globalOverview) {
      lines.push(`- Global overview: [[${globalOverview.pageKey}]] - ${globalOverview.summary}`);
    }
    if (disciplineOverviews.length > 0) {
      lines.push("- Discipline overviews:");
      for (const overview of disciplineOverviews) {
        lines.push(`  - [[${overview.pageKey}]] (\`${overview.discipline}\`): ${overview.summary}`);
      }
    }
  }

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

async function writeLiteratureWikiSubIndexes(root: string, pages: LiteratureWikiPage[]): Promise<string[]> {
  const written: string[] = [];
  for (const discipline of disciplineOrder()) {
    const disciplinePages = pages.filter((page) => page.discipline === discipline);
    if (disciplinePages.length === 0) continue;
    for (const kind of pageKindOrder()) {
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
    "overview",
    "paper",
    "claim",
    "topic",
    "synthesis",
    "author",
    "concept",
    "method",
    "task",
    "evidence_source",
    "evaluation_setup",
    "measure",
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
    const overview = disciplinePages.find((page) => page.kind === "overview");
    lines.push("", `## ${disciplineLabel(discipline)}`, "", `- Detail index: [[${discipline}/_index]]`);
    if (overview) {
      lines.push(`- Overview: [[${overview.pageKey}]]`);
    }
    lines.push("");
    for (const page of disciplinePages) {
      if (page.kind === "overview") continue;
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

  const overviewPages = (grouped.get("overview") ?? []).sort((left, right) => left.title.localeCompare(right.title));
  if (overviewPages.length > 0) {
    lines.push("", "## Overview", "");
    for (const page of overviewPages) {
      lines.push(`- [[${page.pageKey}]]: ${page.summary}`);
    }
  }

  for (const kind of [
    "paper",
    "claim",
    "topic",
    "synthesis",
    "author",
    "concept",
    "method",
    "task",
    "evidence_source",
    "evaluation_setup",
    "measure",
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
  overviewPage: LiteratureWikiOverviewPage,
): string {
  const now = new Date().toISOString();
  const dateLabel = now.slice(0, 10);
  const affectedPageKeys = dedupe([
    ...writtenPages.map((page) => page.pageKey),
    overviewPage.pageKey,
  ]);
  const changes = dedupe([
    ...plan.pageUpdates.map((item) => `${item.action} ${item.pageKind}:${item.pageKey}`),
    ...plan.claimUpdates.map((item) => `${item.action} claim:${item.claimKey} (${item.effect})`),
    ...plan.topicUpdates.map((item) => `${item.action} topic:${item.topicKey}`),
    ...plan.authorUpdates.map((item) => `${item.action} author:${item.authorKey}`),
    "update overview:literature_overview",
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
  overviewPage: LiteratureWikiOverviewPage,
  crossReference: BatchCrossReferenceResult,
): string {
  const now = new Date().toISOString();
  const dateLabel = now.slice(0, 10);
  const paperTitles = prepared.map((item) => item.digest.title).filter(Boolean);
  const affectedPageKeys = dedupe([
    ...prepared.flatMap((item) => item.pages.map((page) => page.pageKey)),
    overviewPage.pageKey,
  ]);
  const createdOrUpdated = dedupe([
    ...prepared.flatMap((item) => item.plan.pageUpdates.map((update) => `${update.action} ${update.pageKind}:${update.pageKey}`)),
    ...prepared.flatMap((item) => item.plan.claimUpdates.map((claim) => `${claim.action} claim:${claim.claimKey} (${claim.effect})`)),
    ...prepared.flatMap((item) => item.plan.topicUpdates.map((topic) => `${topic.action} topic:${topic.topicKey}`)),
    ...prepared.flatMap((item) => item.plan.authorUpdates.map((author) => `${author.action} author:${author.authorKey}`)),
    "update overview:literature_overview",
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

function buildOverviewPages(pages: LiteratureWikiPage[]): LiteratureWikiOverviewPage[] {
  const overviewPages: LiteratureWikiOverviewPage[] = [
    buildLiteratureWikiOverviewPage(pages, new Date().toISOString(), {
      discipline: "general_science",
      pageKey: "literature_overview",
      title: "Literature Overview",
      summary: "Executive summary of the full literature wiki across disciplines.",
      aliases: ["literature_index", "wiki_overview"],
    }),
  ];

  const concreteDisciplines = dedupe(pages.map((page) => page.discipline))
    .filter((discipline): discipline is LiteratureDiscipline =>
      discipline !== "general_science" && discipline !== "unknown",
    );

  for (const discipline of concreteDisciplines) {
    const disciplinePages = pages.filter((page) => page.discipline === discipline);
    if (disciplinePages.length === 0) continue;
    overviewPages.push(
      buildLiteratureWikiOverviewPage(disciplinePages, new Date().toISOString(), {
        discipline,
        pageKey: `${discipline}_literature_overview`,
        title: `${disciplineLabel(discipline)} Literature Overview`,
        summary: `Executive summary of the ${disciplineLabel(discipline).toLowerCase()} portion of the literature wiki.`,
        aliases: [],
      }),
    );
  }

  return overviewPages;
}

function normalizeEnum<T extends string>(value: string, allowed: readonly T[], fallback: T): T {
  return allowed.includes(value as T) ? value as T : fallback;
}

function kindLabelFromIngestPageKind(kind: PaperIngestWikiPageKind): string {
  switch (kind) {
    case "paper":
      return "Papers";
    case "author":
      return "Authors";
    case "concept":
      return "Concepts";
    case "method":
      return "Methods";
    case "task":
      return "Tasks";
    case "evidence_source":
      return "Evidence Sources";
    case "evaluation_setup":
      return "Evaluation Setups";
    case "measure":
      return "Measures";
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
    case "author":
      return "Authors";
    case "concept":
      return "Concepts";
    case "method":
      return "Methods";
    case "task":
      return "Tasks";
    case "evidence_source":
      return "Evidence Sources";
    case "evaluation_setup":
      return "Evaluation Setups";
    case "measure":
      return "Measures";
    case "claim":
      return "Claims";
    case "topic":
      return "Topics";
    case "synthesis":
      return "Syntheses";
    case "overview":
      return "Overview";
  }
}

function pageKindOrder(): Array<LiteratureWikiPage["kind"]> {
  return [
    "overview",
    "paper",
    "claim",
    "topic",
    "synthesis",
    "author",
    "concept",
    "method",
    "task",
    "evidence_source",
    "evaluation_setup",
    "measure",
  ];
}

function folderIndexDescription(kind: LiteratureWikiPage["kind"]): string {
  switch (kind) {
    case "paper":
      return "Paper pages are the source anchors of the wiki. Each page captures one ingested paper and links outward to the claims, topics, and syntheses it affects.";
    case "claim":
      return "Claim pages track debate positions, propositions, and judgments that can be supported, contradicted, or qualified by evidence.";
    case "topic":
      return "Topic pages organize areas of inquiry: scope, recurring threads, and open questions.";
    case "synthesis":
      return "Synthesis pages maintain cross-paper integrated views, comparisons, and evolving takeaways.";
    case "overview":
      return "Overview pages serve as top-level executive summaries and reading entry points.";
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
