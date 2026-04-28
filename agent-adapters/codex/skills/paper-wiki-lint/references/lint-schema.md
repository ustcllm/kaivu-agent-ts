# Paper Wiki Lint Schema

This skill is bound to `LiteratureLint`.

## Request

`LiteratureLintRequest` includes:

- optional `wikiRoot`
- optional `pages`

If pages are not supplied, load them from `wikiRoot`.

## Report

`LiteratureLintReport` includes:

- `wikiRoot`
- `generatedAt`
- `summary`
- `issueCount`
- `issues`
- `suggestedQuestions`
- `suggestedSources`

## Issue

`LiteratureLintIssue` includes:

- `kind`
- `severity`: `low | medium | high`
- `pageKeys`
- `rationale`
- `suggestedActions`

## Issue Kinds

Supported issue kinds:

- `orphan_page`
- `missing_referenced_page`
- `claim_without_evidence`
- `topic_without_claims`
- `paper_without_links`
- `duplicate_title`
- `stale_claim`
- `contradiction`
- `missing_cross_reference`
- `gap_fillable_by_search`
- `missing_page_candidate`

## Semantic Model Output

The semantic model should only emit:

- `stale_claim`
- `contradiction`
- `missing_cross_reference`
- `gap_fillable_by_search`
- `missing_page_candidate`

Structural lint owns orphan pages, dangling references, missing evidence, and duplicate titles.

Do not include `overview_missing`; overview has been removed.
