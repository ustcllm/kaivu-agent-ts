# Literature Agent Instructions

This project contains local agent adapters for the literature review and literature wiki system.

Agent-specific packages live under `agent-adapters/<agent>/`. Do not assume every agent uses Codex-style `SKILL.md` directories.

- `agent-adapters/codex/skills`: Codex-compatible skills using `SKILL.md` and `agents/openai.yaml`.
- `agent-adapters/claude-code`: reserved for Claude Code-compatible packaging.
- `agent-adapters/openclaw`: reserved for OpenClaw-compatible packaging.
- `agent-adapters/harness`: reserved for Harness-compatible packaging.

Install one agent package at a time. For Codex, install the skill directories under `agent-adapters/codex/skills` as a set so literature review, digest, ingest, batch, wiki search, wiki query, and lint behavior stay consistent.

## General Research Skills

- `problem-frame`: clarify broad or ambiguous requests before literature review, paper wiki work, hypothesis generation, experiment planning, or research-oriented implementation.
- `literature-review`: frame research questions, generate and validate paper search queries, search external literature sources, and return ranked candidate papers.

## Paper Literature Skills

Use `paper-wiki` first for routing and operation-boundary questions.

Use these skills before modifying or operating the paper ingest pipeline:

- `paper-wiki`: route digest, ingest, batch, query, lint, and save-like wiki operations.
- `literature-review`: find external paper candidates before digest or ingest.
- `paper-digest`: create or revise structured `PaperDigest` records from scientific papers.
- `paper-ingest`: plan and materialize one structured `PaperDigest` into literature wiki pages.
- `paper-ingest-batch`: orchestrate multi-paper digest, ingest, cross-reference, commit, and batch summary.
- `paper-wiki-search`: retrieve relevant literature wiki pages before query, ingest planning, or cross-reference.
- `paper-wiki-query`: answer questions using retrieved literature wiki pages with citations.
- `paper-wiki-lint`: health-check wiki graph, evidence, stale claims, and missing cross-references.

Use `paper-ingest-batch` as the orchestration pattern when multiple papers are processed together. Batch ingest owns deduplication, failures, cross-reference pass, commit, log/index/hot updates, and batch summary.

## Boundary

Keep per-paper source understanding in `paper-digest`.

Keep single-paper wiki planning in `paper-ingest`.

Keep multi-paper transaction control in the batch agent.
