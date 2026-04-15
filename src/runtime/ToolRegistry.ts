export interface ToolCallInput {
  name: string;
  arguments: Record<string, unknown>;
}

export interface ToolCallResult {
  name: string;
  status: "completed" | "failed" | "skipped";
  output?: unknown;
  error?: string;
}

export interface Tool {
  name: string;
  capability: string;
  readOnly: boolean;
  run(args: Record<string, unknown>): Promise<unknown>;
}

export class ToolRegistry {
  private readonly tools = new Map<string, Tool>();

  register(tool: Tool): void {
    this.tools.set(tool.name, tool);
  }

  listByCapability(capability: string): Tool[] {
    return [...this.tools.values()].filter((tool) => tool.capability === capability);
  }

  async call(input: ToolCallInput): Promise<ToolCallResult> {
    const tool = this.tools.get(input.name);
    if (!tool) {
      return { name: input.name, status: "skipped", error: "tool_not_registered" };
    }
    try {
      const output = await tool.run(input.arguments);
      return { name: input.name, status: "completed", output };
    } catch (error) {
      return {
        name: input.name,
        status: "failed",
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
}
