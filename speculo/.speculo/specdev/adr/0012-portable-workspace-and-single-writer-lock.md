---
source_change: 2026-09-02-consolidate-project-knowledge
promoted_at: 2026-09-02
---

# ADR-0012: 可携移工作区与单写者锁

- Status: Accepted
- Date: 2026-09-02
- Source: `<Path>README.md</Path>`

## Context

离线个人工具需要清晰的数据所有权、可搬移文件布局和可靠的备份边界。允许多个 sidecar 同时打开同一工作区，会让 SQLite、托管附件和后台操作暴露给跨进程竞争。

## Decision

工作区是包含 descriptor、SQLite、attachments、backups、exports 和 logs 的普通目录数据单元。每次打开必须取得 OS 级排他文件锁，同一时刻只有一个 `workbenchd` 可以拥有该工作区。

## Trade-off

获得透明、可携移和单 owner 一致性，接受同一工作区不能被两个应用实例并行使用，也不提供云同步或多用户并发语义。

## Consequences

最近工作区注册表只保存 locator，不是数据源。备份以工作区 SQLite 和已登记托管附件为边界。桌面 Single Instance 与工作区锁共同防止双 owner，但锁是最终数据安全门。

## Verification And Residual Risk

目录初始化与 descriptor 见 `<Path>services/workbenchd/internal/storage/sqlite/store.go</Path>`；平台锁见 `<Path>services/workbenchd/internal/workspace/</Path>`；并发打开测试见 `<Path>services/workbenchd/internal/workspace/lock_test.go</Path>` 和 `<Path>services/workbenchd/internal/storage/sqlite/store_test.go</Path>`。网络文件系统上的锁语义不在当前承诺范围内。
