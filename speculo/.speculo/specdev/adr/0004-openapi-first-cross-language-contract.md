---
source_change: 2026-09-02-consolidate-project-knowledge
promoted_at: 2026-09-02
---

# ADR-0004: OpenAPI-First 跨语言契约

- Status: Accepted
- Date: 2026-09-02
- Source: `<Path>docs/decisions/ADR-004-openapi-generation.md</Path>`

## Context

React 与 Go 共享大量请求、响应和错误模型；双端手写类型会漂移。WebView 使用标准 HTTP，使 OpenAPI 比额外 RPC 栈更贴合现有边界。

## Decision

`<Path>api/openapi.yaml</Path>` 作为 OpenAPI 3.1 设计契约。TypeScript 生成 Fetch client；Go 通过确定性的临时 3.0.3 nullable transform 生成模型和 strict-server 投影。生成物提交仓库，并由 CI 重新生成检查 drift。

## Trade-off

接受生成物体积、固定 generator 和临时兼容 transform 的维护成本，换取跨语言共享 schema、客户端一致性和可审计的契约演进。

## Consequences

契约变更顺序是 schema、generate、runtime implementation。drift gate 只证明生成物一致，不能代替运行时 conformance test。

## Verification And Residual Risk

配置见 `<Path>api/openapi.yaml</Path>`、`<Path>scripts/generate-go.mjs</Path>` 和 `<Path>services/workbenchd/internal/api/generated/oapi-codegen.yaml</Path>`。TypeScript runtime 使用生成 client；Go server 仍在 `<Path>services/workbenchd/internal/api/server.go</Path>` 手工注册路由，尚未实现生成的 strict-server interface，因此 OpenAPI 对 Go runtime 的强制一致性不完整。
