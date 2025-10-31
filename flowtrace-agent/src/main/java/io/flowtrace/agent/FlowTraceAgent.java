package io.flowtrace.agent;

import net.bytebuddy.agent.builder.AgentBuilder;
import net.bytebuddy.asm.Advice;
import java.lang.instrument.Instrumentation;

import static net.bytebuddy.matcher.ElementMatchers.*;

public class FlowTraceAgent {
    public static void premain(String agentArgs, Instrumentation inst) {
        System.out.println("[FlowTrace] Starting agent...");

        // Read package prefix filter from system property
        String packagePrefix = System.getProperty("flowtrace.package-prefix");
        if (packagePrefix != null && !packagePrefix.isEmpty()) {
            System.out.println("[FlowTrace] Package filter: " + packagePrefix + ".*");
        } else {
            System.out.println("[FlowTrace] No package filter (all classes will be instrumented)");
        }

        AgentBuilder agentBuilder = new AgentBuilder.Default()
            .ignore(
                nameStartsWith("java.")
                    .or(nameStartsWith("javax."))
                    .or(nameStartsWith("jdk."))
                    .or(nameStartsWith("sun."))
                    .or(nameStartsWith("org.slf4j."))
                    .or(nameStartsWith("ch.qos.logback."))
                    .or(nameStartsWith("org.apache.logging.log4j."))
                    .or(nameStartsWith("org.apache.log4j."))
                    .or(nameStartsWith("net.bytebuddy."))
                    .or(nameStartsWith("com.google.gson."))
                    .or(nameStartsWith("io.flowtrace.agent."))
                    // Spring Framework exclusions
                    .or(nameStartsWith("org.springframework.boot.loader."))
                    .or(nameStartsWith("org.springframework.boot.context."))
                    .or(nameStartsWith("org.springframework.core."))
                    .or(nameStartsWith("org.springframework.beans."))
                    .or(nameStartsWith("org.springframework.context."))
                    .or(nameStartsWith("org.springframework.cglib."))
                    .or(nameStartsWith("org.springframework.aop."))
                    .or(nameStartsWith("org.springframework.web.servlet."))
                    .or(nameStartsWith("org.springframework.boot.autoconfigure."))
                    // Jackson exclusions
                    .or(nameStartsWith("com.fasterxml.jackson."))
                    // Other common frameworks
                    .or(nameStartsWith("com.lmax.disruptor."))
                    .or(nameStartsWith("org.apache.commons.logging."))
                    .or(nameContains("Test"))
            );

        // Apply package prefix filter if specified
        if (packagePrefix != null && !packagePrefix.isEmpty()) {
            agentBuilder = agentBuilder
                .type(nameStartsWith(packagePrefix))
                .transform((builder, typeDescription, classLoader, module, protectionDomain) ->
                    builder.visit(Advice.to(FlowTraceAdvice.class).on(isMethod()))
                );
        } else {
            agentBuilder = agentBuilder
                .type(any())
                .transform((builder, typeDescription, classLoader, module, protectionDomain) ->
                    builder.visit(Advice.to(FlowTraceAdvice.class).on(isMethod()))
                );
        }

        agentBuilder.installOn(inst);

        System.out.println("[FlowTrace] Agent installed successfully");
    }
}
