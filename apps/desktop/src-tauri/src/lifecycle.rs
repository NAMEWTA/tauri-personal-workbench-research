use crate::bootstrap::Bootstrap;
use crate::error::WorkbenchError;
use crate::sidecar_manager::SidecarManager;
use crate::workspace_registry::WorkspaceRegistry;
use std::fs;
use std::path::PathBuf;
use tauri::{AppHandle, Manager};
use tauri_plugin_dialog::DialogExt;

pub async fn start_backend(app: &AppHandle) -> Result<(), WorkbenchError> {
    let app_data = match std::env::var_os("WORKBENCH_DEV_APP_DATA_DIR") {
        Some(path) if !path.is_empty() => PathBuf::from(path),
        _ => app
            .path()
            .app_local_data_dir()
            .map_err(|_| WorkbenchError::AppDataUnavailable)?,
    };
    let registry = app.state::<WorkspaceRegistry>();
    registry.initialize(app_data.join("workspaces.json"))?;
    let default_workspace = app_data.join("workspace");
    let workspace = if let Some(recent) = registry.current_path() {
        recent
    } else if cfg!(debug_assertions) || default_workspace.join("workbench.sqlite3").exists() {
        default_workspace
    } else {
        app.dialog()
            .file()
            .set_title("选择个人工作台目录")
            .blocking_pick_folder()
            .map(|path| std::path::PathBuf::from(path.to_string()))
            .unwrap_or(default_workspace)
    };
    fs::create_dir_all(&workspace).map_err(|error| WorkbenchError::Operation(error.to_string()))?;
    let entry = registry.record(&workspace)?;
    let bootstrap = Bootstrap::new(
        workspace,
        entry.name,
        app.package_info().version.to_string(),
    );
    let manager = app.state::<SidecarManager>();
    if let Err(error) = manager.start(app, bootstrap).await {
        manager.mark_failed(error.to_string());
        return Err(error);
    }
    if let Some(window) = app.get_webview_window("main") {
        window
            .show()
            .map_err(|error| WorkbenchError::Operation(error.to_string()))?;
        window
            .set_focus()
            .map_err(|error| WorkbenchError::Operation(error.to_string()))?;
    }
    Ok(())
}
