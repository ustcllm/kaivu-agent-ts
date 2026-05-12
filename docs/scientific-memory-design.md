# Scientific Memory Design

本文档总结 Kaivu 在科学智能体场景下的 memory 设计。它关注的是长期科研连续性、证据治理、失败经验复用和跨阶段上下文组织，而不是普通聊天系统里的会话摘要。

## Design Goal

Kaivu 的 memory 目标不是让模型“记住更多文本”，而是让科研过程可以持续复利：

- 研究问题、阶段性决策、假说、失败尝试和方法经验可以跨阶段保留。
- 每条记忆都带有证据等级、可信度、可见性和审查状态。
- 文献知识、paper digest、runtime review state、research graph 和通用 memory 有清晰边界。
- 模型调用前只取当前阶段真正需要的上下文，避免把长期知识库无差别塞进 prompt。

一句话概括：

```text
Memory is not a prompt cache.
Memory is governed research state.
```

## Why Scientific Agents Need Different Memory

普通 agent memory 往往围绕用户偏好、对话摘要或 RAG 检索展开。科学智能体需要处理更复杂的长期状态：

- 科研结论可能被新证据修正。
- 失败实验和负结果本身有高价值。
- 文献证据存在质量等级、冲突和适用边界。
- 私人、项目、团队和公开知识不能混在一起。
- 一条记忆是否可用于决策，取决于来源、验证状态、冲突状态和审查状态。

因此 Kaivu 把 memory 设计成带治理元数据的科研资产，而不是无结构文本片段。

## Core Layers

Kaivu 的知识底座由多个层次组成：

```text
raw sources
  -> paper digest
  -> literature wiki

stage outputs
  -> memory proposals
  -> governed SciMemory

scientific facts
  -> research graph

runtime traces
  -> trajectory / observability events
```

这些层不是互相替代关系：

- `SciMemory` 保存长期科研连续性，例如决策、假说、方法经验、失败尝试、偏好和警告。
- `PaperDigest` 保存单篇论文的结构化理解，是 raw source 和 wiki 之间的可复用编译层。
- `LiteratureReviewRuntimeStore` 保存文献 review 执行时的临时工作集，例如检索结果、claim table 和 conflict map。
- persistent literature wiki 保存长期、人类可浏览的文献知识对象。
- `ResearchGraphRegistry` 保存结构化事实、关系和 provenance。
- trajectory 保存执行观察性信息，不直接作为 agent-to-agent 科学内容交换层。

## Memory Record Model

每条 `MemoryRecord` 都包含内容字段和治理字段。

内容字段包括：

- `title`
- `summary`
- `content`
- `tags`
- `sourceRefs`
- `excerpt`

科研治理字段包括：

- `scope`: `instruction`、`personal`、`project`、`group`、`public`、`agent`、`session`
- `kind`: `fact`、`hypothesis`、`method`、`decision`、`dataset_note`、`warning`、`preference`、`reference`
- `evidenceLevel`: `anecdotal`、`preprint`、`peer_reviewed`、`replicated`、`validated`、`unknown`
- `confidence`: `low`、`medium`、`high`、`uncertain`
- `status`: `active`、`revised`、`deprecated`、`rejected`、`draft`
- `visibility`: `private`、`project`、`group`、`public`
- `promotionStatus`: `local_only`、`candidate`、`approved`、`shared`
- `needsReview`
- `supersedes`
- `supersededBy`
- `derivedFrom`
- `conflictsWith`
- `validatedBy`

这个模型让系统能区分：

- “这是用户个人偏好”还是“这是项目知识”
- “这是候选假说”还是“这是已验证方法”
- “这是待审查结论”还是“这是可用于下游阶段的稳定背景”
- “这是被新证据替代的旧结论”还是“这是当前有效结论”

## Write Path

Kaivu 不允许 specialist agent 直接写入长期 memory。写入路径是：

```text
SpecialistAgent
  -> StageResult.memoryProposals
  -> SciLoop
  -> SciMemory.commit()
  -> memory log / trajectory event
```

这种设计有三个目的：

1. 把科学推理和记忆治理解耦。
2. 让每次写入都有明确来源，例如 `agent:specialist:stage`。
3. 给后续 review、promotion、audit 和 replay 留出统一入口。

例如，literature review 阶段会提出 `Literature review digest` 作为 project/reference memory；hypothesis generation 阶段会提出 `Candidate hypothesis theory objects` 作为 project/hypothesis memory。它们都通过 `SciLoop` 在阶段完成后统一提交。

## Recall Path

Memory recall 不是简单关键词搜索。`SciMemory.recall()` 会先做作用域和可见性过滤，再按科研可靠性加权排序。

主要信号包括：

- query term overlap
- memory kind 权重
- evidence level 权重
- confidence 权重
- status 权重
- `needsReview` 惩罚
- user/project/group 匹配加权
- scope 访问权限

例如：

- `validated`、`replicated`、`peer_reviewed` 记忆权重更高。
- `deprecated`、`rejected` 记忆权重更低。
- 当前 project 的 project memory 会比无关 project memory 更优先。
- personal memory 必须匹配 userId 才可访问。

这使 memory recall 更接近“科研证据选择”，而不是普通文本相似度检索。

## Context Pack

模型调用前，`ContextPackBuilder` 会从多个来源构建阶段上下文：

- memory
- failed attempts / negative results
- literature runtime pages
- graph facts

然后根据 `ContextPolicy` 做 token-aware selection。

不同阶段有不同上下文需求：

- literature 阶段需要 literature wiki index、claim compiler、source quality table。
- hypothesis 阶段需要 hypothesis tree、failed attempts、evidence conflicts。
- experiment 阶段需要 experiment scheduler、toolchain、risk gate。
- decision/review 阶段需要 agent stance continuity、benchmark quality、release gate。

一个关键设计是：失败尝试和负结果被单独抽出，并且在预算排序中优先级最高。

```text
failed attempts / negative results
  > normal memory
  > literature notes
  > graph facts
```

这体现了科学智能体的一个核心原则：失败路径不是噪音，而是避免重复错误的重要知识。

## Memory Governance

`MemoryGovernance` 负责跨 scope 的迁移和晋升规划。

迁移决策有三类：

- `auto_promote`: 低风险、可信、无冲突，可以自动晋升。
- `propose`: 需要人工或 curator 审查。
- `block`: 冲突、敏感、低可信或不适合扩大可见性的记忆被阻止。

风险判断会考虑：

- record status
- unresolved conflicts
- weak evidence or low confidence
- failed attempts / negative results
- personal memory moving to broader scope
- public promotion
- sensitive content
- automation mode

尤其是 public promotion 总是需要 review；包含 credential、secret、unpublished、confidential、patient、human subject 等敏感信号的记忆会被严格限制。

这让 Kaivu 的 memory 更像科研组织中的知识发布流程，而不是个人助手的“永久记住”按钮。

## Relationship With Literature Wiki

Kaivu 明确区分 generic memory 和文献知识。

`SciMemory` 不应该成为长期文献 wiki 的替代品。它适合保存：

- 当前研究方向的决策
- 需要下游阶段记住的假说和方法
- 失败尝试和风险提醒
- 用户或项目偏好
- 跨阶段 handoff 信息

文献知识则分层保存：

- raw paper source: 原始材料
- paper digest: 单篇论文的结构化理解
- literature wiki: 长期、人类可浏览、可交叉引用的知识对象
- runtime store: review 执行中的临时索引和 claim/conflict 工作集

这个边界能避免一个常见问题：把临时 review 结果、论文 digest、长期 wiki 页面和 agent memory 全混成一个不可治理的知识池。

## Relationship With Research Graph

Memory 保存的是面向阶段连续性的科研记忆；graph 保存的是结构化事实和关系。

例如 hypothesis generation 可能同时产生：

- project/hypothesis memory: 给后续阶段阅读的候选假说摘要。
- graph proposal: `hypothesis -> proposes_mechanism -> mechanism_chain` 这样的结构化事实。

二者互补：

- memory 更适合自然语言背景、决策说明、失败教训和上下文 handoff。
- graph 更适合结构化查询、关系追踪、provenance 和后续图推理。

## Persistence

`PersistentSciMemory` 将 memory snapshot 保存为 JSON：

```json
{
  "schemaVersion": "kaivu-memory-v1",
  "records": [],
  "log": [],
  "updatedAt": "..."
}
```

它继承 `SciMemory`，并在 `commit`、`review`、`promote` 后自动 persist。当前实现偏轻量，适合作为本地 agent runtime 的持久层；未来可以替换为数据库、向量索引或事件源存储，但不应该改变上层治理语义。

## What Makes This Design Distinctive

Kaivu 的 scientific memory 有几个区别于普通 agent memory 的地方：

1. 它有证据等级，而不只是相似度。
2. 它有 scope 和 visibility，而不只是全局记忆。
3. 它有 review、promotion 和 block 机制，而不是一次写入永久有效。
4. 它显式保存 conflicts、supersession 和 validation history。
5. 它把失败尝试和负结果作为高优先级上下文。
6. 它不和文献 wiki、paper digest、runtime review state 混用。
7. 它通过 `ContextPackBuilder` 进入模型上下文，而不是无预算拼接。
8. 它由 `SciLoop` 统一提交，避免 specialist agent 直接污染长期状态。

## Current Limitations

当前实现仍然是早期版本：

- recall 主要是 lexical overlap 加权，还不是向量检索或混合检索。
- duplicate detection 主要基于 title，语义去重还不充分。
- conflict resolution 目前记录冲突，但不自动做科学裁决。
- memory compaction 的接口已有日志动作类型，但还没有完整压缩策略。
- governance 规则是启发式规则，未来可以接入角色权限、审批流和审计 UI。
- graph search 当前主要搜索 nodes，facts 和 edges 的检索还可以增强。

这些限制不影响核心设计方向：memory 作为科研治理状态，而不是单纯上下文缓存。

## Future Directions

后续可以沿几个方向扩展：

- Hybrid retrieval: lexical + embedding + graph-aware recall。
- Semantic deduplication: 按 claim、method、hypothesis、dataset 维度去重。
- Memory compaction: 把重复失败尝试压缩成 route-level failure memories。
- Review UI: 展示待审查、冲突、可晋升和已废弃记忆。
- Evidence replay: 从 memory 回溯到 stage output、literature digest、wiki page 和 graph provenance。
- Policy-aware context: 对不同 autonomy level、risk level、publication target 选择不同 memory。
- Team knowledge curation: 将 project memory 经 curator 审查后晋升为 group memory。

## Summary

Kaivu 的 memory 设计把长期记忆放在科学过程治理中理解：

```text
Specialists generate scientific outputs.
SciLoop governs whether outputs become memory.
SciMemory stores scoped, evidence-aware research memory.
ContextPackBuilder selects only decision-useful memory for each stage.
MemoryGovernance controls promotion, visibility, review, and risk.
```

这套设计的核心价值是让科学智能体在长期研究中积累可靠上下文，同时保留证据边界、冲突状态和人类审查入口。
