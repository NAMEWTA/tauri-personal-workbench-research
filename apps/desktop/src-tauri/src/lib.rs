mod bootstrap;
mod commands;
mod error;
mod lifecycle;
mod log_writer;
mod sidecar_manager;
mod workspace_registry;

use sidecar_manager::SidecarManager;
use std::sync::{
    Arc,
    atomic::{AtomicBool, Ordering},
};
use tauri::Manager;
use workspace_registry::WorkspaceRegistry;

pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _, _| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_shell::init())
        .manage(SidecarManager::default())
        .manage(WorkspaceRegistry::default())
        .invoke_handler(tauri::generate_handler![
            commands::backend_connection_info,
            commands::backend_diagnostics,
            commands::retry_backend,
            commands::select_workspace_directory,
            commands::list_recent_workspaces,
            commands::open_workspace,
            commands::select_attachment_files,
            commands::open_managed_file,
            commands::select_backup_destination,
            commands::select_backup_file,
            commands::reveal_log_directory
        ])
        .setup(|app| {
            let handle = app.handle().clone();
            if let Err(error) = tauri::async_runtime::block_on(lifecycle::start_backend(&handle)) {
                eprintln!("startup failed: {error}");
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("failed to build Personal Workbench");

    let exiting = Arc::new(AtomicBool::new(false));
    app.run(move |handle, event| {
        if let tauri::RunEvent::ExitRequested { api, .. } = event {
            if exiting.swap(true, Ordering::SeqCst) {
                return;
            }
            api.prevent_exit();
            let app_handle = handle.clone();
            std::thread::spawn(move || {
                tauri::async_runtime::block_on(app_handle.state::<SidecarManager>().stop());
                app_handle.exit(0);
            });
        }
    });
}

#[cfg(test)]
mod tests {
    #[test]
    fn capability_does_not_expose_sensitive_plugins() {
        let capability = include_str!("../capabilities/default.json");
        for forbidden in ["shell:", "fs:", "process:", "updater:"] {
            assert!(
                !capability.contains(forbidden),
                "capability unexpectedly contains {forbidden}"
            );
        }
        assert!(capability.contains("core:default"));
    }
}
