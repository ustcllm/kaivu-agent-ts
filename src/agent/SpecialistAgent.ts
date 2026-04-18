import type { ContextPack } from "../context/ContextPack.js";
import type { MemoryRecord } from "../memory/MemoryRecord.js";
import type { LiteratureKnowledgeBase } from "../literature/LiteratureKnowledgeBase.js";
import type { ModelCompleteOptions, ModelProvider, ModelProviderStatusEvent } from "../runtime/ModelProvider.js";
import type { ToolRegistry } from "../runtime/ToolRegistry.js";
import type { ScientificStage } from "../shared/ScientificLifecycle.js";
import type { ResearchState } from "../shared/ResearchStateTypes.js";
import type { StagePlan, StageResult } from "../shared/StageContracts.js";

export interface SpecialistRunInput {
  plan: StagePlan;
  researchState: ResearchState;
  memoryContext: MemoryRecord[];
  contextPack?: ContextPack;
  renderedContext?: string;
  literature?: LiteratureKnowledgeBase;
  model: ModelProvider;
  tools: ToolRegistry;
  onModelPrompt?: (prompt: { specialistId: string; system: string; user: string }) => void;
  onModelStatus?: (status: ModelProviderStatusEvent) => void;
  onModelDelta?: (delta: string) => void;
  onProgress?: (progress: { label: string; detail?: string; data?: Record<string, unknown> }) => void;
}

export interface SpecialistAgent {
  id: string;
  stage: ScientificStage;
  description: string;
  run(input: SpecialistRunInput): Promise<StageResult>;
}

export interface ModelStepOptions {
  stepId?: string;
  system?: string;
  prompt: string;
  includeRenderedContext?: boolean;
  stream?: boolean;
  hostedWebSearch?: boolean;
  webSearchDomains?: string[];
  maxOutputTokens?: number;
}

export type ModelStepRunner = (options: ModelStepOptions) => Promise<string>;

export abstract class BaseSpecialistAgent implements SpecialistAgent {
  abstract id: string;
  abstract stage: ScientificStage;
  abstract description: string;
  abstract run(input: SpecialistRunInput): Promise<StageResult>;

  protected renderResultMarkdown(result: unknown): string {
    if (typeof result === "string") return result.trim();
    if (Array.isArray(result)) return result.map((item) => this.renderResultMarkdown(item)).filter(Boolean).join("\n\n");
    if (result && typeof result === "object") return JSON.stringify(result, null, 2);
    return String(result ?? "").trim();
  }

  protected async modelStep(
    input: SpecialistRunInput,
    options: ModelStepOptions,
  ): Promise<string> {
    const system = options.system ?? `You are ${this.id}, a stage specialist in a scientific research agent.`;
    const stageUserInputContext = renderStageUserInputContext(input.plan.inputs.stageUserInputs);
    const contextualPrompt = options.includeRenderedContext !== false && input.renderedContext
      ? [
          input.renderedContext,
          stageUserInputContext,
          "",
          "# Current Stage Task",
          options.prompt,
        ].filter(Boolean).join("\n")
      : [stageUserInputContext, options.prompt].filter(Boolean).join("\n\n");
    input.onModelPrompt?.({
      specialistId: options.stepId ?? this.id,
      system,
      user: contextualPrompt,
    });
    const completeOptions: ModelCompleteOptions = {
      onStatus: input.onModelStatus,
      onTextDelta: options.stream === false ? undefined : input.onModelDelta,
      hostedWebSearch: options.hostedWebSearch,
      webSearchDomains: options.webSearchDomains,
      maxOutputTokens: options.maxOutputTokens,
    };
    const completion = await input.model.complete(
      [
        {
          role: "system",
          content: system,
        },
        { role: "user", content: contextualPrompt },
      ],
      completeOptions,
    );
    return completion.text;
  }

}

function renderStageUserInputContext(value: unknown): string {
  if (!Array.isArray(value) || value.length === 0) return "";
  const messages = value
    .map((item, index) => {
      if (!item || typeof item !== "object") return "";
      const record = item as Record<string, unknown>;
      const message = typeof record.message === "string" ? record.message.trim() : "";
      if (!message) return "";
      const action = typeof record.action === "string" ? record.action : "stage_input";
      const sourceStage = typeof record.sourceStage === "string" ? record.sourceStage : "unknown";
      return `${index + 1}. [${action} from ${sourceStage}] ${message}`;
    })
    .filter(Boolean);
  if (messages.length === 0) return "";
  return [
    "# User Input For This Stage",
    "Use these user-provided notes, corrections, constraints, or source hints when producing this stage output.",
    ...messages,
  ].join("\n");
}
