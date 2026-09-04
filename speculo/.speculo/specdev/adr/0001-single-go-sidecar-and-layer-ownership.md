---
source_change: 2026-09-02-consolidate-project-knowledge
promoted_at: 2026-09-02
---

# ADR-0001: 单 Go Sidecar 与分层所有权

- Status: Accepted
- Date: 2026-09-02
- Source: `<Path>docs/decisions/ADR-001-process-ownership.md</Path>`

## Context

桌面壳、WebView 展现和本地领域数据需要清晰的进程与所有权边界。纯 Rust 领域核心会牺牲 Go 的服务与测试生态；拆成多个服务又会给单用户离线应用增加不必要的部署和一致性成本。

## Decision

Tauri/Rust 桌面宿主管理一个模块化 Go sidecar `workbenchd`。React 拥有展现；Rust 拥有桌面生命周期、原生对话框、工作区注册和 sidecar 监督；Go 独占领域逻辑、HTTP、SQLite、托管文件、检索、后台 Job、备份与恢复。常规业务 CRUD 不经 Tauri command 代理。

## Trade-off

接受三套工具链、子进程监督和本地 HTTP 安全边界，换取领域逻辑与桌面壳解耦、Go 独立测试能力和单一数据 owner。

## Consequences

只有 Go 打开工作区数据库。Rust 必须处理 Bootstrap/Ready、版本核对、恢复和优雅关闭。窄 Rust 文件命令可以选择或打开路径，但不得拥有业务路径构造和元数据。

## Verification And Residual Risk

Rust command surface 位于 `<Path>apps/desktop/src-tauri/src/lib.rs</Path>`，业务路由位于 `<Path>services/workbenchd/internal/api/server.go</Path>`，数据库打开位于 `<Path>services/workbenchd/internal/storage/sqlite/store.go</Path>`。跨层新增能力仍需检查是否破坏单一 owner。
