import type { LiteratureKnowledgeBase } from "../literature/LiteratureKnowledgeBase.js";
import { createArxivSearchTool } from "./ArxivSearchTool.js";
import { ToolRegistry, type Tool } from "./ToolRegistry.js";

export function createResearchToolRegistry(literature: LiteratureKnowledgeBase): ToolRegistry {
  const registry = new ToolRegistry();
  const tools: Tool[] = [
    createArxivSearchTool(),
    {
      name: "query_literature_wiki",
      capability: "literature_wiki_query",
      readOnly: true,
      run: async (args) => {
        const query = String(args.query ?? "");
        const limit = typeof args.limit === "number" ? args.limit : 3;
        const pages = literature.search(query, limit);
        return {
          query,
          results: pages.map((page) => ({
            id: page.id,
            title: page.title,
            summary: page.summary,
            tags: page.tags,
          })),
          note: pages.length > 0 ? "Matched existing literature wiki pages." : "No matching literature wiki pages yet.",
        };
      },
    },
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
