package com.example.reentrant;

/** Instrumented class whose toString() the tracer calls while rendering args. */
public class Person {
    private final String name;

    public Person(String name) { this.name = name; }

    public String getName() { return name; }

    @Override
    public String toString() { return "Person[" + getName() + "]"; }
}
