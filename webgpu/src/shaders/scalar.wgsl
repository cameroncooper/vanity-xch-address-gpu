const GROUP_ORDER: array<u32, 32> = array<u32, 32>(
  0x73u, 0xedu, 0xa7u, 0x53u, 0x29u, 0x9du, 0x7du, 0x48u,
  0x33u, 0x39u, 0xd8u, 0x08u, 0x09u, 0xa1u, 0xd8u, 0x05u,
  0x53u, 0xbdu, 0xa4u, 0x02u, 0xffu, 0xfeu, 0x5bu, 0xfeu,
  0xffu, 0xffu, 0xffu, 0xffu, 0x00u, 0x00u, 0x00u, 0x01u,
);

const NEG_TWO_256_MOD_GROUP_ORDER: array<u32, 32> = array<u32, 32>(
  0x5bu, 0xc8u, 0xf5u, 0xf9u, 0x7cu, 0xd8u, 0x77u, 0xd8u,
  0x99u, 0xadu, 0x88u, 0x18u, 0x1cu, 0xe5u, 0x88u, 0x0fu,
  0xfbu, 0x38u, 0xecu, 0x08u, 0xffu, 0xfbu, 0x13u, 0xfcu,
  0xffu, 0xffu, 0xffu, 0xfdu, 0x00u, 0x00u, 0x00u, 0x03u,
);

const DOMAIN: array<u32, 18> = array<u32, 18>(
  0x76u, 0x61u, 0x6eu, 0x69u, 0x74u, 0x79u, 0x2du, 0x63u,
  0x68u, 0x69u, 0x61u, 0x2du, 0x67u, 0x70u, 0x75u, 0x2du,
  0x76u, 0x31u,
);

fn bytes_ge32(a: array<u32, 32>, b: array<u32, 32>) -> bool {
  for (var i = 0u; i < 32u; i++) {
    if (a[i] > b[i]) { return true; }
    if (a[i] < b[i]) { return false; }
  }
  return true;
}

fn bytes_sub32(a: array<u32, 32>, b: array<u32, 32>) -> array<u32, 32> {
  var out = a;
  var borrow = 0u;
  for (var i = 32u; i > 0u; i--) {
    let idx = i - 1u;
    let v = i32(out[idx]) - i32(b[idx]) - i32(borrow);
    if (v < 0) {
      out[idx] = u32(v + 256);
      borrow = 1u;
    } else {
      out[idx] = u32(v);
      borrow = 0u;
    }
  }
  return out;
}

fn reduce_scalar_mod_order(scalar: array<u32, 32>) -> array<u32, 32> {
  var out = scalar;
  if (bytes_ge32(out, GROUP_ORDER)) {
    out = bytes_sub32(out, GROUP_ORDER);
  }
  if (bytes_ge32(out, GROUP_ORDER)) {
    out = bytes_sub32(out, GROUP_ORDER);
  }
  return out;
}

fn add_scalars_mod_order(a: array<u32, 32>, b: array<u32, 32>) -> array<u32, 32> {
  var out: array<u32, 32>;
  var carry = 0u;
  for (var i = 32u; i > 0u; i--) {
    let idx = i - 1u;
    let v = a[idx] + b[idx] + carry;
    out[idx] = v & 0xffu;
    carry = v >> 8u;
  }
  if (carry != 0u || bytes_ge32(out, GROUP_ORDER)) {
    out = bytes_sub32(out, GROUP_ORDER);
  }
  return out;
}

fn reduce_signed_scalar_mod_order(scalar: array<u32, 32>) -> array<u32, 32> {
  let negative = (scalar[0] & 0x80u) != 0u;
  var out = reduce_scalar_mod_order(scalar);
  if (negative) {
    out = add_scalars_mod_order(out, NEG_TWO_256_MOD_GROUP_ORDER);
  }
  return out;
}

fn derive_gpu_native_child_sk(index: u32) -> array<u32, 32> {
  var input: array<u32, 80>;
  for (var i = 0u; i < 18u; i++) {
    input[i] = DOMAIN[i];
  }
  for (var i = 0u; i < 32u; i++) {
    let word = intermediate_sk[i / 4u];
    input[18u + i] = (word >> ((i % 4u) * 8u)) & 0xffu;
  }
  input[50] = (index >> 24u) & 0xffu;
  input[51] = (index >> 16u) & 0xffu;
  input[52] = (index >> 8u) & 0xffu;
  input[53] = index & 0xffu;
  var wallet_sk = sha256_bytes(&input, 54u);
  wallet_sk = reduce_scalar_mod_order(wallet_sk);
  var nonzero = 0u;
  for (var i = 0u; i < 32u; i++) {
    nonzero |= wallet_sk[i];
  }
  if (nonzero == 0u) {
    wallet_sk[31] = 1u;
  }
  return wallet_sk;
}
