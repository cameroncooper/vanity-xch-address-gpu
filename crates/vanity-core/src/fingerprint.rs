use chia_bls::SecretKey;

/// Wallet fingerprint from master public key (first 4 bytes of SHA256(pk)).
pub fn master_fingerprint(master_sk: &SecretKey) -> u32 {
    master_sk.public_key().get_fingerprint()
}
