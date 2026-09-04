---
source_change: 2026-09-02-consolidate-project-knowledge
promoted_at: 2026-09-02
---

# ADR-0007: 手动更新与平台信任模型

- Status: Accepted
- Date: 2026-09-02
- Source: `<Path>docs/decisions/ADR-007-unsigned-distribution.md</Path>`

## Context

个人/研究阶段分发暂不承担商业证书、Apple 公证、密钥托管和 updater 基础设施成本，但仍需要让用户核验产物来源和完整性。

## Decision

应用采用无内置 updater 的手动桌面升级。Windows x64 tagged release 产物是未做 Authenticode 签名的 current-user NSIS；macOS Apple Silicon tagged release 产物是 ad-hoc signed DMG。GitHub Release 生成 SHA-256、SBOM 与 provenance。portable Windows ZIP 仅属于本地 `pnpm artifacts` 流程，不承诺为 tagged release 资产。

## Trade-off

避免证书、私钥、公证和 updater 运维，接受 Windows Unknown Publisher、macOS 首次打开确认、无自动更新和人工完整性核验。

## Consequences

引入 Authenticode、Developer ID/notarization 或 updater 必须由新 ADR supersede。发布文档必须区分本地产物与 tagged release 资产。

## Verification And Residual Risk

bundle 配置见 `<Path>apps/desktop/src-tauri/tauri.conf.json</Path>`；本地产物脚本见 `<Path>package.json</Path>`；发布矩阵与元数据见 `<Path>.github/workflows/release.yml</Path>` 和 `<Path>docs/CI_CD.md</Path>`。平台信任提示与手动升级差错仍是该模型的固有风险。
