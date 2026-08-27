use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

use bip39::{Language, Mnemonic};
use chia_bls::SecretKey;
use rand::RngCore;
use rayon::prelude::*;

use crate::address::{address_from_master_index, puzzle_hash_from_master_index};
use crate::error::VanityError;
use crate::fingerprint::master_fingerprint;
use crate::params::VanityParams;

#[derive(Debug, Clone)]
pub struct SearchConfig {
    pub params: VanityParams,
    pub count: usize,
    pub batch_size: u32,
    pub threads: usize,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct SearchResult {
    pub mnemonic: String,
    pub index: u32,
    pub address: String,
    pub puzzle_hash: String,
    pub fingerprint: u32,
    pub hd_path: String,
    pub secret_key: Option<String>,
    pub derivation: String,
}

#[derive(Debug, Clone)]
pub struct SearchProgress {
    pub keys_checked: u64,
    pub keys_per_sec: f64,
    pub elapsed: Duration,
    pub eta: Option<Duration>,
}

struct SearchState {
    keys_checked: AtomicU64,
    stop: AtomicBool,
}

impl SearchState {
    fn new() -> Self {
        Self {
            keys_checked: AtomicU64::new(0),
            stop: AtomicBool::new(false),
        }
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

fn random_mnemonic() -> Result<Mnemonic, VanityError> {
    let mut entropy = [0u8; 32];
    rand::thread_rng().fill_bytes(&mut entropy);
    Ok(Mnemonic::from_entropy_in(Language::English, &entropy)?)
}

fn master_sk_from_mnemonic(mnemonic: &Mnemonic) -> SecretKey {
    let seed = mnemonic.to_seed("");
    SecretKey::from_seed(&seed)
}

fn try_index(
    master_sk: &SecretKey,
    mnemonic: &str,
    index: u32,
    config: &SearchConfig,
    fingerprint: u32,
) -> Option<SearchResult> {
    let hrp = config.params.hrp.as_str();
    let address = address_from_master_index(master_sk, index, hrp).ok()?;
    if !config.params.address_matches(&address) {
        return None;
    }
    let puzzle_hash = puzzle_hash_from_master_index(master_sk, index);
    Some(SearchResult {
        mnemonic: mnemonic.to_string(),
        index,
        address,
        puzzle_hash: hex::encode(puzzle_hash),
        fingerprint,
        hd_path: format!("m/12381/8444/2/{index}"),
        secret_key: None,
        derivation: "chia-hardened".into(),
    })
}

fn report_progress(
    state: &SearchState,
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

/// Multi-threaded CPU vanity search.
pub fn cpu_search(
    config: &SearchConfig,
    mut on_progress: impl FnMut(SearchProgress),
) -> Result<Vec<SearchResult>, VanityError> {
    config.params.validate()?;
    if config.count == 0 {
        return Err(VanityError::InvalidParams(
            "--count must be at least 1".into(),
        ));
    }

    let state = Arc::new(SearchState::new());
    let started = Instant::now();
    let expected = config.params.expected_trials();
    let mut results = Vec::new();

    let pool = rayon::ThreadPoolBuilder::new()
        .num_threads(config.threads)
        .build()
        .map_err(|e| VanityError::Other(e.to_string()))?;

    while results.len() < config.count {
        state.clear_stop();
        let mnemonic = random_mnemonic()?;
        let mnemonic_str = mnemonic.to_string();
        let master_sk = master_sk_from_mnemonic(&mnemonic);
        let fingerprint = master_fingerprint(&master_sk);

        let mut batch_start = 0u32;
        while results.len() < config.count && !state.should_stop() {
            let start = batch_start;
            let end = start.saturating_add(config.batch_size);

            let hit = pool.install(|| {
                (start..end).into_par_iter().find_map_any(|index| {
                    if state.should_stop() {
                        return None;
                    }
                    try_index(&master_sk, &mnemonic_str, index, config, fingerprint)
                })
            });

            state.add_checked((end - start) as u64);
            report_progress(&state, started, expected, &mut on_progress);

            if let Some(result) = hit {
                state.request_stop();
                results.push(result);
                break;
            }

            batch_start = end;
        }
    }

    Ok(results)
}

/// Benchmark CPU throughput for `samples` key derivations.
pub fn cpu_benchmark(samples: u32, threads: usize) -> Result<f64, VanityError> {
    let mnemonic = random_mnemonic()?;
    let master_sk = master_sk_from_mnemonic(&mnemonic);
    let started = Instant::now();

    let pool = rayon::ThreadPoolBuilder::new()
        .num_threads(threads)
        .build()
        .map_err(|e| VanityError::Other(e.to_string()))?;

    pool.install(|| {
        (0..samples).into_par_iter().for_each(|index| {
            let _ = address_from_master_index(&master_sk, index, "xch");
        });
    });

    let elapsed = started.elapsed().as_secs_f64();
    Ok(samples as f64 / elapsed)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn finds_requested_count() {
        let params = VanityParams::new(Some("q".into()), None, "xch".into()).unwrap();
        let config = SearchConfig {
            params,
            count: 2,
            batch_size: 8_192,
            threads: 2,
        };
        let results = cpu_search(&config, |_| {}).expect("search");
        assert_eq!(results.len(), 2);
        assert_ne!(results[0].address, results[1].address);
    }

    #[test]
    fn rejects_zero_count() {
        let params = VanityParams::new(Some("q".into()), None, "xch".into()).unwrap();
        let config = SearchConfig {
            params,
            count: 0,
            batch_size: 100,
            threads: 1,
        };
        assert!(cpu_search(&config, |_| {}).is_err());
    }
}
