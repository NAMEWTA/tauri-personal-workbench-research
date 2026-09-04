# 项目知识沉淀日志

## LOG-001 - 2026-09-02 - 沉淀范围与证据原则
- **设计树节点：** 不适用
- **轮次与依赖：** round 1 / 无
- **状态：** confirmed
- **问题：** 本次 consolidation 应覆盖哪些现有知识，并以什么作为当前真相。
- **事实与来源：** 用户要求深度理解当前项目，特别审计 `<Path>docs/decisions/</Path>`，并参考 A Work 将全局 ADR 与领域上下文沉淀到 Speculo 永久知识目录；代码访谈协议规定代码、配置、接口、schema、测试和经验证文档优先。
- **选项：** 仅复制历史 ADR；或综合历史 ADR、当前代码、配置、测试和项目文档后形成当前知识。
- **推荐：** 采用综合审计；历史 ADR 表达决策意图，当前代码与测试验证决策是否仍然成立。
- **结论：** 对全部现有 ADR、当前代码、配置、测试及核心项目文档进行全局审计，只提升当前仍真实、跨 change 有用且证据充分的知识。
- **原因：** 直接复制会保留过时、重复或仅有历史叙事的内容，无法满足永久知识的当前真相要求。
- **影响工件：** CONTEXT / ADR
- **约束或不变量：** 永久 namespace 仅在完成、毕业评估、dry-run 展示和用户确认后写入。
- **后续：** Lead 汇总 agent team 的独立审计结果并逐项交叉验证。
- **替代/被替代：** 无

## LOG-002 - 2026-09-02 - 当前事实的文档优先级
- **设计树节点：** 不适用
- **轮次与依赖：** round 2 / LOG-001
- **状态：** confirmed
- **问题：** 早期研究、根实施计划、V2 文档和当前实现冲突时如何裁决。
- **事实与来源：** `<Path>README.md</Path>` 明确把 `<Path>RESEARCH.md</Path>` 与 `<Path>IMPLEMENTATION_PLAN.md</Path>` 定位为早期研究，把 `<Path>docs/V2_REQUIREMENTS.md</Path>`、`<Path>docs/IMPLEMENTATION_PLAN_V2.md</Path>` 与代码定位为当前 V2；V2 实施清单已全部完成。
- **选项：** 以早期计划为架构基线；或以 V2 合同与当前代码/测试为当前事实、以早期材料恢复历史动机。
- **推荐：** 采用后者。
- **结论：** 当前真相按 V2 文档、代码、配置、schema、测试排序；早期材料只用于解释替代方案和取舍，不提升其中已被 V2 替代的 `/api/v1`、独立 CalendarEvent、固定档案类别和仅 Windows 首发等内容。
- **原因：** 永久知识必须描述当前系统，而不是最初施工计划。
- **影响工件：** CONTEXT / ADR
- **约束或不变量：** 历史来源仍保留在归档 change 与原项目文档中。
- **后续：** 无。
- **替代/被替代：** 无

## LOG-003 - 2026-09-02 - 历史 ADR 的当前状态
- **设计树节点：** 不适用
- **轮次与依赖：** round 3 / LOG-001, LOG-002
- **状态：** confirmed
- **问题：** `<Path>docs/decisions/</Path>` 的 8 份短 ADR 是否可以原样成为永久 ADR。
- **事实与来源：** 8 份文件均无 Status、Context、Trade-off、Consequences 或 supersedes；代码审计显示 ADR-001/006/008 基本落地，ADR-002/003/004/005/007 存在措辞过宽、验证不足或发布事实演进。
- **选项：** 原样复制；全部拒绝；或保留已接受的核心取舍并按当前代码修订可验证边界。
- **推荐：** 修订后提升。
- **结论：** 8 项核心取舍仍跨 change 有用，但不能原样复制。token 生命周期按 Bootstrap 会话表述；SQLite gate 不宣称已全量证明；OpenAPI 披露手写 Go server 边界；ID 说明 UUIDv4 fallback 与 seed slug；发布模型纳入 macOS ad-hoc DMG 并把 portable ZIP 限定为本地流程。
- **原因：** 这些修订只纠正事实范围，不发明新架构方向。
- **影响工件：** ADR
- **约束或不变量：** 实现偏差和验证缺口必须进入 ADR Consequences/Evidence，不得伪装成已通过。
- **后续：** ADR-007 修订版随完整 dry-run 单独接受确认。
- **替代/被替代：** 无

## LOG-004 - 2026-09-02 - 从 V2 与代码补齐隐式 ADR
- **设计树节点：** 不适用
- **轮次与依赖：** round 4 / LOG-002
- **状态：** confirmed
- **问题：** 哪些没有进入 `<Path>docs/decisions/</Path>` 的现行决定满足永久 ADR 三项准入。
- **事实与来源：** `<Path>docs/V2_REQUIREMENTS.md</Path>` 明确统一 Task/Calendar、用户管理 Archive Schema 与不兼容 V1；`<Path>README.md</Path>` 和工作区锁实现明确普通目录工作区与单 writer。
- **选项：** 只提升已有编号 ADR；或补齐难逆转、非显然且有真实替代方案的现行决定。
- **推荐：** 补齐四项。
- **结论：** 任务/日历统一模型、用户定义档案 Schema、V2 开发重置且不兼容 V1、可搬移工作区与单写者锁均通过准入，形成 ADR-009 至 ADR-012 候选。
- **原因：** 四项都改变数据模型或兼容边界，维护者缺少背景时容易误改，并且存在被明确放弃的可行替代方案。
- **影响工件：** ADR / CONTEXT
- **约束或不变量：** 普通路由、组件拆分、样式和预留表不提升为 ADR。
- **后续：** 在 dry-run 中逐项展示毕业理由。
- **替代/被替代：** 无

## LOG-005 - 2026-09-02 - Bounded Context 与规范术语
- **设计树节点：** 不适用
- **轮次与依赖：** round 5 / LOG-001, LOG-002
- **状态：** confirmed
- **问题：** 哪些概念需要成为跨 change 的规范语言。
- **事实与来源：** API、migration、Go model/repository、React route/editor 与测试共同显示 Workspace Runtime、Archive、Planning、Retrieval、Data Safety 五个主要业务/运行 context，以及 Compatibility 边界。
- **选项：** 按技术目录写代码导航；或按稳定领域边界定义术语与 Context Map。
- **推荐：** 按领域边界。
- **结论：** CONTEXT 只定义稳定术语和跨 context 关系；敏感字段明确不是加密，事件档案明确不是 CalendarEvent，附件当前明确只属于档案，删除区分回收站语义与结构删除。
- **原因：** 这些一词多义和边界最容易导致后续需求、Spec 与实现误解。
- **影响工件：** CONTEXT
- **约束或不变量：** 代码路径、owner、验证日期、路线图与缺口不进入永久 context。
- **后续：** 提升时拆为 INDEX、五个 bounded context、compatibility 和 Context Map 文件。
- **替代/被替代：** 无

## LOG-006 - 2026-09-02 - 不提升的主张与预留能力
- **设计树节点：** 不适用
- **轮次与依赖：** round 6 / LOG-002, LOG-005
- **状态：** confirmed
- **问题：** 哪些项目表述缺少当前实现证据，必须留在归档而不进入永久当前知识。
- **事实与来源：** Calendar 没有 range select handler；ArchivePicker 使用 debounce 加 SQL LIKE 而非 fuzzy ranking；Tasks 筛选按钮无行为；tags 表和 exports 目录无 API/service/UI；Go strict server 未接入；UI E2E 只有一个宽主流程场景。
- **选项：** 按需求文档声明为现有能力；或以实现为准标记为 gap/reserved。
- **推荐：** 不提升。
- **结论：** 日历范围创建预填、真正 fuzzy archive search、任务筛选、tags、export、完整 Go OpenAPI runtime enforcement 与全面 UI E2E 覆盖均不作为当前永久能力。
- **原因：** schema/目录预留和需求文字不是运行能力证据。
- **影响工件：** LOG / Evidence
- **约束或不变量：** 后续实现通过新 change 形成证据后才能更新永久知识。
- **后续：** 无。
- **替代/被替代：** 无

## LOG-007 - 2026-09-02 - 本地验证结果
- **设计树节点：** 不适用
- **轮次与依赖：** round 7 / LOG-003, LOG-004, LOG-005, LOG-006
- **状态：** confirmed
- **问题：** 当前工作树是否提供足够证据支持候选知识和 change 完成。
- **事实与来源：** `pnpm test` 通过前端 5 tests、全部 Go packages 和 Rust 7 tests；OpenAPI lint、前端 format/lint/typecheck、Go vet、Rust fmt/clippy、SpecDev self-check 全部通过。
- **选项：** 只依赖静态阅读；或结合可重复本地验证并披露未运行项。
- **推荐：** 后者。
- **结论：** 候选知识有静态与测试证据；未运行 Playwright E2E、installer smoke 和完整 release build。当前 Node 为 22.x，低于项目声明的 Node >=24，虽然已运行命令通过，仍记录为环境残余风险。
- **原因：** 归档知识必须区分“仓库有测试”“本次实际通过”和“本次未验证”。
- **影响工件：** Evidence
- **约束或不变量：** 不把未运行的 E2E/安装/发布验证写成 passed。
- **后续：** 生成知识毕业与归档 dry-run。
- **替代/被替代：** 无
