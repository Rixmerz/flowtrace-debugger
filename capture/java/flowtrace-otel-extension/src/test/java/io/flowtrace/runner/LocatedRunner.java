package io.flowtrace.runner;

import com.example.location.Located;

/**
 * Entry point for {@code SourceLocationIntegrationTest}. Outside the
 * instrumented prefix {@code com.example.location}, like {@link CalcRunner}.
 */
public class LocatedRunner {
    public static void main(String[] args) {
        Located located = new Located();
        located.describe(7);
        located.describe("seven");
        located.viaNested();
    }
}
