# CI/CD 与桌面发布

## 工作流

| 工作流 | 触发 | 作用 |
| --- | --- | --- |
| `ci.yml` | main push、pull request、workflow_call | 契约、前端、Go、Rust、Windows/macOS 原生门禁 |
| `build-installers.yml` | 手动触发 | 构建 Windows NSIS/portable 与 macOS DMG，保存 artifacts |
| `release.yml` | 推送 `vX.Y.Z` 标签 | 复用 CI、构建安装包、生成 SBOM/哈希/attestation 并发布 |

外部 Actions 固定到完整 commit SHA；依赖更新由 Dependabot 管理。手动构建和标签发布必须传入全量验证参数，不能绕过路径过滤。

## 发布矩阵

| 平台 | Target | 产物 |
| --- | --- | --- |
| Windows x64 | `x86_64-pc-windows-msvc` | NSIS `.exe`、portable `.zip` |
| macOS Apple Silicon | `aarch64-apple-darwin` | `.app`、`.dmg` |

构建脚本显式映射 Tauri target 与 Go `GOOS/GOARCH`，sidecar 文件名必须包含 target triple。异构 sidecar 只交叉编译，不在宿主 runner 上执行。

Windows 门禁执行 `pnpm check`、sidecar smoke、安装/卸载 smoke、单实例 smoke 和原生工作区 smoke。macOS 门禁执行 Darwin sidecar 生命周期、`.app` 内容与可执行性检查、签名验证和 DMG `hdiutil verify`，并上传带哈希的 native/bundle evidence。

## 发布步骤

1. 保持 `package.json`、Tauri、Cargo 与 sidecar 版本均为目标版本（当前 `0.2.9`）。
2. 运行 `pnpm check`、`pnpm test`、`pnpm test:smoke`、原生 smoke 和 `pnpm verify:versions`。
3. 推送 main，等待 CI 全部通过并核对 macOS evidence artifact。
4. 创建并推送与 package 版本一致的标签，例如 `git tag v0.2.9`。
5. `release.yml` 再次校验版本，聚合安装包、SBOM、SHA-256 和 provenance 后创建 Release。

任何门禁失败或证据缺失都不能发布，也不能用旧版本 artifact 替代当前证据。

## 签名边界

Windows 当前为 unsigned，系统可能显示未知发布者。macOS 使用 `signingIdentity: "-"` 的 ad-hoc 签名；这不是 Developer ID 签名或公证。正式分发前应通过受保护的 CI secrets 接入证书和公证流程，敏感值不得进入仓库或日志。

## 相关入口

- [Tauri GitHub Actions 发布](https://v2.tauri.app/distribute/pipelines/github/)
- [Tauri macOS 签名](https://v2.tauri.app/distribute/sign/macos/)
- [GitHub artifact attestations](https://docs.github.com/en/actions/how-tos/secure-your-work/use-artifact-attestations/use-artifact-attestations)
