package main

import (
	"strings"
	"testing"
)

func TestReadBootstrap(t *testing.T) {
	valid := `{"protocolVersion":3,"parentPid":1234,"token":"0123456789012345678901234567890123456789012","workspacePath":".","workspaceName":"测试","appVersion":"0.2.0","allowedOrigins":["http://127.0.0.1:1420"]}` + "\n"
	config, err := readBootstrap(strings.NewReader(valid))
	if err != nil {
		t.Fatal(err)
	}
	if config.ProtocolVersion != 3 || config.WorkspaceName != "测试" {
		t.Fatalf("unexpected config: %#v", config)
	}
}

func TestReadBootstrapAcceptsTauriOrigins(t *testing.T) {
	valid := `{"protocolVersion":3,"parentPid":1234,"token":"0123456789012345678901234567890123456789012","workspacePath":".","workspaceName":"测试","appVersion":"0.2.0","allowedOrigins":["tauri://localhost","http://tauri.localhost","https://tauri.localhost"]}` + "\n"
	if _, err := readBootstrap(strings.NewReader(valid)); err != nil {
		t.Fatalf("expected Tauri origins to be accepted: %v", err)
	}
}

func TestReadBootstrapRejectsInvalidInput(t *testing.T) {
	for _, input := range []string{"\n", `{"protocolVersion":9}` + "\n", `{"protocolVersion":3,"unknown":true}` + "\n"} {
		if _, err := readBootstrap(strings.NewReader(input)); err == nil {
			t.Fatalf("expected error for %q", input)
		}
	}
}

func TestReadBootstrapRejectsRemoteAllowedOrigins(t *testing.T) {
	for _, origin := range []string{
		"https://example.com",
		"http://localhost:1420",
		"http://127.0.0.1",
		"http://127.0.0.1:0",
		"http://127.0.0.1:65536",
		"http://127.0.0.1:1420/path",
	} {
		input := `{"protocolVersion":3,"parentPid":1234,"token":"0123456789012345678901234567890123456789012","workspacePath":".","workspaceName":"测试","appVersion":"0.2.0","allowedOrigins":["` + origin + `"]}` + "\n"
		if _, err := readBootstrap(strings.NewReader(input)); err == nil {
			t.Fatalf("expected origin %q to be rejected", origin)
		}
	}
}
