import type { ModelProvider } from "./ModelProvider.js";

export type ReasoningEffort = "low" | "medium" | "high" | "xhigh";

export interface AgentModelConfig {
  model: string;
  provider: string;
  reasoningEffort: ReasoningEffort;
  allowWebSearch: boolean;
  parallelToolCalls: boolean;
  timeoutSeconds: number;
  baseUrl?: string;
}

export interface ModelRegistryEntry {
  config: AgentModelConfig;
  provider: ModelProvider;
}

export class ModelRegistry {
  private readonly overrides = new Map<string, AgentModelConfig>();
  private readonly providers = new Map<string, ModelProvider>();

  constructor(private readonly defaultConfig: AgentModelConfig = defaultAgentModelConfig()) {}

  registerProvider(providerName: string, provider: ModelProvider): void {
    this.providers.set(providerName, provider);
  }

  setOverride(agentOrStage: string, config: Partial<AgentModelConfig>): void {
    this.overrides.set(agentOrStage, { ...this.defaultConfig, ...config });
  }

  resolve(agentId: string, stage?: string): AgentModelConfig {
    return this.overrides.get(`${agentId}:${stage}`) ?? this.overrides.get(agentId) ?? this.defaultConfig;
  }

  resolveProvider(agentId: string, stage?: string): ModelProvider | undefined {
    const config = this.resolve(agentId, stage);
    return this.providers.get(config.provider);
  }

  escalate(config: AgentModelConfig): AgentModelConfig {
    const reasoningEffort: ReasoningEffort =
      config.reasoningEffort === "low" ? "medium" : config.reasoningEffort === "medium" ? "high" : "xhigh";
    const model = config.model.endsWith("-mini") ? config.model.slice(0, -5) : config.model;
    return {
      ...config,
      model,
      reasoningEffort,
      timeoutSeconds: Math.max(config.timeoutSeconds, 180),
    };
  }
}

export function defaultAgentModelConfig(): AgentModelConfig {
  return {
    model: "gpt-5",
    provider: "openai",
    reasoningEffort: "medium",
    allowWebSearch: false,
    parallelToolCalls: true,
    timeoutSeconds: 120,
  };
}
