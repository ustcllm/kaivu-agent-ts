import { createArxivSearchTool } from "./tools/ArxivSearchTool.js";
import { createPaperDownloadTool } from "./tools/PaperDownloadTool.js";
import { createRagArxivRetrieveTool } from "./tools/RagArxivRetrieveTool.js";
import { ToolRegistry, type Tool } from "./ToolRegistry.js";

export function createResearchToolRegistry(): ToolRegistry {
  const registry = new ToolRegistry();
  const tools: Tool[] = [
    createArxivSearchTool(),
    createRagArxivRetrieveTool(),
    createPaperDownloadTool(),
    externalSearchPlaceholder("crossref_search"),
    externalSearchPlaceholder("pubmed_search"),
  ];
  for (const tool of tools) registry.register(tool);
  return registry;
}

function externalSearchPlaceholder(name: string): Tool {
  return {
    name,
    capability: "literature_search",
    readOnly: true,
    run: async (args) => ({
      query: String(args.query ?? ""),
      available: false,
      note: `${name} is registered as a read-only scaffold, but no live retrieval backend is connected yet.`,
    }),
  };
}
