---
source_change: 2026-09-02-consolidate-project-knowledge
promoted_at: 2026-09-02
---

# Compatibility

**V2 开发基线**：当前数据库从单一 V2 基线开始，不迁移 V1 数据库，也不接受 V1 备份。避免承诺 V1 兼容升级或旧备份自动导入。

**运行时业务 ID**：新建业务记录通过集中 helper 生成，目标为 UUIDv7，当前极端失败路径可回退 UUIDv4；内置档案类型和字段定义使用稳定语义 slug。不得声称所有 ID 无例外都是 UUIDv7。

**时间点**：持久化为 UTC RFC3339 nanoseconds；可排程任务另存 IANA timezone；动态 `date` 字段保存严格 `YYYY-MM-DD`。避免本地化日期字符串，也不要把纯日期转换为 UTC 午夜。
