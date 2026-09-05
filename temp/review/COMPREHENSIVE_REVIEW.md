# Personal Workbench 全面 Review 报告

审查日期：2026-09-05  
审查范围：当前工作树中的 React/Tauri 前端、Rust 宿主、Go sidecar/API/SQLite、脚本、CI、OpenAPI 与项目文档。  
Speculo 状态：`speculo/.speculo/workspace.json`、`speculo/config.json` 及 learning/specdev 入口均存在且可读取。

## 结论

当前代码已经形成可运行的 Tauri + React + Go + SQLite 链路，基础格式、类型检查、Go 测试、Rust 测试和 OpenAPI lint 均有自动化覆盖。但不建议按当前状态作为正式首发：存在多个会导致数据/日期/提醒错误的 P1 bug，SQLite 连接初始化会使外键约束不可靠；同时发布文档混用了 0.2.7、0.2.9、API v1、API v3 和实现前 schema，维护者按文档操作可能得到 404 或错误数据库结构。全新发布要求也与现有 localStorage legacy migration 相冲突。

## P1：发布前必须修复

### 1. SQLite 外键和连接级 PRAGMA 不可靠

`services/workbenchd/internal/storage/sqlite/store.go:52-72` 将连接池设置为最多 4 个连接，但只在初始化时对当时取得的连接执行 `foreign_keys=ON`、`busy_timeout`、`synchronous` 等 PRAGMA。SQLite 的 `foreign_keys` 等设置按连接生效，后续连接可能没有外键约束，导致悬空 `archive_id`/`parent_id`、CASCADE 和完整性行为随机化。应使用每连接初始化的 Connector/DSN，或将池限制为单连接并验证每个连接的配置。

### 2. “今日/明日”任务筛选错误

`services/workbenchd/internal/storage/sqlite/tasks.go:29-46`：`today` 条件把 `ends_at < todayEnd` 当作今日条件，过去已经结束但未完成的任务会被列入今天；`tomorrow` 的 `due_on` 使用 `tomorrowEnd` 的日期，实际得到后天日期。应统一采用时间区间交集 `starts_at < rangeEnd AND ends_at > rangeStart`，并分别使用今天/明天的本地日期。

### 3. 附件导入可生成永久孤儿数据

`services/workbenchd/internal/attachment/manager.go:64-100` 直接把请求的 `entityID` 写入附件表，没有在同一事务中确认档案存在且未删除；`internal/app/service.go:278-282` 又以异步 job 调用该路径。任意不存在的 `recordId` 都可能导入文件并写入 change log，但之后列表、搜索都不可见。应在事务内校验归属实体，并对不存在/已删除实体返回 404/validation。

### 4. 附件大小限制可被 TOCTOU 绕过

`services/workbenchd/internal/attachment/manager.go:117-166,232-256` 只检查复制前的 `Stat().Size()`，`copyContext` 没有累计大小上限。源文件在复制过程中增长时可超过 1 GiB，造成磁盘耗尽。复制循环必须强制 `maxFileSize`，超限立即取消并清理临时文件。

### 5. 提醒权限拒绝后不会重试

`apps/desktop/src/features/tasks/ReminderScheduler.tsx:23-28` 先把提醒 key 加入 `notified`，再检查 `Notification.permission`。用户首次拒绝或权限仍为 default 时，提醒会被永久标记；之后授予权限也不会弹出。只有真正创建通知成功后才应标记，或按权限状态重新排队。

## P2：高概率行为问题与安全/稳定性风险

- 自定义字段默认值绕过类型和选项校验：`services/workbenchd/internal/storage/sqlite/archives.go:179-186` 直接写入 `DefaultValue`；`archive_types.go:107-145` 的 create/update 也没有确保 default 与 `ValueType/Options` 一致。会把非法 number/select/date 写入数据库。
- 集合删除条件错误且破坏软删除语义：`services/workbenchd/internal/storage/sqlite/archive_types.go:84-104` 统计未过滤 `deleted_at`，历史回收记录会永久阻止删除；随后又直接硬删 collection/fields。应统一 active-record 规则和软删除策略。
- 父子任务关系只依赖不可靠外键：`services/workbenchd/internal/storage/sqlite/tasks.go` 的 create/update 未校验 parent 存在、未删除、自环或环路；外键失效时可形成悬空/循环层级。
- API 分页边界不足：`services/workbenchd/internal/api/server.go:145-153,657-663` 接受负数和超大 `limit/offset`，可能触发高成本扫描。应设置上限并把非法值转为 validation error。
- Job 持久化错误被吞掉：`services/workbenchd/internal/job/manager.go:162-176` 忽略 `m.persist` 错误，内存/SSE 可显示成功而重启后状态丢失。应记录并将持久化失败反映为任务失败。
- 损坏的 reminders JSON 被静默变为空数组：`services/workbenchd/internal/storage/sqlite/tasks.go:261-266` 忽略反序列化错误，数据损坏不可见。
- recurrence 只检查长度，不校验 RRULE；`tasks.go` 只实现 DAILY/WEEKLY/MONTHLY，其他规则完成任务时静默失效。应拒绝不支持的规则或实现统一解析器。
- 附件资源不存在语义不一致：`attachment/manager.go:38-40` 对不存在/已删除 record 返回空数组，而 relations 路径会先校验并返回 404。
- 归档详情变更未刷新今日页：`apps/desktop/src/features/archives/ArchiveDetailPage.tsx:47-65` 只失效 archive keys，不失效 `['dashboard']`；由于关闭了 focus refetch，今日页可能长期显示旧标题/已删除档案。
- 日历漏显示已完成任务：`apps/desktop/src/features/calendar/CalendarPage.tsx:35-45` 请求 `view:'all'`，但后端 `tasks.go:33-36` 对 all 过滤 `status<>'done'`。
- 命令面板无 debounce/cancel：`apps/desktop/src/components/layout/CommandPalette.tsx:28-33` 每次按键直接请求，快速输入会产生请求风暴，旧响应可能覆盖新结果。项目已有 `useDebouncedValue`，应复用。
- 今日页日期在模块加载时冻结：`apps/desktop/src/features/today/TodayPage.tsx:13-18` 跨午夜后仍显示旧日期；应在组件内计算并监听日切。
- `theme=system` 不监听系统主题变化：`apps/desktop/src/components/layout/AppShell.tsx:176-180` 只在 state 变化时读取 `matchMedia`。
- 错误详情直接展示：`apps/desktop/src/components/ui/StateView.tsx:22-27`、`RootErrorBoundary.tsx:20-24` 直接渲染 `Error.message`，后端错误可能包含路径/SQL/内部细节。应统一安全错误映射，详细信息只进入受控诊断日志。
- 偏好 debounce 在卸载时直接清 timer：`AppShell.tsx:89-115` 关闭窗口/切换工作区时可能丢最后一次布局变更。

## 架构、复用性和规范

1. `services/workbenchd/internal/app/service.go:58-180` 是大型 Repository/Facade，聚合 archive、task、attachment、backup、search、job 等近 30 个转发方法；建议按领域拆分接口，减少 mock 面积和跨域耦合。
2. `internal/api/server.go` 大量重复 decode、validation、error mapping；可抽取统一 handler helper/middleware。
3. OpenAPI 同时生成 `internal/api/generated/api.gen.go`，但真实路由仍由 `server.go:35-98` 手写，生成 strict server 没有挂载。这样会让 OpenAPI、DTO、路由和校验逐步漂移，应选择生成接口作为唯一入口，或删除无用生成 server 并明确只生成模型/客户端。
4. 前端 query key、mutation invalidation 散落在页面和 feature 中；应由领域 hooks 导出统一 key/invalidation helper，避免遗漏 dashboard、archive、task 等关联缓存。
5. `apps/desktop/src/generated/api/client.gen.ts` 与 `src/generated/api/client/` 存在双层生成入口，应确认生成器输出并删除未使用入口，避免维护者误用。
6. 路由只有 Calendar 使用 lazy，其余页面 eager import；与计划中的首屏分包不一致，备份/档案等重模块会进入首屏 bundle。
7. 中文注释整体克制，未发现大段无效注释；但 Rust 中有少量英文说明，建议在发布文档/代码注释中统一约定。

## 旧兼容代码

全新发布不需要兼容旧版本时，应删除：

- `apps/desktop/src/features/settings/legacy-preferences.ts`
- `legacy-preferences.test.ts`
- `AppShell.tsx:119-174` 的 localStorage 迁移、清理和 invalid payload 分支
- E2E 中 seeded legacy preference 夹具

保留这些路径会继续读取和修改旧 localStorage 状态，增加覆盖顺序和数据迁移风险，与“SQLite preferences 单一来源”冲突。

## 文档与发布材料

### P1 文档错误

- `IMPLEMENTATION_PLAN.md` 仍写“尚未创建应用代码”，并保留 Spike、PR1-3、migration 001 前置流程；其 schema 仍是 `archive_types/archives/calendar_events/tags`，实际为 `archive_collections/archive_records`。
- `RESEARCH.md` 声称当前有效，却仍描述 `/api/v1`、候选 modernc、待执行 Spike 和 Windows-only 目标。当前实现和 OpenAPI 使用 `/api/v3`；按旧文档集成会直接 404。
- `docs/V2_ACCEPTANCE.md:20,22,65` 使用 0.2.7 版本/旧哈希，当前 package/Tauri/sidecar 版本为 0.2.9；同时把 macOS 证据标为待 CI 执行，却作为验收记录发布。
- `V2_ACCEPTANCE.md` 还记录旧 localStorage 兼容流程，和当前全新发布要求冲突。

### P2 文档冗余/规范

- `docs/IMPLEMENTATION_PLAN_V2.md` 全部标记完成但没有证据，已被代码和验收材料替代。
- `README.md:65` 仍称“V2 处于开发阶段”，并把旧计划/研究作为入口；应改为当前 0.2.9 发布状态和唯一架构文档入口。
- `api/openapi.yaml:4` 的 `info.version` 为 0.2.0，而应用为 0.2.9；应明确 schema 版本与应用版本的关系或统一审计口径。
- `docs/CI_CD.md` 使用漂移的 `macos-latest` 环境描述和 `v0.2.0` 示例，需改成可复核的 workflow/commit 证据。
- 根 `docs/decisions/ADR-001..008` 只有三行，且与 `speculo/.speculo/specdev/adr/` 中完整 ADR 重复；应统一单一权威来源，不能删除 Speculo source 导致链断。
- `docs/V2_REQUIREMENTS.md` 全英文，而项目其余发布文档为中文；应统一语言或明确例外。

## 冗余和未跟踪内容清理建议

以下内容明显是旧计划或生成物，完成归档/迁移确认后应删除：

1. `IMPLEMENTATION_PLAN.md`、`RESEARCH.md` 中已经失效的实施前章节；更稳妥的做法是删除旧文件并保留一份当前架构基线。
2. `docs/IMPLEMENTATION_PLAN_V2.md`，除非需要审计历史，否则移至明确的 archive 目录。
3. 未跟踪的 `ci-evidence-0.2.7/`（旧 Windows EXE 与 macOS DMG）。发布证据应由 CI artifact 保存，工作树不应携带二进制证据。
4. 根 `docs/decisions` 与 Speculo ADR 的重复副本，需按 Speculo consolidation contract 统一后再删。

`node_modules/`、`target/`、`artifacts/` 已被 `.gitignore` 正确忽略。审查未发现失效的非-Speculo Markdown 相对链接。

## 验证结果

- `pnpm exec redocly lint api/openapi.yaml`：通过。
- `node scripts/go.mjs -C services/workbenchd test ./...`：通过。
- `cargo test --workspace`：通过，10 个 Rust 测试通过。
- 前端 `pnpm --dir apps/desktop exec vitest run --pool=threads --maxWorkers=1`：通过，7 个文件、20 个测试通过。
- 默认 `pnpm check:frontend`：失败于 Vitest fork worker 启动超时（7 个 unhandled worker timeout，未进入实际测试）；单 worker 重跑通过，说明当前环境并发 worker 不稳定，但 CI 仍需固定可重复的 worker 配置。
- 未执行 Windows/macOS 安装包 E2E、性能、race、10 万实体和故障注入测试；现有文档不能替代这些证据。

## 建议修复顺序

先修复 SQLite 每连接配置、任务日期、附件实体校验/大小上限和提醒权限问题；随后补字段 default/RRULE/parent 校验、缓存失效与搜索 debounce；再统一 OpenAPI server 生成策略和删除 legacy migration；最后清理旧文档/旧二进制并重新生成一套与 0.2.9 对应的验收证据。完成后重新运行全量 `pnpm check`、Go race、安装包 smoke 和备份/恢复故障注入。

