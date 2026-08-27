#include <cuda_runtime.h>
#include <stdint.h>

extern "C" void vanity_launch_filter_kernel(
    const uint8_t *d_intermediate_sk,
    uint32_t start_index,
    const char *d_hrp,
    const char *d_prefix,
    const char *d_suffix,
    uint32_t count,
    uint32_t *d_out_indices,
    uint8_t *d_out_hashes,
    uint8_t *d_out_secret_keys,
    uint32_t *d_out_count,
    uint32_t max_hits
);

__global__ void filter_kernel(
    const uint8_t *intermediate_sk,
    uint32_t start_index,
    const char *hrp,
    const char *prefix,
    const char *suffix,
    uint32_t count,
    uint32_t *out_indices,
    uint8_t *out_hashes,
    uint8_t *out_secret_keys,
    uint32_t *out_count,
    uint32_t max_hits
);

__global__ void generator_compress_kernel(uint8_t *out);
__global__ void scalar_one_kernel(uint8_t *out);

extern "C" void vanity_launch_filter_kernel(
    const uint8_t *d_intermediate_sk,
    uint32_t start_index,
    const char *d_hrp,
    const char *d_prefix,
    const char *d_suffix,
    uint32_t count,
    uint32_t *d_out_indices,
    uint8_t *d_out_hashes,
    uint8_t *d_out_secret_keys,
    uint32_t *d_out_count,
    uint32_t max_hits
) {
    int threads = 256;
    int blocks = (count + threads - 1) / threads;
    filter_kernel<<<blocks, threads>>>(
        d_intermediate_sk, start_index, d_hrp, d_prefix, d_suffix,
        count, d_out_indices, d_out_hashes, d_out_secret_keys, d_out_count, max_hits
    );
}

extern "C" void vanity_launch_generator_compress_kernel(uint8_t *d_out) {
    generator_compress_kernel<<<1, 1>>>(d_out);
}

extern "C" void vanity_launch_scalar_one_kernel(uint8_t *d_out) {
    scalar_one_kernel<<<1, 1>>>(d_out);
}
