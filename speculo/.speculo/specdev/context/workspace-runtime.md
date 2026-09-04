---
source_change: 2026-09-02-consolidate-project-knowledge
promoted_at: 2026-09-02
---

# Workspace Runtime

**Personal Workbench**：单用户、离线优先的 Windows 与 macOS 桌面个人管理工具；核心数据位于本地工作区，不依赖云端服务进程。避免称为“云端工作台”或“多用户协作服务”。

**工作区**：可独立打开、排他锁定、备份和恢复的完整目录数据单元，包含描述文件、SQLite、托管附件、备份、日志及预留目录。指完整边界时不要简称为“数据库”或“应用安装目录”。

**桌面宿主**：Tauri/Rust 层，拥有窗口、原生对话框、最近工作区注册表和 sidecar 生命周期，不拥有业务 CRUD。避免称为“领域后端”或“CRUD 代理”。

**workbenchd**：由桌面宿主监督的单个 Go sidecar，是领域逻辑、HTTP API、SQLite、托管文件、检索、Job 和数据保护的唯一运行时 owner。它不是微服务集群或独立数据库进程。

**Bootstrap**：桌面宿主为一个应用/工作区会话生成并经 stdin 发送给 workbenchd 的启动合同，包含协议、父进程、工作区、允许 Origin 和内存 token；受监督重启复用该 Bootstrap。它不是命令行密钥或持久配置。

**Ready 握手**：workbenchd 在 stdout 输出的一次性启动确认；桌面宿主核对协议、PID、loopback origin 和版本后才向 React 暴露连接。它不是普通 stdout 日志或健康检查轮询。
