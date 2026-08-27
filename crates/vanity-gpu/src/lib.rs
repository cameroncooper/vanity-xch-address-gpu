mod batch;
mod error;

#[cfg(cuda)]
mod ffi;

mod validate;

pub use batch::{gpu_available, gpu_benchmark, gpu_search, GpuSearchConfig};
pub use error::GpuError;
pub use validate::validate_gpu_cpu_consistency;
