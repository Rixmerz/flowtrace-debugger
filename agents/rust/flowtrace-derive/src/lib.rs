//! Procedural macros for FlowTrace tracing
//!
//! Provides the `#[trace]` attribute macro for automatic function instrumentation
//! with automatic capture of arguments, return values, and errors.

use proc_macro::TokenStream;
use quote::quote;
use syn::{parse_macro_input, FnArg, ItemFn, Pat, ReturnType, Type};

/// Automatic function tracing attribute macro with intelligent arg/result/error capture
///
/// # Example
///
/// ```rust
/// use flowtrace_agent::trace;
///
/// #[trace]
/// fn my_function(x: i32, name: &str) -> Result<i32, String> {
///     if x < 0 {
///         return Err("Negative value".to_string());
///     }
///     Ok(x * 2)
/// }
/// ```
///
/// Expands to instrumented code with:
/// - Automatic argument capture (formats all args as JSON-like string)
/// - Automatic return value capture (formats result/error)
/// - Enter/exit/exception logging with duration tracking
/// - Result<T, E> error handling
/// - Panic handling
#[proc_macro_attribute]
pub fn trace(_attr: TokenStream, item: TokenStream) -> TokenStream {
    let input = parse_macro_input!(item as ItemFn);

    let fn_name = &input.sig.ident;
    let fn_name_str = fn_name.to_string();
    let fn_block = &input.block;
    let fn_vis = &input.vis;
    let fn_sig = &input.sig;
    let fn_attrs = &input.attrs;

    // Determine module path at compile time
    let module_path = quote! { module_path!() };

    // Check if function is async
    let is_async = fn_sig.asyncness.is_some();

    // Extract function arguments for automatic capture
    let arg_names: Vec<_> = fn_sig
        .inputs
        .iter()
        .filter_map(|arg| {
            if let FnArg::Typed(pat_type) = arg {
                if let Pat::Ident(ident) = &*pat_type.pat {
                    return Some(&ident.ident);
                }
            }
            None
        })
        .collect();

    // Build args string: "{\"arg1\": value1, \"arg2\": value2}"
    let args_capture = if arg_names.is_empty() {
        quote! { None }
    } else {
        let arg_strings: Vec<_> = arg_names
            .iter()
            .map(|name| {
                let name_str = name.to_string();
                quote! {
                    format!("\"{}\": {:?}", #name_str, #name)
                }
            })
            .collect();

        quote! {
            Some(format!("{{{}}}", vec![#(#arg_strings),*].join(", ")))
        }
    };

    // Check return type for Result<T, E> or regular return
    let (has_return, is_result_type) = match &fn_sig.output {
        ReturnType::Default => (false, false),
        ReturnType::Type(_, ty) => {
            let is_result = is_result_type(ty);
            (true, is_result)
        }
    };

    let instrumented_body = if is_async {
        // Async function instrumentation
        if is_result_type {
            // Async function returning Result<T, E>
            quote! {
                let __flowtrace_start = std::time::Instant::now();
                let __flowtrace_module = #module_path;
                let __flowtrace_function = #fn_name_str;

                // Log ENTER event with args
                flowtrace_agent::log_event(
                    flowtrace_agent::TraceEvent::enter(
                        __flowtrace_module,
                        __flowtrace_function,
                        #args_capture,
                    )
                );

                // Execute original function body
                let __flowtrace_result = async move #fn_block.await;

                // Calculate duration in microseconds
                let __flowtrace_duration = __flowtrace_start.elapsed().as_micros() as i64;

                // Handle Result<T, E>
                match &__flowtrace_result {
                    Ok(value) => {
                        // Log EXIT event with result
                        flowtrace_agent::log_event(
                            flowtrace_agent::TraceEvent::exit(
                                __flowtrace_module,
                                __flowtrace_function,
                                Some(format!("{:?}", value)),
                                Some(__flowtrace_duration),
                            )
                        );
                    }
                    Err(error) => {
                        // Log EXCEPTION event with error
                        flowtrace_agent::log_event(
                            flowtrace_agent::TraceEvent::exception(
                                __flowtrace_module,
                                __flowtrace_function,
                                &format!("{:?}", error),
                                Some(__flowtrace_duration),
                            )
                        );
                    }
                }

                __flowtrace_result
            }
        } else {
            // Async function with regular return
            quote! {
                let __flowtrace_start = std::time::Instant::now();
                let __flowtrace_module = #module_path;
                let __flowtrace_function = #fn_name_str;

                // Log ENTER event with args
                flowtrace_agent::log_event(
                    flowtrace_agent::TraceEvent::enter(
                        __flowtrace_module,
                        __flowtrace_function,
                        #args_capture,
                    )
                );

                // Execute original function body
                let __flowtrace_result = async move #fn_block.await;

                // Calculate duration in microseconds
                let __flowtrace_duration = __flowtrace_start.elapsed().as_micros() as i64;

                // Log EXIT event with result
                flowtrace_agent::log_event(
                    flowtrace_agent::TraceEvent::exit(
                        __flowtrace_module,
                        __flowtrace_function,
                        Some(format!("{:?}", __flowtrace_result)),
                        Some(__flowtrace_duration),
                    )
                );

                __flowtrace_result
            }
        }
    } else if is_result_type {
        // Sync function returning Result<T, E>
        quote! {
            let __flowtrace_start = std::time::Instant::now();
            let __flowtrace_module = #module_path;
            let __flowtrace_function = #fn_name_str;

            // Log ENTER event with args
            flowtrace_agent::log_event(
                flowtrace_agent::TraceEvent::enter(
                    __flowtrace_module,
                    __flowtrace_function,
                    #args_capture,
                )
            );

            // Execute original function body with panic handling
            let __flowtrace_panic_result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                #fn_block
            }));

            // Calculate duration in microseconds
            let __flowtrace_duration = __flowtrace_start.elapsed().as_micros() as i64;

            match __flowtrace_panic_result {
                Ok(__flowtrace_result) => {
                    // Handle Result<T, E>
                    match &__flowtrace_result {
                        Ok(value) => {
                            // Log EXIT event with result
                            flowtrace_agent::log_event(
                                flowtrace_agent::TraceEvent::exit(
                                    __flowtrace_module,
                                    __flowtrace_function,
                                    Some(format!("{:?}", value)),
                                    Some(__flowtrace_duration),
                                )
                            );
                        }
                        Err(error) => {
                            // Log EXCEPTION event with error
                            flowtrace_agent::log_event(
                                flowtrace_agent::TraceEvent::exception(
                                    __flowtrace_module,
                                    __flowtrace_function,
                                    &format!("{:?}", error),
                                    Some(__flowtrace_duration),
                                )
                            );
                        }
                    }
                    __flowtrace_result
                }
                Err(panic_info) => {
                    // Log panic as EXCEPTION event
                    let error_msg = if let Some(s) = panic_info.downcast_ref::<&str>() {
                        s.to_string()
                    } else if let Some(s) = panic_info.downcast_ref::<String>() {
                        s.clone()
                    } else {
                        "Unknown panic".to_string()
                    };

                    flowtrace_agent::log_event(
                        flowtrace_agent::TraceEvent::exception(
                            __flowtrace_module,
                            __flowtrace_function,
                            &error_msg,
                            Some(__flowtrace_duration),
                        )
                    );

                    std::panic::resume_unwind(panic_info);
                }
            }
        }
    } else if has_return {
        // Sync function with return value (non-Result)
        quote! {
            let __flowtrace_start = std::time::Instant::now();
            let __flowtrace_module = #module_path;
            let __flowtrace_function = #fn_name_str;

            // Log ENTER event with args
            flowtrace_agent::log_event(
                flowtrace_agent::TraceEvent::enter(
                    __flowtrace_module,
                    __flowtrace_function,
                    #args_capture,
                )
            );

            // Execute original function body with panic handling
            let __flowtrace_panic_result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                #fn_block
            }));

            // Calculate duration in microseconds
            let __flowtrace_duration = __flowtrace_start.elapsed().as_micros() as i64;

            match __flowtrace_panic_result {
                Ok(__flowtrace_result) => {
                    // Log EXIT event with result
                    flowtrace_agent::log_event(
                        flowtrace_agent::TraceEvent::exit(
                            __flowtrace_module,
                            __flowtrace_function,
                            Some(format!("{:?}", __flowtrace_result)),
                            Some(__flowtrace_duration),
                        )
                    );
                    __flowtrace_result
                }
                Err(panic_info) => {
                    // Log panic as EXCEPTION event
                    let error_msg = if let Some(s) = panic_info.downcast_ref::<&str>() {
                        s.to_string()
                    } else if let Some(s) = panic_info.downcast_ref::<String>() {
                        s.clone()
                    } else {
                        "Unknown panic".to_string()
                    };

                    flowtrace_agent::log_event(
                        flowtrace_agent::TraceEvent::exception(
                            __flowtrace_module,
                            __flowtrace_function,
                            &error_msg,
                            Some(__flowtrace_duration),
                        )
                    );

                    std::panic::resume_unwind(panic_info);
                }
            }
        }
    } else {
        // Sync function without return value (void)
        quote! {
            let __flowtrace_start = std::time::Instant::now();
            let __flowtrace_module = #module_path;
            let __flowtrace_function = #fn_name_str;

            // Log ENTER event with args
            flowtrace_agent::log_event(
                flowtrace_agent::TraceEvent::enter(
                    __flowtrace_module,
                    __flowtrace_function,
                    #args_capture,
                )
            );

            // Execute original function body with panic handling
            let __flowtrace_panic_result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                #fn_block
            }));

            // Calculate duration in microseconds
            let __flowtrace_duration = __flowtrace_start.elapsed().as_micros() as i64;

            match __flowtrace_panic_result {
                Ok(_) => {
                    // Log EXIT event (void function)
                    flowtrace_agent::log_event(
                        flowtrace_agent::TraceEvent::exit(
                            __flowtrace_module,
                            __flowtrace_function,
                            Some("()".to_string()),
                            Some(__flowtrace_duration),
                        )
                    );
                }
                Err(panic_info) => {
                    // Log panic as EXCEPTION event
                    let error_msg = if let Some(s) = panic_info.downcast_ref::<&str>() {
                        s.to_string()
                    } else if let Some(s) = panic_info.downcast_ref::<String>() {
                        s.clone()
                    } else {
                        "Unknown panic".to_string()
                    };

                    flowtrace_agent::log_event(
                        flowtrace_agent::TraceEvent::exception(
                            __flowtrace_module,
                            __flowtrace_function,
                            &error_msg,
                            Some(__flowtrace_duration),
                        )
                    );

                    std::panic::resume_unwind(panic_info);
                }
            }
        }
    };

    // Rebuild the function with instrumentation
    let output = quote! {
        #(#fn_attrs)*
        #fn_vis #fn_sig {
            #instrumented_body
        }
    };

    TokenStream::from(output)
}

/// Helper function to detect Result<T, E> type
fn is_result_type(ty: &Type) -> bool {
    if let Type::Path(type_path) = ty {
        if let Some(segment) = type_path.path.segments.last() {
            return segment.ident == "Result";
        }
    }
    false
}

/// Trace a block of code
///
/// # Example
///
/// ```rust
/// use flowtrace_agent::trace_block;
///
/// fn my_function() {
///     trace_block!("database_query", {
///         // Your code here
///     });
/// }
/// ```
#[proc_macro]
pub fn trace_block(input: TokenStream) -> TokenStream {
    let input = proc_macro2::TokenStream::from(input);

    let output = quote! {
        {
            let __flowtrace_start = std::time::Instant::now();
            flowtrace_agent::log_event(
                flowtrace_agent::TraceEvent::enter(
                    module_path!(),
                    stringify!(#input),
                    None,
                )
            );

            let __flowtrace_result = #input;

            let __flowtrace_duration = __flowtrace_start.elapsed().as_micros() as i64;
            flowtrace_agent::log_event(
                flowtrace_agent::TraceEvent::exit(
                    module_path!(),
                    stringify!(#input),
                    Some(format!("{:?}", __flowtrace_result)),
                    Some(__flowtrace_duration),
                )
            );

            __flowtrace_result
        }
    };

    TokenStream::from(output)
}
