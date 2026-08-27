use chia_bls::{master_to_wallet_hardened, PublicKey, SecretKey};
use chia_puzzle_types::{standard::StandardArgs, DeriveSynthetic};

use crate::error::VanityError;

/// Chia bech32m data charset (lowercase).
pub const BASE32_CHARSET: &str = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";

/// Maximum data characters after the HRP separator (`xch1` → 58 chars).
pub const MAX_DATA_CHARS: usize = 58;

pub fn wallet_sk_from_master(master_sk: &SecretKey, index: u32) -> SecretKey {
    master_to_wallet_hardened(master_sk, index)
}

pub fn synthetic_public_key(wallet_pk: &PublicKey) -> PublicKey {
    wallet_pk.derive_synthetic()
}

pub fn standard_puzzle_hash(synthetic_pk: PublicKey) -> [u8; 32] {
    StandardArgs::curry_tree_hash(synthetic_pk).to_bytes()
}

pub fn puzzle_hash_from_wallet_sk(wallet_sk: &SecretKey) -> [u8; 32] {
    let wallet_pk = wallet_sk.public_key();
    let synthetic_pk = synthetic_public_key(&wallet_pk);
    standard_puzzle_hash(synthetic_pk)
}

pub fn puzzle_hash_from_master_index(master_sk: &SecretKey, index: u32) -> [u8; 32] {
    let wallet_sk = wallet_sk_from_master(master_sk, index);
    puzzle_hash_from_wallet_sk(&wallet_sk)
}

pub fn encode_puzzle_hash(puzzle_hash: &[u8; 32], hrp: &str) -> Result<String, VanityError> {
    let parsed_hrp = bech32::Hrp::parse(hrp).map_err(|e| VanityError::Bech32(e.to_string()))?;
    Ok(bech32::encode::<bech32::Bech32m>(parsed_hrp, puzzle_hash)?)
}

pub fn decode_address(address: &str) -> Result<([u8; 32], String), VanityError> {
    let (hrp, data) = bech32::decode(address)?;
    let hrp_str = hrp.to_string();
    let bytes: Vec<u8> = data;
    if bytes.len() != 32 {
        return Err(VanityError::Bech32(format!(
            "expected 32-byte puzzle hash, got {} bytes",
            bytes.len()
        )));
    }
    let mut puzzle_hash = [0u8; 32];
    puzzle_hash.copy_from_slice(&bytes);
    Ok((puzzle_hash, hrp_str))
}

pub fn address_from_wallet_sk(wallet_sk: &SecretKey, hrp: &str) -> Result<String, VanityError> {
    let puzzle_hash = puzzle_hash_from_wallet_sk(wallet_sk);
    encode_puzzle_hash(&puzzle_hash, hrp)
}

pub fn address_from_master_index(
    master_sk: &SecretKey,
    index: u32,
    hrp: &str,
) -> Result<String, VanityError> {
    let wallet_sk = wallet_sk_from_master(master_sk, index);
    address_from_wallet_sk(&wallet_sk, hrp)
}

/// Check prefix (after `xch1`) and/or suffix (end of full address string).
pub fn matches(address: &str, prefix: Option<&str>, suffix: Option<&str>) -> bool {
    let data = match address.split_once('1') {
        Some((_hrp, rest)) => rest,
        None => return false,
    };

    if let Some(p) = prefix {
        if !data.starts_with(p) {
            return false;
        }
    }
    if let Some(s) = suffix {
        if !address.ends_with(s) {
            return false;
        }
    }
    true
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trip_puzzle_hash() {
        let puzzle_hash = [0x0bu8; 32];
        let address = encode_puzzle_hash(&puzzle_hash, "xch").unwrap();
        let (decoded, hrp) = decode_address(&address).unwrap();
        assert_eq!(decoded, puzzle_hash);
        assert_eq!(hrp, "xch");
    }

    #[test]
    fn matches_prefix_suffix() {
        let addr = "xch1abc123suffix";
        assert!(matches(addr, Some("abc"), None));
        assert!(matches(addr, None, Some("suffix")));
        assert!(matches(addr, Some("abc"), Some("suffix")));
        assert!(!matches(addr, Some("xyz"), None));
        assert!(!matches(addr, None, Some("prefix")));
    }
}
