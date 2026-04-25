import { ProxyAgent } from "undici";
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import process from "node:process";

export interface ModelMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
}

export interface ModelCompletion {
  text: string;
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
    costUsd?: number;
  };
}

export interface ModelProviderStatusEvent {
  type: "model_attempt" | "model_retry" | "model_reconnected" | "model_fallback";
  model?: string;
  attempt?: number;
  maxAttempts?: number;
  delayMs?: number;
  reason?: string;
  fallbackModel?: string;
}

export interface ModelCompleteOptions {
  onStatus?: (event: ModelProviderStatusEvent) => void;
  onTextDelta?: (delta: string) => void;
  hostedWebSearch?: boolean;
  webSearchDomains?: string[];
  maxOutputTokens?: number;
  attachments?: ModelInputAttachment[];
}

export interface ModelInputAttachment {
  kind: "pdf_url" | "pdf_file";
  url?: string;
  path?: string;
  filename?: string;
  mediaType?: "application/pdf";
}

export interface ModelProvider {
  readonly label?: string;
  readonly supportsHostedWebSearch?: boolean;
  readonly pdfUrlReadSupport?: "hosted_web_search" | "native" | "unsupported";
  readonly pdfFileReadSupport?: "native" | "unsupported";
  complete(messages: ModelMessage[], options?: ModelCompleteOptions): Promise<ModelCompletion>;
}

export interface RetryingModelProviderOptions {
  maxAttempts?: number;
  baseDelayMs?: number;
  shouldRetry?: (error: unknown) => boolean;
}

export class RetryingModelProvider implements ModelProvider {
  readonly label: string;
  readonly supportsHostedWebSearch?: boolean;
  readonly pdfUrlReadSupport?: "hosted_web_search" | "native" | "unsupported";
  readonly pdfFileReadSupport?: "native" | "unsupported";
  private readonly maxAttempts: number;
  private readonly baseDelayMs: number;
  private readonly shouldRetry: (error: unknown) => boolean;

  constructor(
    private readonly inner: ModelProvider,
    options: RetryingModelProviderOptions = {},
  ) {
    this.label = `retry(${inner.label ?? "model"})`;
    this.supportsHostedWebSearch = inner.supportsHostedWebSearch;
    this.pdfUrlReadSupport = inner.pdfUrlReadSupport;
    this.pdfFileReadSupport = inner.pdfFileReadSupport;
    this.maxAttempts = options.maxAttempts ?? 5;
    this.baseDelayMs = options.baseDelayMs ?? 750;
    this.shouldRetry = options.shouldRetry ?? isRetryableModelError;
  }

  async complete(messages: ModelMessage[], options: ModelCompleteOptions = {}): Promise<ModelCompletion> {
    let lastError: unknown;
    for (let attempt = 1; attempt <= this.maxAttempts; attempt += 1) {
      try {
        options.onStatus?.({
          type: attempt === 1 ? "model_attempt" : "model_retry",
          model: this.inner.label,
          attempt,
          maxAttempts: this.maxAttempts,
        });
        const result = await this.inner.complete(messages, options);
        if (attempt === 1) {
          return result;
        }
        options.onStatus?.({
          type: "model_reconnected",
          model: this.inner.label,
          attempt,
          maxAttempts: this.maxAttempts,
        });
        return {
          ...result,
          text: `${result.text}\n\n[Kaivu note: model call succeeded after ${attempt} attempt(s).]`,
        };
      } catch (error) {
        lastError = error;
        if (attempt >= this.maxAttempts || !this.shouldRetry(error)) {
          throw error;
        }
        const delayMs = this.baseDelayMs * attempt;
        options.onStatus?.({
          type: "model_retry",
          model: this.inner.label,
          attempt: attempt + 1,
          maxAttempts: this.maxAttempts,
          delayMs,
          reason: error instanceof Error ? error.message : String(error),
        });
        await sleep(delayMs);
      }
    }
    throw lastError;
  }
}

export class FallbackModelProvider implements ModelProvider {
  readonly label: string;

  constructor(
    private readonly primary: ModelProvider,
    private readonly fallback: ModelProvider,
    private readonly shouldFallback: (error: unknown) => boolean = () => true,
  ) {
    this.label = `${primary.label ?? "primary"} -> ${fallback.label ?? "fallback"}`;
  }

  async complete(messages: ModelMessage[], options: ModelCompleteOptions = {}): Promise<ModelCompletion> {
    try {
      return await this.primary.complete(messages, options);
    } catch (error) {
      if (!this.shouldFallback(error)) {
        throw error;
      }
      options.onStatus?.({
        type: "model_fallback",
        model: this.primary.label,
        fallbackModel: this.fallback.label,
        reason: error instanceof Error ? error.message : String(error),
      });
      const result = await this.fallback.complete(messages, options);
      return {
        ...result,
        text: `${result.text}\n\n[Kaivu note: openai-codex direct backend failed, so this response used codex-cli fallback.]`,
      };
    }
  }
}

export class EchoModelProvider implements ModelProvider {
  readonly label = "local-echo";
  readonly pdfUrlReadSupport = "unsupported" as const;
  readonly pdfFileReadSupport = "unsupported" as const;

  async complete(messages: ModelMessage[], options: ModelCompleteOptions = {}): Promise<ModelCompletion> {
    if (options.attachments?.length) {
      throw new Error("EchoModelProvider does not support file attachments.");
    }
    const last = messages.at(-1)?.content ?? "";
    const inputTokens = messages.reduce((count, message) => count + message.content.length, 0);
    const text = echoStructuredResponse(last) ?? `Echo model response for: ${last.slice(0, 200)}`;
    await emitTextDeltas(text, options);
    return {
      text,
      usage: {
        inputTokens,
        outputTokens: 32,
        totalTokens: inputTokens + 32,
      },
    };
  }
}

function echoStructuredResponse(prompt: string): string | undefined {
  if (prompt.includes("Schema name: grounding_targets")) {
    return JSON.stringify({
      discipline: {
        label: prompt.toLowerCase().includes("attention residual") ? "artificial_intelligence" : "artificial_intelligence",
        confidence: prompt.toLowerCase().includes("known discipline context") ? 0.95 : 0.72,
        rationale: "The query uses AI/ML terminology and asks for research directions in an AI context.",
      },
      targets: [
        {
          term: prompt.toLowerCase().includes("attention residual")
            ? "attention residual"
            : "benchmark-driven AI research loop",
          reason: "This phrase is likely to affect the scientific framing and downstream literature search scope.",
        },
      ],
      rationale: "Select the central technical phrase and leave grounding itself to the hosted web search step.",
      compatibility: "Selected targets share an artificial_intelligence context.",
      no_grounding_reason: "",
    });
  }
  if (prompt.includes("Schema name: literature_query_plan")) {
    return JSON.stringify({
      search_strategy: "Use broad-to-focused AI research queries derived from the framed problem; avoid invented acronyms or brittle aliases.",
      queries: [
        {
          purpose: "broad conceptual coverage",
          query: "benchmark driven AI research reproducibility evaluation",
          scope: "broad",
          rationale: "Covers the general research loop and reproducibility framing.",
        },
        {
          purpose: "data leakage and validity",
          query: "AI benchmark data leakage evaluation protocol",
          scope: "focused",
          rationale: "Targets benchmark validity risks.",
        },
        {
          purpose: "seed sensitivity",
          query: "machine learning benchmark seed sensitivity reproducibility",
          scope: "focused",
          rationale: "Targets robustness and variance across runs.",
        },
        {
          purpose: "evidence standards",
          query: "machine learning ablation study evidence quality benchmark",
          scope: "focused",
          rationale: "Targets evidence quality and ablation requirements.",
        },
        {
          purpose: "systematic review angle",
          query: "AI benchmark evaluation systematic review reproducibility",
          scope: "broad",
          rationale: "Adds systematic review coverage for prior work.",
        },
      ],
      exclusions: ["Do not invent project-specific acronyms.", "Do not use natural-language questions as queries."],
    });
  }
  return undefined;
}

export interface CodexCliModelProviderOptions {
  model?: string;
  command?: string;
  timeoutMs?: number;
  cwd?: string;
  sandbox?: "workspace-write" | "read-only" | "danger-full-access";
}

export class CodexCliModelProvider implements ModelProvider {
  readonly label: string;
  readonly pdfUrlReadSupport = "unsupported" as const;
  readonly pdfFileReadSupport = "unsupported" as const;
  private readonly model: string;
  private readonly command: string;
  private readonly timeoutMs: number;
  private readonly cwd?: string;
  private readonly sandbox: NonNullable<CodexCliModelProviderOptions["sandbox"]>;

  constructor(options: CodexCliModelProviderOptions = {}) {
    this.model = normalizeCodexCliModel(options.model ?? "gpt-5.4");
    this.label = `codex-cli/${this.model}`;
    this.command = options.command ?? process.env.CODEX_CLI_COMMAND ?? resolveDefaultCodexCommand();
    this.timeoutMs = options.timeoutMs ?? 180_000;
    this.cwd = options.cwd;
    this.sandbox = options.sandbox ?? "workspace-write";
  }

  async complete(messages: ModelMessage[], options: ModelCompleteOptions = {}): Promise<ModelCompletion> {
    if (options.attachments?.length) {
      throw new Error("CodexCliModelProvider does not support file attachments.");
    }
    const system = messages.find((message) => message.role === "system")?.content;
    const prompt = messages
      .filter((message) => message.role !== "system")
      .map((message) => `${message.role.toUpperCase()}:\n${message.content}`)
      .join("\n\n");
    const systemPromptFile = system ? await writeCodexSystemPrompt(system) : undefined;
    const args = [
      "exec",
      "--json",
      "--color",
      "never",
      "--sandbox",
      this.sandbox,
      "--skip-git-repo-check",
      "--model",
      this.model,
      ...(systemPromptFile ? ["-c", `model_instructions_file="${systemPromptFile.filePath}"`] : []),
      prompt,
    ];
    try {
      let streamedText = "";
      const output = await runCommand({
        command: this.command,
        args,
        cwd: this.cwd,
        timeoutMs: this.timeoutMs,
        onStdoutLine: (line) => {
          const deltas = extractCodexCliDeltas(line);
          for (const delta of deltas) {
            streamedText += delta;
            options.onTextDelta?.(delta);
          }
        },
      });
      const text = extractCodexCliText(output.stdout) || streamedText.trim() || output.stdout.trim();
      if (!streamedText) {
        await emitTextDeltas(text, options);
      }
      return { text };
    } catch (error) {
      if (error instanceof Error) {
        throw new Error(
          `Codex CLI provider failed. Make sure @openai/codex is installed, "codex" is on PATH, and you are logged in with ChatGPT/Codex. Details: ${error.message}`,
        );
      }
      throw error;
    } finally {
      await systemPromptFile?.cleanup();
    }
  }
}

export interface OpenAIResponsesModelProviderOptions {
  model?: string;
  apiKey?: string;
  baseUrl?: string;
  reasoningEffort?: "low" | "medium" | "high" | "xhigh";
  maxOutputTokens?: number;
  allowWebSearch?: boolean;
  webSearchDomains?: string[];
  stream?: boolean;
  timeoutMs?: number;
  organizationId?: string;
  projectId?: string;
}

export interface OpenAICodexResponsesModelProviderOptions {
  model?: string;
  baseUrl?: string;
  responsesPath?: string;
  accessToken?: string;
  accountId?: string;
  codexHome?: string;
  reasoningEffort?: "low" | "medium" | "high" | "xhigh";
  maxOutputTokens?: number;
  timeoutMs?: number;
}

const MODEL_PRICING_PER_1M_TOKENS: Record<string, { input: number; output: number }> = {
  "gpt-5": { input: 1.25, output: 10.0 },
  "gpt-5-mini": { input: 0.25, output: 2.0 },
  "gpt-5-nano": { input: 0.05, output: 0.4 },
  "gpt-5.4": { input: 2.5, output: 15.0 },
  "gpt-5.4-mini": { input: 0.75, output: 4.5 },
};

const OPENAI_CODEX_DEFAULT_BASE_URL = "https://chatgpt.com/backend-api";
const OPENAI_CODEX_DEFAULT_RESPONSES_PATH = "/codex/responses";

export class OpenAIResponsesModelProvider implements ModelProvider {
  readonly label: string;
  readonly supportsHostedWebSearch = true;
  readonly pdfUrlReadSupport = "native" as const;
  readonly pdfFileReadSupport = "native" as const;
  private readonly model: string;
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly reasoningEffort?: OpenAIResponsesModelProviderOptions["reasoningEffort"];
  private readonly maxOutputTokens?: number;
  private readonly allowWebSearch: boolean;
  private readonly webSearchDomains: string[];
  private readonly stream: boolean;
  private readonly timeoutMs: number;
  private readonly organizationId?: string;
  private readonly projectId?: string;

  constructor(options: OpenAIResponsesModelProviderOptions = {}) {
    this.model = options.model ?? "gpt-5";
    this.label = `openai/${this.model}`;
    this.apiKey = options.apiKey ?? process.env.OPENAI_API_KEY ?? "";
    this.baseUrl = options.baseUrl ?? process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1/responses";
    this.reasoningEffort = options.reasoningEffort;
    this.maxOutputTokens = options.maxOutputTokens;
    this.allowWebSearch = options.allowWebSearch ?? false;
    this.webSearchDomains = options.webSearchDomains ?? [];
    this.stream = options.stream ?? true;
    this.timeoutMs = options.timeoutMs ?? 20_000;
    this.organizationId = options.organizationId ?? process.env.OPENAI_ORGANIZATION;
    this.projectId = options.projectId ?? process.env.OPENAI_PROJECT;
    if (!this.apiKey) {
      throw new Error("OPENAI_API_KEY is required for OpenAIResponsesModelProvider.");
    }
  }

  async complete(messages: ModelMessage[], options: ModelCompleteOptions = {}): Promise<ModelCompletion> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const headers: Record<string, string> = {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      };
      if (this.organizationId) headers["OpenAI-Organization"] = this.organizationId;
      if (this.projectId) headers["OpenAI-Project"] = this.projectId;
      const proxyUrl = process.env.HTTPS_PROXY ?? process.env.HTTP_PROXY;
      const response = await fetch(this.baseUrl, {
        method: "POST",
        headers,
        body: JSON.stringify(this.buildPayload(messages, options)),
        signal: controller.signal,
        ...(proxyUrl ? { dispatcher: new ProxyAgent(proxyUrl) } : {}),
      } as RequestInit & { dispatcher?: ProxyAgent });
      if (!response.ok) {
        const payload = parseJsonOrText(await response.text());
        throw new Error(`OpenAI API error ${response.status}: ${JSON.stringify(payload)}`);
      }
      const isEventStream = response.headers.get("content-type")?.includes("text/event-stream") ?? false;
      const payload = isEventStream
        ? await parseResponseEventStream(response, options)
        : parseJsonOrText(await response.text());
      const text = extractResponseText(payload);
      if (!isEventStream) {
        await emitTextDeltas(text, options);
      }
      return {
        text,
        usage: extractUsage(payload, String(payload.model ?? this.model)),
      };
    } catch (error) {
      if (isFetchConnectionError(error)) {
        throw new Error(
          `OpenAI API connection failed while calling ${this.baseUrl}. Check network access, proxy settings, OPENAI_BASE_URL, or use Local Echo for offline testing.`,
        );
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  private buildPayload(messages: ModelMessage[], options: ModelCompleteOptions = {}): Record<string, unknown> {
    const system = messages.find((message) => message.role === "system")?.content;
    const nonSystemMessages = messages.filter((message) => message.role !== "system");
    const lastUserIndex = nonSystemMessages.length - 1;
    const input = nonSystemMessages.map((message, index) => ({
      role: message.role === "tool" ? "user" : message.role,
      content: buildResponseInputContent(message.content, index === lastUserIndex ? options.attachments : undefined),
    }));
    const payload: Record<string, unknown> = {
      model: this.model,
      input,
    };
    if (this.stream) payload.stream = true;
    if (system) payload.instructions = system;
    const maxOutputTokens = options.maxOutputTokens ?? this.maxOutputTokens;
    if (maxOutputTokens !== undefined) payload.max_output_tokens = maxOutputTokens;
    if (this.reasoningEffort) payload.reasoning = { effort: this.reasoningEffort };
    const allowWebSearch = this.allowWebSearch || Boolean(options.hostedWebSearch);
    const webSearchDomains = options.webSearchDomains ?? this.webSearchDomains;
    if (allowWebSearch) {
      const webSearch: Record<string, unknown> = { type: "web_search", search_context_size: "high" };
      if (webSearchDomains.length > 0) {
        webSearch.filters = { allowed_domains: webSearchDomains };
      }
      payload.tools = [webSearch];
    }
    return payload;
  }
}

export class OpenAICodexResponsesModelProvider implements ModelProvider {
  readonly label: string;
  readonly supportsHostedWebSearch = true;
  readonly pdfUrlReadSupport = "native" as const;
  readonly pdfFileReadSupport = "native" as const;
  private readonly model: string;
  private readonly baseUrl: string;
  private readonly responsesPath: string;
  private readonly accessToken?: string;
  private readonly accountId?: string;
  private readonly codexHome?: string;
  private readonly reasoningEffort?: OpenAICodexResponsesModelProviderOptions["reasoningEffort"];
  private readonly maxOutputTokens?: number;
  private readonly timeoutMs: number;

  constructor(options: OpenAICodexResponsesModelProviderOptions = {}) {
    this.model = normalizeOpenAICodexModel(options.model ?? "gpt-5.4");
    this.label = `openai-codex/${this.model}`;
    this.baseUrl = options.baseUrl ?? process.env.OPENAI_CODEX_BASE_URL ?? OPENAI_CODEX_DEFAULT_BASE_URL;
    this.responsesPath =
      options.responsesPath ?? process.env.OPENAI_CODEX_RESPONSES_PATH ?? OPENAI_CODEX_DEFAULT_RESPONSES_PATH;
    this.accessToken = options.accessToken;
    this.accountId = options.accountId;
    this.codexHome = options.codexHome;
    this.reasoningEffort = options.reasoningEffort;
    this.maxOutputTokens = options.maxOutputTokens;
    this.timeoutMs = options.timeoutMs ?? 120_000;
  }

  async complete(messages: ModelMessage[], options: ModelCompleteOptions = {}): Promise<ModelCompletion> {
    const credential = await this.resolveCredential();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const headers: Record<string, string> = {
        Authorization: `Bearer ${credential.accessToken}`,
        "Content-Type": "application/json",
      };
      if (credential.accountId) {
        headers["ChatGPT-Account-ID"] = credential.accountId;
      }
      const proxyUrl = process.env.HTTPS_PROXY ?? process.env.HTTP_PROXY;
      const response = await fetch(joinUrl(this.baseUrl, this.responsesPath), {
        method: "POST",
        headers,
        body: JSON.stringify(this.buildPayload(messages, options)),
        signal: controller.signal,
        ...(proxyUrl ? { dispatcher: new ProxyAgent(proxyUrl) } : {}),
      } as RequestInit & { dispatcher?: ProxyAgent });
      if (!response.ok) {
        const raw = await response.text();
        const payload = parseJsonOrText(raw);
        throw new Error(`OpenAI Codex API error ${response.status}: ${JSON.stringify(payload)}`);
      }
      const isEventStream = response.headers.get("content-type")?.includes("text/event-stream") ?? false;
      const payload = isEventStream
        ? await parseResponseEventStream(response, options)
        : parseCodexResponseBody(await response.text());
      const text = extractResponseText(payload);
      if (!isEventStream) {
        await emitTextDeltas(text, options);
      }
      return {
        text,
        usage: extractUsage(payload, this.model),
      };
    } catch (error) {
      if (isFetchConnectionError(error)) {
        throw new Error(
          `OpenAI Codex OAuth connection failed while calling ${joinUrl(
            this.baseUrl,
            this.responsesPath,
          )}. Check network access, proxy settings, or use codex-cli/local-echo as fallback. Details: ${formatErrorDetail(error)}`,
        );
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  private async resolveCredential(): Promise<{ accessToken: string; accountId?: string }> {
    if (this.accessToken) {
      return { accessToken: this.accessToken, accountId: this.accountId };
    }
    const auth = await readCodexCliAuth(this.codexHome);
    if (!auth.accessToken) {
      throw new Error(
        "OpenAI Codex OAuth is not configured. Run Codex login first, or use codex-cli/local-echo.",
      );
    }
    return { accessToken: auth.accessToken, accountId: auth.accountId };
  }

  private buildPayload(messages: ModelMessage[], options: ModelCompleteOptions = {}): Record<string, unknown> {
    const system = messages.find((message) => message.role === "system")?.content;
    const nonSystemMessages = messages.filter((message) => message.role !== "system");
    const lastUserIndex = nonSystemMessages.length - 1;
    const input = nonSystemMessages.map((message, index) => ({
      role: message.role === "tool" ? "user" : message.role,
      content: buildResponseInputContent(message.content, index === lastUserIndex ? options.attachments : undefined),
    }));
    const payload: Record<string, unknown> = {
      model: this.model,
      input,
      store: false,
      stream: true,
    };
    if (system) payload.instructions = system;
    if (this.reasoningEffort) payload.reasoning = { effort: this.reasoningEffort };
    const maxOutputTokens = options.maxOutputTokens ?? this.maxOutputTokens;
    if (maxOutputTokens !== undefined && !isChatGptCodexBackend(this.baseUrl)) {
      payload.max_output_tokens = maxOutputTokens;
    }
    if (options.hostedWebSearch) {
      payload.tools = [buildCodexNativeWebSearchTool(options)];
    }
    return payload;
  }
}

function buildCodexNativeWebSearchTool(options: ModelCompleteOptions): Record<string, unknown> {
  const tool: Record<string, unknown> = {
    type: "web_search",
    external_web_access: true,
    search_context_size: "high",
  };
  if (options.webSearchDomains && options.webSearchDomains.length > 0) {
    tool.filters = { allowed_domains: options.webSearchDomains };
  }
  return tool;
}

function buildResponseInputContent(text: string, attachments?: ModelInputAttachment[]): Array<Record<string, unknown>> {
  const content: Array<Record<string, unknown>> = [
    {
      type: "input_text",
      text,
    },
  ];
  for (const attachment of attachments ?? []) {
    if (attachment.kind === "pdf_url") {
      const fileUrl = attachment.url?.trim();
      if (!fileUrl) continue;
      content.push({
        type: "input_file",
        file_url: fileUrl,
        filename: attachment.filename ?? "paper.pdf",
      });
      continue;
    }
    const filePath = attachment.path?.trim();
    if (!filePath) continue;
    const bytes = readFileSync(filePath);
    const base64 = bytes.toString("base64");
    content.push({
      type: "input_file",
      filename: attachment.filename ?? basenameForAttachment(filePath),
      file_data: `data:${attachment.mediaType ?? "application/pdf"};base64,${base64}`,
    });
  }
  return content;
}

function basenameForAttachment(filePath: string): string {
  return basename(filePath) || "paper.pdf";
}

function extractResponseText(payload: Record<string, unknown>): string {
  if (typeof payload.output_text === "string") {
    return payload.output_text;
  }
  const output = Array.isArray(payload.output) ? payload.output : [];
  const chunks: string[] = [];
  for (const item of output) {
    if (!isRecord(item) || item.type !== "message" || !Array.isArray(item.content)) continue;
    for (const content of item.content) {
      if (isRecord(content) && typeof content.text === "string") {
        chunks.push(content.text);
      }
    }
  }
  return chunks.join("\n").trim();
}

function extractUsage(payload: Record<string, unknown>, model: string): ModelCompletion["usage"] {
  const usage = isRecord(payload.usage) ? payload.usage : {};
  const inputTokens = numberFrom(usage.input_tokens) ?? numberFrom(usage.prompt_tokens) ?? 0;
  const outputTokens = numberFrom(usage.output_tokens) ?? numberFrom(usage.completion_tokens) ?? 0;
  const totalTokens = numberFrom(usage.total_tokens) ?? inputTokens + outputTokens;
  return {
    inputTokens,
    outputTokens,
    totalTokens,
    costUsd: estimateCostUsd(model, inputTokens, outputTokens),
  };
}

function estimateCostUsd(model: string, inputTokens: number, outputTokens: number): number {
  const pricing = MODEL_PRICING_PER_1M_TOKENS[normalizePricingModel(model)];
  if (!pricing) return 0;
  return Number(((inputTokens / 1_000_000) * pricing.input + (outputTokens / 1_000_000) * pricing.output).toFixed(6));
}

function normalizePricingModel(model: string): string {
  const lowered = model.trim().toLowerCase();
  return Object.keys(MODEL_PRICING_PER_1M_TOKENS).find((known) => lowered === known || lowered.startsWith(`${known}-`)) ?? lowered;
}

function numberFrom(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function isModelConnectionError(error: unknown): boolean {
  return error instanceof Error && /connection failed|fetch failed|econnreset|etimedout|enotfound|econnrefused|und_err/i.test(error.message);
}

export function isRetryableModelError(error: unknown): boolean {
  return (
    isModelConnectionError(error) ||
    (error instanceof Error && /aborted|terminated|timeout|timed out|socket|stream|ECONNRESET|ETIMEDOUT|UND_ERR|OpenAI API error (408|429|500|502|503|504)|OpenAI Codex API error (408|429|500|502|503|504)/i.test(error.message))
  );
}

export function isCodexDirectBackendUnavailableError(error: unknown): boolean {
  return (
    isModelConnectionError(error) ||
    (error instanceof Error && /OpenAI Codex API error (403|404|405|408|429|500|502|503|504)/i.test(error.message))
  );
}

function isFetchConnectionError(error: unknown): boolean {
  return error instanceof Error && (error.message.includes("fetch failed") || isModelConnectionError(error));
}

function formatErrorDetail(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  const cause = isRecord(error.cause) && typeof error.cause.message === "string" ? ` Cause: ${error.cause.message}` : "";
  return `${error.message}${cause}`;
}

async function writeCodexSystemPrompt(systemPrompt: string): Promise<{ filePath: string; cleanup: () => Promise<void> }> {
  const directory = await mkdtemp(join(tmpdir(), `kaivu-codex-system-${randomUUID()}-`));
  const filePath = join(directory, "system-prompt.md");
  await writeFile(filePath, systemPrompt, { encoding: "utf-8", mode: 0o600 });
  return {
    filePath,
    cleanup: async () => {
      await rm(directory, { recursive: true, force: true });
    },
  };
}

function normalizeCodexCliModel(model: string): string {
  return model.trim().replace(/^codex-cli\//, "") || "gpt-5.4";
}

function normalizeOpenAICodexModel(model: string): string {
  return model.trim().replace(/^openai-codex\//, "") || "gpt-5.4";
}

async function readCodexCliAuth(codexHome?: string): Promise<{ accessToken?: string; accountId?: string }> {
  const authPath = join(resolveCodexHome(codexHome), "auth.json");
  try {
    const parsed = JSON.parse(await readFile(authPath, "utf-8")) as unknown;
    if (!isRecord(parsed) || parsed.auth_mode !== "chatgpt" || !isRecord(parsed.tokens)) {
      return {};
    }
    const accessToken = stringFrom(parsed.tokens.access_token);
    const accountId = stringFrom(parsed.tokens.account_id);
    return {
      ...(accessToken ? { accessToken } : {}),
      ...(accountId ? { accountId } : {}),
    };
  } catch {
    return {};
  }
}

export function isCodexCliOAuthConfigured(codexHome?: string): boolean {
  const authPath = join(resolveCodexHome(codexHome), "auth.json");
  if (!existsSync(authPath)) return false;
  try {
    const raw = readFileSync(authPath, "utf-8");
    const parsed = JSON.parse(raw) as unknown;
    return Boolean(isRecord(parsed) && parsed.auth_mode === "chatgpt" && isRecord(parsed.tokens) && stringFrom(parsed.tokens.access_token));
  } catch {
    return false;
  }
}

function resolveCodexHome(codexHome?: string): string {
  const configured = codexHome ?? process.env.CODEX_HOME;
  if (!configured) return join(homedir(), ".codex");
  if (configured === "~") return homedir();
  if (configured.startsWith("~/") || configured.startsWith("~\\")) return join(homedir(), configured.slice(2));
  return resolve(configured);
}

function resolveDefaultCodexCommand(): string {
  const candidates =
    process.platform === "win32" && process.arch === "x64"
      ? [
          join(
            process.cwd(),
            "node_modules",
            "@openai",
            "codex-win32-x64",
            "vendor",
            "x86_64-pc-windows-msvc",
            "codex",
            "codex.exe",
          ),
        ]
      : [join(process.cwd(), "node_modules", ".bin", "codex")];
  return candidates.find((candidate) => existsSync(candidate)) ?? "codex";
}

function joinUrl(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
}

function isChatGptCodexBackend(baseUrl: string): boolean {
  return /^https?:\/\/chatgpt\.com\/backend-api/i.test(baseUrl);
}

function stringFrom(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function emitTextDeltas(text: string, options: ModelCompleteOptions): Promise<void> {
  if (!options.onTextDelta || !text) return;
  const chunkSize = 32;
  for (let index = 0; index < text.length; index += chunkSize) {
    options.onTextDelta(text.slice(index, index + chunkSize));
    await sleep(8);
  }
}

async function readJsonOrText(response: Response): Promise<Record<string, unknown>> {
  const raw = await response.text();
  return parseJsonOrText(raw);
}

function parseJsonOrText(raw: string): Record<string, unknown> {
  if (!raw.trim()) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    return isRecord(parsed) ? parsed : { value: parsed };
  } catch {
    return { text: raw.slice(0, 1000) };
  }
}

function parseCodexResponseBody(raw: string): Record<string, unknown> {
  const trimmed = raw.trim();
  if (!trimmed) return {};
  if (trimmed.startsWith("{")) {
    return parseJsonOrText(trimmed);
  }
  const events: unknown[] = [];
  for (const line of trimmed.split(/\r?\n/)) {
    const clean = line.trim();
    if (!clean.startsWith("data:")) continue;
    const data = clean.slice("data:".length).trim();
    if (!data || data === "[DONE]") continue;
    try {
      events.push(JSON.parse(data) as unknown);
    } catch {
      continue;
    }
  }
  const text = extractAssistantFinalTextFromEvent(events).join("\n").trim() || extractAssistantTextDeltas(events).join("").trim();
  const usage = extractLastUsage(events);
  return {
    output_text: text,
    ...(usage ? { usage } : {}),
  };
}

async function parseResponseEventStream(response: Response, options: ModelCompleteOptions): Promise<Record<string, unknown>> {
  if (!response.body) return {};
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const events: unknown[] = [];
  const emitted: string[] = [];
  let buffer = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const chunks = splitSseFrames(buffer);
    buffer = chunks.pop() ?? "";
    for (const chunk of chunks) {
      const event = parseCodexSseChunk(chunk);
      if (!event) continue;
      events.push(event);
      for (const delta of extractAssistantTextDeltas(event)) {
        emitted.push(delta);
        options.onTextDelta?.(delta);
      }
    }
  }

  if (buffer.trim()) {
    const event = parseCodexSseChunk(buffer);
    if (event) {
      events.push(event);
      for (const delta of extractAssistantTextDeltas(event)) {
        emitted.push(delta);
        options.onTextDelta?.(delta);
      }
    }
  }

  const finalText = extractAssistantFinalTextFromEvent(events).join("\n").trim();
  const usage = extractLastUsage(events);
  return {
    output_text: finalText || emitted.join("").trim(),
    ...(usage ? { usage } : {}),
  };
}

function parseCodexSseChunk(chunk: string): unknown | undefined {
  const dataLines = chunk
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice("data:".length).trim())
    .filter((line) => line && line !== "[DONE]");
  const raw = dataLines.length > 0 ? dataLines.join("\n") : chunk.trim();
  if (!raw || raw === "[DONE]" || !raw.startsWith("{")) return undefined;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return undefined;
  }
}

function splitSseFrames(buffer: string): string[] {
  const frames: string[] = [];
  let rest = buffer;
  while (true) {
    const match = /\r?\n\r?\n/.exec(rest);
    if (!match) break;
    frames.push(rest.slice(0, match.index));
    rest = rest.slice(match.index + match[0].length);
  }
  frames.push(rest);
  return frames;
}

function extractAssistantTextDeltas(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap((item) => extractAssistantTextDeltas(item));
  if (!isRecord(value)) return [];
  const type = typeof value.type === "string" ? value.type.toLowerCase() : "";
  const delta = typeof value.delta === "string" ? value.delta : undefined;
  if (delta && isTextDeltaType(type)) return [delta];
  return ["output", "message", "item", "data", "response", "content"]
    .flatMap((key) => extractAssistantTextDeltas(value[key]))
    .filter((item) => item.trim());
}

function extractLastUsage(events: unknown[]): Record<string, unknown> | undefined {
  for (const event of [...events].reverse()) {
    const usage = findUsage(event);
    if (usage) return usage;
  }
  return undefined;
}

function findUsage(value: unknown): Record<string, unknown> | undefined {
  if (Array.isArray(value)) {
    for (const item of value) {
      const usage = findUsage(item);
      if (usage) return usage;
    }
    return undefined;
  }
  if (!isRecord(value)) return undefined;
  if (isRecord(value.usage)) return value.usage;
  for (const item of Object.values(value)) {
    const usage = findUsage(item);
    if (usage) return usage;
  }
  return undefined;
}

function runCommand(params: {
  command: string;
  args: string[];
  cwd?: string;
  timeoutMs: number;
  onStdoutLine?: (line: string) => void;
}): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(params.command, params.args, {
      cwd: params.cwd,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stdout: string[] = [];
    const stderr: string[] = [];
    let stdoutLineBuffer = "";
    const timeout = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error(`command timed out after ${params.timeoutMs}ms`));
    }, params.timeoutMs);
    child.stdout?.setEncoding("utf-8");
    child.stderr?.setEncoding("utf-8");
    child.stdout?.on("data", (chunk: string) => {
      stdout.push(chunk);
      if (!params.onStdoutLine) return;
      stdoutLineBuffer += chunk;
      const lines = stdoutLineBuffer.split(/\r?\n/);
      stdoutLineBuffer = lines.pop() ?? "";
      for (const line of lines) {
        if (line.trim()) params.onStdoutLine(line);
      }
    });
    child.stderr?.on("data", (chunk: string) => stderr.push(chunk));
    child.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timeout);
      if (stdoutLineBuffer.trim()) {
        params.onStdoutLine?.(stdoutLineBuffer);
      }
      const out = stdout.join("");
      const err = stderr.join("");
      if (code === 0) {
        resolve({ stdout: out, stderr: err });
        return;
      }
      reject(new Error(`command exited with code ${code}. ${err || out}`.trim()));
    });
  });
}

function extractCodexCliText(stdout: string): string {
  const candidates: string[] = [];
  for (const line of stdout.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{")) continue;
    try {
      const event = JSON.parse(trimmed) as unknown;
      candidates.push(...extractAssistantTextFromEvent(event));
    } catch {
      continue;
    }
  }
  return candidates.at(-1)?.trim() ?? "";
}

function extractCodexCliDeltas(line: string): string[] {
  const trimmed = line.trim();
  if (!trimmed.startsWith("{")) return [];
  try {
    return extractAssistantTextDeltas(JSON.parse(trimmed) as unknown);
  } catch {
    return [];
  }
}

function extractAssistantTextFromEvent(value: unknown, assistantContext = false): string[] {
  if (typeof value === "string") {
    return assistantContext && value.trim() ? [value] : [];
  }
  if (Array.isArray(value)) {
    return value.flatMap((item) => extractAssistantTextFromEvent(item, assistantContext));
  }
  if (!isRecord(value)) return [];
  const role = typeof value.role === "string" ? value.role.toLowerCase() : "";
  const type = typeof value.type === "string" ? value.type.toLowerCase() : "";
  if (typeof value.output_text === "string" && value.output_text.trim()) {
    return [value.output_text];
  }
  if (typeof value.delta === "string" && isTextDeltaType(type)) {
    return [value.delta];
  }
  const nextAssistantContext =
    assistantContext ||
    role === "assistant" ||
    type.includes("assistant") ||
    type === "agent_message" ||
    type === "message";
  if (nextAssistantContext) {
    const contentText = extractAssistantContentText(value.content);
    const text = typeof value.text === "string" ? [value.text] : [];
    if (contentText.length > 0 || text.length > 0) {
      return [...contentText, ...text].filter((item) => item.trim());
    }
  }
  return ["output", "message", "item", "data", "response"]
    .flatMap((key) => extractAssistantTextFromEvent(value[key], nextAssistantContext))
    .filter((item) => item.trim());
}

function extractAssistantFinalTextFromEvent(value: unknown, assistantContext = false): string[] {
  if (Array.isArray(value)) return value.flatMap((item) => extractAssistantFinalTextFromEvent(item, assistantContext));
  if (!isRecord(value)) return [];
  const role = typeof value.role === "string" ? value.role.toLowerCase() : "";
  const type = typeof value.type === "string" ? value.type.toLowerCase() : "";
  if (typeof value.output_text === "string" && value.output_text.trim()) {
    return [value.output_text];
  }
  const nextAssistantContext =
    assistantContext ||
    role === "assistant" ||
    type.includes("assistant") ||
    type === "agent_message" ||
    type === "message";
  if (nextAssistantContext) {
    const contentText = extractAssistantContentText(value.content);
    const text = typeof value.text === "string" ? [value.text] : [];
    if (contentText.length > 0 || text.length > 0) {
      return [...contentText, ...text].filter((item) => item.trim());
    }
  }
  return ["output", "message", "item", "data", "response"]
    .flatMap((key) => extractAssistantFinalTextFromEvent(value[key], nextAssistantContext))
    .filter((item) => item.trim());
}

function extractAssistantContentText(value: unknown): string[] {
  if (typeof value === "string") return value.trim() ? [value] : [];
  if (Array.isArray(value)) return value.flatMap((item) => extractAssistantContentText(item));
  if (!isRecord(value)) return [];
  const type = typeof value.type === "string" ? value.type.toLowerCase() : "";
  const text = typeof value.text === "string" ? value.text : undefined;
  if (text && isAssistantContentType(type)) return [text];
  return ["content", "parts"].flatMap((key) => extractAssistantContentText(value[key]));
}

function isAssistantContentType(type: string): boolean {
  return !type || type === "text" || type === "output_text" || type === "final_answer" || type === "message_text";
}

function isTextDeltaType(type: string): boolean {
  return type.includes("output_text.delta") || type.includes("text.delta") || type.includes("final_answer.delta");
}
