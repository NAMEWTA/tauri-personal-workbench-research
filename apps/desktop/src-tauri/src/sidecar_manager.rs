use crate::bootstrap::{Bootstrap, PROTOCOL_VERSION};
use crate::error::WorkbenchError;
use crate::log_writer::RotatingLog;
use serde::{Deserialize, Serialize};
use std::sync::{
    Arc, Mutex,
    atomic::{AtomicBool, Ordering},
};
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_shell::ShellExt;
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tokio::sync::oneshot;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionInfo {
    pub base_url: String,
    pub token: String,
    pub protocol_version: u32,
    pub service_version: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "state", content = "detail", rename_all = "camelCase")]
pub enum PublicState {
    Stopped,
    Starting,
    Ready(ConnectionInfo),
    Stopping,
    Failed(String),
}

struct Inner {
    state: PublicState,
    child: Option<CommandChild>,
    bootstrap: Option<Bootstrap>,
    restart_count: u8,
    terminated: Option<Arc<AtomicBool>>,
}

pub struct SidecarManager {
    inner: Mutex<Inner>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ReadyLine {
    #[serde(rename = "type")]
    kind: String,
    protocol_version: u32,
    port: u16,
    pid: u32,
    origin: String,
    workspace_id: String,
    service_version: String,
}

fn parse_ready_line(line: &[u8]) -> Result<ReadyLine, String> {
    let parsed: ReadyLine = serde_json::from_slice(line).map_err(|error| error.to_string())?;
    if parsed.kind != "ready"
        || parsed.protocol_version != PROTOCOL_VERSION
        || parsed.port == 0
        || parsed.pid == 0
        || parsed.workspace_id.is_empty()
        || parsed.origin != format!("http://127.0.0.1:{}", parsed.port)
    {
        return Err("protocol mismatch or invalid port".to_string());
    }
    Ok(parsed)
}

fn sidecar_exit_error(code: Option<i32>, stderr: &[u8]) -> String {
    let text = String::from_utf8_lossy(stderr);
    for line in text.lines().rev() {
        if let Ok(value) = serde_json::from_str::<serde_json::Value>(line)
            && let Some(message) = value.get("message").and_then(|value| value.as_str())
            && !message.is_empty()
        {
            return message.to_string();
        }
    }
    format!("进程提前退出: {code:?}")
}

impl Default for SidecarManager {
    fn default() -> Self {
        Self {
            inner: Mutex::new(Inner {
                state: PublicState::Stopped,
                child: None,
                bootstrap: None,
                restart_count: 0,
                terminated: None,
            }),
        }
    }
}

impl SidecarManager {
    pub async fn start(
        &self,
        app: &AppHandle,
        bootstrap: Bootstrap,
    ) -> Result<ConnectionInfo, WorkbenchError> {
        {
            let mut inner = self.inner.lock().expect("sidecar mutex poisoned");
            inner.bootstrap = Some(bootstrap.clone());
            inner.restart_count = 0;
        }
        self.start_once(app, bootstrap).await
    }

    async fn start_once(
        &self,
        app: &AppHandle,
        bootstrap: Bootstrap,
    ) -> Result<ConnectionInfo, WorkbenchError> {
        {
            let mut inner = self.inner.lock().expect("sidecar mutex poisoned");
            inner.state = PublicState::Starting;
        }
        let token = bootstrap.token.clone();
        let log_directory = app
            .path()
            .app_log_dir()
            .map_err(|_| WorkbenchError::AppDataUnavailable)?;
        let log = std::sync::Arc::new(Mutex::new(
            RotatingLog::open(&log_directory)
                .map_err(|error| WorkbenchError::Operation(error.to_string()))?,
        ));
        let bootstrap_line = serde_json::to_vec(&bootstrap)
            .map_err(|error| WorkbenchError::SidecarStart(error.to_string()))?;
        let command = app
            .shell()
            .sidecar("workbenchd")
            .map_err(|error| WorkbenchError::SidecarStart(error.to_string()))?;
        let (mut events, mut child) = command
            .spawn()
            .map_err(|error| WorkbenchError::SidecarStart(error.to_string()))?;
        let expected_pid = child.pid();
        child
            .write(&[bootstrap_line.as_slice(), b"\n"].concat())
            .map_err(|error| WorkbenchError::SidecarStart(error.to_string()))?;
        let (ready_tx, ready_rx) = oneshot::channel();
        let terminated = Arc::new(AtomicBool::new(false));
        let event_terminated = terminated.clone();
        let app_handle = app.clone();
        let sidecar_log = log.clone();
        tauri::async_runtime::spawn(async move {
            let mut ready_tx = Some(ready_tx);
            let mut handshake_complete = false;
            let mut stdout = Vec::new();
            let mut stderr = Vec::new();
            while let Some(event) = events.recv().await {
                match event {
                    CommandEvent::Stdout(chunk) => {
                        stdout.extend_from_slice(&chunk);
                        while let Some(position) = stdout.iter().position(|byte| *byte == b'\n') {
                            let line = stdout.drain(..=position).collect::<Vec<_>>();
                            if let Some(sender) = ready_tx.take() {
                                let parsed = parse_ready_line(&line);
                                handshake_complete = parsed.is_ok();
                                let _ = sender.send(parsed);
                            }
                        }
                    }
                    CommandEvent::Stderr(chunk) => {
                        stderr.extend_from_slice(&chunk);
                        if stderr.len() > 8192 {
                            stderr.drain(..stderr.len() - 8192);
                        }
                        if let Ok(mut log) = sidecar_log.lock() {
                            let _ = log.write(&chunk);
                        }
                    }
                    CommandEvent::Terminated(payload) => {
                        event_terminated.store(true, Ordering::SeqCst);
                        if let Some(sender) = ready_tx.take() {
                            let _ = sender.send(Err(sidecar_exit_error(payload.code, &stderr)));
                        } else if handshake_complete {
                            let recovery_app = app_handle.clone();
                            std::thread::spawn(move || {
                                tauri::async_runtime::block_on(SidecarManager::recover(
                                    recovery_app,
                                    payload.code,
                                ));
                            });
                        }
                        break;
                    }
                    _ => {}
                }
            }
        });
        let parsed_result = match tokio::time::timeout(Duration::from_secs(10), ready_rx).await {
            Err(_) => Err(WorkbenchError::ReadyTimeout),
            Ok(Err(_)) => Err(WorkbenchError::InvalidReady("ready channel closed".into())),
            Ok(Ok(Err(error))) => Err(WorkbenchError::InvalidReady(error)),
            Ok(Ok(Ok(value))) => Ok(value),
        };
        let parsed = match parsed_result {
            Ok(value) => value,
            Err(error) => {
                let _ = child.kill();
                return Err(error);
            }
        };
        if parsed.pid != expected_pid || parsed.service_version != bootstrap.app_version {
            let _ = child.kill();
            return Err(WorkbenchError::InvalidReady(
                "sidecar identity or version mismatch".into(),
            ));
        }
        let connection = ConnectionInfo {
            base_url: parsed.origin,
            token,
            protocol_version: parsed.protocol_version,
            service_version: parsed.service_version,
        };
        let mut inner = self.inner.lock().expect("sidecar mutex poisoned");
        inner.state = PublicState::Ready(connection.clone());
        inner.child = Some(child);
        inner.terminated = Some(terminated);
        Ok(connection)
    }

    async fn recover(app: AppHandle, code: Option<i32>) {
        loop {
            let (bootstrap, attempt) = {
                let manager = app.state::<SidecarManager>();
                let mut inner = manager.inner.lock().expect("sidecar mutex poisoned");
                inner.child = None;
                if matches!(inner.state, PublicState::Stopping | PublicState::Stopped) {
                    return;
                }
                let active_operation = inner
                    .bootstrap
                    .as_ref()
                    .is_some_and(|value| value.workspace_path.join(".operation-active").exists());
                if active_operation || inner.restart_count >= 2 {
                    inner.state = PublicState::Failed(format!("本地服务异常退出: {code:?}"));
                    (None, 0)
                } else {
                    inner.restart_count += 1;
                    inner.state = PublicState::Starting;
                    (inner.bootstrap.clone(), inner.restart_count)
                }
            };
            let Some(bootstrap) = bootstrap else {
                let _ = app.emit("backend-lost", code);
                return;
            };
            tokio::time::sleep(Duration::from_millis(250 * u64::from(attempt))).await;
            let manager = app.state::<SidecarManager>();
            match manager.start_once(&app, bootstrap).await {
                Ok(_) => {
                    let _ = app.emit("backend-restarted", attempt);
                    return;
                }
                Err(error) => manager.mark_failed(error.to_string()),
            }
        }
    }

    pub fn connection(&self) -> Result<ConnectionInfo, WorkbenchError> {
        match &self.inner.lock().expect("sidecar mutex poisoned").state {
            PublicState::Ready(info) => Ok(info.clone()),
            _ => Err(WorkbenchError::NotReady),
        }
    }

    pub fn diagnostics(&self) -> PublicState {
        self.inner
            .lock()
            .expect("sidecar mutex poisoned")
            .state
            .clone()
    }

    pub fn mark_failed(&self, message: String) {
        self.inner.lock().expect("sidecar mutex poisoned").state = PublicState::Failed(message);
    }

    pub async fn retry(&self, app: &AppHandle) -> Result<ConnectionInfo, WorkbenchError> {
        let bootstrap = self
            .inner
            .lock()
            .expect("sidecar mutex poisoned")
            .bootstrap
            .clone()
            .ok_or(WorkbenchError::NotReady)?;
        self.stop().await;
        match self.start(app, bootstrap).await {
            Ok(connection) => Ok(connection),
            Err(error) => {
                self.mark_failed(error.to_string());
                Err(error)
            }
        }
    }

    pub async fn stop(&self) {
        let (connection, child, terminated) = {
            let mut inner = self.inner.lock().expect("sidecar mutex poisoned");
            let connection = match &inner.state {
                PublicState::Ready(value) => Some(value.clone()),
                _ => None,
            };
            inner.state = PublicState::Stopping;
            (connection, inner.child.take(), inner.terminated.take())
        };
        if let Some(info) = connection {
            let _ = reqwest::Client::new()
                .post(format!("{}/internal/shutdown", info.base_url))
                .bearer_auth(info.token)
                .timeout(Duration::from_secs(5))
                .send()
                .await;
            if let Some(flag) = &terminated {
                let deadline = tokio::time::Instant::now() + Duration::from_secs(5);
                while !flag.load(Ordering::SeqCst) && tokio::time::Instant::now() < deadline {
                    tokio::time::sleep(Duration::from_millis(50)).await;
                }
            }
        }
        if !terminated
            .as_ref()
            .is_some_and(|value| value.load(Ordering::SeqCst))
            && let Some(process) = child
        {
            let _ = process.kill();
        }
        self.inner.lock().expect("sidecar mutex poisoned").state = PublicState::Stopped;
    }
}

#[cfg(test)]
mod tests {
    use super::{parse_ready_line, sidecar_exit_error};

    #[test]
    fn parses_valid_ready_line() {
        let ready = parse_ready_line(
            br#"{"type":"ready","protocolVersion":2,"port":49152,"pid":42,"origin":"http://127.0.0.1:49152","workspaceId":"workspace","serviceVersion":"0.2.0"}"#,
        )
        .expect("ready line should parse");
        assert_eq!(ready.port, 49152);
        assert_eq!(ready.service_version, "0.2.0");
    }

    #[test]
    fn rejects_wrong_protocol_and_invalid_json() {
        assert!(
            parse_ready_line(
                br#"{"type":"ready","protocolVersion":3,"port":1,"pid":42,"origin":"http://127.0.0.1:1","workspaceId":"workspace","serviceVersion":"x"}"#
            )
            .is_err()
        );
        assert!(parse_ready_line(b"not json").is_err());
    }

    #[test]
    fn exposes_structured_bootstrap_error() {
        let stderr = br#"{"component":"bootstrap","level":"ERROR","message":"workspace schema is incompatible"}
"#;
        assert_eq!(
            sidecar_exit_error(Some(1), stderr),
            "workspace schema is incompatible"
        );
        assert_eq!(sidecar_exit_error(Some(1), b""), "进程提前退出: Some(1)");
    }
}
