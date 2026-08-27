use std::env;
use std::path::{Path, PathBuf};
use std::process::Command;

fn main() {
    println!("cargo::rustc-check-cfg=cfg(cuda)");
    println!("cargo:rerun-if-changed=build.rs");
    println!("cargo:rerun-if-env-changed=VANITY_FIXED_BASE_WINDOW_BITS");
    println!("cargo:rerun-if-changed=cuda/filter.h");
    println!("cargo:rerun-if-changed=cuda/filter_host.cpp");
    println!("cargo:rerun-if-changed=cuda/filter_launch.cu");
    println!("cargo:rerun-if-changed=cuda/filter_kernel.cu");

    if let Some((nvcc, cuda_root)) = detect_cuda() {
        println!("cargo:rustc-cfg=cuda");
        let table_dir = generate_fixed_base_table();
        compile_cuda(&nvcc, cuda_root.as_deref(), &table_dir);
    } else {
        println!("cargo:warning=CUDA not found; building vanity-gpu without GPU kernels");
    }
}

fn generate_fixed_base_table() -> PathBuf {
    use blst::{
        blst_p1, blst_p1_affine, blst_p1_affine_serialize, blst_p1_generator, blst_p1_mult,
        blst_p1_to_affine, blst_scalar, blst_scalar_from_be_bytes,
    };
    use std::fmt::Write;

    let window_bits = env::var("VANITY_FIXED_BASE_WINDOW_BITS")
        .ok()
        .and_then(|value| value.parse::<usize>().ok())
        .unwrap_or(6);
    assert!(
        (2..=6).contains(&window_bits),
        "VANITY_FIXED_BASE_WINDOW_BITS must be in 2..=6"
    );
    let windows = 256usize.div_ceil(window_bits);
    let entries = (1usize << window_bits) - 1;

    let out_dir = PathBuf::from(env::var("OUT_DIR").expect("OUT_DIR is set"));
    let table_path = out_dir.join("fixed_base_table.cuh");
    let mut header = String::new();
    writeln!(header, "#define FIXED_BASE_WINDOW_BITS {window_bits}").unwrap();
    writeln!(header, "#define FIXED_BASE_WINDOWS {windows}").unwrap();
    writeln!(header, "#define FIXED_BASE_ENTRIES {entries}").unwrap();
    let table_bytes = windows * entries * 96;
    let storage = if table_bytes <= 60 * 1024 {
        "__constant__"
    } else {
        ""
    };
    writeln!(
        header,
        "static __device__ {storage} const uint8_t G1_FIXED_BASE[{windows}][{entries}][96] = {{"
    )
    .unwrap();

    for window in 0..windows {
        writeln!(header, "  {{").unwrap();
        for digit in 1..=entries {
            let mut scalar_bytes = [0u8; 32];
            for bit in 0..window_bits {
                if (digit & (1 << bit)) != 0 {
                    let scalar_bit = window * window_bits + bit;
                    if scalar_bit < 256 {
                        let byte = 31 - scalar_bit / 8;
                        scalar_bytes[byte] |= 1 << (scalar_bit % 8);
                    }
                }
            }

            let mut serialized = [0u8; 96];
            unsafe {
                let mut scalar = std::mem::MaybeUninit::<blst_scalar>::uninit();
                blst_scalar_from_be_bytes(
                    scalar.as_mut_ptr(),
                    scalar_bytes.as_ptr(),
                    scalar_bytes.len(),
                );
                let mut point = std::mem::MaybeUninit::<blst_p1>::uninit();
                blst_p1_mult(
                    point.as_mut_ptr(),
                    blst_p1_generator(),
                    scalar.as_ptr().cast::<u8>(),
                    256,
                );
                let point = point.assume_init();
                let mut affine = std::mem::MaybeUninit::<blst_p1_affine>::uninit();
                blst_p1_to_affine(affine.as_mut_ptr(), &point);
                let affine = affine.assume_init();
                blst_p1_affine_serialize(serialized.as_mut_ptr(), &affine);
            }

            write!(header, "    {{").unwrap();
            for (i, byte) in serialized.iter().enumerate() {
                if i != 0 {
                    write!(header, ",").unwrap();
                }
                write!(header, "0x{byte:02x}").unwrap();
            }
            writeln!(header, "}},").unwrap();
        }
        writeln!(header, "  }},").unwrap();
    }
    writeln!(header, "}};").unwrap();

    std::fs::write(&table_path, header).expect("write fixed-base table");
    out_dir
}

fn detect_cuda() -> Option<(String, Option<PathBuf>)> {
    if env::var("VANITY_FORCE_NO_CUDA").is_ok() {
        return None;
    }

    let mut candidates: Vec<String> = Vec::new();
    if let Ok(cuda_path) = env::var("CUDA_PATH") {
        candidates.push(format!("{cuda_path}/bin/nvcc"));
    }
    candidates.push("/usr/local/cuda/bin/nvcc".into());
    candidates.push("/opt/cuda/bin/nvcc".into());

    for path in candidates {
        if Command::new(&path).arg("--version").output().is_ok() {
            let cuda_root = PathBuf::from(&path)
                .parent()
                .and_then(|p| p.parent())
                .map(|p| p.to_path_buf());
            return Some((path, cuda_root));
        }
    }

    if Command::new("nvcc").arg("--version").output().is_ok() {
        return Some(("nvcc".into(), None));
    }

    None
}

fn compile_cuda(nvcc: &str, cuda_root: Option<&Path>, table_dir: &Path) {
    env::set_var("CRATE_CC_NO_DEFAULTS", "1");
    let sppark_root = find_sppark_root();
    let blst_include = find_blst_include();

    let mut kernel = cc::Build::new();
    kernel.cuda(true);
    kernel.warnings(false);
    kernel.flag("-O3");
    kernel.flag("-Xcompiler=-fPIC");
    kernel.flag("-arch=native");
    kernel.flag("-U_GNU_SOURCE");
    kernel.flag("-D_DEFAULT_SOURCE");
    kernel.flag(format!("-I{}", table_dir.display()));
    kernel.file("cuda/filter_kernel.cu");
    kernel.compiler(nvcc);
    if let Some(root) = cuda_root {
        kernel.flag(format!("-I{}/include", root.display()));
    }
    if let Some(root) = &sppark_root {
        kernel.flag(format!("-I{}", root.display()));
        kernel.flag(format!("-I{}", root.join("sppark").display()));
    }
    if let Some(root) = &blst_include {
        kernel.flag(format!("-I{}", root.display()));
    }
    kernel.compile("vanity_cuda_kernel");

    let mut launch = cc::Build::new();
    launch.cuda(true);
    launch.warnings(false);
    launch.flag("-O3");
    launch.flag("-Xcompiler=-fPIC");
    launch.flag("-arch=native");
    launch.flag("-U_GNU_SOURCE");
    launch.flag("-D_DEFAULT_SOURCE");
    launch.flag(format!("-I{}", table_dir.display()));
    launch.file("cuda/filter_launch.cu");
    launch.compiler(nvcc);
    if let Some(root) = cuda_root {
        launch.flag(format!("-I{}/include", root.display()));
    }
    if let Some(root) = &sppark_root {
        launch.flag(format!("-I{}", root.display()));
        launch.flag(format!("-I{}", root.join("sppark").display()));
    }
    if let Some(root) = &blst_include {
        launch.flag(format!("-I{}", root.display()));
    }
    launch.compile("vanity_cuda_launch");

    let mut host = cc::Build::new();
    host.cpp(true);
    host.warnings(false);
    host.flag("-O3");
    host.file("cuda/filter_host.cpp");
    host.include("cuda");
    if let Some(root) = cuda_root {
        host.include(format!("{}/include", root.display()));
        println!("cargo:rustc-link-search=native={}/lib64", root.display());
    }
    host.compile("vanity_cuda_host");

    println!("cargo:rustc-link-lib=cudart");
}

fn find_sppark_root() -> Option<PathBuf> {
    if let Ok(root) = env::var("DEP_SPPARK_ROOT") {
        return Some(PathBuf::from(root));
    }

    let cargo_home = env::var("CARGO_HOME")
        .map(PathBuf::from)
        .or_else(|_| env::var("HOME").map(|home| PathBuf::from(home).join(".cargo")))
        .ok()?;
    let registry_src = cargo_home.join("registry/src");
    let registries = std::fs::read_dir(registry_src).ok()?;
    for registry in registries.flatten() {
        let path = registry.path().join("sppark-0.1.15");
        if path.join("sppark/ff/bls12-381.hpp").exists() {
            return Some(path);
        }
    }
    None
}

fn find_blst_include() -> Option<PathBuf> {
    let cargo_home = env::var("CARGO_HOME")
        .map(PathBuf::from)
        .or_else(|_| env::var("HOME").map(|home| PathBuf::from(home).join(".cargo")))
        .ok()?;
    let registry_src = cargo_home.join("registry/src");
    let registries = std::fs::read_dir(registry_src).ok()?;
    for registry in registries.flatten() {
        let path = registry.path().join("blst-0.3.16/blst/src");
        if path.join("blst_t.hpp").exists() {
            return Some(path);
        }
    }
    None
}
