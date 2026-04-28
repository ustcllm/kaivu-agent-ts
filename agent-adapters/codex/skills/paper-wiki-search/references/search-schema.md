# Paper Wiki Search Schema

This skill is bound to `WikiRetrieve`.

## Request

`WikiRetrieveRequest` includes:

- `wikiRoot`: root directory of the literature wiki.
- `query`: search text.
- `disciplineScope`: non-empty list of disciplines.
- `mode`: `auto | landscape | claim_first | topic_first | paper_first`.
- `limit`: optional page limit.
- `expandLinks`: optional linked-page expansion toggle.

## Result

`WikiRetrieveResult` includes:

- `query`
- `mode`
- `disciplineScope`
- `consultedFiles`
- `primaryPages`
- `expandedPages`
- `readOrder`
- `rationale`

## Retrieve Page

Each `WikiRetrievePage` includes:

- `pageKey`
- `title`
- `kind`
- `discipline`
- `summary`
- `path`
- `score`
- `snippet`
- `reasons`

## Special Context

Search should consult these files when present:

- `<discipline>/hot.md`
- `hot.md`
- `index.md`
- `<discipline>/_index.md`

These files bias retrieval but are not themselves `LiteratureWikiPage` records.

## Supported Page Kinds

Search only works over current wiki page kinds:

- `paper`
- `research_question`
- `method`
- `benchmark`
- `finding`
- `formal_result`
- `claim`
- `topic`
- `synthesis`

Do not add `overview`.
