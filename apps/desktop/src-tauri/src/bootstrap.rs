use base64::{Engine as _, engine::general_purpose::URL_SAFE_NO_PAD};
use rand::RngCore;
use serde::Serialize;
use std::path::PathBuf;

pub const PROTOCOL_VERSION: u32 = 2;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Bootstrap {
    pub protocol_version: u32,
    pub parent_pid: u32,
    pub token: String,
    pub workspace_path: PathBuf,
    pub workspace_name: String,
    pub app_version: String,
    pub allowed_origins: Vec<String>,
}

impl Bootstrap {
    pub fn new(workspace_path: PathBuf, workspace_name: String, app_version: String) -> Self {
        let mut bytes = [0_u8; 32];
        rand::rng().fill_bytes(&mut bytes);
        Self {
            protocol_version: PROTOCOL_VERSION,
            parent_pid: std::process::id(),
            token: URL_SAFE_NO_PAD.encode(bytes),
            workspace_path,
            workspace_name,
            app_version,
            allowed_origins: vec![
                "http://127.0.0.1:1420".to_string(),
                "tauri://localhost".to_string(),
                "http://tauri.localhost".to_string(),
                "https://tauri.localhost".to_string(),
            ],
        }
    }
}
