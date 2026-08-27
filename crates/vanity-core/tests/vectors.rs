//! Integration tests for Chia vanity address generation.

use bip39::{Language, Mnemonic};
use chia_bls::SecretKey;
use vanity_core::{
    address_from_master_index, decode_address, encode_puzzle_hash, matches,
    puzzle_hash_from_master_index, VanityParams,
};

/// Fixed test mnemonic (DO NOT use in production — test vector only).
const TEST_MNEMONIC: &str =
    "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";

fn master_sk_from_test_mnemonic() -> SecretKey {
    let mnemonic = Mnemonic::parse_in(Language::English, TEST_MNEMONIC).unwrap();
    SecretKey::from_seed(&mnemonic.to_seed(""))
}

#[test]
fn deterministic_address_derivation() {
    let master_sk = master_sk_from_test_mnemonic();

    let addr0 = address_from_master_index(&master_sk, 0, "xch").unwrap();
    let addr0_again = address_from_master_index(&master_sk, 0, "xch").unwrap();
    assert_eq!(addr0, addr0_again);

    let addr1 = address_from_master_index(&master_sk, 1, "xch").unwrap();
    assert_ne!(addr0, addr1);

    assert!(addr0.starts_with("xch1"));
    assert_eq!(addr0.len(), 62);
}

#[test]
fn puzzle_hash_round_trip() {
    let master_sk = master_sk_from_test_mnemonic();
    let puzzle_hash = puzzle_hash_from_master_index(&master_sk, 0);
    let address = encode_puzzle_hash(&puzzle_hash, "xch").unwrap();
    let (decoded, hrp) = decode_address(&address).unwrap();
    assert_eq!(decoded, puzzle_hash);
    assert_eq!(hrp, "xch");
}

#[test]
fn prefix_suffix_matching() {
    let master_sk = master_sk_from_test_mnemonic();
    let address = address_from_master_index(&master_sk, 0, "xch").unwrap();
    let data = address.split_once('1').unwrap().1;

    let prefix = &data[..4.min(data.len())];
    let suffix = &data[data.len().saturating_sub(4)..];

    assert!(matches(&address, Some(prefix), None));
    assert!(matches(&address, None, Some(suffix)));
    assert!(matches(&address, Some(prefix), Some(suffix)));
    assert!(!matches(&address, Some("zzzzzzzz"), None));
}

#[test]
fn vanity_params_validation() {
    assert!(VanityParams::new(None, None, "xch".into()).is_err());
    assert!(VanityParams::new(Some("pwaq".into()), None, "xch".into()).is_ok());
    assert!(VanityParams::new(Some("INVALID!".into()), None, "xch".into()).is_err());
}

#[test]
fn regression_1000_indices_deterministic() {
    let master_sk = master_sk_from_test_mnemonic();
    for index in 0..1000u32 {
        let a = address_from_master_index(&master_sk, index, "xch").unwrap();
        let b = address_from_master_index(&master_sk, index, "xch").unwrap();
        assert_eq!(a, b, "index {index} not deterministic");
    }
}
