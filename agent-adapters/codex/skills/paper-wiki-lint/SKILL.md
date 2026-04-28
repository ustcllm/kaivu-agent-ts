---
name: paper-wiki-lint
description: Health-check the persistent paper literature wiki. Use when Codex needs to lint the wiki, audit the paper wiki, clean up wiki health, find orphan pages, find dangling wikilinks, find stale claims, find missing evidence, find missing cross-references, find duplicate titles, find missing page candidates, or revise LiteratureLint behavior.
---

# Paper Wiki Lint

Lint keeps the literature wiki healthy. It reports structural and semantic issues; it does not automatically resolve scientific contradictions.

This skill is schema-bound. Before changing lint behavior, read `references/lint-schema.md`.

## Examples

- User: "lint the paper wiki" -> use `paper-wiki-lint`.
- User: "find orphan pages and dangling links" -> use `paper-wiki-lint`.
- User: "fix all contradictions automatically" -> use `paper-wiki-lint` to report first; do not auto-resolve.

## Workflow

1. Load pages from `wikiRoot`, or use supplied lint pages.
2. Run structural lint.
3. Check special files when a wiki root is present.
4. Run semantic lint when a model step is available.
5. Dedupe issues.
6. Return a report with suggested questions and sources.

## Boundary

Do:

- Report orphan pages, dangling links, weak evidence, duplicate titles, stale claims, contradictions, missing cross-references, and missing page candidates.
- Suggest questions and sources for follow-up.
- Keep findings conservative and actionable.

Do not:

- Reintroduce overview checks.
- Auto-resolve contradictions.
- Delete orphan pages without review.
- Create pages as part of lint.

## Report First

Always produce a report before fixing. Safe mechanical fixes may be suggested, but semantic fixes require review.

Safe to suggest:

- add missing wikilinks
- update stale index entries
- create candidate page stubs when evidence is strong

Needs review:

- deleting orphan pages
- merging duplicate pages
- resolving contradictions
- changing claim status based on conflicting evidence
