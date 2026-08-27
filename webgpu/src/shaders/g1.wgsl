const FIXED_BASE_WINDOW_BITS: u32 = 6u;
const FIXED_BASE_WINDOWS: u32 = 43u;
const FIXED_BASE_ENTRIES: u32 = 63u;

fn load_fp_from_table(word_off: u32) -> Fp {
  return Fp(
    vec4<u32>(g1_table[word_off], g1_table[word_off + 1u], g1_table[word_off + 2u], g1_table[word_off + 3u]),
    vec4<u32>(g1_table[word_off + 4u], g1_table[word_off + 5u], g1_table[word_off + 6u], g1_table[word_off + 7u]),
    vec4<u32>(g1_table[word_off + 8u], g1_table[word_off + 9u], g1_table[word_off + 10u], g1_table[word_off + 11u]),
  );
}

fn affine_from_table(window: u32, digit: u32) -> Affine {
  let idx = window * FIXED_BASE_ENTRIES + (digit - 1u);
  let word_off = idx * 24u;
  var p: Affine;
  p.x = load_fp_from_table(word_off);
  p.y = load_fp_from_table(word_off + 12u);
  p.inf = select(0u, 1u, fp_is_zero(p.x) && fp_is_zero(p.y));
  return p;
}

fn projective_inf() -> Projective {
  var p: Projective;
  p.x = fp_zero();
  p.y = fp_one();
  p.z = fp_zero();
  p.inf = 1u;
  return p;
}

fn projective_double(p_in: Projective) -> Projective {
  if (p_in.inf != 0u || fp_is_zero(p_in.y)) {
    return projective_inf();
  }
  let A = fp_sqr(p_in.x);
  let B = fp_sqr(p_in.y);
  let C = fp_sqr(B);
  let x1_plus_b = fp_add(p_in.x, B);
  var D = fp_sub(fp_sub(fp_sqr(x1_plus_b), A), C);
  D = fp_dbl(D);
  let E = fp_add(fp_dbl(A), A);
  let F = fp_sqr(E);
  let X3 = fp_sub(fp_sub(F, D), D);
  var eightC = fp_dbl(C);
  eightC = fp_dbl(eightC);
  eightC = fp_dbl(eightC);
  let Y3 = fp_sub(fp_mul(E, fp_sub(D, X3)), eightC);
  var Z3 = fp_mul(p_in.y, p_in.z);
  Z3 = fp_dbl(Z3);
  var out: Projective;
  out.x = X3;
  out.y = Y3;
  out.z = Z3;
  out.inf = 0u;
  return out;
}

fn projective_add_affine(p_in: Projective, q: Affine) -> Projective {
  if (q.inf != 0u) {
    return p_in;
  }
  if (p_in.inf != 0u) {
    var out: Projective;
    out.x = q.x;
    out.y = q.y;
    out.z = fp_one();
    out.inf = 0u;
    return out;
  }
  let Z1Z1 = fp_sqr(p_in.z);
  let U2 = fp_mul(q.x, Z1Z1);
  let S2 = fp_mul(fp_mul(q.y, p_in.z), Z1Z1);
  let H = fp_sub(U2, p_in.x);
  let R = fp_sub(S2, p_in.y);
  if (fp_is_zero(H)) {
    if (fp_is_zero(R)) {
      return projective_double(p_in);
    }
    return projective_inf();
  }
  let HH = fp_sqr(H);
  let HHH = fp_mul(H, HH);
  let V = fp_mul(p_in.x, HH);
  let X3 = fp_sub(fp_sub(fp_sub(fp_sqr(R), HHH), V), V);
  let Y3 = fp_sub(fp_mul(R, fp_sub(V, X3)), fp_mul(p_in.y, HHH));
  let Z3 = fp_mul(p_in.z, H);
  var out: Projective;
  out.x = X3;
  out.y = Y3;
  out.z = Z3;
  out.inf = 0u;
  return out;
}

fn projective_to_affine(p: Projective) -> Affine {
  var out: Affine;
  if (p.inf != 0u) {
    out.x = fp_zero();
    out.y = fp_zero();
    out.inf = 1u;
    return out;
  }
  let z_inv = fp_inverse(p.z);
  let z2 = fp_sqr(z_inv);
  let z3 = fp_mul(z2, z_inv);
  out.x = fp_mul(p.x, z2);
  out.y = fp_mul(p.y, z3);
  out.inf = 0u;
  return out;
}

fn scalar_bit_lsb(scalar: array<u32, 32>, bit: u32) -> u32 {
  let byte_idx = 31u - bit / 8u;
  let bit_idx = bit % 8u;
  return (scalar[byte_idx] >> bit_idx) & 1u;
}

fn fixed_base_mul_generator(scalar: array<u32, 32>) -> Projective {
  var acc = projective_inf();
  for (var window = 0u; window < FIXED_BASE_WINDOWS; window++) {
    var digit = 0u;
    for (var bit = 0u; bit < FIXED_BASE_WINDOW_BITS; bit++) {
      let scalar_bit_index = window * FIXED_BASE_WINDOW_BITS + bit;
      if (scalar_bit_index < 256u) {
        digit |= scalar_bit_lsb(scalar, scalar_bit_index) << bit;
      }
    }
    if (digit != 0u) {
      acc = projective_add_affine(acc, affine_from_table(window, digit));
    }
  }
  return acc;
}

fn compress_g1(p: Affine) -> array<u32, 48> {
  var out = fp_to_be48_bytes(p.x);
  out[0] |= 0x80u;
  if (p.inf != 0u) {
    out[0] |= 0x40u;
  } else if (fp_is_lexicographically_largest(p.y)) {
    out[0] |= 0x20u;
  }
  return out;
}
