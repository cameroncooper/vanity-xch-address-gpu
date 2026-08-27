fn pack4(b0: u32, b1: u32, b2: u32, b3: u32) -> u32 {
  return b0 | (b1 << 8u) | (b2 << 16u) | (b3 << 24u);
}

fn write_hash(slot: u32, index: u32, puzzle_hash: array<u32, 32>) {
  let base = slot * 9u;
  hashes[base] = index;
  hashes[base + 1u] = pack4(puzzle_hash[0], puzzle_hash[1], puzzle_hash[2], puzzle_hash[3]);
  hashes[base + 2u] = pack4(puzzle_hash[4], puzzle_hash[5], puzzle_hash[6], puzzle_hash[7]);
  hashes[base + 3u] = pack4(puzzle_hash[8], puzzle_hash[9], puzzle_hash[10], puzzle_hash[11]);
  hashes[base + 4u] = pack4(puzzle_hash[12], puzzle_hash[13], puzzle_hash[14], puzzle_hash[15]);
  hashes[base + 5u] = pack4(puzzle_hash[16], puzzle_hash[17], puzzle_hash[18], puzzle_hash[19]);
  hashes[base + 6u] = pack4(puzzle_hash[20], puzzle_hash[21], puzzle_hash[22], puzzle_hash[23]);
  hashes[base + 7u] = pack4(puzzle_hash[24], puzzle_hash[25], puzzle_hash[26], puzzle_hash[27]);
  hashes[base + 8u] = pack4(puzzle_hash[28], puzzle_hash[29], puzzle_hash[30], puzzle_hash[31]);
}

fn convert_bits_8_to_5_prefix(data: array<u32, 32>, prefix_len: u32) -> bool {
  var acc = 0u;
  var bits = 0u;
  var produced = 0u;
  for (var i = 0u; i < 32u; i++) {
    acc = (acc << 8u) | data[i];
    bits += 8u;
    loop {
      if (bits < 5u) {
        break;
      }
      bits -= 5u;
      if (produced < prefix_len && ((acc >> bits) & 0x1fu) != params.prefix[produced]) {
        return false;
      }
      produced += 1u;
      if (produced >= prefix_len) {
        return true;
      }
    }
  }
  return produced >= prefix_len;
}

fn prefix_compact() -> bool {
  return params.match_all == 0u && params.prefix_len > 0u && params.suffix_len == 0u;
}

override workgroup_size_x: u32 = 256;

@compute @workgroup_size(workgroup_size_x)
fn dummy_kernel(@builtin(global_invocation_id) gid: vec3<u32>) {
  let i = gid.x;
  if (i >= params.count) {
    return;
  }
  let _keep_bindings = intermediate_sk[0] + g1_table[0] + atomicAdd(&hit_counter, 0u);
  var puzzle_hash: array<u32, 32>;
  for (var b = 0u; b < 32u; b++) {
    puzzle_hash[b] = 0u;
  }
  puzzle_hash[31] = ((params.start_index + i) & 0xffu) ^ (_keep_bindings & 0u);
  write_hash(i, params.start_index + i, puzzle_hash);
}

@compute @workgroup_size(workgroup_size_x)
fn hash_kernel(@builtin(global_invocation_id) gid: vec3<u32>) {
  let i = gid.x;
  if (i >= params.count) {
    return;
  }
  let index = params.start_index + i;
  let wallet_sk = derive_gpu_native_child_sk(index);
  let wallet_proj = fixed_base_mul_generator(wallet_sk);
  let wallet_aff = projective_to_affine(wallet_proj);
  let wallet_pk = compress_g1(wallet_aff);
  let synthetic_pk = synthetic_pk_from_wallet(wallet_pk, wallet_sk);
  let puzzle_hash = standard_puzzle_hash_from_synthetic_pk(synthetic_pk);
  let compact = prefix_compact();
  if (compact && !convert_bits_8_to_5_prefix(puzzle_hash, params.prefix_len)) {
    return;
  }
  var slot = i;
  if (compact) {
    slot = atomicAdd(&hit_counter, 1u);
  }
  write_hash(slot, index, puzzle_hash);
}
