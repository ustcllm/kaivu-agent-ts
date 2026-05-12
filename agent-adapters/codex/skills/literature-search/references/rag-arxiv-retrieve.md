# RAG arXiv Retrieve

Use this reference when running project-backed literature search.

## Current Tool

Use `rag_arxiv_retrieve` as the only project literature-search tool in this adapter.

The project may register other search scaffolds in `src/runtime/ResearchToolRegistry.ts`, but this skill should not use them yet.

## Inputs

`rag_arxiv_retrieve` accepts:

```json
{
  "query": "string",
  "size": 5,
  "offset": 0,
  "search_mode": "hybrid | bm25 | vector",
  "categories": ["cs.CL"],
  "authors": ["string"],
  "min_citation": 0,
  "date_from": "YYYY-MM-DD",
  "date_to": "YYYY-MM-DD"
}
```

Use `hybrid` by default.

Use `categories`, `authors`, and date filters only when the problem frame or user request justifies them.

## Output Handling

`rag_arxiv_retrieve` returns:

```json
{
  "query": "string",
  "results": [
    {
      "id": "string",
      "title": "string",
      "link": "string",
      "summary": "string",
      "authors": ["string"],
      "publishedAt": "string",
      "categories": ["string"]
    }
  ]
}
```

Treat results as metadata or abstract-level evidence. Do not claim full-paper understanding until `paper-digest` or another full-text reading step inspects the paper.

## Search Pattern

1. Run a broad query for recall when the topic is exploratory.
2. Run a focused query for precision when needed.
3. Deduplicate by arXiv id, URL, normalized title, and author/year.
4. Rank by relevance, evidence fit, recency/foundational status, and metadata quality.

## Failure Handling

- If `rag_arxiv_retrieve` fails, report the failure and ask whether to retry with a simpler query or use web search.
- Do not call `arxiv_search`, `crossref_search`, or `pubmed_search` from this skill until the adapter is deliberately updated.
- Preserve tool names and queries in `queriesRun` and `sourcesConsulted`.
