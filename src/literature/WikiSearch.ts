import type { LiteratureDiscipline } from "./PaperDigest.js";
import type { LiteratureWikiPage } from "./LiteratureWikiPage.js";

export interface LoadedWikiPage {
  page: LiteratureWikiPage;
  path: string;
  raw: string;
}

export interface WikiSearchContext {
  hotPageKeys: Set<string>;
  indexPageKeys: Set<string>;
  disciplineIndexPageKeys: Set<string>;
}

export interface WikiSearchRequest {
  query: string;
  pages: LoadedWikiPage[];
  disciplineScope?: LiteratureDiscipline[];
  context?: WikiSearchContext;
}

export interface WikiSearchMatch {
  loaded: LoadedWikiPage;
  score: number;
  snippet: string;
  reasons: string[];
}

export interface WikiSearchResults {
  query: string;
  matches: WikiSearchMatch[];
}

export interface WikiSearch {
  search(input: WikiSearchRequest): WikiSearchResults;
}

export class NaiveWikiSearch implements WikiSearch {
  search(input: WikiSearchRequest): WikiSearchResults {
    const disciplineScope = normalizeDisciplineScope(input.disciplineScope);
    const context = input.context ?? emptyContext();
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

function emptyContext(): WikiSearchContext {
  return {
    hotPageKeys: new Set<string>(),
    indexPageKeys: new Set<string>(),
    disciplineIndexPageKeys: new Set<string>(),
  };
}

function normalizeDisciplineScope(input: LiteratureDiscipline[] | undefined): LiteratureDiscipline[] {
  return dedupeStrings((input ?? []).filter(Boolean)) as LiteratureDiscipline[];
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

function dedupeStrings(values: string[]): string[] {
  return [...new Set(values.filter((value) => value.trim().length > 0))];
}
