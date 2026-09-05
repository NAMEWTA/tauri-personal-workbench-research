# 个人工作台 0.2.9 验收记录

状态：待完整发布门禁通过

本文只记录当前 `0.2.9` 的可复核证据。任何来自旧版本、旧哈希或未实际执行的命令都不得写入本页。

## 工具链

| 工具 | 固定版本 |
| --- | --- |
| Node.js | 24.6.0 |
| pnpm | 10.33.0 |
| Go | 1.26.7 |
| Rust | 1.96.0 |
| 应用/sidecar | 0.2.9 |

## 验收矩阵

| 范围 | 命令或证据 | 状态 |
| --- | --- | --- |
| OpenAPI、前端、Go、Rust 静态检查 | `pnpm check` | 通过（Windows 本机，2026-09-05） |
| Go 并发与 race | `go test -race ./...` | 通过（Windows 本机，2026-09-05） |
| 前端单元与类型检查 | `pnpm --dir apps/desktop check` | 通过（13 文件/37 测试，2026-09-05） |
| sidecar loopback、SQLite、优雅关闭 | `pnpm test:sidecar` | 通过（sidecar 0.2.9，2026-09-05） |
| Playwright 响应式与业务流程 | `pnpm test:smoke` | 通过（4 viewport，2026-09-05） |
| 原生工作区隔离、恢复和退出 | `pnpm test:native-workspace` | 通过（Windows 本机，2026-09-05） |
| 单实例与 sidecar 恢复 | `pnpm test:single-instance` | 通过（Windows 本机，2026-09-05） |
| Windows 安装包 smoke | `scripts/smoke-installed.ps1` | 通过（NSIS 0.2.9，2026-09-05） |
| macOS sidecar、app、DMG | CI native/bundle artifacts | 待执行 |
| 生成代码无漂移 | `pnpm generate` + deterministic rerun | 通过（2026-09-05） |

## 证据规则

- 证据必须对应当前提交、workflow run 或 artifact，并包含命令、平台和版本。
- Windows 本机证据不能替代 macOS 原生证据。
- `ci-evidence-*` 二进制目录不纳入工作树；发布证据只保存在 CI artifacts。
- 所有旧 API、旧 schema、旧 localStorage key 和 V1 兼容路径扫描结果必须为空。

## 限制

当前不包含云同步、移动端、OCR、AI、updater 或旧版本数据迁移。应用未完成所有门禁前，状态保持“待完整发布门禁通过”。
