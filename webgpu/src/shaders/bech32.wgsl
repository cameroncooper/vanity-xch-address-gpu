const BECH32M_CONST: u32 = 0x2bc830a3u;
const MAX_HITS: u32 = 8192u;

fn bech32_polymod_step(values: ptr<function, array<u32, 128>>, len: u32) -> u32 {
  var chk = 1u;
  for (var i = 0u; i < len; i++) {
    let b = chk >> 25u;
    chk = ((chk & 0x1ffffffu) << 5u) ^ (*values)[i];
    if ((b & 1u) != 0u) { chk ^= 0x3b6a57b2u; }
    if ((b & 2u) != 0u) { chk ^= 0x26508e6du; }
    if ((b & 4u) != 0u) { chk ^= 0x1ea119fau; }
    if ((b & 8u) != 0u) { chk ^= 0x3d4233ddu; }
    if ((b & 16u) != 0u) { chk ^= 0x2a1462b3u; }
  }
  return chk;
}

fn convert_bits_8_to_5(data: array<u32, 32>) -> array<u32, 64> {
  var acc = 0u;
  var bits = 0u;
  var out: array<u32, 64>;
  var o = 0u;
  for (var i = 0u; i < 32u; i++) {
    acc = (acc << 8u) | data[i];
    bits += 8u;
    loop {
      if (bits < 5u) { break; }
      bits -= 5u;
      out[o] = (acc >> bits) & 0x1fu;
      o += 1u;
    }
  }
  if (bits > 0u) {
    out[o] = (acc << (5u - bits)) & 0x1fu;
  }
  return out;
}

fn hrp_expand_values(hrp_kind: u32) -> array<u32, 16> {
  var values: array<u32, 16>;
  if (hrp_kind == 0u) {
    values[0] = 3u; values[1] = 3u; values[2] = 3u; values[3] = 0u;
    values[4] = 24u; values[5] = 3u; values[6] = 8u;
  } else {
    values[0] = 3u; values[1] = 3u; values[2] = 3u; values[3] = 3u; values[4] = 0u;
    values[5] = 20u; values[6] = 24u; values[7] = 3u; values[8] = 8u;
  }
  return values;
}

fn hrp_expand_len(hrp_kind: u32) -> u32 {
  if (hrp_kind == 0u) {
    return 7u;
  }
  return 9u;
}

fn bech32_data_values(hrp_kind: u32, puzzle_hash: array<u32, 32>) -> array<u32, 58> {
  let data5 = convert_bits_8_to_5(puzzle_hash);
  let hrp_vals = hrp_expand_values(hrp_kind);
  let hrp_len = hrp_expand_len(hrp_kind);
  var values: array<u32, 128>;
  var vlen = 0u;
  for (var i = 0u; i < hrp_len; i++) {
    values[vlen] = hrp_vals[i];
    vlen += 1u;
  }
  for (var i = 0u; i < 52u; i++) {
    values[vlen] = data5[i];
    vlen += 1u;
  }
  let checksum_start = vlen;
  for (var i = 0u; i < 6u; i++) {
    values[vlen] = 0u;
    vlen += 1u;
  }
  let poly = bech32_polymod_step(&values, vlen) ^ BECH32M_CONST;
  for (var i = 0u; i < 6u; i++) {
    values[checksum_start + i] = (poly >> (5u * (5u - i))) & 31u;
  }
  var out: array<u32, 58>;
  for (var i = 0u; i < 58u; i++) {
    out[i] = values[hrp_len + i];
  }
  return out;
}

fn bech32_values_match(values: array<u32, 58>) -> bool {
  if (params.match_all != 0u) {
    return true;
  }
  for (var i = 0u; i < params.prefix_len; i++) {
    if (values[i] != params.prefix[i]) {
      return false;
    }
  }
  if (params.suffix_len > 58u) {
    return false;
  }
  for (var i = 0u; i < params.suffix_len; i++) {
    if (values[58u - params.suffix_len + i] != params.suffix[i]) {
      return false;
    }
  }
  return true;
}
