---
source_change: 2026-09-02-consolidate-project-knowledge
promoted_at: 2026-09-02
---

# ADR-0011: V2 开发重置且不兼容 V1

- Status: Accepted
- Date: 2026-09-02
- Source: `<Path>docs/V2_REQUIREMENTS.md</Path>`

## Context

V2 删除独立 CalendarEvent、替换档案 enum 并重建核心 Schema。在仍处开发阶段时维护 V1 数据与备份迁移，会显著增加一次性迁移代码和验证成本。

## Decision

V2 从单一新基线开始，不迁移 V1 数据库，也不接受 V1 备份。当前兼容性只覆盖 V2 schema 的前向 migration 与 backup format 规则。

## Trade-off

获得更简单、可验证的 V2 数据模型和更快的开发收敛，接受现有 V1 数据必须留在旧版本，或通过另行明确的数据转换流程处理。

## Consequences

不得把旧 V1 工作区直接交给 V2 并承诺自动升级。未来若需要导入 V1，必须作为显式迁移产品能力设计、验证并 supersede 本决定。

## Verification And Residual Risk

兼容边界见 `<Path>docs/V2_REQUIREMENTS.md</Path>` 和 `<Path>README.md</Path>`；未来 schema 拒绝见 `<Path>services/workbenchd/internal/storage/sqlite/store.go</Path>`；恢复 schema 检查见 `<Path>services/workbenchd/internal/backup/restore.go</Path>`。用户误用旧工作区仍需由产品提示和入口校验防止。
