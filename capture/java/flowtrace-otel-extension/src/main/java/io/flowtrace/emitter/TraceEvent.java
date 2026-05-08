package io.flowtrace.emitter;

import java.util.Map;

/**
 * POJO matching the FlowTrace v2 schema.
 * Null fields (e.g. result/error on enter events) are omitted from JSON output
 * by the hand-rolled serializer in {@link FlowtraceEmitter#toJson}.
 *
 * <p>Wire-format field name mapping (snake_case) is handled by the emitter, not
 * by annotations. Java field → wire name: traceId→"trace_id", spanId→"span_id",
 * parentId→"parent_id", className→"class", durationNs→"duration_ns".
 *
 * <p>Two event types share this class:
 * <ul>
 *   <li>{@code enter} — result, durationNs, and error are null.</li>
 *   <li>{@code exit}  — result and durationNs are set; error is set only if
 *       the method threw.</li>
 * </ul>
 */
public class TraceEvent {

    // --- common fields (enter + exit) ---

    /** Unix epoch seconds (double, sub-second precision via nanoTime offset). */
    private double ts;

    // wire: "trace_id"
    private String traceId;

    // wire: "span_id"
    private String spanId;

    // wire: "parent_id" — null allowed (root span)
    private String parentId;

    private String event;      // "enter" | "exit"

    private String thread;

    private String lang = "java";

    private String module;

    // wire: "class"
    private String className;

    private String method;

    private String visibility; // "public" | "private" | "internal" | "unknown"

    private Map<String, Object> args;

    private int depth;

    // --- exit-only fields ---

    // wire: "result" — typed as Map<String,Object> to match schema {"type":"object"}
    private Map<String, Object> result;

    // wire: "duration_ns" — Long so it can be null on enter events
    private Long durationNs;

    private ErrorInfo error;

    // --- constructors ---

    public TraceEvent() {}

    // --- accessors ---

    public double getTs()                              { return ts; }
    public void   setTs(double ts)                     { this.ts = ts; }

    public String getTraceId()                         { return traceId; }
    public void   setTraceId(String traceId)           { this.traceId = traceId; }

    public String getSpanId()                          { return spanId; }
    public void   setSpanId(String spanId)             { this.spanId = spanId; }

    public String getParentId()                        { return parentId; }
    public void   setParentId(String parentId)         { this.parentId = parentId; }

    public String getEvent()                           { return event; }
    public void   setEvent(String event)               { this.event = event; }

    public String getThread()                          { return thread; }
    public void   setThread(String thread)             { this.thread = thread; }

    public String getLang()                            { return lang; }
    public void   setLang(String lang)                 { this.lang = lang; }

    public String getModule()                          { return module; }
    public void   setModule(String module)             { this.module = module; }

    public String getClassName()                       { return className; }
    public void   setClassName(String className)       { this.className = className; }

    public String getMethod()                          { return method; }
    public void   setMethod(String method)             { this.method = method; }

    public String getVisibility()                      { return visibility; }
    public void   setVisibility(String visibility)     { this.visibility = visibility; }

    public Map<String, Object> getArgs()               { return args; }
    public void setArgs(Map<String, Object> args)      { this.args = args; }

    public int  getDepth()                             { return depth; }
    public void setDepth(int depth)                    { this.depth = depth; }

    public Map<String, Object> getResult()                          { return result; }
    public void                setResult(Map<String, Object> result) { this.result = result; }

    public Long getDurationNs()                        { return durationNs; }
    public void setDurationNs(Long durationNs)         { this.durationNs = durationNs; }

    public ErrorInfo getError()                        { return error; }
    public void      setError(ErrorInfo error)         { this.error = error; }
}
