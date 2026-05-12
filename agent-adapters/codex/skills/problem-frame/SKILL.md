---
name: problem-frame
description: Frame or revise literature-review questions before review work. Use for broad or ambiguous review requests, method-improvement questions that need literature grounding, and follow-up corrections to an existing frame.
---

# Problem Frame

Use this skill when a literature-review request is under-specified, ambiguous, or too broad for reliable downstream literature review. Also use it when the user asks how to improve, extend, compare, evaluate, replace, debug, or explain limitations of a method, system, benchmark, dataset, or research direction, and the useful next step is to frame what literature should be reviewed before proposing answers.

## Non-Negotiables

- Only frame literature-review work.
- Do not answer the research question or propose improvements.
- Do not generate search queries, paper shortlists, paper rankings, or inclusion/exclusion decisions.
- Always choose either `standalone` or `pre_review` mode before writing the frame.
- In `standalone` mode, show the frame and stop unless the user asks to proceed.
- In `pre_review` mode, show the brief frame summary before continuing to `literature-review`.
- If the user corrects or challenges a visible frame, revise the frame with this skill instead of moving on.

Do not use this skill when the user only wants:

- a direct factual answer
- pure editing or translation
- straightforward implementation with clear requirements

## Examples

- User: "Find papers on whether tool use improves LLM reasoning" -> use `pre_review` mode to clarify scope, variables, and review success criteria.
- User: "Review work on chain-of-thought faithfulness" -> use `pre_review` mode to clarify the review objective, evidence scope, and success criteria.
- User: "How can we improve retrieval-augmented generation for multi-hop QA?" -> use `standalone` mode to clarify the method, target failure modes, comparison baselines, and evidence needed before proposing changes.

## Goal

Turn the user request into a minimal, decision-useful literature-review frame that determines the review objective, scope, blocking ambiguities, and key context that later literature review must preserve.

## Inputs

Use the user's current request and any relevant conversation or project context already available. Do not ask the user to provide separate input fields.

Users may mix goals, constraints, background notes, paper links, and preferences in one message. Extract the literature-review intent from that message.

## Interaction Mode

Use this skill in one of two modes:

- `standalone`: the user wants to inspect, refine, validate, or discuss the problem frame itself.
- `pre_review`: the frame is only preparation for a requested literature review.

Use `standalone` mode when the user says things like:

- "frame this problem first"
- "do not search papers yet; let's inspect the problem frame first"
- "how should this literature review be defined?"
- "is this frame reasonable?"
- "help me refine the scope / variables / success criteria"
- "how can we improve / evaluate / compare <method, system, benchmark, dataset, or research direction>?"

Default to `pre_review` when the user asks to find, search, review, survey, compare, or shortlist papers. Default to `standalone` when the user asks to define a review question, inspect the frame, refine the review scope, or asks how to improve, compare, evaluate, replace, debug, or explain limitations of a method/system without requesting immediate implementation.

In `standalone` mode:

- return the frame visibly
- do not continue to literature review
- treat follow-up feedback as revisions to the frame
- help the user improve objective, scope, variables, constraints, ambiguities, and success criteria

## Frame Revision Loop

If the user responds to a visible frame with corrections, clarifications, objections, or new constraints, use this skill again to revise the existing frame.

Treat follow-up messages such as these as frame revision requests:

- "this frame is not quite right"
- "focus more on <aspect>"
- "exclude <topic>"
- "the real question is..."
- "make the scope narrower/broader"
- "that ambiguity is not important"
- "add this benchmark/dataset/method as context"

When revising:

- preserve useful parts of the previous frame
- apply the user's new feedback directly
- update `objective`, `scope`, `key_variables`, `constraints`, `ambiguities`, `assumptions`, `non_goals`, and `success_criteria` as needed
- keep the interaction in `standalone` mode unless the user explicitly asks to proceed to literature review

In `pre_review` mode:

- produce the frame as planning context
- show a brief frame summary before continuing
- if `needs_clarification` is false, pass it to `literature-review`
- if `needs_clarification` is true, ask the user before literature review

## Execution Workflow

1. Check whether the request needs framing. If it is a direct factual answer, pure editing, translation, or a clear implementation request, do not use this skill.
2. Extract the user's stated goal, important context, requested output, and any explicit constraints.
3. Classify `discipline`.
4. Write one concrete `objective` and one bounded `scope`.
5. Extract `key_variables` and `constraints`.
6. Triage ambiguity before finalizing the frame: infer the most likely referent of core phrases, decide whether unresolved ambiguity would change the review direction, and either record a conservative assumption or ask a blocking clarification question.
7. Identify remaining ambiguous terms, missing choices, and assumptions needed to proceed.
8. If clarification is blocking, set `needs_clarification: true` and ask 1-3 questions.
9. If clarification is not blocking, keep questions empty and record any non-blocking assumptions.
10. Write task-specific `success_criteria`.
11. Return the canonical JSON object. In `standalone` mode, render a compact markdown summary from that JSON. In `pre_review` mode, show only a brief frame summary before continuing.

## Output Contract

The JSON object is the canonical frame record.

Every valid use of this skill must produce one of these two output patterns.

In `standalone` mode, output:

1. A compact markdown summary for humans
2. The JSON object last

In `pre_review` mode, output:

1. A concise frame brief for the user
2. The full JSON frame as context for `literature-review`

Do not show the full JSON in `pre_review` mode unless the user asks.

Use this pre-review brief template:

```md
Framing this review as:
- Objective: <one sentence>
- Scope: <one sentence>
- Key variables: <comma-separated short list>
- Constraints: <only important constraints, or None>
```

Use this standalone markdown template:

```md
## Frame
Discipline: <discipline>
Objective: <one sentence>
Scope: <one sentence>
## Key Variables
- <variable, mechanism, system, observable, method, dataset, metric, stakeholder, or code boundary>

## Constraints
- <constraint, feasibility limit, evidence requirement, or implementation boundary>

## Success Criteria
- <success criterion>

## Ambiguities
- <ambiguous term, missing choice, or uncertainty marker>

## Assumptions
- <non-blocking assumption used to proceed>

## Clarification
Needs clarification: <true | false>
- <question, only when clarification is needed>
```

Then output the JSON object last.

JSON rules:

- Include every required field in the JSON shape.
- Use `[]` for empty arrays.
- Keep any markdown summary information-equivalent to the JSON fields.
- In markdown, write `- None` for empty list sections.
- In the markdown Clarification section, write `- None` unless `needs_clarification` is true.
- Use `needs_clarification: true` only when clarification blocks useful progress.
- Keep `clarifying_questions` empty unless `needs_clarification` is true.

Use this required JSON shape:

```json
{
  "discipline": "artificial_intelligence | mathematics | chemistry | chemical_engineering | physics | general_science | unknown",
  "objective": "string",
  "scope": "string",
  "key_variables": ["string"],
  "constraints": ["string"],
  "success_criteria": ["string"],
  "ambiguities": ["string"],
  "needs_clarification": false,
  "clarifying_questions": ["string"]
}
```

Optional fields may be added to the same JSON object:

```json
{
  "assumptions": ["string"],
  "non_goals": ["string"]
}
```

Only include optional fields when they add useful constraints for literature review. Do not fill optional fields just to make the frame look complete.

## Framing Principles

- Preserve the user's intent while narrowing broad requests conservatively.
- Separate blocking ambiguities from non-blocking assumptions.
- Use `non_goals` only when the user states exclusions or when a nearby task would otherwise cause likely scope creep.
- Keep the output concise, operational, and handoff-ready.

## Frame Content Guidance

- `objective` should state the literature-review question or purpose, not the likely answer.
- `scope` should bound the review by method, phenomenon, task, domain, benchmark, population, mechanism, time range, or evidence type when those boundaries are available.
- `key_variables` should capture concepts that matter for the review, such as methods, baselines, target tasks, datasets, metrics, outcomes, mechanisms, failure modes, or comparison axes.
- `constraints` should capture user-specified boundaries and evidence requirements, not search queries.
- `success_criteria` should describe what a good review must cover or distinguish.

## Source Handling

- Treat paper links, named papers, benchmarks, datasets, systems, and methods in the user request as context for framing.
- Do not summarize or digest a paper in this skill.
- If the user asks to review literature around a named source or method, frame what surrounding literature should be found, compared, or screened.
- Preserve source identifiers exactly in `key_variables`, `constraints`, or `assumptions` when they are important for downstream literature review.

## Clarification Policy

Set `needs_clarification: true` only when proceeding would likely frame the wrong problem, target the wrong object, use incompatible evidence, or produce the wrong review output.

Set `needs_clarification: false` when a conservative default can support useful progress. Record unresolved but non-blocking choices in `ambiguities` and `assumptions`.

Do not set `needs_clarification: true` merely because optional review preferences are missing. Examples of non-blocking preferences include output format, result count, time range, preferred benchmark or dataset, review style, and which safe variant to emphasize.

When clarification is needed:

- ask 1-3 short, high-impact questions
- still provide the best provisional frame if possible

When clarification is not needed:

- keep `clarifying_questions` empty
- record non-blocking choices in `assumptions`
- proceed with the most conservative useful scope

For ambiguous terminology:

- before deciding `needs_clarification`, infer the most likely referent of the user's core phrase from the request and available context
- if one referent is clearly most likely, proceed around that referent and record the inference in `assumptions`
- do not split a phrase into broad generic ambiguities when the request strongly points to one meaning
- list plausible meanings in `ambiguities`
- ask only when the ambiguity changes the review direction, evidence source, or output form
- otherwise choose the most conservative useful interpretation and record it in `assumptions`
- if multiple meanings are likely relevant, include them as scoped subparts instead of silently choosing one

## Success Criteria Guidance

- Write success criteria that help the literature-review skill judge whether the review is complete enough.
- Useful criteria often mention topical coverage, representative papers, comparison dimensions, evidence gaps, disagreement or consensus, and metadata quality.
- Do not write search queries here.

## Guardrails

- Use this skill only for literature-review requests.
- Frame the review problem; do not answer it, synthesize findings, or recommend methods.
- Do not generate search queries, paper shortlists, paper rankings, or inclusion/exclusion decisions.
- Do not invent citations, papers, datasets, benchmark results, or method details not grounded in the user request or available context.
- Do not silently resolve ambiguous terms. Record non-blocking assumptions, and ask only when the ambiguity blocks useful literature review.
- Do not make a named paper, model, system, dataset, benchmark, or codebase the main review object unless the user asks to review that object.

## Downstream Notes

Pass the frame to `literature-review` as planning context.

Downstream literature-review work should use:

- `objective` and `scope` to decide what the review is about
- `key_variables` and `constraints` to shape what the review should cover
- `success_criteria` to judge whether the review result is complete enough
- `ambiguities`, `assumptions`, and `non_goals` to avoid silent scope drift

If `needs_clarification` is true, ask the user before starting literature review.
