package main

import (
	"strings"
	"testing"
)

func TestReadBootstrap(t *testing.T) {
	valid := `{"protocolVersion":2,"parentPid":1234,"token":"0123456789012345678901234567890123456789012","workspacePath":".","workspaceName":"测试","appVersion":"0.2.0","allowedOrigins":["http://localhost:1420"]}` + "\n"
	config, err := readBootstrap(strings.NewReader(valid))
	if err != nil {
		t.Fatal(err)
	}
	if config.ProtocolVersion != 2 || config.WorkspaceName != "测试" {
		t.Fatalf("unexpected config: %#v", config)
	}
}
func TestReadBootstrapRejectsInvalidInput(t *testing.T) {
	for _, input := range []string{"\n", `{"protocolVersion":9}` + "\n", `{"protocolVersion":2,"unknown":true}` + "\n"} {
		if _, err := readBootstrap(strings.NewReader(input)); err == nil {
			t.Fatalf("expected error for %q", input)
		}
	}
}
