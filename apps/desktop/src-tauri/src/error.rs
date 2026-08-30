use serde::Serialize;
use thiserror::Error;

#[derive(Debug, Error)]
pub enum WorkbenchError {
    #[error("无法定位应用数据目录")]
    AppDataUnavailable,
    #[error("无法启动本地服务: {0}")]
    SidecarStart(String),
    #[error("本地服务启动超时")]
    ReadyTimeout,
    #[error("本地服务握手无效: {0}")]
    InvalidReady(String),
    #[error("本地服务当前不可用")]
    NotReady,
    #[error("操作失败: {0}")]
    Operation(String),
}

impl Serialize for WorkbenchError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_str(&self.to_string())
    }
}
