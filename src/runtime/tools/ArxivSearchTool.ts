import type { Tool } from "../ToolRegistry.js";
import type { LiteratureSearchOutput, LiteratureSearchPaper } from "../../shared/LiteratureSearchTypes.js";

export interface ArxivSearchToolOptions {
  endpoint?: string;
  defaultLimit?: number;
  timeoutMs?: number;
}

export type ArxivSearchResult = LiteratureSearchPaper;
export type ArxivSearchOutput = LiteratureSearchOutput;

export function createArxivSearchTool(options: ArxivSearchToolOptions = {}): Tool {
  const endpoint = options.endpoint ?? process.env.ARXIV_SEARCH_ENDPOINT ?? "https://export.arxiv.org/api/query";
  const defaultLimit = options.defaultLimit ?? Number(process.env.ARXIV_SEARCH_DEFAULT_LIMIT ?? 5);
  const timeoutMs = options.timeoutMs ?? Number(process.env.ARXIV_SEARCH_TIMEOUT_MS ?? 15000);

  return {
    name: "arxiv_search",
    capability: "literature_search",
    readOnly: true,
    run: async (args) => {
      const query = String(args.query ?? "").trim();
      if (!query) throw new Error("arxiv_search requires a non-empty query");
      const limit = clampResultLimit(args.limit, defaultLimit);
      const url = new URL(endpoint);
      url.searchParams.set("search_query", buildArxivQuery(query));
      url.searchParams.set("start", "0");
      url.searchParams.set("max_results", String(limit));
      url.searchParams.set("sortBy", "relevance");
      url.searchParams.set("sortOrder", "descending");

      const response = await fetchWithTimeout(url, timeoutMs);
      const xml = await response.text();
      if (!response.ok) {
        throw new Error(`arxiv_search_failed: ${response.status} ${response.statusText}`);
      }
      return {
        query,
        results: parseArxivAtom(xml),
      } satisfies ArxivSearchOutput;
    },
  };
}

function buildArxivQuery(query: string): string {
  const normalized = query.replace(/\s+/g, " ").trim();
  return normalized.includes(":") ? normalized : `all:${normalized}`;
}

function clampResultLimit(value: unknown, fallback: number): number {
  const parsed = typeof value === "number" ? value : Number(value ?? fallback);
  if (!Number.isFinite(parsed)) return 5;
  return Math.min(25, Math.max(1, Math.floor(parsed)));
}

function parseArxivAtom(xml: string): LiteratureSearchPaper[] {
  const entries = [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)].map((match) => match[1]);
  return entries.map((entry) => {
    const id = textContent(entry, "id");
    return {
      id,
      title: normalizeXmlText(textContent(entry, "title")) || id || "Untitled paper",
      summary: normalizeXmlText(textContent(entry, "summary")) || undefined,
      authors: [...entry.matchAll(/<author>\s*<name>([\s\S]*?)<\/name>\s*<\/author>/g)].map((match) => decodeXml(match[1].trim())),
      publishedAt: textContent(entry, "published") || undefined,
      link: firstAlternateLink(entry) || id || undefined,
      categories: [...entry.matchAll(/<category\s+term="([^"]+)"/g)].map((match) => decodeXml(match[1])),
    };
  });
}

function textContent(xml: string, tag: string): string {
  const match = xml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`));
  return match ? decodeXml(match[1].trim()) : "";
}

function firstAlternateLink(entry: string): string | undefined {
  const alternate = entry.match(/<link[^>]+rel="alternate"[^>]+href="([^"]+)"/);
  const fallback = entry.match(/<link[^>]+href="([^"]+)"/);
  return decodeXml((alternate ?? fallback)?.[1] ?? "") || undefined;
}

function normalizeXmlText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function decodeXml(value: string): string {
  return value
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", "\"")
    .replaceAll("&apos;", "'");
}

async function fetchWithTimeout(url: URL, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}
