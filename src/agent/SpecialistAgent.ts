import type { ContextPack } from "../context/ContextPack.js";
import type { MemoryRecord } from "../memory/MemoryRecord.js";
import type { LiteratureKnowledgeBase } from "../literature/LiteratureKnowledgeBase.js";
import type { ModelProvider, ModelProviderStatusEvent } from "../runtime/ModelProvider.js";
import type { ToolRegistry } from "../runtime/ToolRegistry.js";
import type { ScientificStage, StagePlan, StageResult } from "../shared/types.js";

export interface SpecialistRunInput {
  plan: StagePlan;
  researchState: Record<string, unknown>;
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

export abstract class BaseSpecialistAgent implements SpecialistAgent {
  abstract id: string;
  abstract stage: ScientificStage;
  abstract description: string;
  abstract run(input: SpecialistRunInput): Promise<StageResult>;

  protected async modelSummary(input: SpecialistRunInput, prompt: string, options: { includeRenderedContext?: boolean } = {}): Promise<string> {
    const system = `You are ${this.id}, a stage specialist in a scientific research agent.`;
    const contextualPrompt = options.includeRenderedContext !== false && input.renderedContext
      ? [
          input.renderedContext,
          "",
          "# Current Stage Task",
          prompt,
        ].join("\n")
      : prompt;
    input.onModelPrompt?.({
      specialistId: this.id,
      system,
      user: contextualPrompt,
    });
    const completion = await input.model.complete(
      [
        {
          role: "system",
          content: system,
        },
        { role: "user", content: contextualPrompt },
      ],
      {
        onStatus: input.onModelStatus,
        onTextDelta: input.onModelDelta,
      },
    );
    return completion.text;
  }
}
