#pragma once

#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

int vanity_cuda_device_count(void);

int vanity_cuda_filter_batch(
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

int vanity_cuda_debug_generator(uint8_t *out);
int vanity_cuda_debug_scalar_one(uint8_t *out);

#ifdef __cplusplus
}
#endif
