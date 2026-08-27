use thiserror::Error;

#[derive(Debug, Error)]
pub enum GpuError {
    #[error("CUDA not available")]
    CudaUnavailable,
    #[error("CUDA error: {0}")]
    Cuda(String),
    #[error("{0}")]
    Other(String),
}

impl From<vanity_core::VanityError> for GpuError {
    fn from(err: vanity_core::VanityError) -> Self {
        Self::Other(err.to_string())
    }
}
