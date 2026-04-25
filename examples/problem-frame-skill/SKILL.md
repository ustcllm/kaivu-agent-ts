---
name: problem-frame
description: Produce a concise, structured scientific problem frame from a user request. Use when an agent needs to clarify the research objective, narrow scope, surface ambiguities, extract key variables and constraints, and define evidence-based success criteria before literature review, hypothesis generation, or experiment planning.
---

# Problem Frame

Use this skill when the user request is research-like, under-specified, ambiguous, or too broad for reliable downstream work.

Do not use this skill when the user only wants:

- a direct factual answer
- pure editing or translation
- implementation code without research framing

## Goal

Turn the user request into a minimal, decision-useful problem frame that downstream agents can consume.

The skill must:

- preserve the user's intent
- avoid answering the research question
- avoid generating literature queries
- avoid proposing hypotheses or experiments
- make ambiguities explicit instead of hiding them
- narrow broad requests conservatively

## Inputs

Expected inputs:

- `question`: original user request
- `discipline_hint`: optional prior label such as `physics` or `to_be_determined`
- `context`: optional notes, prior turns, or retrieved context
- `revision_notes`: optional corrections that should override earlier wording

If `revision_notes` conflicts with the original question, prefer the revised interpretation while preserving the original as provenance.

## Output Contract

Return both:

1. A compact markdown summary for humans
2. A JSON object for downstream agents

Use this JSON shape:

```json
{
  "discipline": "artificial_intelligence | mathematics | chemistry | chemical_engineering | physics | general_science | unknown",
  "objective": "string",
  "scope": "string",
  "key_variables": ["string"],
  "constraints": ["string"],
  "success_criteria": ["string"],
  "ambiguities": ["string"],
  "assumptions": ["string"],
  "memory_summary": "string"
}
```

## Framing Rules

1. Identify the most likely scientific interpretation of the request.
2. If terminology is ambiguous, list the ambiguity explicitly.
3. Convert the request into one concrete research objective.
4. Define a scope narrow enough for literature review or hypothesis work.
5. Extract important variables, mechanisms, systems, observables, methods, or datasets that are stated or clearly implied.
6. Only add assumptions when necessary, and mark them clearly.
7. Define success criteria that could be checked by evidence, experiments, simulations, proofs, or benchmarks.
8. If the request is too broad, narrow it instead of expanding it.
9. Keep the output concise and operational.

## Recommended Procedure

1. Read the user request and any revision notes.
2. Infer the likely discipline from the request unless a reliable discipline is already given.
3. Separate known context from the unknown that needs investigation.
4. Rewrite the request as a research objective.
5. Trim scope until it is actionable by a downstream specialist.
6. List variables, constraints, success criteria, ambiguities, and assumptions.
7. Return the markdown summary followed by the JSON object.

## Markdown Summary Template

```md
## Discipline
<discipline>

## Objective
<objective>

## Scope
<scope>

## Key Variables
- ...

## Constraints
- ...

## Success Criteria
- ...

## Ambiguities
- ...

## Assumptions
- ...
```

Omit the `Ambiguities` or `Assumptions` section only if empty.

## Guardrails

- Do not answer the underlying research question.
- Do not invent citations, datasets, or methods not grounded in the input.
- Do not silently resolve ambiguous terms.
- Do not turn an existing paper, model, or system mentioned by the user into the main object of summary unless the actual task is to study that object.
- If the request is not scientific or research-oriented, say that a full problem frame is not appropriate and provide a reduced version centered on the decision problem.

## Handoff Notes

Downstream agents should consume:

- `discipline` for routing
- `objective` and `scope` for planning
- `key_variables` and `constraints` for search and evaluation design
- `success_criteria` for later validation
- `ambiguities` and `assumptions` as explicit uncertainty markers

## Example Invocation

User request:

```text
Can diffusion models help inverse design of porous catalysts for CO2 reduction, and how would we know if the approach is actually better than existing generative methods?
```

Expected behavior:

- infer a likely chemistry or chemical engineering framing
- define the research objective around inverse design and comparative evaluation
- keep catalyst mechanism details as variables or ambiguities if the input is underspecified
- define success criteria in terms of design validity, performance metrics, and comparison baseline
