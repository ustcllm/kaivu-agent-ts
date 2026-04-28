---
name: literature-review
description: Plan and run literature review discovery work. Use when Codex needs to generate or validate paper search queries, search external literature sources, find candidate papers, build a ranked paper shortlist, or prepare selected papers for paper-digest, paper-ingest-batch, or paper wiki work. Use problem-frame first when the research objective is broad, ambiguous, or underspecified.
---

# Literature Review

Use this skill for the discovery layer before papers become digests or wiki pages.

This skill owns external paper search strategy, query generation, query validation, external paper discovery, and shortlist handoff. It does not own problem framing, persistent wiki retrieval, wiki query answering, digest extraction, or wiki ingest.

## Examples

- User: "find papers about tool-augmented LLM evaluation" -> use `literature-review`.
- User: "generate and validate search queries for this research question" -> use `literature-review`.
- User: "search recent papers and give me a shortlist to ingest" -> use `literature-review`.
- User: "what does my existing wiki say about this?" -> use `paper-wiki-query`, not literature review.
- User: "ingest these selected papers into the wiki" -> use `paper-ingest-batch`.

## Workflow

1. Use `problem-frame` first when the request is broad, ambiguous, or underspecified.
2. Generate search query families from the frame, question, or seed papers. Read `references/search-query-generation.md`.
3. Validate high-stakes, broad, or expensive query plans. Read `references/search-query-validation.md`.
4. Search external literature sources and rank candidate papers. Read `references/paper-search.md`.
5. Return a shortlist with metadata and a clear handoff to `paper-digest` or `paper-ingest-batch`.

Skip steps only when the user has already supplied an equivalent artifact, such as a precise query or a curated paper list.

## Boundaries

Do:

- use `problem-frame` for research-objective clarification
- distinguish external paper discovery from local wiki search
- preserve uncertainty about metadata, snippets, and paper relevance
- use live lookup when current papers, precise metadata, URLs, DOI status, or recent work matter
- recommend digest or batch ingest only after candidate papers are selected

Do not:

- write wiki pages
- treat search snippets as full-paper evidence
- claim to have read papers unless full text was actually inspected
- answer from the persistent wiki; use `paper-wiki-query` for that
- search the local wiki; use `paper-wiki-search` for that

## Handoff

When the user selects papers, hand off to:

- `paper-digest` for one paper
- `paper-ingest-batch` for multiple papers
- `paper-wiki-query` when the question should be answered from existing wiki pages
