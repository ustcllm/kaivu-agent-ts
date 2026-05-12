---
name: literature-search
description: Search external literature and paper candidates with the project's rag_arxiv_retrieve tool. Use when Codex needs to find papers, run literature search, search arXiv-like literature, retrieve candidate papers from a query or problem frame, rank a shortlist, or prepare selected papers for paper-digest, literature-review, or paper-ingest-batch. This is external literature search, not paper-wiki-search.
---

# Literature Search

Use this skill for external paper discovery. It is a read-only search skill; it does not digest papers and does not update the wiki.

Current project-backed search uses `rag_arxiv_retrieve` only.

## Examples

- User: "search papers about retrieval-augmented agent evaluation" -> use `literature-search`.
- User: "use rag_arxiv_retrieve to find candidate papers" -> use `literature-search`.
- User: "find existing wiki pages about this topic" -> use `paper-wiki-search`, not literature search.
- User: "run a full literature review and synthesize what to search" -> use `literature-review`, which may call `literature-search`.

## Workflow

1. Start from a validated query, problem frame, or explicit user query.
2. Read `references/rag-arxiv-retrieve.md`.
3. Run one broad `rag_arxiv_retrieve` query when the topic is exploratory.
4. Run one focused `rag_arxiv_retrieve` query when precision matters.
5. Deduplicate by arXiv id, URL, normalized title, and author/year.
6. Rank candidates by relevance to the problem frame, evidence fit, recency/foundational status, and metadata quality.
7. Return a shortlist with enough metadata for `paper-digest` or `paper-ingest-batch`.

## Boundaries

Do:

- preserve the tool name and query in `queriesRun`
- mark results as metadata or abstract-level evidence
- report failures from `rag_arxiv_retrieve`
- ask before falling back to web search unless the user explicitly requested web lookup

Do not:

- call `arxiv_search`, `crossref_search`, or `pubmed_search`
- write wiki pages
- claim full-paper understanding from search results alone
- search the local literature wiki
- generate a full literature review synthesis; use `literature-review` for that

## Output

Return:

- `searchObjective`
- `queriesRun`
- `sourcesConsulted`
- `candidatePapers`: title, authors, year or published date, categories, URL, relevance rationale, evidence level, and caveats
- `rankedShortlist`
- `coverageGaps`
- `nextSteps`
