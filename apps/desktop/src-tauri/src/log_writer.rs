use std::fs::{self, File, OpenOptions};
use std::io::{self, Write};
use std::path::{Path, PathBuf};

const DEFAULT_MAX_BYTES: u64 = 5 * 1024 * 1024;
const DEFAULT_BACKUPS: usize = 3;

pub struct RotatingLog {
    path: PathBuf,
    file: File,
    size: u64,
    max_bytes: u64,
    backups: usize,
}

impl RotatingLog {
    pub fn open(directory: &Path) -> io::Result<Self> {
        Self::with_limits(directory, DEFAULT_MAX_BYTES, DEFAULT_BACKUPS)
    }

    fn with_limits(directory: &Path, max_bytes: u64, backups: usize) -> io::Result<Self> {
        fs::create_dir_all(directory)?;
        let path = directory.join("workbenchd.log");
        let file = OpenOptions::new().create(true).append(true).open(&path)?;
        let size = file.metadata()?.len();
        Ok(Self {
            path,
            file,
            size,
            max_bytes,
            backups,
        })
    }

    pub fn write(&mut self, bytes: &[u8]) -> io::Result<()> {
        if self.size > 0 && self.size.saturating_add(bytes.len() as u64) > self.max_bytes {
            self.rotate()?;
        }
        self.file.write_all(bytes)?;
        self.file.flush()?;
        self.size = self.size.saturating_add(bytes.len() as u64);
        Ok(())
    }

    fn rotate(&mut self) -> io::Result<()> {
        self.file.flush()?;
        for index in (1..=self.backups).rev() {
            let source = if index == 1 {
                self.path.clone()
            } else {
                numbered(&self.path, index - 1)
            };
            let destination = numbered(&self.path, index);
            if destination.exists() {
                fs::remove_file(&destination)?;
            }
            if source.exists() {
                fs::rename(source, destination)?;
            }
        }
        self.file = OpenOptions::new()
            .create(true)
            .write(true)
            .truncate(true)
            .open(&self.path)?;
        self.size = 0;
        Ok(())
    }
}

fn numbered(path: &Path, index: usize) -> PathBuf {
    path.with_extension(format!("log.{index}"))
}

#[cfg(test)]
mod tests {
    use super::RotatingLog;
    use std::fs;

    #[test]
    fn rotates_and_bounds_log_history() {
        let root = std::env::temp_dir().join(format!("workbench-log-{}", rand::random::<u64>()));
        let mut log = RotatingLog::with_limits(&root, 8, 2).expect("open log");
        log.write(b"first\n").expect("write first");
        log.write(b"second\n").expect("write second");
        log.write(b"third\n").expect("write third");
        assert!(root.join("workbenchd.log").exists());
        assert!(root.join("workbenchd.log.1").exists());
        assert!(root.join("workbenchd.log.2").exists());
        assert!(!root.join("workbenchd.log.3").exists());
        drop(log);
        fs::remove_dir_all(root).expect("remove log fixture");
    }
}
