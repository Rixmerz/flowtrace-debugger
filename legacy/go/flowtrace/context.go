package flowtrace

import (
	"fmt"
	"time"
)

// CallContext represents a function call context for tracing
// This is the main API used by instrumented code
type CallContext struct {
	packageName  string
	functionName string
	startTime    time.Time
	goroutineID  int64
	args         map[string]interface{}
}

// Enter creates a new call context and logs function entry
// This is called at the beginning of every instrumented function
func Enter(pkg, fn string, args map[string]interface{}) *CallContext {
	ctx := &CallContext{
		packageName:  pkg,
		functionName: fn,
		startTime:    time.Now(),
		goroutineID:  getGoroutineID(),
		args:         args,
	}

	// Log ENTER event
	TraceEnter(pkg, fn, args)

	return ctx
}

// Exit logs function exit with optional return values
// This is called via defer at function exit
func (ctx *CallContext) Exit(resultFunc func() interface{}) {
	if resultFunc != nil {
		result := resultFunc()
		TraceExit(ctx.packageName, ctx.functionName, result)
	} else {
		TraceExit(ctx.packageName, ctx.functionName, nil)
	}
}

// ExitWithValues logs function exit with explicit return values
func (ctx *CallContext) ExitWithValues(results ...interface{}) {
	var result interface{}
	if len(results) == 1 {
		result = results[0]
	} else if len(results) > 1 {
		result = results
	}
	TraceExit(ctx.packageName, ctx.functionName, result)
}

// Exception logs function exception/panic
// This is called when a panic is recovered
func (ctx *CallContext) Exception(err error) {
	TraceException(ctx.packageName, ctx.functionName, err)
}

// ExceptionString logs function exception with string message
func (ctx *CallContext) ExceptionString(msg string) {
	TraceException(ctx.packageName, ctx.functionName, fmt.Errorf("%s", msg))
}

// Duration returns the elapsed time since function entry
func (ctx *CallContext) Duration() time.Duration {
	return time.Since(ctx.startTime)
}

// Package returns the package name
func (ctx *CallContext) Package() string {
	return ctx.packageName
}

// Function returns the function name
func (ctx *CallContext) Function() string {
	return ctx.functionName
}

// GoroutineID returns the goroutine ID
func (ctx *CallContext) GoroutineID() int64 {
	return ctx.goroutineID
}
