struct Fp {
  a: vec4<u32>,
  b: vec4<u32>,
  c: vec4<u32>,
}

struct Affine {
  x: Fp,
  y: Fp,
  inf: u32,
}

struct Projective {
  x: Fp,
  y: Fp,
  z: Fp,
  inf: u32,
}

struct Params {
  start_index: u32,
  count: u32,
  hrp_kind: u32,
  prefix_len: u32,
  suffix_len: u32,
  match_all: u32,
  pad0: u32,
  pad1: u32,
  prefix: array<u32, 64>,
  suffix: array<u32, 64>,
}

@group(0) @binding(0) var<storage, read> params: Params;
@group(0) @binding(1) var<storage, read> intermediate_sk: array<u32>;
@group(0) @binding(2) var<storage, read> g1_table: array<u32>;
@group(0) @binding(3) var<storage, read_write> hit_counter: atomic<u32>;
@group(0) @binding(4) var<storage, read_write> hashes: array<u32>;
