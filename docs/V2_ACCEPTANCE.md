# 个人工作台 V2 验收记录

日期：2026-09-05

## 范围

V2 桌面端保持开发重置语义，工作区业务数据和可恢复 UI 偏好全部落在工作区 SQLite。附件、备份和日志继续使用工作区普通文件，SQLite 保存其索引、状态和校验信息。最近工作区发现列表仅保留路径和打开时间的应用级 JSON 配置。

桌面端请求只允许当前 Tauri 进程启动的 Go sidecar 回环地址。sidecar 同时在 bootstrap 入口校验 Origin 白名单，只接受 Tauri 内置本地 Origin 或使用 `1-65535` 有效显式端口的 `127.0.0.1` 开发 Origin。`dev:web` 使用临时 sidecar 和临时 SQLite 工作区，拒绝远程 `VITE_BACKEND_URL`，生产连接入口也会再次校验回环地址。
Tauri 开发入口和 Vite 开发服务器固定为 `http://127.0.0.1:1420`；若设置 `TAURI_DEV_HOST`，只接受精确的 `127.0.0.1`，拒绝局域网绑定。

## 工具链

| 工具         | 已验证版本             |
| ------------ | ---------------------- |
| Node.js      | 24.6.0                 |
| pnpm         | 10.33.0                |
| Go           | 1.26.7 (windows/amd64) |
| Rust         | 1.96.0                 |
| 应用/sidecar | 0.2.7                  |

依赖使用 `pnpm install --frozen-lockfile` 安装，`.nvmrc` 与所有 CI workflow 固定 Node.js `24.6.0`。`pnpm verify:versions` 同时校验 Node.js、pnpm、Go、Rust 实际版本，并报告 `Toolchain aligned` 与 `Versions aligned: 0.2.7`。

## 本机证据

- `pnpm check`：契约、前端格式/Lint/TypeScript/Vitest/构建、Go test/vet、Rust fmt/clippy/test 全部通过。
- `pnpm test`：前端 20 tests、Go 全包、Rust 10 tests 全部通过。
- CI 额外门禁 `go test -race ./...` 与 `cargo check --workspace --all-targets` 在 Windows 本机通过。
- SQLite 集成测试覆盖 WAL、并发锁、偏好重开恢复，以及两个工作区 SQLite 文件之间的档案、任务和搜索数据隔离。
- `pnpm test:smoke`：Playwright `desktop`、`standard`、`minimum`、`compact` 四项目通过；覆盖任务、日历、档案、自定义字段、关系建立与关系导航、附件导入/删除、回收站恢复、搜索、备份、设置主题 PATCH/刷新恢复和响应式溢出检查。
- E2E 网络边界同时记录页面全部 HTTP(S) 请求和 `/api/` 请求，主机集合均严格为 `127.0.0.1`。
- 首次读取工作区偏好时兼容旧版 `workbench-layout` 与最近搜索 `localStorage` 键；SQLite 已有的非默认值优先，迁移成功后旧键会被清理，失败则保留到下次启动重试。
- 日历支持拖选日期/时间范围后直接打开创建表单，并将所选开始、结束时间及全天状态带入任务草稿；手动新建仍使用当前时间的 15 分钟对齐默认值。
- 档案详情的关系、附件、关联任务、活动和类型管理统一提供 loading、empty、error/retry 与操作失败反馈；错误状态的重试按钮不会触发表单重复提交。
- `pnpm test:sidecar`：实际启动 Windows sidecar，验证 loopback ready、meta/preferences API、SQLite 创建、档案和任务写入、偏好 PATCH、优雅 shutdown，以及同一工作区重启后的业务数据与偏好恢复。
- `pnpm dev:web`：临时 sidecar + Vite 在 `http://127.0.0.1:1420` 启动并返回 200，退出后 sidecar/临时工作区清理完成。
- 纯 Web 预览会将最近工作区/监督状态显示为“仅 Web 预览”，并禁用依赖 Tauri 文件选择器或系统打开器的操作，避免宿主不存在时永久等待。
- `pnpm build:windows`：NSIS 构建通过。
- `scripts/package-portable.ps1`：portable 构建通过。
- `scripts/smoke-installed.ps1`：NSIS 静默安装、默认/隔离工作区启动、窗口与 sidecar 清理、覆盖升级、schema 99 恢复窗口和卸载保留工作区全部通过；烟测为每次运行使用私有 `WEBVIEW2_USER_DATA_FOLDER`，避免宿主机其他 WebView2 实例影响关闭结果；关闭阶段允许 WebView2 最多 15 秒的有界窗口类清理宽限期，仍要求主进程和 sidecar 最终退出；应用自身在 sidecar 已停止后对 Windows WebView2 卡住增加 2 秒有界宿主兜底，偶发留下无界面宿主时烟测会在确认窗口和 sidecar 已关闭后回收宿主并保留警告。
- `pnpm test:single-instance`（或 `scripts/smoke-single-instance.ps1 -TargetTriple x86_64-pc-windows-msvc`）：本机原生探测先强制终止首个 sidecar 并验证桌面自动恢复到新 PID，再验证第二实例退出码为 0、首实例继续运行且 sidecar 数量保持 1；脚本已接入 Windows 手动构建和 Release workflow。
- `pnpm test:native-workspace`：通过实际 Tauri WebView2 在工作区间切换；验证工作区 A 的备份预检/恢复到新目录、恢复后任务数据可读、任务与 SQLite 文件相互隔离、工作区 A 的深色偏好在切换返回后恢复、API 主机集合严格为 `127.0.0.1`、最近工作区注册表只含路径和打开时间，并以 Windows 原生关闭请求验证退出清理；脚本已接入 Windows 手动构建和 Release workflow。
- sidecar 崩溃恢复在退出竞态下会检查 `Stopping/Stopped` 状态并响应启动取消令牌，避免退出流程结束后重新拉起 sidecar；对应 Rust 原生测试与完整门禁已通过。
- `TAURI_ENV_TARGET_TRIPLE=aarch64-apple-darwin pnpm build:sidecar`：Go arm64 Darwin sidecar 交叉编译通过；sidecar smoke 按目标三元组精确选择二进制。
- 发布 workflow 在 Windows/macOS runner 上强制检查 NSIS/DMG 文件、macOS `.app` 的 `Info.plist`/主程序/sidecar/ad-hoc 签名，并使用 `hdiutil verify` 校验 DMG；`ci.yml` 的 macOS native job 另外上传包含工具链、命令、`.app` 主程序和 sidecar SHA-256 及签名结果的 `personal-workbench-macos-native-evidence` artifact，安装包矩阵上传包含 `.app`、sidecar、DMG 哈希及签名/镜像校验结果的 `personal-workbench-macos-bundle-evidence` artifact；release publish 阶段继续生成完整校验清单。

## 验收证据矩阵

| 要求                                                                | 权威证据                                                                        | 当前状态                                                     |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| 锁定工具链、冻结依赖                                                | `pnpm verify:versions`、`pnpm install --frozen-lockfile`、`.nvmrc`、CI workflow | Windows 本机通过；CI 流程已固定                              |
| React 只访问本机 sidecar                                            | `backend-url.ts`、Go `validateHost`、Web/原生 E2E 主机断言                      | Windows Web 与 Tauri 原生 smoke 通过，主机集合为 `127.0.0.1` |
| 工作区数据与偏好使用 SQLite                                         | `003_preferences.sql`、SQLite 集成测试、sidecar/原生工作区 smoke                | Windows 本机通过；两个原生工作区隔离并保留各自偏好           |
| 创建/打开/切换/锁/恢复/退出                                         | Tauri `lifecycle.rs`、`workspace_registry.rs`、安装/单实例/原生工作区 smoke     | Windows 启动、切换、锁、崩溃恢复、退出清理通过               |
| Today、任务、日历、档案、字段、关系、附件、搜索、备份、回收站、设置 | `apps/desktop/e2e/workbench.spec.ts`、Go 集成测试                               | Web smoke 四项目通过                                         |
| macOS native sidecar、`.app`、DMG、签名                             | `ci.yml`、`build-installers.yml`、`release.yml` evidence artifact               | 当前工作树尚未在 macOS runner 执行，待 CI 证据               |
| 可复核交付物                                                        | `artifacts/SHA256SUMS.txt`、SBOM、`docs/CI_CD.md`                               | Windows 产物与哈希通过                                       |

## Windows 产物

产物位于 `artifacts/`：

| 文件                                          | SHA-256                                                            |
| --------------------------------------------- | ------------------------------------------------------------------ |
| `个人工作台_0.2.7_x64-setup.exe`              | `bc88dc1aff36ef265b117a8222e12b04807c8128cad64050cecceaa2a79a4adb` |
| `personal-workbench-portable-windows-x64.zip` | `6b2f3e4acb69e927258b399bee9afe0088a333985d0140fb8887c5e11c148266` |
| `sbom.cdx.json`                               | `0adbc0ea99bef89a33eaefdbe7a76205e792afdeaed5695650044d26d40c1413` |

哈希也写入 `artifacts/SHA256SUMS.txt`，SBOM 使用 CycloneDX 格式并包含 840 个组件。

## macOS 证据边界

Windows 主机无法运行 macOS Tauri bundler 或原生 WebView 生命周期。`.github/workflows/ci.yml` 的 `macos-native` job 固定工具链，构建并 smoke 测试 Darwin sidecar 生命周期，同时构建并检查 `.app` bundle，上传 `personal-workbench-macos-native-evidence` 后再执行 Rust fmt/clippy/test/check；`.github/workflows/build-installers.yml` 和 `release.yml` 已配置 `macos-latest`、`aarch64-apple-darwin`、DMG 构建、镜像校验和 `personal-workbench-macos-bundle-evidence`。macOS runner 上的 CI/DMG 结果仍需由 CI 执行后纳入发布记录。

## 已知限制

- 不包含 V1 数据迁移、云同步、移动端、OCR、AI 或 updater。
- 本机 smoke 使用 Windows WebView2；macOS 原生窗口行为不能在 Windows 上等价模拟。
- Windows 上的 `cargo check --workspace --all-targets --target aarch64-apple-darwin` 已尝试，但在 `objc2-exception-helper` 的 Darwin C 编译步骤因缺少 `cc` 停止；这不是 macOS runner 的替代证据，macOS 源码、WebView 生命周期和签名仍以 CI runner 结果为准。
- `dev:web` 是临时开发工作区，进程退出后数据会清理；正式桌面端使用用户选择的工作区目录。
