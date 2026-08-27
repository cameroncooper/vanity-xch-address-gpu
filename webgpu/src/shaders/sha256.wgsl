const SHA256_K: array<u32, 64> = array<u32, 64>(
  0x428a2f98u, 0x71374491u, 0xb5c0fbcfu, 0xe9b5dba5u, 0x3956c25bu, 0x59f111f1u, 0x923f82a4u, 0xab1c5ed5u,
  0xd807aa98u, 0x12835b01u, 0x243185beu, 0x550c7dc3u, 0x72be5d74u, 0x80deb1feu, 0x9bdc06a7u, 0xc19bf174u,
  0xe49b69c1u, 0xefbe4786u, 0x0fc19dc6u, 0x240ca1ccu, 0x2de92c6fu, 0x4a7484aau, 0x5cb0a9dcu, 0x76f988dau,
  0x983e5152u, 0xa831c66du, 0xb00327c8u, 0xbf597fc7u, 0xc6e00bf3u, 0xd5a79147u, 0x06ca6351u, 0x14292967u,
  0x27b70a85u, 0x2e1b2138u, 0x4d2c6dfcu, 0x53380d13u, 0x650a7354u, 0x766a0abbu, 0x81c2c92eu, 0x92722c85u,
  0xa2bfe8a1u, 0xa81a664bu, 0xc24b8b70u, 0xc76c51a3u, 0xd192e819u, 0xd6990624u, 0xf40e3585u, 0x106aa070u,
  0x19a4c116u, 0x1e376c08u, 0x2748774cu, 0x34b0bcb5u, 0x391c0cb3u, 0x4ed8aa4au, 0x5b9cca4fu, 0x682e6ff3u,
  0x748f82eeu, 0x78a5636fu, 0x84c87814u, 0x8cc70208u, 0x90befffau, 0xa4506cebu, 0xbef9a3f7u, 0xc67178f2u,
);

fn rotr32(x: u32, n: u32) -> u32 {
  return (x >> n) | (x << (32u - n));
}

fn sha256_transform(state: ptr<function, array<u32, 8>>, block: ptr<function, array<u32, 16>>) {
  var w: array<u32, 64>;
  for (var i = 0u; i < 16u; i++) {
    w[i] = (*block)[i];
  }
  for (var i = 16u; i < 64u; i++) {
    let s0 = rotr32(w[i - 15u], 7u) ^ rotr32(w[i - 15u], 18u) ^ (w[i - 15u] >> 3u);
    let s1 = rotr32(w[i - 2u], 17u) ^ rotr32(w[i - 2u], 19u) ^ (w[i - 2u] >> 10u);
    w[i] = w[i - 16u] + s0 + w[i - 7u] + s1;
  }
  var a = (*state)[0];
  var b = (*state)[1];
  var c = (*state)[2];
  var d = (*state)[3];
  var e = (*state)[4];
  var f = (*state)[5];
  var g = (*state)[6];
  var h = (*state)[7];
  for (var i = 0u; i < 64u; i++) {
    let s1 = rotr32(e, 6u) ^ rotr32(e, 11u) ^ rotr32(e, 25u);
    let ch = (e & f) ^ ((~e) & g);
    let temp1 = h + s1 + ch + SHA256_K[i] + w[i];
    let s0 = rotr32(a, 2u) ^ rotr32(a, 13u) ^ rotr32(a, 22u);
    let maj = (a & b) ^ (a & c) ^ (b & c);
    let temp2 = s0 + maj;
    h = g; g = f; f = e; e = d + temp1;
    d = c; c = b; b = a; a = temp1 + temp2;
  }
  (*state)[0] += a;
  (*state)[1] += b;
  (*state)[2] += c;
  (*state)[3] += d;
  (*state)[4] += e;
  (*state)[5] += f;
  (*state)[6] += g;
  (*state)[7] += h;
}

fn sha256_init_state() -> array<u32, 8> {
  var state: array<u32, 8>;
  state[0] = 0x6a09e667u;
  state[1] = 0xbb67ae85u;
  state[2] = 0x3c6ef372u;
  state[3] = 0xa54ff53au;
  state[4] = 0x510e527fu;
  state[5] = 0x9b05688cu;
  state[6] = 0x1f83d9abu;
  state[7] = 0x5be0cd19u;
  return state;
}

fn load_be_word(input: ptr<function, array<u32, 80>>, off: u32, len: u32) -> u32 {
  var word = 0u;
  for (var i = 0u; i < 4u; i++) {
    let idx = off + i;
    var byte = 0u;
    if (idx < len) {
      byte = (*input)[idx];
    } else if (idx == len) {
      byte = 0x80u;
    }
    word = (word << 8u) | byte;
  }
  return word;
}

fn sha256_bytes(input: ptr<function, array<u32, 80>>, len: u32) -> array<u32, 32> {
  var state = sha256_init_state();
  var block: array<u32, 16>;
  var offset = 0u;
  loop {
    if (len - offset < 64u) {
      break;
    }
    for (var i = 0u; i < 16u; i++) {
      block[i] = load_be_word(input, offset + i * 4u, len);
    }
    sha256_transform(&state, &block);
    offset += 64u;
  }
  for (var i = 0u; i < 16u; i++) {
    block[i] = 0u;
  }
  let rem = len - offset;
  for (var i = 0u; i < 16u; i++) {
    block[i] = load_be_word(input, offset + i * 4u, len);
  }
  if (rem >= 56u) {
    sha256_transform(&state, &block);
    for (var i = 0u; i < 16u; i++) {
      block[i] = 0u;
    }
  }
  block[15] = len * 8u;
  sha256_transform(&state, &block);
  var out: array<u32, 32>;
  for (var i = 0u; i < 8u; i++) {
    let w = state[i];
    out[i * 4u] = (w >> 24u) & 0xffu;
    out[i * 4u + 1u] = (w >> 16u) & 0xffu;
    out[i * 4u + 2u] = (w >> 8u) & 0xffu;
    out[i * 4u + 3u] = w & 0xffu;
  }
  return out;
}
