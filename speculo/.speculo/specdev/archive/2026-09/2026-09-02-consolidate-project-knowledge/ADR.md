# Personal Workbench 架构决策候选

## ADR-001: 单个 Go sidecar 与分层所有权

**Status:** accepted
**Source:** `<Path>docs/decisions/ADR-001-process-ownership.md</Path>`；CODE:<Path>apps/desktop/src-tauri/src/lib.rs</Path>；CODE:<Path>services/workbenchd/internal/api/server.go</Path>
**Supersedes:** none

### Context
桌面壳、WebView 呈现和本地领域/数据逻辑需要清楚的进程及所有权边界。纯 Rust 领域核心会牺牲 Go 的服务与测试生态，多服务拆分会给单用户离线应用引入不必要的部署和一致性成本。

### Decision
一个 Tauri/Rust 桌面宿主管理一个模块化 Go sidecar `workbenchd`；React 拥有呈现，Rust 拥有桌面生命周期、原生对话框和工作区注册，Go 独占领域逻辑、HTTP、SQLite、托管文件、搜索、Job、备份与恢复。常规业务 CRUD 不经过 Tauri command。

### Trade-off
接受三套工具链、子进程监管和 HTTP 安全边界，换取领域逻辑与桌面壳解耦、Go 独立测试能力以及单一数据 owner。

### Consequences
只有 Go 打开工作区数据库；Rust 必须实现 Bootstrap/Ready、版本核对、恢复和优雅关闭；窄 Rust 文件命令可以选择或打开路径，但不拥有业务路径构造和元数据。

### Verification / Migration
Rust command surface 位于 `<Path>apps/desktop/src-tauri/src/lib.rs</Path>`，业务路由位于 `<Path>services/workbenchd/internal/api/server.go</Path>`，数据库打开位于 `<Path>services/workbenchd/internal/storage/sqlite/store.go</Path>`。

## ADR-002: Loopback HTTP Bootstrap 安全边界

**Status:** accepted
**Source:** `<Path>docs/decisions/ADR-002-loopback-security.md</Path>`；CODE:<Path>apps/desktop/src-tauri/src/bootstrap.rs</Path>；CODE:<Path>services/workbenchd/internal/api/middleware.go</Path>
**Supersedes:** none

### Context
React 直连本地 HTTP 能复用标准 Fetch/OpenAPI 工具，但随机 TCP 端口和 WebView 暴露面弱于纯 IPC，需要纵深补偿控制。

### Decision
workbenchd 只绑定随机 `127.0.0.1` 端口。Rust 为应用/工作区 Bootstrap 生成 32-byte token，经 stdin 发送；受监管 sidecar 自动恢复和 retry 当前复用同一 Bootstrap/token。受保护路由验证 Host、Origin 和 Bearer，token 仅驻留 Rust、sidecar 与 WebView 内存。

### Trade-off
接受 CSP 允许 loopback 随机端口、WebView 持有 token、以及对同 OS 用户权限恶意进程并非强隔离，换取标准 HTTP 调试、生成 client 和 Go 服务的独立可测性。

### Consequences
`/healthz` 只暴露最小匿名存活信息；连接信息只能经窄 Tauri command 获取；token 不得进入参数、URL、日志、LocalStorage 或工作区文件。工作区切换会生成新 Bootstrap，单纯 sidecar 重启不会轮换 token。

### Verification / Migration
Bootstrap 与 token 见 `<Path>apps/desktop/src-tauri/src/bootstrap.rs</Path>`，Ready 核验与重启见 `<Path>apps/desktop/src-tauri/src/sidecar_manager.rs</Path>`，middleware 拒绝行为见 `<Path>services/workbenchd/internal/api/middleware_test.go</Path>` 与 `<Path>services/workbenchd/internal/api/server_test.go</Path>`。

## ADR-003: Pure-Go SQLite 与能力基线

**Status:** accepted
**Source:** `<Path>docs/decisions/ADR-003-sqlite-driver.md</Path>`；CODE:<Path>services/workbenchd/go.mod</Path>；CODE:<Path>scripts/build-sidecar.mjs</Path>
**Supersedes:** none

### Context
SQLite driver 同时约束桌面构建链、FTS、在线快照、迁移和关闭行为。CGO driver 能提供成熟 SQLite 绑定，但会显著增加 Windows/macOS 构建复杂度。

### Decision
使用 `modernc.org/sqlite` 并以 `CGO_ENABLED=0` 构建 sidecar。项目依赖 WAL、foreign keys、busy timeout、FTS5 trigram、Online Backup、Goose migration、integrity check 与退出 checkpoint 作为驱动能力基线。

### Trade-off
换取无需 C toolchain 的跨平台构建和现代 SQLite 能力，接受 modernc 特定 Backup API、较大的纯 Go 依赖以及对 driver 行为持续验证的责任。

### Consequences
切换 driver 会同时影响构建、搜索、迁移和备份实现。当前代码配置了这些能力，但现有 CI 没有在 Windows 多连接场景逐项证明 foreign keys、busy timeout、并发 Online Backup 和 checkpoint；不得把能力合同误写成完整 gate 已通过。

### Verification / Migration
实现见 `<Path>services/workbenchd/internal/storage/sqlite/store.go</Path>`、`<Path>services/workbenchd/migrations/001_core.sql</Path>` 和 `<Path>services/workbenchd/internal/backup/manager.go</Path>`；当前显式测试覆盖 WAL、FTS、工作区锁和备份恢复，完整 Windows capability gate 仍是残余验证风险。

## ADR-004: OpenAPI-first 跨语言契约

**Status:** accepted
**Source:** `<Path>docs/decisions/ADR-004-openapi-generation.md</Path>`；CODE:<Path>api/openapi.yaml</Path>；CODE:<Path>scripts/generate-go.mjs</Path>
**Supersedes:** none

### Context
React 与 Go 共享大量请求、响应和错误模型；双端手写类型会形成漂移。WebView 直接使用标准 HTTP，使 OpenAPI 比额外 RPC 栈更贴合现有边界。

### Decision
`api/openapi.yaml` 保持 OpenAPI 3.1 设计契约。TypeScript 直接生成 Fetch client；Go 当前通过确定性的临时 3.0.3 nullable transform 生成模型和 strict-server 投影；生成物提交仓库并由 CI 重生成检查 drift。

### Trade-off
接受生成物体积、pinned generator 和临时兼容 transform 的维护成本，换取跨语言共享 schema、客户端一致性和可审计契约演进。

### Consequences
契约变更顺序是 schema、generate、runtime implementation。当前 TypeScript runtime 使用生成 client，但 Go server 仍手工注册路由且没有接入生成的 strict interface，因此 OpenAPI 对 Go runtime 的强制一致性尚不完整；drift gate 不能替代 conformance test。

### Verification / Migration
契约与生成配置见 `<Path>api/openapi.yaml</Path>`、`<Path>apps/desktop/package.json</Path>`、`<Path>scripts/generate-go.mjs</Path>` 和 `<Path>services/workbenchd/internal/api/generated/oapi-codegen.yaml</Path>`；手工 Go 路由边界见 `<Path>services/workbenchd/internal/api/server.go</Path>`。

## ADR-005: 持久标识符与时间语义

**Status:** accepted
**Source:** `<Path>docs/decisions/ADR-005-identifiers-and-time.md</Path>`；CODE:<Path>services/workbenchd/internal/platform/identity.go</Path>
**Supersedes:** none

### Context
标识符和时间格式跨越 API、SQLite、排序、备份与未来迁移，改变成本高。纯日期、时间点和用户日历时区具有不同语义，不能混用本地化字符串。

### Decision
运行时创建的业务记录通过集中 helper 生成，目标为 UUIDv7，当前生成失败时退回 UUIDv4；内置档案类型和字段定义使用稳定语义 slug。时间点保存为 UTC RFC3339 nanoseconds，可排程 Task 另存 IANA timezone，动态 `date` 字段保存严格 `YYYY-MM-DD`。

### Trade-off
UUIDv7 提供大致时间有序且跨层通用的 ID，UTC 加 IANA timezone 保留精确时点和用户日历语义；代价是展示层必须显式转换，且当前 UUIDv4 fallback 使“所有运行时 ID 必为 v7”不成立。

### Consequences
不得把纯日期转换为 UTC 午夜；Calendar 语义属于 scheduled Task，不存在独立 calendar record；若未来要求严格 UUIDv7，需要移除或隔离 fallback 并新增版本验证。

### Verification / Migration
ID/time helper 位于 `<Path>services/workbenchd/internal/platform/identity.go</Path>`，Task timezone 验证位于 `<Path>services/workbenchd/internal/task/model.go</Path>`，动态日期验证位于 `<Path>services/workbenchd/internal/storage/sqlite/archives.go</Path>`。

## ADR-006: 托管附件所有权与原子导入

**Status:** accepted
**Source:** `<Path>docs/decisions/ADR-006-managed-attachments.md</Path>`；CODE:<Path>services/workbenchd/internal/attachment/manager.go</Path>
**Supersedes:** none

### Context
外部文件引用无法保证备份完整、生命周期和路径安全；让 WebView 直接管理文件会扩大 capability 并产生多个 owner。

### Decision
Go canonicalize 用户选择的源路径，限制文件类型与大小，流式计算 SHA-256 写入 UUID-scoped 临时路径，sync 后原子 rename，再以数据库事务提交相对路径元数据。UI 只传选择结果，不构造托管路径。

### Trade-off
换取可备份、可校验和受控打开，接受复制占用磁盘、文件系统与数据库只能使用补偿一致性，以及崩溃窗口可能留下孤儿文件。

### Consequences
当前托管附件只归属于档案；批导入正常失败会清理已复制文件和回滚元数据；打开时 Go 与 Rust 都必须检查路径没有逃逸 attachments 根。

### Verification / Migration
导入与打开实现见 `<Path>services/workbenchd/internal/attachment/manager.go</Path>`，失败回滚见 `<Path>services/workbenchd/internal/attachment/manager_test.go</Path>`，UI 调用见 `<Path>apps/desktop/src/features/archives/ArchiveResources.tsx</Path>`。

## ADR-007: 手动更新与平台信任模型

**Status:** accepted
**Source:** `<Path>docs/decisions/ADR-007-unsigned-distribution.md</Path>`；CODE:<Path>apps/desktop/src-tauri/tauri.conf.json</Path>；CODE:<Path>.github/workflows/release.yml</Path>
**Supersedes:** ADR-007 historical wording

### Context
个人/研究阶段分发暂不承担商业证书、Apple 公证、密钥托管和 updater 基础设施成本，但仍需让用户核验产物来源和完整性。

### Decision
应用采用无内置 updater 的手动桌面升级模型。Windows x64 发布为未做 Authenticode 签名的 current-user NSIS；macOS Apple Silicon 发布为 ad-hoc signed DMG。Tagged GitHub Release 生成 SHA-256、SBOM 与 provenance；portable Windows ZIP 只属于本地 `pnpm artifacts` 流程，不承诺为 tagged Release 资产。

### Trade-off
避免证书、私钥、公证和 updater 运维，接受 Windows Unknown Publisher、macOS 首次打开确认、无自动更新与人工完整性核验。

### Consequences
引入 Authenticode、Developer ID/notarization 或 updater 必须由新 ADR supersede；发布文档必须区分本地产物与 tagged Release 资产，不能继续沿用旧 ADR 中“Release 包含 portable ZIP”的强解读。

### Verification / Migration
bundle 配置见 `<Path>apps/desktop/src-tauri/tauri.conf.json</Path>`，本地产物脚本见 `<Path>package.json</Path>`，发布矩阵与元数据见 `<Path>.github/workflows/release.yml</Path>` 和 `<Path>docs/CI_CD.md</Path>`。

## ADR-008: 可验证的原子备份包

**Status:** accepted
**Source:** `<Path>docs/decisions/ADR-008-backup-snapshot.md</Path>`；CODE:<Path>services/workbenchd/internal/backup/manager.go</Path>
**Supersedes:** none

### Context
复制活跃 WAL 数据库不能保证一致性，备份期间附件也可能变化；发布的 ZIP 必须能证明数据库和附件来自同一个冻结清单。

### Decision
使用 modernc Online Backup 生成 SQLite 一致快照，从快照数据库读取活跃托管附件清单，逐文件核对大小与 SHA-256，写临时 ZIP 并验证后原子 rename。只有成功发布的备份参与保留清理。

### Trade-off
相较 `VACUUM INTO`，Online Backup 更适合活跃工作区且降低额外重写成本，但绑定 driver API；附件在快照后变化会让备份失败而不是发布混合状态。

### Consequences
备份格式及 manifest 是恢复兼容合同；未托管文件不进入备份；恢复必须先做安全、checksum、schema 与 integrity 预检并发布到新工作区。

### Verification / Migration
快照、manifest、ZIP 验证和 retention 见 `<Path>services/workbenchd/internal/backup/manager.go</Path>`，恢复边界见 `<Path>services/workbenchd/internal/backup/restore.go</Path>`，故障与恢复测试见 `<Path>services/workbenchd/internal/backup/manager_test.go</Path>`。

## ADR-009: 任务与日历统一模型

**Status:** accepted
**Source:** `<Path>docs/V2_REQUIREMENTS.md</Path>`；CODE:<Path>services/workbenchd/migrations/001_core.sql</Path>；CODE:<Path>apps/desktop/src/features/calendar/CalendarPage.tsx</Path>
**Supersedes:** early separate calendar-event model in `<Path>IMPLEMENTATION_PLAN.md</Path>`

### Context
独立 Task 与 CalendarEvent aggregates 会造成两套状态、编辑器、关联和完成语义；但把日历统一为任务意味着系统无法表达与任务无关的日历事件实体。

### Decision
Task 是唯一可排程实体。任务要么未排期，要么拥有恰好一个 start/end interval；Calendar 只是 scheduled Tasks 的时间投影，日历上的创建、拖拽和 resize 都创建或更新 Task。

### Trade-off
换取单一编辑模型、跨 Today/Tasks/Calendar/Archive 的一致投影和更简单的数据关系，接受不支持独立 CalendarEvent aggregate 或复杂重复日历语义。

### Consequences
“事件档案”仍是 Archive 类型，不能当作日历事件；All 任务视图包含所有未完成任务，包括未排期任务；Task 只可引用一个主档案。

### Verification / Migration
V2 数据表见 `<Path>services/workbenchd/migrations/001_core.sql</Path>`，查询语义见 `<Path>services/workbenchd/internal/storage/sqlite/tasks.go</Path>`，投影行为见 `<Path>apps/desktop/src/features/calendar/CalendarPage.tsx</Path>` 和 `<Path>services/workbenchd/internal/storage/sqlite/store_test.go</Path>`。

## ADR-010: 用户定义的档案 Schema

**Status:** accepted
**Source:** `<Path>docs/V2_REQUIREMENTS.md</Path>`；CODE:<Path>services/workbenchd/internal/storage/sqlite/archive_types.go</Path>
**Supersedes:** fixed archive enum assumptions in `<Path>IMPLEMENTATION_PLAN.md</Path>`

### Context
个人、企业、事件不足以覆盖个人工作台的长期信息类型。继续增加代码 enum 与固定列会让每个新类型需要发布和迁移；无约束 JSON 又会失去验证、表单与搜索语义。

### Decision
ArchiveType 与 FieldDefinition 是用户管理的持久记录；字段值使用受定义约束的 typed EAV 存储，表单由字段定义驱动。个人、企业、事件只是可编辑 seed templates，不是代码 enum。

### Trade-off
换取无需发版的业务扩展和统一动态表单，接受 EAV 查询/校验复杂度、字段演进限制和关系完整性需要应用层治理。

### Consequences
已使用的档案类型不可删除；已有值的字段不可改变 value type；字段 key 在类型内唯一；`sensitive` 是显示元数据而不是加密。

### Verification / Migration
模型与约束见 `<Path>services/workbenchd/internal/archive/model.go</Path>`、`<Path>services/workbenchd/internal/storage/sqlite/archive_types.go</Path>` 和 `<Path>services/workbenchd/internal/storage/sqlite/archives.go</Path>`，动态表单见 `<Path>apps/desktop/src/features/archives/ArchiveForm.tsx</Path>`。

## ADR-011: V2 开发重置且不兼容 V1

**Status:** accepted
**Source:** `<Path>docs/V2_REQUIREMENTS.md</Path>`；`<Path>README.md</Path>`
**Supersedes:** V1 schema and backup compatibility assumptions

### Context
V2 删除独立 CalendarEvent、替换档案 enum 并重建核心 Schema。在仍处开发阶段时维护 V1 数据和备份迁移会显著增加一次性迁移代码与验证成本。

### Decision
V2 从单一新基线开始，不迁移 V1 数据库，也不接受 V1 备份。当前兼容性只覆盖 V2 schema 的前向 migration 与 backup format 规则。

### Trade-off
换取更简单、可验证的 V2 数据模型和更快的开发收敛，接受现有 V1 数据必须留在旧版本或通过另行明确的数据转换流程处理。

### Consequences
不得把旧 V1 工作区直接交给 V2 并承诺自动升级；未来若需要导入 V1，必须作为显式迁移产品能力设计、验证并 supersede 本决定。

### Verification / Migration
当前兼容边界见 `<Path>docs/V2_REQUIREMENTS.md</Path>` 与 `<Path>README.md</Path>`，未来 schema 拒绝见 `<Path>services/workbenchd/internal/storage/sqlite/store.go</Path>`，恢复 schema 检查见 `<Path>services/workbenchd/internal/backup/restore.go</Path>`。

## ADR-012: 可搬移工作区与单写者锁

**Status:** accepted
**Source:** `<Path>README.md</Path>`；CODE:<Path>services/workbenchd/internal/workspace/lock.go</Path>；CODE:<Path>services/workbenchd/internal/storage/sqlite/store.go</Path>
**Supersedes:** none

### Context
离线个人工具需要清晰的数据所有权、可搬移文件布局和可靠的备份边界。允许多个 sidecar 同时打开同一工作区会把 SQLite、托管附件与后台操作暴露给跨进程竞争。

### Decision
工作区是包含 descriptor、SQLite、attachments、backups、exports 与 logs 的普通目录数据单元；每次打开必须取得 OS 级排他文件锁，同一时刻只有一个 workbenchd 可以拥有该工作区。

### Trade-off
换取透明、可搬移和单 owner 一致性，接受同一工作区不能被两个应用实例并行使用，也不提供云同步或多用户并发语义。

### Consequences
最近工作区注册表只保存 locator，不是数据源；备份以工作区 SQLite 和已登记托管附件为边界；桌面 Single Instance 与工作区锁共同防止双 owner，但锁仍是最终数据安全门。

### Verification / Migration
目录初始化与 descriptor 见 `<Path>services/workbenchd/internal/storage/sqlite/store.go</Path>`，平台锁见 `<Path>services/workbenchd/internal/workspace/</Path>`，并发打开测试见 `<Path>services/workbenchd/internal/workspace/lock_test.go</Path>` 和 `<Path>services/workbenchd/internal/storage/sqlite/store_test.go</Path>`。
