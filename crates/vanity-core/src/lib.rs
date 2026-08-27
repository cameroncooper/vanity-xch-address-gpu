//! Chia vanity address generation: derivation, encoding, matching, and search.

mod address;
mod error;
mod fingerprint;
mod params;
mod search;

pub use address::BASE32_CHARSET;
pub use address::{
    address_from_master_index, address_from_wallet_sk, decode_address, encode_puzzle_hash, matches,
    puzzle_hash_from_master_index, puzzle_hash_from_wallet_sk,
};
pub use error::VanityError;
pub use fingerprint::master_fingerprint;
pub use params::VanityParams;
pub use search::{cpu_benchmark, cpu_search, SearchConfig, SearchProgress, SearchResult};
