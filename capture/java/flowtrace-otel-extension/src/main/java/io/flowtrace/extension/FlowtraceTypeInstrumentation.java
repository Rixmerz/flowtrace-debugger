package io.flowtrace.extension;

import io.opentelemetry.javaagent.extension.instrumentation.TypeInstrumentation;
import io.opentelemetry.javaagent.extension.instrumentation.TypeTransformer;
import net.bytebuddy.description.type.TypeDescription;
import net.bytebuddy.matcher.ElementMatcher;

import static net.bytebuddy.matcher.ElementMatchers.*;

/**
 * Matches all non-interface, non-synthetic classes under the configured
 * package prefix and weaves FlowtraceAdvice around all concrete methods
 * (public, protected, package-private, and private).
 *
 * <p>Constructors are excluded for MVP per design §risks.
 * Type initializers (&lt;clinit&gt;) are also excluded — they run once at
 * class-load time and are not safely re-entrant with advice state.
 */
public class FlowtraceTypeInstrumentation implements TypeInstrumentation {

    @Override
    public ElementMatcher<TypeDescription> typeMatcher() {
        String prefix = System.getProperty("flowtrace.package-prefix", "");
        return not(isInterface())
                .and(not(isSynthetic()))
                .and(nameStartsWith(prefix));
    }

    @Override
    public void transform(TypeTransformer transformer) {
        transformer.applyAdviceToMethod(
                isMethod()
                        .and(not(isAbstract()))
                        .and(not(isSynthetic()))
                        .and(not(isTypeInitializer())),
                "io.flowtrace.advice.FlowtraceAdvice"
        );
    }
}
