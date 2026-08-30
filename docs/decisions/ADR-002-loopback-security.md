# ADR-002: Loopback security

React connects directly to a random `127.0.0.1` HTTP port. Rust generates a 256-bit per-launch token and sends it through sidecar stdin. Go validates Host, Origin, and Bearer authorization; the token is never persisted.

