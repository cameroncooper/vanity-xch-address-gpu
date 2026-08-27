#include "filter.h"

#include <cuda_runtime.h>
#include <cstring>

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

extern "C" void vanity_launch_generator_compress_kernel(uint8_t *d_out);
extern "C" void vanity_launch_scalar_one_kernel(uint8_t *d_out);

extern "C" int vanity_cuda_device_count() {
    int n = 0;
    if (cudaGetDeviceCount(&n) != cudaSuccess) {
        return 0;
    }
    return n;
}

extern "C" int vanity_cuda_filter_batch(
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
) {
    uint8_t *d_intermediate_sk = nullptr;
    char *d_hrp = nullptr;
    char *d_prefix = nullptr;
    char *d_suffix = nullptr;
    uint32_t *d_out_indices = nullptr;
    uint8_t *d_out_hashes = nullptr;
    uint8_t *d_out_secret_keys = nullptr;
    uint32_t *d_out_count = nullptr;
    int rc = -1;

    const uint32_t zero = 0;

    if (cudaMalloc(&d_intermediate_sk, 32) != cudaSuccess) goto cleanup;
    if (cudaMalloc(&d_hrp, 16) != cudaSuccess) goto cleanup;
    if (cudaMalloc(&d_prefix, 64) != cudaSuccess) goto cleanup;
    if (cudaMalloc(&d_suffix, 64) != cudaSuccess) goto cleanup;
    if (cudaMalloc(&d_out_indices, max_hits * sizeof(uint32_t)) != cudaSuccess) goto cleanup;
    if (cudaMalloc(&d_out_hashes, max_hits * 32) != cudaSuccess) goto cleanup;
    if (cudaMalloc(&d_out_secret_keys, max_hits * 32) != cudaSuccess) goto cleanup;
    if (cudaMalloc(&d_out_count, sizeof(uint32_t)) != cudaSuccess) goto cleanup;

    if (cudaMemcpy(d_intermediate_sk, intermediate_sk, 32, cudaMemcpyHostToDevice) != cudaSuccess) goto cleanup;
    if (cudaMemcpy(d_hrp, hrp, std::strlen(hrp) + 1, cudaMemcpyHostToDevice) != cudaSuccess) goto cleanup;
    if (cudaMemcpy(d_prefix, prefix, std::strlen(prefix) + 1, cudaMemcpyHostToDevice) != cudaSuccess) goto cleanup;
    if (cudaMemcpy(d_suffix, suffix, std::strlen(suffix) + 1, cudaMemcpyHostToDevice) != cudaSuccess) goto cleanup;
    if (cudaMemcpy(d_out_count, &zero, sizeof(uint32_t), cudaMemcpyHostToDevice) != cudaSuccess) goto cleanup;

    vanity_launch_filter_kernel(
        d_intermediate_sk, start_index, d_hrp, d_prefix, d_suffix,
        count, d_out_indices, d_out_hashes, d_out_secret_keys, d_out_count, max_hits
    );

    if (cudaDeviceSynchronize() != cudaSuccess) goto cleanup;

    if (cudaMemcpy(out_count, d_out_count, sizeof(uint32_t), cudaMemcpyDeviceToHost) != cudaSuccess) goto cleanup;
    if (*out_count > max_hits) *out_count = max_hits;
    if (cudaMemcpy(out_indices, d_out_indices, *out_count * sizeof(uint32_t), cudaMemcpyDeviceToHost) != cudaSuccess) goto cleanup;
    if (cudaMemcpy(out_hashes, d_out_hashes, *out_count * 32, cudaMemcpyDeviceToHost) != cudaSuccess) goto cleanup;
    if (cudaMemcpy(out_secret_keys, d_out_secret_keys, *out_count * 32, cudaMemcpyDeviceToHost) != cudaSuccess) goto cleanup;

    rc = 0;

cleanup:
    if (d_intermediate_sk) cudaFree(d_intermediate_sk);
    if (d_hrp) cudaFree(d_hrp);
    if (d_prefix) cudaFree(d_prefix);
    if (d_suffix) cudaFree(d_suffix);
    if (d_out_indices) cudaFree(d_out_indices);
    if (d_out_hashes) cudaFree(d_out_hashes);
    if (d_out_secret_keys) cudaFree(d_out_secret_keys);
    if (d_out_count) cudaFree(d_out_count);
    return rc;
}

extern "C" int vanity_cuda_debug_generator(uint8_t *out) {
    uint8_t *d_out = nullptr;
    int rc = -1;
    if (cudaMalloc(&d_out, 48) != cudaSuccess) goto cleanup;
    vanity_launch_generator_compress_kernel(d_out);
    if (cudaDeviceSynchronize() != cudaSuccess) goto cleanup;
    if (cudaMemcpy(out, d_out, 48, cudaMemcpyDeviceToHost) != cudaSuccess) goto cleanup;
    rc = 0;

cleanup:
    if (d_out) cudaFree(d_out);
    return rc;
}

extern "C" int vanity_cuda_debug_scalar_one(uint8_t *out) {
    uint8_t *d_out = nullptr;
    int rc = -1;
    if (cudaMalloc(&d_out, 48) != cudaSuccess) goto cleanup;
    vanity_launch_scalar_one_kernel(d_out);
    if (cudaDeviceSynchronize() != cudaSuccess) goto cleanup;
    if (cudaMemcpy(out, d_out, 48, cudaMemcpyDeviceToHost) != cudaSuccess) goto cleanup;
    rc = 0;

cleanup:
    if (d_out) cudaFree(d_out);
    return rc;
}
