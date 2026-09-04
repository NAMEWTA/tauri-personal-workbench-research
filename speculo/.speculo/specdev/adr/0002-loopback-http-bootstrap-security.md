---
source_change: 2026-09-02-consolidate-project-knowledge
promoted_at: 2026-09-02
---

# ADR-0002: Loopback HTTP Bootstrap 安全边界

- Status: Accepted
- Date: 2026-09-02
- Source: `<Path>docs/decisions/ADR-002-loopback-security.md</Path>`

## Context

React 直连本地 HTTP 可以复用标准 Fetch/OpenAPI 工具，但随机 TCP 端口和 WebView 暴露面弱于纯 IPC，需要纵深补偿控制。

## Decision

`workbenchd` 只绑定随机 `127.0.0.1` 端口。Rust 为每个应用/工作区 Bootstrap 生成 32-byte token，经 stdin 发送。受监督的 sidecar 自动恢复与 retry 复用当前 Bootstrap/token；工作区切换才生成新 Bootstrap。受保护路由同时验证 Host、Origin 和 Bearer。token 只驻留 Rust、sidecar 与 WebView 内存。

## Trade-off

接受 CSP 允许 loopback 随机端口、WebView 持有 token，以及无法抵御同 OS 用户权限恶意进程，换取标准 HTTP 调试、生成客户端和独立可测的 Go 服务。

## Consequences

`/healthz` 仅暴露最小匿名存活信息。连接信息只能经窄 Tauri command 获得；token 不得进入参数、URL、日志、LocalStorage 或工作区文件。普通 sidecar 重启不会轮换 token。

## Verification And Residual Risk

Bootstrap 与 token 见 `<Path>apps/desktop/src-tauri/src/bootstrap.rs</Path>`；Ready 核验与重启见 `<Path>apps/desktop/src-tauri/src/sidecar_manager.rs</Path>`；拒绝行为见 `<Path>services/workbenchd/internal/api/middleware_test.go</Path>` 和 `<Path>services/workbenchd/internal/api/server_test.go</Path>`。该边界不是针对本机同权限恶意代码的强隔离。
