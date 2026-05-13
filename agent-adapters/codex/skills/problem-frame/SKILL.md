---
name: problem-frame
description: Frame or revise literature-review questions before review work. Use for broad or ambiguous review requests; questions about how to improve, evaluate, compare, debug, or explain limitations of a method, system, benchmark, dataset, or research direction when the answer should be grounded in related work rather than immediate implementation or advice; and follow-up corrections to an existing frame.
---

# Problem Frame

Use this skill to frame literature-review questions, especially broad or ambiguous review requests and method, system, benchmark, dataset, or research-direction questions that should be grounded in related work.

## Inputs

Use the user's current request plus relevant prior turns, retrieved context, and project context. Do not require separate input fields.

Treat mixed goals, constraints, background notes, source links, and preferences as one natural-language request; extract only what matters for literature-review framing.

## Execution Workflow

1. Check whether this skill applies. Use it only for literature-review framing. Do not use it for direct factual answers, pure editing or translation, or clear implementation requests with no literature-review intent.
2. Choose `standalone` or `pre_review`: use `standalone` when the user wants to inspect or revise the frame itself, and `pre_review` when the frame prepares a requested literature review.
3. Identify source context and resolve core ambiguity using Source and Ambiguity Handling before extracting frame fields.
4. Extract the user's goal, requested output, explicit constraints, and likely discipline around the resolved or provisional core review object.
5. Draft or update the frame fields using Frame Content Guidance.
6. Apply Clarification Policy to decide `needs_clarification` and `clarifying_questions`.
7. Respond using Output Contract.

Never during this workflow:

- answer the research question or propose improvements
- generate search queries, tactical review steps, paper shortlists, paper rankings, or inclusion/exclusion decisions
- invent citations, papers, datasets, benchmark results, or method details not grounded in the user request or available context

## Output Contract

Maintain the JSON object as the canonical frame record.

Response patterns:

- `standalone`: show a compact markdown frame, then the JSON object.
- `pre_review`: show the brief frame summary, plus clarifying questions when needed; keep the full JSON frame as hidden or handoff context for `literature-review`.

Do not show the full JSON in `pre_review` mode unless the user asks.

Pre-review brief:

```md
Framing this review as:
- Objective: <one sentence>
- Scope: <one sentence>
- Key variables: <short list>
- Constraints: <important constraints, or None>
```

Standalone summary must include:

- discipline
- objective
- scope
- key_variables
- constraints
- success_criteria
- ambiguities
- assumptions, when useful
- clarification status

Required JSON fields:

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

JSON rules:

- Include every required field.
- Use `[]` for empty arrays.
- Keep markdown summaries information-equivalent to the JSON fields.
- Use optional `assumptions` and `non_goals` only when they add useful constraints for literature review.
- Keep `clarifying_questions` empty unless `needs_clarification` is true.

## Interaction Mode

Choose one mode before writing the frame:

- `standalone`: the user wants to inspect, refine, validate, or discuss the problem frame itself.
- `pre_review`: the frame is only preparation for a requested literature review.

Use `standalone` mode when the user says things like:

- "frame this problem first"
- "do not search papers yet; let's inspect the problem frame first"
- "how should this literature review be defined?"
- "is this frame reasonable?"
- "help me refine the scope / variables / success criteria"
- "how can we improve / evaluate / compare <method, system, benchmark, dataset, or research direction>?"

Default to `pre_review` when the user asks to find, search, review, survey, compare papers, compare literatures, or shortlist papers.

Default to `standalone` when the user asks to define a review question, inspect the frame, refine the review scope, or asks how to improve, compare, evaluate, replace, debug, or explain limitations of a method, system, benchmark, dataset, or research direction without requesting immediate implementation.

For visible-frame follow-ups:

- treat corrections, clarifications, objections, and new constraints as frame revisions
- preserve useful parts of the previous frame
- apply the user's feedback directly and update affected JSON fields
- keep the interaction in `standalone` mode unless the user explicitly asks to proceed to literature review

## Source and Ambiguity Handling

Handle sources as framing context:

- Treat paper links, named papers, benchmarks, datasets, systems, and methods as context for the frame.
- Do not summarize or digest papers in this skill.
- If the user asks to review literature around a named source or method, frame the surrounding literature to find, compare, or screen.
- Preserve exact identifiers in `key_variables`, `constraints`, or `assumptions` when they matter for literature review.
- Do not make a named source the main review object unless the user asks to review that object.

Resolve core ambiguity before extracting frame fields:

- The core review object is the term, method, system, benchmark, dataset, acronym, named source, or research direction that determines what literature should be reviewed.
- Use available context first.
- When available and useful, use a web-search-enabled model only to identify the most likely referent of an ambiguous core object.
- Do not use web grounding for optional review preferences such as output format, result count, time range, preferred benchmark or dataset, review style, or safe variant emphasis.
- This is not paper-finding or review execution: do not produce paper lists, search queries, rankings, or review findings.

After resolving:

- if one referent is clearly most likely, proceed and record the inference in `assumptions`
- if any core ambiguity remains unresolved, set `needs_clarification: true` using Clarification Policy
- do not treat a frame with unresolved core ambiguity as final
- preserve unresolved non-core ambiguity in `ambiguities`
- do not split a phrase into broad generic ambiguities when the request strongly points to one meaning
- if multiple meanings are likely relevant, include them as scoped subparts

## Clarification Policy

Use Source and Ambiguity Handling before setting the clarification state.

Set `needs_clarification: true` whenever core ambiguity remains unresolved after Source and Ambiguity Handling.

Set `needs_clarification: false` only when the core review object is resolved and a conservative default can support useful progress. Record unresolved non-core choices in `ambiguities` and `assumptions`.

Do not set `needs_clarification: true` merely because non-core review preferences are missing. Examples of non-blocking preferences include output format, result count, time range, preferred benchmark or dataset, review style, and which safe variant to emphasize.

When clarification is needed, ask 1-3 short, high-impact questions and still provide the best provisional frame if possible.

When clarification is not needed, keep `clarifying_questions` empty, record non-blocking choices in `assumptions`, and proceed with the most conservative useful scope.

## Frame Content Guidance

- Preserve the user's intent while making the review target specific enough to act on.
- Prefer conservative assumptions over broadening the review beyond what the user asked.
- Keep the frame concise, operational, and handoff-ready.
- `objective` should state the literature-review question or purpose, not the likely answer.
- `scope` should bound the review by method, phenomenon, task, domain, benchmark, population, mechanism, time range, or evidence type when those boundaries are available.
- `key_variables` should capture concepts that matter for the review, such as methods, baselines, target tasks, datasets, metrics, outcomes, mechanisms, failure modes, or comparison axes.
- `constraints` should capture user-specified boundaries and evidence requirements, not search queries.
- `success_criteria` should describe what a good review must cover or distinguish, such as topical coverage, representative papers, comparison dimensions, evidence gaps, disagreement or consensus, and metadata quality.
- Use `non_goals` only when the user states exclusions or when a nearby task would otherwise cause likely scope creep.

## Examples

- User: "Find papers on whether tool use improves LLM reasoning" -> use `pre_review` mode to clarify scope, variables, and review success criteria.
- User: "Review work on chain-of-thought faithfulness" -> use `pre_review` mode to clarify the review objective, evidence scope, and success criteria.
- User: "How can we improve retrieval-augmented generation for multi-hop QA?" -> use `standalone` mode to clarify the method, target failure modes, comparison baselines, and evidence needed before proposing changes.
