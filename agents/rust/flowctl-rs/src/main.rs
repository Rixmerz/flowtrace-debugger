//! flowctl-rs - CLI tool for FlowTrace Rust agent
//!
//! Analyze and instrument Rust code for tracing

use clap::{Parser, Subcommand};
use colored::*;
use std::path::PathBuf;

mod analyzer;
mod instrumenter;

use analyzer::Analyzer;
use instrumenter::Instrumenter;

#[derive(Parser)]
#[command(name = "flowctl-rs")]
#[command(about = "FlowTrace CLI tool for Rust - Analyze and instrument Rust code", long_about = None)]
struct Cli {
    #[command(subcommand)]
    command: Commands,
}

#[derive(Subcommand)]
enum Commands {
    /// Analyze Rust project for instrumentable functions
    Analyze {
        /// Path to Rust file or directory
        path: PathBuf,

        /// Show detailed statistics
        #[arg(short, long)]
        verbose: bool,
    },

    /// Instrument Rust code with #[trace] attributes
    Instrument {
        /// Path to Rust file
        path: PathBuf,

        /// Dry run - show what would be instrumented without modifying files
        #[arg(short = 'n', long)]
        dry_run: bool,

        /// Create backup before modifying
        #[arg(short, long, default_value_t = true)]
        backup: bool,
    },

    /// Validate FlowTrace setup
    Validate,

    /// Show version information
    Version,
}

fn main() {
    let cli = Cli::parse();

    match cli.command {
        Commands::Analyze { path, verbose } => {
            analyze_command(path, verbose);
        }
        Commands::Instrument {
            path,
            dry_run,
            backup,
        } => {
            instrument_command(path, dry_run, backup);
        }
        Commands::Validate => {
            validate_command();
        }
        Commands::Version => {
            version_command();
        }
    }
}

fn analyze_command(path: PathBuf, verbose: bool) {
    println!("{}", "🔍 Analyzing Rust project...".cyan().bold());
    println!();

    let analyzer = Analyzer::new();

    match analyzer.analyze_path(&path) {
        Ok(stats) => {
            println!("{}", "📊 Analysis Results:".green().bold());
            println!();
            println!("  {} files analyzed", stats.total_files.to_string().yellow());
            println!("  {} total functions found", stats.total_functions.to_string().yellow());
            println!(
                "  {} instrumentable functions",
                stats.instrumentable_functions.to_string().green()
            );
            println!(
                "  {} already instrumented",
                stats.instrumented_functions.to_string().blue()
            );
            println!("  {} lines of code", stats.total_lines.to_string().yellow());

            if verbose {
                println!();
                println!("{}", "📝 Detailed Statistics:".cyan().bold());
                println!("  Async functions: {}", stats.async_functions);
                println!("  Sync functions: {}", stats.sync_functions);
                println!("  Public functions: {}", stats.public_functions);
                println!("  Private functions: {}", stats.private_functions);
            }

            if stats.instrumentable_functions > 0 {
                println!();
                println!(
                    "{}",
                    "💡 Tip: Run 'flowctl-rs instrument <file>' to add tracing"
                        .green()
                );
            }
        }
        Err(e) => {
            eprintln!("{} {}", "❌ Error:".red().bold(), e);
            std::process::exit(1);
        }
    }
}

fn instrument_command(path: PathBuf, dry_run: bool, backup: bool) {
    if dry_run {
        println!(
            "{}",
            "🔍 Dry run - no files will be modified".yellow().bold()
        );
        println!();
    } else {
        println!("{}", "🔧 Instrumenting Rust code...".cyan().bold());
        println!();
    }

    let instrumenter = Instrumenter::new(backup);

    match instrumenter.instrument_file(&path, dry_run) {
        Ok(result) => {
            if dry_run {
                println!("{}", "📝 Functions that would be instrumented:".green().bold());
                println!();
                for func in result.functions {
                    println!("  • {} {}", "fn".blue(), func.yellow());
                }
                println!();
                println!("  Total: {} functions", result.count.to_string().green());
            } else {
                println!("{}", "✅ Instrumentation complete!".green().bold());
                println!();
                println!(
                    "  {} functions instrumented",
                    result.count.to_string().green()
                );

                if backup {
                    println!(
                        "  Backup created: {}",
                        result.backup_path.unwrap_or_default()
                    );
                }

                println!();
                println!("{}",  "💡 Next steps:".cyan());
                println!("  1. Add flowtrace-agent and flowtrace-derive to Cargo.toml");
                println!("  2. Run your application");
                println!("  3. Check flowtrace.jsonl for traces");
            }
        }
        Err(e) => {
            eprintln!("{} {}", "❌ Error:".red().bold(), e);
            std::process::exit(1);
        }
    }
}

fn validate_command() {
    println!("{}", "🔍 Validating FlowTrace setup...".cyan().bold());
    println!();

    let mut all_ok = true;

    // Check Cargo.toml
    if std::path::Path::new("Cargo.toml").exists() {
        println!("{} Cargo.toml found", "✅".green());

        // Try to read and parse Cargo.toml
        if let Ok(content) = std::fs::read_to_string("Cargo.toml") {
            if content.contains("flowtrace-agent") {
                println!("{} flowtrace-agent dependency found", "✅".green());
            } else {
                println!("{} flowtrace-agent dependency missing", "⚠️".yellow());
                println!("   Add: flowtrace-agent = \"1.0\"");
                all_ok = false;
            }

            if content.contains("flowtrace-derive") {
                println!("{} flowtrace-derive dependency found", "✅".green());
            } else {
                println!("{} flowtrace-derive dependency missing", "⚠️".yellow());
                println!("   Add: flowtrace-derive = \"1.0\"");
                all_ok = false;
            }
        }
    } else {
        println!("{} Cargo.toml not found", "❌".red());
        all_ok = false;
    }

    // Check src directory
    if std::path::Path::new("src").exists() {
        println!("{} src/ directory found", "✅".green());
    } else {
        println!("{} src/ directory not found", "❌".red());
        all_ok = false;
    }

    println!();
    if all_ok {
        println!("{}", "✅ FlowTrace setup looks good!".green().bold());
    } else {
        println!(
            "{}",
            "⚠️ FlowTrace setup needs attention".yellow().bold()
        );
        std::process::exit(1);
    }
}

fn version_command() {
    println!("{} {}", "flowctl-rs".cyan().bold(), env!("CARGO_PKG_VERSION"));
    println!("FlowTrace CLI tool for Rust");
    println!();
    println!("Features:");
    println!("  • Analyze Rust projects");
    println!("  • Instrument code with #[trace]");
    println!("  • Validate FlowTrace setup");
}
