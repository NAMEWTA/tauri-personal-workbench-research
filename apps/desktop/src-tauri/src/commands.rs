use crate::bootstrap::Bootstrap;
use crate::error::WorkbenchError;
use crate::sidecar_manager::{ConnectionInfo, PublicState, SidecarManager};
use crate::workspace_registry::{WorkspaceEntry, WorkspaceRegistry, canonicalize_workspace_path};
use std::fs;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager, State};
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_opener::OpenerExt;

#[tauri::command]
pub fn backend_connection_info(
    manager: State<'_, SidecarManager>,
) -> Result<ConnectionInfo, WorkbenchError> {
    manager.connection()
}

#[tauri::command]
pub fn backend_diagnostics(manager: State<'_, SidecarManager>) -> PublicState {
    manager.diagnostics()
}

#[tauri::command]
pub async fn retry_backend(
    app: AppHandle,
    manager: State<'_, SidecarManager>,
) -> Result<ConnectionInfo, WorkbenchError> {
    manager.retry(&app).await
}

#[tauri::command]
pub fn select_workspace_directory(app: AppHandle) -> Result<Option<String>, WorkbenchError> {
    Ok(app
        .dialog()
        .file()
        .blocking_pick_folder()
        .map(|path| path.to_string()))
}

#[tauri::command]
pub fn list_recent_workspaces(registry: State<'_, WorkspaceRegistry>) -> Vec<WorkspaceEntry> {
    registry.entries()
}

#[tauri::command]
pub async fn open_workspace(
    app: AppHandle,
    manager: State<'_, SidecarManager>,
    registry: State<'_, WorkspaceRegistry>,
    path: String,
) -> Result<ConnectionInfo, WorkbenchError> {
    let requested = PathBuf::from(path);
    fs::create_dir_all(&requested).map_err(|error| WorkbenchError::Operation(error.to_string()))?;
    let requested = canonicalize_workspace_path(&requested)
        .map_err(|error| WorkbenchError::Operation(error.to_string()))?;
    let previous = registry.current_path();
    manager.stop().await;
    let bootstrap = Bootstrap::new(
        requested.clone(),
        workspace_name(&requested),
        app.package_info().version.to_string(),
    );
    match manager.start(&app, bootstrap).await {
        Ok(connection) => match registry.record(&requested) {
            Ok(_) => Ok(connection),
            Err(error) => {
                manager.stop().await;
                if let Some(previous) = previous {
                    let rollback = Bootstrap::new(
                        previous.clone(),
                        workspace_name(&previous),
                        app.package_info().version.to_string(),
                    );
                    let _ = manager.start(&app, rollback).await;
                }
                Err(error)
            }
        },
        Err(error) => {
            if let Some(previous) = previous {
                let rollback = Bootstrap::new(
                    previous.clone(),
                    workspace_name(&previous),
                    app.package_info().version.to_string(),
                );
                let _ = manager.start(&app, rollback).await;
            }
            Err(error)
        }
    }
}

fn workspace_name(path: &Path) -> String {
    path.file_name()
        .and_then(|value| value.to_str())
        .filter(|value| !value.is_empty())
        .unwrap_or("个人工作台")
        .to_string()
}

#[tauri::command]
pub fn select_attachment_files(app: AppHandle) -> Result<Vec<String>, WorkbenchError> {
    Ok(app
        .dialog()
        .file()
        .blocking_pick_files()
        .unwrap_or_default()
        .into_iter()
        .map(|path| path.to_string())
        .collect())
}

#[tauri::command]
pub fn open_managed_file(
    app: AppHandle,
    registry: State<'_, WorkspaceRegistry>,
    path: String,
) -> Result<(), WorkbenchError> {
    let workspace = registry.current_path().ok_or(WorkbenchError::NotReady)?;
    let root = fs::canonicalize(workspace.join("attachments"))
        .map_err(|error| WorkbenchError::Operation(error.to_string()))?;
    let target =
        fs::canonicalize(path).map_err(|error| WorkbenchError::Operation(error.to_string()))?;
    if !target.starts_with(&root) || !target.is_file() {
        return Err(WorkbenchError::Operation("附件路径不在托管目录内".into()));
    }
    app.opener()
        .open_path(target.to_string_lossy().into_owned(), None::<&str>)
        .map_err(|error| WorkbenchError::Operation(error.to_string()))
}

#[tauri::command]
pub fn select_backup_destination(app: AppHandle) -> Result<Option<String>, WorkbenchError> {
    Ok(app
        .dialog()
        .file()
        .blocking_pick_folder()
        .map(|path| path.to_string()))
}

#[tauri::command]
pub fn select_backup_file(app: AppHandle) -> Result<Option<String>, WorkbenchError> {
    Ok(app
        .dialog()
        .file()
        .add_filter("工作台备份", &["zip"])
        .blocking_pick_file()
        .map(|path| path.to_string()))
}

#[tauri::command]
pub fn reveal_log_directory(app: AppHandle) -> Result<(), WorkbenchError> {
    let registry = app.state::<WorkspaceRegistry>();
    let workspace = registry.current_path().ok_or(WorkbenchError::NotReady)?;
    let path = workspace.join("logs");
    app.opener()
        .open_path(path.to_string_lossy().into_owned(), None::<&str>)
        .map_err(|error| WorkbenchError::Operation(error.to_string()))
}
