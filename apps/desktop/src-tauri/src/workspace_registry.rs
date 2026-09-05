use crate::error::WorkbenchError;
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceEntry {
    pub path: String,
    pub name: String,
    pub last_opened: u64,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct PersistedWorkspaceEntry {
    path: String,
    last_opened: u64,
}

#[derive(Default)]
pub struct WorkspaceRegistry {
    inner: Mutex<RegistryState>,
}

#[derive(Default)]
struct RegistryState {
    config_path: Option<PathBuf>,
    entries: Vec<WorkspaceEntry>,
}

impl WorkspaceRegistry {
    pub fn initialize(&self, config_path: PathBuf) -> Result<(), WorkbenchError> {
        let backup_path = config_path.with_extension("json.bak");
        let entries = match fs::read(&config_path).or_else(|error| {
            if error.kind() == std::io::ErrorKind::NotFound {
                fs::read(&backup_path)
            } else {
                Err(error)
            }
        }) {
            Ok(raw) => {
                serde_json::from_slice::<Vec<PersistedWorkspaceEntry>>(&raw).unwrap_or_default()
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Vec::new(),
            Err(error) => return Err(WorkbenchError::Operation(error.to_string())),
        };
        let mut inner = self
            .inner
            .lock()
            .expect("workspace registry mutex poisoned");
        inner.config_path = Some(config_path);
        let mut seen_paths = HashSet::new();
        inner.entries = entries
            .into_iter()
            .filter_map(|entry| {
                let path = canonicalize_workspace_path(Path::new(&entry.path)).ok()?;
                if !path.is_dir() {
                    return None;
                }
                let key = path.to_string_lossy().to_ascii_lowercase();
                if !seen_paths.insert(key) {
                    return None;
                }
                Some(WorkspaceEntry {
                    name: workspace_name(&path),
                    path: path.to_string_lossy().into_owned(),
                    last_opened: entry.last_opened,
                })
            })
            .take(10)
            .collect();
        Ok(())
    }

    pub fn entries(&self) -> Vec<WorkspaceEntry> {
        self.inner
            .lock()
            .expect("workspace registry mutex poisoned")
            .entries
            .clone()
    }

    pub fn current_path(&self) -> Option<PathBuf> {
        self.entries()
            .first()
            .map(|entry| PathBuf::from(&entry.path))
    }

    pub fn record(&self, path: &Path) -> Result<WorkspaceEntry, WorkbenchError> {
        fs::create_dir_all(path).map_err(|error| WorkbenchError::Operation(error.to_string()))?;
        let absolute = canonicalize_workspace_path(path)
            .map_err(|error| WorkbenchError::Operation(error.to_string()))?;
        let path_text = absolute.to_string_lossy().into_owned();
        let name = absolute
            .file_name()
            .and_then(|value| value.to_str())
            .filter(|value| !value.is_empty())
            .unwrap_or("个人工作台")
            .to_string();
        let entry = WorkspaceEntry {
            path: path_text.clone(),
            name,
            last_opened: SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap_or_default()
                .as_secs(),
        };
        let mut inner = self
            .inner
            .lock()
            .expect("workspace registry mutex poisoned");
        let mut entries = inner.entries.clone();
        entries.retain(|value| !value.path.eq_ignore_ascii_case(&path_text));
        entries.insert(0, entry.clone());
        entries.truncate(10);
        let config_path = inner
            .config_path
            .clone()
            .ok_or_else(|| WorkbenchError::Operation("工作区注册表尚未初始化".into()))?;
        let persisted = entries
            .iter()
            .map(|entry| PersistedWorkspaceEntry {
                path: entry.path.clone(),
                last_opened: entry.last_opened,
            })
            .collect::<Vec<_>>();
        let raw = serde_json::to_vec_pretty(&persisted)
            .map_err(|error| WorkbenchError::Operation(error.to_string()))?;
        if let Some(parent) = config_path.parent() {
            fs::create_dir_all(parent)
                .map_err(|error| WorkbenchError::Operation(error.to_string()))?;
        }
        let temporary = config_path.with_extension("json.tmp");
        fs::write(&temporary, raw).map_err(|error| WorkbenchError::Operation(error.to_string()))?;
        replace_file(&temporary, &config_path)?;
        inner.entries = entries;
        Ok(entry)
    }
}

fn workspace_name(path: &Path) -> String {
    path.file_name()
        .and_then(|value| value.to_str())
        .filter(|value| !value.is_empty())
        .unwrap_or("个人工作台")
        .to_string()
}

pub(crate) fn canonicalize_workspace_path(path: &Path) -> Result<PathBuf, io::Error> {
    fs::canonicalize(path).map(normalize_windows_path)
}

fn normalize_windows_path(path: PathBuf) -> PathBuf {
    let text = path.to_string_lossy();
    if let Some(suffix) = text.strip_prefix(r"\\?\UNC\") {
        return PathBuf::from(format!(r"\\{suffix}"));
    }
    if let Some(suffix) = text.strip_prefix(r"\\?\") {
        return PathBuf::from(suffix);
    }
    path
}

fn replace_file(temporary: &Path, destination: &Path) -> Result<(), WorkbenchError> {
    let backup = destination.with_extension("json.bak");
    let _ = fs::remove_file(&backup);
    let had_destination = destination.exists();
    if had_destination {
        fs::rename(destination, &backup)
            .map_err(|error| WorkbenchError::Operation(error.to_string()))?;
    }
    if let Err(error) = fs::rename(temporary, destination) {
        if had_destination {
            let _ = fs::rename(&backup, destination);
        }
        return Err(WorkbenchError::Operation(error.to_string()));
    }
    let _ = fs::remove_file(backup);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{WorkspaceRegistry, canonicalize_workspace_path, normalize_windows_path};
    use std::fs;
    use std::path::PathBuf;

    #[test]
    fn normalizes_windows_verbatim_paths_for_cross_process_use() {
        assert_eq!(
            normalize_windows_path(PathBuf::from(r"\\?\C:\workbench")),
            PathBuf::from(r"C:\workbench")
        );
        assert_eq!(
            normalize_windows_path(PathBuf::from(r"\\?\UNC\server\share\workbench")),
            PathBuf::from(r"\\server\share\workbench")
        );
    }

    #[test]
    fn records_recent_workspaces_without_duplicates() {
        let root =
            std::env::temp_dir().join(format!("workbench-registry-{}", rand::random::<u64>()));
        let first = root.join("first");
        let second = root.join("second");
        fs::create_dir_all(&first).expect("create first workspace");
        fs::create_dir_all(&second).expect("create second workspace");
        let registry = WorkspaceRegistry::default();
        registry
            .initialize(root.join("workspaces.json"))
            .expect("initialize registry");
        registry.record(&first).expect("record first");
        registry.record(&second).expect("record second");
        registry.record(&first).expect("reopen first");
        let entries = registry.entries();
        assert_eq!(entries.len(), 2);
        assert_eq!(entries[0].name, "first");
        assert_eq!(entries[1].name, "second");
        let persisted: serde_json::Value =
            serde_json::from_slice(&fs::read(root.join("workspaces.json")).expect("read registry"))
                .expect("parse registry");
        let fields = persisted[0]
            .as_object()
            .expect("persisted workspace entry object");
        assert!(fields.contains_key("path"));
        assert!(fields.contains_key("lastOpened"));
        assert!(!fields.contains_key("name"));

        let reloaded = WorkspaceRegistry::default();
        reloaded
            .initialize(root.join("workspaces.json"))
            .expect("reload registry");
        assert_eq!(reloaded.entries().len(), 2);
        fs::remove_dir_all(root).expect("remove registry fixture");
    }

    #[test]
    fn canonicalizes_and_deduplicates_persisted_workspace_paths() {
        let root = std::env::temp_dir().join(format!(
            "workbench-registry-dedup-{}",
            rand::random::<u64>()
        ));
        let workspace = root.join("workspace");
        let config = root.join("workspaces.json");
        fs::create_dir_all(&workspace).expect("create workspace");
        let path = workspace.to_string_lossy().into_owned();
        let persisted = serde_json::json!([
            { "path": path, "lastOpened": 2 },
            { "path": workspace.to_string_lossy(), "lastOpened": 1 }
        ]);
        fs::write(
            &config,
            serde_json::to_vec(&persisted).expect("serialize registry"),
        )
        .expect("write registry");

        let registry = WorkspaceRegistry::default();
        registry.initialize(config).expect("initialize registry");

        let entries = registry.entries();
        assert_eq!(entries.len(), 1);
        assert_eq!(
            PathBuf::from(&entries[0].path),
            canonicalize_workspace_path(&workspace).expect("canonicalize workspace")
        );
        assert_eq!(entries[0].last_opened, 2);
        fs::remove_dir_all(root).expect("remove registry fixture");
    }

    #[test]
    fn keeps_previous_entry_when_persisting_a_new_entry_fails() {
        let root = std::env::temp_dir().join(format!(
            "workbench-registry-failure-{}",
            rand::random::<u64>()
        ));
        let first = root.join("first");
        let second = root.join("second");
        fs::create_dir_all(&first).expect("create first workspace");
        fs::create_dir_all(&second).expect("create second workspace");
        let registry = WorkspaceRegistry::default();
        registry
            .initialize(root.join("workspaces.json"))
            .expect("initialize registry");
        registry.record(&first).expect("record first");

        let blocker = root.join("registry-parent-blocker");
        fs::write(&blocker, b"not a directory").expect("create parent blocker");
        registry
            .inner
            .lock()
            .expect("workspace registry mutex poisoned")
            .config_path = Some(blocker.join("workspaces.json"));

        assert!(registry.record(&second).is_err());
        assert_eq!(
            registry.current_path(),
            Some(canonicalize_workspace_path(&first).expect("canonicalize first"))
        );
        fs::remove_dir_all(root).expect("remove registry failure fixture");
    }
}
