use std::fs::OpenOptions;
use std::io::Write;
use std::time::Duration;

#[cfg(unix)]
use std::os::unix::fs::{OpenOptionsExt, PermissionsExt};

use clap::Parser;
use vanity_core::{
    cpu_benchmark, cpu_search, SearchConfig, SearchProgress, SearchResult, VanityParams,
};

#[cfg(feature = "gpu")]
use vanity_gpu::{gpu_available, gpu_benchmark, gpu_search, GpuSearchConfig};

#[derive(Parser, Debug)]
#[command(name = "vanity-chia", about = "Chia vanity address generator")]
struct Cli {
    /// Characters after xch1 (base32, lowercase).
    #[arg(long)]
    prefix: Option<String>,

    /// Characters at the end of the full address (base32, lowercase).
    #[arg(long)]
    suffix: Option<String>,

    /// Address human-readable prefix (xch or txch).
    #[arg(long, default_value = "xch")]
    hrp: String,

    /// Number of matching addresses to find.
    #[arg(long, default_value_t = 1)]
    count: usize,

    /// CPU worker threads.
    #[arg(long)]
    threads: Option<usize>,

    /// Indices scanned per batch before progress update.
    #[arg(long, default_value_t = 100_000)]
    batch_size: u32,

    /// Emit JSON results.
    #[arg(long)]
    json: bool,

    /// Suppress progress output.
    #[arg(long)]
    quiet: bool,

    /// Write results to file (0600 permissions).
    #[arg(long)]
    output: Option<String>,

    /// Use CUDA GPU acceleration (requires build with --features gpu).
    #[arg(long)]
    gpu: bool,

    /// GPU batch size (indices per kernel launch).
    #[arg(long, default_value_t = 1_048_576)]
    gpu_batch: u32,

    /// Benchmark keys/sec and exit.
    #[arg(long)]
    benchmark: bool,

    /// Validate GPU vs CPU filter consistency (requires CUDA).
    #[arg(long)]
    validate_gpu: bool,

    /// GPU/CPU validation sample size.
    #[arg(long, default_value_t = 10_000)]
    validate_samples: u32,

    /// Benchmark sample size.
    #[arg(long, default_value_t = 10_000)]
    benchmark_samples: u32,
}

fn main() {
    if let Err(err) = run() {
        eprintln!("error: {err}");
        std::process::exit(1);
    }
}

fn run() -> Result<(), Box<dyn std::error::Error>> {
    let cli = Cli::parse();
    let threads = cli.threads.unwrap_or_else(num_cpus::get);

    if cli.benchmark {
        let params = VanityParams::new(cli.prefix.clone(), cli.suffix.clone(), cli.hrp.clone())
            .unwrap_or_else(|_| {
                VanityParams::new(Some("a".into()), None, cli.hrp.clone()).expect("fallback params")
            });
        return run_benchmark(&cli, threads, &params);
    }

    #[cfg(feature = "gpu")]
    if cli.validate_gpu {
        return run_gpu_validation(&cli);
    }

    #[cfg(not(feature = "gpu"))]
    if cli.validate_gpu {
        return Err("GPU support not compiled; rebuild with --features gpu".into());
    }

    if cli.count == 0 {
        return Err("--count must be at least 1".into());
    }

    let params =
        VanityParams::new(cli.prefix.clone(), cli.suffix.clone(), cli.hrp.clone())?.normalize();
    params.validate()?;

    if !cli.quiet && !cli.json {
        print_search_header(&params);
    }

    let config = SearchConfig {
        params: params.clone(),
        count: cli.count,
        batch_size: cli.batch_size,
        threads,
    };

    let results = if cli.gpu {
        run_gpu_search(&cli, config)?
    } else {
        run_cpu_search(&cli, config)?
    };

    if !cli.quiet && !cli.json {
        eprintln!();
    }

    if cli.json {
        println!("{}", serde_json::to_string_pretty(&results)?);
    } else {
        for result in &results {
            print_result(result);
        }
    }

    if let Some(path) = &cli.output {
        write_output(path, &results)?;
        if !cli.quiet && !cli.json {
            eprintln!("wrote {} result(s) to {path}", results.len());
        }
    }

    Ok(())
}

fn run_benchmark(
    cli: &Cli,
    threads: usize,
    params: &VanityParams,
) -> Result<(), Box<dyn std::error::Error>> {
    println!(
        "Benchmarking CPU ({threads} threads, {} samples)...",
        cli.benchmark_samples
    );
    let cpu_rate = cpu_benchmark(cli.benchmark_samples, threads)?;
    println!("CPU: {:.0} keys/sec", cpu_rate);

    #[cfg(feature = "gpu")]
    if cli.gpu {
        if !gpu_available() {
            return Err("CUDA GPU not available".into());
        }
        println!(
            "Benchmarking GPU (batch {}, {} samples)...",
            cli.gpu_batch, cli.benchmark_samples
        );
        let gpu_rate = gpu_benchmark(cli.benchmark_samples, cli.gpu_batch)?;
        println!("GPU: {:.0} keys/sec", gpu_rate);
        if cpu_rate > 0.0 {
            println!("Speedup: {:.2}x", gpu_rate / cpu_rate);
        }
    }

    let _ = params;
    Ok(())
}

#[cfg(feature = "gpu")]
fn run_gpu_validation(cli: &Cli) -> Result<(), Box<dyn std::error::Error>> {
    use vanity_gpu::validate_gpu_cpu_consistency;

    if !vanity_gpu::gpu_available() {
        return Err("CUDA GPU not available for validation".into());
    }

    println!(
        "Validating GPU vs CPU filter consistency ({} samples)...",
        cli.validate_samples
    );
    validate_gpu_cpu_consistency(cli.validate_samples)?;
    println!("GPU/CPU validation passed.");
    Ok(())
}

fn run_cpu_search(
    cli: &Cli,
    config: SearchConfig,
) -> Result<Vec<SearchResult>, Box<dyn std::error::Error>> {
    cpu_search(&config, |progress| {
        if !cli.quiet && !cli.json {
            print_progress(progress, "CPU");
        }
    })
    .map_err(|e| e.into())
}

#[cfg(feature = "gpu")]
fn run_gpu_search(
    cli: &Cli,
    config: SearchConfig,
) -> Result<Vec<SearchResult>, Box<dyn std::error::Error>> {
    if !gpu_available() {
        return Err(
            "CUDA GPU not available: install CUDA toolkit and rebuild with --features gpu".into(),
        );
    }

    let gpu_config = GpuSearchConfig {
        search: config,
        gpu_batch: cli.gpu_batch,
    };

    gpu_search(&gpu_config, |progress| {
        if !cli.quiet && !cli.json {
            print_progress(progress, "GPU");
        }
    })
    .map_err(|e| e.into())
}

#[cfg(not(feature = "gpu"))]
fn run_gpu_search(
    _cli: &Cli,
    _config: SearchConfig,
) -> Result<Vec<SearchResult>, Box<dyn std::error::Error>> {
    Err("GPU support not compiled; rebuild with --features gpu".into())
}

fn print_search_header(params: &VanityParams) {
    println!("Chia vanity address search");
    println!("  HRP: {}", params.hrp);
    if let Some(prefix) = &params.prefix {
        println!("  Prefix (after {hrp}1): {prefix}", hrp = params.hrp);
    }
    if let Some(suffix) = &params.suffix {
        println!("  Suffix: {suffix}");
        if params.suffix_in_checksum_region() {
            println!("  Note: suffix length <= 6 may fall in bech32m checksum region");
        }
    }
    println!(
        "  Estimated difficulty: ~{:.0} trials (~2^{:.0} bits)",
        params.expected_trials(),
        params.difficulty_bits()
    );
    println!();
}

fn print_progress(progress: SearchProgress, label: &str) {
    let eta = progress
        .eta
        .map(format_duration)
        .unwrap_or_else(|| "?".into());
    eprint!(
        "\r[{label}] checked: {} | {:.0} keys/sec | elapsed: {} | ETA: {}",
        progress.keys_checked,
        progress.keys_per_sec,
        format_duration(progress.elapsed),
        eta
    );
}

fn format_duration(d: Duration) -> String {
    let secs = d.as_secs();
    let h = secs / 3600;
    let m = (secs % 3600) / 60;
    let s = secs % 60;
    if h > 0 {
        format!("{h}h{m:02}m{s:02}s")
    } else if m > 0 {
        format!("{m}m{s:02}s")
    } else {
        format!("{s}s")
    }
}

fn print_result(result: &SearchResult) {
    println!();
    println!("=== MATCH FOUND ===");
    println!("Address:     {}", result.address);
    println!("Puzzle hash: 0x{}", result.puzzle_hash);
    println!("Derivation:  {}", result.derivation);
    println!("Path/index:  {}", result.hd_path);
    println!("Index:       {}", result.index);
    println!("Fingerprint: {}", result.fingerprint);
    println!();
    if let Some(secret_key) = &result.secret_key {
        println!("SECRET KEY (store securely, never share):");
        println!("0x{secret_key}");
        println!();
        println!("Seed mnemonic used for this non-portable GPU-native search:");
        println!("{}", result.mnemonic);
    } else {
        println!("SECRET MNEMONIC (store securely, never share):");
        println!("{}", result.mnemonic);
    }
    println!();
}

fn write_output(path: &str, results: &[SearchResult]) -> Result<(), Box<dyn std::error::Error>> {
    let content = format!("{}\n", serde_json::to_string_pretty(results)?);
    let mut options = OpenOptions::new();
    options.write(true).create(true).truncate(true);
    #[cfg(unix)]
    {
        options.mode(0o600);
    }
    let mut file = options.open(path)?;
    #[cfg(unix)]
    {
        file.set_permissions(std::fs::Permissions::from_mode(0o600))?;
    }
    file.write_all(content.as_bytes())?;
    Ok(())
}
