# Archive and Consolidation Dry Run

> 生成时间：2026-09-02 10:08 +08:00
> Workflow：SpecDev
> 模式：archive-single / dry-run
> Knowledge policy：generic
> Change：`2026-09-02-consolidate-project-knowledge`

**除持久化本报告外，未修改永久知识、未移动 change、未更新 archived 索引、未删除或改写既有文件。此为 dry-run 计划，请确认后执行。**

## 1. Path Context

| 名称 | 已解析路径 | 状态 |
|---|---|---|
| Workflow root | `<Path>{roots.workflows}/specdev/</Path>` | pass |
| State root | `<Path>{roots.state}/specdev/</Path>` | pass |
| Changes root | `<Path>{roots.state}/specdev/changes/</Path>` | pass |
| Archive root | `<Path>{roots.state}/specdev/archive/</Path>` | pass |
| ADR store | `<Path>{roots.state}/specdev/adr/</Path>` | exists, empty |
| Context store | `<Path>{roots.state}/specdev/context/</Path>` | exists, empty |
| Research store | `<Path>{roots.state}/specdev/research/</Path>` | exists, empty; no planned write |

## 2. Archive Plan

### 预检摘要

| 检查项 | 状态 |
|---|---|
| change 名称符合日期 kebab 规则 | pass |
| `.status.json` 可解析且 `change_status=completed` | pass |
| source 存在且位于 changes root | pass |
| archive target 不存在且位于 archive root | pass |
| 全局 active 中唯一存在 | pass: 1 |
| 全局 archived 中不存在 | pass: 0 |
| blocker / deviation / worktree | pass: 0 / 0 / 0 |
| `--stage complete` | pass: 0 errors, 0 warnings |
| 包级 `--self-check` | pass: 0 errors, 0 warnings |

### 逐项移动

| # | Source | Target | Action | Status | Risk |
|---|---|---|---|---|---|
| 1 | `<Path>{roots.state}/specdev/changes/2026-09-02-consolidate-project-knowledge/</Path>` | `<Path>{roots.state}/specdev/archive/2026-09/2026-09-02-consolidate-project-knowledge/</Path>` | atomic move | ready | medium: destructive path move |

### 状态变更

- 从 `<Path>{roots.state}/specdev/status.json</Path>` 的 `active` 移除该 change，将名称去重追加到 `archived`。
- 在已移动的 `.status.json` 中写入 `change_status: archived`、`archived: true`、正确 `archive_path` 和新的 `updated_at`。
- 保留 `<Path>{roots.state}/specdev/changes/.gitkeep</Path>`；不执行 Git commit、push、branch/worktree cleanup 或远程动作。

## 3. Knowledge Graduation Summary

| Store | 新建文件 | 合并 | 冲突/需确认 | Ephemeral groups |
|---|---:|---:|---:|---:|
| `<Path>{roots.state}/specdev/adr/</Path>` | 12 | 0 | 5 个历史措辞修订确认点 | 1 |
| `<Path>{roots.state}/specdev/context/</Path>` | 8 | 0 | 0 | 4 |
| `<Path>{roots.state}/specdev/research/</Path>` | 0 | 0 | 0 | 2 |

全部目标 store 当前为空，因此没有编号冲突、术语定义冲突或覆盖动作。每个新文件将标注来源 change `2026-09-02-consolidate-project-knowledge` 与提升日期 `2026-09-02`。

## 4. ADR Creation Plan

所有条目同时满足：难逆转、缺少上下文会令人意外、存在真实替代方案与取舍；并满足 stable-mechanism 和 must-know 毕业标准。内容来源为 `<Path>{roots.state}/specdev/changes/2026-09-02-consolidate-project-knowledge/ADR.md</Path>` 对应 section，写入时规范化为永久 ADR 格式并保留实现状态/残余验证风险。

| # | Target | Decision | Source | Action | Risk |
|---|---|---|---|---|---|
| 1 | `<Path>{roots.state}/specdev/adr/0001-single-go-sidecar-and-layer-ownership.md</Path>` | 单个 Go sidecar 与 React/Rust/Go 分层所有权 | project ADR-001 + code | create | low |
| 2 | `<Path>{roots.state}/specdev/adr/0002-loopback-http-bootstrap-security.md</Path>` | loopback HTTP、Bootstrap token 与纵深校验 | project ADR-002 + code | create | medium: 修正 token 生命周期措辞 |
| 3 | `<Path>{roots.state}/specdev/adr/0003-pure-go-sqlite-capability-baseline.md</Path>` | modernc、CGO=0 与 SQLite 能力合同 | project ADR-003 + code/tests | create | medium: 不宣称 Windows gate 已全量证明 |
| 4 | `<Path>{roots.state}/specdev/adr/0004-openapi-first-cross-language-contract.md</Path>` | OpenAPI 3.1 与跨语言生成投影 | project ADR-004 + generation/CI | create | medium: 披露手工 Go runtime 边界 |
| 5 | `<Path>{roots.state}/specdev/adr/0005-persistent-identifiers-and-time-semantics.md</Path>` | UUIDv7 目标、seed slug、UTC/timezone/date | project ADR-005 + code | create | medium: 限定 ID 适用范围与 fallback |
| 6 | `<Path>{roots.state}/specdev/adr/0006-managed-attachment-ownership-and-atomic-import.md</Path>` | 托管附件 owner 与补偿式原子导入 | project ADR-006 + tests | create | low |
| 7 | `<Path>{roots.state}/specdev/adr/0007-manual-updates-and-platform-trust.md</Path>` | 无 updater 的 Windows/macOS 手动分发信任模型 | project ADR-007 + current release config | create, supersede historical wording | high: 实质修订旧发布描述 |
| 8 | `<Path>{roots.state}/specdev/adr/0008-verified-atomic-backup-bundles.md</Path>` | SQLite snapshot、附件 manifest、校验与原子发布 | project ADR-008 + tests | create | low |
| 9 | `<Path>{roots.state}/specdev/adr/0009-unified-task-calendar-model.md</Path>` | Task 是唯一可排程实体，Calendar 是投影 | V2 requirements + code/tests | create | medium: 补齐隐式数据模型决定 |
| 10 | `<Path>{roots.state}/specdev/adr/0010-user-defined-archive-schema.md</Path>` | 用户管理 ArchiveType/FieldDefinition 与 typed EAV | V2 requirements + code/tests | create | medium: 补齐隐式扩展模型决定 |
| 11 | `<Path>{roots.state}/specdev/adr/0011-v2-development-reset-no-v1-compatibility.md</Path>` | V2 单基线且不迁移/恢复 V1 | V2 requirements + README | create | medium: 长期兼容边界 |
| 12 | `<Path>{roots.state}/specdev/adr/0012-portable-workspace-and-single-writer-lock.md</Path>` | 普通目录工作区与 OS 排他单 writer | README + code/tests | create | medium: 补齐隐式数据所有权决定 |

## 5. Context Creation Plan

来源为 `<Path>{roots.state}/specdev/changes/2026-09-02-consolidate-project-knowledge/CONTEXT.md</Path>`。永久文件只保留规范术语、`_Avoid_` 与稳定关系；代码路径、验证日期、实现缺口和 change 历史留在归档。来源/提升日期使用最小 frontmatter 保存。

| # | Target | Content | Action | Graduation | Risk |
|---|---|---|---|---|---|
| 1 | `<Path>{roots.state}/specdev/context/INDEX.md</Path>` | 永久 context 读取目录与主题路由 | create | must-know | low |
| 2 | `<Path>{roots.state}/specdev/context/workspace-runtime.md</Path>` | Personal Workbench、工作区、桌面宿主、workbenchd、Bootstrap、Ready | create | stable-mechanism / must-know | low |
| 3 | `<Path>{roots.state}/specdev/context/archives.md</Path>` | 档案、类型、字段、敏感字段、事件档案、关系、托管附件、活动 | create | stable-mechanism / must-know | low |
| 4 | `<Path>{roots.state}/specdev/context/planning.md</Path>` | 任务、排期、任务视图、日历投影、主档案、全局检查器 | create | stable-mechanism / must-know | low |
| 5 | `<Path>{roots.state}/specdev/context/retrieval.md</Path>` | 全局搜索与派生搜索索引 | create | stable-mechanism | low |
| 6 | `<Path>{roots.state}/specdev/context/data-safety.md</Path>` | 回收站/结构删除、备份、恢复预检、新工作区恢复、Job | create | stable-mechanism / must-know | low |
| 7 | `<Path>{roots.state}/specdev/context/compatibility.md</Path>` | V2 基线、运行时业务 ID、时间点语义 | create | must-know | low |
| 8 | `<Path>{roots.state}/specdev/context/context-map.md</Path>` | React/Rust/Go/SQLite 与五个 bounded contexts 的稳定关系 | create | stable-mechanism / must-know | low |

共提升 32 个规范术语、1 份 Context Map 和 1 份读取索引。

## 6. Conflicts Needing Confirmation

这些不是 permanent store 内冲突，而是历史 ADR 原文与当前代码/配置的语义差异。建议全部选择 B，永久知识描述当前事实并保留旧文件作为历史来源。

| Item | A: 原样提升 | B: 按当前事实修订（推荐） |
|---|---|---|
| project ADR-002 | 每次 sidecar launch 都轮换 token | 每应用/工作区 Bootstrap 生成，受监管重启复用 |
| project ADR-003 | Windows gate 已证明全部 SQLite 能力 | 保留能力合同，明确当前 CI 证据缺口 |
| project ADR-004 | OpenAPI 已强制约束 Go runtime | 保留 OpenAPI-first，披露手工路由/strict-server 缺口 |
| project ADR-005 | 所有实体无例外使用 UUIDv7，存在 calendar records | 限定运行时业务 ID、seed slug、UUIDv4 fallback，并改为 Task timezone |
| project ADR-007 | Windows Release 包含 NSIS + portable ZIP，只有 Windows | 当前 tagged Release 为 Windows NSIS + macOS ad-hoc DMG；portable 仅本地流程 |

## 7. Ephemeral - 留在归档，不提升

| Knowledge item | Reason |
|---|---|
| agent team 分工、阅读过程与逐行导航 | 单次 consolidation 过程信息 |
| 当前命令输出、Node 22 engine warning 与未运行命令 | 验证快照，不是稳定领域知识 |
| Calendar range 创建预填、真正 fuzzy archive search、Tasks 筛选 | 需求/占位与当前实现不一致，缺少能力证据 |
| tags 表与 exports 目录 | schema/目录预留，无 API/service/UI |
| UI E2E 覆盖缺口和 Windows SQLite capability gate 清单 | 后续工程 work 候选，不是当前领域定义 |
| 根 `<Path>RESEARCH.md</Path>` 与 `<Path>IMPLEMENTATION_PLAN.md</Path>` 的已替代 V1/早期架构内容 | 历史背景，脱离上下文会误导 |
| 临时 OpenAPI 3.0 transform 的“何时删除”推测 | 过渡工具细节；当前存在性只保留在 ADR consequence |

## 8. Cleanup Candidates

已扫描 `<Path>{roots.state}/specdev/adr/</Path>`、`<Path>{roots.state}/specdev/context/</Path>` 与 `<Path>{roots.state}/specdev/research/</Path>`；三者均为空。

| Classification | Count | Action |
|---|---:|---|
| delete | 0 | none |
| merge | 0 | none |
| rewrite | 0 | none |
| keep | 0 | none |
| needs-confirmation | 0 | none |

不会修改或删除 `<Path>docs/decisions/</Path>`；它们继续作为项目历史来源，永久 ADR 提供当前权威版本。

## 9. Confirmed Execution Order

只有用户明确批准本报告后执行：

1. 重新验证 source、target、全局/change 状态和三个 knowledge stores 无 drift。
2. 原子移动 completed change 到 2026-09 archive，并更新 change/global 状态。
3. 创建 12 份永久 ADR，写入 Accepted、日期、来源 change、Context、Decision、Trade-off、Consequences 和 Verification/Risk。
4. 创建 8 份永久 context 文件，写入最小来源 frontmatter、32 个术语、Context Map 与 INDEX。
5. 不执行任何 cleanup、Git 或远程动作。
6. 重读 source/target/status/knowledge stores，运行 `--stage complete` 与包级 `--self-check`，把执行验证补遗追加到本报告。

## 10. Summary

- 待归档 change：1
- 待创建永久 ADR：12
- 待创建永久 context 文件：8（32 术语 + Context Map + INDEX）
- 待写 research：0
- 待清理：0
- 历史语义修订确认点：5
- 破坏性动作：1 次目录移动 + 2 个状态文件改写
- Git/远程动作：0

**除持久化本报告外，未修改永久知识、未移动 change、未更新 archived 索引、未删除或改写既有文件。此为 dry-run 计划，请确认后执行。**

## 11. Execution Verification - 2026-09-02

用户明确回复“执行”，批准本 dry-run 的完整计划及第 6 节五项 B 修订。确认后执行结果如下：

1. 漂移预检通过：源 change 唯一存在、目标不存在、全局状态与 change 完成态匹配、永久 ADR/context/research 均为空，dry-run SHA-256 仍为 `37E66687315845EB49871FD9CFDFE2026EFF5CA424B651F439FDFEBB2DA9F9AA`。
2. change 已从 `<Path>{roots.state}/specdev/changes/2026-09-02-consolidate-project-knowledge/</Path>` 原子移动到 `<Path>{roots.state}/specdev/archive/2026-09/2026-09-02-consolidate-project-knowledge/</Path>`。重读确认源不存在、目标存在。
3. 全局状态已移除该 active change 并加入 archived；归档 `.status.json` 已设置 `change_status=archived`、`archived=true` 和归档路径，保留原 `completed_at`。
4. ADR-0001 至 ADR-0012 全部提升，共 12/12 份；五项历史语义差异均按批准的 B 方案写入事实边界和残余风险。
5. Context 全部提升，共 8/8 份：INDEX、6 个主题文件和 Context Map；包含 32 个规范术语。全部 ADR/context 文件均带 `source_change` 与 `promoted_at`。
6. Ephemeral 表列出的过程、验证快照、缺口、预留能力和已替代早期架构全部跳过；research 写入 0；cleanup 0；未修改 `<Path>docs/decisions/</Path>`。
7. 归档前 `--stage complete --repo .` 已通过，结果为 0 errors / 0 warnings。归档后按合同再次运行同一 stage 命令，校验器因归档状态不是 `completed` 返回 1 error，并同时给出 archived-in-place warning；这是 `--stage complete` 与 `change_status=archived` 的终态规则冲突。随后运行无 stage 的归档态校验通过，结果为 0 errors / 1 archived-in-place warning。
8. SpecDev 包级 `--self-check` 通过，结果为 0 errors / 0 warnings。JSON 解析、文件数量、来源元数据、UTF-8 内容、source/target 和两个状态账本均已重读验证。
9. 未执行 Git commit、分支、远程或源码清理动作。

最终永久知识入口：`<Path>{roots.state}/specdev/context/INDEX.md</Path>`；永久架构决策目录：`<Path>{roots.state}/specdev/adr/</Path>`。
