import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { makeId } from "../shared/ids.js";
import type { ScientificTask } from "../shared/ScientificLifecycle.js";
import type { ArtifactRef } from "../shared/StageContracts.js";

export interface RuntimeManifestModelUse {
  agentId: string;
  model: string;
  provider?: string;
  stage?: string;
  inputTokens?: number;
  outputTokens?: number;
  costUsd?: number;
}

export interface RuntimeManifestToolUse {
  toolName: string;
  action: string;
  stage?: string;
  status: "planned" | "allowed" | "review_required" | "denied" | "completed" | "failed";
  riskLevel?: "low" | "medium" | "high";
}

export interface RuntimeManifest {
  id: string;
  task?: ScientificTask;
  createdAt: string;
  modelsUsed: RuntimeManifestModelUse[];
  toolsUsed: RuntimeManifestToolUse[];
  artifacts: ArtifactRef[];
  stateFiles: string[];
  environment: Record<string, unknown>;
  reproducibility: {
    nodeVersion: string;
    platform: string;
    command?: string;
    gitCommit?: string;
  };
}

export class RuntimeManifestBuilder {
  build(input: {
    task?: ScientificTask;
    modelsUsed?: RuntimeManifestModelUse[];
    toolsUsed?: RuntimeManifestToolUse[];
    artifacts?: ArtifactRef[];
    stateFiles?: string[];
    environment?: Record<string, unknown>;
    command?: string;
    gitCommit?: string;
  }): RuntimeManifest {
    return {
      id: makeId("runtime-manifest"),
      task: input.task,
      createdAt: new Date().toISOString(),
      modelsUsed: input.modelsUsed ?? [],
      toolsUsed: input.toolsUsed ?? [],
      artifacts: input.artifacts ?? [],
      stateFiles: input.stateFiles ?? [],
      environment: input.environment ?? {},
      reproducibility: {
        nodeVersion: process.version,
        platform: process.platform,
        command: input.command,
        gitCommit: input.gitCommit,
      },
    };
  }

  summarize(manifest: RuntimeManifest): Record<string, unknown> {
    return {
      id: manifest.id,
      taskId: manifest.task?.id ?? "",
      modelCount: manifest.modelsUsed.length,
      toolCount: manifest.toolsUsed.length,
      artifactCount: manifest.artifacts.length,
      totalCostUsd: round4(manifest.modelsUsed.reduce((sum, item) => sum + (item.costUsd ?? 0), 0)),
      stateFiles: manifest.stateFiles,
      reproducibility: manifest.reproducibility,
    };
  }
}

export class RuntimeManifestStore {
  constructor(private readonly root: string) {}

  async save(manifest: RuntimeManifest, filename = `${manifest.id}.json`): Promise<string> {
    const path = join(this.root, "manifests", filename);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, `${JSON.stringify(manifest, null, 2)}\n`, "utf-8");
    return path;
  }
}

function round4(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}
