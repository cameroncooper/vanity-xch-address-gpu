#include <cuda_runtime.h>
#include <stdint.h>
#include "ff/bls12-381.hpp"
#include "fixed_base_table.cuh"

using bls12_381::fp_t;

// Bech32m constants (BIP-350)
static __constant__ uint32_t BECH32M_CONST = 0x2bc830a3;
static __device__ const char CHARSET[] = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";

// Fixed CLVM tree-hash constants for currying p2_delegated_puzzle_or_hidden_puzzle
// with a single synthetic public key argument.
static __device__ const uint8_t Q_KW_TREEHASH[32] = {
    0x9d,0xcf,0x97,0xa1,0x84,0xf3,0x26,0x23,0xd1,0x1a,0x73,0x12,0x4c,0xeb,0x99,0xa5,
    0x70,0x9b,0x08,0x37,0x21,0xe8,0x78,0xa1,0x6d,0x78,0xf5,0x96,0x71,0x8b,0xa7,0xb2
};
static __device__ const uint8_t A_KW_TREEHASH[32] = {
    0xa1,0x28,0x71,0xfe,0xe2,0x10,0xfb,0x86,0x19,0x29,0x1e,0xae,0xa1,0x94,0x58,0x1c,
    0xbd,0x25,0x31,0xe4,0xb2,0x37,0x59,0xd2,0x25,0xf6,0x80,0x69,0x23,0xf6,0x32,0x22
};
static __device__ const uint8_t C_KW_TREEHASH[32] = {
    0xa8,0xd5,0xdd,0x63,0xfb,0xa4,0x71,0xeb,0xcb,0x1f,0x3e,0x8f,0x7c,0x1e,0x18,0x79,
    0xb7,0x15,0x2a,0x6e,0x72,0x98,0xa9,0x1c,0xe1,0x19,0xa6,0x34,0x00,0xad,0xe7,0xc5
};
static __device__ const uint8_t ONE_TREEHASH[32] = {
    0x9d,0xcf,0x97,0xa1,0x84,0xf3,0x26,0x23,0xd1,0x1a,0x73,0x12,0x4c,0xeb,0x99,0xa5,
    0x70,0x9b,0x08,0x37,0x21,0xe8,0x78,0xa1,0x6d,0x78,0xf5,0x96,0x71,0x8b,0xa7,0xb2
};
static __device__ const uint8_t NIL_TREEHASH[32] = {
    0x4b,0xf5,0x12,0x2f,0x34,0x45,0x54,0xc5,0x3b,0xde,0x2e,0xbb,0x8c,0xd2,0xb7,0xe3,
    0xd1,0x60,0x0a,0xd6,0x31,0xc3,0x85,0xa5,0xd7,0xcc,0xe2,0x3c,0x77,0x85,0x45,0x9a
};
static __device__ const uint8_t QUOTED_MOD_HASH[32] = {
    0x98,0x90,0xa9,0xbd,0x13,0x30,0xfc,0x3c,0x4f,0x4a,0xf0,0xde,0x86,0x42,0xdc,0x31,
    0xb1,0xd5,0x25,0xe2,0xb1,0x8e,0x0f,0xde,0x4e,0xae,0x07,0x9a,0xfb,0x1b,0x60,0xa4
};

static __device__ const uint32_t SHA256_K[64] = {
    0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,
    0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,
    0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,
    0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,
    0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,
    0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,
    0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,
    0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2
};

static __device__ const uint8_t DEFAULT_HIDDEN_PUZZLE_HASH[32] = {
    0x71,0x1d,0x6c,0x4e,0x32,0xc9,0x2e,0x53,0x17,0x9b,0x19,0x94,0x84,0xcf,0x8c,0x89,
    0x75,0x42,0xbc,0x57,0xf2,0xb2,0x25,0x82,0x79,0x9f,0x9d,0x65,0x7e,0xec,0x46,0x99
};
static __device__ const uint8_t GROUP_ORDER[32] = {
    0x73,0xed,0xa7,0x53,0x29,0x9d,0x7d,0x48,0x33,0x39,0xd8,0x08,0x09,0xa1,0xd8,0x05,
    0x53,0xbd,0xa4,0x02,0xff,0xfe,0x5b,0xfe,0xff,0xff,0xff,0xff,0x00,0x00,0x00,0x01
};
static __device__ const uint8_t NEG_TWO_256_MOD_GROUP_ORDER[32] = {
    0x5b,0xc8,0xf5,0xf9,0x7c,0xd8,0x77,0xd8,0x99,0xad,0x88,0x18,0x1c,0xe5,0x88,0x0f,
    0xfb,0x38,0xec,0x08,0xff,0xfb,0x13,0xfc,0xff,0xff,0xff,0xfd,0x00,0x00,0x00,0x03
};
static __device__ const uint8_t HALF_P[48] = {
    0x0d,0x00,0x88,0xf5,0x1c,0xbf,0xf3,0x4d,0x25,0x8d,0xd3,0xdb,0x21,0xa5,0xd6,0x6b,
    0xb2,0x3b,0xa5,0xc2,0x79,0xc2,0x89,0x5f,0xb3,0x98,0x69,0x50,0x7b,0x58,0x7b,0x12,
    0x0f,0x55,0xff,0xf5,0x8a,0x9f,0xff,0xfd,0xcf,0xf7,0xff,0xff,0xff,0xfd,0x55,0x55
};
static __device__ const uint8_t FIELD_P_MINUS_2[48] = {
    0x1a,0x01,0x11,0xea,0x39,0x7f,0xe6,0x9a,0x4b,0x1b,0xa7,0xb6,0x43,0x4b,0xac,0xd7,
    0x64,0x77,0x4b,0x84,0xf3,0x85,0x12,0xbf,0x67,0x30,0xd2,0xa0,0xf6,0xb0,0xf6,0x24,
    0x1e,0xab,0xff,0xfe,0xb1,0x53,0xff,0xff,0xb9,0xfe,0xff,0xff,0xff,0xff,0xaa,0xa9
};
static __device__ const uint8_t G1_GENERATOR_X[48] = {
    0x17,0xf1,0xd3,0xa7,0x31,0x97,0xd7,0x94,0x26,0x95,0x63,0x8c,0x4f,0xa9,0xac,0x0f,
    0xc3,0x68,0x8c,0x4f,0x97,0x74,0xb9,0x05,0xa1,0x4e,0x3a,0x3f,0x17,0x1b,0xac,0x58,
    0x6c,0x55,0xe8,0x3f,0xf9,0x7a,0x1a,0xef,0xfb,0x3a,0xf0,0x0a,0xdb,0x22,0xc6,0xbb
};
static __device__ const uint8_t G1_GENERATOR_Y[48] = {
    0x08,0xb3,0xf4,0x81,0xe3,0xaa,0xa0,0xf1,0xa0,0x9e,0x30,0xed,0x74,0x1d,0x8a,0xe4,
    0xfc,0xf5,0xe0,0x95,0xd5,0xd0,0x0a,0xf6,0x00,0xdb,0x18,0xcb,0x2c,0x04,0xb3,0xed,
    0xd0,0x3c,0xc7,0x44,0xa2,0x88,0x8a,0xe4,0x0c,0xaa,0x23,0x29,0x46,0xc5,0xe7,0xe1
};

struct g1_affine_t {
    fp_t x;
    fp_t y;
    bool inf;
};

struct g1_projective_t {
    fp_t x;
    fp_t y;
    fp_t z;
    bool inf;
};

struct sha256_ctx_t {
    uint32_t state[8];
    uint64_t bit_len;
    uint8_t buffer[64];
    int buffer_len;
};

__device__ uint32_t rotr32(uint32_t x, int n) {
    return (x >> n) | (x << (32 - n));
}

__device__ void sha256_transform(uint32_t state[8], const uint8_t block[64]) {
    uint32_t w[64];
    for (int i = 0; i < 16; i++) {
        w[i] = ((uint32_t)block[i * 4] << 24)
             | ((uint32_t)block[i * 4 + 1] << 16)
             | ((uint32_t)block[i * 4 + 2] << 8)
             | ((uint32_t)block[i * 4 + 3]);
    }
    for (int i = 16; i < 64; i++) {
        uint32_t s0 = rotr32(w[i - 15], 7) ^ rotr32(w[i - 15], 18) ^ (w[i - 15] >> 3);
        uint32_t s1 = rotr32(w[i - 2], 17) ^ rotr32(w[i - 2], 19) ^ (w[i - 2] >> 10);
        w[i] = w[i - 16] + s0 + w[i - 7] + s1;
    }

    uint32_t a = state[0], b = state[1], c = state[2], d = state[3];
    uint32_t e = state[4], f = state[5], g = state[6], h = state[7];
    for (int i = 0; i < 64; i++) {
        uint32_t s1 = rotr32(e, 6) ^ rotr32(e, 11) ^ rotr32(e, 25);
        uint32_t ch = (e & f) ^ (~e & g);
        uint32_t temp1 = h + s1 + ch + SHA256_K[i] + w[i];
        uint32_t s0 = rotr32(a, 2) ^ rotr32(a, 13) ^ rotr32(a, 22);
        uint32_t maj = (a & b) ^ (a & c) ^ (b & c);
        uint32_t temp2 = s0 + maj;
        h = g; g = f; f = e; e = d + temp1;
        d = c; c = b; b = a; a = temp1 + temp2;
    }

    state[0] += a; state[1] += b; state[2] += c; state[3] += d;
    state[4] += e; state[5] += f; state[6] += g; state[7] += h;
}

__device__ void sha256_init(sha256_ctx_t* ctx) {
    ctx->state[0] = 0x6a09e667;
    ctx->state[1] = 0xbb67ae85;
    ctx->state[2] = 0x3c6ef372;
    ctx->state[3] = 0xa54ff53a;
    ctx->state[4] = 0x510e527f;
    ctx->state[5] = 0x9b05688c;
    ctx->state[6] = 0x1f83d9ab;
    ctx->state[7] = 0x5be0cd19;
    ctx->bit_len = 0;
    ctx->buffer_len = 0;
}

__device__ void sha256_update(sha256_ctx_t* ctx, const uint8_t* input, int len) {
    for (int i = 0; i < len; i++) {
        ctx->buffer[ctx->buffer_len++] = input[i];
        ctx->bit_len += 8;
        if (ctx->buffer_len == 64) {
            sha256_transform(ctx->state, ctx->buffer);
            ctx->buffer_len = 0;
        }
    }
}

__device__ void sha256_final(sha256_ctx_t* ctx, uint8_t out[32]) {
    int rem = ctx->buffer_len;
    ctx->buffer[rem++] = 0x80;
    if (rem > 56) {
        while (rem < 64) ctx->buffer[rem++] = 0;
        sha256_transform(ctx->state, ctx->buffer);
        rem = 0;
    }
    while (rem < 56) ctx->buffer[rem++] = 0;
    for (int i = 0; i < 8; i++) {
        ctx->buffer[63 - i] = (uint8_t)(ctx->bit_len >> (i * 8));
    }
    sha256_transform(ctx->state, ctx->buffer);

    for (int i = 0; i < 8; i++) {
        out[i * 4] = (uint8_t)(ctx->state[i] >> 24);
        out[i * 4 + 1] = (uint8_t)(ctx->state[i] >> 16);
        out[i * 4 + 2] = (uint8_t)(ctx->state[i] >> 8);
        out[i * 4 + 3] = (uint8_t)ctx->state[i];
    }
}

__device__ void sha256_bytes(const uint8_t *input, int len, uint8_t out[32]) {
    uint32_t state[8] = {
        0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,
        0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19
    };

    uint8_t block[64];
    int offset = 0;
    while (len - offset >= 64) {
        for (int i = 0; i < 64; i++) block[i] = input[offset + i];
        sha256_transform(state, block);
        offset += 64;
    }

    int rem = len - offset;
    for (int i = 0; i < 64; i++) block[i] = 0;
    for (int i = 0; i < rem; i++) block[i] = input[offset + i];
    block[rem] = 0x80;

    uint64_t bit_len = (uint64_t)len * 8;
    if (rem >= 56) {
        sha256_transform(state, block);
        for (int i = 0; i < 64; i++) block[i] = 0;
    }
    for (int i = 0; i < 8; i++) {
        block[63 - i] = (uint8_t)(bit_len >> (i * 8));
    }
    sha256_transform(state, block);

    for (int i = 0; i < 8; i++) {
        out[i * 4] = (uint8_t)(state[i] >> 24);
        out[i * 4 + 1] = (uint8_t)(state[i] >> 16);
        out[i * 4 + 2] = (uint8_t)(state[i] >> 8);
        out[i * 4 + 3] = (uint8_t)state[i];
    }
}

__device__ void shatree_atom_synthetic_pk(const uint8_t synthetic_pk[48], uint8_t out[32]) {
    uint8_t input[49];
    input[0] = 0x01;
    for (int i = 0; i < 48; i++) input[i + 1] = synthetic_pk[i];
    sha256_bytes(input, 49, out);
}

__device__ void shatree_pair(const uint8_t left[32], const uint8_t right[32], uint8_t out[32]) {
    uint8_t input[65];
    input[0] = 0x02;
    for (int i = 0; i < 32; i++) {
        input[i + 1] = left[i];
        input[i + 33] = right[i];
    }
    sha256_bytes(input, 65, out);
}

__device__ void standard_puzzle_hash_from_synthetic_pk(const uint8_t synthetic_pk[48], uint8_t out[32]) {
    uint8_t pk_atom[32];
    uint8_t quoted_arg[32];
    uint8_t one_nil[32];
    uint8_t quoted_arg_and_rest[32];
    uint8_t curried_values[32];
    uint8_t curried_nil[32];
    uint8_t mod_and_args[32];

    shatree_atom_synthetic_pk(synthetic_pk, pk_atom);
    shatree_pair(Q_KW_TREEHASH, pk_atom, quoted_arg);
    shatree_pair(ONE_TREEHASH, NIL_TREEHASH, one_nil);
    shatree_pair(quoted_arg, one_nil, quoted_arg_and_rest);
    shatree_pair(C_KW_TREEHASH, quoted_arg_and_rest, curried_values);
    shatree_pair(curried_values, NIL_TREEHASH, curried_nil);
    shatree_pair(QUOTED_MOD_HASH, curried_nil, mod_and_args);
    shatree_pair(A_KW_TREEHASH, mod_and_args, out);
}

__device__ int bytes_ge(const uint8_t *a, const uint8_t *b, int len) {
    for (int i = 0; i < len; i++) {
        if (a[i] > b[i]) return 1;
        if (a[i] < b[i]) return 0;
    }
    return 1;
}

__device__ void bytes_sub_inplace(uint8_t *a, const uint8_t *b, int len) {
    int borrow = 0;
    for (int i = len - 1; i >= 0; i--) {
        int v = (int)a[i] - (int)b[i] - borrow;
        if (v < 0) {
            v += 256;
            borrow = 1;
        } else {
            borrow = 0;
        }
        a[i] = (uint8_t)v;
    }
}

__device__ void reduce_scalar_mod_order(uint8_t scalar[32]) {
    // SHA256 output is < 2^256, so at most two subtractions are needed.
    if (bytes_ge(scalar, GROUP_ORDER, 32)) bytes_sub_inplace(scalar, GROUP_ORDER, 32);
    if (bytes_ge(scalar, GROUP_ORDER, 32)) bytes_sub_inplace(scalar, GROUP_ORDER, 32);
}

__device__ void add_scalars_mod_order(const uint8_t a[32], const uint8_t b[32], uint8_t out[32]);

__device__ void reduce_signed_scalar_mod_order(uint8_t scalar[32]) {
    bool negative = (scalar[0] & 0x80) != 0;
    reduce_scalar_mod_order(scalar);
    if (negative) {
        uint8_t corrected[32];
        add_scalars_mod_order(scalar, NEG_TWO_256_MOD_GROUP_ORDER, corrected);
        for (int i = 0; i < 32; i++) scalar[i] = corrected[i];
    }
}

__device__ void add_scalars_mod_order(const uint8_t a[32], const uint8_t b[32], uint8_t out[32]) {
    int carry = 0;
    for (int i = 31; i >= 0; i--) {
        int v = (int)a[i] + (int)b[i] + carry;
        out[i] = (uint8_t)v;
        carry = v >> 8;
    }
    // Both inputs are < r; the sum is < 2r, so one subtraction is enough.
    if (carry || bytes_ge(out, GROUP_ORDER, 32)) {
        bytes_sub_inplace(out, GROUP_ORDER, 32);
    }
}

__device__ void derive_gpu_native_child_sk(const uint8_t intermediate_sk[32], uint32_t index, uint8_t wallet_sk[32]) {
    const uint8_t domain[19] = {
        'v','a','n','i','t','y','-','c','h','i','a','-','g','p','u','-','v','1',0
    };
    sha256_ctx_t ctx;
    sha256_init(&ctx);
    sha256_update(&ctx, domain, 18);
    sha256_update(&ctx, intermediate_sk, 32);
    uint8_t index_bytes[4] = {
        (uint8_t)(index >> 24),
        (uint8_t)(index >> 16),
        (uint8_t)(index >> 8),
        (uint8_t)index
    };
    sha256_update(&ctx, index_bytes, 4);
    sha256_final(&ctx, wallet_sk);
    reduce_scalar_mod_order(wallet_sk);

    bool nonzero = false;
    for (int i = 0; i < 32; i++) nonzero |= wallet_sk[i] != 0;
    if (!nonzero) wallet_sk[31] = 1;
}

__device__ fp_t fp_from_be48(const uint8_t be[48]) {
#ifdef __CUDA_ARCH__
    uint32_t limbs[24];
    for (int i = 0; i < 24; i++) limbs[i] = 0;
    for (int i = 0; i < 12; i++) {
        int j = 48 - 4 * (i + 1);
        limbs[i] = ((uint32_t)be[j] << 24)
                 | ((uint32_t)be[j + 1] << 16)
                 | ((uint32_t)be[j + 2] << 8)
                 | ((uint32_t)be[j + 3]);
    }
    fp_t out;
    out.to(limbs, true);
    return out;
#else
    return fp_t();
#endif
}

__device__ fp_t fp_one() {
    uint8_t one[48];
    for (int i = 0; i < 48; i++) one[i] = 0;
    one[47] = 1;
    return fp_from_be48(one);
}

__device__ void fp_to_be48(fp_t value, uint8_t be[48]) {
#ifdef __CUDA_ARCH__
    uint32_t limbs[12];
    value.from();
    value.store(limbs);
    for (int i = 0; i < 12; i++) {
        uint32_t w = limbs[i];
        int j = 48 - 4 * (i + 1);
        be[j] = (uint8_t)(w >> 24);
        be[j + 1] = (uint8_t)(w >> 16);
        be[j + 2] = (uint8_t)(w >> 8);
        be[j + 3] = (uint8_t)w;
    }
#endif
}

__device__ g1_affine_t affine_from_uncompressed(const uint8_t bytes[96]) {
    g1_affine_t p;
    p.x = fp_from_be48(bytes);
    p.y = fp_from_be48(bytes + 48);
    p.inf = false;
    return p;
}

__device__ g1_affine_t generator_affine() {
    g1_affine_t g;
    g.x = fp_from_be48(G1_GENERATOR_X);
    g.y = fp_from_be48(G1_GENERATOR_Y);
    g.inf = false;
    return g;
}

__device__ g1_projective_t projective_inf() {
    g1_projective_t p;
    p.x.zero();
    p.y = fp_one();
    p.z.zero();
    p.inf = true;
    return p;
}

__device__ bool projective_is_inf(const g1_projective_t& p) {
    return p.inf;
}

__device__ void projective_double(g1_projective_t& p) {
    if (projective_is_inf(p) || p.y.is_zero()) {
        p = projective_inf();
        return;
    }

    fp_t A = p.x ^ 2;
    fp_t B = p.y ^ 2;
    fp_t C = B ^ 2;
    fp_t X1_plus_B = p.x + B;
    fp_t D = (X1_plus_B ^ 2) - A - C;
    D += D;
    fp_t E = A + A + A;
    fp_t F = E ^ 2;
    fp_t X3 = F - D - D;
    fp_t eightC = C + C;
    eightC += eightC;
    eightC += eightC;
    fp_t Y3 = E * (D - X3) - eightC;
    fp_t Z3 = p.y * p.z;
    Z3 += Z3;

    p.x = X3;
    p.y = Y3;
    p.z = Z3;
    p.inf = false;
}

__device__ void projective_add_affine(g1_projective_t& p, const g1_affine_t& q) {
    if (q.inf) return;
    if (projective_is_inf(p)) {
        p.x = q.x;
        p.y = q.y;
        p.z = fp_one();
        p.inf = false;
        return;
    }

    fp_t Z1Z1 = p.z ^ 2;
    fp_t U2 = q.x * Z1Z1;
    fp_t S2 = q.y * p.z * Z1Z1;
    fp_t H = U2 - p.x;
    fp_t R = S2 - p.y;

    if (H.is_zero()) {
        if (R.is_zero()) {
            projective_double(p);
        } else {
            p = projective_inf();
        }
        return;
    }

    fp_t HH = H ^ 2;
    fp_t HHH = H * HH;
    fp_t V = p.x * HH;
    fp_t X3 = (R ^ 2) - HHH - V - V;
    fp_t Y3 = R * (V - X3) - p.y * HHH;
    fp_t Z3 = p.z * H;

    p.x = X3;
    p.y = Y3;
    p.z = Z3;
    p.inf = false;
}

__device__ fp_t fp_inverse(fp_t value);

__device__ g1_affine_t projective_to_affine(const g1_projective_t& p) {
    g1_affine_t out;
    if (projective_is_inf(p)) {
        out.x.zero();
        out.y.zero();
        out.inf = true;
        return out;
    }
    fp_t z_inv = fp_inverse(p.z);
    fp_t z2 = z_inv ^ 2;
    fp_t z3 = z2 * z_inv;
    out.x = p.x * z2;
    out.y = p.y * z3;
    out.inf = false;
    return out;
}

__device__ int scalar_bit(const uint8_t scalar[32], int bit) {
    int byte_idx = bit / 8;
    int bit_idx = 7 - (bit % 8);
    return (scalar[byte_idx] >> bit_idx) & 1;
}

__device__ int scalar_bit_lsb(const uint8_t scalar[32], int bit) {
    int byte_idx = 31 - bit / 8;
    int bit_idx = bit % 8;
    return (scalar[byte_idx] >> bit_idx) & 1;
}

__device__ int scalar_bit_48(const uint8_t scalar[48], int bit) {
    int byte_idx = bit / 8;
    int bit_idx = 7 - (bit % 8);
    return (scalar[byte_idx] >> bit_idx) & 1;
}

__device__ fp_t fp_pow_be48(fp_t base, const uint8_t exp[48]) {
    fp_t acc = fp_one();
    for (int bit = 0; bit < 384; bit++) {
        acc *= acc;
        if (scalar_bit_48(exp, bit)) {
            acc *= base;
        }
    }
    return acc;
}

__device__ fp_t fp_inverse(fp_t value) {
    return fp_pow_be48(value, FIELD_P_MINUS_2);
}

__device__ g1_projective_t fixed_base_mul_generator(const uint8_t scalar[32]) {
    g1_projective_t acc = projective_inf();
    for (int window = 0; window < FIXED_BASE_WINDOWS; window++) {
        int digit = 0;
        #pragma unroll
        for (int bit = 0; bit < FIXED_BASE_WINDOW_BITS; bit++) {
            int scalar_bit_index = window * FIXED_BASE_WINDOW_BITS + bit;
            if (scalar_bit_index < 256) {
                digit |= scalar_bit_lsb(scalar, scalar_bit_index) << bit;
            }
        }
        if (digit != 0) {
            const uint8_t* table_point = &G1_FIXED_BASE[window][digit - 1][0];
            g1_affine_t p = affine_from_uncompressed(table_point);
            projective_add_affine(acc, p);
        }
    }
    return acc;
}

__device__ int fp_is_lexicographically_largest(fp_t y) {
    uint8_t y_bytes[48];
    fp_to_be48(y, y_bytes);
    return bytes_ge(y_bytes, HALF_P, 48);
}

__device__ void compress_g1(const g1_affine_t& p, uint8_t out[48]) {
    fp_to_be48(p.x, out);
    out[0] |= 0x80; // compression bit
    if (p.inf) {
        out[0] |= 0x40;
    } else if (fp_is_lexicographically_largest(p.y)) {
        out[0] |= 0x20;
    }
}

__device__ void synthetic_pk_from_wallet_pk(
    const uint8_t wallet_pk[48],
    const uint8_t wallet_sk[32],
    uint8_t synthetic_pk[48]
) {
    uint8_t offset_input[80];
    for (int i = 0; i < 48; i++) offset_input[i] = wallet_pk[i];
    for (int i = 0; i < 32; i++) offset_input[48 + i] = DEFAULT_HIDDEN_PUZZLE_HASH[i];

    uint8_t offset[32];
    sha256_bytes(offset_input, 80, offset);
    reduce_signed_scalar_mod_order(offset);

    uint8_t synthetic_sk[32];
    add_scalars_mod_order(wallet_sk, offset, synthetic_sk);
    g1_projective_t synthetic_pk_projective = fixed_base_mul_generator(synthetic_sk);
    g1_affine_t synthetic_affine = projective_to_affine(synthetic_pk_projective);
    compress_g1(synthetic_affine, synthetic_pk);
}

__device__ uint32_t bech32_polymod_step(uint32_t values[], int len) {
    uint32_t chk = 1;
    for (int i = 0; i < len; i++) {
        uint32_t b = chk >> 25;
        chk = ((chk & 0x1ffffff) << 5) ^ values[i];
        if (b & 1) chk ^= 0x3b6a57b2;
        if (b & 2) chk ^= 0x26508e6d;
        if (b & 4) chk ^= 0x1ea119fa;
        if (b & 8) chk ^= 0x3d4233dd;
        if (b & 16) chk ^= 0x2a1462b3;
    }
    return chk;
}

__device__ void convert_bits_8_to_5(const uint8_t *data, int in_len, uint8_t *out, int *out_len) {
    int acc = 0;
    int bits = 0;
    int o = 0;
    for (int i = 0; i < in_len; i++) {
        acc = (acc << 8) | data[i];
        bits += 8;
        while (bits >= 5) {
            bits -= 5;
            out[o++] = (acc >> bits) & 0x1f;
        }
    }
    if (bits > 0) {
        out[o++] = (acc << (5 - bits)) & 0x1f;
    }
    *out_len = o;
}

__device__ int charset_index(char ch) {
    for (int i = 0; i < 32; i++) {
        if (CHARSET[i] == ch) return i;
    }
    return -1;
}

__device__ void bech32_data_values(
    const char *hrp,
    const uint8_t puzzle_hash[32],
    uint8_t out_values[58],
    int *out_len
) {
    uint8_t data5[64];
    int data5_len = 0;
    convert_bits_8_to_5(puzzle_hash, 32, data5, &data5_len);

    uint32_t values[128];
    int vlen = 0;
    int hrp_len = 0;
    while (hrp[hrp_len] != '\0') hrp_len++;

    for (int i = 0; i < hrp_len; i++) values[vlen++] = hrp[i] >> 5;
    values[vlen++] = 0;
    for (int i = 0; i < hrp_len; i++) values[vlen++] = hrp[i] & 31;

    for (int i = 0; i < data5_len; i++) values[vlen++] = data5[i];

    int checksum_start = vlen;
    for (int i = 0; i < 6; i++) {
        values[vlen++] = 0;
    }

    uint32_t polymod = bech32_polymod_step(values, vlen) ^ BECH32M_CONST;
    for (int i = 0; i < 6; i++) {
        values[checksum_start + i] = (polymod >> (5 * (5 - i))) & 31;
    }

    int pos = 0;
    for (int i = hrp_len * 2 + 1; i < vlen; i++) {
        out_values[pos++] = (uint8_t)values[i];
    }
    *out_len = pos;
}

__device__ int bech32_values_match(
    const uint8_t values[58],
    int values_len,
    const char *prefix,
    const char *suffix
) {
    for (int i = 0; prefix[i] != '\0'; i++) {
        if (i >= values_len) return 0;
        int expected = charset_index(prefix[i]);
        if (expected < 0 || values[i] != expected) return 0;
    }

    int suffix_len = 0;
    while (suffix[suffix_len] != '\0') suffix_len++;
    if (suffix_len > values_len) return 0;
    for (int i = 0; i < suffix_len; i++) {
        int expected = charset_index(suffix[i]);
        if (expected < 0) return 0;
        if (values[values_len - suffix_len + i] != expected) return 0;
    }
    return 1;
}

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
) {
    uint32_t i = blockIdx.x * blockDim.x + threadIdx.x;
    if (i >= count) return;

    uint32_t index = start_index + i;
    uint8_t wallet_sk[32];
    derive_gpu_native_child_sk(intermediate_sk, index, wallet_sk);

    g1_projective_t wallet_pk_projective = fixed_base_mul_generator(wallet_sk);
    g1_affine_t wallet_pk_affine = projective_to_affine(wallet_pk_projective);
    uint8_t wallet_pk[48];
    compress_g1(wallet_pk_affine, wallet_pk);

    uint8_t synthetic_pk[48];
    synthetic_pk_from_wallet_pk(wallet_pk, wallet_sk, synthetic_pk);

    uint8_t puzzle_hash[32];
    standard_puzzle_hash_from_synthetic_pk(synthetic_pk, puzzle_hash);

    uint8_t bech32_values[58];
    int bech32_values_len = 0;
    bech32_data_values(hrp, puzzle_hash, bech32_values, &bech32_values_len);

    int match = bech32_values_match(bech32_values, bech32_values_len, prefix, suffix);
    if (!match) return;

    uint32_t slot = atomicAdd(out_count, 1);
    if (slot >= max_hits) return;

    out_indices[slot] = index;
    for (int b = 0; b < 32; b++) {
        out_hashes[slot * 32 + b] = puzzle_hash[b];
        out_secret_keys[slot * 32 + b] = wallet_sk[b];
    }
}

__global__ void generator_compress_kernel(uint8_t *out) {
    g1_affine_t g = generator_affine();
    compress_g1(g, out);
}

__global__ void scalar_one_kernel(uint8_t *out) {
    uint8_t scalar[32];
    for (int i = 0; i < 32; i++) scalar[i] = 0;
    scalar[31] = 1;
    g1_projective_t p = fixed_base_mul_generator(scalar);
    g1_affine_t a = projective_to_affine(p);
    compress_g1(a, out);
}
