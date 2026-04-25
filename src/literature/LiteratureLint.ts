import { appendFile, access, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  parseStructuredOutput,
  repairInstruction,
  salvageStructuredOutput,
  type StructuredSchema,
} from "../structured/StructuredOutput.js";
import {
  buildLiteratureWikiGraph,
  parseLiteratureWikiPageMarkdown,
  type LiteratureWikiPage,
  type SupportedLiteratureWikiPageKind,
} from "./LiteratureWikiPage.js";

export type LiteratureLintSeverity = "low" | "medium" | "high";

export type LiteratureLintIssueKind =
  | "orphan_page"
  | "missing_referenced_page"
  | "claim_without_evidence"
  | "topic_without_claims"
  | "paper_without_links"
  | "duplicate_title"
  | "overview_missing"
  | "stale_claim"
  | "contradiction"
  | "missing_cross_reference"
  | "gap_fillable_by_search"
  | "missing_page_candidate";

export interface LiteratureLintIssue {
  kind: LiteratureLintIssueKind;
  severity: LiteratureLintSeverity;
  pageKeys: string[];
  rationale: string;
  suggestedActions: string[];
}

export interface LiteratureLintReport {
  wikiRoot?: string;
  generatedAt: string;
  summary: string;
  issueCount: number;
  issues: LiteratureLintIssue[];
  suggestedQuestions: string[];
  suggestedSources: string[];
}

export interface LiteratureLintSemanticOutput {
  summary: string;
  issues: LiteratureLintIssue[];
  suggestedQuestions: string[];
  suggestedSources: string[];
}

export interface LiteratureLintRequest {
  wikiRoot?: string;
  pages?: LiteratureWikiLintPage[];
}

export interface LiteratureLintWriteResult {
  reportPath: string;
  logPath: string;
}

export interface LiteratureLintModelStepOptions {
  stepId?: string;
  system?: string;
  prompt: string;
  includeRenderedContext?: boolean;
  stream?: boolean;
  stageUserInputPolicy?: string | string[] | false;
}

export type LiteratureLintModelStepRunner = (
  options: LiteratureLintModelStepOptions,
) => Promise<string>;

export interface LiteratureWikiLintPage {
  kind: SupportedLiteratureWikiPageKind;
  pageKey: string;
  title: string;
  summary: string;
  sourcePaperKeys: string[];
  linksTo: string[];
  updatedAt?: string;
}

export const LITERATURE_LINT_MODEL_OUTPUT_SHAPE = {
  summary: "string",
  issues: [
    {
      kind:
    "stale_claim | contradiction | missing_cross_reference | gap_fillable_by_search | missing_page_candidate | overview_missing",
      severity: "low | medium | high",
      pageKeys: ["string"],
      rationale: "string",
      suggestedActions: ["string"],
    },
  ],
  suggestedQuestions: ["string"],
  suggestedSources: ["string"],
} as const;

const LITERATURE_LINT_OUTPUT_SCHEMA: StructuredSchema = {
  name: "literature_lint_report",
  description: "Structured semantic lint findings for a literature wiki.",
  schema: {
    type: "object",
    required: ["summary", "issues", "suggestedQuestions", "suggestedSources"],
    properties: {
      summary: { type: "string" },
      issues: {
        type: "array",
        items: {
          type: "object",
          required: ["kind", "severity", "pageKeys", "rationale", "suggestedActions"],
          properties: {
            kind: { type: "string" },
            severity: { type: "string" },
            pageKeys: { type: "array", items: { type: "string" } },
            rationale: { type: "string" },
            suggestedActions: { type: "array", items: { type: "string" } },
          },
        },
      },
      suggestedQuestions: { type: "array", items: { type: "string" } },
      suggestedSources: { type: "array", items: { type: "string" } },
    },
  },
};

export function renderLiteratureLintPrompt(input: { pages: LiteratureWikiLintPage[] }): string {
  const pageDigest = input.pages
    .map((page) => {
      const links = page.linksTo.length > 0 ? page.linksTo.join(", ") : "none";
      const sources = page.sourcePaperKeys.length > 0 ? page.sourcePaperKeys.join(", ") : "none";
      return [
        `- kind: ${page.kind}`,
        `  page_key: ${page.pageKey}`,
        `  title: ${page.title}`,
        `  summary: ${page.summary}`,
        `  source_paper_keys: ${sources}`,
        `  links_to: ${links}`,
      ].join("\n");
    })
    .join("\n");

  return [
    "You are linting a persistent literature wiki maintained by an LLM.",
    "",
    "Look for semantic knowledge-maintenance issues, not markdown formatting issues.",
    "",
    "Focus on:",
    "- contradictions between pages",
    "- stale claims that may have been superseded or should be revisited",
    "- important missing cross-references",
    "- important concepts or entities mentioned across the wiki but lacking their own page",
    "- gaps that could be filled by additional scholarly search or source ingestion",
    "",
    "Do not report structural issues such as orphan pages or broken references unless they clearly create a semantic knowledge problem. Structural lint is handled separately.",
    "Keep findings conservative and actionable.",
    "",
    "# Wiki Snapshot",
    "",
    pageDigest || "- no pages provided",
    "",
    "# Output",
    "",
    "Return valid JSON only.",
    "Do not include Markdown.",
    "Do not include comments.",
    "Match this JSON shape exactly:",
    "",
    JSON.stringify(LITERATURE_LINT_MODEL_OUTPUT_SHAPE, null, 2),
  ].join("\n");
}

export class LiteratureLint {
  constructor(private readonly modelStep?: LiteratureLintModelStepRunner) {}

  async lint(input: LiteratureLintRequest): Promise<LiteratureLintReport> {
    const pages = input.pages ?? (input.wikiRoot ? await this.loadPages(input.wikiRoot) : []);
    const structuralIssues = this.lintStructure(pages, input.wikiRoot);
    const specialFileIssues = input.wikiRoot ? await this.lintSpecialFiles(input.wikiRoot) : [];
    const semantic = this.modelStep && pages.length > 0
      ? await this.lintSemantics(pages)
      : null;
    const issues = dedupeIssues([
      ...structuralIssues,
      ...specialFileIssues,
      ...(semantic?.issues ?? []),
    ]);
    return {
      wikiRoot: input.wikiRoot,
      generatedAt: new Date().toISOString(),
      summary: semantic?.summary
        ?? summarizeStructuralIssues(structuralIssues, pages.length),
      issueCount: issues.length,
      issues,
      suggestedQuestions: semantic?.suggestedQuestions ?? [],
      suggestedSources: semantic?.suggestedSources ?? [],
    };
  }

  lintStructure(pages: LiteratureWikiLintPage[], wikiRoot?: string): LiteratureLintIssue[] {
    const issues: LiteratureLintIssue[] = [];
    const byKey = new Map(pages.map((page) => [page.pageKey, page] as const));
    const inbound = new Map<string, Set<string>>();
    const titleGroups = new Map<string, LiteratureWikiLintPage[]>();

  for (const page of pages) {
      titleGroups.set(normalizeText(page.title), [...(titleGroups.get(normalizeText(page.title)) ?? []), page]);
      for (const linkedKey of page.linksTo) {
        inbound.set(linkedKey, new Set([...(inbound.get(linkedKey) ?? []), page.pageKey]));
        if (!byKey.has(linkedKey)) {
          issues.push({
            kind: "missing_referenced_page",
            severity: "medium",
            pageKeys: [page.pageKey, linkedKey],
            rationale: `Page ${page.pageKey} links to ${linkedKey}, but no such page exists in the current wiki snapshot.`,
            suggestedActions: [
              `Create or ingest page ${linkedKey} if it should exist.`,
              `Remove or replace the dangling reference from ${page.pageKey} if it is stale.`,
            ],
          });
        }
      }
    }

    for (const page of pages) {
      const inboundCount = inbound.get(page.pageKey)?.size ?? 0;
      if (page.kind !== "paper" && inboundCount === 0) {
        issues.push({
          kind: "orphan_page",
          severity: "medium",
          pageKeys: [page.pageKey],
          rationale: `Page ${page.pageKey} has no inbound links, so it is likely disconnected from the usable wiki graph.`,
          suggestedActions: [
            `Add links to ${page.pageKey} from at least one related paper, topic, concept, or claim page.`,
          ],
        });
      }
      if (page.kind === "claim" && page.sourcePaperKeys.length === 0) {
        issues.push({
          kind: "claim_without_evidence",
          severity: "high",
          pageKeys: [page.pageKey],
          rationale: `Claim page ${page.pageKey} is not tied to any source paper keys.`,
          suggestedActions: [
            `Attach supporting, contradicting, or qualifying paper references to ${page.pageKey}.`,
            `Re-check whether ${page.pageKey} should exist as a claim page yet.`,
          ],
        });
      }
      if (page.kind === "claim" && page.updatedAt && isOlderThanDays(page.updatedAt, 180) && page.sourcePaperKeys.length <= 1) {
        issues.push({
          kind: "stale_claim",
          severity: "medium",
          pageKeys: [page.pageKey],
          rationale: `Claim page ${page.pageKey} has not been refreshed for a long time and is still grounded in very little paper evidence.`,
          suggestedActions: [
            `Revisit ${page.pageKey} against newer sources or mark it stale/superseded if needed.`,
          ],
        });
      }
      if (page.kind === "topic" && !page.linksTo.some((linkedKey) => byKey.get(linkedKey)?.kind === "claim")) {
        issues.push({
          kind: "topic_without_claims",
          severity: "low",
          pageKeys: [page.pageKey],
          rationale: `Topic page ${page.pageKey} does not link to any claim pages, so it may still need more explicit grounding in the wiki's debate structure.`,
          suggestedActions: [
            `Link ${page.pageKey} to the claim pages it synthesizes.`,
            `If no claim pages exist yet, create at least one claim page for the main debate on this topic.`,
          ],
        });
      }
      if (page.kind === "paper" && page.linksTo.length === 0) {
        issues.push({
          kind: "paper_without_links",
          severity: "medium",
          pageKeys: [page.pageKey],
          rationale: `Paper page ${page.pageKey} has no outbound links to concepts, methods, topics, claims, or related papers.`,
          suggestedActions: [
            `Add high-value cross-references from ${page.pageKey} to the pages it should update or support.`,
          ],
        });
      }
    }

    if (!pages.some((page) => page.kind === "overview")) {
      issues.push({
        kind: "overview_missing",
        severity: "medium",
        pageKeys: [],
        rationale: "The literature wiki has no overview page that orients the reader to its major themes, syntheses, and key claims.",
        suggestedActions: [
          "Generate or refresh the overview page as a top-level content entry point.",
        ],
      });
    }

    if (!pages.some((page) => page.pageKey === "literature_overview")) {
      issues.push({
        kind: "overview_missing",
        severity: "medium",
        pageKeys: [],
        rationale: "The literature wiki is missing its canonical overview page key, so the main entry point may not be stable across maintenance passes.",
        suggestedActions: [
          "Ensure the overview page exists with the canonical page key `literature_overview`.",
        ],
      });
    }

    if (wikiRoot) {
      const hasIndex = pages.length > 0;
      if (!hasIndex) {
        issues.push({
          kind: "missing_page_candidate",
          severity: "medium",
          pageKeys: [],
          rationale: "The wiki directory appears to have no parsed pages, so index.md and content navigation may not be usable yet.",
          suggestedActions: [
            "Ensure ingest has written wiki pages and regenerated index.md.",
          ],
        });
      }
    }

    const graphPages = pages
      .map((page) => parseWikiLintPageToGraphPage(page))
      .filter((page): page is LiteratureWikiPage => Boolean(page));
    const graph = buildLiteratureWikiGraph(graphPages);
    for (const orphanKey of graph.orphanPageKeys) {
      if (!issues.some((issue) => issue.kind === "orphan_page" && issue.pageKeys.includes(orphanKey))) {
        issues.push({
          kind: "orphan_page",
          severity: "medium",
          pageKeys: [orphanKey],
          rationale: `Page ${orphanKey} is structurally disconnected from the current wiki graph.`,
          suggestedActions: [
            `Add at least one meaningful inbound link to ${orphanKey}.`,
          ],
        });
      }
    }

    for (const group of titleGroups.values()) {
      if (group.length < 2) continue;
      issues.push({
        kind: "duplicate_title",
        severity: "low",
        pageKeys: group.map((page) => page.pageKey),
        rationale: `Multiple pages share the same normalized title "${group[0]?.title ?? ""}", which may indicate duplicate pages or fragmented coverage.`,
        suggestedActions: [
          "Check whether these pages should be merged, renamed, or more clearly cross-linked.",
        ],
      });
    }

    return dedupeIssues(issues);
  }

  async loadPages(wikiRoot: string): Promise<LiteratureWikiLintPage[]> {
    const files = await collectMarkdownFiles(wikiRoot);
    const pages: LiteratureWikiLintPage[] = [];
    for (const file of files) {
      const raw = await readFile(file, "utf-8");
      const page = parseWikiLintPage(raw);
      if (page) pages.push(page);
    }
    return pages;
  }

  async writeReport(wikiRoot: string, report?: LiteratureLintReport): Promise<LiteratureLintWriteResult> {
    const resolvedReport = report ?? await this.lint({ wikiRoot });
    const maintenanceRoot = join(wikiRoot, "maintenance");
    const reportPath = join(maintenanceRoot, "literature-lint.md");
    const logPath = join(wikiRoot, "log.md");
    await mkdir(maintenanceRoot, { recursive: true });
    await writeFile(reportPath, renderLiteratureLintMarkdown(resolvedReport), "utf-8");
    await appendFile(logPath, renderLiteratureLintLogEntry(resolvedReport), "utf-8");
    return { reportPath, logPath };
  }

  private async lintSpecialFiles(wikiRoot: string): Promise<LiteratureLintIssue[]> {
    const issues: LiteratureLintIssue[] = [];
    if (!(await pathExists(join(wikiRoot, "index.md")))) {
      issues.push({
        kind: "missing_page_candidate",
        severity: "medium",
        pageKeys: [],
        rationale: "The wiki is missing index.md, so the LLM loses its main content-oriented catalog for navigating the wiki.",
        suggestedActions: [
          "Regenerate index.md from the current wiki pages.",
        ],
      });
    }
    if (!(await pathExists(join(wikiRoot, "log.md")))) {
      issues.push({
        kind: "missing_page_candidate",
        severity: "medium",
        pageKeys: [],
        rationale: "The wiki is missing log.md, so the chronological record of ingests and maintenance passes is incomplete.",
        suggestedActions: [
          "Create or restore log.md as the append-only history of wiki activity.",
        ],
      });
    }
    return issues;
  }

  private async lintSemantics(pages: LiteratureWikiLintPage[]): Promise<LiteratureLintSemanticOutput> {
    if (!this.modelStep) {
      return {
        summary: summarizeStructuralIssues([], pages.length),
        issues: [],
        suggestedQuestions: [],
        suggestedSources: [],
      };
    }
    const raw = await this.modelStep({
      stepId: "literature_lint_semantic_review",
      system: "You produce structured literature-lint reports as valid JSON.",
      prompt: renderLiteratureLintPrompt({ pages }),
      includeRenderedContext: false,
      stageUserInputPolicy: false,
      stream: false,
    });
    return parseOrRepairLiteratureLint(raw, (options) => this.modelStep!({
      ...options,
      stageUserInputPolicy: false,
    }));
  }
}

async function parseOrRepairLiteratureLint(
  rawText: string,
  modelStep: LiteratureLintModelStepRunner,
): Promise<LiteratureLintSemanticOutput> {
  try {
    return coerceLiteratureLintOutput(parseStructuredOutput(rawText, LITERATURE_LINT_OUTPUT_SCHEMA));
  } catch (error) {
    try {
      return coerceLiteratureLintOutput(salvageStructuredOutput(rawText, LITERATURE_LINT_OUTPUT_SCHEMA));
    } catch {
      const repaired = await modelStep({
        stepId: "literature_lint_semantic_repair",
        system: "You repair invalid literature-lint outputs into valid JSON.",
        prompt: repairInstruction(
          LITERATURE_LINT_OUTPUT_SCHEMA,
          rawText,
          error instanceof Error ? error.message : String(error),
        ),
        includeRenderedContext: false,
        stream: false,
      });
      return coerceLiteratureLintOutput(parseStructuredOutput(repaired, LITERATURE_LINT_OUTPUT_SCHEMA));
    }
  }
}

function coerceLiteratureLintOutput(value: Record<string, unknown>): LiteratureLintSemanticOutput {
  return {
    summary: asString(value.summary),
    issues: asObjectArray(value.issues).map(coerceIssue),
    suggestedQuestions: asStringArray(value.suggestedQuestions),
    suggestedSources: asStringArray(value.suggestedSources),
  };
}

function coerceIssue(value: Record<string, unknown>): LiteratureLintIssue {
  return {
    kind: normalizeIssueKind(asString(value.kind)),
    severity: normalizeSeverity(asString(value.severity)),
    pageKeys: asStringArray(value.pageKeys),
    rationale: asString(value.rationale),
    suggestedActions: asStringArray(value.suggestedActions),
  };
}

function parseWikiLintPage(raw: string): LiteratureWikiLintPage | null {
  const parsed = parseLiteratureWikiPageMarkdown(raw);
  if (!parsed) return null;
  return {
    kind: parsed.kind,
    pageKey: parsed.pageKey,
    title: parsed.title,
    summary: parsed.summary,
    sourcePaperKeys: parsed.sourcePaperKeys,
    linksTo: extractWikiLinks(raw),
    updatedAt: parsed.updatedAt || undefined,
  };
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

function extractWikiLinks(raw: string): string[] {
  const matches = raw.matchAll(/\[\[([^\]]+)\]\]/gu);
  return dedupeStrings([...matches].map((match) => (match[1] ?? "").trim()).filter(Boolean));
}

function dedupeIssues(issues: LiteratureLintIssue[]): LiteratureLintIssue[] {
  const seen = new Map<string, LiteratureLintIssue>();
  for (const issue of issues) {
    const key = `${issue.kind}|${[...issue.pageKeys].sort().join(",")}|${issue.rationale}`;
    seen.set(key, issue);
  }
  return [...seen.values()];
}

function summarizeStructuralIssues(issues: LiteratureLintIssue[], pageCount: number): string {
  if (issues.length === 0) {
    return `Literature lint found no structural issues across ${pageCount} wiki pages.`;
  }
  const high = issues.filter((issue) => issue.severity === "high").length;
  const medium = issues.filter((issue) => issue.severity === "medium").length;
  return `Literature lint found ${issues.length} issues across ${pageCount} wiki pages, including ${high} high-severity and ${medium} medium-severity findings.`;
}

function renderLiteratureLintMarkdown(report: LiteratureLintReport): string {
  const lines = [
    "# Literature Lint Report",
    "",
    report.summary,
    "",
    `- Generated at: ${report.generatedAt}`,
    `- Issue count: ${report.issueCount}`,
  ];
  if (report.wikiRoot) lines.push(`- Wiki root: ${report.wikiRoot}`);
  if (report.issues.length > 0) {
    lines.push("", "## Issues");
    for (const issue of report.issues) {
      const pages = issue.pageKeys.length > 0 ? issue.pageKeys.map((key) => `[[${key}]]`).join(", ") : "none";
      lines.push(
        "",
        `### ${issue.kind}`,
        `- Severity: ${issue.severity}`,
        `- Pages: ${pages}`,
        `- Rationale: ${issue.rationale}`,
      );
      if (issue.suggestedActions.length > 0) {
        lines.push("", "Suggested actions:");
        for (const action of issue.suggestedActions) lines.push(`- ${action}`);
      }
    }
  }
  if (report.suggestedQuestions.length > 0) {
    lines.push("", "## Suggested Questions", ...report.suggestedQuestions.map((item) => `- ${item}`));
  }
  if (report.suggestedSources.length > 0) {
    lines.push("", "## Suggested Sources", ...report.suggestedSources.map((item) => `- ${item}`));
  }
  return `${lines.join("\n")}\n`;
}

function renderLiteratureLintLogEntry(report: LiteratureLintReport): string {
  const dateLabel = report.generatedAt.slice(0, 10);
  const highCount = report.issues.filter((issue) => issue.severity === "high").length;
  const mediumCount = report.issues.filter((issue) => issue.severity === "medium").length;
  const lines = [
    `## [${dateLabel}] lint | Literature wiki`,
    "",
    `- Summary: ${report.summary}`,
    `- Issue count: ${report.issueCount}`,
    `- Severity mix: ${highCount} high, ${mediumCount} medium`,
    "- Report: [[literature-lint]]",
  ];
  if (report.issues.length > 0) {
    lines.push("", "### Top Issues");
    for (const issue of report.issues.slice(0, 5)) {
      const pages = issue.pageKeys.length > 0 ? ` (${issue.pageKeys.join(", ")})` : "";
      lines.push(`- ${issue.kind}${pages}: ${issue.rationale}`);
    }
  }
  return `\n${lines.join("\n")}\n`;
}

function normalizeIssueKind(value: string): LiteratureLintIssueKind {
  return normalizeEnum(value, [
    "orphan_page",
    "missing_referenced_page",
    "claim_without_evidence",
    "topic_without_claims",
    "paper_without_links",
    "duplicate_title",
    "overview_missing",
    "stale_claim",
    "contradiction",
    "missing_cross_reference",
    "gap_fillable_by_search",
    "missing_page_candidate",
  ], "missing_cross_reference");
}

function normalizeSeverity(value: string): LiteratureLintSeverity {
  return normalizeEnum(value, ["low", "medium", "high"], "medium");
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

function normalizeEnum<T extends string>(value: string, allowed: readonly T[], fallback: T): T {
  return allowed.includes(value as T) ? value as T : fallback;
}

function dedupeStrings(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function normalizeText(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/gu, " ");
}

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : String(value ?? "").trim();
}

function asStringArray(value: unknown): string[] {
  if (Array.isArray(value)) return dedupeStrings(value.map(asString));
  return [];
}

function asObjectArray(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isOlderThanDays(iso: string, days: number): boolean {
  const timestamp = Date.parse(iso);
  return Number.isFinite(timestamp) && (Date.now() - timestamp) > days * 24 * 60 * 60 * 1000;
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function parseWikiLintPageToGraphPage(page: LiteratureWikiLintPage): LiteratureWikiPage | null {
  const base = {
    schemaVersion: "kaivu-literature-wiki-page-v1" as const,
    discipline: "unknown" as const,
    kind: page.kind,
    pageKey: page.pageKey,
    title: page.title,
    summary: page.summary,
    tags: [],
    aliases: [],
    sourcePaperKeys: page.sourcePaperKeys,
    updatedAt: page.updatedAt ?? new Date(0).toISOString(),
    schemaFamilies: [],
    domainScope: [],
  };
  switch (page.kind) {
    case "paper":
      return {
        ...base,
        kind: page.kind,
        canonicalPaperKey: page.pageKey,
        schemaFamily: "computational_empirical",
        selectionReason: "",
        citationLine: null,
        researchProblem: "",
        approach: "",
        keyContributions: [],
        keyClaims: [],
        findings: [],
        limitations: [],
        importantTerms: [],
        relatedPageKeys: page.linksTo,
      };
    case "claim":
      return {
        ...base,
        kind: page.kind,
        claimText: page.summary,
        claimStatus: "provisional",
        supportPaperKeys: [],
        contradictPaperKeys: [],
        qualifyPaperKeys: [],
        topicPageKeys: page.linksTo,
        contradictions: [],
        tensions: [],
        notes: [],
      };
      case "topic":
        return {
          ...base,
          kind: page.kind,
          topicStatement: page.summary,
        scopeNotes: [],
        currentThreads: [],
        keyPageKeys: page.linksTo,
          claimPageKeys: [],
          openTensions: [],
          openQuestions: [],
        };
      case "synthesis":
        return {
          ...base,
          kind: page.kind,
          synthesisStatement: page.summary,
          integratedTakeaway: page.summary,
          scopeNotes: [],
          stateOfPlay: [],
          synthesis: [],
          keyPageKeys: page.linksTo,
          claimPageKeys: [],
          contradictions: [],
          tensions: [],
          openQuestions: [],
        };
      case "overview":
        return {
          ...base,
          kind: page.kind,
          executiveSummary: page.summary,
          currentPicture: [],
          keyTensions: [],
          majorThemePageKeys: [],
          synthesisPageKeys: [],
          keyClaimPageKeys: [],
          startHerePageKeys: [],
          openFrontPageKeys: [],
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
        kind: page.kind,
        statement: page.summary,
        rationale: page.summary,
        relatedPageKeys: page.linksTo,
        patchOutline: [],
      };
  }
}
