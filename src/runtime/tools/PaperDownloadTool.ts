import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Tool } from "../ToolRegistry.js";

export interface PaperDownloadToolOptions {
  root?: string;
  timeoutMs?: number;
}

export function createPaperDownloadTool(options: PaperDownloadToolOptions = {}): Tool {
  const root = options.root ?? join(process.cwd(), ".kaivu", "default", "literature", "papers");
  const timeoutMs = options.timeoutMs ?? Number(process.env.PAPER_DOWNLOAD_TIMEOUT_MS ?? 30000);
  return {
    name: "download_paper_pdf",
    capability: "literature_download",
    readOnly: false,
    run: async (args) => {
      const url = String(args.url ?? "").trim();
      const title = String(args.title ?? args.id ?? "paper").trim();
      if (!/^https?:\/\//i.test(url)) throw new Error("download_paper_pdf requires an http(s) URL");
      await mkdir(root, { recursive: true });
      const response = await fetchWithTimeout(normalizePdfUrl(url), timeoutMs);
      if (!response.ok) throw new Error(`paper_download_failed: ${response.status} ${response.statusText}`);
      const contentType = response.headers.get("content-type") ?? "";
      const bytes = new Uint8Array(await response.arrayBuffer());
      const filename = `${safeFilename(title).slice(0, 120) || "paper"}.pdf`;
      const path = join(root, filename);
      await writeFile(path, bytes);
      return {
        url,
        path,
        bytes: bytes.length,
        contentType,
      };
    },
  };
}

function normalizePdfUrl(url: string): string {
  if (url.includes("arxiv.org/abs/")) return url.replace("/abs/", "/pdf/");
  return url;
}

function safeFilename(value: string): string {
  return value
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replaceAll(" ", "_");
}

async function fetchWithTimeout(url: string, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}
