package flowtracert

import (
	"os"
	"reflect"
	"strings"
	"testing"
)

// ---------------------------------------------------------------------------
// AC4: FLOWTRACE_REDACT_KEYS / FLOWTRACE_MAX_ARG_LENGTH — same contract as
// the Python runtime (capture/python/flowtrace_runtime/runtime.py).
// ---------------------------------------------------------------------------

func withEnv(t *testing.T, key, value string) {
	t.Helper()
	old, had := os.LookupEnv(key)
	os.Setenv(key, value)
	t.Cleanup(func() {
		if had {
			os.Setenv(key, old)
		} else {
			os.Unsetenv(key)
		}
	})
}

func TestDefaultRedactKeysAppliedWhenEnvUnset(t *testing.T) {
	os.Unsetenv("FLOWTRACE_REDACT_KEYS")
	keys := redactKeys()
	got := serializeNamed("password", "hunter2", keys, 0)
	if got != "<redacted>" {
		t.Errorf("password = %v, want <redacted>", got)
	}
	got = serializeNamed("url", "https://user:pw@host/db", keys, 0)
	if got != "<redacted>" {
		t.Errorf("url = %v, want <redacted>", got)
	}
	got = serializeNamed("email", "a@b.com", keys, 0)
	if got != "<redacted>" {
		t.Errorf("email = %v, want <redacted>", got)
	}
}

func TestRedactKeysEnvExtendsDefaultList(t *testing.T) {
	withEnv(t, "FLOWTRACE_REDACT_KEYS", "custom_secret")
	keys := redactKeys()

	if serializeNamed("password", "x", keys, 0) != "<redacted>" {
		t.Error("default key 'password' should still be redacted")
	}
	if serializeNamed("custom_secret", "x", keys, 0) != "<redacted>" {
		t.Error("env-added key 'custom_secret' should be redacted")
	}
}

func TestRedactMatchIsCaseInsensitiveSubstring(t *testing.T) {
	keys := []string{"password"}
	if serializeNamed("PASSWORD", "x", keys, 0) != "<redacted>" {
		t.Error("redact match should be case-insensitive")
	}
	if serializeNamed("userPasswordHash", "x", keys, 0) != "<redacted>" {
		t.Error("redact match should be substring, not exact")
	}
}

func TestRedactKeysRecurseIntoNestedStruct(t *testing.T) {
	type Config struct {
		Host     string
		Password string
	}
	keys := redactKeys()
	got := serializeValue(reflect.ValueOf(Config{Host: "db.local", Password: "hunter2"}), maxSerializeDepth, keys)
	m, ok := got.(map[string]any)
	if !ok {
		t.Fatalf("expected map, got %T", got)
	}
	if m["Password"] != "<redacted>" {
		t.Errorf("nested Password = %v, want <redacted>", m["Password"])
	}
	if m["Host"] != "db.local" {
		t.Errorf("nested Host = %v, want unchanged", m["Host"])
	}
}

func TestRedactKeysRecurseIntoNestedMap(t *testing.T) {
	keys := redactKeys()
	got := serializeValue(reflect.ValueOf(map[string]any{
		"config": map[string]any{"password": "hunter2", "host": "db.local"},
	}), maxSerializeDepth, keys)
	m := got.(map[string]any)
	config := m["config"].(map[string]any)
	if config["password"] != "<redacted>" {
		t.Errorf("nested map password = %v, want <redacted>", config["password"])
	}
	if config["host"] != "db.local" {
		t.Errorf("nested map host = %v, want unchanged", config["host"])
	}
}

func TestMaxArgLengthDefault(t *testing.T) {
	os.Unsetenv("FLOWTRACE_MAX_ARG_LENGTH")
	if got := maxArgLength(); got != 512 {
		t.Errorf("maxArgLength() = %d, want 512", got)
	}
}

func TestMaxArgLengthZeroDisablesTruncation(t *testing.T) {
	withEnv(t, "FLOWTRACE_MAX_ARG_LENGTH", "0")
	long := strings.Repeat("x", 2000)
	got := serializeNamed("note", long, nil, maxArgLength())
	if got != long {
		t.Errorf("expected untruncated value with max length 0, got %v", got)
	}
}

func TestArgTruncatedWhenOverMaxLength(t *testing.T) {
	withEnv(t, "FLOWTRACE_MAX_ARG_LENGTH", "16")
	long := strings.Repeat("x", 100)
	got := serializeNamed("note", long, nil, maxArgLength())
	s, ok := got.(string)
	if !ok || !strings.HasPrefix(s, "<truncated:") {
		t.Fatalf("expected a truncation marker, got %v", got)
	}
}

func TestArgNotTruncatedWhenUnderMaxLength(t *testing.T) {
	withEnv(t, "FLOWTRACE_MAX_ARG_LENGTH", "512")
	got := serializeNamed("note", "short", nil, maxArgLength())
	if got != "short" {
		t.Errorf("short value should not be truncated, got %v", got)
	}
}

func TestMaxArgLengthInvalidFallsBackToDefault(t *testing.T) {
	withEnv(t, "FLOWTRACE_MAX_ARG_LENGTH", "not-a-number")
	if got := maxArgLength(); got != 512 {
		t.Errorf("maxArgLength() with invalid env = %d, want default 512", got)
	}
}

// ---------------------------------------------------------------------------
// Results go through the same redact/truncate path as args, keyed by the
// name the transformer hands Exit — a declared result name, or a positional
// r<i> for an unnamed one. Before result names existed the key was always
// r0/r1, so result redaction could never fire; these pin that it now does.
// ---------------------------------------------------------------------------

func exitResultOf(t *testing.T, resultPairs ...any) map[string]any {
	t.Helper()
	runtime_setProfLabel(nil)
	offset := snapshotOffset(t)
	s := Enter("myapp/auth", "", "Login", "public", "user", "bob")
	Exit(s, resultPairs...)
	events := readEventsSince(t, offset)
	if len(events) != 2 {
		t.Fatalf("expected enter+exit, got %d events: %v", len(events), events)
	}
	result, ok := events[1]["result"].(map[string]any)
	if !ok {
		t.Fatalf("exit.result missing or wrong shape: %v", events[1]["result"])
	}
	return result
}

func TestNamedResultIsEmittedUnderItsDeclaredName(t *testing.T) {
	result := exitResultOf(t, "quotient", 3, "err", error(nil))
	if result["quotient"] != float64(3) {
		t.Errorf("result.quotient = %v, want 3", result["quotient"])
	}
	if v, ok := result["err"]; !ok || v != nil {
		t.Errorf("result.err = %v (present=%v), want null", v, ok)
	}
	if _, has := result["r0"]; has {
		t.Errorf("named result must not also be emitted positionally: %v", result)
	}
}

func TestUnnamedResultsKeepPositionalKeys(t *testing.T) {
	result := exitResultOf(t, "r0", "ok", "r1", error(nil))
	if result["r0"] != "ok" {
		t.Errorf("result.r0 = %v, want ok", result["r0"])
	}
	if _, has := result["r1"]; !has {
		t.Errorf("result.r1 missing: %v", result)
	}
}

func TestNamedResultPasswordIsRedacted(t *testing.T) {
	os.Unsetenv("FLOWTRACE_REDACT_KEYS")
	result := exitResultOf(t, "password", "hunter2", "err", error(nil))
	if result["password"] != "<redacted>" {
		t.Errorf("result.password = %v, want <redacted>", result["password"])
	}
}

func TestResultRedactionHonoursEnvAddedKeys(t *testing.T) {
	withEnv(t, "FLOWTRACE_REDACT_KEYS", "sessionblob")
	result := exitResultOf(t, "sessionBlob", "opaque", "count", 1)
	if result["sessionBlob"] != "<redacted>" {
		t.Errorf("result.sessionBlob = %v, want <redacted>", result["sessionBlob"])
	}
	if result["count"] != float64(1) {
		t.Errorf("result.count = %v, want 1 (unrelated key must not be redacted)", result["count"])
	}
}

func TestResultTruncatedWhenOverMaxLength(t *testing.T) {
	withEnv(t, "FLOWTRACE_MAX_ARG_LENGTH", "16")
	long := strings.Repeat("y", 100)
	result := exitResultOf(t, "r0", long)
	s, ok := result["r0"].(string)
	if !ok || !strings.HasPrefix(s, "<truncated:") || !strings.HasSuffix(s, "...>") {
		t.Fatalf("expected a truncation marker on the result, got %v", result["r0"])
	}
	// The marker keeps the first maxLen characters of the JSON form — the
	// opening quote counts, exactly as it does for an argument.
	if want := "<truncated:\"" + strings.Repeat("y", 15) + "...>"; s != want {
		t.Errorf("result marker = %q, want %q", s, want)
	}
}

func TestResultTruncationIsIndependentOfArgs(t *testing.T) {
	withEnv(t, "FLOWTRACE_MAX_ARG_LENGTH", "16")
	runtime_setProfLabel(nil)
	offset := snapshotOffset(t)
	s := Enter("myapp/io", "", "Echo", "public", "data", strings.Repeat("x", 100))
	Exit(s, "r0", "short")
	events := readEventsSince(t, offset)
	args := events[1]["args"].(map[string]any)
	result := events[1]["result"].(map[string]any)
	if !strings.HasPrefix(args["data"].(string), "<truncated:") {
		t.Errorf("long arg should be truncated, got %v", args["data"])
	}
	if result["r0"] != "short" {
		t.Errorf("short result must be left alone, got %v", result["r0"])
	}
}

func TestResultTruncationDisabledByZero(t *testing.T) {
	withEnv(t, "FLOWTRACE_MAX_ARG_LENGTH", "0")
	long := strings.Repeat("z", 2000)
	result := exitResultOf(t, "r0", long)
	if result["r0"] != long {
		t.Errorf("expected untruncated result with max length 0")
	}
}
