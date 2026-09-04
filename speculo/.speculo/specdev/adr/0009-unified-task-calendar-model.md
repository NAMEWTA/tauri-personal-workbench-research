---
source_change: 2026-09-02-consolidate-project-knowledge
promoted_at: 2026-09-02
---

# ADR-0009: 任务与日历统一模型

- Status: Accepted
- Date: 2026-09-02
- Source: `<Path>docs/V2_REQUIREMENTS.md</Path>`

## Context

独立 Task 与 CalendarEvent aggregates 会造成两套状态、编辑器、关联和完成语义；但把日历统一为任务，也意味着系统不表达与任务无关的日历事件实体。

## Decision

Task 是唯一可排程实体。任务要么未排期，要么同时拥有一个完整 start/end interval。Calendar 只是 scheduled Tasks 的时间投影；日历上的创建、拖拽和 resize 都创建或更新 Task。

## Trade-off

获得单一编辑模型、跨 Today/Tasks/Calendar/Archive 的一致投影和更简单的数据关系，接受不支持独立 CalendarEvent aggregate 或复杂重复日历语义。

## Consequences

“事件档案”仍是 Archive 类型，不能当作日历事件。All 任务视图包含所有未完成任务，包括未排期任务。Task 只可引用一个主档案。

## Verification And Residual Risk

V2 数据表见 `<Path>services/workbenchd/migrations/001_core.sql</Path>`；查询语义见 `<Path>services/workbenchd/internal/storage/sqlite/tasks.go</Path>`；投影行为见 `<Path>apps/desktop/src/features/calendar/CalendarPage.tsx</Path>` 和 `<Path>services/workbenchd/internal/storage/sqlite/store_test.go</Path>`。范围选择预填等日历交互缺口不是本决策已经实现的能力。
