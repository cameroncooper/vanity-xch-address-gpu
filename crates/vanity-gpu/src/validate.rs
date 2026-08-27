//! Cross-validation between CPU address matching and CUDA bech32m filter.

use crate::error::GpuError;

#[cfg(cuda)]
use chia_bls::{master_to_wallet_hardened_intermediate, SecretKey};
#[cfg(cuda)]
use vanity_core::{address_from_wallet_sk, puzzle_hash_from_wallet_sk, VanityParams};

#[cfg(cuda)]
use crate::batch::run_cuda_filter_batch;

/// Compare CUDA filter output against CPU matching for a batch of wallet keys.
pub fn validate_gpu_cpu_consistency(batch_size: u32) -> Result<(), GpuError> {
    #[cfg(not(cuda))]
    {
        let _ = batch_size;
        Err(GpuError::CudaUnavailable)
    }

    #[cfg(cuda)]
    {
        let gpu_generator = crate::ffi::cuda_debug_generator().map_err(GpuError::Cuda)?;
        let expected_generator = hex::decode(
            "97f1d3a73197d7942695638c4fa9ac0fc3688c4f9774b905a14e3a3f171bac586c55e83ff97a1aeffb3af00adb22c6bb",
        )
        .map_err(|e| GpuError::Other(e.to_string()))?;
        if gpu_generator.as_slice() != expected_generator.as_slice() {
            return Err(GpuError::Other(format!(
                "GPU generator compression mismatch: got {}, expected {}",
                hex::encode(gpu_generator),
                hex::encode(expected_generator)
            )));
        }
        let mut entropy = [0u8; 32];
        rand::RngCore::fill_bytes(&mut rand::thread_rng(), &mut entropy);
        let master_sk = SecretKey::from_seed(&entropy);
        let intermediate = master_to_wallet_hardened_intermediate(&master_sk);

        // Empty pattern intentionally matches every item. The GPU hit buffer is bounded,
        // so validation compares only the hits returned by CUDA.
        let params = VanityParams::new(Some(String::new()), None, "xch".into())
            .map_err(|e| GpuError::Other(e.to_string()))?;

        let cuda_hits = run_cuda_filter_batch(&intermediate, 0, batch_size, &params)?;
        if cuda_hits.is_empty() {
            return Err(GpuError::Other("GPU validation returned no hits".into()));
        }

        for (index, gpu_hash, secret_key) in &cuda_hits {
            let wallet_sk = SecretKey::from_bytes(secret_key).map_err(|e| {
                GpuError::Other(format!(
                    "GPU returned invalid secret key at index {index}: {e}"
                ))
            })?;
            let cpu_hash = puzzle_hash_from_wallet_sk(&wallet_sk);
            let address = address_from_wallet_sk(&wallet_sk, "xch")
                .map_err(|e| GpuError::Other(e.to_string()))?;
            if *gpu_hash != cpu_hash || !params.address_matches(&address) {
                return Err(GpuError::Other(format!(
                    "invalid GPU hit at index {index}: address={address}, gpu_hash={}, cpu_hash={}",
                    hex::encode(gpu_hash),
                    hex::encode(cpu_hash)
                )));
            }
        }

        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn gpu_unavailable_returns_error() {
        if crate::gpu_available() {
            return;
        }
        assert!(validate_gpu_cpu_consistency(100).is_err());
    }

    #[cfg(cuda)]
    #[test]
    fn gpu_cpu_filter_consistency() {
        if !crate::gpu_available() {
            return;
        }
        validate_gpu_cpu_consistency(1024).expect("gpu/cpu consistency");
    }
}
