---
schema_version: 3
artifact: spec
change: 2026-09-02-consolidate-project-knowledge
status: ready
ready_for_tickets: false
sources:
  - "USER-DECISION:深度理解当前项目并将已有全局 ADR 与领域上下文沉淀到 Speculo"
  - "CODE:<Path>docs/decisions/</Path>"
  - "CODE:<Path>README.md</Path>"
---

# Spec: Personal Workbench 全局知识沉淀

- **Spec：** `<Path>{roots.state}/specdev/changes/2026-09-02-consolidate-project-knowledge/spec.md</Path>`
- **当前 ADR：** `<Path>{roots.state}/specdev/changes/2026-09-02-consolidate-project-knowledge/ADR.md</Path>`
- **当前领域上下文：** `<Path>{roots.state}/specdev/changes/2026-09-02-consolidate-project-knowledge/CONTEXT.md</Path>`

## 1. 问题与目标

### 问题陈述

架构和领域知识分散于 8 份极短 ADR、早期研究、V2 文档、代码、schema、测试与发布配置中。历史文档含已被 V2 替代的表述，现有 ADR 又缺少状态、取舍、后果与验证边界，无法直接作为当前长期知识。

### 目标用户与场景

后续维护者、规划者和 SpecDev change 在开始新工作时，需要无需重读整个仓库即可取得当前系统边界、规范术语、关键架构取舍及已知验证限制。

### 成功标准

- 全量审计 `<Path>docs/decisions/</Path>` 并对照当前代码、配置、schema 与测试。
- 形成只描述当前真相的 bounded context、规范术语和 Context Map。
- 只保留满足难逆转、非显然、真实权衡三项准入的 ADR，并披露偏离与残余风险。
- 形成精确到目标文件的永久知识映射，供 change 完成后的 A Work dry-run 使用。

### 非目标

- 不修改产品代码、原项目 ADR 或需求文档。
- 不修复审计发现的实现/测试缺口。
- 不在用户批准 dry-run 前写入永久知识、移动 change、删除或改写历史。

## 2. 解决方案与外部行为

### 解决方案摘要

以 agent team 三条独立证据线审计历史 ADR、当前代码架构和领域语义，由 Lead 交叉验证并按 LOG、CONTEXT、ADR 顺序形成候选；完成本地验证和知识毕业评估后进入 A Work dry-run。

### 主要流程

1. 冻结当前仓库、V2 文档和 8 份 ADR 的事实清单。
2. 对每项结论区分文档主张、代码事实、测试源码与本次实际验证。
3. 修订过宽或过时 ADR，补齐代码中已固化但未编号的重大决定。
4. 将能力缺口、预留结构和未运行验证留在 LOG/Evidence。
5. 生成永久 `adr/` 与 `context/` 目标清单和 archive-single dry-run。

### 边界、失败与稳定错误行为

无法由代码或实际行为验证的结论不提升；与当前实现冲突的历史 ADR 不原样提升；dry-run 后若源、目标或状态发生 drift，confirmed 阶段必须停止并重新规划。

### 状态转换与不变量

候选知识先存在 active change；change 完成后仍不自动写永久 namespace；只有完整 dry-run 得到用户明确批准，才执行永久写入、归档移动和状态转换。

## 3. 用户故事

- **US-001**：作为后续维护者，我希望读取精炼且有当前证据的架构与领域知识，以便在新 change 中不重新推断或误用已过时计划。

## 4. 验收合同

| ID | 前置条件 | 动作或事件 | 可观察结果 | 验证接缝 |
|---|---|---|---|---|
| KAC-001 | 8 份历史 ADR 与当前代码可读 | 完成逐项审计 | 每项有当前状态、修订边界、取舍、后果和证据；无原样复制的过时表述 | `<Path>{roots.state}/specdev/changes/2026-09-02-consolidate-project-knowledge/ADR.md</Path>` |
| KAC-002 | 当前领域实现可读 | 抽取 bounded contexts | 规范术语、一词多义、Context Map 与禁止同义词覆盖当前核心系统 | `<Path>{roots.state}/specdev/changes/2026-09-02-consolidate-project-knowledge/CONTEXT.md</Path>` |
| KAC-003 | 存在需求主张或 schema 预留 | 应用当前真相门 | 未实现/未验证能力只进入 LOG/Evidence，不写成永久当前能力 | `<Path>{roots.state}/specdev/changes/2026-09-02-consolidate-project-knowledge/LOG.md</Path>` |
| KAC-004 | 候选知识已完成 | 运行项目与 SpecDev 验证 | 实际命令、结果、环境限制和未运行项可重建 | `<Path>{roots.state}/specdev/changes/2026-09-02-consolidate-project-knowledge/evidence/direct-spec.md</Path>` |

## 5. 范围

### IN

- `<Path>docs/decisions/</Path>` 全部 ADR。
- 当前 README、V2 requirements/plan、OpenAPI、Rust/Go/React 实现、migration、测试和 CI/release 配置。
- Speculo change 工件、完成验证、知识毕业和 dry-run。

### REUSE

- A Work、代码库沉淀访谈协议、LOG/CONTEXT/ADR 格式、路径合同、change completion 和全局 archive-and-consolidate skill。

### OUT

- **OOS-001**：产品代码修复，由后续独立 change 处理。
- **OOS-002**：运行 Playwright、安装器 smoke 或真实发布，本次只读沉淀不改变外部系统。
- **OOS-003**：在批准前写永久 namespace 或移动归档。

## 6. 已锁定实现约束

- **DEC-001**：当前代码、配置、schema、测试和经验证 V2 文档优先于早期研究/计划。来源：LOG-002。
- **DEC-002**：只提升当前、跨 change 有用且有实现证据的知识。来源：LOG-001。
- **DEC-003**：永久 ADR 一项一文件，永久 context 按 bounded context 拆分并建立 INDEX/Context Map。来源：LOG-004、LOG-005。

## 7. 数据、接口与兼容

- **公共接口变化：** 无。
- **数据模型与持久化：** 只写 Speculo change 工件；confirmed 前不写永久知识。
- **兼容要求：** 永久知识使用四位 ADR 编号并保留 supersedes/来源关系。
- **迁移要求：** 无产品数据迁移；A confirmed 阶段负责 change 归档与状态 schema 更新。
- **发布或运维影响：** 无。

## 8. 非功能要求

- **NFR-001 安全与隐私：** 不把 token、用户数据内容或机器绝对路径写入永久知识。
- **NFR-002 性能与容量：** 不适用：本 change 只处理有限 Markdown 工件。
- **NFR-003 可用性与可靠性：** 所有结论可从项目相对路径和重复命令重建；dry-run/confirmed 严格分离。
- **NFR-004 可观测性与运营：** LOG 保留取舍轨迹，Evidence 保留实际命令与残余风险。

## 9. 验证策略

| 接缝 | 层级 | 覆盖合同 | 现有先例或命令 | Evidence 类型 |
|---|---|---|---|---|
| 历史 ADR 对当前代码 | 静态交叉审计 | KAC-001, KAC-003 | agent team + Lead 逐路径重读 | findings matrix |
| 项目单元/集成测试 | frontend/Go/Rust | KAC-004 | `pnpm test` | 命令输出摘要 |
| 契约与静态质量 | OpenAPI/TS/Go/Rust | KAC-004 | contract lint、format、lint、typecheck、vet、fmt、clippy | 命令输出摘要 |
| SpecDev 工件 | workflow validation | KAC-004 | `validate-specdev.mjs --stage complete` 与 `--self-check` | validator result |
| 归档与知识提升 | A Work 后续阶段 | 不属于 consolidation change 验收 | archive-single + generic dry-run | 精确计划表 |

## 10. 风险、假设与未决问题

### 风险

- 历史 ADR 是单段无状态文档，修订版必须明确哪些是当前事实、哪些是能力合同或残余风险。
- 当前 Node 22.x 低于项目声明的 Node >=24；本次已运行命令通过，但不是受支持工具链的完整证明。
- Playwright、installer smoke 与 release build 未在本次运行，不能宣称桌面/发布链已由本次验证。

### 已采用的低影响假设

- 用户要求写入永久知识构成对沉淀目标的授权，但 A Work 仍要求在完整 dry-run 后取得一次计划级明确批准。
- 已提交在 `main` 且由当前代码实现的 V2 requirements 可作为历史已接受决定的来源。

### 未决问题

无。永久写入的最终批准由 A dry-run 门单独取得，不阻止本 consolidation change 形成并完成。
