# Paper Wiki Query Schema

This skill is bound to `WikiQuery`.

## Request

`WikiQueryRequest` includes:

- `wikiRoot`
- `question`
- `disciplineScope`
- `mode`
- `limit`
- `expandLinks`
- `fileAnswer`: `boolean | auto`
- `pageKey`
- `title`

## Result

`WikiQueryResult` includes:

- `question`
- `answerTitle`
- `answerMarkdown`
- `citations`
- `shouldFile`
- `retrieval`
- optional `filedPage`

## Citation

Each `WikiQueryCitation` includes:

- `pageKey`
- `title`
- `path`
- `rationale`

## Model Output

The model-facing output includes:

- `answerTitle`
- `answerMarkdown`
- `citations`
- `shouldFile`
- `synthesisPage`

## Filed Page

When filing, create a `synthesis` page using the current wiki page `schemaVersion`.

Filed query pages should update:

- page markdown
- `index.md`
- `log.md`
- `hot.md`

Only file when the answer is good enough to preserve and either explicitly requested or `fileAnswer: auto` allows the model's `shouldFile` decision.

Good enough means:

- source-backed by retrieved wiki pages
- cited with relevant `[[page_key]]` links
- durable beyond the current chat
- not a narrow lookup
- not already covered by an existing page
- contains reusable synthesis, comparison, tension, gap, or framing
