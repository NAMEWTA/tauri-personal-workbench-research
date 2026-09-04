---
source_change: 2026-09-02-consolidate-project-knowledge
promoted_at: 2026-09-02
---

# ADR-0003: Pure-Go SQLite 能力基线

- Status: Accepted
- Date: 2026-09-02
- Source: `<Path>docs/decisions/ADR-003-sqlite-driver.md</Path>`

## Context

SQLite driver 同时约束桌面构建链、FTS、在线快照、迁移和关闭行为。CGO driver 能提供成熟绑定，但会显著增加 Windows/macOS 构建复杂度。

## Decision

使用 `modernc.org/sqlite` 并以 `CGO_ENABLED=0` 构建 sidecar。驱动能力基线包括 WAL、foreign keys、busy timeout、FTS5 trigram、Online Backup、Goose migration、integrity check 和退出 checkpoint。

## Trade-off

获得无需 C toolchain 的跨平台构建和现代 SQLite 能力，同时接受 modernc 特定 Backup API、较大的纯 Go 依赖，以及持续验证驱动行为的责任。

## Consequences

切换 driver 会同时影响构建、搜索、迁移和备份。当前代码配置了这些能力，但不得把能力清单等同于完整平台 gate 已通过。

## Verification And Residual Risk

实现见 `<Path>services/workbenchd/internal/storage/sqlite/store.go</Path>`、`<Path>services/workbenchd/migrations/001_core.sql</Path>` 和 `<Path>services/workbenchd/internal/backup/manager.go</Path>`。现有测试覆盖 WAL、FTS、工作区锁和备份恢复；CI 尚未在 Windows 多连接场景逐项证明 foreign keys、busy timeout、并发 Online Backup 与 checkpoint，这是明确的残余验证风险。
