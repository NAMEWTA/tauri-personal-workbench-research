# 0.2.11 发布前实施计划

本计划以当前工作树为基线，目标是完成一次不带旧兼容路径的可发布重构。实现必须保持单一 `/api/v3` 契约、单一 V2 数据基线和 Go sidecar 数据所有权。

## 数据与后端

- 为每个 SQLite 连接设置 `foreign_keys=ON`、WAL、busy timeout 和同步级别，并覆盖并发连接测试。
- 统一 Today、Tomorrow、Calendar 的本地日期和 UTC 区间计算；Calendar 显示所有有时间安排的任务。
- 在附件导入事务内校验档案归属，复制过程累计大小并在超限时清理临时文件。
- 统一字段默认值和用户输入校验、active 软删除语义、parent 存在/自环/环路检测、recurrence 规则解析及分页边界。
- 任何 job 持久化失败都必须进入失败状态；损坏的 reminders JSON 和不存在的关系/附件资源必须返回可诊断错误。

## API 与前端

- OpenAPI 是唯一协议入口；Go 与 TypeScript 生成协议模型，Go 运行时保持单一路由实现，所有生成物不得漂移。
- 按 archive、task、attachment、backup、search、job、preferences 拆分 service 接口，抽取统一 decode、validation、problem detail 和错误映射。
- 提醒只有在通知成功创建后才标记；Today 在本地日切时刷新；Calendar 使用明确查询语义。
- 命令面板使用 debounce、最小查询长度和 AbortSignal；领域 hooks 集中 query key/invalidation，覆盖 dashboard、calendar、archives、tasks、trash。
- `theme=system` 监听并清理媒体查询；卸载/切换工作区前 flush 偏好；统一安全错误状态和 route-level lazy loading。

## 兼容路径与文档

- 删除 legacy preferences 模块、旧 localStorage key、V1 数据库/备份分支及对应测试夹具；源码守护检查不得出现旧名称。
- 当前文档只描述 `0.2.11`、`/api/v3`、`archive_collections`/`archive_records` 和实际支持的平台；历史计划不作为开发入口。
- Speculo ADR 为唯一正文，根 `docs/decisions` 只提供索引；发布证据只来自当前 CI artifact。

## 完成门禁

完成宣告前必须全部通过：

```text
pnpm check
go test -race ./...
cargo fmt --all -- --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace
pnpm test:smoke
pnpm test:native-workspace
pnpm test:single-instance
```

还必须完成 Windows 安装/卸载与备份恢复 smoke、macOS CI sidecar/.app/DMG evidence、OpenAPI 重新生成后 `git diff --exit-code`、Markdown 链接及旧字符串扫描。任一证据缺失时，发布状态保持未完成。
