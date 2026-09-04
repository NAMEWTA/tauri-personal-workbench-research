---
source_change: 2026-09-02-consolidate-project-knowledge
promoted_at: 2026-09-02
---

# ADR-0006: 托管附件所有权与原子导入

- Status: Accepted
- Date: 2026-09-02
- Source: `<Path>docs/decisions/ADR-006-managed-attachments.md</Path>`

## Context

外部文件引用无法保证备份完整、生命周期和路径安全；让 WebView 直接管理文件会扩大 capability 并产生多个 owner。

## Decision

Go canonicalize 用户选择的源路径，限制类型与大小，流式计算 SHA-256 写入 UUID-scoped 临时路径，sync 后原子 rename，再用数据库事务提交相对路径元数据。UI 只传选择结果，不构造托管路径。

## Trade-off

获得可备份、可校验和受控打开，接受复制占用磁盘、文件系统与数据库只能采用补偿一致性，以及崩溃窗口可能留下孤儿文件。

## Consequences

当前托管附件只归属于档案。批导入正常失败必须清理已复制文件并回滚元数据。打开时 Go 与 Rust 都必须检查路径没有逃逸 attachments 根。

## Verification And Residual Risk

导入与打开实现见 `<Path>services/workbenchd/internal/attachment/manager.go</Path>`；失败回滚见 `<Path>services/workbenchd/internal/attachment/manager_test.go</Path>`；UI 调用见 `<Path>apps/desktop/src/features/archives/ArchiveResources.tsx</Path>`。异常进程终止后的孤儿清理仍依赖后续治理。
