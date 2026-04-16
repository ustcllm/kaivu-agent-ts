import { makeId } from "../shared/ids.js";
import type { TrajectoryEvent } from "./Trajectory.js";

export interface ResearchLedgerEvent {
  id: string;
  type:
    | "user_request"
    | "loop_decision"
    | "stage_output"
    | "tool_call"
    | "memory_diff"
    | "graph_diff"
    | "evaluation"
    | "approval"
    | "runtime_manifest"
    | "final_result";
  timestamp: string;
  actor: string;
  summary: string;
  payload: Record<string, unknown>;
  sourceEventId?: string;
}

export interface ResearchEventLedgerSnapshot {
  eventCount: number;
  eventsByType: Record<string, number>;
  events: ResearchLedgerEvent[];
}

export class ResearchEventLedger {
  private readonly events: ResearchLedgerEvent[] = [];

  record(input: Omit<ResearchLedgerEvent, "id" | "timestamp"> & { timestamp?: string }): ResearchLedgerEvent {
    const event: ResearchLedgerEvent = {
      id: makeId(`ledger-${input.type}`),
      timestamp: input.timestamp ?? new Date().toISOString(),
      type: input.type,
      actor: input.actor,
      summary: input.summary,
      payload: input.payload,
      sourceEventId: input.sourceEventId,
    };
    this.events.push(event);
    return event;
  }

  recordTrajectory(event: TrajectoryEvent): ResearchLedgerEvent {
    return this.record({
      type: mapTrajectoryType(event.type),
      timestamp: event.timestamp,
      actor: actorFromPayload(event.payload),
      summary: summaryFromTrajectory(event),
      payload: event.payload,
      sourceEventId: event.id,
    });
  }

  snapshot(): ResearchEventLedgerSnapshot {
    const eventsByType: Record<string, number> = {};
    for (const event of this.events) eventsByType[event.type] = (eventsByType[event.type] ?? 0) + 1;
    return {
      eventCount: this.events.length,
      eventsByType,
      events: this.events.map((event) => ({ ...event, payload: { ...event.payload } })),
    };
  }
}

export function buildLedgerFromTrajectory(trajectory: TrajectoryEvent[]): ResearchEventLedgerSnapshot {
  const ledger = new ResearchEventLedger();
  for (const event of trajectory) ledger.recordTrajectory(event);
  return ledger.snapshot();
}

function mapTrajectoryType(type: TrajectoryEvent["type"]): ResearchLedgerEvent["type"] {
  if (type === "memory_commit") return "memory_diff";
  if (type === "graph_update") return "graph_diff";
  if (type === "runtime_events") return "tool_call";
  if (type === "final_result") return "final_result";
  if (type === "stage_output") return "stage_output";
  return "loop_decision";
}

function actorFromPayload(payload: Record<string, unknown>): string {
  return String(payload.specialistId ?? payload.agentId ?? payload.stage ?? "science-loop");
}

function summaryFromTrajectory(event: TrajectoryEvent): string {
  if (event.type === "loop_decision") return `Selected stage ${String(event.payload.stage ?? "")}`;
  if (event.type === "stage_output") return `Stage output for ${String(event.payload.stage ?? "")}`;
  if (event.type === "memory_commit") return `Committed ${String(event.payload.committedCount ?? 0)} memory records`;
  if (event.type === "graph_update") return `Applied ${String(event.payload.factCount ?? 0)} graph facts`;
  if (event.type === "final_result") return `Final result: ${String(event.payload.stopReason ?? "complete")}`;
  return event.type;
}
