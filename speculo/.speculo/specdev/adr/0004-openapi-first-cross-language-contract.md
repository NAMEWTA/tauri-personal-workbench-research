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

`<Path>api/openapi.yaml</Path>` 作为 OpenAPI 3.1 设计契约。TypeScript 和 Go 均从该契约生成协议类型；Go 运行时路由保持单一手写实现，生成器仅输出协议模型，避免未使用的 server/interface 与业务路由并存。生成物提交仓库，并由 CI 重新生成检查 drift。

## Trade-off

接受生成物体积和固定 generator 的维护成本，换取跨语言共享 schema、客户端一致性和可审计的契约演进。

## Consequences

契约变更顺序是 schema、generate、runtime implementation。drift gate 只证明生成物一致，不能代替运行时 conformance test。

## Verification And Residual Risk

配置见 `<Path>api/openapi.yaml</Path>`、`<Path>scripts/generate-go.mjs</Path>` 和 `<Path>services/workbenchd/internal/api/generated/oapi-codegen.yaml</Path>`。TypeScript runtime 使用生成 client；Go handler 使用生成模型并由单一路由注册，契约变更必须重新生成并通过 drift 与 conformance 检查。
