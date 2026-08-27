use thiserror::Error;

#[derive(Debug, Error)]
pub enum VanityError {
    #[error("invalid parameter: {0}")]
    InvalidParams(String),
    #[error("bech32 error: {0}")]
    Bech32(String),
    #[error("{0}")]
    Other(String),
}

impl From<bech32::EncodeError> for VanityError {
    fn from(err: bech32::EncodeError) -> Self {
        Self::Bech32(err.to_string())
    }
}

impl From<bech32::DecodeError> for VanityError {
    fn from(err: bech32::DecodeError) -> Self {
        Self::Bech32(err.to_string())
    }
}

impl From<bip39::Error> for VanityError {
    fn from(err: bip39::Error) -> Self {
        Self::Other(err.to_string())
    }
}
