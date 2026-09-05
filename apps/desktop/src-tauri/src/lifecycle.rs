use crate::bootstrap::Bootstrap;
use crate::error::WorkbenchError;
use crate::sidecar_manager::SidecarManager;
use crate::workspace_registry::WorkspaceRegistry;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::{AppHandle, Manager};

#[derive(Default)]
pub struct StartupNotice(pub Mutex<Option<String>>);

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
    let workspace = registry
        .current_path()
        .unwrap_or_else(|| default_workspace.clone());
    fs::create_dir_all(&workspace).map_err(|error| WorkbenchError::Operation(error.to_string()))?;
    let manager = app.state::<SidecarManager>();
    let app_version = app.package_info().version.to_string();
    let active_workspace = match start_workspace(&manager, app, workspace, &app_version).await {
        Ok(path) => path,
        Err(error) if is_incompatible_workspace_error(&error) => {
            manager.stop().await;
            // 只恢复自动选择失败的启动入口；为新基线保留空目录，绝不覆盖原工作区。
            let recovery = async {
                let fresh = reserve_fresh_workspace(&default_workspace)?;
                start_workspace(&manager, app, fresh, &app_version).await
            }
            .await;
            let fresh = recovery.inspect_err(|error| manager.mark_failed(error.to_string()))?;
            *app.state::<StartupNotice>().0.lock().expect("startup notice mutex poisoned") = Some(
                "原工作区的数据格式不受当前版本支持，已为你打开新工作区。原目录和数据已保留，未进行迁移。".into(),
            );
            fresh
        }
        Err(error) => {
            manager.mark_failed(error.to_string());
            return Err(error);
        }
    };
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

async fn start_workspace(
    manager: &SidecarManager,
    app: &AppHandle,
    workspace: PathBuf,
    app_version: &str,
) -> Result<PathBuf, WorkbenchError> {
    let bootstrap = Bootstrap::new(
        workspace.clone(),
        workspace_name(&workspace),
        app_version.to_string(),
    );
    manager.start(app, bootstrap).await.map(|_| workspace)
}

fn is_incompatible_workspace_error(error: &WorkbenchError) -> bool {
    match error {
        WorkbenchError::InvalidReady(detail) | WorkbenchError::SidecarStart(detail) => {
            detail.starts_with("workspace schema ")
                && detail.contains(" is incompatible with the current workspace schema ")
        }
        _ => false,
    }
}

fn reserve_fresh_workspace(default_workspace: &Path) -> Result<PathBuf, WorkbenchError> {
    let parent = default_workspace
        .parent()
        .ok_or(WorkbenchError::AppDataUnavailable)?;
    fs::create_dir_all(parent).map_err(|error| WorkbenchError::Operation(error.to_string()))?;
    for index in 1..=1000 {
        let path = parent.join(format!("workspace-current-{index}"));
        match fs::create_dir(&path) {
            Ok(()) => return Ok(path),
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(error) => return Err(WorkbenchError::Operation(error.to_string())),
        }
    }
    Err(WorkbenchError::Operation("无法创建新的工作区目录".into()))
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

#[cfg(test)]
mod tests {
    use super::{is_incompatible_workspace_error, reserve_fresh_workspace};
    use crate::error::WorkbenchError;

    #[test]
    fn only_schema_incompatibility_uses_fresh_workspace() {
        assert!(is_incompatible_workspace_error(
            &WorkbenchError::SidecarStart(
                "workspace schema 3 is incompatible with the current workspace schema 1".into(),
            )
        ));
        assert!(!is_incompatible_workspace_error(
            &WorkbenchError::SidecarStart("listen loopback failed".into(),)
        ));
        assert!(!is_incompatible_workspace_error(
            &WorkbenchError::Operation(
                "workspace schema 2 is incompatible with the current workspace schema 1".into()
            )
        ));
    }

    #[test]
    fn fresh_workspace_never_reuses_or_overwrites_existing_paths() {
        let root =
            std::env::temp_dir().join(format!("workbench-recovery-{}", rand::random::<u64>()));
        std::fs::create_dir_all(root.join("workspace")).unwrap();
        std::fs::write(
            root.join("workspace/workbench.sqlite3"),
            b"original database",
        )
        .unwrap();
        std::fs::write(root.join("workspace-current-1"), b"existing file").unwrap();
        std::fs::create_dir(root.join("workspace-current-2")).unwrap();
        let fresh = reserve_fresh_workspace(&root.join("workspace")).unwrap();
        assert_eq!(fresh, root.join("workspace-current-3"));
        assert_eq!(std::fs::read_dir(fresh).unwrap().count(), 0);
        assert_eq!(
            std::fs::read(root.join("workspace/workbench.sqlite3")).unwrap(),
            b"original database"
        );
        assert_eq!(
            std::fs::read(root.join("workspace-current-1")).unwrap(),
            b"existing file"
        );
        std::fs::remove_dir_all(root).unwrap();
    }
}
