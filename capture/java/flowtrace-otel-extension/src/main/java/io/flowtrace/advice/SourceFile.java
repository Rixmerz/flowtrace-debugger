package io.flowtrace.advice;

import java.lang.annotation.ElementType;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;

/**
 * Advice parameter bound, at weave time, to the instrumented class's source
 * file as a string constant: package path + {@code SourceFile} attribute
 * ({@code com/acme/billing/InvoiceService.java}), or {@code ""} when the class
 * file does not say. See {@code io.flowtrace.extension.SourceLocations}.
 */
@Retention(RetentionPolicy.RUNTIME)
@Target(ElementType.PARAMETER)
public @interface SourceFile {
}
