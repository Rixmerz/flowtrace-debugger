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
