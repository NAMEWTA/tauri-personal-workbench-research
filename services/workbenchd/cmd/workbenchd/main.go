package main

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"log/slog"
	"net"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"strings"
	"syscall"
	"time"
	_ "time/tzdata"

	workbenchapi "github.com/personal-workbench/workbenchd/internal/api"
	"github.com/personal-workbench/workbenchd/internal/app"
	"github.com/personal-workbench/workbenchd/internal/attachment"
	"github.com/personal-workbench/workbenchd/internal/backup"
	"github.com/personal-workbench/workbenchd/internal/storage/sqlite"
)

const protocolVersion = 2

var version = "0.2.0-dev"

type bootstrap struct {
	ProtocolVersion int      `json:"protocolVersion"`
	ParentPID       int      `json:"parentPid"`
	Token           string   `json:"token"`
	WorkspacePath   string   `json:"workspacePath"`
	WorkspaceName   string   `json:"workspaceName"`
	AppVersion      string   `json:"appVersion"`
	AllowedOrigins  []string `json:"allowedOrigins"`
}

type ready struct {
	Type            string `json:"type"`
	ProtocolVersion int    `json:"protocolVersion"`
	Port            int    `json:"port"`
	PID             int    `json:"pid"`
	Origin          string `json:"origin"`
	WorkspaceID     string `json:"workspaceId"`
	ServiceVersion  string `json:"serviceVersion"`
}

func main() {
	showVersion := flag.Bool("version", false, "print version")
	flag.Parse()
	if *showVersion {
		fmt.Println(version)
		return
	}
	if err := run(); err != nil {
		_ = json.NewEncoder(os.Stderr).Encode(map[string]any{"level": "ERROR", "component": "bootstrap", "serviceVersion": version, "traceId": "", "message": err.Error()})
		os.Exit(1)
	}
}

func run() error {
	config, err := readBootstrap(os.Stdin)
	if err != nil {
		return err
	}
	if config.ParentPID != os.Getppid() {
		return fmt.Errorf("bootstrap parent pid does not match supervisor")
	}
	logger := slog.New(slog.NewJSONHandler(os.Stderr, &slog.HandlerOptions{Level: slog.LevelInfo})).With("serviceVersion", version)
	store, err := sqlite.Open(context.Background(), config.WorkspacePath, config.WorkspaceName, config.AppVersion)
	if err != nil {
		return err
	}
	defer func() { _ = store.Close() }()
	listener, err := net.Listen("tcp4", "127.0.0.1:0")
	if err != nil {
		return fmt.Errorf("listen loopback: %w", err)
	}
	shutdownSignal := make(chan struct{}, 1)
	service := app.New(store, backup.New(store.DB(), store.WorkspacePath()), attachment.New(store.DB(), store.WorkspacePath()))
	automaticContext, cancelAutomatic := context.WithCancel(context.Background())
	defer cancelAutomatic()
	service.ScheduleAutomaticBackup(automaticContext, 5*time.Minute)
	handler := workbenchapi.NewHandler(service, workbenchapi.Config{Token: config.Token, AllowedOrigins: config.AllowedOrigins, ServiceVersion: version, Shutdown: func() {
		select {
		case shutdownSignal <- struct{}{}:
		default:
		}
	}}, logger)
	server := &http.Server{Handler: handler, ReadHeaderTimeout: 5 * time.Second, IdleTimeout: 60 * time.Second, MaxHeaderBytes: 16 << 10}
	port := listener.Addr().(*net.TCPAddr).Port
	workspaceID, err := store.WorkspaceID(context.Background())
	if err != nil {
		_ = listener.Close()
		return fmt.Errorf("read workspace identity: %w", err)
	}
	origin := fmt.Sprintf("http://127.0.0.1:%d", port)
	if err := json.NewEncoder(os.Stdout).Encode(ready{Type: "ready", ProtocolVersion: protocolVersion, Port: port, PID: os.Getpid(), Origin: origin, WorkspaceID: workspaceID, ServiceVersion: version}); err != nil {
		_ = listener.Close()
		return fmt.Errorf("write ready: %w", err)
	}
	serveErr := make(chan error, 1)
	go func() {
		errorValue := server.Serve(listener)
		if !errors.Is(errorValue, http.ErrServerClosed) {
			serveErr <- errorValue
		} else {
			serveErr <- nil
		}
	}()
	signals := make(chan os.Signal, 1)
	signal.Notify(signals, os.Interrupt, syscall.SIGTERM)
	defer signal.Stop(signals)
	var serveResult error
	serverStopped := false
	select {
	case <-signals:
		logger.Info("shutdown requested", "component", "lifecycle", "traceId", "")
	case <-shutdownSignal:
		logger.Info("shutdown requested", "component", "http", "traceId", "")
	case err := <-serveErr:
		serveResult = err
		serverStopped = true
		logger.Error("http server stopped", "component", "http", "traceId", "", "error", err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	shutdownErr := server.Shutdown(ctx)
	if shutdownErr != nil {
		_ = server.Close()
	}
	cancelAutomatic()
	jobsErr := service.Shutdown(ctx)
	if !serverStopped {
		serveResult = <-serveErr
	}
	if shutdownErr != nil {
		shutdownErr = fmt.Errorf("shutdown server: %w", shutdownErr)
	}
	if jobsErr != nil {
		jobsErr = fmt.Errorf("stop background jobs: %w", jobsErr)
	}
	return errors.Join(shutdownErr, jobsErr, serveResult)
}

func readBootstrap(reader io.Reader) (bootstrap, error) {
	limited := io.LimitReader(reader, 64<<10)
	line, err := bufio.NewReader(limited).ReadBytes('\n')
	if err != nil && !errors.Is(err, io.EOF) {
		return bootstrap{}, fmt.Errorf("read bootstrap: %w", err)
	}
	if len(line) == 0 || len(line) >= 64<<10 {
		return bootstrap{}, fmt.Errorf("bootstrap is empty or too large")
	}
	var config bootstrap
	decoder := json.NewDecoder(strings.NewReader(string(line)))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&config); err != nil {
		return bootstrap{}, fmt.Errorf("decode bootstrap: %w", err)
	}
	if config.ProtocolVersion != protocolVersion {
		return bootstrap{}, fmt.Errorf("unsupported protocol version %d", config.ProtocolVersion)
	}
	if config.ParentPID <= 0 {
		return bootstrap{}, fmt.Errorf("parent pid is required")
	}
	if len(config.Token) < 43 {
		return bootstrap{}, fmt.Errorf("token is too short")
	}
	if config.AppVersion == "" {
		return bootstrap{}, fmt.Errorf("app version is required")
	}
	abs, err := filepath.Abs(config.WorkspacePath)
	if err != nil || config.WorkspacePath == "" {
		return bootstrap{}, fmt.Errorf("workspace path is invalid")
	}
	config.WorkspacePath = abs
	if config.WorkspaceName == "" {
		config.WorkspaceName = "个人工作台"
	}
	if len(config.AllowedOrigins) == 0 {
		return bootstrap{}, fmt.Errorf("at least one origin is required")
	}
	return config, nil
}
