# 个人工作台 0.2.11 验收记录

状态：0.2.11 已发布，发布门禁通过

本文只记录当前 `0.2.11` 的可复核证据。任何来自旧版本、旧哈希或未实际执行的命令都不得写入本页。

## 工具链

| 工具 | 固定版本 |
| --- | --- |
| Node.js | 24.6.0 |
| pnpm | 10.33.0 |
| Go | 1.26.7 |
| Rust | 1.96.0 |
| 应用/sidecar | 0.2.11 |

## 验收矩阵

| 范围 | 命令或证据 | 状态 |
| --- | --- | --- |
| OpenAPI、前端、Go、Rust 静态检查 | `pnpm check` | 通过（Windows 本机，2026-09-05） |
| Go 并发与 race | `go test -race ./...` | 通过（Windows 本机，2026-09-05） |
| 前端单元与类型检查 | `pnpm --dir apps/desktop check` | 通过（15 文件/44 测试，2026-09-05） |
| sidecar loopback、SQLite、优雅关闭 | `pnpm test:sidecar` | 通过（0.2.11，2026-09-05） |
| Playwright 响应式与业务流程 | `pnpm test:smoke` | 通过（4 viewport，2026-09-05） |
| 原生工作区隔离、恢复和退出 | 安装版运行 `native-workspace-smoke.mjs` | 通过（Windows，2026-09-05） |
| 单实例与 sidecar 恢复 | `pnpm test:single-instance` | 通过（Windows，2026-09-05） |
| Windows 安装包与实际 WebView2 操作 | `scripts/smoke-installed.ps1` | 通过（三种 schema 2 启动场景，2026-09-05） |
| Windows portable ZIP | 解压后运行 `native-workspace-smoke.mjs` | 通过（Windows，2026-09-05） |
| macOS sidecar、app、DMG | CI native/bundle artifacts | 通过（workflow 33976658637，2026-09-05） |
| 生成代码无漂移 | `pnpm generate` + deterministic rerun | 通过（2026-09-05） |

## 证据规则

- 证据必须对应当前提交、workflow run 或 artifact，并包含命令、平台和版本。
- Windows 本机证据不能替代 macOS 原生证据。
- `ci-evidence-*` 二进制目录不纳入工作树；发布证据只保存在 CI artifacts。
- 所有旧 API、旧 schema、旧 localStorage key 和 V1 兼容路径扫描结果必须为空。

## 当前发布证据

- 发布提交：`ce73f764873712325b6b0d16ec2e29c809dbc031`；[workflow 33976658637](https://github.com/NAMEWTA/tauri-personal-workbench-research/actions/runs/33976658637)；[Release v0.2.11](https://github.com/NAMEWTA/tauri-personal-workbench-research/releases/tag/v0.2.11)。
- macOS native/bundle evidence 已在 workflow 中生成并上传，Windows 安装版 smoke、single-instance 和 portable smoke 均通过。
- 本机已安装程序 SHA-256：`4bafbbc0a381aab731c842450b857c2ef947d1b524e2dc026de99f86bc51861e`；sidecar SHA-256：`409e361f352494fea0dcdea257bfab832d48509fb4f16a8c6a61d04411d1c177`。这些为本机构建证据，不替代 CI Release 下载包的哈希。
- Release 下载包安装 smoke（Windows，2026-09-06）通过，安装包 SHA-256 由 Release checksums 提供。
- [实际复现与修复报告](../temp/review/STARTUP_INCIDENT_REVIEW.md)包含人工控制真实 WebView2 的截图和漏检原因。

## 启动问题回归门禁

使用真实 NSIS 安装目录中的程序，通过 Playwright 连接原生 WebView2，验证自动选中的默认工作区、最近工作区、两者同时含不支持结构三个场景。必须能显示首页和数据保留提示、点击创建任务、重启后读取该任务；原数据库哈希保持一致。手动打开不支持的工作区仍拒绝，并恢复当前工作区。

仅有进程、窗口句柄或 SQLite 文件不足以证明启动成功。关闭超时必须使测试失败，不能把强制清理记为正常退出。发布流程上传独立的 `windows-startup-evidence` artifact，包含页面截图及版本、程序和数据库哈希。

## 限制

当前版本不包含云同步、移动端、OCR、AI、updater 或旧版本数据迁移；这些能力不属于本次 0.2.11 发布范围。
