import type { RuntimeEvent } from "../runtime/RuntimeEvent.js";
import { makeId } from "../shared/ids.js";
import type { ScientificStage, StageResult } from "../shared/types.js";

export interface TrajectoryEvent {
  id: string;
  type:
    | "loop_decision"
    | "stage_plan"
    | "stage_output"
    | "runtime_events"
    | "state_update"
    | "memory_commit"
    | "graph_update"
    | "final_result";
  timestamp: string;
  payload: Record<string, unknown>;
}

export class ResearchTrajectory {
  readonly id = makeId("trajectory");
  private readonly events: TrajectoryEvent[] = [];

  recordLoopDecision(stage: ScientificStage, reason: string): TrajectoryEvent {
    return this.record("loop_decision", { stage, reason });
  }

  recordRuntimeEvents(events: RuntimeEvent[]): TrajectoryEvent {
    return this.record("runtime_events", { events });
  }

  recordStateUpdate(result: StageResult): TrajectoryEvent {
    return this.record("state_update", {
      stage: result.stage,
      decision: result.decision,
      evidenceCount: result.evidence.length,
      hypothesisCount: result.hypotheses.length,
    });
  }

  record(type: TrajectoryEvent["type"], payload: Record<string, unknown>): TrajectoryEvent {
    const event = {
      id: makeId(`trajectory-${type}`),
      type,
      timestamp: new Date().toISOString(),
      payload,
    };
    this.events.push(event);
    return event;
  }

  snapshot(): TrajectoryEvent[] {
    return [...this.events];
  }
}
