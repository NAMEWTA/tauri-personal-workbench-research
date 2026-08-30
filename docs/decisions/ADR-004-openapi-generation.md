# ADR-004: OpenAPI generation

`api/openapi.yaml` is the OpenAPI 3.1 source of truth. TypeScript consumes it directly. A deterministic temporary 3.0 compatibility transform supplies `oapi-codegen` until that tool supports 3.1 null schemas; generated files are committed and checked for drift.

