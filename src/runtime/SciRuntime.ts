import type { SciAgent } from "../agent/SciAgent.js";
import type { SpecialistAgent } from "../agent/SpecialistAgent.js";
import { ScientificCapabilityRegistry } from "../capabilities/ScientificCapabilityRegistry.js";
import type { LiteratureKnowledgeBase } from "../literature/LiteratureKnowledgeBase.js";
import type { SciMemory } from "../memory/SciMemory.js";
import { makeId } from "../shared/ids.js";
import type { StagePlan, StageResult } from "../shared/types.js";
import type { ModelProvider } from "./ModelProvider.js";
import type { ModelRegistry } from "./ModelRegistry.js";
import type { RuntimeEvent } from "./RuntimeEvent.js";
import { evaluateScientificToolCall } from "./ToolPolicy.js";
import type { ToolRegistry } from "./ToolRegistry.js";

export interface RuntimeStageInput {
  agent: SciAgent;
  specialist: SpecialistAgent;
  plan: StagePlan;
  researchState: Record<string, unknown>;
  memory: SciMemory;
  onEvent?: (event: RuntimeEvent) => void;
}

export interface RuntimeStageResult {
  stageResult: StageResult;
  events: RuntimeEvent[];
  runtime: {
    model: string;
    tools: Record<string, unknown>;
    prompts: Array<Record<string, unknown>>;
  };
}

export class SciRuntime {
  constructor(
    private readonly model: ModelProvider,
    private readonly tools: ToolRegistry,
    private readonly literature?: LiteratureKnowledgeBase,
    private readonly capabilities = new ScientificCapabilityRegistry(),
    private readonly modelRegistry?: ModelRegistry,
  ) {}

  async runStage(input: RuntimeStageInput): Promise<RuntimeStageResult> {
    const events: RuntimeEvent[] = [];
    const candidateTools = this.resolveCandidateTools(input.plan.requiredCapabilities);
    const prompts: Array<Record<string, unknown>> = [];
    const publish = (event: RuntimeEvent) => {
      events.push(event);
      input.onEvent?.(event);
    };
    publish(
      this.event("stage_started", input.plan.stage, {
        agentId: input.agent.id,
        specialistId: input.specialist.id,
        requiredCapabilities: input.plan.requiredCapabilities,
        candidateTools,
      }),
    );
    const memoryContext = await input.memory.recall({
      query: input.plan.objective,
      scopes: ["instruction", "project", "group", "personal", "public", "agent", "session"],
      limit: 8,
    });
    const model = this.modelRegistry?.resolveProvider(input.agent.id, input.plan.stage) ?? this.model;
    publish(
      this.event("model_call", input.plan.stage, {
        specialistId: input.specialist.id,
        model: model.label ?? "model",
        objective: input.plan.objective,
        memoryContextCount: memoryContext.length,
      }),
    );
    const stageResult = await input.specialist.run({
      plan: input.plan,
      researchState: input.researchState,
      memoryContext,
      literature: this.literature,
      model,
      tools: this.tools,
      onProgress: (progress) => {
        publish(
          this.event("stage_progress", input.plan.stage, {
            specialistId: input.specialist.id,
            ...progress,
          }),
        );
      },
      onModelStatus: (status) => {
        publish(
          this.event("model_status", input.plan.stage, {
            specialistId: input.specialist.id,
            model: model.label ?? "model",
            ...status,
          }),
        );
      },
      onModelDelta: (delta) => {
        publish(
          this.event("model_delta", input.plan.stage, {
            specialistId: input.specialist.id,
            model: model.label ?? "model",
            delta,
          }),
        );
      },
      onModelPrompt: (prompt) => {
        const promptSummary = {
          specialistId: prompt.specialistId,
          system: prompt.system,
          user: prompt.user,
        };
        prompts.push(promptSummary);
        publish(
          this.event("model_prompt", input.plan.stage, {
            specialistId: prompt.specialistId,
            model: model.label ?? "model",
            prompt: promptSummary,
          }),
        );
      },
    });
    publish(
      this.event("stage_completed", input.plan.stage, {
        specialistId: input.specialist.id,
        summary: stageResult.summary,
        processTrace: stageResult.processTrace ?? [],
        decision: stageResult.decision,
        evidenceCount: stageResult.evidence.length,
        hypothesisCount: stageResult.hypotheses.length,
        artifactCount: stageResult.artifacts.length,
      }),
    );
    return {
      stageResult,
      events,
      runtime: {
        model: model.label ?? "model",
        tools: candidateTools,
        prompts,
      },
    };
  }

  private resolveCandidateTools(capabilityNames: string[]): Record<string, unknown> {
    const resolved: Record<string, unknown> = {};
    for (const capabilityName of capabilityNames) {
      const capability = this.capabilities.get(capabilityName);
      if (!capability) {
        resolved[capabilityName] = { missing: true, tools: [] };
        continue;
      }
      resolved[capabilityName] = {
        pack: capability.pack,
        executionMode: capability.executionMode,
        requiresApproval: capability.requiresApproval,
        tools: capability.candidateTools.map((toolName) => ({
          toolName,
          policy: evaluateScientificToolCall({
            toolName,
            destructive: !capability.readOnlyPreferred,
            enforceReview: capability.requiresApproval,
          }),
        })),
      };
    }
    return resolved;
  }

  private event(type: RuntimeEvent["type"], stage: string, payload: Record<string, unknown>): RuntimeEvent {
    return {
      id: makeId(`runtime-${type}`),
      type,
      timestamp: new Date().toISOString(),
      stage,
      payload,
    };
  }
}
