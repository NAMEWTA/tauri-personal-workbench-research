# 当前领域要求

## 任务和日历

- 任务是唯一可排程实体，可无排程或拥有一个开始/结束区间。
- 任务可独立设置 due date、重复规则、提醒、估算和 parent。
- Today、Tomorrow、All、Completed 是任务视图；Calendar 是排程任务投影。
- 日历创建、拖选和编辑复用同一个任务编辑器；全局 inspector 在窄屏显示为抽屉。

## 档案与关联

- 档案类型是用户创建的 archive collection，不使用固定代码枚举。
- collection 拥有有序 field definitions，包含分组、类型、选项、默认值和敏感标记。
- record 表单根据 collection fields 渲染；任务可关联一个主档案 record。
- 档案关系、关联任务和附件在详情页提供统一导航和错误状态。

## 发布基线

当前版本只支持单一 V2 数据基线和 `/api/v3`。旧数据库、旧备份和旧 localStorage 状态直接拒绝或忽略，不执行兼容迁移。
