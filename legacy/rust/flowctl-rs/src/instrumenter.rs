//! Code instrumenter for adding #[trace] attributes

use std::fs;
use std::path::{Path, PathBuf};
use syn::{parse_file, Attribute, Item, ItemFn};
use quote::quote;

#[derive(Debug)]
pub struct InstrumentResult {
    pub count: usize,
    pub functions: Vec<String>,
    pub backup_path: Option<String>,
}

pub struct Instrumenter {
    create_backup: bool,
}

impl Instrumenter {
    pub fn new(create_backup: bool) -> Self {
        Self { create_backup }
    }

    pub fn instrument_file(
        &self,
        file: &Path,
        dry_run: bool,
    ) -> Result<InstrumentResult, String> {
        let content = fs::read_to_string(file)
            .map_err(|e| format!("Failed to read file {}: {}", file.display(), e))?;

        // Parse file
        let mut syntax = parse_file(&content)
            .map_err(|e| format!("Failed to parse file {}: {}", file.display(), e))?;

        let mut instrumented_functions = Vec::new();

        // Instrument functions
        for item in &mut syntax.items {
            if let Item::Fn(func) = item {
                if should_instrument(func) {
                    instrumented_functions.push(func.sig.ident.to_string());

                    if !dry_run {
                        add_trace_attribute(func);
                    }
                }
            }
        }

        let mut backup_path = None;

        if !dry_run && !instrumented_functions.is_empty() {
            // Create backup if requested
            if self.create_backup {
                let backup = file.with_extension("rs.bak");
                fs::copy(file, &backup).map_err(|e| format!("Failed to create backup: {}", e))?;
                backup_path = Some(backup.to_string_lossy().to_string());
            }

            // Write instrumented code
            let instrumented_code = quote! { #syntax }.to_string();
            fs::write(file, instrumented_code)
                .map_err(|e| format!("Failed to write file: {}", e))?;
        }

        Ok(InstrumentResult {
            count: instrumented_functions.len(),
            functions: instrumented_functions,
            backup_path,
        })
    }
}

fn should_instrument(func: &ItemFn) -> bool {
    // Don't instrument if already has #[trace]
    if has_trace_attribute(func) {
        return false;
    }

    // Don't instrument test functions
    if is_test_function(func) {
        return false;
    }

    // Don't instrument functions without body
    if func.block.stmts.is_empty() {
        return false;
    }

    // Don't instrument certain special functions
    let name = func.sig.ident.to_string();
    if name == "main" || name == "init" || name.starts_with("test_") {
        return false;
    }

    true
}

fn has_trace_attribute(func: &ItemFn) -> bool {
    func.attrs
        .iter()
        .any(|attr| attr.path().is_ident("trace"))
}

fn is_test_function(func: &ItemFn) -> bool {
    func.attrs.iter().any(|attr| {
        attr.path().is_ident("test")
            || attr.path().is_ident("cfg")
            || attr.path().is_ident("bench")
    })
}

fn add_trace_attribute(func: &mut ItemFn) {
    let trace_attr: Attribute = syn::parse_quote! { #[trace] };
    func.attrs.push(trace_attr);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_should_instrument() {
        let code = r#"
            fn simple() { println!("hello"); }
        "#;

        let syntax = syn::parse_str::<ItemFn>(code).unwrap();
        assert!(should_instrument(&syntax));
    }

    #[test]
    fn test_should_not_instrument_test() {
        let code = r#"
            #[test]
            fn test_simple() { assert!(true); }
        "#;

        let syntax = syn::parse_str::<ItemFn>(code).unwrap();
        assert!(!should_instrument(&syntax));
    }

    #[test]
    fn test_should_not_instrument_traced() {
        let code = r#"
            #[trace]
            fn already_traced() { println!("hello"); }
        "#;

        let syntax = syn::parse_str::<ItemFn>(code).unwrap();
        assert!(!should_instrument(&syntax));
    }
}
