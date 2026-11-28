package io.flowtrace.advice;

import java.lang.annotation.ElementType;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;

/**
 * Advice parameter bound, at weave time, to the first line of the instrumented
 * method's body as an int constant, or {@code 0} when the class file carries
 * no line table for it. See {@code io.flowtrace.extension.SourceLocations}.
 */
@Retention(RetentionPolicy.RUNTIME)
@Target(ElementType.PARAMETER)
public @interface SourceLine {
}
