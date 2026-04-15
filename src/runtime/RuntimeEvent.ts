export interface RuntimeEvent {
  id: string;
  type:
    | "model_call"
    | "model_delta"
    | "model_prompt"
    | "model_status"
    | "stage_progress"
    | "tool_call"
    | "stage_started"
    | "stage_completed"
    | "policy_check"
    | "runtime_error";
  timestamp: string;
  stage?: string;
  payload: Record<string, unknown>;
}
