# 个人工作台

离线优先的 Windows 与 macOS 个人管理工具。Tauri 2 负责桌面生命周期，React 提供界面，单个 Go sidecar 独占 SQLite、附件、搜索、任务和备份。当前版本将任务与日历统一为同一实体，并支持用户创建档案集合、定义字段以及持续添加记录。

## 开发

需要 Node.js 24.6.0、pnpm 10.33.0、Go 1.26.7 和 Rust 1.96.0。`.nvmrc` 与 `rust-toolchain.toml` 已固定 Node/Rust 版本；首次安装依赖后启动完整桌面应用：

```powershell
corepack enable
pnpm install --frozen-lockfile
pnpm dev
```

发布构建的自动化验证可设置 `WORKBENCH_DEV_APP_DATA_DIR` 或 `WORKBENCH_DEV_CONFIG_DIR`，将默认工作区或工作区注册表隔离到临时目录；日常使用无需设置。

仅调试浏览器界面可运行 `pnpm dev:web`；它会自动启动临时 loopback sidecar 和 SQLite 工作区，退出时清理，不接受远程后端配置。常用验证命令：

```powershell
pnpm check
pnpm test:sidecar
pnpm test:smoke
pnpm verify:versions
```

`pnpm generate` 根据 [OpenAPI 契约](api/openapi.yaml)重新生成 Go 和 TypeScript 代码。生成文件不得手工修改。

## 构建

```powershell
pnpm artifacts
```

输出位于 `artifacts/`：

- current-user NSIS 安装包
- portable Windows x64 ZIP
- CycloneDX SBOM
- `SHA256SUMS.txt`

构建是 unsigned 分发，不包含 Authenticode、updater、`.sig` 或 `latest.json`。Windows 显示 Unknown Publisher 属于预期行为；安装前可用 `Get-FileHash -Algorithm SHA256` 与校验文件比对。

GitHub Release 会构建 Windows x64 NSIS 和 macOS Apple Silicon DMG。推送与 `package.json` 版本一致的 `vX.Y.Z` 标签后，只有 CI、两个平台构建和元数据任务全部通过才会发布 Release。macOS 当前使用 ad-hoc 签名，首次打开可能需要用户在“隐私与安全性”中确认。工作流、runner 选择和正式 Apple 签名接入方式见 [CI_CD.md](docs/CI_CD.md)。

## 工作区

Windows 正式版默认在程序安装目录的 `workspace` 子目录创建工作区；macOS 使用 Application Support 中的可写应用数据目录。之后可在设置中切换并从最近列表打开。工作区内容均为普通文件：

```text
workspace/
├── workspace.json
├── workbench.sqlite3
├── attachments/
├── backups/
├── exports/
└── logs/
```

同一工作区由操作系统文件锁保护，只允许一个 sidecar 打开。SQLite 使用 WAL、foreign keys 和 busy timeout。退出时会停止 HTTP、取消后台任务并执行 WAL checkpoint。

## 备份恢复

备份是普通 ZIP，包含 SQLite 一致快照、活跃托管附件和带 SHA-256 的 manifest。备份目录由用户显式选择；未配置时不创建手动或自动备份。配置后每日首次启动 5 分钟后检查一次，成功备份保留最近 10 份。恢复先执行路径、压缩比、总大小、checksum、schema 和 SQLite integrity 预检，并默认恢复到新的空工作区。

覆盖安装只替换程序文件，不删除工作区。卸载也不会删除用户数据。当前 V2 仍处于开发阶段，采用全新单基线 schema，不迁移 V1 数据库，也不接受 V1 备份。

## 安全边界

- 服务只绑定随机 `127.0.0.1` 端口，所有业务请求使用每次启动生成的 256-bit Bearer token。
- token 仅存在内存，通过 stdin/bootstrap 和窄 Tauri command 传递，不进入参数、URL、日志或 LocalStorage。
- Host、Origin、请求大小、超时和统一 Problem Detail 均由 Go middleware 验证。
- WebView 不拥有任意文件系统、进程启动、shell 或 updater capability。

V2 需求与实施范围见 [V2_REQUIREMENTS.md](docs/V2_REQUIREMENTS.md) 和 [IMPLEMENTATION_PLAN_V2.md](docs/IMPLEMENTATION_PLAN_V2.md)；早期架构研究仍保留在 [RESEARCH.md](RESEARCH.md) 和 [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md)。
