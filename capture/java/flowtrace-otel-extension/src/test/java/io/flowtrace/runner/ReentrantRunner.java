package io.flowtrace.runner;

import com.example.reentrant.Person;
import com.example.reentrant.Registry;

/** Entry point for ToStringReentrancyIntegrationTest; outside the instrumented prefix. */
public class ReentrantRunner {
    public static void main(String[] args) {
        new Registry().register(new Person("ada"));
    }
}
