import type { LiteratureDiscipline, PaperDigestSchemaFamily } from "./PaperDigest.js";

export type SupportedLiteratureWikiPageKind =
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
  | "synthesis"
  | "overview";

export interface BaseLiteratureWikiPage {
  schemaVersion: "kaivu-literature-wiki-page-v1";
  discipline: LiteratureDiscipline;
  kind: SupportedLiteratureWikiPageKind;
  pageKey: string;
  title: string;
  summary: string;
  tags: string[];
  aliases: string[];
  sourcePaperKeys: string[];
  updatedAt: string;
  domainScope: string[];
}

export interface LiteratureWikiPaperPage extends BaseLiteratureWikiPage {
  kind: "paper";
  canonicalPaperKey: string;
  schemaFamily: PaperDigestSchemaFamily;
  selectionReason: string;
  citationLine?: string | null;
  researchProblem: string;
  approach: string;
  keyContributions: string[];
  keyClaims: string[];
  findings: string[];
  limitations: string[];
  importantTerms: string[];
  relatedPageKeys: string[];
}

export interface LiteratureWikiClaimPage extends BaseLiteratureWikiPage {
  kind: "claim";
  claimText: string;
  claimStatus: "provisional" | "active" | "contested" | "needs_revisit" | "stale" | "superseded";
  supportPaperKeys: string[];
  contradictPaperKeys: string[];
  qualifyPaperKeys: string[];
  topicPageKeys: string[];
  contradictions: string[];
  tensions: string[];
  notes: string[];
}

export interface LiteratureWikiEntityPage extends BaseLiteratureWikiPage {
  kind: "author" | "concept" | "method" | "task" | "evidence_source" | "evaluation_setup" | "measure";
  statement: string;
  rationale: string;
  relatedPageKeys: string[];
  patchOutline: string[];
}

export interface LiteratureWikiTopicPage extends BaseLiteratureWikiPage {
  kind: "topic";
  topicStatement: string;
  scopeNotes: string[];
  currentThreads: string[];
  keyPageKeys: string[];
  claimPageKeys: string[];
  openTensions: string[];
  openQuestions: string[];
}

export interface LiteratureWikiSynthesisPage extends BaseLiteratureWikiPage {
  kind: "synthesis";
  synthesisStatement: string;
  integratedTakeaway: string;
  scopeNotes: string[];
  stateOfPlay: string[];
  synthesis: string[];
  keyPageKeys: string[];
  claimPageKeys: string[];
  contradictions: string[];
  tensions: string[];
  openQuestions: string[];
}

export interface LiteratureWikiOverviewPage extends BaseLiteratureWikiPage {
  kind: "overview";
  executiveSummary: string;
  currentPicture: string[];
  keyTensions: string[];
  majorThemePageKeys: string[];
  synthesisPageKeys: string[];
  keyClaimPageKeys: string[];
  startHerePageKeys: string[];
  openFrontPageKeys: string[];
}

export type LiteratureWikiPage =
  | LiteratureWikiPaperPage
  | LiteratureWikiEntityPage
  | LiteratureWikiClaimPage
  | LiteratureWikiTopicPage
  | LiteratureWikiSynthesisPage
  | LiteratureWikiOverviewPage;

export interface LiteratureWikiGraphSnapshot {
  pageCount: number;
  inboundByPageKey: Record<string, string[]>;
  outboundByPageKey: Record<string, string[]>;
  orphanPageKeys: string[];
  danglingReferences: Array<{ fromPageKey: string; toPageKey: string }>;
}

export function literatureWikiPagePath(root: string, page: LiteratureWikiPage): string {
  return `${root.replace(/[\\/]+$/u, "")}/${literatureWikiPageDirectory(page.discipline, page.kind)}/${safeWikiPageKey(page.pageKey)}.md`;
}

export function literatureWikiPageDirectory(discipline: LiteratureDiscipline, kind: SupportedLiteratureWikiPageKind): string {
  switch (kind) {
    case "paper":
      return `${discipline}/papers`;
    case "author":
      return `${discipline}/authors`;
    case "concept":
      return `${discipline}/concepts`;
    case "method":
      return `${discipline}/methods`;
    case "task":
      return `${discipline}/tasks`;
    case "evidence_source":
      return `${discipline}/evidence_sources`;
    case "evaluation_setup":
      return `${discipline}/evaluation_setups`;
    case "measure":
      return `${discipline}/measures`;
    case "claim":
      return `${discipline}/claims`;
    case "topic":
      return `${discipline}/topics`;
    case "synthesis":
      return `${discipline}/syntheses`;
    case "overview":
      return `${discipline}/overview`;
  }
}

export function renderLiteratureWikiPageMarkdown(page: LiteratureWikiPage): string {
  const frontmatter = renderFrontmatter(page);
  const body = renderPageBody(page);
  return `${frontmatter}\n\n${body}\n`;
}

function renderFrontmatter(page: LiteratureWikiPage): string {
  return [
    "---",
    `schema_version: ${page.schemaVersion}`,
    `discipline: ${yamlString(page.discipline)}`,
    `kind: ${page.kind}`,
    `page_key: ${yamlString(page.pageKey)}`,
    `title: ${yamlString(page.title)}`,
    `summary: ${yamlString(page.summary)}`,
    `updated_at: ${yamlString(page.updatedAt)}`,
    `domain_scope: ${yamlArray(page.domainScope)}`,
    `tags: ${yamlArray(page.tags)}`,
    `aliases: ${yamlArray(page.aliases)}`,
    `source_paper_keys: ${yamlArray(page.sourcePaperKeys)}`,
    "---",
  ].join("\n");
}

function renderPageBody(page: LiteratureWikiPage): string {
  const lines = [`# ${page.title}`, "", page.summary];
  switch (page.kind) {
    case "paper":
      if (page.citationLine) lines.push("", "## Citation", "", page.citationLine);
      lines.push(
        "",
        "## Paper Profile",
        "",
        `- Canonical paper key: \`${page.canonicalPaperKey}\``,
        `- Schema family: \`${page.schemaFamily}\``,
        `- Family selection: ${page.selectionReason}`,
        "",
        "## Research Problem",
        "",
        page.researchProblem,
        "",
        "## Approach",
        "",
        page.approach,
      );
      pushBulletSection(lines, "Key Contributions", page.keyContributions);
      pushBulletSection(lines, "Key Claims", page.keyClaims);
      pushBulletSection(lines, "Findings", page.findings);
      pushBulletSection(lines, "Limitations", page.limitations);
      pushBulletSection(lines, "Important Terms", page.importantTerms);
      pushBulletSection(lines, "Related Pages", page.relatedPageKeys.map((key) => `[[${key}]]`));
      return lines.join("\n");
    case "claim":
      lines.push(
        "",
        "## Claim",
        "",
        page.claimText,
        "",
        "## Status",
        "",
        `- Claim status: \`${page.claimStatus}\``,
      );
      pushBulletSection(lines, "Supporting Papers", page.supportPaperKeys.map((key) => `[[${key}]]`));
      pushBulletSection(lines, "Contradicting Papers", page.contradictPaperKeys.map((key) => `[[${key}]]`));
      pushBulletSection(lines, "Qualifying Papers", page.qualifyPaperKeys.map((key) => `[[${key}]]`));
      pushBulletSection(lines, "Related Topics", page.topicPageKeys.map((key) => `[[${key}]]`));
      pushBulletSection(lines, "Contradictions", page.contradictions);
      pushBulletSection(lines, "Tensions", page.tensions);
      pushBulletSection(lines, "Notes", page.notes);
      return lines.join("\n");
    case "author":
    case "concept":
    case "method":
    case "task":
    case "evidence_source":
    case "evaluation_setup":
    case "measure":
      lines.push(
        "",
        "## Statement",
        "",
        page.statement,
        "",
        "## Rationale",
        "",
        page.rationale,
      );
      pushBulletSection(lines, "Patch Outline", page.patchOutline);
      pushBulletSection(lines, "Related Pages", page.relatedPageKeys.map((key) => `[[${key}]]`));
      return lines.join("\n");
    case "topic":
      lines.push(
        "",
        "## Topic Statement",
        "",
        page.topicStatement,
      );
      pushBulletSection(lines, "Scope Notes", page.scopeNotes);
      pushBulletSection(lines, "Current Threads", page.currentThreads);
      pushBulletSection(lines, "Related Pages", page.keyPageKeys.map((key) => `[[${key}]]`));
      pushBulletSection(lines, "Claim Pages", page.claimPageKeys.map((key) => `[[${key}]]`));
      pushBulletSection(lines, "Open Tensions", page.openTensions);
      pushBulletSection(lines, "Open Questions", page.openQuestions);
      return lines.join("\n");
    case "synthesis":
      lines.push(
        "",
        "## Synthesis Statement",
        "",
        page.synthesisStatement,
      );
      lines.push(
        "",
        "## Integrated Takeaway",
        "",
        page.integratedTakeaway,
      );
      pushBulletSection(lines, "Scope Notes", page.scopeNotes);
      pushBulletSection(lines, "State Of Play", page.stateOfPlay);
      pushBulletSection(lines, "Synthesis", page.synthesis);
      pushBulletSection(lines, "Key Pages", page.keyPageKeys.map((key) => `[[${key}]]`));
      pushBulletSection(lines, "Claim Pages", page.claimPageKeys.map((key) => `[[${key}]]`));
      pushBulletSection(lines, "Contradictions", page.contradictions);
      pushBulletSection(lines, "Tensions", page.tensions);
      pushBulletSection(lines, "Open Questions", page.openQuestions);
      return lines.join("\n");
    case "overview":
      lines.push(
        "",
        "## Executive Summary",
        "",
        page.executiveSummary,
      );
      pushBulletSection(lines, "Current Picture", page.currentPicture);
      pushBulletSection(lines, "Key Tensions", page.keyTensions);
      pushBulletSection(lines, "Major Themes", page.majorThemePageKeys.map((key) => `[[${key}]]`));
      pushBulletSection(lines, "Syntheses", page.synthesisPageKeys.map((key) => `[[${key}]]`));
      pushBulletSection(lines, "Key Claims", page.keyClaimPageKeys.map((key) => `[[${key}]]`));
      pushBulletSection(lines, "Start Here", page.startHerePageKeys.map((key) => `[[${key}]]`));
      pushBulletSection(lines, "Open Fronts", page.openFrontPageKeys.map((key) => `[[${key}]]`));
      return lines.join("\n");
  }
}

export function literatureWikiPageLinks(page: LiteratureWikiPage): string[] {
  switch (page.kind) {
    case "paper":
      return page.relatedPageKeys;
    case "claim":
      return [
        ...page.supportPaperKeys,
        ...page.contradictPaperKeys,
        ...page.qualifyPaperKeys,
        ...page.topicPageKeys,
      ];
    case "author":
    case "concept":
    case "method":
    case "task":
    case "evidence_source":
    case "evaluation_setup":
    case "measure":
      return page.relatedPageKeys;
    case "topic":
      return [
        ...page.keyPageKeys,
        ...page.claimPageKeys,
      ];
    case "synthesis":
      return [
        ...page.keyPageKeys,
        ...page.claimPageKeys,
      ];
    case "overview":
      return [
        ...page.openFrontPageKeys,
        ...page.majorThemePageKeys,
        ...page.synthesisPageKeys,
        ...page.keyClaimPageKeys,
        ...page.startHerePageKeys,
      ];
  }
}

export function buildLiteratureWikiGraph(pages: LiteratureWikiPage[]): LiteratureWikiGraphSnapshot {
  const byKey = new Map(pages.map((page) => [page.pageKey, page] as const));
  const inbound = new Map<string, Set<string>>();
  const outbound = new Map<string, Set<string>>();
  const danglingReferences: Array<{ fromPageKey: string; toPageKey: string }> = [];

  for (const page of pages) {
    const links = dedupeStrings(literatureWikiPageLinks(page));
    outbound.set(page.pageKey, new Set(links));
    for (const linkedKey of links) {
      inbound.set(linkedKey, new Set([...(inbound.get(linkedKey) ?? []), page.pageKey]));
      if (!byKey.has(linkedKey)) {
        danglingReferences.push({ fromPageKey: page.pageKey, toPageKey: linkedKey });
      }
    }
  }

  const orphanPageKeys = pages
    .filter((page) => page.kind !== "overview" && (inbound.get(page.pageKey)?.size ?? 0) === 0)
    .map((page) => page.pageKey);

  return {
    pageCount: pages.length,
    inboundByPageKey: Object.fromEntries(
      pages.map((page) => [page.pageKey, [...(inbound.get(page.pageKey) ?? new Set())].sort()]),
    ),
    outboundByPageKey: Object.fromEntries(
      pages.map((page) => [page.pageKey, [...(outbound.get(page.pageKey) ?? new Set())].sort()]),
    ),
    orphanPageKeys,
    danglingReferences,
  };
}

export function buildLiteratureWikiOverviewPage(
  pages: LiteratureWikiPage[],
  updatedAt = new Date().toISOString(),
  options?: {
    discipline?: LiteratureDiscipline;
    pageKey?: string;
    title?: string;
    summary?: string;
    aliases?: string[];
  },
): LiteratureWikiOverviewPage {
  const paperPages = pages.filter((page): page is LiteratureWikiPaperPage => page.kind === "paper");
  const claimPages = pages.filter((page): page is LiteratureWikiClaimPage => page.kind === "claim");
  const topicPages = pages.filter((page): page is LiteratureWikiTopicPage => page.kind === "topic");
  const synthesisPages = pages.filter((page): page is LiteratureWikiSynthesisPage => page.kind === "synthesis");
  const openFrontPageKeys = topicPages
    .filter((page) => page.openQuestions.length > 0)
    .map((page) => page.pageKey);
  const startHerePageKeys = dedupeStrings([
    ...synthesisPages.slice(0, 3).map((page) => page.pageKey),
    ...topicPages.slice(0, 3).map((page) => page.pageKey),
    ...paperPages.slice(0, 2).map((page) => page.pageKey),
  ]).slice(0, 6);
  const majorThemePageKeys = topicPages
    .slice()
    .sort((left, right) => right.keyPageKeys.length - left.keyPageKeys.length)
    .slice(0, 8)
    .map((page) => page.pageKey);
  const keyClaimPageKeys = claimPages
    .slice()
    .sort((left, right) => (
      right.supportPaperKeys.length + right.contradictPaperKeys.length + right.qualifyPaperKeys.length
    ) - (
      left.supportPaperKeys.length + left.contradictPaperKeys.length + left.qualifyPaperKeys.length
    ))
    .slice(0, 8)
    .map((page) => page.pageKey);
  const activeClaimPages = claimPages.filter((page) => page.claimStatus === "active");
  const contestedClaimPages = claimPages.filter((page) => page.claimStatus === "contested" || page.claimStatus === "needs_revisit");
  const executiveSummary = synthesisPages.length > 0
    ? `This wiki currently organizes ${paperPages.length} paper pages around ${topicPages.length} major topic pages and ${synthesisPages.length} active synthesis pages. The current big picture is already partially compiled into cross-source syntheses rather than living only in individual paper notes.`
    : `This wiki currently organizes ${paperPages.length} paper pages around ${topicPages.length} major topic pages and ${claimPages.length} tracked claim pages. The big picture is emerging primarily through topic and claim updates, with room for more explicit synthesis pages as the literature base grows.`;
  const currentPicture = dedupeStrings([
    topicPages.length > 0
      ? `The strongest organizing themes right now are ${topicPages.slice(0, 3).map((page) => `[[${page.pageKey}]]`).join(", ")}.`
      : "",
    activeClaimPages.length > 0
      ? `There are ${activeClaimPages.length} active claim pages with direct supporting evidence from ingested papers.`
      : "",
    synthesisPages.length > 0
      ? `Cross-source synthesis is currently concentrated in ${synthesisPages.slice(0, 3).map((page) => `[[${page.pageKey}]]`).join(", ")}.`
      : "",
  ]);
  const keyTensions = dedupeStrings([
    contestedClaimPages.length > 0
      ? `The main tensions are concentrated in ${contestedClaimPages.slice(0, 4).map((page) => `[[${page.pageKey}]]`).join(", ")}.`
      : "",
    openFrontPageKeys.length > 0
      ? `Open fronts remain most visible in ${openFrontPageKeys.slice(0, 4).map((page) => `[[${page}]]`).join(", ")}.`
      : "",
  ]);

  return {
    schemaVersion: "kaivu-literature-wiki-page-v1",
    discipline: options?.discipline ?? inferOverviewDiscipline(pages),
    kind: "overview",
    pageKey: options?.pageKey ?? "literature_overview",
    title: options?.title ?? "Literature Overview",
    summary: options?.summary ?? "Executive summary of the literature wiki: current picture, key tensions, major themes, and where to start reading.",
    tags: ["overview", "literature", "wiki"],
    aliases: options?.aliases ?? ["literature_index", "wiki_overview"],
    sourcePaperKeys: dedupeStrings(pages.flatMap((page) => page.sourcePaperKeys)),
    updatedAt,
    domainScope: dedupeStrings(pages.flatMap((page) => page.domainScope)),
    executiveSummary,
    currentPicture,
    keyTensions,
    majorThemePageKeys,
    synthesisPageKeys: synthesisPages.map((page) => page.pageKey),
    keyClaimPageKeys,
    startHerePageKeys,
    openFrontPageKeys,
  };
}

export function parseLiteratureWikiPageMarkdown(raw: string): LiteratureWikiPage | null {
  const frontmatterMatch = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/u);
  if (!frontmatterMatch) return null;
  const frontmatter = parseSimpleFrontmatter(frontmatterMatch[1] ?? "");
  const kind = normalizePageKind(frontmatter.kind);
  if (!kind) return null;
  const discipline = normalizeDiscipline(frontmatter.discipline);
  const title = asString(frontmatter.title);
  const pageKey = asString(frontmatter.page_key);
  const summary = asString(frontmatter.summary);
  const updatedAt = asString(frontmatter.updated_at);
  const domainScope = asStringArray(frontmatter.domain_scope);
  const tags = asStringArray(frontmatter.tags);
  const aliases = asStringArray(frontmatter.aliases);
  const sourcePaperKeys = asStringArray(frontmatter.source_paper_keys);
  const body = raw.slice(frontmatterMatch[0].length).trim();
  const sections = parseSections(body);

  const base = {
    schemaVersion: "kaivu-literature-wiki-page-v1" as const,
    discipline,
    kind,
    pageKey,
    title,
    summary,
    tags,
    aliases,
    sourcePaperKeys,
    updatedAt,
    domainScope,
  };

  switch (kind) {
    case "paper":
      return {
        ...base,
        kind,
        canonicalPaperKey: readProfileValue(sections["Paper Profile"], "Canonical paper key") ?? pageKey,
        schemaFamily: normalizeSchemaFamily(readProfileValue(sections["Paper Profile"], "Schema family")),
        selectionReason: readProfileValue(sections["Paper Profile"], "Family selection") ?? "",
        citationLine: readParagraph(sections["Citation"]) || null,
        researchProblem: readParagraph(sections["Research Problem"]),
        approach: readParagraph(sections["Approach"]),
        keyContributions: readBullets(sections["Key Contributions"]),
        keyClaims: readBullets(sections["Key Claims"]),
        findings: readBullets(sections["Findings"]),
        limitations: readBullets(sections["Limitations"]),
        importantTerms: readBullets(sections["Important Terms"]),
        relatedPageKeys: readWikiBullets(sections["Related Pages"]),
      };
    case "claim":
      return {
        ...base,
        kind,
        claimText: readParagraph(sections["Claim"]),
        claimStatus: normalizeClaimStatus(readProfileValue(sections["Status"], "Claim status")),
        supportPaperKeys: readWikiBullets(sections["Supporting Papers"]),
        contradictPaperKeys: readWikiBullets(sections["Contradicting Papers"]),
        qualifyPaperKeys: readWikiBullets(sections["Qualifying Papers"]),
        topicPageKeys: readWikiBullets(sections["Related Topics"]),
        contradictions: readBullets(sections["Contradictions"]),
        tensions: readBullets(sections["Tensions"]),
        notes: readBullets(sections["Notes"]),
      };
    case "author":
    case "concept":
    case "method":
    case "task":
    case "evidence_source":
    case "evaluation_setup":
    case "measure":
      return {
        ...base,
        kind,
        statement: readParagraph(sections["Statement"]),
        rationale: readParagraph(sections["Rationale"]),
        relatedPageKeys: readWikiBullets(sections["Related Pages"]),
        patchOutline: readBullets(sections["Patch Outline"]),
      };
    case "topic":
      return {
        ...base,
        kind,
        topicStatement: readParagraph(sections["Topic Statement"]),
        scopeNotes: readBullets(sections["Scope Notes"]),
        currentThreads: readBullets(sections["Current Threads"]),
        keyPageKeys: readWikiBullets(sections["Related Pages"]),
        claimPageKeys: readWikiBullets(sections["Claim Pages"]),
        openTensions: readBullets(sections["Open Tensions"]),
        openQuestions: readBullets(sections["Open Questions"]),
      };
    case "synthesis":
      return {
        ...base,
        kind,
        synthesisStatement: readParagraph(sections["Synthesis Statement"]),
        integratedTakeaway: readParagraph(sections["Integrated Takeaway"]),
        scopeNotes: readBullets(sections["Scope Notes"]),
        stateOfPlay: readBullets(sections["State Of Play"]),
        synthesis: readBullets(sections["Synthesis"]),
        keyPageKeys: readWikiBullets(sections["Key Pages"]),
        claimPageKeys: readWikiBullets(sections["Claim Pages"]),
        contradictions: readBullets(sections["Contradictions"]),
        tensions: readBullets(sections["Tensions"]),
        openQuestions: readBullets(sections["Open Questions"]),
      };
    case "overview":
      return {
        ...base,
        kind,
        executiveSummary: readParagraph(sections["Executive Summary"]),
        currentPicture: readBullets(sections["Current Picture"]),
        keyTensions: readBullets(sections["Key Tensions"]),
        majorThemePageKeys: readWikiBullets(sections["Major Themes"]),
        synthesisPageKeys: readWikiBullets(sections["Syntheses"]),
        keyClaimPageKeys: readWikiBullets(sections["Key Claims"]),
        startHerePageKeys: readWikiBullets(sections["Start Here"]),
        openFrontPageKeys: readWikiBullets(sections["Open Fronts"]),
      };
  }
}

function pushBulletSection(lines: string[], title: string, items: string[]): void {
  if (items.length === 0) return;
  lines.push("", `## ${title}`, "", ...items.map((item) => `- ${item}`));
}

function yamlString(value: string): string {
  return JSON.stringify(value);
}

function yamlArray(values: string[]): string {
  return `[${values.map((value) => JSON.stringify(value)).join(", ")}]`;
}

function safeWikiPageKey(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9._-]+/g, "_").replace(/^_+|_+$/g, "") || "page";
}

function parseSimpleFrontmatter(frontmatter: string): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const line of frontmatter.split(/\r?\n/u)) {
    const match = line.match(/^([a-zA-Z0-9_]+):\s*(.*)$/u);
    if (!match) continue;
    const key = match[1];
    const rawValue = match[2]?.trim() ?? "";
    if (rawValue.startsWith("[") && rawValue.endsWith("]")) {
      try {
        result[key] = JSON.parse(rawValue);
      } catch {
        result[key] = [];
      }
      continue;
    }
    result[key] = rawValue.replace(/^["']|["']$/gu, "");
  }
  return result;
}

function parseSections(body: string): Record<string, string[]> {
  const lines = body.split(/\r?\n/u);
  const sections: Record<string, string[]> = {};
  let current = "_lead";
  sections[current] = [];
  for (const line of lines) {
    const heading = line.match(/^##\s+(.+)$/u);
    if (heading) {
      current = heading[1]?.trim() ?? current;
      sections[current] = [];
      continue;
    }
    sections[current].push(line);
  }
  return sections;
}

function readParagraph(lines: string[] | undefined): string {
  return (lines ?? []).map((line) => line.trim()).filter(Boolean).filter((line) => !line.startsWith("- ")).join(" ").trim();
}

function readBullets(lines: string[] | undefined): string[] {
  return dedupeStrings((lines ?? []).map((line) => line.trim()).filter((line) => line.startsWith("- ")).map((line) => line.slice(2).trim()));
}

function readWikiBullets(lines: string[] | undefined): string[] {
  return dedupeStrings(readBullets(lines).flatMap((item) => extractWikiLinks(item)));
}

function readProfileValue(lines: string[] | undefined, label: string): string | undefined {
  for (const line of lines ?? []) {
    const normalized = line.trim();
    if (!normalized.startsWith("- ")) continue;
    const rest = normalized.slice(2);
    const split = rest.split(":");
    if (split.length < 2) continue;
    const key = split.shift()?.trim().toLowerCase();
    if (key !== label.trim().toLowerCase()) continue;
    return split.join(":").trim().replace(/^`|`$/gu, "");
  }
  return undefined;
}

function extractWikiLinks(text: string): string[] {
  return dedupeStrings([...text.matchAll(/\[\[([^\]]+)\]\]/gu)].map((match) => (match[1] ?? "").trim()).filter(Boolean));
}

function dedupeStrings(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : String(value ?? "").trim();
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? dedupeStrings(value.map((entry) => asString(entry))) : [];
}

function normalizePageKind(value: unknown): SupportedLiteratureWikiPageKind | null {
  const text = asString(value);
  return [
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
    "overview",
  ].includes(text) ? text as SupportedLiteratureWikiPageKind : null;
}

function normalizeSchemaFamily(value: unknown): PaperDigestSchemaFamily {
  const text = asString(value);
  return [
    "computational_empirical",
    "experimental_empirical",
    "methodological_or_instrumentation",
    "theoretical_or_mathematical",
    "review_or_survey",
  ].includes(text) ? text as PaperDigestSchemaFamily : "computational_empirical";
}

function normalizeClaimStatus(value: unknown): LiteratureWikiClaimPage["claimStatus"] {
  const text = asString(value);
  return [
    "provisional",
    "active",
    "contested",
    "needs_revisit",
    "stale",
    "superseded",
  ].includes(text) ? text as LiteratureWikiClaimPage["claimStatus"] : "provisional";
}

function normalizeDiscipline(value: unknown): LiteratureDiscipline {
  const text = asString(value);
  return [
    "artificial_intelligence",
    "mathematics",
    "chemistry",
    "chemical_engineering",
    "physics",
    "general_science",
    "unknown",
  ].includes(text) ? text as LiteratureDiscipline : "unknown";
}

function inferOverviewDiscipline(pages: LiteratureWikiPage[]): LiteratureDiscipline {
  const disciplines = dedupeStrings(pages.map((page) => page.discipline).filter((value) => value !== "unknown"));
  if (disciplines.length === 1) return normalizeDiscipline(disciplines[0]);
  if (disciplines.length > 1) return "general_science";
  return "unknown";
}
