export type McpTransportType = "stdio";

export interface McpServerConfig {
  name: string;
  transport: McpTransportType;
  command: string[];
  cwd?: string;
  env?: Record<string, string>;
  timeoutSeconds?: number;
  readOnlyTools?: string[];
  destructiveTools?: string[];
}

export interface McpToolSpec {
  serverName: string;
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface McpResourceSpec {
  serverName: string;
  uri: string;
  name: string;
  description: string;
  mimeType?: string;
}

export interface McpPromptSpec {
  serverName: string;
  name: string;
  description: string;
  arguments?: Record<string, unknown>[];
}

export interface McpToolCallResult {
  serverName: string;
  toolName: string;
  content: unknown;
  isError: boolean;
}

export class McpRegistry {
  private readonly servers = new Map<string, McpServerConfig>();
  private readonly tools = new Map<string, McpToolSpec>();

  registerServer(config: McpServerConfig): void {
    this.servers.set(config.name, config);
  }

  registerTool(tool: McpToolSpec): void {
    this.tools.set(`${tool.serverName}:${tool.name}`, tool);
  }

  listServers(): McpServerConfig[] {
    return [...this.servers.values()];
  }

  listTools(): McpToolSpec[] {
    return [...this.tools.values()];
  }

  tool(name: string): McpToolSpec | undefined {
    return [...this.tools.values()].find((tool) => tool.name === name || `${tool.serverName}:${tool.name}` === name);
  }
}
