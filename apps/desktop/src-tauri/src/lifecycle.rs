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
    let manager = app.state::<SidecarManager>();
    let app_version = app.package_info().version.to_string();
    let mut active_workspace = workspace.clone();
    let bootstrap = Bootstrap::new(
        active_workspace.clone(),
        workspace_name(&active_workspace),
        app_version.clone(),
    );
    if let Err(error) = manager.start(app, bootstrap).await {
        if is_legacy_install_workspace(&workspace) && is_schema_incompatibility(&error) {
            let fallback = app_data.join("workspace");
            fs::create_dir_all(&fallback)
                .map_err(|fallback_error| WorkbenchError::Operation(fallback_error.to_string()))?;
            eprintln!(
                "workspace schema is incompatible at {}; preserving it and starting a fresh workspace at {}",
                workspace.display(),
                fallback.display()
            );
            manager.stop().await;
            let fallback_bootstrap =
                Bootstrap::new(fallback.clone(), workspace_name(&fallback), app_version);
            manager
                .start(app, fallback_bootstrap)
                .await
                .map_err(|fallback_error| {
                    WorkbenchError::SidecarStart(format!(
                        "{}; fresh workspace startup failed: {}",
                        error, fallback_error
                    ))
                })?;
            active_workspace = fallback;
        } else {
            manager.mark_failed(error.to_string());
            return Err(error);
        }
    }
    if let Err(error) = registry.record(&active_workspace) {
        manager.stop().await;
        return Err(error);
    }
    if let Some(window) = app.get_webview_window("main") {
        if let Err(error) = window.show() {
            manager.stop().await;
            return Err(WorkbenchError::Operation(error.to_string()));
        }
        if let Err(error) = window.set_focus() {
            manager.stop().await;
            return Err(WorkbenchError::Operation(error.to_string()));
        }
    }
    Ok(())
}

fn is_schema_incompatibility(error: &WorkbenchError) -> bool {
    error.to_string().contains("workspace schema")
}

#[cfg(target_os = "windows")]
fn is_legacy_install_workspace(path: &Path) -> bool {
    let Ok(executable) = std::env::current_exe() else {
        return false;
    };
    let Some(install_directory) = executable.parent() else {
        return false;
    };
    let expected = install_directory.join("workspace");
    canonical_path_eq(path, &expected)
}

#[cfg(not(target_os = "windows"))]
fn is_legacy_install_workspace(_path: &Path) -> bool {
    false
}

fn canonical_path_eq(left: &Path, right: &Path) -> bool {
    let left = fs::canonicalize(left).unwrap_or_else(|_| left.to_path_buf());
    let right = fs::canonicalize(right).unwrap_or_else(|_| right.to_path_buf());
    #[cfg(target_os = "windows")]
    {
        left.to_string_lossy()
            .eq_ignore_ascii_case(&right.to_string_lossy())
    }
    #[cfg(not(target_os = "windows"))]
    {
        left == right
    }
}

fn workspace_name(path: &Path) -> String {
    path.file_name()
        .and_then(|value| value.to_str())
        .filter(|value| !value.is_empty())
        .unwrap_or("个人工作台")
        .to_string()
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
