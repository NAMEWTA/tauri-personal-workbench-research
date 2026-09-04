# Personal Workbench 领域上下文

## Workspace Runtime

**Personal Workbench**：单用户、离线优先的 Windows 与 macOS 桌面个人管理工具；核心数据位于本地工作区，不依赖云端服务进程。
_Avoid_: 云端工作台, 多用户协作服务

**工作区**：可独立打开、排他锁定、备份和恢复的完整目录数据单元，包含描述文件、SQLite、托管附件、备份、日志及预留目录。
_Avoid_: 数据库（当指完整工作区时）, 应用安装目录

**桌面宿主**：Tauri/Rust 层，拥有窗口、原生对话框、最近工作区注册表和 sidecar 生命周期，不拥有业务 CRUD。
_Avoid_: 领域后端, CRUD 代理

**workbenchd**：由桌面宿主监管的单个 Go sidecar，是领域逻辑、HTTP API、SQLite、托管文件、检索、Job 与数据保护的唯一运行时 owner。
_Avoid_: 微服务集群, 数据库进程

**Bootstrap**：桌面宿主为一个应用/工作区会话生成并经 stdin 发送给 workbenchd 的启动合同，包含协议、父进程、工作区、允许 Origin 和内存 token；受监管重启会复用该 Bootstrap。
_Avoid_: 命令行密钥, 持久配置

**Ready 握手**：workbenchd 在 stdout 输出的一次性启动确认，桌面宿主必须核对协议、PID、loopback origin 和版本后才向 React 暴露连接。
_Avoid_: 普通 stdout 日志, 健康检查轮询

## Archive

**档案**：隶属于一个档案类型的用户内容记录，由标题、摘要、正文和按字段定义校验的动态字段值组成。
_Avoid_: 固定个人记录, generic entity（面向用户语义时）

**档案类型**：用户管理的 Schema 记录，拥有名称、图标、颜色和有序字段定义；个人、企业、事件只是可编辑的种子模板。
_Avoid_: 档案枚举, 硬编码类别

**字段定义**：档案类型拥有的动态字段合同，规定 key、值类型、分组、必填、选项、默认值、敏感标记和排序。
_Avoid_: 固定数据库列, 自由 JSON 无约束字段

**敏感字段**：由字段定义标记并在 UI 默认遮罩的显示语义；值仍以明文进入 SQLite、搜索索引与未加密备份。
_Avoid_: 加密字段, 权限字段

**事件档案**：Archive context 中名为“事件”的种子档案类型，不是可排程实体。
_Avoid_: 日历事件, CalendarEvent

**档案关系**：从 source 档案指向 target 档案的有向、带类型和备注的关系；反向或无向语义不自动成立。
_Avoid_: 默认双向关系, 无向边

**托管附件**：由 workbenchd 复制进工作区、记录相对路径和 SHA-256、当前归属于档案的文件副本。
_Avoid_: 原文件链接, 外部路径附件, 任务附件

**档案活动**：`change_log` 对单个档案变更的只读历史投影，不是事件溯源事实源。
_Avoid_: event sourcing 日志, 全实体活动流

## Planning

**任务**：系统唯一可排程实体，具有状态、优先级、可选的单一时间区间、时区、可选主档案和备注。
_Avoid_: 日历事项实体, CalendarEvent

**未排期任务**：开始和结束时间同时为空的任务。
_Avoid_: 无结束时间的半排期任务

**已排期任务**：开始和结束时间同时存在、结束晚于开始并保留 IANA timezone 的任务。
_Avoid_: 独立日历事件

**任务视图**：Today、Tomorrow、All、Completed 对任务集合的查询投影；All 包含全部未完成任务，包括未排期任务。
_Avoid_: 独立任务清单实体

**日历投影**：已排期任务的月/周/日时间视图；创建、拖拽或调整日历项本质上创建或更新任务。
_Avoid_: Calendar aggregate, calendar_events 表

**主档案**：任务持有的可选单一档案引用；档案侧的关联任务是反向查询投影。
_Avoid_: 多档案关联, 任务标签

**全局检查器**：Today、Tasks、Calendar 与 Archive 页面共享的任务选择与编辑表面，不创建第二套任务编辑模型。
_Avoid_: 页面私有任务编辑器

## Retrieval

**全局搜索**：面向档案、任务和附件名的统一检索能力；附件命中导航到其 owner 档案。
_Avoid_: 全表通用搜索, 远程搜索服务

**搜索索引**：由源实体派生的 SQLite FTS5 trigram 投影；短查询或 FTS 失败时退回 LIKE，索引可以重建而不成为源数据。
_Avoid_: 业务事实源, fuzzy ranking 引擎

## Data Safety

**移入回收站**：档案、任务和附件的可恢复删除语义。
_Avoid_: 永久删除

**结构删除**：档案类型和字段定义的 Schema 变更，不经过回收站；已被档案使用的类型不可删除，已有值的字段不可改变值类型。
_Avoid_: 移入回收站

**备份**：在用户显式配置的目录中发布的 ZIP，包含一致 SQLite 快照、快照所见的活跃托管附件和带 checksum 的 manifest。
_Avoid_: 云同步, 直接复制活跃数据库, 整个工作区目录镜像

**恢复预检**：恢复前对路径、条目、大小、压缩比、checksum、schema 与 SQLite integrity 执行的只读验证。
_Avoid_: 解压后再判断, 仅检查 ZIP 可打开

**恢复到新工作区**：验证通过后原子创建新的空工作区；当前不支持覆盖当前工作区或原地恢复。
_Avoid_: 覆盖恢复, 原地恢复

**后台 Job**：用于备份、恢复、附件导入和搜索重建的可查询、可取消长操作，终态持久化并通过 SSE 投影进度。
_Avoid_: 仅内存事件, 第二业务事实源

## Compatibility

**V2 开发基线**：当前数据库从单一 V2 基线开始，不迁移 V1 数据库，也不接受 V1 备份。
_Avoid_: V1 兼容升级, 自动导入旧备份

**运行时业务 ID**：新建业务记录通过集中 helper 生成，目标为 UUIDv7，当前极端失败路径可退回 UUIDv4；内置档案类型和字段定义使用稳定语义 slug。
_Avoid_: 所有 ID 无例外都是 UUIDv7

**时间点**：持久化为 UTC RFC3339 nanoseconds；可排程任务另存 IANA timezone，动态 date 字段保存严格 `YYYY-MM-DD`。
_Avoid_: 本地化日期字符串, 把纯日期转换为 UTC 午夜

## Context Map

- React Presentation 通过生成的 HTTP client 调用 Go API；仅通过窄 Tauri command 请求连接信息、工作区切换、原生选择和受控文件打开。
- Rust Desktop Host 通过 stdin Bootstrap、stdout Ready、受监管 child、恢复事件和 `/internal/shutdown` 管理 Go Runtime，不代理常规业务 CRUD。
- Go Application Service 是领域写入口，下游连接 SQLite repository、托管 filesystem、Job、Backup 与 Restore。
- Planning 通过任务上的可选主档案引用 Archive；Archive 通过反向查询展示关联任务。
- Retrieval 消费 Archive、Planning 和托管附件的派生索引，不拥有源实体。
- Data Safety 从 SQLite 一致快照和活跃托管附件生成备份，并只恢复为新的 Workspace。
- Background Job 是 Retrieval、托管附件与 Data Safety 共享的异步执行机制，不是独立业务 context。
- OpenAPI 3.1 是 React 与 Go 之间的设计期契约；TypeScript 运行时使用生成 client，Go 当前仍有手工路由实现边界。
