#[cfg(cuda)]
use std::ffi::CString;

#[cfg(cuda)]
extern "C" {
    fn vanity_cuda_device_count() -> i32;
    fn vanity_cuda_filter_batch(
        intermediate_sk: *const u8,
        start_index: u32,
        hrp: *const i8,
        prefix: *const i8,
        suffix: *const i8,
        count: u32,
        out_indices: *mut u32,
        out_hashes: *mut u8,
        out_secret_keys: *mut u8,
        out_count: *mut u32,
        max_hits: u32,
    ) -> i32;
    fn vanity_cuda_debug_generator(out: *mut u8) -> i32;
}

#[cfg(cuda)]
pub fn cuda_device_count() -> i32 {
    unsafe { vanity_cuda_device_count() }
}

#[cfg(cuda)]
pub fn cuda_filter_batch(
    intermediate_sk: &[u8; 32],
    start_index: u32,
    hrp: &str,
    prefix: &str,
    suffix: &str,
    count: u32,
) -> Result<Vec<(u32, [u8; 32], [u8; 32])>, String> {
    let hrp_c = CString::new(hrp).map_err(|e| e.to_string())?;
    let prefix_c = CString::new(prefix).map_err(|e| e.to_string())?;
    let suffix_c = CString::new(suffix).map_err(|e| e.to_string())?;

    // Short suffix/prefix searches can have many GPU-side matches per batch.
    // Keep a large enough buffer that CPU verification does not miss true hits
    // when the filter returns many candidates.
    let max_hits = 8192u32;
    let mut out_indices = vec![0u32; max_hits as usize];
    let mut out_hashes = vec![0u8; max_hits as usize * 32];
    let mut out_secret_keys = vec![0u8; max_hits as usize * 32];
    let mut out_count = 0u32;

    let rc = unsafe {
        vanity_cuda_filter_batch(
            intermediate_sk.as_ptr(),
            start_index,
            hrp_c.as_ptr(),
            prefix_c.as_ptr(),
            suffix_c.as_ptr(),
            count,
            out_indices.as_mut_ptr(),
            out_hashes.as_mut_ptr(),
            out_secret_keys.as_mut_ptr(),
            &mut out_count,
            max_hits,
        )
    };

    if rc != 0 {
        return Err(format!("cuda filter failed with code {rc}"));
    }

    let mut hits = Vec::new();
    for i in 0..out_count as usize {
        let mut hash = [0u8; 32];
        hash.copy_from_slice(&out_hashes[i * 32..(i + 1) * 32]);
        let mut secret_key = [0u8; 32];
        secret_key.copy_from_slice(&out_secret_keys[i * 32..(i + 1) * 32]);
        hits.push((out_indices[i], hash, secret_key));
    }
    Ok(hits)
}

#[cfg(cuda)]
pub fn cuda_debug_generator() -> Result<[u8; 48], String> {
    let mut out = [0u8; 48];
    let rc = unsafe { vanity_cuda_debug_generator(out.as_mut_ptr()) };
    if rc != 0 {
        return Err(format!("cuda generator debug failed with code {rc}"));
    }
    Ok(out)
}
