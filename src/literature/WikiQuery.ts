import { appendFile, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  parseStructuredOutput,
  repairInstruction,
  salvageStructuredOutput,
  type StructuredSchema,
} from "../structured/StructuredOutput.js";
import type { LiteratureDiscipline } from "./PaperDigest.js";
import {
  literatureWikiPagePath,
  parseLiteratureWikiPageMarkdown,
  renderLiteratureWikiPageMarkdown,
  type LiteratureWikiPage,
  type LiteratureWikiSynthesisPage,
} from "./LiteratureWikiPage.js";
import { renderLiteratureWikiIndex } from "./PaperIngest.js";
import { WikiRetrieve, type WikiRetrieveMode, type WikiRetrievePage, type WikiRetrieveResult } from "./WikiRetrieval.js";

export interface WikiQueryModelStepOptions {
  stepId?: string;
  system?: string;
  prompt: string;
  includeRenderedContext?: boolean;
  stream?: boolean;
  stageUserInputPolicy?: string | string[] | false;
}

export type WikiQueryModelStepRunner = (options: WikiQueryModelStepOptions) => Promise<string>;

export interface WikiQueryRequest {
  wikiRoot: string;
  question: string;
  disciplineScope: LiteratureDiscipline[];
  mode?: WikiRetrieveMode;
  limit?: number;
  expandLinks?: boolean;
  fileAnswer?: boolean | "auto";
  pageKey?: string;
  title?: string;
}

export interface WikiQueryCitation {
  pageKey: string;
  title: string;
  path: string;
  rationale: string;
}

export interface WikiQueryFiledPage {
  pageKey: string;
  path: string;
  logPath: string;
  indexPath: string;
  hotPath: string;
}

export interface WikiQueryResult {
  question: string;
  answerTitle: string;
  answerMarkdown: string;
  citations: WikiQueryCitation[];
  shouldFile: boolean;
  retrieval: WikiRetrieveResult;
  filedPage?: WikiQueryFiledPage;
}

interface WikiQueryModelOutput {
  answerTitle: string;
  answerMarkdown: string;
  citations: WikiQueryCitation[];
  shouldFile: boolean;
  synthesisPage: {
    pageKey: string;
    title: string;
    summary: string;
    integratedTakeaway: string;
    scopeNotes: string[];
    stateOfPlay: string[];
    synthesis: string[];
    keyPageKeys: string[];
    claimPageKeys: string[];
    contradictions: string[];
    tensions: string[];
    openQuestions: string[];
    tags: string[];
    domainScope: string[];
  };
}

export const WIKI_QUERY_MODEL_OUTPUT_SHAPE = {
  answerTitle: "string",
  answerMarkdown: "string",
  citations: [
    {
      pageKey: "string",
      title: "string",
      path: "string",
      rationale: "string",
    },
  ],
  shouldFile: "boolean",
  synthesisPage: {
    pageKey: "string",
    title: "string",
    summary: "string",
    integratedTakeaway: "string",
    scopeNotes: ["string"],
    stateOfPlay: ["string"],
    synthesis: ["string"],
    keyPageKeys: ["string"],
    claimPageKeys: ["string"],
    contradictions: ["string"],
    tensions: ["string"],
    openQuestions: ["string"],
    tags: ["string"],
    domainScope: ["string"],
  },
} as const;

export function renderWikiQueryPrompt(input: {
  question: string;
  pages: Array<{ retrievePage: WikiRetrievePage; raw: string }>;
}): string {
  const pageContext = input.pages.map(({ retrievePage, raw }, index) => [
    `## Source ${index + 1}: [[${retrievePage.pageKey}]]`,
    `title: ${retrievePage.title}`,
    `kind: ${retrievePage.kind}`,
    `discipline: ${retrievePage.discipline}`,
    `path: ${retrievePage.path}`,
    `retrieval_reasons: ${retrievePage.reasons.join("; ") || "none"}`,
    "",
    raw.trim(),
  ].join("\n")).join("\n\n---\n\n");

  return [
    "You are answering a question using a persistent literature wiki maintained by an LLM.",
    "",
    "Use only the wiki pages provided below.",
    "Synthesize across pages; do not merely list page summaries.",
    "Cite the most relevant wiki pages with Obsidian-style links such as [[page_key]].",
    "If the answer creates a durable comparison, synthesis, or reusable analysis, set shouldFile to true and fill synthesisPage.",
    "If the answer is narrow, temporary, or not worth keeping as compiled knowledge, set shouldFile to false but still provide synthesisPage fields with a reasonable draft.",
    "",
    "# Question",
    "",
    input.question,
    "",
    "# Retrieved Wiki Pages",
    "",
    pageContext || "No wiki pages were retrieved.",
    "",
    "# Output",
    "",
    "Return valid JSON only.",
    "Do not include Markdown fences.",
    "Match this JSON shape exactly:",
    "",
    JSON.stringify(WIKI_QUERY_MODEL_OUTPUT_SHAPE, null, 2),
  ].join("\n");
}

export class WikiQuery {
  constructor(
    private readonly modelStep: WikiQueryModelStepRunner,
    private readonly wikiRetrieve = new WikiRetrieve(),
  ) {}

  async query(input: WikiQueryRequest): Promise<WikiQueryResult> {
    const retrieval = await this.wikiRetrieve.retrieve({
      wikiRoot: input.wikiRoot,
      query: input.question,
      disciplineScope: input.disciplineScope,
      mode: input.mode,
      limit: input.limit,
      expandLinks: input.expandLinks,
    });
    const pageContexts = await loadRetrievedPageContexts(input.wikiRoot, [
      ...retrieval.primaryPages,
      ...retrieval.expandedPages,
    ]);
    const raw = await this.modelStep({
      stepId: `wiki_query_${safeStepId(input.question)}`,
      system: "You answer persistent literature wiki questions as structured JSON.",
      prompt: renderWikiQueryPrompt({
        question: input.question,
        pages: pageContexts,
      }),
      includeRenderedContext: false,
      stageUserInputPolicy: false,
      stream: false,
    });
    const output = await parseOrRepairWikiQuery(raw, (options) => this.modelStep({
      ...options,
      stageUserInputPolicy: false,
    }));
    const shouldFile = input.fileAnswer === "auto"
      ? output.shouldFile
      : input.fileAnswer === true;
    const result: WikiQueryResult = {
      question: input.question,
      answerTitle: output.answerTitle,
      answerMarkdown: output.answerMarkdown,
      citations: output.citations,
      shouldFile: output.shouldFile,
      retrieval,
    };
    if (shouldFile) {
      result.filedPage = await this.fileAnswer(input, output, pageContexts);
    }
    return result;
  }

  private async fileAnswer(
    input: WikiQueryRequest,
    output: WikiQueryModelOutput,
    pageContexts: Array<{ retrievePage: WikiRetrievePage; raw: string; parsed?: LiteratureWikiPage }>,
  ): Promise<WikiQueryFiledPage> {
    const now = new Date().toISOString();
    const page = buildSynthesisPage(input, output, pageContexts, now);
    const path = literatureWikiPagePath(input.wikiRoot, page.discipline, page.kind, page.pageKey);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, renderLiteratureWikiPageMarkdown(page), "utf-8");

    const pages = await loadWikiPages(input.wikiRoot);
    const indexPath = join(input.wikiRoot, "index.md");
    await mkdir(dirname(indexPath), { recursive: true });
    await writeFile(indexPath, renderLiteratureWikiIndex(pages), "utf-8");

    const logPath = join(input.wikiRoot, "log.md");
    await mkdir(dirname(logPath), { recursive: true });
    await appendFile(logPath, renderWikiQueryLogEntry(input.question, page, now), "utf-8");

    const hotPath = join(input.wikiRoot, "hot.md");
    await mkdir(dirname(hotPath), { recursive: true });
    await writeFile(hotPath, renderWikiQueryHotCache(input.question, page, output, now), "utf-8");

    return { pageKey: page.pageKey, path, logPath, indexPath, hotPath };
  }
}

const WIKI_QUERY_OUTPUT_SCHEMA: StructuredSchema = {
  name: "wiki_query_answer",
  description: "A structured answer to a persistent wiki query, optionally fileable as a synthesis page.",
  schema: {
    type: "object",
    required: ["answerTitle", "answerMarkdown", "citations", "shouldFile", "synthesisPage"],
    properties: {
      answerTitle: { type: "string" },
      answerMarkdown: { type: "string" },
      citations: {
        type: "array",
        items: {
          type: "object",
          required: ["pageKey", "title", "path", "rationale"],
          properties: {
            pageKey: { type: "string" },
            title: { type: "string" },
            path: { type: "string" },
            rationale: { type: "string" },
          },
        },
      },
      shouldFile: { type: "boolean" },
      synthesisPage: {
        type: "object",
        required: [
          "pageKey",
          "title",
          "summary",
          "integratedTakeaway",
          "scopeNotes",
          "stateOfPlay",
          "synthesis",
          "keyPageKeys",
          "claimPageKeys",
          "contradictions",
          "tensions",
          "openQuestions",
          "tags",
          "domainScope",
        ],
        properties: {
          pageKey: { type: "string" },
          title: { type: "string" },
          summary: { type: "string" },
          integratedTakeaway: { type: "string" },
          scopeNotes: { type: "array", items: { type: "string" } },
          stateOfPlay: { type: "array", items: { type: "string" } },
          synthesis: { type: "array", items: { type: "string" } },
          keyPageKeys: { type: "array", items: { type: "string" } },
          claimPageKeys: { type: "array", items: { type: "string" } },
          contradictions: { type: "array", items: { type: "string" } },
          tensions: { type: "array", items: { type: "string" } },
          openQuestions: { type: "array", items: { type: "string" } },
          tags: { type: "array", items: { type: "string" } },
          domainScope: { type: "array", items: { type: "string" } },
        },
      },
    },
  },
};

async function parseOrRepairWikiQuery(
  rawText: string,
  modelStep: WikiQueryModelStepRunner,
): Promise<WikiQueryModelOutput> {
  try {
    return coerceWikiQueryOutput(parseStructuredOutput(rawText, WIKI_QUERY_OUTPUT_SCHEMA));
  } catch (error) {
    try {
      return coerceWikiQueryOutput(salvageStructuredOutput(rawText, WIKI_QUERY_OUTPUT_SCHEMA));
    } catch {
      const repaired = await modelStep({
        stepId: "wiki_query_answer_repair",
        system: "You repair invalid wiki-query outputs into valid JSON.",
        prompt: repairInstruction(
          WIKI_QUERY_OUTPUT_SCHEMA,
          rawText,
          error instanceof Error ? error.message : String(error),
        ),
        includeRenderedContext: false,
        stream: false,
      });
      return coerceWikiQueryOutput(parseStructuredOutput(repaired, WIKI_QUERY_OUTPUT_SCHEMA));
    }
  }
}

function coerceWikiQueryOutput(value: Record<string, unknown>): WikiQueryModelOutput {
  const synthesisPage = isRecord(value.synthesisPage) ? value.synthesisPage : {};
  return {
    answerTitle: asString(value.answerTitle),
    answerMarkdown: asString(value.answerMarkdown),
    citations: asObjectArray(value.citations).map((item) => ({
      pageKey: asString(item.pageKey),
      title: asString(item.title),
      path: asString(item.path),
      rationale: asString(item.rationale),
    })),
    shouldFile: Boolean(value.shouldFile),
    synthesisPage: {
      pageKey: asString(synthesisPage.pageKey),
      title: asString(synthesisPage.title),
      summary: asString(synthesisPage.summary),
      integratedTakeaway: asString(synthesisPage.integratedTakeaway),
      scopeNotes: asStringArray(synthesisPage.scopeNotes),
      stateOfPlay: asStringArray(synthesisPage.stateOfPlay),
      synthesis: asStringArray(synthesisPage.synthesis),
      keyPageKeys: asStringArray(synthesisPage.keyPageKeys),
      claimPageKeys: asStringArray(synthesisPage.claimPageKeys),
      contradictions: asStringArray(synthesisPage.contradictions),
      tensions: asStringArray(synthesisPage.tensions),
      openQuestions: asStringArray(synthesisPage.openQuestions),
      tags: asStringArray(synthesisPage.tags),
      domainScope: asStringArray(synthesisPage.domainScope),
    },
  };
}

async function loadRetrievedPageContexts(
  wikiRoot: string,
  pages: WikiRetrievePage[],
): Promise<Array<{ retrievePage: WikiRetrievePage; raw: string; parsed?: LiteratureWikiPage }>> {
  const contexts: Array<{ retrievePage: WikiRetrievePage; raw: string; parsed?: LiteratureWikiPage }> = [];
  const seen = new Set<string>();
  for (const page of pages) {
    const key = `${page.discipline}:${page.pageKey}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const raw = await safeReadFile(join(wikiRoot, page.path));
    if (!raw) continue;
    contexts.push({
      retrievePage: page,
      raw,
      parsed: parseLiteratureWikiPageMarkdown(raw) ?? undefined,
    });
  }
  return contexts;
}

function buildSynthesisPage(
  input: WikiQueryRequest,
  output: WikiQueryModelOutput,
  pageContexts: Array<{ retrievePage: WikiRetrievePage; parsed?: LiteratureWikiPage }>,
  now: string,
): LiteratureWikiSynthesisPage {
  const retrievedPages = pageContexts.map((context) => context.retrievePage);
  const parsedPages = pageContexts.flatMap((context) => context.parsed ? [context.parsed] : []);
  const pageKey = safeWikiPageKey(input.pageKey || output.synthesisPage.pageKey || `query_${input.question}`);
  const title = input.title || output.synthesisPage.title || output.answerTitle || input.question;
  const keyPageKeys = dedupeStrings([
    ...output.synthesisPage.keyPageKeys,
    ...retrievedPages.map((page) => page.pageKey),
  ]);
  const claimPageKeys = dedupeStrings([
    ...output.synthesisPage.claimPageKeys,
    ...retrievedPages.filter((page) => page.kind === "claim").map((page) => page.pageKey),
  ]);
  return {
    schemaVersion: "kaivu-literature-wiki-page-v1",
    discipline: resolveFiledDiscipline(input.disciplineScope),
    kind: "synthesis",
    pageKey,
    title,
    summary: output.synthesisPage.summary || output.answerTitle || input.question,
    tags: dedupeStrings(["query-answer", "synthesis", ...output.synthesisPage.tags]),
    aliases: [input.question],
    sourcePaperKeys: dedupeStrings(parsedPages.flatMap((page) => page.sourcePaperKeys)),
    updatedAt: now,
    domainScope: dedupeStrings([
      ...output.synthesisPage.domainScope,
      ...parsedPages.flatMap((page) => page.domainScope),
    ]),
    synthesisStatement: output.answerTitle || input.question,
    integratedTakeaway: output.synthesisPage.integratedTakeaway || output.answerMarkdown,
    scopeNotes: output.synthesisPage.scopeNotes,
    stateOfPlay: output.synthesisPage.stateOfPlay,
    synthesis: output.synthesisPage.synthesis.length > 0
      ? output.synthesisPage.synthesis
      : [output.answerMarkdown],
    keyPageKeys,
    claimPageKeys,
    contradictions: output.synthesisPage.contradictions,
    tensions: output.synthesisPage.tensions,
    openQuestions: output.synthesisPage.openQuestions,
  };
}

async function loadWikiPages(wikiRoot: string): Promise<LiteratureWikiPage[]> {
  const files = await collectMarkdownFiles(wikiRoot);
  const pages: LiteratureWikiPage[] = [];
  for (const file of files) {
    const raw = await safeReadFile(file);
    if (!raw) continue;
    const page = parseLiteratureWikiPageMarkdown(raw);
    if (page) pages.push(page);
  }
  return pages;
}

async function collectMarkdownFiles(root: string): Promise<string[]> {
  try {
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
  } catch {
    return [];
  }
}

function renderWikiQueryLogEntry(question: string, page: LiteratureWikiSynthesisPage, now: string): string {
  const dateLabel = now.slice(0, 10);
  return [
    "",
    `## [${dateLabel}] query | ${page.title}`,
    "",
    `- Question: ${question}`,
    `- Filed answer: [[${page.pageKey}]]`,
    `- Cited pages: ${page.keyPageKeys.map((key) => `[[${key}]]`).join(", ") || "none"}`,
    "",
  ].join("\n");
}

function renderWikiQueryHotCache(
  question: string,
  page: LiteratureWikiSynthesisPage,
  output: WikiQueryModelOutput,
  now: string,
): string {
  return [
    "---",
    'type: "meta"',
    'title: "Hot Cache"',
    `updated: "${now}"`,
    "---",
    "",
    "# Recent Context",
    "",
    "## Last Updated",
    `${now.slice(0, 10)} - Filed wiki query answer [[${page.pageKey}]]`,
    "",
    "## Recent Query",
    `- Question: ${question}`,
    `- Answer: [[${page.pageKey}]]`,
    "",
    "## Key Recent Facts",
    `- ${output.synthesisPage.integratedTakeaway || page.summary}`,
    "",
    "## Recent Changes",
    `- Updated pages: [[${page.pageKey}]]`,
    "",
  ].join("\n");
}

async function safeReadFile(path: string): Promise<string> {
  try {
    return await readFile(path, "utf-8");
  } catch {
    return "";
  }
}

function resolveFiledDiscipline(scope: LiteratureDiscipline[]): LiteratureDiscipline {
  const deduped = dedupeStrings(scope) as LiteratureDiscipline[];
  if (deduped.length === 1) return deduped[0]!;
  if (deduped.length > 1) return "general_science";
  return "unknown";
}

function safeStepId(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 80) || "query";
}

function safeWikiPageKey(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 120) || "query_answer";
}

function dedupeStrings(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : String(value ?? "").trim();
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return dedupeStrings(value.map(asString));
}

function asObjectArray(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
