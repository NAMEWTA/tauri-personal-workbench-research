# AGENTS.md

<SPECULO>
## Speculo 运行时配置

### 初始化状态检查

运行时必须读取以下文件以确认 Speculo 初始化状态：

- ./speculo/.speculo/workspace.json — 工作区根别名配置
- ./speculo/config.json — 项目配置文件

若上述文件不存在或内容为空，说明项目尚未完成 Speculo 初始化。
此时必须提示用户：请先运行 speculo init 完成初始化配置。

`speculo init` 会直接替换受管理静态资产，并依据 refresh contract 保留用户 runtime state、合并持久配置。
结构化状态不兼容时初始化会在替换前停止，当前安装保持不变。

### 工作流入口（强制读取）

初始化时已选择以下工作流，运行时必须强制读取对应入口文件：

- ./speculo/workflows/learning/INDEX.md
- ./speculo/workflows/specdev/INDEX.md
</SPECULO>
