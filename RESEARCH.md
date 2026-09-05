# 个人工作台架构基线

本文档描述 `0.2.11` 当前实现，作为目录、进程边界、调用流和安全约束的事实入口。架构决策正文位于 [Speculo ADR](speculo/.speculo/specdev/adr/)。

## 总体结构

```text
Tauri 2 / Rust
  ├─ 窗口、原生对话框、single-instance、工作区注册
  ├─ 启动/监督/健康检查/优雅关闭 workbenchd
  └─ 通过窄 command 提供 bootstrap 连接信息
       │ loopback HTTP + Bearer token
React / TypeScript
  ├─ TanStack Router / Query、页面和表单
  └─ OpenAPI 生成的 Fetch client
       │ /api/v3
Go workbenchd
  ├─ HTTP middleware 与 API handlers
  ├─ application services（archive/task/attachment/backup/search/job/preferences）
  ├─ SQLite repositories、迁移、FTS
  └─ 托管附件、备份恢复、后台作业和 SSE
```

Go sidecar 是模块化单体和唯一领域数据 owner。Rust 不执行业务迁移或 CRUD；React 不直接访问文件系统；一个工作区同时只允许一个 sidecar 持有写锁。

## 调用流

1. Rust 解析工作区并生成一次性 token，通过 stdin 启动 sidecar。
2. Go 绑定 `127.0.0.1:0`，打开工作区、执行迁移并输出 versioned ready 行。
3. Rust 校验 ready 信息后向 React 暴露内存中的 URL/token。
4. React 使用生成 client 调用 `/api/v3`；Go middleware 校验 Host、Origin、Bearer、请求大小和超时。
5. handler 解码请求并调用领域 service；service 在事务内执行校验、写入和 change log。
6. 长作业通过 job 状态和 SSE events 返回；失败必须同时反映到持久化状态和 HTTP/SSE。
7. 退出时 Rust 停止新写请求，调用内部 shutdown；Go 完成事务、checkpoint WAL、关闭 HTTP 和 SQLite 后退出。

## 数据与时间语义

- 档案表为 `archive_collections`、`archive_fields`、`archive_records`；字段值按字段定义校验。
- 任务可无排程，也可有一个开始/结束区间、独立 due date、提醒、重复规则和 parent。
- 日期使用 `YYYY-MM-DD`，时间点使用 RFC 3339 UTC 并保留 IANA 时区。
- Today/Tomorrow 使用用户本地日期对应的 UTC 区间；Calendar 使用时间区间交集并包含已完成的有排程任务；普通 All 视图只返回未完成任务。
- 删除、关系、附件和 parent 引用遵循 active 数据语义；不存在或已删除资源返回统一 404。

## API 与安全

公开契约位于 [api/openapi.yaml](api/openapi.yaml)，路径固定为 `/api/v3`，错误使用 `application/problem+json`。生成的 Go/TypeScript 协议代码由 `pnpm generate` 更新，HTTP 入口只保留一套实现。

sidecar 只监听 loopback 随机端口；除健康检查外的请求必须携带启动期 Bearer token。生产 CSP、Origin/Host 白名单、请求体上限、超时和日志脱敏共同构成安全边界。token、完整路径、SQL 和请求体不得写入日志或前端错误界面。

## 目录职责

- `apps/desktop/src`：React 页面、领域 hooks、Query cache 和生成客户端。
- `apps/desktop/src-tauri/src`：Rust 生命周期、窗口、工作区和 sidecar 管理。
- `services/workbenchd/internal/api`：HTTP middleware、契约适配和错误映射。
- `services/workbenchd/internal/app`：按领域组合 application services。
- `services/workbenchd/internal/storage/sqlite`：连接初始化、迁移、repository 和事务。
- `api`：OpenAPI 唯一契约。
- `scripts`：生成、构建、smoke 和版本检查。

架构变更先更新 Speculo ADR 和本基线，再修改代码；实现状态与验证命令见 [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md)。
