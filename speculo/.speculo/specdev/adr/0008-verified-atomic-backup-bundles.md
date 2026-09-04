---
source_change: 2026-09-02-consolidate-project-knowledge
promoted_at: 2026-09-02
---

# ADR-0008: 可验证的原子备份包

- Status: Accepted
- Date: 2026-09-02
- Source: `<Path>docs/decisions/ADR-008-backup-snapshot.md</Path>`

## Context

复制活跃 WAL 数据库不能保证一致性，备份期间附件也可能变化；发布的 ZIP 必须能证明数据库和附件来自同一个冻结清单。

## Decision

使用 modernc Online Backup 生成 SQLite 一致快照，从快照数据库读取活跃托管附件清单，逐文件核对大小与 SHA-256，写临时 ZIP 并验证后原子 rename。只有成功发布的备份参与保留清理。

## Trade-off

相较 `VACUUM INTO`，Online Backup 更适合活跃工作区并降低额外重写成本，但绑定 driver API。附件在快照后变化会让备份失败，而不是发布混合状态。

## Consequences

备份格式和 manifest 是恢复兼容合同。未托管文件不进入备份。恢复必须先做安全、checksum、schema 与 integrity 预检，并发布到新工作区。

## Verification And Residual Risk

快照、manifest、ZIP 验证和 retention 见 `<Path>services/workbenchd/internal/backup/manager.go</Path>`；恢复边界见 `<Path>services/workbenchd/internal/backup/restore.go</Path>`；故障与恢复测试见 `<Path>services/workbenchd/internal/backup/manager_test.go</Path>`。超大工作区的资源与中断行为仍需按发布环境持续验证。
