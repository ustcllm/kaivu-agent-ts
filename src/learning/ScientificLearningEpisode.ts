import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { makeId } from "../shared/ids.js";
import type { ScientificTask } from "../shared/ScientificLifecycle.js";
import type { ArtifactRef } from "../shared/StageContracts.js";
import type { TrajectoryEvent } from "../loop/Trajectory.js";

export const SCIENTIFIC_LEARNING_SCHEMA_VERSION = "1.0";

export interface ScientificLearningActor {
  id: string;
  type: "agent" | "model" | "tool" | "human" | "runtime";
  role: string;
  model?: string;
  metadata?: Record<string, unknown>;
}

export interface ScientificLearningStep {
  id: string;
  type: string;
  actorId?: string;
  timestamp: string;
  observation: Record<string, unknown>;
  action: Record<string, unknown>;
  outcome: Record<string, unknown>;
  rewardSignals: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

export interface ScientificLearningEpisode {
  id: string;
  sourceSessionId: string;
  topic: string;
  schemaVersion: typeof SCIENTIFIC_LEARNING_SCHEMA_VERSION;
  mode: "observation_only" | "replay" | "training_export";
  createdAt: string;
  task?: ScientificTask;
  actors: ScientificLearningActor[];
  steps: ScientificLearningStep[];
  toolCalls: Record<string, unknown>[];
  stateChanges: Record<string, unknown>[];
  memoryDiffs: Record<string, unknown>[];
  graphDiffs: Record<string, unknown>[];
  evaluationScores: Record<string, unknown>;
  humanFeedback: Record<string, unknown>[];
  artifacts: ArtifactRef[];
  replay: Record<string, unknown>;
  trainingInterfaces: Record<string, unknown>;
  governance: Record<string, unknown>;
}

export interface BuildLearningEpisodeInput {
  sourceSessionId: string;
  topic: string;
  task?: ScientificTask;
  trajectory: TrajectoryEvent[];
  model?: string;
  artifacts?: ArtifactRef[];
  evaluationScores?: Record<string, unknown>;
  humanFeedback?: Record<string, unknown>[];
}

export class ScientificLearningEpisodeBuilder {
  build(input: BuildLearningEpisodeInput): ScientificLearningEpisode {
    const actors = deriveActors(input);
    const steps = input.trajectory.map((event) => eventToStep(event));
    return {
      id: makeId("learning-episode"),
      sourceSessionId: input.sourceSessionId,
      topic: input.topic,
      schemaVersion: SCIENTIFIC_LEARNING_SCHEMA_VERSION,
      mode: "observation_only",
      createdAt: new Date().toISOString(),
      task: input.task,
      actors,
      steps,
      toolCalls: extractPayloads(input.trajectory, "runtime_events").flatMap(extractToolCalls),
      stateChanges: extractPayloads(input.trajectory, "state_update"),
      memoryDiffs: extractPayloads(input.trajectory, "memory_commit"),
      graphDiffs: extractPayloads(input.trajectory, "graph_update"),
      evaluationScores: input.evaluationScores ?? {},
      humanFeedback: input.humanFeedback ?? [],
      artifacts: input.artifacts ?? [],
      replay: buildReplayCase(input),
      trainingInterfaces: {
        policyOptimization: "steps can be converted to observation/action/outcome rows",
        rewardModeling: "humanFeedback and evaluationScores can be joined by episode id",
        preferenceLearning: "alternative stage outputs can be attached later",
      },
      governance: {
        observationOnly: true,
        doesNotChangeScientificDecisions: true,
        allowedUses: ["observability", "replay", "benchmark", "future training dataset"],
      },
    };
  }
}

export class ScientificLearningEpisodeStore {
  constructor(private readonly root: string) {}

  async append(episode: ScientificLearningEpisode, filename = "scientific_learning_episodes.jsonl"): Promise<string> {
    const path = join(this.root, filename);
    const existing = await readOptional(path);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, `${existing}${JSON.stringify(episode)}\n`, "utf-8");
    return path;
  }

  async save(episode: ScientificLearningEpisode): Promise<string> {
    const path = join(this.root, "episodes", `${safeName(episode.id)}.json`);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, `${JSON.stringify(episode, null, 2)}\n`, "utf-8");
    return path;
  }

  async load(filename = "scientific_learning_episodes.jsonl", limit = 100): Promise<ScientificLearningEpisode[]> {
    const path = join(this.root, filename);
    const raw = await readOptional(path);
    return raw
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => safeJson(line))
      .filter((item): item is ScientificLearningEpisode => isEpisode(item))
      .slice(-Math.max(1, Math.min(limit, 1_000)));
  }

  async exportTrainingDataset(target: "policy" | "reward" | "preference" = "policy", limit = 1_000): Promise<string> {
    const episodes = await this.load("scientific_learning_episodes.jsonl", limit);
    const rows = buildTrainingRows(episodes, target);
    const path = join(this.root, "exports", `${target}_training_dataset.jsonl`);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, rows.map((row) => JSON.stringify(row)).join("\n") + (rows.length ? "\n" : ""), "utf-8");
    return path;
  }

  async buildBenchmarkDataset(limit = 1_000): Promise<string> {
    const episodes = await this.load("scientific_learning_episodes.jsonl", limit);
    const path = join(this.root, "benchmarks", "learning_benchmark_dataset.jsonl");
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, episodes.map((episode) => JSON.stringify(buildBenchmarkSeed(episode))).join("\n") + (episodes.length ? "\n" : ""), "utf-8");
    return path;
  }
}

export function validateScientificLearningEpisode(value: unknown): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  if (!isRecord(value)) return { valid: false, errors: ["episode is not an object"] };
  if (value.schemaVersion !== SCIENTIFIC_LEARNING_SCHEMA_VERSION) errors.push("schema version mismatch");
  if (!Array.isArray(value.steps)) errors.push("steps must be an array");
  if (!Array.isArray(value.actors)) errors.push("actors must be an array");
  if (!String(value.id ?? "").trim()) errors.push("id is required");
  return { valid: errors.length === 0, errors };
}

function deriveActors(input: BuildLearningEpisodeInput): ScientificLearningActor[] {
  const actors: ScientificLearningActor[] = [
    { id: "science-loop", type: "runtime", role: "loop" },
  ];
  if (input.model) actors.push({ id: `model:${input.model}`, type: "model", role: "model_provider", model: input.model });
  const specialistIds = new Set<string>();
  for (const event of input.trajectory) {
    const payload = event.payload;
    const specialistId = isRecord(payload) && typeof payload.specialistId === "string" ? payload.specialistId : "";
    if (specialistId) specialistIds.add(specialistId);
  }
  for (const specialistId of specialistIds) actors.push({ id: specialistId, type: "agent", role: "specialist" });
  return actors;
}

function eventToStep(event: TrajectoryEvent): ScientificLearningStep {
  return {
    id: makeId(`learning-step-${event.type}`),
    type: event.type,
    timestamp: event.timestamp,
    observation: observationFromEvent(event),
    action: actionFromEvent(event),
    outcome: outcomeFromEvent(event),
    rewardSignals: rewardSignalsFromEvent(event),
  };
}

function observationFromEvent(event: TrajectoryEvent): Record<string, unknown> {
  return { eventType: event.type, payload: event.payload };
}

function actionFromEvent(event: TrajectoryEvent): Record<string, unknown> {
  if (event.type === "loop_decision") return { kind: "select_stage", stage: event.payload.stage };
  if (event.type === "stage_plan") return { kind: "plan_stage", specialistId: event.payload.specialistId };
  if (event.type === "runtime_events") return { kind: "runtime_progress" };
  return { kind: event.type };
}

function outcomeFromEvent(event: TrajectoryEvent): Record<string, unknown> {
  if (event.type === "stage_output") return { kind: "stage_output", output: event.payload.output };
  if (event.type === "final_result") return { kind: "final_result", done: event.payload.done, stopReason: event.payload.stopReason };
  return { kind: "recorded" };
}

function rewardSignalsFromEvent(event: TrajectoryEvent): Record<string, unknown> {
  return {
    progress: ["stage_output", "state_update", "final_result"].includes(event.type) ? 1 : 0,
    observability: event.type === "runtime_events" ? 1 : 0,
    durableStateChange: ["memory_commit", "graph_update"].includes(event.type) ? 1 : 0,
  };
}

function extractPayloads(trajectory: TrajectoryEvent[], type: TrajectoryEvent["type"]): Record<string, unknown>[] {
  return trajectory.filter((event) => event.type === type).map((event) => event.payload);
}

function extractToolCalls(payload: Record<string, unknown>): Record<string, unknown>[] {
  const events = isRecord(payload) && Array.isArray(payload.events) ? payload.events : [];
  return events.filter(isRecord).filter((event) => String(event.type ?? "").includes("tool"));
}

function buildReplayCase(input: BuildLearningEpisodeInput): Record<string, unknown> {
  return {
    task: input.task,
    trajectoryEventCount: input.trajectory.length,
    replayMode: "deterministic_event_replay",
    expectedFinalEvent: input.trajectory.at(-1)?.type ?? "",
  };
}

function buildTrainingRows(episodes: ScientificLearningEpisode[], target: "policy" | "reward" | "preference"): Record<string, unknown>[] {
  const rows: Record<string, unknown>[] = [];
  for (const episode of episodes) {
    if (target === "reward") {
      rows.push({ episodeId: episode.id, topic: episode.topic, evaluationScores: episode.evaluationScores, humanFeedback: episode.humanFeedback });
      continue;
    }
    if (target === "preference") {
      rows.push(...episode.humanFeedback.map((feedback) => ({ episodeId: episode.id, topic: episode.topic, feedback })));
      continue;
    }
    rows.push(...episode.steps.map((step) => ({
      episodeId: episode.id,
      topic: episode.topic,
      observation: step.observation,
      action: step.action,
      outcome: step.outcome,
      rewardSignals: step.rewardSignals,
    })));
  }
  return rows;
}

function buildBenchmarkSeed(episode: ScientificLearningEpisode): Record<string, unknown> {
  return {
    benchmarkId: `benchmark-seed:${episode.id}`,
    topic: episode.topic,
    task: episode.task,
    expectedStepTypes: episode.steps.map((step) => step.type),
    replay: episode.replay,
    evaluationScores: episode.evaluationScores,
  };
}

async function readOptional(path: string): Promise<string> {
  try {
    return await readFile(path, "utf-8");
  } catch {
    return "";
  }
}

function safeJson(line: string): unknown {
  try {
    return JSON.parse(line);
  } catch {
    return undefined;
  }
}

function isEpisode(value: unknown): value is ScientificLearningEpisode {
  return validateScientificLearningEpisode(value).valid;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function safeName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9_.-]+/g, "-").replace(/^-|-$/g, "") || "episode";
}
