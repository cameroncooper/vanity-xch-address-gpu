use serde::{Deserialize, Serialize};

use crate::address::{matches, BASE32_CHARSET, MAX_DATA_CHARS};
use crate::error::VanityError;

const ALLOWED_HRPS: &[&str] = &["xch", "txch"];

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VanityParams {
    pub prefix: Option<String>,
    pub suffix: Option<String>,
    pub hrp: String,
}

impl VanityParams {
    pub fn new(
        prefix: Option<String>,
        suffix: Option<String>,
        hrp: String,
    ) -> Result<Self, VanityError> {
        let params = Self {
            prefix,
            suffix,
            hrp,
        };
        params.validate()?;
        Ok(params)
    }

    pub fn validate(&self) -> Result<(), VanityError> {
        if self.prefix.is_none() && self.suffix.is_none() {
            return Err(VanityError::InvalidParams(
                "specify --prefix and/or --suffix".into(),
            ));
        }

        if !ALLOWED_HRPS.contains(&self.hrp.as_str()) {
            return Err(VanityError::InvalidParams(format!(
                "unsupported hrp '{}'; allowed: {}",
                self.hrp,
                ALLOWED_HRPS.join(", ")
            )));
        }

        let prefix_len = self.prefix.as_ref().map(|s| s.len()).unwrap_or(0);
        let suffix_len = self.suffix.as_ref().map(|s| s.len()).unwrap_or(0);

        if prefix_len + suffix_len > MAX_DATA_CHARS {
            return Err(VanityError::InvalidParams(format!(
                "prefix + suffix length ({prefix_len} + {suffix_len}) exceeds maximum {MAX_DATA_CHARS}"
            )));
        }

        if let Some(prefix) = &self.prefix {
            validate_base32(prefix, "prefix")?;
        }
        if let Some(suffix) = &self.suffix {
            validate_base32(suffix, "suffix")?;
        }

        Ok(())
    }

    pub fn prefix_ref(&self) -> Option<&str> {
        self.prefix.as_deref()
    }

    pub fn suffix_ref(&self) -> Option<&str> {
        self.suffix.as_deref()
    }

    pub fn constrained_chars(&self) -> usize {
        self.prefix.as_ref().map(|s| s.len()).unwrap_or(0)
            + self.suffix.as_ref().map(|s| s.len()).unwrap_or(0)
    }

    pub fn difficulty_bits(&self) -> f64 {
        self.constrained_chars() as f64 * 5.0
    }

    pub fn expected_trials(&self) -> f64 {
        2f64.powf(self.difficulty_bits())
    }

    pub fn address_matches(&self, address: &str) -> bool {
        matches(address, self.prefix_ref(), self.suffix_ref())
    }

    pub fn suffix_in_checksum_region(&self) -> bool {
        self.suffix.as_ref().map(|s| s.len() <= 6).unwrap_or(false)
    }
}

fn validate_base32(value: &str, field: &str) -> Result<(), VanityError> {
    let normalized = value.to_ascii_lowercase();
    for ch in normalized.chars() {
        if !BASE32_CHARSET.contains(ch) {
            return Err(VanityError::InvalidParams(format!(
                "{field} contains invalid base32 character '{ch}'"
            )));
        }
    }
    Ok(())
}

impl VanityParams {
    /// Normalize prefix/suffix to lowercase base32.
    pub fn normalize(mut self) -> Self {
        if let Some(p) = &mut self.prefix {
            *p = p.to_ascii_lowercase();
        }
        if let Some(s) = &mut self.suffix {
            *s = s.to_ascii_lowercase();
        }
        self
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_empty_pattern() {
        assert!(VanityParams::new(None, None, "xch".into()).is_err());
    }

    #[test]
    fn rejects_invalid_charset() {
        assert!(VanityParams::new(Some("café".into()), None, "xch".into()).is_err());
    }

    #[test]
    fn rejects_too_long_combined() {
        let prefix = "a".repeat(30);
        let suffix = "b".repeat(29);
        assert!(VanityParams::new(Some(prefix), Some(suffix), "xch".into()).is_err());
    }

    #[test]
    fn difficulty_scales_with_length() {
        let params = VanityParams::new(Some("cafe".into()), None, "xch".into()).unwrap();
        assert_eq!(params.constrained_chars(), 4);
        assert_eq!(params.difficulty_bits(), 20.0);
    }
}
