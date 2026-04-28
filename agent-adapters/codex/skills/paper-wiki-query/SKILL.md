---
name: paper-wiki-query
description: Answer questions using the persistent paper literature wiki. Use when Codex needs to query the paper wiki, answer based on the wiki, explain what the wiki knows, summarize a topic, compare papers or claims, retrieve wiki pages, synthesize an answer with page citations, decide whether an answer is worth filing, or revise WikiQuery behavior.
---

# Paper Wiki Query

Query answers a user question using retrieved wiki pages. It builds on `paper-wiki-search`.

This skill is schema-bound. Before changing query behavior, read `references/query-schema.md`.

## Examples

- User: "what does the wiki know about diffusion model evaluation?" -> use `paper-wiki-query`.
- User: "compare these two claims based on the wiki" -> use `paper-wiki-query`.
- User: "find pages mentioning MATH benchmark" -> use `paper-wiki-search`, not query.

## Workflow

1. Use `paper-wiki-search` to retrieve primary and expanded pages.
2. Load the retrieved page markdown.
3. Ask the model to synthesize an answer using only those pages.
4. Cite wiki pages with `[[page_key]]`.
5. Decide whether the answer is a good answer worth filing.
6. File only when the answer passes the good-answer bar and `fileAnswer` is true, or when `fileAnswer` is `auto` and model output says `shouldFile`.

## Query Depth

For query mode guidance, also read `paper-wiki/references/query-modes.md`.

## Filing Answers

Good answers can compound into the wiki, but only through the explicit filing path.

A good answer is durable, source-backed, and reusable. It should synthesize multiple relevant wiki pages, cite them clearly, and add a comparison, conclusion, tension, gap, or reusable framing that is not already captured by an existing page.

- If `fileAnswer` is false or absent, return the answer without writing a page.
- If `fileAnswer` is `auto`, file only when the model marks `shouldFile` true and the answer meets the good-answer bar.
- If `fileAnswer` is true, still file only good answers; otherwise return the answer and explain why it was not filed.
- Do not file narrow lookups, weakly supported answers, or answers with insufficient retrieved evidence.

## Boundary

Do:

- Synthesize across pages instead of listing summaries.
- Return answer markdown and citations.
- Build a candidate synthesis page object when useful.
- Keep the retrieval result inspectable so the caller can see which pages informed the answer.

Do not:

- Answer paper-specific questions from general model knowledge when retrieved pages are insufficient.
- Write every answer automatically.
- Create overview pages.
- Bypass retrieval.

## Context Discipline

- Quick questions should not force a deep read.
- Standard questions should use the retrieved primary pages and only the linked pages needed for context.
- Deep questions may read more broadly, but still need citations for non-obvious claims.
