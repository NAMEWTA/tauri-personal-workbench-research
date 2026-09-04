---
source_change: 2026-09-02-consolidate-project-knowledge
promoted_at: 2026-09-02
---

# ADR-0005: 持久标识符与时间语义

- Status: Accepted
- Date: 2026-09-02
- Source: `<Path>docs/decisions/ADR-005-identifiers-and-time.md</Path>`

## Context

标识符与时间格式跨越 API、SQLite、排序、备份和未来迁移，改变成本高。纯日期、时间点和用户日历时区具有不同语义，不能混用本地化字符串。

## Decision

运行时业务记录通过集中 helper 生成，目标为 UUIDv7，当前生成失败时回退 UUIDv4。内置档案类型与字段定义使用稳定语义 slug。时间点保存为 UTC RFC3339 nanoseconds；可排程 Task 另存 IANA timezone；动态 `date` 字段保存严格 `YYYY-MM-DD`。

## Trade-off

UUIDv7 提供大致时间有序且跨层通用的 ID，UTC 加 IANA timezone 保留精确时点和用户日历语义；代价是展示层显式转换，且 UUIDv4 fallback 使“所有运行时 ID 必为 v7”不成立。

## Consequences

不得把纯日期转换成 UTC 午夜。Calendar 语义属于 scheduled Task，不存在独立 calendar record。若未来要求严格 UUIDv7，必须移除或隔离 fallback 并增加版本验证。

## Verification And Residual Risk

ID/time helper 位于 `<Path>services/workbenchd/internal/platform/identity.go</Path>`；Task timezone 验证位于 `<Path>services/workbenchd/internal/task/model.go</Path>`；动态日期验证位于 `<Path>services/workbenchd/internal/storage/sqlite/archives.go</Path>`。
