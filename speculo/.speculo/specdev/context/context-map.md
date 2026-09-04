---
source_change: 2026-09-02-consolidate-project-knowledge
promoted_at: 2026-09-02
---

# Context Map

- React Presentation 通过生成的 HTTP client 调用 Go API；仅通过窄 Tauri command 请求连接信息、工作区切换、原生选择和受控文件打开。
- Rust Desktop Host 通过 stdin Bootstrap、stdout Ready、受监督 child、恢复事件和内部 shutdown 管理 Go Runtime，不代理常规业务 CRUD。
- Go Application Service 是领域写入口，下游连接 SQLite repository、托管 filesystem、Job、Backup 与 Restore。
- Planning 通过任务上的可选主档案引用 Archive；Archive 通过反向查询展示关联任务。
- Retrieval 消费 Archive、Planning 和托管附件的派生索引，不拥有源实体。
- Data Safety 从 SQLite 一致快照和活跃托管附件生成备份，并只恢复为新的 Workspace。
- Background Job 是 Retrieval、托管附件与 Data Safety 共享的异步执行机制，不是独立业务 context。
- OpenAPI 3.1 是 React 与 Go 之间的设计期契约；TypeScript runtime 使用生成 client，Go 当前仍有手工路由实现边界。
