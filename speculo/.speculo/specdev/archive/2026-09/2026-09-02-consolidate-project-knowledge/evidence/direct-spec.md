# Evidence: Direct Spec - Personal Workbench 全局知识沉淀

- **Change：** `2026-09-02-consolidate-project-knowledge`
- **Ticket：** 不适用，非实现型 A Work consolidation
- **Spec：** `<Path>{roots.state}/specdev/changes/2026-09-02-consolidate-project-knowledge/spec.md</Path>`
- **Goal Plan：** 不适用
- **Lead：** `codex-root`
- **Workspace/branch：** `current` / `main`
- **Base/implementation-or-source/candidate/result SHA：** `fbf9033` / `working-tree` / `not-applicable` / `working-tree`
- **状态：** done

## 1. 实现摘要

以只读 agent team 和 Lead 交叉审计形成完整项目理解：审计 8 份历史 ADR，修订 5 项事实范围，补齐 4 项代码/需求已固化的重大决定，建立 Workspace Runtime、Archive、Planning、Retrieval、Data Safety 与 Compatibility 规范语言和 Context Map。未修改产品代码和原项目文档，永久 namespace 尚未写入。

## 2. Lead Dispatch And Candidate Return

- **Implementation owner：** Lead（仅 Speculo 状态工件 writer）
- **Dispatch Packet/checkpoint：** 3 个只读 agent，输入为当前 working tree 与 `fbf9033`
- **允许动作：** 只读仓库、返回 ADR 审计/代码架构/领域上下文 findings；禁止写文件
- **返回：** 每组返回项目相对路径、行号、文档主张/代码事实/测试证据区分和残余风险
- **Lead 独立核对：** pass；重读关键 Rust/Go/React/OpenAPI/migration/CI 路径并运行本地验证
- **只读 Agent findings：** ADR agent 识别 002/003/004/005/007 修订边界；architecture agent 核验进程、数据、安全与测试；domain agent 建立 bounded contexts、术语和非能力清单。Lead 已逐项纳入或裁决。

## 3. 修改范围与路径所有权

| 路径 | 所有权 | 改动目的 |
|---|---|---|
| `<Path>speculo/.speculo/specdev/status.json</Path>` | shared:`codex-root` | 登记 active consolidation change |
| `<Path>speculo/.speculo/specdev/changes/2026-09-02-consolidate-project-knowledge/**</Path>` | writable | LOG、CONTEXT、ADR、Spec、Evidence 与状态 |
| `<Path>speculo/.speculo/specdev/adr/</Path>` | read-only until confirmed | 永久 ADR 目标 |
| `<Path>speculo/.speculo/specdev/context/</Path>` | read-only until confirmed | 永久领域上下文目标 |

- **read-only 修改：** 无
- **未声明路径：** 无
- **生成文件/锁文件：** 无

## 4. 验收与合同映射

| Contract / Acceptance ID | 验证接缝 | 证据 | 结果 |
|---|---|---|---|
| KAC-001 | ADR matrix 与代码重读 | `<Path>{roots.state}/specdev/changes/2026-09-02-consolidate-project-knowledge/ADR.md</Path>`、LOG-003/004 | pass |
| KAC-002 | 领域模型、API、UI 与测试重读 | `<Path>{roots.state}/specdev/changes/2026-09-02-consolidate-project-knowledge/CONTEXT.md</Path>`、LOG-005 | pass |
| KAC-003 | 文档/代码差异审计 | LOG-006；未把 Calendar range、fuzzy ranking、tags、exports 等写成当前能力 | pass |
| KAC-004 | 当前 workspace 命令 | 测试、契约与静态检查摘要见 §5 | pass |

## 5. Workspace Verification

| 命令或步骤 | 运行环境 | 结果 | 摘要 |
|---|---|---|---|
| `pnpm test` | current-workspace, Windows | pass | Frontend 2 files/5 tests；Go 全部 packages；Rust 7 tests |
| `pnpm check:contract` | current-workspace, Windows | pass | OpenAPI 3.1 lint passed |
| `pnpm --dir apps/desktop format:check` | current-workspace, Windows | pass | Prettier all matched |
| `pnpm --dir apps/desktop lint` | current-workspace, Windows | pass | ESLint 0 warnings/errors |
| `pnpm --dir apps/desktop typecheck` | current-workspace, Windows | pass | TypeScript build-mode typecheck passed |
| `node scripts/go.mjs -C services/workbenchd vet ./...` | current-workspace, Windows | pass | Go vet passed |
| `cargo fmt --all -- --check` | current-workspace, Windows | pass | Rust format passed |
| `cargo clippy --workspace --all-targets -- -D warnings` | current-workspace, Windows | pass | Rust clippy passed |
| `node speculo/workflows/specdev/common/tools/validate-specdev.mjs --self-check` | current-workspace, Windows | pass | package self-check 0 errors/0 warnings |

- **失败后修复与重跑：** 无。
- **未运行检查：** Playwright E2E、installer smoke、完整 frontend/sidecar release build；本 change 未修改产品代码，且这些高成本检查不是知识文件结构的必要门。
- **E2E：** not-required for this non-product consolidation；仓库已有单个跨 viewport 主流程，但本次未运行。
- **环境提示：** 当前 Node 22.x 低于 `<Path>package.json</Path>` 声明的 Node >=24，pnpm 给出 unsupported engine warning；上述命令仍实际通过。

## 6. 双轴审查

### 标准轴

- **固定输入：** `fbf9033` + 当前用户 dirty working tree；只审计、不改产品文件
- **结果：** pass
- **Findings 与修正：** 将过时/过宽 ADR 表述改为当前可验证范围；将普通实现细节与未实现需求排除出永久知识候选。

### 规范轴

- **固定输入与来源：** A Work、consolidation interview、artifact/path/change completion contracts、archive-and-consolidate skill、用户目标
- **结果：** pass
- **Findings 与修正：** 使用 active change 而非直接写永久目录；保留 dry-run/confirmed 两阶段门；LOG、CONTEXT、ADR 权威边界分离。

## 7. Integration Verification

| 项目 | 结果 |
|---|---|
| Parent before SHA | `fbf9033` |
| Implementation/source SHA | `not-applicable` / `working-tree` |
| Candidate branch/workspace | current / not-applicable |
| Method/conflicts | not-applicable；无产品代码集成 |
| Integration checks | current-workspace 工件重读与 SpecDev validator |
| E2E disposition | not-required: 非产品代码变更 |
| E2E result | not-required |
| Parent result/re-read | `fbf9033` 保持；Speculo working-tree 工件重读 |

## 8. 偏差与决策

- **偏差：** 无未批准 workflow 偏差；项目自身 ADR 与实现差异记录在 LOG-003/006 和候选 ADR Consequences。
- **记录：** `<Path>{roots.state}/specdev/changes/2026-09-02-consolidate-project-knowledge/LOG.md</Path>`
- **批准来源及影响：** 用户授权深度审计与形成永久知识；永久写入与归档仍等待 dry-run 后计划级明确批准。

## 9. 残余风险与交付定位

- **残余风险/已知限制：** Node 版本低于声明基线；未运行 E2E/installer/release；SQLite Windows capability gate、Go OpenAPI runtime conformance、UUIDv7 fallback 和平台签名实际产物仍需后续专项 change/CI 证据。
- **后续 Ticket：** 无；这些是可独立处理的后续 change 候选。
- **监控或回滚触发：** confirmed 执行前若 change、永久 store 或全局状态 drift，则放弃旧计划并重新 dry-run。
- **Source commit：** `not-applicable`
- **Parent result：** `fbf9033`（未改 Git 历史）
- **Source workspace：** `current`
- **Evidence：** `<Path>{roots.state}/specdev/changes/2026-09-02-consolidate-project-knowledge/evidence/direct-spec.md</Path>`
