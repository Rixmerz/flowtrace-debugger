---
paths: ["**/*.java"]
---

# Java Rules

> Always apply these rules when writing or reviewing Java code.

## DO
- Use Records for DTOs and Value Objects (Java 16+)
- Use sealed interfaces for controlled type hierarchies
- Use pattern matching for `instanceof` and `switch`
- Use Virtual Threads for I/O-intensive work (Java 21+)
- Use `try-with-resources` for all AutoCloseable resources
- Use SLF4J parameterized logging (`log.info("msg {}", var)`)
- Use `Optional` as return type for nullable results
- Use immutable collections (`List.of()`, `List.copyOf()`, `Map.of()`)
- Declare variables with interface types (`List<>` not `ArrayList<>`)
- Use `@RestControllerAdvice` for global exception handling
- Use constructor injection (not field injection with `@Autowired`)
- Use `BigDecimal` for monetary calculations
- Use Text Blocks for multi-line strings (SQL, JSON, templates)
- Use switch expressions (not switch statements) with arrow syntax
- Return `Collections.unmodifiableList()` or `List.copyOf()` for internal collections
- Use `Stream.toList()` instead of `.collect(Collectors.toList())` (Java 16+)
- Use compact constructors in Records for validation
- Add domain-specific exceptions with error codes, not generic RuntimeException

## DON'T
- Don't use `Optional` as method parameter — use overloading or `@Nullable`
- Don't call `Optional.get()` without `isPresent()` — use `orElseThrow()` or `orElse()`
- Don't concatenate strings in log statements — use parameterized `{}` placeholders
- Don't modify external state inside Stream operations (no side effects)
- Don't create `Thread` manually — use `ExecutorService` or Virtual Threads
- Don't use `synchronized` on large method blocks — use fine-grained `ReentrantLock` or actors
- Don't use raw types (`List` instead of `List<String>`)
- Don't catch `Exception` or `Throwable` generically — catch specific exception types
- Don't use `Thread.sleep()` to wait for async results — use CompletableFuture or virtual threads
- Don't expose mutable internal collections — return unmodifiable copies
- Don't use field injection (`@Autowired` on fields) — use constructor injection
- Don't concatenate strings in loops with `+` — use `StringBuilder` or `String.join()`
- Don't use `synchronized` with virtual threads — it pins the carrier thread, use `ReentrantLock`
- Don't use `new Thread().start()` — use structured concurrency or executor services
