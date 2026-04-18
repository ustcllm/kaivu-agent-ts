import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { ExperimentDesignAgent } from "../agent/specialists/ExperimentDesignAgent.js";
import { HypothesisGenerationAgent } from "../agent/specialists/HypothesisGenerationAgent.js";
import { LiteratureReviewAgent } from "../agent/specialists/LiteratureReviewAgent.js";
import { ProblemFramingAgent } from "../agent/specialists/ProblemFramingAgent.js";
import { VerificationAgent } from "../agent/specialists/VerificationAgent.js";
import { SciAgent } from "../agent/SciAgent.js";
import { CredentialResolver } from "../auth/CredentialResolver.js";
import { InMemoryCredentialStore } from "../auth/CredentialStore.js";
import { OpenAIAuthService } from "../auth/OpenAIAuthService.js";
import { ScientificCapabilityRegistry } from "../capabilities/ScientificCapabilityRegistry.js";
import { ResearchGraphRegistry } from "../graph/ResearchGraph.js";
import { LiteratureKnowledgeBase } from "../literature/LiteratureKnowledgeBase.js";
import type { ResearchState } from "../shared/ResearchStateTypes.js";
import { SciLoop } from "../loop/SciLoop.js";
import type { TrajectoryEvent } from "../loop/Trajectory.js";
import { SciMemory } from "../memory/SciMemory.js";
import {
  CodexCliModelProvider,
  EchoModelProvider,
  isCodexCliOAuthConfigured,
  OpenAICodexResponsesModelProvider,
  OpenAIResponsesModelProvider,
  RetryingModelProvider,
  type ModelProvider,
} from "../runtime/ModelProvider.js";
import { createResearchToolRegistry } from "../runtime/ResearchToolRegistry.js";
import { SciRuntime } from "../runtime/SciRuntime.js";
import type { ResearchMode, ScientificTask, ScientificStage } from "../shared/ScientificLifecycle.js";
import type { AuthIdentity, AuthSession } from "../auth/AuthSession.js";

export interface KaivuApiServerOptions {
  port?: number;
  host?: string;
}

export interface OpenAIKeyLoginBody {
  identity: AuthIdentity;
  apiKey: string;
  scope?: "user" | "project" | "group" | "platform";
  organizationId?: string;
  projectId?: string;
}

export interface ResearchRunBody {
  sessionId?: string;
  query?: string;
  task?: ScientificTask;
  mode?: ResearchMode;
  maxIterations?: number;
  model?: string;
  discipline?: string;
  stageOrder?: ScientificStage[];
  pauseAfterStage?: boolean;
  initialState?: ResearchState;
  stageInteraction?: StageInteractionRequest;
}

export interface StageInteractionRequest {
  action: "revise_current_stage" | "proceed_to_next_stage";
  message?: string;
}

export class KaivuApiServer {
  private readonly credentialStore = new InMemoryCredentialStore();
  private readonly auth = new OpenAIAuthService(this.credentialStore);
  private readonly resolver = new CredentialResolver(this.credentialStore);
  private readonly sessions = new Map<string, AuthSession>();

  constructor(private readonly options: KaivuApiServerOptions = {}) {}

  start(): void {
    const server = createServer((request, response) => {
      this.handle(request, response).catch((error: unknown) => {
        writeJson(response, 500, { error: error instanceof Error ? error.message : String(error) });
      });
    });
    server.listen(this.options.port ?? 8787, this.options.host ?? "127.0.0.1");
  }

  private async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    if (request.method === "OPTIONS") {
      writeJson(response, 204, {});
      return;
    }
    if (request.method === "GET" && request.url?.startsWith("/vendor/marked.esm.js")) {
      await serveVendorMarked(response);
      return;
    }
    if (request.method === "GET" && (request.url === "/" || request.url?.startsWith("/app.js") || request.url?.startsWith("/styles.css"))) {
      await servePublic(request.url, response);
      return;
    }
    if (request.method === "GET" && request.url === "/health") {
      writeJson(response, 200, {
        ok: true,
        service: "kaivu-agent-api",
        openaiKeyConfigured: Boolean(process.env.OPENAI_API_KEY),
        openaiBaseUrl: process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1/responses",
        proxyConfigured: Boolean(process.env.HTTPS_PROXY ?? process.env.HTTP_PROXY),
        codexCliCommand: process.env.CODEX_CLI_COMMAND ?? "codex",
        codexOAuthConfigured: isCodexCliOAuthConfigured(),
        codexBaseUrl: process.env.OPENAI_CODEX_BASE_URL ?? "https://chatgpt.com/backend-api",
      });
      return;
    }
    if (request.method === "POST" && request.url === "/auth/openai-key") {
      const body = await readJson<OpenAIKeyLoginBody>(request);
      const login = await this.auth.loginWithApiKey(body);
      this.sessions.set(login.session.id, login.session);
      writeJson(response, 200, login);
      return;
    }
    if (request.method === "POST" && request.url === "/research/run") {
      const body = await readJson<ResearchRunBody>(request);
      const result = await this.runResearch(body);
      writeJson(response, 200, result);
      return;
    }
    if (request.method === "POST" && request.url === "/research/run-stream") {
      const body = await readJson<ResearchRunBody>(request);
      await this.streamResearch(body, response);
      return;
    }
    writeJson(response, 404, { error: "not found" });
  }

  private async runResearch(
    body: ResearchRunBody,
    onEvent?: (event: TrajectoryEvent) => void,
  ): Promise<Awaited<ReturnType<SciLoop["run"]>>> {
    const model = await this.resolveModel(body);
    const task = body.task ?? taskFromQuery(body.query ?? "");
    if (!task.question.trim()) {
      throw new Error("query or task.question is required");
    }
    const literature = new LiteratureKnowledgeBase();
    const graph = new ResearchGraphRegistry();
    const memory = new SciMemory();
    const runtime = new SciRuntime(model, createResearchToolRegistry(literature), literature, new ScientificCapabilityRegistry(), undefined, graph);
    const agent = new SciAgent({
      id: "chief_scientific_agent",
      discipline: task.discipline ?? "to_be_determined",
      specialists: [
        new ProblemFramingAgent(),
        new LiteratureReviewAgent(),
        new HypothesisGenerationAgent(),
        new VerificationAgent(),
        new ExperimentDesignAgent(),
      ],
      stageOrder: body.stageOrder ?? ["problem_framing", "literature_review", "hypothesis_generation", "hypothesis_validation", "experiment_design"],
    });
    const loop = new SciLoop(runtime, memory, graph);
    const initialState = prepareInteractiveState(body.initialState, body.stageInteraction);
    return await loop.run({
      task,
      agent,
      mode: body.mode ?? "interactive",
      maxIterations: body.maxIterations ?? 2,
      pauseAfterStage: body.pauseAfterStage ?? false,
      initialState,
      onEvent,
    });
  }

  private async streamResearch(body: ResearchRunBody, response: ServerResponse): Promise<void> {
    response.socket?.setNoDelay(true);
    response.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "Access-Control-Allow-Origin": "*",
      "X-Accel-Buffering": "no",
    });
    response.flushHeaders();
    writeSse(response, "status", {
      message: "Research loop started.",
      model: body.model ?? "local-echo",
      maxIterations: body.maxIterations ?? 2,
      pauseAfterStage: body.pauseAfterStage ?? false,
    });
    try {
      const result = await this.runResearch(body, (event) => {
        writeSse(response, "trajectory", {
          event,
          message: describeTrajectoryEvent(event),
          details: trajectoryEventDetails(event),
        });
      });
      writeSse(response, "result", result);
    } catch (error) {
      writeSse(response, "error", { error: error instanceof Error ? error.message : String(error) });
    } finally {
      response.end();
    }
  }

  private async resolveModel(body: ResearchRunBody): Promise<ModelProvider> {
    const withRetry = (provider: ModelProvider) => new RetryingModelProvider(provider, { maxAttempts: 10 });
    if (!body.model || body.model === "local-echo") {
      return new EchoModelProvider();
    }
    if (body.model.startsWith("codex-cli/")) {
      return withRetry(new CodexCliModelProvider({
        model: body.model,
        cwd: process.cwd(),
      }));
    }
    if (body.model.startsWith("openai-codex/")) {
      return withRetry(new OpenAICodexResponsesModelProvider({
        model: body.model,
      }));
    }
    if (body.sessionId) {
      const session = this.sessions.get(body.sessionId);
      if (!session) {
        throw new Error("Unknown or expired session. Create a new OpenAI session or use Local Echo.");
      }
      return withRetry(await this.resolver.createOpenAIProvider(session, {
        model: body.model,
      }));
    }
    try {
      return withRetry(new OpenAIResponsesModelProvider({
        model: body.model,
      }));
    } catch (error) {
      throw new Error(
        `${error instanceof Error ? error.message : String(error)} The web UI no longer accepts API keys; set OPENAI_API_KEY in .env and restart the server, or use Local Echo.`,
      );
    }
  }
}

async function readJson<T>(request: IncomingMessage): Promise<T> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const raw = Buffer.concat(chunks).toString("utf-8");
  return JSON.parse(raw || "{}") as T;
}

function writeJson(response: ServerResponse, statusCode: number, payload: unknown): void {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type,Authorization",
  });
  response.end(statusCode === 204 ? "" : JSON.stringify(payload, null, 2));
}

function writeSse(response: ServerResponse, event: string, payload: unknown): void {
  response.write(`event: ${event}\n`);
  response.write(`data: ${JSON.stringify(payload)}\n\n`);
}

function describeTrajectoryEvent(event: TrajectoryEvent): string {
  const payload = event.payload;
  if (event.type === "loop_decision") {
    return `Loop selected stage: ${String(payload.stage ?? "unknown")}. ${String(payload.reason ?? "")}`;
  }
  if (event.type === "stage_plan") {
    return `Plan ${String(payload.stage ?? "unknown")}.`;
  }
  if (event.type === "runtime_events") {
    const events = Array.isArray(payload.events) ? payload.events : [];
    const first = events.find((item): item is Record<string, unknown> => typeof item === "object" && item !== null);
    return `${String(first?.stage ?? "stage")}: ${humanizeEventType(String(first?.type ?? "runtime_event"))}.`;
  }
  if (event.type === "stage_output") {
    return `${String(payload.stage ?? "stage")} output ready.`;
  }
  if (event.type === "memory_commit") {
    return `Memory updated: ${String(payload.committedCount ?? 0)} item(s).`;
  }
  if (event.type === "graph_update") {
    return `Graph updated with ${String(payload.factCount ?? 0)} fact(s).`;
  }
  if (event.type === "state_update") {
    const decision = typeof payload.decision === "object" && payload.decision !== null ? payload.decision as Record<string, unknown> : {};
    return `State updated after ${String(payload.stage ?? "stage")}: ${String(decision.status ?? "unknown")} -> ${String(decision.nextStage ?? "next")}.`;
  }
  if (event.type === "final_result") {
    return `Research loop finished: ${String(payload.stopReason ?? "completed")}.`;
  }
  return event.type;
}

function trajectoryEventDetails(event: TrajectoryEvent): Record<string, unknown> {
  const payload = event.payload;
  if (event.type === "stage_plan") {
    return inputOutput({
      input: {
        stage: payload.stage,
        objective: payload.objective,
      },
      output: {
        specialist: payload.specialistId,
        expectedOutputs: payload.expectedOutputs,
      },
    });
  }
  if (event.type === "runtime_events") {
    const events = Array.isArray(payload.events) ? payload.events : [];
    return inputOutput({
      input: {
        stage: firstRuntimeStage(events),
      },
      output: {
        events: events.map((item) => summarizeRuntimeEvent(item)),
      },
    });
  }
  if (event.type === "stage_output") {
    const input = typeof payload.input === "object" && payload.input !== null ? payload.input as Record<string, unknown> : {};
    const output = typeof payload.output === "object" && payload.output !== null ? payload.output as Record<string, unknown> : {};
    const runtime = typeof payload.runtime === "object" && payload.runtime !== null ? payload.runtime as Record<string, unknown> : {};
    const observability = typeof payload.observability === "object" && payload.observability !== null ? payload.observability as Record<string, unknown> : {};
    return {
      input: pickDefined(input),
      output: pickDefined({
        summary: output.summary,
        evidence: summarizeEvidence(output.evidence),
        hypotheses: summarizeHypotheses(output.hypotheses),
        artifacts: summarizeArtifacts(output.artifacts),
        decision: output.decision,
      }),
      runtime: pickDefined({
        model: runtime.model,
        tools: summarizeRuntimeTools(runtime.tools),
        contextPack: runtime.contextPack,
      }),
      observability: pickDefined({
        processTraceCount: Array.isArray(observability.processTrace) ? observability.processTrace.length : undefined,
      }),
      review: payload.review,
    };
  }
  if (event.type === "memory_commit") {
    return inputOutput({
      input: {
        proposals: payload.committedCount,
      },
      output: {
        committed: payload.committed,
        skipped: payload.skipped,
      },
    });
  }
  if (event.type === "graph_update") {
    return inputOutput({
      input: {
        proposalCount: payload.proposalCount,
      },
      output: {
        factCount: payload.factCount,
        facts: payload.facts,
      },
    });
  }
  if (event.type === "state_update") {
    const decision = typeof payload.decision === "object" && payload.decision !== null ? payload.decision as Record<string, unknown> : {};
    return inputOutput({
      input: {
        stage: payload.stage,
        evidenceCount: payload.evidenceCount,
        hypothesisCount: payload.hypothesisCount,
      },
      output: {
        decision: decision.status,
        nextStage: decision.nextStage,
        reason: decision.reason,
        confidence: decision.confidence,
      },
    });
  }
  if (event.type === "final_result") {
    return inputOutput({
      input: {
        iteration: payload.iteration,
      },
      output: {
        done: payload.done,
        stopReason: payload.stopReason,
        currentStage: payload.currentStage,
      },
    });
  }
  return inputOutput({ input: {}, output: pickDefined(payload) });
}

function summarizeRuntimeEvent(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null) return { value };
  const event = value as Record<string, unknown>;
  const payload = typeof event.payload === "object" && event.payload !== null ? event.payload as Record<string, unknown> : {};
  if (event.type === "stage_started") {
    return pickDefined({
      event: "stage started",
      stage: event.stage,
      input: {
        specialist: payload.specialistId,
      },
      output: {
        status: "stage initialized",
      },
      runtime: {
        tools: summarizeRuntimeTools(payload.candidateTools),
      },
    });
  }
  if (event.type === "model_call") {
    return pickDefined({
      event: "model call",
      stage: event.stage,
      input: {
        specialist: payload.specialistId,
        objective: payload.objective,
        recalledMemoryItems: payload.memoryContextCount,
      },
      output: "waiting for model response",
      runtime: {
        model: payload.model,
      },
    });
  }
  if (event.type === "context_pack") {
    return pickDefined({
      event: "context pack",
      stage: event.stage,
      input: {
        specialist: payload.specialistId,
      },
      output: {
        packId: payload.packId,
        counts: payload.counts,
        requiredPacks: payload.requiredPacks,
        optionalPacks: payload.optionalPacks,
      },
      runtime: {
        estimatedTokens: payload.estimatedTokens,
        targetTokens: payload.targetTokens,
        budgetExceeded: payload.budgetExceeded,
      },
    });
  }
  if (event.type === "model_delta") {
    return pickDefined({
      event: "model delta",
      stage: event.stage,
      input: {
        specialist: payload.specialistId,
      },
      output: {
        delta: payload.delta,
      },
      runtime: {
        model: payload.model,
      },
    });
  }
  if (event.type === "stage_progress") {
    return pickDefined({
      event: "stage progress",
      stage: event.stage,
      input: {
        specialist: payload.specialistId,
      },
      output: {
        label: payload.label,
        detail: payload.detail,
        data: payload.data,
      },
    });
  }
  if (event.type === "model_status") {
    return pickDefined({
      event: "model status",
      stage: event.stage,
      input: {
        specialist: payload.specialistId,
      },
      output: {
        status: payload.type,
        attempt: payload.attempt,
        maxAttempts: payload.maxAttempts,
        delayMs: payload.delayMs,
        reason: previewText(payload.reason, 400),
      },
      runtime: {
        model: payload.model,
        fallbackModel: payload.fallbackModel,
      },
    });
  }
  if (event.type === "model_prompt") {
    return pickDefined({
      event: "model prompt",
      stage: event.stage,
      input: {
        specialist: payload.specialistId,
      },
      output: {
        prompt: summarizePrompts([payload.prompt]),
      },
      runtime: {
        model: payload.model,
      },
    });
  }
  if (event.type === "stage_completed") {
    return pickDefined({
      event: "stage completed",
      stage: event.stage,
      input: {
        specialist: payload.specialistId,
      },
      output: {
        status: "stage output captured",
        evidenceCount: payload.evidenceCount,
        hypothesisCount: payload.hypothesisCount,
        artifactCount: payload.artifactCount,
      },
    });
  }
  return pickDefined({
    event: event.type,
    stage: event.stage,
    output: previewText(payload.summary) ?? payload,
  });
}

function summarizeCandidateTools(value: unknown): unknown {
  if (typeof value !== "object" || value === null) return value;
  const summary: Record<string, unknown> = {};
  for (const [capability, raw] of Object.entries(value as Record<string, unknown>)) {
    const item = typeof raw === "object" && raw !== null ? raw as Record<string, unknown> : {};
    const tools = Array.isArray(item.tools)
      ? item.tools.map((tool) => {
          const record = typeof tool === "object" && tool !== null ? tool as Record<string, unknown> : {};
          const policy = typeof record.policy === "object" && record.policy !== null ? record.policy as Record<string, unknown> : {};
          return pickDefined({
            toolName: record.toolName,
            decision: policy.decision,
            reason: policy.reason,
            riskLevel: policy.riskLevel,
          });
        })
      : [];
    summary[capability] = pickDefined({
      pack: item.pack,
      executionMode: item.executionMode,
      requiresApproval: item.requiresApproval,
      tools,
    });
  }
  return summary;
}

function summarizeRuntimeTools(value: unknown): unknown {
  if (typeof value !== "object" || value === null) return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([capability, raw]) => {
      const item = typeof raw === "object" && raw !== null ? raw as Record<string, unknown> : {};
      const tools = Array.isArray(item.tools)
        ? item.tools
            .map((tool) => (typeof tool === "object" && tool !== null ? String((tool as Record<string, unknown>).toolName ?? "") : ""))
            .filter(Boolean)
        : [];
      return [
        capability,
        pickDefined({
          pack: item.pack,
          mode: item.executionMode,
          tools,
        }),
      ];
    }),
  );
}

function summarizePrompts(value: unknown): unknown {
  if (!Array.isArray(value)) return value;
  return value.map((item) => {
    const record = typeof item === "object" && item !== null ? item as Record<string, unknown> : {};
    return pickDefined({
      specialist: record.specialistId,
      system: previewText(record.system, 500),
      user: previewText(record.user, 1200),
    });
  });
}

function summarizeEvidence(value: unknown): unknown {
  if (!Array.isArray(value)) return value;
  return value.map((item) => {
    const record = typeof item === "object" && item !== null ? item as Record<string, unknown> : {};
    return pickDefined({
      claim: record.claim,
      source: record.source,
      strength: record.strength,
      uncertainty: record.uncertainty,
    });
  });
}

function summarizeHypotheses(value: unknown): unknown {
  if (!Array.isArray(value)) return value;
  return value.map((item) => {
    const record = typeof item === "object" && item !== null ? item as Record<string, unknown> : {};
    return pickDefined({
      statement: record.statement,
      assumptions: record.assumptions,
      predictions: record.predictions,
      falsificationTests: record.falsificationTests,
      status: record.status,
    });
  });
}

function summarizeArtifacts(value: unknown): unknown {
  if (!Array.isArray(value)) return value;
  return value.map((item) => {
    const record = typeof item === "object" && item !== null ? item as Record<string, unknown> : {};
    return pickDefined({
      id: record.id,
      kind: record.kind,
      uri: record.uri,
    });
  });
}

function pickDefined(record: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(record).filter(([, value]) => value !== undefined));
}

function inputOutput(value: { input: Record<string, unknown>; output: Record<string, unknown> }): Record<string, unknown> {
  return {
    input: pickDefined(value.input),
    output: pickDefined(value.output),
  };
}

function firstRuntimeStage(events: unknown[]): unknown {
  const first = events.find((item) => typeof item === "object" && item !== null) as Record<string, unknown> | undefined;
  return first?.stage;
}

function previewText(value: unknown, limit = 700): unknown {
  if (typeof value !== "string") return value;
  return value.length > limit ? `${value.slice(0, limit)}...` : value;
}

function humanizeEventType(type: string): string {
  return type.replaceAll("_", " ");
}

async function servePublic(url: string | undefined, response: ServerResponse): Promise<void> {
  const route = url === "/" ? "/index.html" : url ?? "/index.html";
  const relative = normalize(route.replace(/^\/+/, ""));
  if (relative.startsWith("..")) {
    writeJson(response, 403, { error: "forbidden" });
    return;
  }
  const path = join(process.cwd(), "public", relative);
  try {
    const content = await readFile(path);
    response.writeHead(200, {
      "Content-Type": contentType(path),
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "no-store",
    });
    response.end(content);
  } catch {
    writeJson(response, 404, { error: "not found" });
  }
}

async function serveVendorMarked(response: ServerResponse): Promise<void> {
  try {
    const content = await readFile(join(process.cwd(), "node_modules", "marked", "lib", "marked.esm.js"));
    response.writeHead(200, {
      "Content-Type": "text/javascript; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "no-store",
    });
    response.end(content);
  } catch {
    writeJson(response, 404, { error: "marked vendor bundle not found; run npm install" });
  }
}

function contentType(path: string): string {
  if (extname(path) === ".html") return "text/html; charset=utf-8";
  if (extname(path) === ".css") return "text/css; charset=utf-8";
  if (extname(path) === ".js") return "text/javascript; charset=utf-8";
  return "application/octet-stream";
}

function taskFromQuery(query: string): ScientificTask {
  const question = query.trim();
  return {
    id: `web_task_${Date.now()}`,
    title: question.slice(0, 80) || "Untitled research task",
    question,
    taskType: "chat_research",
  };
}

function prepareInteractiveState(
  state: ResearchState | undefined,
  interaction: StageInteractionRequest | undefined,
): ResearchState | undefined {
  if (!state) return undefined;
  const unpaused = state.stopReason?.startsWith("paused_after_")
    ? { ...state, done: false, stopReason: undefined }
    : { ...state };
  if (!interaction) return unpaused;

  const completedStage = unpaused.completedStages.at(-1);
  const targetStage = interaction.action === "revise_current_stage"
    ? completedStage ?? unpaused.currentStage
    : unpaused.currentStage;
  const message = interaction.message?.trim();
  const pendingStageInputs = { ...(unpaused.pendingStageInputs ?? {}) };
  if (message) {
    const sourceStage = interaction.action === "revise_current_stage"
      ? targetStage
      : completedStage ?? unpaused.currentStage;
    pendingStageInputs[targetStage] = [
      ...(pendingStageInputs[targetStage] ?? []),
      {
        id: `stage_input_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        createdAt: new Date().toISOString(),
        sourceStage,
        targetStage,
        action: interaction.action,
        message,
      },
    ];
  }

  return {
    ...unpaused,
    currentStage: targetStage,
    pendingStageInputs,
  };
}
