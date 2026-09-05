# 个人工作台

个人工作台是一个离线优先的单用户桌面应用。Tauri 2/Rust 负责窗口、工作区生命周期和 Go sidecar 监督；React 负责界面；Go `workbenchd` 独占 HTTP API、SQLite、档案、任务、附件、搜索、后台作业、备份与恢复。

当前应用版本为 `0.2.10`。本版本使用单一数据库基线和 `/api/v3` 契约，不读取旧 localStorage，不迁移旧数据库，也不接受旧备份格式。

## 开发环境

需要 Node.js `24.6.0`、pnpm `10.33.0`、Go `1.26.7` 和 Rust `1.96.0`。在 Windows PowerShell 中执行：

```powershell
corepack enable
pnpm install --frozen-lockfile
pnpm dev
```

仅调试 Web 界面可执行 `pnpm dev:web`，它会启动临时 loopback sidecar 和临时 SQLite 工作区。常用检查：

```powershell
pnpm check
pnpm test
pnpm test:sidecar
pnpm test:smoke
pnpm verify:versions
```

`pnpm generate` 从 [api/openapi.yaml](api/openapi.yaml) 生成 Go/TypeScript 契约代码。生成目录中的文件不得手工修改。

## 架构入口

- [RESEARCH.md](RESEARCH.md)：当前进程边界、数据所有权、API 和安全基线。
- [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md)：当前发布前修复、重构和验收门禁。
- [docs/V2_REQUIREMENTS.md](docs/V2_REQUIREMENTS.md)：当前领域行为与数据模型要求。
- [docs/V2_ACCEPTANCE.md](docs/V2_ACCEPTANCE.md)：0.2.10 验收证据记录。
- [docs/CI_CD.md](docs/CI_CD.md)：CI、构建和发布流程。
- [speculo/.speculo/specdev/adr/](speculo/.speculo/specdev/adr/)：架构决策唯一正文。

业务请求通过 `http://127.0.0.1:<random>/api/v3` 发送，使用启动时生成且仅存于内存的 Bearer token。Rust 不代理常规 CRUD，React 不拥有通用文件系统或 shell 权限。

## 工作区与数据

工作区是普通目录，包含：

```text
workspace/
├── workspace.json
├── workbench.sqlite3
├── attachments/
├── backups/
├── exports/
└── logs/
```

Go 为 SQLite 唯一 owner；连接启用 WAL、foreign keys 和 busy timeout。任务是唯一的日程实体，日历是任务的时间投影；档案使用 `archive_collections`、`archive_fields` 和 `archive_records`。备份包含一致的 SQLite 快照、托管附件和 SHA-256 manifest，恢复默认写入新工作区。

## 构建与发布

```powershell
pnpm artifacts
```

构建产物写入 `artifacts/`，包括 Windows NSIS、portable ZIP、CycloneDX SBOM 和 `SHA256SUMS.txt`。发布矩阵和签名边界见 [docs/CI_CD.md](docs/CI_CD.md)。发布前必须通过 Windows 本机全链路、macOS CI 原生证据及所有自动化检查；未通过的检查不得在验收文档中标记为完成。
