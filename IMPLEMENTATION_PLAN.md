# Tauri 2 + React + Go Sidecar 离线个人工作台：实施计划

> 计划日期：2026-08-30  
> 状态：可执行；当前尚未创建应用代码。  
> 技术依据：[RESEARCH.md](./RESEARCH.md)  
> 固定架构：Rust 监管，React 直连 Go loopback HTTP，Go 独占数据与文件。  
> 发布边界：个人使用，Windows unsigned 构建，不启用 updater。

## 0. 交付目标

MVP 是一个本地优先的个人管理工作台，以“档案”为核心实体，任务、日历、关系、附件和备份围绕档案组织。

最终交付物：

1. Windows x64 桌面应用和 unsigned NSIS 安装包。
2. Tauri 2 + React 的稳定桌面壳与完整业务页面。
3. 单个 Go sidecar `workbenchd`，承担全部领域和数据逻辑。
4. 明文 SQLite 工作区、托管附件和普通 ZIP 备份。
5. OpenAPI 3.1 契约以及生成的 Go/TypeScript 代码。
6. CI、Windows build 和 unsigned Release 工作流。
7. 安装、升级、备份、恢复和故障诊断测试。

预计按 9 个迭代完成，单个全职工程师容量约 10-13 周。每个迭代以退出门槛结束，不以日期强制结束。

## 1. 不可违反的架构规则

### 1.1 组件所有权

| 组件 | 拥有内容 | 不允许拥有 |
| --- | --- | --- |
| React | 页面、表单、路由、Query cache、布局状态 | SQLite、通用文件权限、sidecar 生命周期 |
| Rust | sidecar 启停、窗口、Dialog、Single Instance | 业务 CRUD、数据库迁移、搜索和备份 |
| Go | 领域逻辑、HTTP、SQLite、附件、备份、后台任务 | 窗口 UI、Tauri capability |

只有 Go 可以打开 `workbench.sqlite3`。任何需要 Rust 同时读取数据库的设计必须被拒绝或重新评审。

### 1.2 进程模型

- 一个 Tauri 主进程。
- 一个 WebView renderer。
- 一个直接 child `workbenchd`。
- 不启动数据库 server、消息队列或多个领域服务。
- 前端刷新不能重启 sidecar。
- 第二个桌面实例只聚焦主窗口，不启动第二个 Go 服务。

### 1.3 发布模型

- 不进行 Windows Authenticode 签名。
- 不生成或验证 Tauri updater signature。
- 不安装 updater plugin。
- 用户通过新安装包手动覆盖升级。
- 每次升级前自动创建数据库恢复快照。

## 2. 产品范围

### 2.1 MVP 必须包含

- 工作区创建、打开、最近列表、锁和健康检查。
- 今日页：逾期、今天、日程、最近档案。
- 任务：状态、优先级、计划时间、截止时间、档案关系。
- 日历：月/周/日、全天、跨日、拖拽调整。
- 档案类型与个人、企业、事件三套初始模板。
- 档案列表、详情、动态字段、Markdown 正文和关系。
- 托管附件的导入、打开、移除和备份。
- 全局搜索和命令面板。
- 手动备份、自动备份、校验、恢复预检和恢复。
- 回收站、设置、深浅主题和日志诊断。

### 2.2 后置

- 多端同步、账号、云端协作。
- 移动端；Tauri desktop sidecar 模型不能直接复用到移动端。
- 数据与附件加密。
- OCR、AI、邮件、CalDAV、浏览器插件。
- 多窗口、自由分栏和完整多标签工作区。
- 复杂自动化和脚本插件。
- Go 服务对局域网或公网开放。

### 2.3 固定业务语义

- 事件档案与日历事件是两类实体。
- 任务计划时间与截止时间分开。
- 删除默认进入回收站。
- 身份证等敏感值明文存储，但 UI 默认脱敏。
- 默认托管附件；外部引用明确标注可能不在备份中。
- 备份使用 SQLite 一致快照，禁止复制活跃数据库文件。

## 3. 工程初始化

### 3.1 仓库结构

```text
personal-workbench/
├── api/openapi.yaml
├── apps/desktop/
│   ├── src/
│   ├── src-tauri/
│   │   ├── binaries/
│   │   ├── capabilities/
│   │   └── src/
│   ├── package.json
│   └── vite.config.ts
├── services/workbenchd/
│   ├── cmd/workbenchd/
│   ├── internal/
│   ├── migrations/
│   ├── testdata/
│   ├── go.mod
│   └── go.sum
├── scripts/
├── docs/
├── .github/workflows/
├── package.json
├── pnpm-workspace.yaml
├── Cargo.toml
└── rust-toolchain.toml
```

### 3.2 工具链固定

| 工具 | 初始基线 |
| --- | --- |
| Node | 24 LTS |
| pnpm | 创建时的稳定版，写入 `packageManager` |
| React | 19.2.x |
| Vite | 8.x |
| TypeScript | 5.9.x |
| Tauri | 2.11.x 兼容 patch 组合 |
| Go | 1.26.7 |
| Rust | 与 Tauri 组合验证后的 stable |

提交 `pnpm-lock.yaml`、`Cargo.lock`、`go.mod` 和 `go.sum`。CI 禁止浮动安装。

### 3.3 根脚本

```text
pnpm dev                 # 构建/启动开发 sidecar + tauri dev
pnpm check               # 前端 + Go + Rust + contract
pnpm generate            # Go/TS OpenAPI code generation
pnpm build:sidecar       # 根据 host triple 构建 workbenchd
pnpm build:windows       # sidecar + Tauri NSIS
pnpm test:smoke          # Windows 桌面 smoke
```

根脚本只做编排，不在 JavaScript 内实现业务逻辑。

## 4. Go Sidecar 实施

### 4.1 包结构

```text
services/workbenchd/
├── cmd/workbenchd/main.go        # signal、bootstrap、wiring
├── internal/
│   ├── api/                      # generated types、handlers、middleware
│   ├── app/                      # application services、unit of work
│   ├── archive/
│   ├── task/
│   ├── calendar/
│   ├── attachment/
│   ├── backup/
│   ├── search/
│   ├── job/
│   ├── storage/sqlite/
│   └── platform/                 # clock、id、filesystem adapters
├── migrations/
└── testdata/
```

依赖方向：

```text
api handler → application service → domain → repository interface
                                      ↑
                         sqlite/filesystem adapters
```

领域 package 不 import Chi、generated API 或 SQLite driver。

### 4.2 进程入口

`main.go` 只完成：

1. 从 stdin 读取一条限制大小的 bootstrap JSON。
2. 验证 protocol、token、workspace 和 app version。
3. 初始化日志、数据库、迁移和 services。
4. 绑定 `127.0.0.1:0`。
5. 输出一条 ready JSON。
6. 运行 HTTP server 和后台 job manager。
7. 接收 shutdown 并按顺序清理。

启动 10 秒未 ready 视为失败；正常启动目标小于 3 秒。

### 4.3 配置

运行配置不读取 `.env` 文件。生产必需配置来自 Rust bootstrap；用户设置来自工作区数据库。

允许的开发环境变量必须以 `WORKBENCH_DEV_` 开头，并在 release build 中忽略危险选项，例如开放监听地址、pprof 和无鉴权模式。

### 4.4 日志

- 使用 `slog` JSON handler。
- stderr 供 Rust 收集和滚动写入日志文件。
- 每条记录包含 serviceVersion、level、component、traceId。
- 不记录 token、请求 body、正文、身份证号和完整附件路径。
- stdout 严禁普通日志。

## 5. Rust 监管实施

### 5.1 模块

```text
src-tauri/src/
├── sidecar_manager.rs
├── bootstrap.rs
├── lifecycle.rs
├── commands.rs
├── error.rs
├── lib.rs
└── main.rs
```

`SidecarManager` 状态：

```text
Stopped | Starting | Ready(ConnectionInfo) | Stopping | Failed(Diagnostic)
```

状态放入 `tauri::State<Mutex<...>>` 或等价同步原语，禁止用多个全局变量分别记录 child、port 和 token。

### 5.2 唯一前端命令

常规业务不走 Tauri commands。允许的窄命令：

- `backend_connection_info`
- `backend_diagnostics`
- `select_workspace_directory`
- `select_attachment_files`
- `select_backup_destination`
- `reveal_log_directory`

Dialog 命令只返回用户选择结果，不读取文件内容。连接 token 只存在内存。

### 5.3 Capability

WebView 不获得 shell spawn/kill、任意 fs、process 或 updater 权限。Rust 内部使用 sidecar 和 Dialog plugin。

每次修改 capability 文件必须在 PR 中解释业务原因，并由快照测试阻止权限意外扩大。

### 5.4 生命周期

- Single Instance 插件必须早于 sidecar setup。
- 主窗口 `visible: false`，ready 后显示。
- 启动失败显示 Tauri 内置错误路由，不无限 loading。
- 退出时先 graceful shutdown，5 秒后 kill。
- Go 异常退出时通知 React 进入 service-lost 页面。
- 自动重启最多两次，并使用短退避；迁移/恢复阶段不自动重启。

## 6. HTTP 与 OpenAPI 实施

### 6.1 契约优先

先更新 `api/openapi.yaml`，再生成代码，再实现 handler。禁止先写一个未记录的 handler 后补文档。

生成输出：

- Go：models、Chi server、strict server interface。
- TypeScript：models、Fetch SDK。
- generated 文件提交到仓库，CI 检查 drift。
- generated 文件禁止手改。

### 6.2 API middleware 顺序

```text
Recoverer
→ Request ID
→ Security headers
→ Host validation
→ CORS
→ Authentication
→ Body limit
→ Timeout/context
→ Access log
→ Handler
```

Recoverer 只返回通用 500 和 traceId，不回传 stack。

### 6.3 鉴权

- Rust 每次启动生成 256-bit token。
- stdin 传入 Go。
- React bootstrap 时从 Rust 内存取得。
- 所有 `/api/v1` 和 `/internal` 请求使用 Bearer token。
- `/healthz` 只返回 `alive: true`，不返回路径、workspace 和版本细节。
- token 不落盘、不进入 URL 或 LocalStorage。

### 6.4 CORS/CSP

开发允许当前 Vite origin；production 允许 Tauri origin。任何其他 `Origin` 拒绝。

CSP 允许：

```text
default-src 'self'
connect-src 'self' ipc: http://ipc.localhost http://127.0.0.1:* 
img-src 'self' asset: http://asset.localhost blob: data:
style-src 'self' 'unsafe-inline'
```

实际配置根据 Tauri 生成内容校验，不把 `csp` 设为 `null`。

### 6.5 API 错误

统一错误字段：`status`、`code`、`title`、`detail`、`traceId`、可选字段错误。React 根据 `code` 决定 UI，不解析英文 `detail`。

## 7. SQLite 与迁移实施

### 7.1 Driver gate

Iteration 0 用 `modernc.org/sqlite` 完成：

- Windows release binary 启动。
- WAL/foreign keys/busy timeout。
- FTS5 trigram 中文样本。
- online backup 和 restore。
- 10 万实体 benchmark。
- race test 和异常关闭。

全部通过才写 ADR-003 锁定 driver；否则切换 `mattn/go-sqlite3 + sqlite_fts5` 并更新 Windows 构建链。

### 7.2 Schema 001

首个迁移创建：

| 表 | 说明 |
| --- | --- |
| `workspace_meta` | workspace/schema/app metadata |
| `archive_types` | 档案类型 |
| `field_definitions` | 动态字段定义 |
| `archives` | 档案固定字段和 Markdown |
| `archive_field_values` | typed EAV 值 |
| `tasks` | 任务与时间 |
| `calendar_events` | 日历事件 |
| `entity_relations` | 类型化关系 |
| `attachments` | 文件元数据和相对路径 |
| `tags`, `entity_tags` | 标签 |
| `backup_runs` | 备份历史 |
| `trash_entries` | 软删除索引 |
| `change_log` | 本地审计和 Undo |

FTS 表可在单独 migration 002 创建，避免 driver spike 与核心 schema 相互阻塞。

### 7.3 事务规则

- 一个 API mutation 对应一个 application transaction。
- 多表写入和 change log 同一事务。
- 附件采用“临时文件 → hash → rename → DB transaction”的补偿流程。
- HTTP context 取消必须 rollback。
- 所有删除先软删除。

### 7.4 ID 与时间

- ID 在 Iteration 0 选择 UUIDv7 或 ULID，并锁定。
- 时间点保存 UTC RFC3339/nanoseconds 或等价整数。
- 日历另存 IANA timezone。
- 纯日期保存 `YYYY-MM-DD`。
- 数据库和 API 不用本地化日期字符串。

## 8. 前端实施

### 8.1 启动树

```text
RootErrorBoundary
└── BackendGate
    ├── StartingScreen
    ├── DiagnosticScreen
    └── ApiProvider
        └── QueryClientProvider
            └── RouterProvider
                └── AppShell
```

`BackendGate` 完成前不创建业务 queries。

### 8.2 状态边界

| 状态 | 保存位置 |
| --- | --- |
| 业务实体 | TanStack Query |
| 筛选、日期范围 | Router search params |
| 侧栏、inspector、主题 | Zustand |
| 编辑草稿 | React Hook Form |
| connection token | 内存 ApiProvider |

Query Client：`networkMode: 'always'`、默认 retry 1、关闭无意义的 reconnect refetch；服务重启后 clear cache。

### 8.3 路由

```text
/onboarding
/today
/tasks
/calendar
/archives
/archives/$archiveId
/archive-types
/backup
/trash
/settings/$section
/diagnostics
```

FullCalendar、Markdown editor、备份页独立 route chunk。首屏不加载它们。

### 8.4 生成客户端封装

`src/lib/http/client.ts` 只负责：

- base URL 和 Authorization。
- request ID。
- problem detail 转换。
- 401 触发重新 bootstrap。
- AbortSignal 传播。

各 feature 在 `queries.ts` 定义 query keys/options，在 `mutations.ts` 定义失效关系。不要建立一个全局巨大 API hooks 文件。

## 9. UI 与页面计划

### 9.1 壳层

```text
原生标题栏
44px 应用命令栏
├── 240px 主侧栏
├── min 560px 主内容
└── 344px 可关闭 inspector
```

- 默认窗口 1280x800，最小 960x640。
- 面板宽度可调整并持久化。
- 小于 1120px 时 inspector 变抽屉。
- 小于 960px 时侧栏折叠为 56px 图标轨道。
- MVP 使用原生标题栏，不实现 Overlay 自绘标题栏。

### 9.2 主题

默认 Sage Soft：

| Token | 值 |
| --- | --- |
| background | `#F8FAF8` |
| chrome | `#F4F6F5` |
| sidebar | `#F0F4F1` |
| surface | `#FFFFFF` |
| foreground | `#24302B` |
| muted | `#61716A` |
| border | `#DCE5E0` |
| primary | `#3A7B6A` |
| info | `#527A9E` |
| warning | `#A96F2D` |
| danger | `#AD5959` |

常规卡片和控件圆角不超过 8px；浮层 10-12px。页面 section 不做卡片，阴影只用于菜单和 dialog。

### 9.3 今日

- 日期、快速新增。
- 逾期、今天、稍后任务。
- 今日日程时间线。
- 最近档案。
- 完成任务提供短时 Undo。

### 9.4 任务

- 收件箱、今天、即将到来、已完成筛选。
- 列表/紧凑表格视图。
- inspector 编辑状态、计划、截止、优先级、关系和备注。
- 完成操作幂等。

### 9.5 日历

- 月/周/日切换。
- 日历事件、计划任务、截止标记使用不同视觉语义。
- 拖拽/resize 失败回滚。
- 重复编辑语义未完整前不启用。

### 9.6 档案

- 类型 tabs、搜索、筛选、排序、表格/卡片切换。
- 详情包含正文、属性、关系、任务、日程、附件和活动。
- 敏感字段默认遮罩，离开页面恢复。
- 动态字段按组折叠。

### 9.7 搜索

- `Ctrl/Cmd+K` 打开命令面板。
- 搜索档案、任务、事件、附件名。
- 结果按类型分组。
- FTS 不可用时显示重建状态和基础 fallback。

### 9.8 备份

- 目录、上次成功、计划和保留数量。
- 立即备份展示 SSE 阶段进度。
- 恢复必须先 preflight。
- 默认恢复到新工作区。

## 10. 附件、后台任务和备份

### 10.1 附件导入

1. React 调用窄 Tauri dialog command。
2. 用户选择一个或多个路径。
3. React POST 路径到 Go。
4. Go canonicalize 和权限检查。
5. 流式复制、SHA-256、临时文件。
6. 原子 rename。
7. DB transaction 写 attachment。

取消和失败清理临时文件。附件显示名可以重复，磁盘目录使用 UUID 隔离。

### 10.2 Job Manager

只处理：附件复制、备份、恢复、搜索重建和大批量导出。

- 每个 job 有 ID、type、state、progress、startedAt、finishedAt。
- 同一工作区恢复只允许一个。
- 备份与恢复互斥。
- 可取消任务必须定期检查 context。
- 完成状态持久化，SSE 只是通知。

### 10.3 备份

1. 取得 backup mutex。
2. SQLite online backup 到临时目录。
3. 固定附件 manifest。
4. 复制附件并计算 SHA-256。
5. 写 manifest 和 ZIP。
6. 解包/校验 ZIP。
7. 原子移动到目标。
8. 写 backup run。
9. 保留最近 10 份成功备份。

失败备份不得触发删除成功备份。

### 10.4 恢复

- 限制文件数、解压总大小和压缩比。
- 防止绝对路径、`..` 和符号链接逃逸。
- 校验全部 checksum。
- 检查 schema 和 SQLite integrity。
- 默认创建新 workspace。
- 覆盖当前 workspace 必须先做恢复前备份，并支持原样回滚。

## 11. GitHub Actions

### 11.1 `ci.yml`

触发 main 的 PR/push，配置 concurrency cancel。

| Job | 内容 |
| --- | --- |
| `changes` | frontend/go/rust/api 路径分类 |
| `frontend` | pnpm frozen install、format、lint、typecheck、test、build |
| `go` | mod verify、vet、lint、test、race |
| `rust` | fmt、clippy、test |
| `contract` | OpenAPI lint、generate、git diff |
| `windows-smoke` | sidecar target build + Tauri smoke |
| `required` | 汇总 branch protection gate |

第三方 actions 固定 commit SHA，并由 Dependabot 更新。

### 11.2 `build-windows.yml`

手动触发和 main 里程碑构建：

1. Setup Node 24 LTS、pnpm、Go 1.26.7、Rust。
2. 运行 contract generation check。
3. `GOOS=windows GOARCH=amd64` 构建 sidecar。
4. 重命名到 Tauri externalBin triple 路径。
5. 验证 `workbenchd --version`。
6. Vite build。
7. Tauri unsigned NSIS build。
8. 安装/启动 smoke。
9. 上传 NSIS、portable ZIP、SHA-256、SBOM，保留 14 天。

若采用 modernc，目标是 `CGO_ENABLED=0`。若回退 go-sqlite3，workflow 必须增加明确的 C compiler 和 target 验证。

### 11.3 `release.yml`

tag `vX.Y.Z` 触发：

- 校验 package、Cargo、Go build info 和 tauri config 版本一致。
- 运行完整 CI。
- 创建 draft Release。
- 构建 unsigned NSIS 与 portable ZIP。
- 计算 SHA-256、生成 SBOM。
- 在干净 Windows VM 做覆盖安装与 sidecar 版本验证。
- 全部通过后发布 draft。

明确不包含：

- Authenticode。
- 证书或 signing environment。
- Tauri signing key。
- updater artifacts、`.sig`、`latest.json`。
- 静默安装或自动更新。

### 11.4 无签名验收

- 安装包 Publisher 显示 Unknown 是预期行为。
- 用户可以在其个人 Windows 环境中手动确认运行。
- Windows Smart App Control 或组织策略可能禁止继续，应用不承诺绕过系统策略。
- 发布页必须提供 SHA-256，用户至少可以核对传输完整性。
- 应用 UI 不显示“已验证发布者”或“安全签名”等错误声明。

## 12. 测试矩阵

### 12.1 API

- 正确 token、缺 token、错误 token。
- 允许和拒绝的 Origin/Host。
- body limit、timeout、cancel、panic recover。
- problem detail 格式。
- OpenAPI response conformance。

### 12.2 生命周期

- sidecar 文件缺失。
- bootstrap JSON 错误。
- ready 超时或版本不匹配。
- 端口绑定失败。
- migration 失败。
- 运行期崩溃。
- graceful shutdown 和 kill fallback。
- UI 刷新与第二实例。

### 12.3 数据

- 空库和逐版本 migration。
- 中文姓名、企业名、证件号搜索。
- 10 万档案/任务性能。
- WAL 并发读写。
- 附件导入中断和重复文件名。
- 备份/恢复故障注入。

### 12.4 UI

- loading、empty、normal、large、error、read-only。
- 1440x900、1280x800、960x640。
- 浅色和深色。
- 键盘、focus、screen reader name。
- 长中文标题、企业全称和路径不溢出。

### 12.5 安装

- 干净 Windows 10/11 x64。
- unsigned SmartScreen 提示后的手动运行。
- NSIS current-user 安装。
- 覆盖升级。
- 卸载不删除用户工作区。
- 退出后无 `workbenchd.exe` 残留。

## 13. 迭代路线

### Iteration 0：架构 Spike（3-5 天）

交付：

- Tauri 启动 Go sidecar。
- stdin/stdout versioned handshake。
- React 随机端口直连。
- token、CORS、CSP。
- modernc WAL、FTS5 trigram、backup。
- OpenAPI 双端 codegen。
- unsigned NSIS 安装与退出清理。

退出门槛：dev 和 installed build 均通过端到端链路；SQLite driver 有书面 ADR；无残留进程。

### Iteration 1：工程骨架与工作区（1 周）

交付：

- 完整仓库结构和工具链锁定。
- Rust SidecarManager 状态机。
- Go API middleware、日志和错误。
- React BackendGate/AppShell。
- workspace 初始化、锁、迁移框架。
- CI 基线。

退出门槛：新建、关闭、重开工作区；启动失败可诊断；CI 全绿。

### Iteration 2：档案纵向切片（1.5 周）

交付：

- migration 001/002。
- 档案类型、字段、档案 API。
- OpenAPI generated client。
- 档案列表、详情和 inspector。
- 个人、企业、事件模板。

退出门槛：三种模板完整 CRUD；动态字段往返；敏感值默认遮罩。

### Iteration 3：关系与附件（1 周）

交付：

- 类型化关系。
- 原生选择 + Go 文件导入。
- job/SSE 基础。
- 回收站基础。

退出门槛：失败不产生半文件或悬挂记录；路径攻击测试通过。

### Iteration 4：任务与今日（1.5 周）

交付：

- 任务 API 和 UI。
- 计划/截止语义。
- 今日页、快速新增、完成 Undo。
- 档案关系联动。

退出门槛：任务在三个页面状态一致；跨日与时区测试通过。

### Iteration 5：日历（1.5 周）

交付：

- 月/周/日查询和 UI。
- 事件 CRUD、全天、跨日。
- 拖拽、resize 和失败回滚。
- 任务计划与截止差异展示。

退出门槛：日历性能达标；拖拽错误不丢数据；重复规则不做半实现。

### Iteration 6：搜索和效率（1 周）

交付：

- FTS、精确索引、重建 job。
- 命令面板和最近使用。
- 键盘快捷键。

退出门槛：10 万实体 P95 目标达成；索引损坏可重建；中文样本召回达标。

### Iteration 7：备份与恢复（1.5 周）

交付：

- online backup、附件 manifest、ZIP/checksum。
- 自动备份和保留策略。
- restore preflight、新工作区恢复、覆盖保护。
- 完整 SSE 进度和取消。

退出门槛：故障注入不破坏现有备份；恢复实体和附件 checksum 一致。

### Iteration 8：硬化和 unsigned Release（1-1.5 周）

交付：

- E2E、视觉、性能、可访问性修复。
- unsigned NSIS、portable、SHA-256、SBOM。
- 覆盖升级与 sidecar 版本检查。
- 手动更新和 Windows 提示说明。

退出门槛：干净 Windows 可完成安装、启动、CRUD、备份、升级和卸载；无残留进程；tag 可复现发布。

## 14. ADR 清单

Iteration 0/1 必须完成：

- ADR-001：Go sidecar 与 Rust/React 所有权。
- ADR-002：loopback HTTP、token、CORS 和 CSP。
- ADR-003：Go SQLite driver。
- ADR-004：OpenAPI code generation。
- ADR-005：ID 与时间格式。
- ADR-006：附件托管和路径边界。
- ADR-007：unsigned 分发、无 updater 和手动升级。
- ADR-008：备份快照算法。

## 15. 完成定义

每个 feature 必须满足：

- OpenAPI 契约、Go handler、领域逻辑和前端行为一致。
- 业务 validation 由 Go 权威执行，React validation 服务于交互。
- loading/empty/error/large states 完成。
- 没有新增未说明的 Tauri capability。
- token、正文、证件号和完整路径不进入日志。
- Go/Rust/React 必要测试齐全。
- 浅/深主题和三个 viewport 无重叠、溢出和布局跳动。
- 键盘和 focus 行为可用。
- generated code 无 drift。
- CI required gate 通过。

## 16. 风险与对策

| 风险 | 对策 |
| --- | --- |
| sidecar 启停不稳定 | 单一 manager 状态机、ready 协议、timeout 和 smoke |
| 随机端口 CSP 较宽 | loopback、token、Host/CORS 和最小 API |
| token 暴露在 WebView 内存 | 不落盘、不进 URL；XSS 防护和严格 CSP |
| modernc 不满足 FTS/性能 | Spike gate 和 go-sqlite3 回退方案 |
| API codegen 侵入业务 | generated 只放协议层，领域层手写 |
| 三工具链 CI 慢 | jobs 并行、路径过滤、缓存；不提前上复杂 sccache |
| externalBin 版本陈旧 | build 前清理目标、版本 handshake、安装后检查 |
| unsigned 被 Windows 阻止 | 个人设备手动确认；记录 Smart App Control 限制 |
| 无自动更新 | 手动 Release、SHA-256、迁移前快照 |
| 动态字段查询退化 | typed EAV、固定高频列、benchmark |
| 备份附件变化 | manifest 固定、checksum、失败重试、原子发布 |

## 17. 开始实施前只需确认

不阻塞 Spike 的信息：

1. 产品中文名、英文名和 Tauri identifier。
2. 默认工作区与备份目录是否由首次启动选择。
3. Windows 最低版本；建议 Windows 10 22H2。
4. GitHub Release 是否公开；即使 private，也不改变 unsigned 决策。
5. 自动备份默认触发方式；建议每日首次启动后空闲 5 分钟。

其他架构和技术边界已经锁定，无需为 Rust 领域核心保留兼容实现。

## 18. 第一批 PR

### PR 1：Spike

- 最小 React 页面。
- Rust SidecarManager 原型。
- Go `/healthz` 和 `/api/v1/meta`。
- 随机端口/token/CORS/CSP。
- OpenAPI codegen。
- modernc 测试和 unsigned NSIS。

### PR 2：正式骨架

- 清理 Spike 临时代码。
- 固化目录、错误、日志和测试 helpers。
- CI/build workflows。
- ADR-001 至 ADR-004。
- 不包含业务 schema。

### PR 3：工作区与 Schema

- migration 001/002。
- workspace API。
- 三种档案类型 seed。
- 档案纵向切片起点。

通过这种拆分，进程边界、HTTP 安全、SQLite driver 和 unsigned 打包会在业务代码增长前得到真实验证。

## 19. 参考链接

- [技术调研与架构基线](./RESEARCH.md)
- [Tauri External Binaries](https://v2.tauri.app/develop/sidecar/)
- [Tauri CSP](https://v2.tauri.app/security/csp/)
- [Tauri Updater 签名要求](https://v2.tauri.app/plugin/updater/)
- [Go Release History](https://go.dev/doc/devel/release)
- [modernc.org/sqlite](https://pkg.go.dev/modernc.org/sqlite)
- [oapi-codegen](https://github.com/oapi-codegen/oapi-codegen)
- [SQLite Backup API](https://www.sqlite.org/backup.html)
- [Microsoft SmartScreen](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/smartscreen-reputation)
- [DBX UI 参考](https://github.com/t8y2/dbx)

## 20. 维护规则

- 本计划直接代表当前方案，不保留旧的 Rust 业务链路。
- 关键架构变化先更新调研、计划和 ADR，再实施代码。
- 依赖精确 patch 以 lockfile 为准。
- updater 和签名相关代码保持不存在，而不是保留禁用但未测试的配置。
- 每次迭代结束记录退出门槛结果；未达成项目不得假装完成。
