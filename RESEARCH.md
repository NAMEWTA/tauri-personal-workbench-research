# Tauri 2 + React + Go Sidecar 离线个人工作台：技术调研与架构基线

> 调研日期：2026-08-30  
> 文档状态：当前有效，已替换原 Rust 领域核心方案。  
> 产品范围：Windows-first 的单用户、离线、明文个人工作台。  
> 固定架构：Rust 监管进程，React 通过 loopback HTTP 直连单个 Go sidecar。  
> 配套执行计划：[IMPLEMENTATION_PLAN.md](./IMPLEMENTATION_PLAN.md)

## 0. 结论

该架构可行，并适合本项目后续可能出现的 CLI、后台服务、数据导入工具或独立 API 需求。

最终采用以下职责边界：

```text
┌──────────────── Tauri 2 Desktop Host ────────────────┐
│                                                      │
│  React WebView                                       │
│  ├── 页面、交互、表单和视觉状态                       │
│  ├── TanStack Router / Query                         │
│  └── Generated HTTP Client                           │
│             │                                        │
│             │ http://127.0.0.1:<random>/api/v1       │
│             ▼                                        │
│  Go Sidecar: workbenchd                              │
│  ├── 档案、任务、日历领域逻辑                         │
│  ├── SQLite、迁移和全文搜索                           │
│  ├── 附件、备份和恢复                                 │
│  └── REST API、后台任务和事件流                       │
│                                                      │
│  Thin Rust Host                                      │
│  ├── 启动、健康检查、监管和关闭 workbenchd            │
│  ├── 窗口、原生 Dialog、Single Instance              │
│  └── 向 React 提供一次 bootstrap 连接信息             │
└──────────────────────────────────────────────────────┘
```

关键约束：

- 只有 Go 可以打开和写入工作区 SQLite。
- Rust 不保存领域实体、不执行迁移、不代理常规 CRUD。
- React 不直接获得通用文件系统或 shell 权限。
- Go 只监听 `127.0.0.1` 的随机端口，绝不监听局域网地址。
- 本项目只运行一个 Go sidecar，不拆成多个微服务进程。
- 不配置 Windows Authenticode、Tauri updater 签名或应用商店发布。
- 更新通过手动下载新的 unsigned 安装包完成。

## 1. 为什么采用 Go Sidecar

### 1.1 相对纯 Rust 方案的收益

| 维度 | Go sidecar | 全部使用 Rust |
| --- | --- | --- |
| 领域功能开发 | Go 标准库和服务生态成熟，迭代直接 | 类型与内存安全强，但团队学习和开发成本更高 |
| 独立测试 | 可直接启动 HTTP 服务做黑盒测试 | 需要通过 core crate 或 Tauri test harness |
| 未来复用 | 可自然复用为 CLI、守护进程或本地 API | 与 Tauri command 的耦合更容易增大 |
| 打包 | 多一个二进制和工具链 | 单 Rust 二进制更简单 |
| 运行期 | 需要监管、健康检查和 IPC | 进程模型最简单 |
| 安全边界 | 需要保护 loopback HTTP | Tauri IPC 默认边界更窄 |

本项目选择 Go 的前提不是“避免任何 Rust”，而是把 Rust 固定为桌面宿主层，把更容易长期演进的领域与数据能力放入 Go。

### 1.2 不采用微服务架构

离线单用户桌面工具不需要服务发现、消息队列、容器或多个端口。所谓“Go 服务”是一个模块化单体：

- 一个进程。
- 一个数据库事实源。
- 一个版本号。
- 一个 HTTP listener。
- 一个统一日志流。
- 一个统一退出协议。

内部按领域拆 package，而不是按领域拆进程。

### 1.3 后续牵引能力

在不改变领域层的情况下，未来可以增加：

- `workbenchctl`：调用相同 application services 的 CLI。
- 只读导出器：批量导出档案、任务和日历。
- 本机后台计划任务：在不启动 UI 时执行备份。
- 可选远端部署适配器：只有真正需要时才增加认证和 TLS。

这些能力不是 MVP 范围，但目录和接口不应阻断它们。

## 2. Tauri 2 Sidecar 可行性

Tauri 2 官方将随应用打包的外部可执行文件称为 sidecar。`tauri.conf.json` 的 `bundle.externalBin` 可以包含任意语言编译的二进制。[官方 External Binaries 文档](https://v2.tauri.app/develop/sidecar/)

配置示意：

```json
{
  "bundle": {
    "externalBin": ["binaries/workbenchd"]
  }
}
```

Tauri 要求目标二进制带 Rust target triple 后缀：

| 平台 | 构建结果 |
| --- | --- |
| Windows x64 | `workbenchd-x86_64-pc-windows-msvc.exe` |
| Windows ARM64 | `workbenchd-aarch64-pc-windows-msvc.exe` |
| macOS Apple Silicon | `workbenchd-aarch64-apple-darwin` |
| macOS Intel | `workbenchd-x86_64-apple-darwin` |
| Linux x64 | `workbenchd-x86_64-unknown-linux-gnu` |

Go 的 `GOOS/GOARCH` 与 Tauri triple 不是同一命名体系，因此构建脚本必须维护显式映射，不能用字符串猜测。

### 2.1 谁负责启动

Tauri 官方允许 JavaScript 或 Rust 启动 sidecar。本项目固定由 Rust 启动，原因是：

- 保证只启动一次。
- 主窗口尚未可用时也能完成初始化。
- React 不需要 `shell:allow-spawn`、`allow-kill` 等高权限。
- Rust 可以持有 child handle 并统一处理退出。
- 前端刷新不会误启动第二个 Go 进程。

Shell plugin 的危险操作默认被禁用，需要 capability 显式授权；本项目只在 Rust 侧使用插件，不把 shell capability 暴露给 WebView。[Tauri Shell 文档](https://v2.tauri.app/plugin/shell/)

### 2.2 启动状态机

```text
CREATED
  → SPAWNING
  → WAITING_READY
  → MIGRATING
  → READY
  → STOPPING
  → STOPPED

失败支路：SPAWN_FAILED / START_TIMEOUT / MIGRATION_FAILED / CRASHED
```

启动顺序：

1. Tauri single-instance 插件先取得应用单例。
2. Rust 解析应用数据目录和最近工作区。
3. Rust 生成 32-byte 随机 token。
4. Rust 启动 `workbenchd`，通过 stdin 写入 bootstrap JSON。
5. Go 绑定 `127.0.0.1:0`，由操作系统选择空闲端口。
6. Go 打开工作区、执行迁移、完成健康检查。
7. Go 在 stdout 写一行 versioned ready JSON。
8. Rust 验证版本、PID、端口和 nonce，再保存连接状态。
9. Rust 显示主窗口；React 调用一次 `backend_connection_info`。
10. React 创建 HTTP client 并请求首屏数据。

Bootstrap JSON 不通过命令行参数传递，避免 token 和完整工作区路径出现在进程列表：

```json
{
  "protocolVersion": 1,
  "token": "base64url-256-bit-secret",
  "workspacePath": "C:\\...\\workspace",
  "parentPid": 1234,
  "appVersion": "0.1.0"
}
```

Ready line：

```json
{
  "type": "ready",
  "protocolVersion": 1,
  "serviceVersion": "0.1.0",
  "pid": 5678,
  "origin": "http://127.0.0.1:49173",
  "workspaceId": "..."
}
```

stdout 只承载机器协议；普通日志写 stderr。任何普通日志混入 stdout 都视为协议错误。

### 2.3 关闭与崩溃

正常退出：

1. Rust 拦截应用退出请求。
2. 禁止前端发起新的写请求。
3. Rust 使用 token 调用 `POST /internal/shutdown`。
4. Go 停止接收请求，取消后台任务，等待事务完成。
5. Go checkpoint WAL、关闭数据库和 HTTP server。
6. Rust 等待子进程退出，超时后调用 child kill。
7. Rust 退出窗口进程。

Go sidecar 本身不再派生长期子进程，因此终止树问题被压缩为一个直接 child。异常退出时最多自动重启两次；若迁移、恢复或备份写入阶段崩溃，不自动循环重启，直接进入诊断页。

## 3. Loopback HTTP 方案

### 3.1 选择 REST/JSON

推荐 `REST/JSON + OpenAPI 3.1`，而不是 gRPC：

- WebView 原生支持 Fetch、SSE 和 WebSocket。
- 调试可以直接看到请求、状态码和 JSON。
- Go 与 TypeScript 都有稳定代码生成生态。
- 当前数据量和调用频率不需要二进制 RPC。
- 将来 CLI 或独立服务也能复用同一契约。

API 固定前缀为 `/api/v1`。内部生命周期接口使用 `/internal/*`，不写入公开 OpenAPI client。

### 3.2 HTTP 组件

| 能力 | 选择 |
| --- | --- |
| HTTP server | Go `net/http` |
| Router | `github.com/go-chi/chi/v5` |
| API 契约 | `api/openapi.yaml` |
| Go server types | `oapi-codegen` strict server + Chi |
| TypeScript client | `@hey-api/openapi-ts` + Fetch client |
| 前端异步状态 | TanStack Query，feature 自己维护 query options |
| 日志 | 标准库 `log/slog`，JSON line |
| 长任务进度 | 首选 SSE；需要双向控制时才用 WebSocket |

Chi 与 `net/http` 完全兼容且本体无外部依赖，适合一个中等规模的模块化 REST 服务。[go-chi/chi](https://github.com/go-chi/chi)

`oapi-codegen` strict server 生成 typed request/response envelope，但不会替代业务验证和鉴权 middleware。[oapi-codegen](https://github.com/oapi-codegen/oapi-codegen)

前端只生成 Fetch SDK 和类型，不自动生成所有 React Query hooks。Query key、失效关系和 optimistic update 是产品行为，应由对应 feature 显式维护。

### 3.3 API 约定

- JSON 字段统一 `camelCase`。
- ID 为不透明字符串。
- 时间点使用 RFC 3339 UTC；另存 IANA 时区。
- 日期使用 `YYYY-MM-DD`，不能转换为午夜 UTC。
- 分页默认 cursor，表格明确需要总数时才计算 count。
- 所有 mutation 接受 `requestId`，关键操作保证幂等。
- 错误返回 `application/problem+json` 风格结构。
- API 版本放 path，服务协议版本放启动握手。

错误示意：

```json
{
  "type": "https://local.workbench/errors/archive-not-found",
  "title": "Archive not found",
  "status": 404,
  "code": "ARCHIVE_NOT_FOUND",
  "traceId": "...",
  "detail": ""
}
```

`detail` 不携带 SQL、token、完整敏感字段或内部路径。

### 3.4 端点分组

```text
GET/POST/PATCH/DELETE /api/v1/archive-types
GET/POST/PATCH/DELETE /api/v1/archives
GET/POST/PATCH/DELETE /api/v1/tasks
GET/POST/PATCH/DELETE /api/v1/calendar-events
GET/POST/DELETE       /api/v1/relations
GET/POST/DELETE       /api/v1/attachments
GET                   /api/v1/search
GET/POST              /api/v1/backups
POST                  /api/v1/restores/preflight
POST                  /api/v1/restores
GET/PATCH              /api/v1/settings
GET/POST/DELETE        /api/v1/trash
GET                    /api/v1/jobs/{id}
GET                    /api/v1/jobs/{id}/events
```

文件导入不把多 GB 文件先读进 React 内存。Tauri dialog 返回用户选择，React 将路径作为显式请求交给 Go；Go canonicalize 后流式复制。未来若 capability 限制导致 WebView 无法取得路径，则用一个窄 Tauri command 完成“选择文件并返回 paths”，不把文件内容经过 Rust。

## 4. 本地 HTTP 安全边界

本项目的数据本身按用户要求明文保存，但 loopback API 仍不能裸开放。

### 4.1 必须执行

- 监听地址固定为 IP literal `127.0.0.1:0`，不使用 `localhost` 解析结果。
- 每次启动生成新 token，服务停止后立即失效。
- 除 `/healthz` 的最小存活信息外，所有请求要求 `Authorization: Bearer`。
- token 使用恒定时间比较。
- `Host` 只接受实际监听地址；拒绝异常 Host header。
- CORS 只允许生产 `http://tauri.localhost` 和当前 Vite dev origin。
- 预检只允许必要 methods 与 `Authorization, Content-Type, X-Request-Id`。
- 每个 handler 有 header/read/write/idle timeout 和 context cancellation。
- JSON body 设置最大字节数；上传走路径导入而非无限 multipart。
- 生产环境不注册 `pprof`、Swagger UI、debug dump。
- 日志不记录 Authorization header、请求 body 和敏感字段。

Tauri 官方强调 CSP 应尽可能严格，并仅允许可信连接目标。[Tauri CSP 文档](https://v2.tauri.app/security/csp/)

随机端口使 CSP 无法限制到单一端口，因此 production `connect-src` 需要允许 `http://127.0.0.1:*`；token、Host/CORS 校验和仅 loopback 绑定共同提供补偿控制。

### 4.2 威胁边界

该方案防止普通网页或局域网设备直接调用 API，但不能抵御已经以同一 Windows 用户权限运行的恶意程序。后者通常也能读取明文工作区。因此安全目标是最小暴露和避免意外访问，不宣称强隔离。

### 4.3 React 获取连接信息

React 只通过一个窄 Tauri command 获取内存中的连接信息：

```ts
type BackendConnection = {
  baseUrl: string
  token: string
  protocolVersion: number
  serviceVersion: string
}
```

该信息不写入 LocalStorage、日志、URL、错误上报或 Zustand persist。窗口刷新后重新向 Rust 获取；关闭后清空。

## 5. 技术栈基线

版本是 2026-08-30 的研究快照。创建项目时锁定经过兼容测试的 patch，不在文档中使用浮动 `latest`。

### 5.1 桌面宿主

| 项目 | 基线 |
| --- | --- |
| Tauri | 2.11 系列；研究时 core 2.11.5 |
| Rust | 与所选 Tauri 兼容的 stable，通过 `rust-toolchain.toml` 固定 |
| 插件 | shell、single-instance、dialog、opener、window-state、log |
| 不安装 | updater、SQL、通用 fs、deep-link（MVP） |

Rust 代码只保留 `sidecar_manager`、`bootstrap_command`、窗口/插件 wiring 和退出协调。

### 5.2 Go 服务

Go 1.27.0 刚在 2026-08-19 发布；为降低首发工具链风险，MVP 先固定经过多个 patch 的 Go 1.26.7，待 Go 1.27 首个稳定 patch 且依赖 CI 全绿后升级。[Go Release History](https://go.dev/doc/devel/release)

| 项目 | 选择 |
| --- | --- |
| 语言 | Go 1.26.7 toolchain；`go` language line 保持兼容版本 |
| HTTP | `net/http` + Chi v5 |
| 契约 | OpenAPI 3.1 + oapi-codegen v2 |
| 数据库 | `database/sql` + `modernc.org/sqlite` 候选 |
| 迁移 | `pressly/goose/v3`，SQL migrations 使用 `embed.FS` |
| 日志 | `log/slog` |
| 测试 | `testing`、`httptest`、临时目录和 golden fixtures |
| 静态检查 | `go vet` + golangci-lint |

不引入完整 Web framework、ORM、依赖注入框架或全局 service locator。

### 5.3 React 前端

| 项目 | 基线 |
| --- | --- |
| Node.js | 24 LTS |
| 包管理 | pnpm，固定 packageManager 字段与 lockfile |
| React | 19.2 系列；研究时 19.2.7 |
| 构建 | Vite 8 |
| TypeScript | 5.9；6.0 刚发布且是 7.0 过渡版本，完成兼容验证后再升 |
| Router | TanStack Router |
| Query | TanStack Query，`networkMode: 'always'` |
| UI state | Zustand，仅布局和临时状态 |
| Form | React Hook Form + Zod |
| UI | Tailwind CSS + shadcn/ui + Radix + Lucide |
| Calendar | FullCalendar React standard + rrule |
| Test | Vitest + Testing Library + Playwright |

不用 SSR、RSC、Next.js 或 Service Worker。React Server Components 曾出现与本地 SPA 无关但会增加攻击面的服务端问题，本项目没有引入理由。

## 6. SQLite 方案

### 6.1 驱动选择

首选候选为 [`modernc.org/sqlite`](https://pkg.go.dev/modernc.org/sqlite)：它是无 CGO 的 SQLite Go port，提供 `database/sql` driver、FTS5 代码和 online backup 对象，能显著简化 Windows 和后续多平台构建。

但必须在 Iteration 0 通过以下 gate 才正式采用：

- Windows x64 打包后的 FTS5 可创建和查询。
- `trigram` tokenizer 可用并符合中文搜索样本。
- WAL、foreign key、busy timeout 行为符合预期。
- online backup 可在并发读取/写入下得到一致快照。
- 10 万实体 benchmark 达标。
- 固定 `modernc.org/libc` 与 driver 要求的一致版本。

若失败，回退到 `mattn/go-sqlite3` 并启用 `sqlite_fts5`。后者成熟，但依赖 CGO/GCC，会使 CI 和交叉编译明显复杂。[go-sqlite3](https://github.com/mattn/go-sqlite3)

### 6.2 连接规则

Go 是唯一数据库进程。建议：

```sql
PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
PRAGMA busy_timeout = 5000;
```

- `SetMaxOpenConns` 从小值开始，以 benchmark 决定，而不是默认无限连接。
- 写事务通过 application service 协调，避免多个 goroutine 长时间争锁。
- 所有查询使用 context deadline。
- 所有列表查询必须分页和稳定排序。
- 每次启动执行 `quick_check`；恢复后执行 `integrity_check`。

### 6.3 数据模型

核心实体保持对象化模型：

- `archive_types` / `field_definitions`
- `archives` / `archive_field_values`
- `tasks`
- `calendar_events`
- `entity_relations`
- `attachments`
- `tags` / `entity_tags`
- `backup_runs`
- `trash_entries`
- `change_log`
- FTS5 virtual tables

动态字段使用 typed EAV，频繁查询的标题、状态、时间和排序键保留在主表。

### 6.4 迁移

Goose 支持 SQLite 和通过 `embed.FS` 将 SQL migrations 编入 Go 二进制。[Goose](https://github.com/pressly/goose)

规则：

- 迁移只前进；已经发布的 `.sql` 不修改。
- down migration 仅用于开发测试，不用于用户数据自动回滚。
- 启动迁移前创建数据库安全快照。
- 每个迁移有上一版本 fixture 测试。
- schema 版本高于当前服务时只读拒绝打开，不猜测兼容。

### 6.5 搜索

FTS5 首选 trigram tokenizer 处理中文连续文本，同时保留标准化精确列搜索身份证、统一社会信用代码和电话。[SQLite FTS5](https://www.sqlite.org/fts5.html)

搜索不是只有一个索引：

- FTS：名称、正文、备注、普通文本字段。
- 精确/前缀索引：证件号、信用代码、手机号、邮箱。
- 关系过滤：档案类型、标签、状态和时间范围。

## 7. 附件和备份

### 7.1 文件所有权

所有文件业务操作归 Go：导入、hash、重命名、删除、恢复、打包。Rust 只负责原生选择对话框。

```text
workspace/
├── workbench.sqlite3
├── attachments/yyyy/mm/<uuid>/<safe-name>
├── exports/
├── logs/
└── workspace.json
```

Go 对用户选择的路径执行 canonicalize、大小限制、文件类型记录和流式 SHA-256。最终路径永远不由前端字符串拼接。

### 7.2 数据库快照

优先使用 modernc 暴露的 SQLite Online Backup API，以增量页复制方式生成一致快照；SQLite 官方说明该 API 可以在 live database 上产生一致 destination snapshot。[SQLite Backup API](https://www.sqlite.org/backup.html)

`VACUUM INTO` 作为备选，优点是输出紧凑且清除已删除内容，缺点是 CPU 和临时空间开销更大。[SQLite VACUUM INTO](https://www.sqlite.org/lang_vacuum.html)

### 7.3 备份包

```text
workbench-backup-YYYYMMDD-HHMMSS.zip
├── manifest.json
├── database.sqlite3
└── attachments/
```

manifest 保存格式版本、schema、应用/服务版本、workspace ID、时间、文件相对路径、长度和 SHA-256。ZIP 先写临时文件，验证后原子 rename。

恢复必须防 Zip Slip、压缩炸弹、缺文件、未来 schema 和 checksum 不一致。默认恢复到新工作区，不覆盖当前工作区。

## 8. 前端数据访问

### 8.1 Bootstrap

React 启动后先进入 `BackendGate`：

1. `invoke('backend_connection_info')`。
2. 构造 generated client 的 `baseUrl` 和 auth interceptor。
3. 请求 `/api/v1/meta` 验证 API 版本。
4. 注入 QueryClient 和 Router。
5. 渲染业务路由。

服务不可用时显示诊断页，不进入业务页面反复报错。

### 8.2 Query 规则

- `networkMode: 'always'`，因为互联网断开不应暂停 loopback 请求。
- 默认 retry 为 1；400/401/403/404 不 retry。
- mutation 成功后只失效有依赖的 query keys。
- 删除、恢复、备份不做乐观成功。
- Go 服务重启后清空业务 cache 并重新 bootstrap。
- 不持久化 Query cache；SQLite 已是本地事实源。

### 8.3 进度事件

备份、恢复、搜索重建和大文件复制返回 `202 Accepted + jobId`。前端订阅 `/jobs/{id}/events` 的 SSE：

```text
queued → running(stage, current, total) → succeeded | failed | cancelled
```

断流后用 job detail 恢复状态；SSE 不是唯一事实源。

## 9. 目录结构

```text
personal-workbench/
├── .github/
│   ├── dependabot.yml
│   └── workflows/
│       ├── ci.yml
│       ├── build-windows.yml
│       └── release.yml
├── api/
│   ├── openapi.yaml
│   └── examples/
├── apps/
│   └── desktop/
│       ├── src/
│       │   ├── app/
│       │   ├── components/ui/
│       │   ├── components/layout/
│       │   ├── features/
│       │   │   ├── archives/
│       │   │   ├── tasks/
│       │   │   ├── calendar/
│       │   │   ├── search/
│       │   │   ├── backup/
│       │   │   └── settings/
│       │   ├── generated/api/
│       │   ├── lib/http/
│       │   ├── routes/
│       │   ├── stores/
│       │   └── styles/
│       ├── src-tauri/
│       │   ├── binaries/
│       │   ├── capabilities/
│       │   ├── icons/
│       │   ├── src/
│       │   │   ├── sidecar_manager.rs
│       │   │   ├── commands.rs
│       │   │   ├── lifecycle.rs
│       │   │   ├── lib.rs
│       │   │   └── main.rs
│       │   ├── Cargo.toml
│       │   └── tauri.conf.json
│       ├── package.json
│       └── vite.config.ts
├── services/
│   └── workbenchd/
│       ├── cmd/workbenchd/main.go
│       ├── internal/
│       │   ├── api/
│       │   ├── app/
│       │   ├── archive/
│       │   ├── task/
│       │   ├── calendar/
│       │   ├── attachment/
│       │   ├── backup/
│       │   ├── search/
│       │   ├── storage/sqlite/
│       │   └── platform/
│       ├── migrations/
│       ├── testdata/
│       ├── go.mod
│       └── go.sum
├── scripts/
│   ├── build-sidecar.mjs
│   ├── verify-versions.mjs
│   └── package-portable.ps1
├── docs/
│   ├── architecture/
│   ├── decisions/
│   └── test-plans/
├── package.json
├── pnpm-workspace.yaml
├── pnpm-lock.yaml
├── Cargo.toml
├── Cargo.lock
└── rust-toolchain.toml
```

Go 遵守 `internal` 边界。`cmd/workbenchd` 只装配依赖；HTTP handler 只做协议转换；领域 package 不依赖 Chi、Tauri 或 React。

## 10. 构建和 GitHub Actions

### 10.1 CI

`ci.yml` 并行执行：

- Frontend：format、lint、TypeScript、Vitest、Vite build、OpenAPI generated drift。
- Go：`go mod verify`、`go vet ./...`、lint、unit/integration、race test（可运行平台）。
- Rust：fmt、clippy、thin host tests。
- Contract：lint OpenAPI，重新生成 Go/TS 文件并检查 git diff。
- Windows smoke：构建 Go target binary，Tauri debug/release smoke。

Go sidecar 必须先构建到正确 triple 路径，Tauri bundle 才能开始。

### 10.2 无签名构建

用户已决定仅自己使用，因此：

- 不配置 Windows code-signing certificate。
- 不使用 Tauri updater plugin；官方 updater 的 update signature 不能关闭。[Tauri Updater](https://v2.tauri.app/plugin/updater/)
- `createUpdaterArtifacts` 设置为 `false`。
- 不生成 `.sig` 或 `latest.json`。
- 不创建 `release-signing` GitHub Environment。
- GitHub Actions 不保存任何签名私钥或证书。
- Release 产出 unsigned NSIS、portable ZIP、SHA-256 和 SBOM。

Microsoft 说明 unsigned 文件通常显示“Windows protected your PC”，用户可在允许的环境中选择 Run anyway；企业策略或 Windows 11 Smart App Control 也可能完全阻止 unsigned 文件。[Microsoft SmartScreen](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/smartscreen-reputation)

这不是应用内部的“绕过安全检查”，而是用户对自己构建和下载文件的本机确认。每个新版本的 unsigned 文件都会重新缺少 publisher reputation。

### 10.3 手动更新

1. CI 构建新版本 unsigned 安装包。
2. 用户核对 GitHub Release 的 SHA-256。
3. 退出旧版本，确保 Go sidecar 已停止。
4. 运行新安装包并接受 Windows 提示。
5. 新版本启动时执行迁移前备份和 schema migration。

安装器必须覆盖/替换新的 sidecar。Release smoke 要验证安装后实际运行的 `workbenchd --version` 与桌面版本一致，防止旧 externalBin 被缓存或遗留。

## 11. UI 方向

UI 继续参考 [DBX](https://github.com/t8y2/dbx) 的持久侧栏、紧凑工具栏、可调分栏和 soft/sage 主题，但不复制 Vue 代码。

- 1280x800 默认窗口，960x640 最小窗口。
- 左侧 240px 导航，中央内容，右侧 344px inspector。
- 默认浅色 Sage Soft，功能色增加蓝、琥珀和柔和红。
- 常规卡片圆角不超过 8px，浮层可为 10-12px。
- 页面区块不做卡片墙，不使用渐变、光斑和营销 hero。
- Lucide 图标、键盘优先、稳定控件尺寸和完整空/错/加载状态。

Go sidecar 不影响前端渲染模型；React 仍是 Vite SPA，路由级懒加载，FullCalendar 独立 chunk。

## 12. 测试策略

### 12.1 Go

- 领域服务 table-driven tests。
- `httptest.Server` 验证 API、鉴权、CORS、错误结构和超时。
- SQLite 临时工作区集成测试。
- 迁移 fixture：空库、上一版本、中文数据、未来 schema。
- 备份故障注入：磁盘满、取消、附件改变、损坏 ZIP。
- race detector 检查后台 job 与 shutdown。

### 12.2 Rust

- ready line parser、version handshake 和状态机单元测试。
- sidecar 启动超时、异常退出和 graceful shutdown 集成测试。
- capability 快照测试，防止意外扩大权限。

### 12.3 React

- Generated client 与 bootstrap error mapping。
- Query invalidation 和 retry 行为。
- 页面 loading/empty/error/read-only/large dataset。
- Playwright 在 1440x900、1280x800、960x640 做浅/深主题截图。

### 12.4 安装包

干净 Windows VM 验证：

1. unsigned 警告后的手动安装。
2. sidecar 被正确打包并启动。
3. 随机端口和 token 可用。
4. 创建工作区、CRUD、备份和退出。
5. sidecar 进程不残留。
6. 用新安装包覆盖升级后版本一致。

## 13. 主要风险

| 风险 | 处理 |
| --- | --- |
| React 直连随机端口导致 CSP 范围变宽 | loopback-only、启动 token、Host/CORS 校验 |
| sidecar 残留 | Rust child handle、graceful shutdown、超时 kill、安装 smoke |
| SQLite 两个所有者 | 架构硬约束：只有 Go 打开数据库 |
| modernc 行为或性能不满足 | Iteration 0 gate；失败回退 CGO driver |
| OpenAPI generated code漂移 | CI 重新生成并 `git diff --exit-code` |
| Go/Rust/前端版本错配 | 启动 handshake + build-time version verification |
| unsigned 安装被阻止 | 个人设备手动允许；Smart App Control 下可能需调整系统策略或本地运行 portable |
| 无 updater | 手动下载、hash 校验、迁移前备份 |
| 三套工具链增加维护量 | Rust 极薄、Go 单模块、锁定 toolchain 和依赖 |
| 备份期间发生写入 | SQLite online backup + attachment manifest/checksum |

## 14. Iteration 0 必做 Spike

在业务编码前用 3-5 天完成一条真实链路：

1. Tauri Rust 启动 Go externalBin。
2. stdin bootstrap + stdout ready handshake。
3. React 获取连接信息并直连随机端口。
4. Token、CORS 和 CSP 在 dev/release 都生效。
5. modernc SQLite 建库、WAL、FTS5 trigram、在线备份。
6. OpenAPI 生成 Go strict server 与 TS Fetch client。
7. Windows unsigned NSIS 安装、覆盖升级和退出清理。
8. 服务崩溃、端口失败、迁移失败的诊断页。

只有这条链路通过后才创建正式 migration 001。Spike 代码可以演进为骨架，但实验性补丁和临时绕过不得直接进入主分支。

## 15. 最终技术决策表

| 决策 | 结果 |
| --- | --- |
| 桌面端 | Tauri 2 |
| UI | React 19 + Vite 8 + TypeScript |
| 核心服务 | 单个 Go sidecar `workbenchd` |
| 通信 | loopback REST/JSON + SSE |
| 契约 | OpenAPI 3.1，Go/TS 生成代码 |
| 监管 | Rust 启动、健康检查、退出和重启 |
| 数据所有权 | Go 独占 SQLite 和文件业务 |
| SQLite | modernc 候选，Spike 通过后锁定 |
| 迁移 | Goose embedded SQL |
| 搜索 | SQLite FTS5 trigram + 精确索引 |
| 更新 | 手动下载 unsigned 安装包 |
| updater | 不安装、不启用 |
| Windows 签名 | 不配置 |
| 发布目标 | 首版 Windows x64 |

## 16. 主要参考资料

### Tauri

- [Embedding External Binaries](https://v2.tauri.app/develop/sidecar/)
- [Shell Plugin](https://v2.tauri.app/plugin/shell/)
- [Single Instance](https://v2.tauri.app/plugin/single-instance/)
- [Content Security Policy](https://v2.tauri.app/security/csp/)
- [HTTP Headers and Tauri Origin](https://v2.tauri.app/security/http-headers/)
- [Tauri Releases](https://v2.tauri.app/release/)
- [Updater](https://v2.tauri.app/plugin/updater/)

### Go 与 API

- [Go Release History](https://go.dev/doc/devel/release)
- [go-chi/chi](https://github.com/go-chi/chi)
- [oapi-codegen](https://github.com/oapi-codegen/oapi-codegen)
- [Hey API OpenAPI TypeScript](https://github.com/hey-api/openapi-ts)
- [Goose Migrations](https://github.com/pressly/goose)

### 数据

- [modernc.org/sqlite](https://pkg.go.dev/modernc.org/sqlite)
- [mattn/go-sqlite3](https://github.com/mattn/go-sqlite3)
- [SQLite Backup API](https://www.sqlite.org/backup.html)
- [SQLite VACUUM INTO](https://www.sqlite.org/lang_vacuum.html)
- [SQLite FTS5](https://www.sqlite.org/fts5.html)

### 前端与发布

- [React Versions](https://react.dev/versions)
- [Vite 8](https://vite.dev/blog/announcing-vite8)
- [Node.js Releases](https://nodejs.org/en/about/previous-releases)
- [TanStack Query Network Mode](https://tanstack.com/query/latest/docs/framework/react/guides/network-mode)
- [Microsoft SmartScreen Reputation](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/smartscreen-reputation)
- [DBX](https://github.com/t8y2/dbx)

## 17. 文档维护规则

- 本文是当前唯一技术架构基线，不保留 Rust 领域核心兼容路径。
- Go sidecar 与 API 的关键变更先更新本文和 ADR。
- 依赖版本以 lockfile 为准；本文只记录经过调研的 major/minor 基线。
- 若未来重新启用签名或 updater，必须作为新的安全与发布决策，不保留空配置。
- 每次正式 Release 前重新验证 Tauri externalBin、Windows 安装器和 Go SQLite 驱动的已知问题。
