import type { Tool } from "../ToolRegistry.js";
import type { LiteratureSearchOutput, LiteratureSearchPaper } from "../../shared/LiteratureSearchTypes.js";

export interface RagArxivRetrieveToolOptions {
  endpoint?: string;
  token?: string;
  defaultSize?: number;
  timeoutMs?: number;
}

export type RagArxivRetrieveResult = LiteratureSearchPaper;
export type RagArxivRetrieveOutput = LiteratureSearchOutput;

type SearchMode = "bm25" | "vector" | "hybrid";

export function createRagArxivRetrieveTool(options: RagArxivRetrieveToolOptions = {}): Tool {
  const endpoint = options.endpoint ?? process.env.RAG_ARXIV_RETRIEVE_ENDPOINT ?? "https://data.rag.ac.cn/arxiv/";
  const token = options.token ?? process.env.RAG_AC_TOKEN;
  const defaultSize = options.defaultSize ?? Number(process.env.RAG_ARXIV_RETRIEVE_DEFAULT_SIZE ?? 5);
  const timeoutMs = options.timeoutMs ?? Number(process.env.RAG_ARXIV_RETRIEVE_TIMEOUT_MS ?? 20000);

  return {
    name: "rag_arxiv_retrieve",
    capability: "literature_search",
    readOnly: true,
    run: async (args) => {
      const query = String(args.query ?? "").trim();
      if (!query) throw new Error("rag_arxiv_retrieve requires a non-empty query");

      const url = new URL(endpoint);
      url.searchParams.set("type", "retrieve");
      url.searchParams.set("query", query);
      url.searchParams.set("size", String(clampInteger(args.size ?? args.limit, defaultSize, 1, 25)));
      url.searchParams.set("offset", String(clampInteger(args.offset, 0, 0, 10000)));
      url.searchParams.set("search_mode", normalizeSearchMode(args.search_mode ?? args.searchMode));

      setOptionalFloat(url, "bm25_weight", args.bm25_weight ?? args.bm25Weight);
      setOptionalFloat(url, "vector_weight", args.vector_weight ?? args.vectorWeight);
      setOptionalList(url, "categories", args.categories);
      setOptionalList(url, "authors", args.authors);
      setOptionalInteger(url, "min_citation", args.min_citation ?? args.minCitation);
      setOptionalString(url, "date_from", args.date_from ?? args.dateFrom);
      setOptionalString(url, "date_to", args.date_to ?? args.dateTo);
      if (token && args.tokenInQuery === true) url.searchParams.set("token", token);

      const response = await fetchWithTimeout(url, timeoutMs, token && args.tokenInQuery !== true ? token : undefined);
      const text = await response.text();
      if (!response.ok) {
        throw new Error(`rag_arxiv_retrieve_failed: ${response.status} ${response.statusText} ${text.slice(0, 300)}`);
      }

      const payload = parseJsonObject(text);
      return {
        query,
        results: normalizeResults(payload.results),
      } satisfies RagArxivRetrieveOutput;
    },
  };
}

function normalizeResults(value: unknown): LiteratureSearchPaper[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => {
    const record = isRecord(item) ? item : {};
    const arxivId = asString(record.arxiv_id ?? record.id);
    const title = asString(record.title) || arxivId || "Untitled paper";
    const abstract = asString(record.abstract ?? record.summary);
    const publishedAt = asString(record.publish_at ?? record.publishedAt ?? record.published);
    const link = asString(record.link ?? record.src_url) || (arxivId ? `https://arxiv.org/abs/${arxivId}` : undefined);
    const id = arxivId ? `https://arxiv.org/abs/${arxivId}` : link ?? `${title}:${publishedAt}`;
    return {
      id,
      title,
      summary: abstract || undefined,
      authors: asStringArray(record.authors),
      publishedAt: publishedAt || undefined,
      categories: asStringArray(record.categories),
      link,
    };
  });
}

function normalizeSearchMode(value: unknown): SearchMode {
  const mode = String(value ?? "hybrid").trim().toLowerCase();
  return mode === "bm25" || mode === "vector" || mode === "hybrid" ? mode : "hybrid";
}

function setOptionalString(url: URL, key: string, value: unknown): void {
  const text = String(value ?? "").trim();
  if (text) url.searchParams.set(key, text);
}

function setOptionalInteger(url: URL, key: string, value: unknown): void {
  const parsed = Number(value);
  if (Number.isFinite(parsed)) url.searchParams.set(key, String(Math.floor(parsed)));
}

function setOptionalFloat(url: URL, key: string, value: unknown): void {
  const parsed = Number(value);
  if (Number.isFinite(parsed)) url.searchParams.set(key, String(parsed));
}

function setOptionalList(url: URL, key: string, value: unknown): void {
  if (Array.isArray(value)) {
    const items = value.map((item) => String(item).trim()).filter(Boolean);
    if (items.length > 0) url.searchParams.set(key, items.join(","));
    return;
  }
  const text = String(value ?? "").trim();
  if (text) url.searchParams.set(key, text);
}

function clampInteger(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = typeof value === "number" ? value : Number(value ?? fallback);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(parsed)));
}

function parseJsonObject(text: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(text);
  if (!isRecord(parsed)) throw new Error("rag_arxiv_retrieve returned non-object JSON");
  return parsed;
}

async function fetchWithTimeout(url: URL, timeoutMs: number, token?: string): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      method: "POST",
      signal: controller.signal,
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    });
  } finally {
    clearTimeout(timeout);
  }
}

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : String(value ?? "").trim();
}

function asStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const items = value.map(asString).filter(Boolean);
  return items.length > 0 ? items : undefined;
}

function asNumber(value: unknown): number | undefined {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
