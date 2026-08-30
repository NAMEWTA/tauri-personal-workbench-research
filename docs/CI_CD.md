# CI/CD 与桌面发布

## 工作流

| 文件                   | 触发方式                                  | 作用                                                                 |
| ---------------------- | ----------------------------------------- | -------------------------------------------------------------------- |
| `ci.yml`               | `main` push、pull request、其他工作流调用 | 前端、Go、OpenAPI、Rust、Windows 浏览器主流程质量门禁                |
| `build-installers.yml` | 手动执行                                  | 构建两种原生安装包并保存为 Actions artifacts，不创建 Release         |
| `release.yml`          | 推送 `vX.Y.Z` 标签                        | 复用 CI，构建两种安装包，生成 SBOM、SHA-256 和 provenance 后公开发布 |

所有外部 Actions 固定到完整 commit SHA。Dependabot 每周检查 npm、Go Modules、Cargo 和 GitHub Actions 更新。

## 发布矩阵

| 系统                | GitHub runner                           | Rust/Tauri target        | 安装包      |
| ------------------- | --------------------------------------- | ------------------------ | ----------- |
| Windows x64         | `windows-latest`                        | `x86_64-pc-windows-msvc` | NSIS `.exe` |
| macOS Apple Silicon | `macos-latest`（当前为 macOS 26 ARM64） | `aarch64-apple-darwin`   | `.dmg`      |

`scripts/build-sidecar.mjs` 将 Tauri target 映射到对应的 `GOOS`/`GOARCH`，并把二进制写为 Tauri `externalBin` 要求的目标三元组文件名。交叉编译时不会尝试在宿主 runner 上执行异构 sidecar。

Windows 构建完成后会运行 `scripts/smoke-installed.ps1`，实际验证静默安装、sidecar 启动、覆盖升级、优雅退出、卸载，以及卸载后工作区仍被保留。该门禁失败时不会进入 Release 发布任务。

## 创建版本

1. 同步 `package.json`、桌面包、Tauri、Cargo 和 sidecar 的版本。
2. 执行 `pnpm check`、`pnpm test:smoke` 和 `pnpm verify:versions`。
3. 提交并推送 `main`，等待 CI 通过。
4. 创建并推送同版本标签，例如 `git tag v0.2.0 && git push origin v0.2.0`。
5. `release.yml` 验证标签与 `package.json` 一致，聚合两种安装包后一次性创建公开 Release。

Release 附带 CycloneDX `sbom.cdx.json`、`SHA256SUMS.txt` 和 GitHub artifact attestation。可使用 `gh attestation verify <file> --repo OWNER/REPO` 核验构建来源。

## 签名边界

Windows 当前没有 Authenticode 证书，系统会显示未知发布者。macOS 在 `tauri.conf.json` 中使用 `signingIdentity: "-"` 做 ad-hoc 签名，可避免 Apple Silicon 将下载的应用直接判断为损坏，但这不等同于 Apple Developer 身份签名或公证。

正式对外分发 macOS 版本时，应申请 Developer ID Application 证书，在 GitHub Secrets 中保存证书、证书密码、临时 keychain 密码和 App Store Connect/Apple ID 公证凭据，再按 Tauri 的 macOS signing 流程导入证书并移除 ad-hoc identity。敏感值不得写入仓库或 workflow 日志。

## 参考资料

- [Tauri GitHub Actions 发布](https://v2.tauri.app/distribute/pipelines/github/)
- [tauri-action 官方 Workflow 示例](https://github.com/tauri-apps/tauri-action/tree/dev/examples)
- [Clash Verge Rev 桌面构建 Workflow](https://github.com/clash-verge-rev/clash-verge-rev/blob/dev/.github/workflows/dev.yml)
- [Hoppscotch 桌面构建 Workflow](https://github.com/hoppscotch/hoppscotch/blob/main/.github/workflows/build-hoppscotch-desktop.yml)
- [Tauri macOS 签名与公证](https://v2.tauri.app/distribute/sign/macos/)
- [Tauri Windows 安装包](https://v2.tauri.app/distribute/windows-installer/)
- [GitHub-hosted runners](https://docs.github.com/en/actions/reference/runners/github-hosted-runners)
- [GitHub artifact attestations](https://docs.github.com/en/actions/how-tos/secure-your-work/use-artifact-attestations/use-artifact-attestations)
