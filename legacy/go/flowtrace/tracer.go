// Package flowtrace provides function tracing capabilities for Go applications
package flowtrace

import (
	"encoding/json"
	"fmt"
	"os"
	"runtime"
	"sync"
	"time"
)

// TraceEvent represents a single trace event
type TraceEvent struct {
	Event          string  `json:"event"`              // ENTER, EXIT, EXCEPTION
	Timestamp      int64   `json:"timestamp"`          // Unix timestamp in microseconds
	Class          string  `json:"class"`              // Package name
	Method         string  `json:"method"`             // Function name
	Args           string  `json:"args,omitempty"`     // String representation of arguments
	Result         string  `json:"result,omitempty"`   // String representation of result
	Exception      string  `json:"exception,omitempty"` // Exception message
	DurationMillis int64   `json:"durationMillis"`     // Duration in milliseconds (ALWAYS included for compatibility)
	DurationMicros int64   `json:"durationMicros"`     // Duration in microseconds (ALWAYS included for compatibility)
	Thread         string  `json:"thread"`             // Thread/goroutine name
}

// Tracer manages function tracing
type Tracer struct {
	config    Config
	logFile   *os.File
	mutex     sync.Mutex
	callStack map[int64]time.Time // goroutine ID -> call start time
}

var (
	globalTracer *Tracer
	tracerMutex  sync.Mutex
)

// NewTracer creates a new tracer instance
func NewTracer(config Config) (*Tracer, error) {
	t := &Tracer{
		config:    config,
		callStack: make(map[int64]time.Time),
	}

	if config.LogFile != "" {
		f, err := os.OpenFile(config.LogFile, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0644)
		if err != nil {
			return nil, fmt.Errorf("failed to open log file: %w", err)
		}
		t.logFile = f
	}

	return t, nil
}

// Start initializes global tracing
func Start(config Config) error {
	tracerMutex.Lock()
	defer tracerMutex.Unlock()

	if globalTracer != nil {
		return fmt.Errorf("tracer already started")
	}

	t, err := NewTracer(config)
	if err != nil {
		return err
	}

	globalTracer = t
	return nil
}

// Stop terminates tracing
func Stop() error {
	tracerMutex.Lock()
	defer tracerMutex.Unlock()

	if globalTracer == nil {
		return nil
	}

	if globalTracer.logFile != nil {
		if err := globalTracer.logFile.Close(); err != nil {
			return err
		}
	}

	globalTracer = nil
	return nil
}

// TraceEnter logs function entry
func TraceEnter(packageName, funcName string, args map[string]interface{}) {
	if globalTracer == nil {
		return
	}

	gid := getGoroutineID()
	now := time.Now()

	globalTracer.mutex.Lock()
	globalTracer.callStack[gid] = now
	globalTracer.mutex.Unlock()

	// Convert args map to string representation
	argsStr := fmt.Sprintf("%v", args)

	event := TraceEvent{
		Event:     "ENTER",
		Timestamp: now.UnixMicro(),
		Class:     packageName,
		Method:    funcName,
		Args:      argsStr,
		Thread:    fmt.Sprintf("goroutine-%d", gid),
	}

	globalTracer.logEvent(event)
}

// TraceExit logs function exit
func TraceExit(packageName, funcName string, result interface{}) {
	if globalTracer == nil {
		return
	}

	gid := getGoroutineID()
	now := time.Now()

	globalTracer.mutex.Lock()
	startTime, exists := globalTracer.callStack[gid]
	if exists {
		delete(globalTracer.callStack, gid)
	}
	globalTracer.mutex.Unlock()

	var durationMillis, durationMicros int64
	if exists {
		elapsed := now.Sub(startTime)
		durationMicros = elapsed.Microseconds()
		durationMillis = durationMicros / 1000
	}

	// Convert result to string representation
	resultStr := fmt.Sprintf("%v", result)

	event := TraceEvent{
		Event:          "EXIT",
		Timestamp:      now.UnixMicro(),
		Class:          packageName,
		Method:         funcName,
		Result:         resultStr,
		DurationMillis: durationMillis,
		DurationMicros: durationMicros,
		Thread:         fmt.Sprintf("goroutine-%d", gid),
	}

	globalTracer.logEvent(event)
}

// TraceException logs function exception
func TraceException(packageName, funcName string, err error) {
	if globalTracer == nil {
		return
	}

	gid := getGoroutineID()
	now := time.Now()

	globalTracer.mutex.Lock()
	startTime, exists := globalTracer.callStack[gid]
	if exists {
		delete(globalTracer.callStack, gid)
	}
	globalTracer.mutex.Unlock()

	var durationMillis, durationMicros int64
	if exists {
		elapsed := now.Sub(startTime)
		durationMicros = elapsed.Microseconds()
		durationMillis = durationMicros / 1000
	}

	event := TraceEvent{
		Event:          "EXCEPTION",
		Timestamp:      now.UnixMicro(),
		Class:          packageName,
		Method:         funcName,
		Exception:      err.Error(),
		DurationMillis: durationMillis,
		DurationMicros: durationMicros,
		Thread:         fmt.Sprintf("goroutine-%d", gid),
	}

	globalTracer.logEvent(event)
}

// logEvent writes event to log file and/or stdout
func (t *Tracer) logEvent(event TraceEvent) {
	data, err := json.Marshal(event)
	if err != nil {
		return
	}

	t.mutex.Lock()
	defer t.mutex.Unlock()

	line := string(data) + "\n"

	if t.logFile != nil {
		t.logFile.WriteString(line)
	}

	if t.config.Stdout {
		fmt.Print(line)
	}
}

// getGoroutineID returns the current goroutine ID
func getGoroutineID() int64 {
	var buf [64]byte
	n := runtime.Stack(buf[:], false)
	// Parse goroutine ID from stack trace
	var gid int64
	fmt.Sscanf(string(buf[:n]), "goroutine %d", &gid)
	return gid
}
