use crate::bootstrap::Bootstrap;
use crate::error::WorkbenchError;
use crate::sidecar_manager::SidecarManager;
use crate::workspace_registry::WorkspaceRegistry;
use std::fs;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};

pub async fn start_backend(app: &AppHandle) -> Result<(), WorkbenchError> {
    let app_data_override = std::env::var_os("WORKBENCH_DEV_APP_DATA_DIR")
        .filter(|path| !path.is_empty())
        .map(PathBuf::from);
    let app_data = match &app_data_override {
        Some(path) => path.clone(),
        None => app
            .path()
            .app_local_data_dir()
            .map_err(|_| WorkbenchError::AppDataUnavailable)?,
    };
    let config_directory = std::env::var_os("WORKBENCH_DEV_CONFIG_DIR")
        .filter(|path| !path.is_empty())
        .map(PathBuf::from)
        .unwrap_or_else(|| app_data.clone());
    let registry = app.state::<WorkspaceRegistry>();
    registry.initialize(config_directory.join("workspaces.json"))?;
    let default_workspace = if app_data_override.is_some() {
        app_data.join("workspace")
    } else {
        platform_default_workspace(&app_data)?
    };
    let workspace = if let Some(recent) = registry.current_path() {
        recent
    } else {
        default_workspace
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

#[cfg(target_os = "windows")]
fn platform_default_workspace(_app_data: &Path) -> Result<PathBuf, WorkbenchError> {
    let executable =
        std::env::current_exe().map_err(|error| WorkbenchError::Operation(error.to_string()))?;
    executable
        .parent()
        .map(|directory| directory.join("workspace"))
        .ok_or_else(|| WorkbenchError::Operation("无法定位程序安装目录".into()))
}

#[cfg(not(target_os = "windows"))]
fn platform_default_workspace(app_data: &Path) -> Result<PathBuf, WorkbenchError> {
    Ok(app_data.join("workspace"))
}
