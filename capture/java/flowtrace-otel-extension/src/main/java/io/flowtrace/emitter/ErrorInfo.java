package io.flowtrace.emitter;

import java.util.List;

/**
 * Serializable error payload attached to exit-type TraceEvents when the
 * instrumented method threw an exception.
 */
public class ErrorInfo {

    private String type;
    private String msg;
    private List<String> stack;

    public ErrorInfo() {}

    public ErrorInfo(String type, String msg, List<String> stack) {
        this.type  = type;
        this.msg   = msg;
        this.stack = stack;
    }

    // --- accessors ---

    public String getType()             { return type;  }
    public void   setType(String type)  { this.type = type; }

    public String getMsg()              { return msg;   }
    public void   setMsg(String msg)    { this.msg = msg; }

    public List<String> getStack()                   { return stack; }
    public void         setStack(List<String> stack) { this.stack = stack; }
}
