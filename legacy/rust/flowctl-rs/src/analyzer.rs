//! Code analyzer for finding instrumentable functions

use std::fs;
use std::path::{Path, PathBuf};
use syn::{visit::Visit, File, Item, ItemFn};
use walkdir::WalkDir;

#[derive(Debug, Clone, Default)]
pub struct AnalysisStats {
    pub total_files: usize,
    pub total_functions: usize,
    pub instrumentable_functions: usize,
    pub instrumented_functions: usize,
    pub total_lines: usize,
    pub async_functions: usize,
    pub sync_functions: usize,
    pub public_functions: usize,
    pub private_functions: usize,
}

pub struct Analyzer;

impl Analyzer {
    pub fn new() -> Self {
        Self
    }

    pub fn analyze_path(&self, path: &Path) -> Result<AnalysisStats, String> {
        let mut stats = AnalysisStats::default();

        if path.is_file() {
            self.analyze_file(path, &mut stats)?;
        } else if path.is_dir() {
            self.analyze_directory(path, &mut stats)?;
        } else {
            return Err(format!("Path not found: {}", path.display()));
        }

        Ok(stats)
    }

    fn analyze_directory(&self, dir: &Path, stats: &mut AnalysisStats) -> Result<(), String> {
        for entry in WalkDir::new(dir)
            .into_iter()
            .filter_map(|e| e.ok())
            .filter(|e| e.path().extension().map_or(false, |ext| ext == "rs"))
        {
            self.analyze_file(entry.path(), stats)?;
        }

        Ok(())
    }

    fn analyze_file(&self, file: &Path, stats: &mut AnalysisStats) -> Result<(), String> {
        let content = fs::read_to_string(file)
            .map_err(|e| format!("Failed to read file {}: {}", file.display(), e))?;

        // Count lines
        stats.total_lines += content.lines().count();
        stats.total_files += 1;

        // Parse file
        let syntax = syn::parse_file(&content)
            .map_err(|e| format!("Failed to parse file {}: {}", file.display(), e))?;

        // Visit and analyze functions
        let mut visitor = FunctionVisitor {
            stats: stats.clone(),
        };
        visitor.visit_file(&syntax);
        *stats = visitor.stats;

        Ok(())
    }
}

struct FunctionVisitor {
    stats: AnalysisStats,
}

impl<'ast> Visit<'ast> for FunctionVisitor {
    fn visit_item_fn(&mut self, node: &'ast ItemFn) {
        self.stats.total_functions += 1;

        // Check if async
        if node.sig.asyncness.is_some() {
            self.stats.async_functions += 1;
        } else {
            self.stats.sync_functions += 1;
        }

        // Check visibility
        match &node.vis {
            syn::Visibility::Public(_) => self.stats.public_functions += 1,
            _ => self.stats.private_functions += 1,
        }

        // Check if already instrumented
        let has_trace_attr = node
            .attrs
            .iter()
            .any(|attr| attr.path().is_ident("trace"));

        if has_trace_attr {
            self.stats.instrumented_functions += 1;
        } else {
            // Check if instrumentable (has body, not in test module)
            let is_test = node
                .attrs
                .iter()
                .any(|attr| attr.path().is_ident("test") || attr.path().is_ident("cfg"));

            if node.block.stmts.len() > 0 && !is_test {
                self.stats.instrumentable_functions += 1;
            }
        }

        syn::visit::visit_item_fn(self, node);
    }

    fn visit_item(&mut self, node: &'ast Item) {
        // Also visit nested items (impl blocks, etc.)
        syn::visit::visit_item(self, node);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_analyzer_basic() {
        let analyzer = Analyzer::new();
        let code = r#"
            fn simple() {}

            async fn async_func() {}

            pub fn public_func() {}

            #[trace]
            fn traced() {}
        "#;

        let temp_file = std::env::temp_dir().join("test.rs");
        std::fs::write(&temp_file, code).unwrap();

        let stats = analyzer.analyze_file(&temp_file, &mut AnalysisStats::default());
        assert!(stats.is_ok());

        std::fs::remove_file(temp_file).unwrap();
    }
}
