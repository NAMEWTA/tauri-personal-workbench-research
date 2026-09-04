---
source_change: 2026-09-02-consolidate-project-knowledge
promoted_at: 2026-09-02
---

# ADR-0010: 用户定义的档案 Schema

- Status: Accepted
- Date: 2026-09-02
- Source: `<Path>docs/V2_REQUIREMENTS.md</Path>`

## Context

个人、企业、事件不足以覆盖个人工作台的长期信息类型。继续增加代码 enum 与固定列会让每个新类型都需要发布和迁移；无约束 JSON 又会失去验证、表单与搜索语义。

## Decision

ArchiveType 与 FieldDefinition 是用户管理的持久记录；字段值使用受定义约束的 typed EAV 存储；表单由字段定义驱动。个人、企业、事件只是可编辑 seed templates，不是代码 enum。

## Trade-off

获得无需发版的业务扩展和统一动态表单，接受 EAV 查询/校验复杂度、字段演进限制和关系完整性需要应用层治理。

## Consequences

已使用的档案类型不可删除；已有值的字段不可改变 value type；字段 key 在类型内唯一。`sensitive` 是显示元数据，不代表加密。

## Verification And Residual Risk

模型与约束见 `<Path>services/workbenchd/internal/archive/model.go</Path>`、`<Path>services/workbenchd/internal/storage/sqlite/archive_types.go</Path>` 和 `<Path>services/workbenchd/internal/storage/sqlite/archives.go</Path>`；动态表单见 `<Path>apps/desktop/src/features/archives/ArchiveForm.tsx</Path>`。高级 schema 迁移和敏感值加密不属于当前能力。
