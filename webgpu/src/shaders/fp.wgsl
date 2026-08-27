const N0: u32 = 0xfffcfffdu;

const P_LIMBS: array<u32, 12> = array<u32, 12>(
  0xffffaaabu, 0xb9feffffu, 0xb153ffffu, 0x1eabfffeu,
  0xf6b0f624u, 0x6730d2a0u, 0xf38512bfu, 0x64774b84u,
  0x434bacd7u, 0x4b1ba7b6u, 0x397fe69au, 0x1a0111eau,
);

const R_LIMBS: array<u32, 12> = array<u32, 12>(
  0x0002fffdu, 0x76090000u, 0xc40c0002u, 0xebf4000bu,
  0x53c758bau, 0x5f489857u, 0x70525745u, 0x77ce5853u,
  0xa256ec6du, 0x5c071a97u, 0xfa80e493u, 0x15f65ec3u,
);

const R2_LIMBS: array<u32, 12> = array<u32, 12>(
  0x1c341746u, 0xf4df1f34u, 0x09d104f1u, 0x0a76e6a6u,
  0x4c95b6d5u, 0x8de5476cu, 0x939d83c0u, 0x67eb88a9u,
  0xb519952du, 0x9a793e85u, 0x92cae3aau, 0x11988fe5u,
);

const P_MINUS_2: array<u32, 12> = array<u32, 12>(
  0xffffaaa9u, 0xb9feffffu, 0xb153ffffu, 0x1eabfffeu,
  0xf6b0f624u, 0x6730d2a0u, 0xf38512bfu, 0x64774b84u,
  0x434bacd7u, 0x4b1ba7b6u, 0x397fe69au, 0x1a0111eau,
);

const HALF_P_BE: array<u32, 48> = array<u32, 48>(
  0x0du, 0x00u, 0x88u, 0xf5u, 0x1cu, 0xbfu, 0xf3u, 0x4du,
  0x25u, 0x8du, 0xd3u, 0xdbu, 0x21u, 0xa5u, 0xd6u, 0x6bu,
  0xb2u, 0x3bu, 0xa5u, 0xc2u, 0x79u, 0xc2u, 0x89u, 0x5fu,
  0xb3u, 0x98u, 0x69u, 0x50u, 0x7bu, 0x58u, 0x7bu, 0x12u,
  0x0fu, 0x55u, 0xffu, 0xf5u, 0x8au, 0x9fu, 0xffu, 0xfdu,
  0xcfu, 0xf7u, 0xffu, 0xffu, 0xffu, 0xfdu, 0x55u, 0x55u,
);

fn fp_from_arr(v: array<u32, 12>) -> Fp {
  return Fp(
    vec4<u32>(v[0], v[1], v[2], v[3]),
    vec4<u32>(v[4], v[5], v[6], v[7]),
    vec4<u32>(v[8], v[9], v[10], v[11]),
  );
}

fn fp_to_arr(p: Fp) -> array<u32, 12> {
  var v: array<u32, 12>;
  v[0] = p.a.x; v[1] = p.a.y; v[2] = p.a.z; v[3] = p.a.w;
  v[4] = p.b.x; v[5] = p.b.y; v[6] = p.b.z; v[7] = p.b.w;
  v[8] = p.c.x; v[9] = p.c.y; v[10] = p.c.z; v[11] = p.c.w;
  return v;
}

fn fp_zero() -> Fp {
  return Fp(vec4<u32>(0u), vec4<u32>(0u), vec4<u32>(0u));
}

fn fp_one() -> Fp {
  return fp_from_arr(R_LIMBS);
}

fn fp_is_zero(p: Fp) -> bool {
  return ((p.a.x | p.a.y | p.a.z | p.a.w) |
          (p.b.x | p.b.y | p.b.z | p.b.w) |
          (p.c.x | p.c.y | p.c.z | p.c.w)) == 0u;
}

fn mul_wide(a: u32, b: u32) -> vec2<u32> {
  let a0 = a & 0xffffu;
  let a1 = a >> 16u;
  let b0 = b & 0xffffu;
  let b1 = b >> 16u;
  let p0 = a0 * b0;
  let p1 = a0 * b1;
  let p2 = a1 * b0;
  let p3 = a1 * b1;
  let cy = (p0 >> 16u) + (p1 & 0xffffu) + (p2 & 0xffffu);
  let lo = (p0 & 0xffffu) | ((cy & 0xffffu) << 16u);
  let hi = p3 + (p1 >> 16u) + (p2 >> 16u) + (cy >> 16u);
  return vec2<u32>(lo, hi);
}

fn addc(a: u32, b: u32, cin: u32) -> vec2<u32> {
  let s = a + b;
  var carry = u32(s < a);
  let s2 = s + cin;
  carry += u32(s2 < s);
  return vec2<u32>(s2, carry);
}

fn mac(t: u32, a: u32, b: u32, c: u32) -> vec2<u32> {
  let p = mul_wide(a, b);
  let r = addc(t, p.x, c);
  return vec2<u32>(r.x, p.y + r.y);
}

fn sub_borrow(a: u32, b: u32, bin: u32) -> vec2<u32> {
  let tmp = a - bin;
  let br1 = u32(a < bin);
  let diff = tmp - b;
  let br2 = u32(tmp < b);
  return vec2<u32>(diff, br1 | br2);
}

fn ge_p(a: array<u32, 12>) -> bool {
  for (var i = 12u; i > 0u; i--) {
    let ai = a[i - 1u];
    let pi = P_LIMBS[i - 1u];
    if (ai > pi) {
      return true;
    }
    if (ai < pi) {
      return false;
    }
  }
  return true;
}

fn sub_p(a: array<u32, 12>) -> array<u32, 12> {
  var r: array<u32, 12>;
  var borrow = 0u;
  for (var i = 0u; i < 12u; i++) {
    let sb = sub_borrow(a[i], P_LIMBS[i], borrow);
    r[i] = sb.x;
    borrow = sb.y;
  }
  return r;
}

fn fp_reduce(t: array<u32, 12>, extra: u32) -> array<u32, 12> {
  var v = t;
  var e = extra;
  for (var k = 0u; k < 4u; k++) {
    if (e == 0u && !ge_p(v)) {
      break;
    }
    var borrow = 0u;
    var r: array<u32, 12>;
    for (var i = 0u; i < 12u; i++) {
      let sb = sub_borrow(v[i], P_LIMBS[i], borrow);
      r[i] = sb.x;
      borrow = sb.y;
    }
    v = r;
    e -= borrow;
  }
  return v;
}

fn mont_mul_arr(a: array<u32, 12>, b: array<u32, 12>) -> array<u32, 12> {
  var t: array<u32, 12>;
  for (var i = 0u; i < 12u; i++) {
    t[i] = 0u;
  }
  var tN = 0u;
  for (var i = 0u; i < 12u; i++) {
    var C = 0u;
    for (var j = 0u; j < 12u; j++) {
      let r = mac(t[j], a[i], b[j], C);
      t[j] = r.x;
      C = r.y;
    }
    let s = addc(tN, C, 0u);
    tN = s.x;
    var extra = s.y;
    let m = t[0] * N0;
    C = 0u;
    for (var j = 0u; j < 12u; j++) {
      let r = mac(t[j], m, P_LIMBS[j], C);
      t[j] = r.x;
      C = r.y;
    }
    let s2 = addc(tN, C, 0u);
    tN = s2.x;
    extra += s2.y;
    for (var j = 0u; j < 11u; j++) {
      t[j] = t[j + 1u];
    }
    t[11] = tN;
    tN = extra;
  }
  return fp_reduce(t, tN);
}

fn fp_mul(a: Fp, b: Fp) -> Fp {
  return fp_from_arr(mont_mul_arr(fp_to_arr(a), fp_to_arr(b)));
}

fn fp_sqr(a: Fp) -> Fp {
  return fp_mul(a, a);
}

fn fp_add(a: Fp, b: Fp) -> Fp {
  var r: array<u32, 12>;
  var carry = 0u;
  let aa = fp_to_arr(a);
  let bb = fp_to_arr(b);
  for (var i = 0u; i < 12u; i++) {
    let s = addc(aa[i], bb[i], carry);
    r[i] = s.x;
    carry = s.y;
  }
  return fp_from_arr(fp_reduce(r, carry));
}

fn fp_dbl(a: Fp) -> Fp {
  return fp_add(a, a);
}

fn fp_sub(a: Fp, b: Fp) -> Fp {
  var r: array<u32, 12>;
  var borrow = 0u;
  let aa = fp_to_arr(a);
  let bb = fp_to_arr(b);
  for (var i = 0u; i < 12u; i++) {
    let sb = sub_borrow(aa[i], bb[i], borrow);
    r[i] = sb.x;
    borrow = sb.y;
  }
  if (borrow != 0u) {
    var carry = 0u;
    for (var i = 0u; i < 12u; i++) {
      let s = addc(r[i], P_LIMBS[i], carry);
      r[i] = s.x;
      carry = s.y;
    }
  }
  return fp_from_arr(r);
}

fn fp_to_mont(a: Fp) -> Fp {
  return fp_from_arr(mont_mul_arr(fp_to_arr(a), R2_LIMBS));
}

fn fp_from_mont(a: Fp) -> Fp {
  var one: array<u32, 12>;
  one[0] = 1u;
  for (var i = 1u; i < 12u; i++) {
    one[i] = 0u;
  }
  return fp_from_arr(mont_mul_arr(fp_to_arr(a), one));
}

fn fp_from_be48_bytes(be: array<u32, 48>) -> Fp {
  var limbs: array<u32, 12>;
  for (var i = 0u; i < 12u; i++) {
    let j = 48u - 4u * (i + 1u);
    limbs[i] = (be[j] << 24u) | (be[j + 1u] << 16u) | (be[j + 2u] << 8u) | be[j + 3u];
  }
  return fp_to_mont(fp_from_arr(limbs));
}

fn fp_to_be48_bytes(p: Fp) -> array<u32, 48> {
  let n = fp_to_arr(fp_from_mont(p));
  var be: array<u32, 48>;
  for (var i = 0u; i < 12u; i++) {
    let w = n[i];
    let j = 48u - 4u * (i + 1u);
    be[j] = (w >> 24u) & 0xffu;
    be[j + 1u] = (w >> 16u) & 0xffu;
    be[j + 2u] = (w >> 8u) & 0xffu;
    be[j + 3u] = w & 0xffu;
  }
  return be;
}

fn fp_pow(base: Fp, exp: array<u32, 12>) -> Fp {
  var acc = fp_one();
  var bit = 0u;
  loop {
    if (bit >= params.pad0) {
      break;
    }
    acc = fp_sqr(acc);
    let limb = 11u - bit / 32u;
    let b = 31u - (bit % 32u);
    if (((exp[limb] >> b) & 1u) != 0u) {
      acc = fp_mul(acc, base);
    }
    bit += 1u;
  }
  return acc;
}

fn fp_inverse(value: Fp) -> Fp {
  return fp_pow(value, P_MINUS_2);
}

fn fp_is_lexicographically_largest(y: Fp) -> bool {
  let yb = fp_to_be48_bytes(y);
  for (var i = 0u; i < 48u; i++) {
    if (yb[i] > HALF_P_BE[i]) {
      return true;
    }
    if (yb[i] < HALF_P_BE[i]) {
      return false;
    }
  }
  return true;
}
