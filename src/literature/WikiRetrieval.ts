import { readFile, readdir } from "node:fs/promises";
import { join, relative } from "node:path";
import type { LiteratureDiscipline } from "./PaperDigest.js";
import {
  literatureWikiPageLinks,
  parseLiteratureWikiPageMarkdown,
  type LiteratureWikiPage,
} from "./LiteratureWikiPage.js";

export type WikiRetrieveMode =
  | "auto"
  | "landscape"
  | "claim_first"
  | "topic_first"
  | "paper_first";

export interface WikiRetrieveRequest {
  wikiRoot: string;
  query: string;
  disciplineScope: LiteratureDiscipline[];
  mode?: WikiRetrieveMode;
  limit?: number;
  expandLinks?: boolean;
}

export interface WikiRetrievePage {
  pageKey: string;
  title: string;
  kind: LiteratureWikiPage["kind"];
  discipline: LiteratureDiscipline;
  summary: string;
  path: string;
  score: number;
  snippet: string;
  reasons: string[];
}

export interface WikiRetrieveResult {
  query: string;
  mode: Exclude<WikiRetrieveMode, "auto">;
  disciplineScope: LiteratureDiscipline[];
  consultedFiles: string[];
  primaryPages: WikiRetrievePage[];
  expandedPages: WikiRetrievePage[];
  readOrder: string[];
  rationale: string[];
}

interface LoadedWikiPage {
  page: LiteratureWikiPage;
  path: string;
  raw: string;
}

interface WikiSearchContext {
  hotPageKeys: Set<string>;
  indexPageKeys: Set<string>;
  disciplineIndexPageKeys: Set<string>;
}

interface WikiSearchRequest {
  query: string;
  pages: LoadedWikiPage[];
  disciplineScope?: LiteratureDiscipline[];
  context?: WikiSearchContext;
}

interface WikiSearchMatch {
  loaded: LoadedWikiPage;
  score: number;
  snippet: string;
  reasons: string[];
}

interface WikiSearch {
  search(input: WikiSearchRequest): { query: string; matches: WikiSearchMatch[] };
}

class NaiveWikiSearch implements WikiSearch {
  search(input: WikiSearchRequest): { query: string; matches: WikiSearchMatch[] } {
    const disciplineScope = normalizeDisciplineScope(input.disciplineScope);
    const context = input.context ?? emptySearchContext();
    const tokens = tokenizeQuery(input.query);
    const loweredQuery = input.query.trim().toLowerCase();
    const matches: WikiSearchMatch[] = [];

    for (const loaded of input.pages) {
      if (disciplineScope.length > 0 && !disciplineScope.includes(loaded.page.discipline)) continue;
      const score = scorePageMatch(loaded, loweredQuery, tokens, context);
      if (score.score <= 0) continue;
      matches.push({
        loaded,
        score: score.score,
        snippet: score.snippet,
        reasons: score.reasons,
      });
    }

    return {
      query: input.query,
      matches: matches.sort((left, right) => right.score - left.score),
    };
  }
}

interface WikiPageFileRecord {
  pageKey: string;
  discipline: LiteratureDiscipline;
  kind: LiteratureWikiPage["kind"];
  path: string;
  relativeNoExtPath: string;
}

interface WikiPageFileIndex {
  records: WikiPageFileRecord[];
  byScopedPageKey: Map<string, WikiPageFileRecord>;
  byPageKey: Map<string, WikiPageFileRecord[]>;
  byRelativeNoExtPath: Map<string, WikiPageFileRecord>;
}

interface WikiSpecialContext {
  consultedFiles: string[];
  scopedHotTargets: Set<string>;
  hotTargets: Set<string>;
  indexTargets: Set<string>;
  disciplineIndexTargets: Set<string>;
}

/**
 * Retrieval over the persistent literature wiki.
 *
 * Use this for:
 * - gathering long-term compiled wiki context before ingest planning
 * - retrieving historical topic/claim/synthesis context during batch cross-reference
 * - future persistent-wiki query and reading-set construction
 *
 * This is intentionally separate from LiteratureReviewRuntimeStore.search(),
 * which only searches the review-time runtime working set.
 */
export class WikiRetrieve {
  constructor(private readonly searchBackend: WikiSearch = new NaiveWikiSearch()) {}

  async retrieve(input: WikiRetrieveRequest): Promise<WikiRetrieveResult> {
    const disciplineScope = normalizeDisciplineScope(input.disciplineScope);
    if (disciplineScope.length === 0) {
      throw new Error("WikiRetrieve requires a non-empty disciplineScope. Pass the discipline scope decided by problem framing.");
    }
    const mode = decideRetrieveMode(input.query, input.mode);
    const specialContext = await this.loadSpecialContext(input.wikiRoot, disciplineScope);
    const pageFileIndex = await this.buildWikiPageFileIndex(input.wikiRoot);
    const pages = await this.loadCandidatePages(pageFileIndex, specialContext, disciplineScope, mode);
    const matches = this.searchBackend.search({
      query: input.query,
      pages,
      disciplineScope,
      context: {
        hotPageKeys: new Set(resolveTargetPageKeys([
          ...specialContext.scopedHotTargets,
          ...specialContext.hotTargets,
        ], pageFileIndex, disciplineScope)),
        indexPageKeys: new Set(resolveTargetPageKeys([...specialContext.indexTargets], pageFileIndex, disciplineScope)),
        disciplineIndexPageKeys: new Set(resolveTargetPageKeys([...specialContext.disciplineIndexTargets], pageFileIndex, disciplineScope)),
      },
    }).matches;
    const primary = this.selectPrimaryPages(matches, mode, input.limit ?? 6);
    const expanded = input.expandLinks === false
      ? []
      : await this.expandPages(primary, pages, pageFileIndex, disciplineScope, input.limit ?? 6);

    return {
      query: input.query,
      mode,
      disciplineScope,
      consultedFiles: specialContext.consultedFiles,
      primaryPages: primary.map((match) => toRetrievePage(match, input.wikiRoot)),
      expandedPages: expanded.map((match) => toRetrievePage(match, input.wikiRoot)),
      readOrder: [...primary, ...expanded].map((match) => match.loaded.page.pageKey),
      rationale: buildRetrieveRationale(mode, disciplineScope, specialContext, primary, expanded),
    };
  }

  private async buildWikiPageFileIndex(wikiRoot: string): Promise<WikiPageFileIndex> {
    const files = await collectMarkdownFiles(wikiRoot);
    const records: WikiPageFileRecord[] = [];
    const byScopedPageKey = new Map<string, WikiPageFileRecord>();
    const byPageKey = new Map<string, WikiPageFileRecord[]>();
    const byRelativeNoExtPath = new Map<string, WikiPageFileRecord>();
    for (const file of files) {
      const record = pageFileRecordFromPath(wikiRoot, file);
      if (!record) continue;
      records.push(record);
      byScopedPageKey.set(scopedPageKey(record.discipline, record.pageKey), record);
      byRelativeNoExtPath.set(record.relativeNoExtPath, record);
      byPageKey.set(record.pageKey, [...(byPageKey.get(record.pageKey) ?? []), record]);
    }
    return { records, byScopedPageKey, byPageKey, byRelativeNoExtPath };
  }

  private async loadSpecialContext(wikiRoot: string, disciplineScope: LiteratureDiscipline[]): Promise<WikiSpecialContext> {
    const consultedFiles: string[] = [];
    let scopedHotRaw = "";
    if (disciplineScope.length === 1) {
      const scopedHot = await safeReadFile(join(wikiRoot, disciplineScope[0]!, "hot.md"));
      if (scopedHot) {
        scopedHotRaw = scopedHot;
        consultedFiles.push(`${disciplineScope[0]}/hot.md`);
      }
    }

    const hotRaw = await safeReadFile(join(wikiRoot, "hot.md"));
    if (hotRaw) consultedFiles.push("hot.md");
    const indexRaw = await safeReadFile(join(wikiRoot, "index.md"));
    if (indexRaw) consultedFiles.push("index.md");

    let disciplineIndexRaw = "";
    if (disciplineScope.length === 1) {
      const scoped = await safeReadFile(join(wikiRoot, disciplineScope[0]!, "_index.md"));
      if (scoped) {
        disciplineIndexRaw = scoped;
        consultedFiles.push(`${disciplineScope[0]}/_index.md`);
      }
    }

    return {
      consultedFiles,
      scopedHotTargets: extractWikiTargets(scopedHotRaw),
      hotTargets: extractWikiTargets(hotRaw),
      indexTargets: extractWikiTargets(indexRaw),
      disciplineIndexTargets: extractWikiTargets(disciplineIndexRaw),
    };
  }

  private async loadCandidatePages(
    pageFileIndex: WikiPageFileIndex,
    specialContext: WikiSpecialContext,
    disciplineScope: LiteratureDiscipline[],
    mode: Exclude<WikiRetrieveMode, "auto">,
  ): Promise<LoadedWikiPage[]> {
    const preferredTargets = specialContext.disciplineIndexTargets.size > 0 && disciplineScope.length === 1
      ? [
        ...specialContext.scopedHotTargets,
        ...specialContext.disciplineIndexTargets,
        ...seedTargetsForMode(mode),
      ]
      : [
        ...specialContext.scopedHotTargets,
        ...specialContext.hotTargets,
        ...specialContext.indexTargets,
        ...specialContext.disciplineIndexTargets,
        ...seedTargetsForMode(mode),
      ];

    const preferredRecords = resolveTargetsToRecords(preferredTargets, pageFileIndex, disciplineScope);
    const pages = await this.loadPages(preferredRecords);
    if (pages.length > 0) return pages;

    const scopedFallbackRecords = pageFileIndex.records.filter((record) => disciplineScope.includes(record.discipline));
    return this.loadPages(scopedFallbackRecords);
  }

  private async loadPages(records: WikiPageFileRecord[]): Promise<LoadedWikiPage[]> {
    const pages: LoadedWikiPage[] = [];
    const seenPaths = new Set<string>();
    for (const record of records) {
      if (seenPaths.has(record.path)) continue;
      const loaded = await this.loadWikiPage(record.path);
      if (loaded) pages.push(loaded);
      seenPaths.add(record.path);
    }
    return pages;
  }

  private async loadWikiPage(path: string): Promise<LoadedWikiPage | null> {
    try {
      const raw = await readFile(path, "utf8");
      const page = parseLiteratureWikiPageMarkdown(raw);
      if (!page) return null;
      return { page, path, raw };
    } catch {
      return null;
    }
  }

  private selectPrimaryPages(matches: WikiSearchMatch[], mode: Exclude<WikiRetrieveMode, "auto">, limit: number): WikiSearchMatch[] {
    const ranked = matches
      .map((match) => ({
        ...match,
        score: match.score + kindWeight(match.loaded.page.kind, mode),
      }))
      .sort((left, right) => right.score - left.score);

    if (mode === "landscape") {
      return this.selectLandscapePrimaryPages(ranked, limit);
    }

    if (mode === "claim_first") {
      return this.selectQuotaPrimaryPages(ranked, limit, [
        { kind: "claim", max: 3 },
        { kind: "synthesis", max: 2 },
        { kind: "topic", max: 1 },
        { kind: "paper", max: 2 },
      ]);
    }

    if (mode === "topic_first") {
      return this.selectQuotaPrimaryPages(ranked, limit, [
        { kind: "topic", max: 3 },
        { kind: "synthesis", max: 2 },
        { kind: "claim", max: 2 },
        { kind: "paper", max: 1 },
      ]);
    }

    if (mode === "paper_first") {
      return this.selectQuotaPrimaryPages(ranked, limit, [
        { kind: "paper", max: 3 },
        { kind: "claim", max: 2 },
        { kind: "topic", max: 1 },
        { kind: "synthesis", max: 1 },
      ]);
    }

    const selected: WikiSearchMatch[] = [];
    const seen = new Set<string>();
    for (const preferredKind of preferredKindsForMode(mode)) {
      const candidate = ranked.find((match) => !seen.has(match.loaded.page.pageKey) && match.loaded.page.kind === preferredKind);
      if (!candidate) continue;
      selected.push(candidate);
      seen.add(candidate.loaded.page.pageKey);
      if (selected.length >= limit) return selected;
    }

    for (const candidate of ranked) {
      if (seen.has(candidate.loaded.page.pageKey)) continue;
      selected.push(candidate);
      seen.add(candidate.loaded.page.pageKey);
      if (selected.length >= limit) break;
    }

    return selected;
  }

  private selectLandscapePrimaryPages(ranked: WikiSearchMatch[], limit: number): WikiSearchMatch[] {
    return this.selectQuotaPrimaryPages(ranked, limit, [
      { kind: "synthesis", max: 2 },
      { kind: "topic", max: 2 },
      { kind: "claim", max: 2 },
      { kind: "research_question", max: 1 },
      { kind: "finding", max: 1 },
      { kind: "formal_result", max: 1 },
      { kind: "paper", max: 2 },
      { kind: "method", max: 1 },
      { kind: "benchmark", max: 1 },
    ]);
  }

  private selectQuotaPrimaryPages(
    ranked: WikiSearchMatch[],
    limit: number,
    quotas: Array<{ kind: LiteratureWikiPage["kind"]; max: number }>,
  ): WikiSearchMatch[] {
    const selected: WikiSearchMatch[] = [];
    const seen = new Set<string>();

    for (const quota of quotas) {
      let count = 0;
      for (const candidate of ranked) {
        if (count >= quota.max || selected.length >= limit) break;
        if (seen.has(candidate.loaded.page.pageKey)) continue;
        if (candidate.loaded.page.kind !== quota.kind) continue;
        selected.push(candidate);
        seen.add(candidate.loaded.page.pageKey);
        count += 1;
      }
      if (selected.length >= limit) return selected;
    }

    for (const candidate of ranked) {
      if (seen.has(candidate.loaded.page.pageKey)) continue;
      selected.push(candidate);
      seen.add(candidate.loaded.page.pageKey);
      if (selected.length >= limit) break;
    }

    return selected;
  }

  private async expandPages(
    primary: WikiSearchMatch[],
    pages: LoadedWikiPage[],
    pageFileIndex: WikiPageFileIndex,
    disciplineScope: LiteratureDiscipline[],
    limit: number,
  ): Promise<WikiSearchMatch[]> {
    const byScopedKey = new Map(
      pages.map((loaded) => [scopedPageKey(loaded.page.discipline, loaded.page.pageKey), loaded] as const),
    );
    const seen = new Set(primary.map((match) => scopedPageKey(match.loaded.page.discipline, match.loaded.page.pageKey)));
    const expanded: WikiSearchMatch[] = [];
    for (const match of primary) {
      for (const linkedKey of literatureWikiPageLinks(match.loaded.page)) {
        const linkedRecord = resolveTargetsToRecords([linkedKey], pageFileIndex, disciplineScope)[0];
        if (!linkedRecord) continue;
        const linkedScopedKey = scopedPageKey(linkedRecord.discipline, linkedRecord.pageKey);
        if (seen.has(linkedScopedKey)) continue;
        let linked = byScopedKey.get(linkedScopedKey);
        if (!linked) {
          linked = await this.loadWikiPage(linkedRecord.path) ?? undefined;
          if (linked) byScopedKey.set(linkedScopedKey, linked);
        }
        if (!linked) continue;
        if (!disciplineScope.includes(linked.page.discipline)) continue;
        seen.add(linkedScopedKey);
        expanded.push({
          loaded: linked,
          score: 0.5 + kindWeight(linked.page.kind, "landscape"),
          snippet: linked.page.summary,
          reasons: [`linked from [[${match.loaded.page.pageKey}]]`],
        });
        if (expanded.length >= limit) return expanded;
      }
    }
    return expanded;
  }
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

function kindWeight(kind: LiteratureWikiPage["kind"], mode: Exclude<WikiRetrieveMode, "auto">): number {
  switch (mode) {
    case "landscape":
      return kind === "synthesis" ? 4 : kind === "topic" ? 3 : kind === "claim" ? 2 : 1;
    case "claim_first":
      return kind === "claim" ? 5 : kind === "synthesis" ? 4 : kind === "topic" ? 3 : kind === "paper" ? 2 : 1;
    case "topic_first":
      return kind === "topic" ? 5 : kind === "synthesis" ? 4 : kind === "claim" ? 3 : kind === "paper" ? 2 : 1;
    case "paper_first":
      return kind === "paper" ? 5 : kind === "claim" ? 3 : kind === "topic" ? 2 : 1;
  }
}

function seedTargetsForMode(mode: Exclude<WikiRetrieveMode, "auto">): string[] {
  switch (mode) {
    case "landscape":
      return [];
    case "claim_first":
      return [];
    case "topic_first":
      return [];
    case "paper_first":
      return [];
  }
}

function preferredKindsForMode(mode: Exclude<WikiRetrieveMode, "auto">): LiteratureWikiPage["kind"][] {
  switch (mode) {
    case "landscape":
      return ["synthesis", "topic", "claim", "paper"];
    case "claim_first":
      return ["claim", "synthesis", "topic", "paper"];
    case "topic_first":
      return ["topic", "synthesis", "claim", "paper"];
    case "paper_first":
      return ["paper", "claim", "topic", "synthesis"];
  }
}

function decideRetrieveMode(query: string, preferred: WikiRetrieveMode | undefined): Exclude<WikiRetrieveMode, "auto"> {
  if (preferred && preferred !== "auto") return preferred;
  const lowered = query.toLowerCase();
  if (/\bclaim|debate|contradict|consensus|evidence\b/u.test(lowered)) return "claim_first";
  if (/\bpaper|article|study\b/u.test(lowered)) return "paper_first";
  if (/\btopic|theme|landscape|field\b/u.test(lowered)) return "topic_first";
  return "landscape";
}

function normalizeDisciplineScope(input: LiteratureDiscipline[] | undefined): LiteratureDiscipline[] {
  return dedupeStrings((input ?? []).filter(Boolean)) as LiteratureDiscipline[];
}

function toRetrievePage(match: WikiSearchMatch, wikiRoot: string): WikiRetrievePage {
  return {
    pageKey: match.loaded.page.pageKey,
    title: match.loaded.page.title,
    kind: match.loaded.page.kind,
    discipline: match.loaded.page.discipline,
    summary: match.loaded.page.summary,
    path: relative(wikiRoot, match.loaded.path).replace(/\\/gu, "/"),
    score: match.score,
    snippet: match.snippet,
    reasons: match.reasons,
  };
}

function buildRetrieveRationale(
  mode: Exclude<WikiRetrieveMode, "auto">,
  disciplineScope: LiteratureDiscipline[],
  specialContext: WikiSpecialContext,
  primary: WikiSearchMatch[],
  expanded: WikiSearchMatch[],
): string[] {
  const lines = [`retrieve mode: ${mode}`];
  if (specialContext.consultedFiles.length > 0) {
    lines.push(`consulted special files: ${specialContext.consultedFiles.join(", ")}`);
    lines.push("candidate pages were loaded from special-file links before any broader fallback scan");
  }
  if (disciplineScope.length > 0) {
    lines.push(`restricted to disciplines: ${disciplineScope.join(", ")}`);
  }
  if (primary.length > 0) {
    lines.push(`selected ${primary.length} primary pages from search matches`);
    lines.push(`seeded primary pages by mode using: ${preferredKindsForMode(mode).join(" -> ")}`);
    if (mode === "landscape") {
      lines.push("landscape mode also tries to cover multiple page kinds so the reading set is broad rather than only top-level.");
    } else {
      lines.push(`${mode} keeps its main page kind in front, but still pulls in a small supporting mix from adjacent kinds.`);
    }
  }
  if (expanded.length > 0) {
    lines.push(`expanded ${expanded.length} linked pages for context`);
  }
  return lines;
}

function dedupeStrings(values: string[]): string[] {
  return [...new Set(values.filter((value) => value.trim().length > 0))];
}

function emptySearchContext(): WikiSearchContext {
  return {
    hotPageKeys: new Set<string>(),
    indexPageKeys: new Set<string>(),
    disciplineIndexPageKeys: new Set<string>(),
  };
}

function tokenizeQuery(query: string): string[] {
  return query
    .toLowerCase()
    .split(/[^a-z0-9_]+/u)
    .map((part) => part.trim())
    .filter((part) => part.length >= 2);
}

function scorePageMatch(
  loaded: LoadedWikiPage,
  loweredQuery: string,
  tokens: string[],
  context: WikiSearchContext,
): { score: number; snippet: string; reasons: string[] } {
  const page = loaded.page;
  const haystacks = [
    { field: "title", text: page.title.toLowerCase(), weight: 6 },
    { field: "summary", text: page.summary.toLowerCase(), weight: 4 },
    { field: "page_key", text: page.pageKey.toLowerCase(), weight: 3 },
    { field: "tags", text: page.tags.join(" ").toLowerCase(), weight: 2 },
    { field: "aliases", text: page.aliases.join(" ").toLowerCase(), weight: 2 },
    { field: "body", text: loaded.raw.toLowerCase(), weight: 1 },
  ];

  let score = 0;
  const reasons: string[] = [];
  for (const haystack of haystacks) {
    if (loweredQuery && haystack.text.includes(loweredQuery)) {
      score += haystack.weight * 2;
      reasons.push(`matched ${haystack.field}`);
    }
    for (const token of tokens) {
      if (haystack.text.includes(token)) score += haystack.weight;
    }
  }

  if (context.hotPageKeys.has(page.pageKey)) {
    score += 3;
    reasons.push("mentioned in hot.md");
  }
  if (context.indexPageKeys.has(page.pageKey)) {
    score += 1.5;
    reasons.push("mentioned in index.md");
  }
  if (context.disciplineIndexPageKeys.has(page.pageKey)) {
    score += 2;
    reasons.push("mentioned in discipline index");
  }

  const snippet = extractSnippet(loaded.raw, loweredQuery || tokens[0] || "") ?? page.summary;
  return {
    score,
    snippet,
    reasons: dedupeStrings(reasons),
  };
}

function extractSnippet(raw: string, term: string): string | null {
  if (!term) return null;
  const lowered = raw.toLowerCase();
  const index = lowered.indexOf(term.toLowerCase());
  if (index < 0) return null;
  const start = Math.max(0, index - 80);
  const end = Math.min(raw.length, index + term.length + 120);
  return raw.slice(start, end).replace(/\s+/gu, " ").trim();
}

function pageFileRecordFromPath(root: string, path: string): WikiPageFileRecord | null {
  const relativePath = relative(root, path).replace(/\\/gu, "/");
  const segments = relativePath.split("/").filter(Boolean);
  const fileName = segments.at(-1) ?? "";
  if (!fileName.toLowerCase().endsWith(".md")) return null;
  if (fileName.toLowerCase() === "index.md" || fileName.toLowerCase() === "hot.md" || fileName.toLowerCase() === "log.md") return null;
  if (fileName.toLowerCase() === "_index.md") return null;
  if (segments.length < 3) return null;
  const [discipline, directory] = segments;
  if (!isLiteratureDiscipline(discipline) || !directory) return null;
  const kind = pageKindFromDirectory(directory);
  if (!kind) return null;
  const pageKey = fileName.replace(/\.md$/iu, "").trim();
  if (!pageKey) return null;
  return {
    pageKey,
    discipline,
    kind,
    path,
    relativeNoExtPath: relativePath.replace(/\.md$/iu, ""),
  };
}

async function safeReadFile(path: string): Promise<string> {
  try {
    return await readFile(path, "utf8");
  } catch {
    return "";
  }
}

function extractWikiTargets(raw: string): Set<string> {
  const links = new Set<string>();
  for (const match of raw.matchAll(/\[\[([^\]]+)\]\]/gu)) {
    const target = normalizeWikiTarget((match[1] ?? "").trim());
    if (!target) continue;
    links.add(target);
  }
  return links;
}

function normalizeWikiTarget(target: string): string {
  const cleaned = target
    .split("|")[0]
    ?.split("#")[0]
    ?.replace(/\\/gu, "/")
    .replace(/\.md$/iu, "")
    .trim();
  return cleaned ?? "";
}

function resolveTargetPageKeys(targets: string[], pageFileIndex: WikiPageFileIndex, disciplineScope: LiteratureDiscipline[]): string[] {
  return dedupeStrings(
    resolveTargetsToRecords(targets, pageFileIndex, disciplineScope).map((record) => record.pageKey),
  );
}

function resolveTargetsToRecords(
  targets: Iterable<string>,
  pageFileIndex: WikiPageFileIndex,
  disciplineScope: LiteratureDiscipline[],
): WikiPageFileRecord[] {
  const resolved: WikiPageFileRecord[] = [];
  const seen = new Set<string>();
  for (const rawTarget of targets) {
    const target = normalizeWikiTarget(rawTarget);
    if (!target || isSpecialWikiTarget(target)) continue;

    const direct = pageFileIndex.byRelativeNoExtPath.get(target);
    if (direct && disciplineScope.includes(direct.discipline)) {
      const key = scopedPageKey(direct.discipline, direct.pageKey);
      if (!seen.has(key)) {
        resolved.push(direct);
        seen.add(key);
      }
      continue;
    }

    const pathResolved = resolvePathLikeTarget(target, pageFileIndex, disciplineScope);
    if (pathResolved) {
      const key = scopedPageKey(pathResolved.discipline, pathResolved.pageKey);
      if (!seen.has(key)) {
        resolved.push(pathResolved);
        seen.add(key);
      }
      continue;
    }

    const pageKey = target.split("/").pop() ?? "";
    if (!pageKey) continue;
    for (const discipline of disciplineScope) {
      const scoped = pageFileIndex.byScopedPageKey.get(scopedPageKey(discipline, pageKey));
      if (!scoped) continue;
      const key = scopedPageKey(scoped.discipline, scoped.pageKey);
      if (!seen.has(key)) {
        resolved.push(scoped);
        seen.add(key);
      }
    }
  }
  return resolved;
}

function resolvePathLikeTarget(
  target: string,
  pageFileIndex: WikiPageFileIndex,
  disciplineScope: LiteratureDiscipline[],
): WikiPageFileRecord | null {
  const segments = target.split("/").filter(Boolean);
  if (segments.length !== 2) return null;
  const [prefix, pageKey] = segments;
  if (!prefix || !pageKey) return null;
  for (const discipline of disciplineScope) {
    const direct = pageFileIndex.byRelativeNoExtPath.get(`${discipline}/${prefix}/${pageKey}`);
    if (direct) return direct;
  }
  return null;
}

function isSpecialWikiTarget(target: string): boolean {
  return target === "index"
    || target === "hot"
    || target === "log"
    || target.startsWith("indexes/")
    || target.endsWith("/_index");
}

function pageKindFromDirectory(directory: string): LiteratureWikiPage["kind"] | null {
  switch (directory) {
    case "papers":
      return "paper";
    case "research_questions":
      return "research_question";
    case "methods":
      return "method";
    case "benchmarks":
      return "benchmark";
    case "findings":
      return "finding";
    case "formal_results":
      return "formal_result";
    case "claims":
      return "claim";
    case "topics":
      return "topic";
    case "syntheses":
      return "synthesis";
    default:
      return null;
  }
}

function isLiteratureDiscipline(value: string): value is LiteratureDiscipline {
  return [
    "artificial_intelligence",
    "mathematics",
    "chemistry",
    "chemical_engineering",
    "physics",
    "general_science",
    "unknown",
  ].includes(value);
}

function scopedPageKey(discipline: LiteratureDiscipline, pageKey: string): string {
  return `${discipline}::${pageKey}`;
}
