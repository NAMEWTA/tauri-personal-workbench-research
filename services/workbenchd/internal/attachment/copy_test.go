package attachment

import (
	"bytes"
	"context"
	"io"
	"strings"
	"testing"
)

func TestCopyContextEnforcesLimitWhileSourceGrows(t *testing.T) {
	var output bytes.Buffer
	// 后一段代表初次检查大小以后新出现的数据。
	source := io.MultiReader(strings.NewReader("1234"), strings.NewReader("56789"))
	written, err := copyContext(context.Background(), &output, source, 8)
	if err == nil {
		t.Fatal("growing source exceeded the copy limit without an error")
	}
	if written != 4 || output.String() != "1234" {
		t.Fatalf("oversized chunk was written: size=%d output=%q", written, output.String())
	}
}

func TestCopyContextAcceptsExactLimitAndHonorsCancellation(t *testing.T) {
	var output bytes.Buffer
	written, err := copyContext(context.Background(), &output, strings.NewReader("12345678"), 8)
	if err != nil || written != 8 || output.String() != "12345678" {
		t.Fatalf("exact-limit copy: size=%d output=%q err=%v", written, output.String(), err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	output.Reset()
	if _, err := copyContext(ctx, &output, strings.NewReader("data"), 8); err != context.Canceled || output.Len() != 0 {
		t.Fatalf("cancelled copy: output=%q err=%v", output.String(), err)
	}
}
