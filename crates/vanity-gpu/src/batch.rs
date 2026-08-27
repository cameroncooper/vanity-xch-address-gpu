use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

use bip39::{Language, Mnemonic};
use chia_bls::{master_to_wallet_hardened_intermediate, SecretKey};
use rand::RngCore;
#[cfg(not(cuda))]
use rayon::prelude::*;
use vanity_core::{
    address_from_wallet_sk, master_fingerprint, puzzle_hash_from_wallet_sk, SearchConfig,
    SearchProgress, SearchResult, VanityParams,
};

use crate::error::GpuError;

#[cfg(cuda)]
use crate::ffi;

pub struct GpuSearchConfig {
    pub search: SearchConfig,
    pub gpu_batch: u32,
}

pub fn gpu_available() -> bool {
    #[cfg(cuda)]
    {
        ffi::cuda_device_count() > 0
    }
    #[cfg(not(cuda))]
    {
        false
    }
}

fn random_mnemonic() -> Result<Mnemonic, GpuError> {
    let mut entropy = [0u8; 32];
    rand::thread_rng().fill_bytes(&mut entropy);
    Mnemonic::from_entropy_in(Language::English, &entropy)
        .map_err(|e| GpuError::Other(e.to_string()))
}

fn master_sk_from_mnemonic(mnemonic: &Mnemonic) -> SecretKey {
    SecretKey::from_seed(&mnemonic.to_seed(""))
}

fn report_progress(
    state: &Arc<SearchState>,
    started: Instant,
    expected: f64,
    on_progress: &mut impl FnMut(SearchProgress),
) {
    let elapsed = started.elapsed();
    let keys = state.keys_checked();
    let keys_per_sec = if elapsed.as_secs_f64() > 0.0 {
        keys as f64 / elapsed.as_secs_f64()
    } else {
        0.0
    };
    let eta = if keys_per_sec > 0.0 {
        let remaining = (expected - keys as f64).max(0.0);
        Some(Duration::from_secs_f64(remaining / keys_per_sec))
    } else {
        None
    };
    on_progress(SearchProgress {
        keys_checked: keys,
        keys_per_sec,
        elapsed,
        eta,
    });
}

struct SearchState {
    keys_checked: AtomicU64,
    stop: AtomicBool,
}

impl SearchState {
    fn new() -> Arc<Self> {
        Arc::new(Self {
            keys_checked: AtomicU64::new(0),
            stop: AtomicBool::new(false),
        })
    }

    fn add_checked(&self, n: u64) {
        self.keys_checked.fetch_add(n, Ordering::Relaxed);
    }

    fn keys_checked(&self) -> u64 {
        self.keys_checked.load(Ordering::Relaxed)
    }

    fn request_stop(&self) {
        self.stop.store(true, Ordering::Relaxed);
    }

    fn clear_stop(&self) {
        self.stop.store(false, Ordering::Relaxed);
    }

    fn should_stop(&self) -> bool {
        self.stop.load(Ordering::Relaxed)
    }
}

/// Derive wallet secret keys for a batch of indices from cached intermediate key.
#[cfg(not(cuda))]
pub(crate) fn derive_wallet_batch(
    intermediate: &SecretKey,
    start: u32,
    count: u32,
) -> Vec<(u32, SecretKey)> {
    (0..count)
        .into_par_iter()
        .map(|offset| {
            let index = start + offset;
            (index, intermediate.derive_hardened(index))
        })
        .collect()
}

fn verify_hit(
    wallet_sk: &SecretKey,
    index: u32,
    mnemonic: &str,
    fingerprint: u32,
    params: &VanityParams,
) -> Option<SearchResult> {
    let address = address_from_wallet_sk(wallet_sk, &params.hrp).ok()?;
    if !params.address_matches(&address) {
        return None;
    }
    let puzzle_hash = puzzle_hash_from_wallet_sk(wallet_sk);
    Some(SearchResult {
        mnemonic: mnemonic.to_string(),
        index,
        address,
        puzzle_hash: hex::encode(puzzle_hash),
        fingerprint,
        hd_path: format!("gpu-native/{index}"),
        secret_key: Some(hex::encode(wallet_sk.to_bytes())),
        derivation: "gpu-native-nonportable".into(),
    })
}

#[cfg(not(cuda))]
fn scan_batch_cpu(
    wallet_keys: &[(u32, SecretKey)],
    mnemonic: &str,
    fingerprint: u32,
    params: &VanityParams,
    state: &SearchState,
) -> Option<SearchResult> {
    wallet_keys.par_iter().find_map_any(|(index, wallet_sk)| {
        if state.should_stop() {
            return None;
        }
        verify_hit(wallet_sk, *index, mnemonic, fingerprint, params)
    })
}

/// GPU-accelerated search using CUDA bech32m filtering after CPU key derivation.
pub fn gpu_search(
    config: &GpuSearchConfig,
    mut on_progress: impl FnMut(SearchProgress),
) -> Result<Vec<SearchResult>, GpuError> {
    if !gpu_available() {
        return Err(GpuError::CudaUnavailable);
    }

    config.search.params.validate()?;
    if config.search.count == 0 {
        return Err(GpuError::Other("--count must be at least 1".into()));
    }

    let state = SearchState::new();
    let started = Instant::now();
    let expected = config.search.params.expected_trials();
    let mut results = Vec::new();

    while results.len() < config.search.count {
        state.clear_stop();
        let mnemonic = random_mnemonic()?;
        let mnemonic_str = mnemonic.to_string();
        let master_sk = master_sk_from_mnemonic(&mnemonic);
        let intermediate = master_to_wallet_hardened_intermediate(&master_sk);
        let fingerprint = master_fingerprint(&master_sk);

        let mut batch_start = 0u32;
        while results.len() < config.search.count && !state.should_stop() {
            let batch_size = config.gpu_batch;

            let hit = process_batch(
                &intermediate,
                batch_start,
                batch_size,
                &mnemonic_str,
                fingerprint,
                &config.search.params,
                &state,
            )?;

            state.add_checked(batch_size as u64);
            report_progress(&state, started, expected, &mut on_progress);

            if let Some(result) = hit {
                state.request_stop();
                results.push(result);
                break;
            }

            batch_start = batch_start.saturating_add(batch_size);
        }
    }

    Ok(results)
}

fn process_batch(
    intermediate: &SecretKey,
    batch_start: u32,
    batch_size: u32,
    mnemonic: &str,
    fingerprint: u32,
    params: &VanityParams,
    _state: &SearchState,
) -> Result<Option<SearchResult>, GpuError> {
    #[cfg(cuda)]
    {
        let cuda_hits = run_cuda_filter_batch(intermediate, batch_start, batch_size, params)?;
        for (index, _, secret_key) in cuda_hits {
            let wallet_sk = SecretKey::from_bytes(&secret_key)
                .map_err(|e| GpuError::Other(format!("GPU returned invalid secret key: {e}")))?;
            if let Some(result) = verify_hit(&wallet_sk, index, mnemonic, fingerprint, params) {
                return Ok(Some(result));
            }
        }
        return Ok(None);
    }

    #[cfg(not(cuda))]
    {
        let wallet_keys = derive_wallet_batch(intermediate, batch_start, batch_size);
        Ok(scan_batch_cpu(
            &wallet_keys,
            mnemonic,
            fingerprint,
            params,
            _state,
        ))
    }
}

#[cfg(cuda)]
pub(crate) fn run_cuda_filter_batch(
    intermediate: &SecretKey,
    batch_start: u32,
    batch_size: u32,
    params: &VanityParams,
) -> Result<Vec<(u32, [u8; 32], [u8; 32])>, GpuError> {
    let prefix = params.prefix.as_deref().unwrap_or("");
    let suffix = params.suffix.as_deref().unwrap_or("");
    let intermediate_sk = intermediate.to_bytes();

    ffi::cuda_filter_batch(
        &intermediate_sk,
        batch_start,
        &params.hrp,
        prefix,
        suffix,
        batch_size,
    )
    .map_err(GpuError::Cuda)
}

/// Benchmark GPU batch throughput (key derivation + optional CUDA filter).
pub fn gpu_benchmark(samples: u32, batch_size: u32) -> Result<f64, GpuError> {
    if !gpu_available() {
        return Err(GpuError::CudaUnavailable);
    }

    let mnemonic = random_mnemonic()?;
    let master_sk = master_sk_from_mnemonic(&mnemonic);
    let intermediate = master_to_wallet_hardened_intermediate(&master_sk);
    let params = VanityParams::new(Some("a".into()), None, "xch".into()).unwrap();

    let started = Instant::now();
    let mut processed = 0u32;

    while processed < samples {
        let count = batch_size.min(samples - processed);

        #[cfg(cuda)]
        {
            let _ = run_cuda_filter_batch(&intermediate, processed, count, &params)?;
        }

        #[cfg(not(cuda))]
        {
            let wallet_keys = derive_wallet_batch(&intermediate, processed, count);
            for (_, wallet_sk) in &wallet_keys {
                let _ =
                    vanity_core::encode_puzzle_hash(&puzzle_hash_from_wallet_sk(wallet_sk), "xch");
            }
            let _ = &params;
        }

        processed += count;
    }

    let elapsed = started.elapsed().as_secs_f64();
    Ok(samples as f64 / elapsed)
}
