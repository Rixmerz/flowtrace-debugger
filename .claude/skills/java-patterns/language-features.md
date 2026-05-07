# Java Language Features

## Records (Java 16+)
Immutable data carriers with auto-generated `equals()`, `hashCode()`, `toString()`, accessors:
```java
public record Point(double x, double y) {}

// Compact constructor for validation
public record Email(String value) {
    public Email {
        Objects.requireNonNull(value, "Email cannot be null");
        if (!value.contains("@")) throw new IllegalArgumentException("Invalid email");
        value = value.toLowerCase().strip();  // can reassign in compact constructor
    }
}

// Records can implement interfaces
public record UserId(String value) implements Serializable, Comparable<UserId> {
    @Override
    public int compareTo(UserId other) { return value.compareTo(other.value); }
}
```
Records are final, cannot extend other classes, fields are final. Use for DTOs, Value Objects, events.

## Sealed Classes (Java 17)
Controlled type hierarchies — compiler knows all subtypes:
```java
public sealed interface Shape permits Circle, Rectangle, Triangle {}

public record Circle(double radius) implements Shape {}
public record Rectangle(double width, double height) implements Shape {}
public record Triangle(double a, double b, double c) implements Shape {}

// Exhaustive pattern matching — compiler verifies all cases covered
public double area(Shape shape) {
    return switch (shape) {
        case Circle c    -> Math.PI * c.radius() * c.radius();
        case Rectangle r -> r.width() * r.height();
        case Triangle t  -> {
            double s = (t.a() + t.b() + t.c()) / 2;
            yield Math.sqrt(s * (s - t.a()) * (s - t.b()) * (s - t.c()));
        }
    };
    // No default needed — compiler knows all subtypes
}
```

## Pattern Matching for instanceof (Java 16+)
Eliminates explicit casting after type check:
```java
// Before
if (obj instanceof String) {
    String s = (String) obj;
    System.out.println(s.length());
}

// After — binding variable in scope
if (obj instanceof String s) {
    System.out.println(s.length());
}

// Works with negation
if (!(obj instanceof String s)) {
    return;
}
// s is in scope here (compiler knows it must be String)
s.toLowerCase();
```

## Pattern Matching for Switch (Java 21)
Exhaustive, with guards and null handling:
```java
public String describe(Object obj) {
    return switch (obj) {
        case null               -> "null";
        case Integer i when i < 0 -> "negative: " + i;
        case Integer i          -> "integer: " + i;
        case String s when s.isBlank() -> "blank string";
        case String s           -> "string: " + s;
        case List<?> l when l.isEmpty() -> "empty list";
        case List<?> l          -> "list of size " + l.size();
        default                 -> "unknown: " + obj.getClass().getSimpleName();
    };
}
```

## Record Patterns (Java 21)
Deconstruct records directly in pattern matching:
```java
// Nested deconstruction
record Address(String city, String country) {}
record Customer(String name, Address address) {}

public String greet(Object obj) {
    return switch (obj) {
        case Customer(var name, Address(var city, _))
            -> "Hello %s from %s!".formatted(name, city);
        default -> "Hello stranger!";
    };
}

// In instanceof
if (point instanceof Point(var x, var y) && x > 0 && y > 0) {
    // x and y are extracted and in scope
}
```

## Virtual Threads (Java 21 — Project Loom)
Lightweight threads managed by the JVM, not OS. Millions can run concurrently:
```java
// Create virtual threads directly
Thread.startVirtualThread(() -> {
    var result = fetchFromDatabase();  // blocks OS thread? No — JVM unmounts virtual thread
    process(result);
});

// ExecutorService with virtual threads
try (var executor = Executors.newVirtualThreadPerTaskExecutor()) {
    IntStream.range(0, 100_000).forEach(i ->
        executor.submit(() -> {
            Thread.sleep(Duration.ofSeconds(1));  // 100K sleeping threads — trivial
            return fetchData(i);
        })
    );
}

// Spring Boot 3.2+: single config line
// spring.threads.virtual.enabled=true
```
Use for I/O-bound work (HTTP calls, DB queries, file I/O). Not for CPU-bound computation.
Do NOT use `synchronized` with virtual threads — it pins the carrier thread. Use `ReentrantLock`.

## Text Blocks (Java 17)
Multi-line strings with automatic indentation management:
```java
String json = """
        {
            "name": "%s",
            "age": %d,
            "roles": ["admin", "user"]
        }
        """.formatted(name, age);

String sql = """
        SELECT u.name, u.email, COUNT(o.id) as order_count
        FROM users u
        LEFT JOIN orders o ON o.user_id = u.id
        WHERE u.active = true
        GROUP BY u.name, u.email
        HAVING COUNT(o.id) > ?
        """;
```

## Sequenced Collections (Java 21)
New interfaces with defined encounter order:
```java
SequencedCollection<String> list = new ArrayList<>(List.of("a", "b", "c"));
list.getFirst();    // "a"
list.getLast();     // "c"
list.reversed();    // reversed view: ["c", "b", "a"]

SequencedMap<String, Integer> map = new LinkedHashMap<>();
map.putFirst("x", 1);
map.putLast("z", 3);
map.firstEntry();   // x=1
map.lastEntry();    // z=3
```

## Unnamed Variables (Java 22+)
Use `_` for variables you don't need:
```java
// In enhanced for
for (var _ : collection) {
    count++;
}

// In catch blocks
try { /* ... */ }
catch (NumberFormatException _) {
    return defaultValue;
}

// In pattern matching
if (obj instanceof Point(var x, _)) {
    // Only care about x
}

// In lambdas
map.forEach((_, value) -> process(value));
```

## Structured Concurrency (Preview — Java 24)
Treat groups of concurrent tasks as a unit:
```java
try (var scope = StructuredTaskScope.open()) {
    Subtask<User> userTask = scope.fork(() -> fetchUser(userId));
    Subtask<List<Order>> ordersTask = scope.fork(() -> fetchOrders(userId));
    scope.join();  // Wait for both

    var user = userTask.get();       // No blocking — already complete
    var orders = ordersTask.get();
    return new UserProfile(user, orders);
}
// If one fails, the other is cancelled automatically
```

## Scoped Values (Preview — Java 24)
Thread-local alternative optimized for virtual threads:
```java
private static final ScopedValue<User> CURRENT_USER = ScopedValue.newInstance();

ScopedValue.runWhere(CURRENT_USER, authenticatedUser, () -> {
    // Any code in this scope (including called methods) can read:
    User user = CURRENT_USER.get();
    processRequest();
});
// Value not accessible outside scope — safer than ThreadLocal
```

## Streams API — Advanced Collectors
```java
// groupingBy with downstream collector
var avgSalaryByDept = employees.stream()
    .collect(Collectors.groupingBy(
        Employee::department,
        Collectors.averagingDouble(Employee::salary)
    ));

// partitioningBy (boolean split)
var partition = users.stream()
    .collect(Collectors.partitioningBy(User::isActive));
List<User> active = partition.get(true);
List<User> inactive = partition.get(false);

// teeing (two collectors merged)
var result = numbers.stream()
    .collect(Collectors.teeing(
        Collectors.summingInt(Integer::intValue),
        Collectors.counting(),
        (sum, count) -> new Stats(sum, count, (double) sum / count)
    ));

// toMap with merge function (handle duplicates)
var latestByUser = events.stream()
    .collect(Collectors.toMap(
        Event::userId,
        Function.identity(),
        (existing, replacement) -> replacement.timestamp().isAfter(existing.timestamp())
            ? replacement : existing
    ));
```

## Switch Expressions (Java 17)
Expressions (return values), not statements:
```java
// Arrow syntax — no fall-through, no break needed
int numLetters = switch (day) {
    case MONDAY, FRIDAY, SUNDAY -> 6;
    case TUESDAY -> 7;
    case WEDNESDAY, THURSDAY, SATURDAY -> {
        log.debug("Computing for {}", day);
        yield day.name().length();  // yield for multi-line blocks
    }
};
```
