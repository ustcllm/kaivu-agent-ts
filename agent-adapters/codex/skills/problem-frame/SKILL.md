---
name: problem-frame
description: Produce a concise, structured problem frame from a broad or ambiguous request. Use when Codex needs to clarify objectives, narrow scope, surface ambiguities, extract variables and constraints, define evidence-based success criteria, or prepare handoff before literature review, paper wiki work, hypothesis generation, experiment planning, or research-oriented implementation.
---

# Problem Frame

Use this skill when a user request is research-like, decision-like, under-specified, ambiguous, or too broad for reliable downstream work.

Do not use this skill when the user only wants:

- a direct factual answer
- pure editing or translation
- straightforward implementation with clear requirements

## Goal

Turn the user request into a minimal, decision-useful problem frame that downstream agents can consume.

The skill must:

- preserve the user's intent
- avoid answering the underlying question
- avoid generating literature queries
- avoid proposing hypotheses or experiments unless the user asked for framing those tasks
- make ambiguities explicit
- narrow broad requests conservatively

## Inputs

Expected inputs:

- `question`: original user request
- `discipline_hint`: optional prior label such as `physics`, `artificial_intelligence`, or `to_be_determined`
- `context`: optional notes, prior turns, retrieved context, or user constraints
- `revision_notes`: optional corrections that override earlier wording

If `revision_notes` conflicts with the original question, prefer the revised interpretation while preserving the original as provenance.

## Output Contract

Return both:

1. A compact markdown summary for humans
2. A JSON object for downstream agents

Use this JSON shape:

```json
{
  "discipline": "artificial_intelligence | mathematics | chemistry | chemical_engineering | physics | general_science | software_engineering | decision_support | unknown",
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

1. Identify the most likely interpretation of the request.
2. If terminology is ambiguous, list the ambiguity explicitly.
3. Convert the request into one concrete objective.
4. Define a scope narrow enough for the next agent or workflow.
5. Extract important variables, mechanisms, systems, observables, methods, datasets, metrics, constraints, or stakeholders.
6. Only add assumptions when necessary, and mark them clearly.
7. Define success criteria that could be checked by evidence, experiments, simulations, proofs, benchmarks, tests, or user review.
8. If the request is too broad, narrow it instead of expanding it.
9. Keep the output concise and operational.

## Guardrails

- Do not answer the underlying question.
- Do not invent citations, datasets, methods, or implementation details not grounded in the input.
- Do not silently resolve ambiguous terms.
- Do not turn an existing paper, model, system, or codebase mentioned by the user into the main object unless the actual task is to study that object.
- If a full problem frame is not appropriate, provide a reduced decision frame.

## Handoff Notes

Downstream agents should consume:

- `discipline` for routing
- `objective` and `scope` for planning
- `key_variables` and `constraints` for search, design, or implementation
- `success_criteria` for later validation
- `ambiguities` and `assumptions` as explicit uncertainty markers
