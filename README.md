# Kaivu Agent TypeScript Core

Kaivu is a scientific agent architecture built around four core objects:

- `SciAgent`: scientific reasoning identity and lifecycle semantics.
- `SciLoop`: research orchestration loop, state updates, continuation decisions, and full trajectory ownership.
- `SciRuntime`: one-stage execution layer for model calls, tool calls, policies, and runtime events.
- `SciMemory`: durable scientific memory with scoped recall and audited commits.
- `LiteratureKnowledgeBase`: source digesting, citation library, ingest policy, and wiki-style literature index.
- `ContextPackBuilder`: token-aware context selection across memory, literature, failed attempts, and graph facts.
- `ResearchGraphRegistry`: typed scientific graph and provenance facts/events.
- `ScientificCapabilityRegistry`: scientific capability packs that resolve lifecycle needs into concrete tools and policy hints.
- `ModelRegistry`: per-agent or per-stage model routing configuration.

Specialist agents such as literature review and hypothesis generation are stage experts called by the loop through the runtime. They are not separate top-level workflows.

```text
SciAgent provides scientific cognition.
SciLoop applies the scientific method as an iterative loop.
SciRuntime provides reliable execution infrastructure.
SciMemory preserves research continuity.
```

## Memory Model

The TypeScript memory layer now follows the mature Python design more closely:

- Scopes: `instruction`, `personal`, `project`, `group`, `public`, `agent`, and `session`.
- Governance fields: kind, evidence level, confidence, status, visibility, promotion status, review flags, conflicts, supersession, and validation history.
- Operations: recall, commit, review, promote, render an entrypoint index, and render an append-only log.
- Recall ranking: text overlap is weighted by memory kind, evidence level, confidence, status, review status, and matching user/project/group scope.

The current implementation is intentionally store-agnostic and in-memory. A Markdown/file-backed store can be added underneath without changing the agent-loop-runtime boundary.

## Literature Knowledge

Literature management is separated from generic memory:

- Raw literature sources are represented as structured `LiteratureSource` records.
- `decideLiteratureIngestPolicy` chooses autonomous, guided, or review-gated ingestion.
- `renderLiteratureDigest` creates a digest first, so interactive research can confirm before committing while autonomous research can commit directly.
- `LiteratureKnowledgeBase` maintains a citation library, digest records, and a lightweight wiki index.

The literature review specialist can ingest sources passed through `task.constraints.literatureSources`, produce literature memory proposals, and leave review-gated material marked as draft/candidate memory.

## Runtime Substrate

The first-priority Python modules have been migrated as TypeScript architecture pieces:

- Context policy and context packs decide what memory/literature/graph material enters the model context.
- Research graph records nodes, edges, provenance facts, provenance events, and graph proposals from stage results.
- Capability registry separates scientific capability declarations from concrete tools.
- Tool policy evaluates risk, review requirements, and audit requirements before tool execution.
- Skill and MCP registries provide the placeholders for reusable scientific skills and external tool servers.
- Model registry supports different model configs per agent or per lifecycle stage.

## Real Model API

The default smoke example uses `EchoModelProvider` so local checks do not spend API tokens. To call a real model, set `OPENAI_API_KEY` and run:

```powershell
npm run build
npm run example:openai
```

You can override the model with `KAIVU_MODEL`, for example `KAIVU_MODEL=gpt-5-mini`. The `OpenAIResponsesModelProvider` records returned usage as input tokens, output tokens, total tokens, and estimated cost when pricing is known.

For local development, copy `.env.example` to `.env` and set `OPENAI_API_KEY`. `.env` is ignored by git.

## OpenAI Authentication

Kaivu does not depend on a ChatGPT browser session. The supported pattern is:

```text
Kaivu login/session -> credential store -> credential resolver -> OpenAIResponsesModelProvider
```

`OpenAIAuthService` can bind an OpenAI API key to a user, project, group, or platform scope. `CredentialResolver` resolves credentials in this order: user, project, group, platform. This gives the same product shape as a web login flow while keeping model access on the official API path.

```powershell
npm run build
npm run example:auth
```

## Minimal API Server

The API server exposes the authentication flow that a web login page would call:

```powershell
npm run build
npm run server
```

Endpoints:

- `GET /health`
- `POST /auth/openai-key`: bind an OpenAI key to a Kaivu session.
- `POST /research/run`: resolve the session credential and run a short scientific loop.

This server intentionally uses an in-memory credential/session store for local development. A production deployment should replace it with an encrypted persistent store and real user login middleware.

If real model calls fail with `OpenAI API connection failed`, the server process may not be using your system proxy. Add one of these to `.env` and restart the server:

```env
HTTPS_PROXY=http://127.0.0.1:7890
HTTP_PROXY=http://127.0.0.1:7890
```

Use your actual local proxy port. `/health` reports whether `OPENAI_API_KEY` and proxy settings are configured without exposing secrets.
