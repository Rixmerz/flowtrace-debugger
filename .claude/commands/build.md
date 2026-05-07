---
name: build
description: Full production build of jig via distrobox. Use when you need to compile the Tauri binary.
disable-model-invocation: true
argument-hint: "[dev|release]"
---

Build jig. Default is release (production) build.

If $ARGUMENTS is "dev" or empty:
1. Run `pnpm build` to verify frontend compiles
2. Report success or errors

If $ARGUMENTS is "release" or "production":
1. Run `pnpm build` to verify frontend compiles
2. Run `distrobox enter jig-build -- bash -c "cd <project-root> && pnpm tauri build 2>&1"`
3. The AppImage bundling failure is expected and can be ignored
4. Report: binary location at `src-tauri/target/release/jig`

If build fails:
- Check the error output
- Common issues: TypeScript type errors, missing imports, Rust compilation errors
- Fix the issue and retry
