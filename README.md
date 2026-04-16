# Kaivu Agent

Kaivu 是一个用 TypeScript 编写的科学智能体核心。它的目标不是把每个学科的科研流程都硬编码进系统，而是让大模型负责科学思考，让 Kaivu 负责科研过程治理、状态管理、工具调用、记忆沉淀、证据图谱、可观测性和评测。

中文说明是默认文档；英文说明保留在后半部分，方便后续对外交流或开源。

## 核心架构

当前 Kaivu 围绕四个核心对象展开：

- `SciAgent`：科学认知层。负责生命周期语义、专家智能体、阶段计划和学科相关推理上下文。
- `SciLoop`：科研闭环层。负责选择阶段、记录 trajectory、更新状态、提交 memory、更新 graph、暂停等待确认，以及决定是否继续。
- `SciRuntime`：执行运行层。负责单个阶段的执行，包括构建 context pack、调用模型、调用工具、执行 tool policy、发出 runtime events，并返回 stage result。
- `SciMemory`：科学记忆层。负责个人、项目、研究组、会话、公开、agent、instruction 等不同 scope 的长期记忆。

文献调研、假说生成、验证、实验设计等模块是 stage specialist agent。它们由 `SciLoop` 通过 `SciRuntime` 调用，不是独立的顶层 workflow。

```text
SciAgent 负责思考。
SciLoop 负责推进科研闭环。
SciRuntime 负责模型、工具、策略和可观测执行。
SciMemory 负责保留研究连续性。
```

## 当前科研流程

默认科学闭环如下：

```text
用户输入
  -> problem_framing
  -> literature_review
  -> hypothesis_generation
  -> hypothesis_validation
  -> experiment_design
```

`problem_framing` 是第一个治理阶段。它负责对模糊技术词做 grounding，整理研究目标、约束、成功标准，生成英文数据库检索 query，并返回后续阶段使用的正式 `discipline` 字段。

Kaivu 不再使用轻量规则 classifier 作为学科判定的权威来源。如果初始任务没有提供学科，系统会以 `to_be_determined` 作为初始提示；真正的学科由 `problem_framing` 的结构化输出给出。

`problem_framing` schema 要求模型返回以下 discipline 之一：

- `artificial_intelligence`
- `mathematics`
- `chemistry`
- `chemical_engineering`
- `physics`
- `general_science`
- `unknown`

`problem_framing` 结束后，`ResearchState.task.discipline` 会从结构化 `problem_frame` artifact 中更新。后续的文献调研、假说生成、验证和实验规划都会使用这个更新后的学科字段。

## 知识底座

Kaivu 把通用 memory 和文献知识管理分开：

- `SciMemory` 存储长期科研记忆，支持 scope、evidence level、confidence、visibility、promotion status、review state、conflicts、supersession 和 validation history。
- `LiteratureKnowledgeBase` 存储文献来源、digest、citation record 和轻量 wiki-style index。
- `ContextPackBuilder` 从 memory、literature、failed attempts 和 graph facts 中选择 token-aware context。
- `ResearchGraphRegistry` 存储科学事实、provenance edge 和 graph proposal。

这个设计的目标是让原始来源、文献 digest、memory 和 graph facts 随着研究推进持续复利，而不是每次模型调用都从零重新检索和综合。

## 工具与运行层

Runtime 层把科学决策和工具执行分开：

- `ScientificCapabilityRegistry` 把生命周期需求映射成 capability pack，例如 `concept_grounding`、`literature_search`。
- `ToolRegistry` 管理具体工具，例如 literature wiki search、arXiv search、hosted web search，以及未来的 executor adapter。
- `ToolPolicy` 在工具执行前评估风险、review 需求、audit 需求和 autonomy level。
- Runtime events 记录模型调用、模型流式输出、工具进展、context pack、状态更新和阶段输出。

Agent 决定需要做什么科学工作；Runtime 决定如何安全、稳定、可复现地执行。

## 模型接入

Kaivu 当前支持几种模型接入方式：

- `local-echo`：只用于离线 smoke testing，不会产生真实科学推理。
- `openai/<model>`：通过 `OPENAI_API_KEY` 调用 OpenAI Responses API。
- `openai-codex/<model>`：通过 Codex OAuth auth file 调用 Codex backend。
- `codex-cli/<model>`：通过本地安装的 Codex CLI 执行。

Web workbench 中选择了哪个模型，Kaivu 就使用哪个模型。系统不应该静默切换到轻量 classifier 来做学科判断。

## OpenAI API 设置

如果使用官方 OpenAI API，可以从 `.env.example` 创建 `.env`：

```powershell
copy .env.example .env
```

然后设置：

```env
OPENAI_API_KEY=sk-...
KAIVU_MODEL=gpt-5-mini
```

如果网络需要代理，也可以设置：

```env
HTTPS_PROXY=http://127.0.0.1:7890
HTTP_PROXY=http://127.0.0.1:7890
```

`.env` 会被 git 忽略。`.env.example` 是安全模板，只用于说明需要哪些环境变量，不应该包含真实密钥。

## Codex OAuth 设置

如果希望使用 ChatGPT/Codex 风格的 OAuth 访问，可以先登录 Codex：

```powershell
npx codex login
```

然后在 workbench 中选择 `openai-codex/...` 或 `codex-cli/...` 模型。Codex OAuth 适合想接近 Codex/OpenClaw 使用方式的场景，但它和普通 OpenAI API key 不是同一种认证方式。

## 运行

安装依赖：

```powershell
npm install
```

类型检查：

```powershell
npm run typecheck
```

构建：

```powershell
npm run build
```

运行本地 smoke example：

```powershell
npm run smoke
```

启动 Web/API server：

```powershell
npm run build
npm run server
```

打开 workbench：

```text
http://127.0.0.1:8787
```

## API Server

本地 API server 提供：

- `GET /health`
- `POST /auth/openai-key`
- `POST /research/run`
- `POST /research/run-stream`

`/research/run-stream` 是 web workbench 的主要接口。它会流式返回 trajectory events、model status、model deltas、tool progress 和最终 stage output，让界面更像交互式科学对话，而不是隐藏的 batch workflow。

## 开发检查

修改核心代码前后建议运行：

```powershell
npm run typecheck
node --check public\app.js
npm run smoke
```

`npm run smoke` 使用 `local-echo`，所以它验证的是系统 wiring，不验证科学质量。真实的 problem framing、literature review 和 hypothesis generation 需要真实模型 provider。

## 设计原则

Kaivu 应该把稳定的科学治理层写进代码：

- lifecycle stages
- state transitions
- memory and graph updates
- tool policy
- provenance
- structured outputs
- review gates
- benchmark and replay hooks

科学解释本身通常应该保持 model-driven：

- discipline interpretation
- problem framing
- literature synthesis
- hypothesis generation
- result interpretation
- failure classification
- next-action rationale

一句话：

```text
让模型做科学思考。
让 Kaivu 做科学治理。
```

---

# Kaivu Agent

Kaivu is a TypeScript scientific agent core. Its design goal is not to hard-code every discipline workflow, but to let large language models do scientific reasoning while Kaivu governs the research process, state, tools, memory, provenance, and evaluation.

Chinese is the default README language. This English section is kept for external communication and future open-source use.

## Core Architecture

Kaivu is organized around four primary objects:

- `SciAgent`: the scientific cognition layer. It defines lifecycle semantics, specialist agents, stage plans, and discipline-aware reasoning context.
- `SciLoop`: the research loop. It selects stages, records trajectory, updates state, commits memory, updates the graph, pauses for review, and decides whether to continue.
- `SciRuntime`: the execution layer. It runs one stage at a time, builds context packs, calls models, executes tools, enforces tool policy, emits runtime events, and returns stage results.
- `SciMemory`: scoped scientific memory. It supports personal, project, group, session, public, agent, and instruction memories with governance metadata.

Specialists such as problem framing, literature review, hypothesis generation, verification, and experiment design are stage expert agents called by `SciLoop` through `SciRuntime`. They are not separate top-level workflows.

```text
SciAgent thinks.
SciLoop advances the scientific loop.
SciRuntime executes models, tools, policy, and observability.
SciMemory preserves research continuity.
```

## Current Research Flow

The default scientific loop is:

```text
user query
  -> problem_framing
  -> literature_review
  -> hypothesis_generation
  -> hypothesis_validation
  -> experiment_design
```

`problem_framing` is the first governing stage. It grounds ambiguous technical terms, frames the objective, defines constraints and success criteria, produces English database-ready literature queries, and returns the official downstream `discipline` field.

Kaivu no longer uses a lightweight rule classifier as the authority for discipline detection. If the initial task does not provide a discipline, the loop starts with `to_be_determined`; the model-facing `problem_framing` schema must return one of:

- `artificial_intelligence`
- `mathematics`
- `chemistry`
- `chemical_engineering`
- `physics`
- `general_science`
- `unknown`

After `problem_framing`, `ResearchState.task.discipline` is updated from the structured `problem_frame` artifact. Literature review, hypothesis generation, verification, and experiment planning then use that updated discipline.

## Knowledge Substrate

Kaivu separates generic memory from literature knowledge:

- `SciMemory` stores durable research memory with scopes, evidence level, confidence, visibility, promotion status, review state, conflicts, supersession, and validation history.
- `LiteratureKnowledgeBase` stores literature sources, digests, citation records, and a lightweight wiki-style index.
- `ContextPackBuilder` selects token-aware context from memory, literature, failed attempts, and graph facts.
- `ResearchGraphRegistry` stores typed scientific facts, provenance edges, and graph proposals.

This follows the principle that raw sources, literature digests, memory, and graph facts should compound over time instead of being rediscovered from scratch in every model call.

## Tool And Runtime Layer

The runtime layer keeps tools and scientific decisions separate:

- `ScientificCapabilityRegistry` maps lifecycle needs, such as `concept_grounding` or `literature_search`, to capability packs.
- `ToolRegistry` contains concrete tools such as literature wiki search, arXiv search, hosted web search, and future executor adapters.
- `ToolPolicy` evaluates tool risk, review requirements, audit requirements, and autonomy level before tool execution.
- Runtime events capture model calls, model deltas, tool progress, context packs, status updates, and stage outputs.

The agent decides what scientific work is needed. The runtime decides how to execute it safely and reproducibly.

## Model Providers

Kaivu currently supports several model access modes:

- `local-echo`: offline smoke testing only. It does not produce real scientific reasoning.
- `openai/<model>`: OpenAI Responses API using `OPENAI_API_KEY`.
- `openai-codex/<model>`: Codex OAuth backend using the Codex auth file.
- `codex-cli/<model>`: Codex CLI execution using the locally installed Codex CLI.

The web workbench lets you choose the model. The selected model is the model used; Kaivu should not silently swap to a lightweight classifier for discipline detection.

## OpenAI API Setup

For official OpenAI API access, create `.env` from `.env.example`:

```powershell
copy .env.example .env
```

Then set:

```env
OPENAI_API_KEY=sk-...
KAIVU_MODEL=gpt-5-mini
```

If your network requires a proxy, also set:

```env
HTTPS_PROXY=http://127.0.0.1:7890
HTTP_PROXY=http://127.0.0.1:7890
```

`.env` is ignored by git. `.env.example` is the safe template that documents required variables without containing secrets.

## Codex OAuth Setup

For ChatGPT/Codex-style OAuth access, log in with Codex first so Kaivu can read the Codex auth file:

```powershell
npx codex login
```

Then choose an `openai-codex/...` or `codex-cli/...` model in the workbench. Codex OAuth is useful when you want behavior closer to Codex/OpenClaw style access, but it is not the same as a normal OpenAI API key.

## Running

Install dependencies:

```powershell
npm install
```

Type-check:

```powershell
npm run typecheck
```

Build:

```powershell
npm run build
```

Run the local smoke example:

```powershell
npm run smoke
```

Start the web/API server:

```powershell
npm run build
npm run server
```

Open the workbench at:

```text
http://127.0.0.1:8787
```

## API Server

The local API server exposes:

- `GET /health`
- `POST /auth/openai-key`
- `POST /research/run`
- `POST /research/run-stream`

`/research/run-stream` is the main endpoint for the web workbench. It streams trajectory events, model status, model deltas, tool progress, and final stage outputs so the UI can behave like an interactive scientific conversation rather than a hidden batch workflow.

## Development Checks

Use these checks before committing major changes:

```powershell
npm run typecheck
node --check public\app.js
npm run smoke
```

`npm run smoke` uses `local-echo`, so it verifies wiring rather than scientific quality. Real problem framing, literature review, and hypothesis generation require a real model provider.

## Design Principle

Kaivu should keep the stable scientific governance layer in code:

- lifecycle stages
- state transitions
- memory and graph updates
- tool policy
- provenance
- structured outputs
- review gates
- benchmark and replay hooks

The scientific interpretation itself should usually stay model-driven:

- discipline interpretation
- problem framing
- literature synthesis
- hypothesis generation
- result interpretation
- failure classification
- next-action rationale

In short:

```text
Let the model do scientific thinking.
Let Kaivu govern scientific process.
```
