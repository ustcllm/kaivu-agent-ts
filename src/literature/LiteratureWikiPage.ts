import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import type { LiteratureDiscipline, PaperDigestSchemaFamily } from "./PaperDigest.js";

export type SupportedLiteratureWikiPageKind =
  | "paper"
  | "research_question"
  | "method"
  | "benchmark"
  | "finding"
  | "formal_result"
  | "claim"
  | "topic"
  | "synthesis";

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

export interface LiteratureWikiResearchQuestionPage extends BaseLiteratureWikiPage {
  kind: "research_question";
  question: string;
  motivation: string;
  currentAnswer: string;
  relatedTopicKeys: string[];
  claimPageKeys: string[];
  findingPageKeys: string[];
  methodPageKeys: string[];
  benchmarkKeys: string[];
  openSubquestions: string[];
  relatedPageKeys: string[];
}

export interface LiteratureWikiBenchmarkPage extends BaseLiteratureWikiPage {
  kind: "benchmark";
  benchmarkStatement: string;
  evaluates: string[];
  datasetOrSuite: string;
  metrics: string[];
  knownCaveats: string[];
  usedByPaperKeys: string[];
  relatedMethodKeys: string[];
  relatedFindingKeys: string[];
  relatedPageKeys: string[];
}

export interface LiteratureWikiFindingPage extends BaseLiteratureWikiPage {
  kind: "finding";
  findingStatement: string;
  evidenceType: string;
  supportingPaperKeys: string[];
  relatedMethodKeys: string[];
  relatedBenchmarkKeys: string[];
  supportsClaimKeys: string[];
  qualifiesClaimKeys: string[];
  contradictsClaimKeys: string[];
  caveats: string[];
  relatedPageKeys: string[];
}

export interface LiteratureWikiFormalResultPage extends BaseLiteratureWikiPage {
  kind: "formal_result";
  formalResultType: "theorem" | "lemma" | "corollary" | "proposition" | "conjecture" | "bound" | "guarantee" | "other";
  statement: string;
  assumptions: string[];
  proofIdea: string;
  dependsOnResultKeys: string[];
  supportsClaimKeys: string[];
  relatedMethodKeys: string[];
  limitations: string[];
  relatedPageKeys: string[];
}

export interface LiteratureWikiMethodPage extends BaseLiteratureWikiPage {
  kind: "method";
  methodStatement: string;
  mechanism: string[];
  assumptions: string[];
  inputs: string[];
  outputs: string[];
  variants: string[];
  baselines: string[];
  failureModes: string[];
  relatedBenchmarkKeys: string[];
  relatedFindingKeys: string[];
  relatedFormalResultKeys: string[];
  relatedPageKeys: string[];
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

export type LiteratureWikiPage =
  | LiteratureWikiPaperPage
  | LiteratureWikiResearchQuestionPage
  | LiteratureWikiBenchmarkPage
  | LiteratureWikiFindingPage
  | LiteratureWikiFormalResultPage
  | LiteratureWikiMethodPage
  | LiteratureWikiClaimPage
  | LiteratureWikiTopicPage
  | LiteratureWikiSynthesisPage;

export interface LiteratureWikiGraphSnapshot {
  pageCount: number;
  inboundByPageKey: Record<string, string[]>;
  outboundByPageKey: Record<string, string[]>;
  orphanPageKeys: string[];
  danglingReferences: Array<{ fromPageKey: string; toPageKey: string }>;
}

export type LiteratureWikiLookupIndex = Record<string, LiteratureWikiPage[]>;

export function literatureWikiPagePath(
  root: string,
  discipline: LiteratureDiscipline,
  kind: SupportedLiteratureWikiPageKind,
  pageKey: string,
): string {
  return `${root.replace(/[\\/]+$/u, "")}/${literatureWikiPageDirectory(discipline, kind)}/${safeWikiPageKey(pageKey)}.md`;
}

export function literatureWikiPageDirectory(discipline: LiteratureDiscipline, kind: SupportedLiteratureWikiPageKind): string {
  switch (kind) {
    case "paper":
      return `${discipline}/papers`;
    case "research_question":
      return `${discipline}/research_questions`;
    case "method":
      return `${discipline}/methods`;
    case "benchmark":
      return `${discipline}/benchmarks`;
    case "finding":
      return `${discipline}/findings`;
    case "formal_result":
      return `${discipline}/formal_results`;
    case "claim":
      return `${discipline}/claims`;
    case "topic":
      return `${discipline}/topics`;
    case "synthesis":
      return `${discipline}/syntheses`;
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
    case "research_question":
      lines.push(
        "",
        "## Question",
        "",
        page.question,
        "",
        "## Motivation",
        "",
        page.motivation,
        "",
        "## Current Answer",
        "",
        page.currentAnswer,
      );
      pushBulletSection(lines, "Related Topics", page.relatedTopicKeys.map((key) => `[[${key}]]`));
      pushBulletSection(lines, "Claim Pages", page.claimPageKeys.map((key) => `[[${key}]]`));
      pushBulletSection(lines, "Finding Pages", page.findingPageKeys.map((key) => `[[${key}]]`));
      pushBulletSection(lines, "Method Pages", page.methodPageKeys.map((key) => `[[${key}]]`));
      pushBulletSection(lines, "Benchmarks", page.benchmarkKeys.map((key) => `[[${key}]]`));
      pushBulletSection(lines, "Open Subquestions", page.openSubquestions);
      pushBulletSection(lines, "Related Pages", page.relatedPageKeys.map((key) => `[[${key}]]`));
      return lines.join("\n");
    case "benchmark":
      lines.push(
        "",
        "## Benchmark Statement",
        "",
        page.benchmarkStatement,
        "",
        "## Dataset Or Suite",
        "",
        page.datasetOrSuite,
      );
      pushBulletSection(lines, "Evaluates", page.evaluates);
      pushBulletSection(lines, "Metrics", page.metrics);
      pushBulletSection(lines, "Known Caveats", page.knownCaveats);
      pushBulletSection(lines, "Used By Papers", page.usedByPaperKeys.map((key) => `[[${key}]]`));
      pushBulletSection(lines, "Related Methods", page.relatedMethodKeys.map((key) => `[[${key}]]`));
      pushBulletSection(lines, "Related Findings", page.relatedFindingKeys.map((key) => `[[${key}]]`));
      pushBulletSection(lines, "Related Pages", page.relatedPageKeys.map((key) => `[[${key}]]`));
      return lines.join("\n");
    case "finding":
      lines.push(
        "",
        "## Finding Statement",
        "",
        page.findingStatement,
        "",
        "## Evidence Type",
        "",
        page.evidenceType,
      );
      pushBulletSection(lines, "Supporting Papers", page.supportingPaperKeys.map((key) => `[[${key}]]`));
      pushBulletSection(lines, "Related Methods", page.relatedMethodKeys.map((key) => `[[${key}]]`));
      pushBulletSection(lines, "Related Benchmarks", page.relatedBenchmarkKeys.map((key) => `[[${key}]]`));
      pushBulletSection(lines, "Supports Claims", page.supportsClaimKeys.map((key) => `[[${key}]]`));
      pushBulletSection(lines, "Qualifies Claims", page.qualifiesClaimKeys.map((key) => `[[${key}]]`));
      pushBulletSection(lines, "Contradicts Claims", page.contradictsClaimKeys.map((key) => `[[${key}]]`));
      pushBulletSection(lines, "Caveats", page.caveats);
      pushBulletSection(lines, "Related Pages", page.relatedPageKeys.map((key) => `[[${key}]]`));
      return lines.join("\n");
    case "formal_result":
      lines.push(
        "",
        "## Statement",
        "",
        page.statement,
        "",
        "## Proof Idea",
        "",
        page.proofIdea,
      );
      lines.push("", "## Result Type", "", page.formalResultType);
      pushBulletSection(lines, "Assumptions", page.assumptions);
      pushBulletSection(lines, "Depends On Results", page.dependsOnResultKeys.map((key) => `[[${key}]]`));
      pushBulletSection(lines, "Supports Claims", page.supportsClaimKeys.map((key) => `[[${key}]]`));
      pushBulletSection(lines, "Related Methods", page.relatedMethodKeys.map((key) => `[[${key}]]`));
      pushBulletSection(lines, "Limitations", page.limitations);
      pushBulletSection(lines, "Related Pages", page.relatedPageKeys.map((key) => `[[${key}]]`));
      return lines.join("\n");
    case "method":
      lines.push(
        "",
        "## Method Statement",
        "",
        page.methodStatement,
      );
      pushBulletSection(lines, "Mechanism", page.mechanism);
      pushBulletSection(lines, "Assumptions", page.assumptions);
      pushBulletSection(lines, "Inputs", page.inputs);
      pushBulletSection(lines, "Outputs", page.outputs);
      pushBulletSection(lines, "Variants", page.variants);
      pushBulletSection(lines, "Baselines", page.baselines);
      pushBulletSection(lines, "Failure Modes", page.failureModes);
      pushBulletSection(lines, "Related Benchmarks", page.relatedBenchmarkKeys.map((key) => `[[${key}]]`));
      pushBulletSection(lines, "Related Findings", page.relatedFindingKeys.map((key) => `[[${key}]]`));
      pushBulletSection(lines, "Related Formal Results", page.relatedFormalResultKeys.map((key) => `[[${key}]]`));
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
    case "research_question":
      return [
        ...page.relatedTopicKeys,
        ...page.claimPageKeys,
        ...page.findingPageKeys,
        ...page.methodPageKeys,
        ...page.benchmarkKeys,
        ...page.relatedPageKeys,
      ];
    case "benchmark":
      return [
        ...page.usedByPaperKeys,
        ...page.relatedMethodKeys,
        ...page.relatedFindingKeys,
        ...page.relatedPageKeys,
      ];
    case "finding":
      return [
        ...page.supportingPaperKeys,
        ...page.relatedMethodKeys,
        ...page.relatedBenchmarkKeys,
        ...page.supportsClaimKeys,
        ...page.qualifiesClaimKeys,
        ...page.contradictsClaimKeys,
        ...page.relatedPageKeys,
      ];
    case "formal_result":
      return [
        ...page.dependsOnResultKeys,
        ...page.supportsClaimKeys,
        ...page.relatedMethodKeys,
        ...page.relatedPageKeys,
      ];
    case "method":
      return [
        ...page.relatedBenchmarkKeys,
        ...page.relatedFindingKeys,
        ...page.relatedFormalResultKeys,
        ...page.relatedPageKeys,
      ];
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
    .filter((page) => (inbound.get(page.pageKey)?.size ?? 0) === 0)
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

export function buildLiteratureWikiLookupResult(
  canonicalPaperKey: string,
  pages: LiteratureWikiPage[],
): LiteratureWikiPage[] {
  const relatedPages: LiteratureWikiPage[] = [];

  for (const page of pages) {
    if (!page.sourcePaperKeys.includes(canonicalPaperKey)) continue;
    relatedPages.push(page);
  }

  const sortedPages = relatedPages
    .sort((left, right) => {
      const byPaperKind = Number(right.kind === "paper") - Number(left.kind === "paper");
      if (byPaperKind !== 0) return byPaperKind;
      const byKind = left.kind.localeCompare(right.kind);
      if (byKind !== 0) return byKind;
      return left.title.localeCompare(right.title);
    });

  return sortedPages;
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
    case "research_question":
      return {
        ...base,
        kind,
        question: readParagraph(sections["Question"]),
        motivation: readParagraph(sections["Motivation"]),
        currentAnswer: readParagraph(sections["Current Answer"]),
        relatedTopicKeys: readWikiBullets(sections["Related Topics"]),
        claimPageKeys: readWikiBullets(sections["Claim Pages"]),
        findingPageKeys: readWikiBullets(sections["Finding Pages"]),
        methodPageKeys: readWikiBullets(sections["Method Pages"]),
        benchmarkKeys: readWikiBullets(sections["Benchmarks"]),
        openSubquestions: readBullets(sections["Open Subquestions"]),
        relatedPageKeys: readWikiBullets(sections["Related Pages"]),
      };
    case "benchmark":
      return {
        ...base,
        kind,
        benchmarkStatement: readParagraph(sections["Benchmark Statement"]),
        evaluates: readBullets(sections["Evaluates"]),
        datasetOrSuite: readParagraph(sections["Dataset Or Suite"]),
        metrics: readBullets(sections["Metrics"]),
        knownCaveats: readBullets(sections["Known Caveats"]),
        usedByPaperKeys: readWikiBullets(sections["Used By Papers"]),
        relatedMethodKeys: readWikiBullets(sections["Related Methods"]),
        relatedFindingKeys: readWikiBullets(sections["Related Findings"]),
        relatedPageKeys: readWikiBullets(sections["Related Pages"]),
      };
    case "finding":
      return {
        ...base,
        kind,
        findingStatement: readParagraph(sections["Finding Statement"]),
        evidenceType: readParagraph(sections["Evidence Type"]),
        supportingPaperKeys: readWikiBullets(sections["Supporting Papers"]),
        relatedMethodKeys: readWikiBullets(sections["Related Methods"]),
        relatedBenchmarkKeys: readWikiBullets(sections["Related Benchmarks"]),
        supportsClaimKeys: readWikiBullets(sections["Supports Claims"]),
        qualifiesClaimKeys: readWikiBullets(sections["Qualifies Claims"]),
        contradictsClaimKeys: readWikiBullets(sections["Contradicts Claims"]),
        caveats: readBullets(sections["Caveats"]),
        relatedPageKeys: readWikiBullets(sections["Related Pages"]),
      };
    case "formal_result":
      return {
        ...base,
        kind,
        statement: readParagraph(sections["Statement"]),
        formalResultType: normalizeFormalResultType(readParagraph(sections["Result Type"])),
        assumptions: readBullets(sections["Assumptions"]),
        proofIdea: readParagraph(sections["Proof Idea"]),
        dependsOnResultKeys: readWikiBullets(sections["Depends On Results"]),
        supportsClaimKeys: readWikiBullets(sections["Supports Claims"]),
        relatedMethodKeys: readWikiBullets(sections["Related Methods"]),
        limitations: readBullets(sections["Limitations"]),
        relatedPageKeys: readWikiBullets(sections["Related Pages"]),
      };
    case "method":
      return {
        ...base,
        kind,
        methodStatement: readParagraph(sections["Method Statement"]),
        mechanism: readBullets(sections["Mechanism"]),
        assumptions: readBullets(sections["Assumptions"]),
        inputs: readBullets(sections["Inputs"]),
        outputs: readBullets(sections["Outputs"]),
        variants: readBullets(sections["Variants"]),
        baselines: readBullets(sections["Baselines"]),
        failureModes: readBullets(sections["Failure Modes"]),
        relatedBenchmarkKeys: readWikiBullets(sections["Related Benchmarks"]),
        relatedFindingKeys: readWikiBullets(sections["Related Findings"]),
        relatedFormalResultKeys: readWikiBullets(sections["Related Formal Results"]),
        relatedPageKeys: readWikiBullets(sections["Related Pages"]),
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

async function readLiteratureWikiPage(path: string): Promise<LiteratureWikiPage | null> {
  try {
    const raw = await readFile(path, "utf-8");
    return parseLiteratureWikiPageMarkdown(raw);
  } catch {
    return null;
  }
}

async function loadLiteratureWikiPages(root: string): Promise<LiteratureWikiPage[]> {
  const files = await collectLiteratureWikiMarkdownFiles(root);
  const pages: LiteratureWikiPage[] = [];
  for (const file of files) {
    const page = await readLiteratureWikiPage(file);
    if (page) pages.push(page);
  }
  return pages;
}

async function collectLiteratureWikiMarkdownFiles(root: string): Promise<string[]> {
  try {
    const entries = await readdir(root, { withFileTypes: true });
    const files: string[] = [];
    for (const entry of entries) {
      const path = join(root, entry.name);
      if (entry.isDirectory()) {
        files.push(...await collectLiteratureWikiMarkdownFiles(path));
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith(".md")) {
        files.push(path);
      }
    }
    return files;
  } catch {
    return [];
  }
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
    "research_question",
    "method",
    "benchmark",
    "finding",
    "formal_result",
    "claim",
    "topic",
    "synthesis",
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

function normalizeFormalResultType(value: unknown): LiteratureWikiFormalResultPage["formalResultType"] {
  const text = asString(value);
  return [
    "theorem",
    "lemma",
    "corollary",
    "proposition",
    "conjecture",
    "bound",
    "guarantee",
    "other",
  ].includes(text) ? text as LiteratureWikiFormalResultPage["formalResultType"] : "other";
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
