package io.flowtrace.agent;

import net.bytebuddy.asm.Advice;

/**
 * Clase de advice de ByteBuddy que se inyecta en los métodos instrumentados.
 * Captura eventos de entrada y salida de métodos, incluyendo argumentos, retornos y excepciones.
 */
public class FlowTraceAdvice {

    /**
     * Se ejecuta al ENTRAR a un método instrumentado.
     *
     * @param className  Nombre completo de la clase
     * @param methodName Nombre del método
     * @param args       Argumentos del método
     * @return timestamp de inicio (nanosegundos) para calcular duración
     */
    @Advice.OnMethodEnter
    public static long onEnter(@Advice.Origin("#t") String className,
                               @Advice.Origin("#m") String methodName,
                               @Advice.AllArguments Object[] args) {
        long start = System.nanoTime();
        try {
            FlowTraceLogger.log("ENTER", className, methodName, args, null, null, start);
        } catch (Throwable t) {
            System.err.println("[FlowTrace] Error in onEnter: " + t.getMessage());
            t.printStackTrace();
        }
        return start;
    }

    /**
     * Se ejecuta al SALIR de un método instrumentado (tanto en retorno normal como por excepción).
     *
     * @param className  Nombre completo de la clase
     * @param methodName Nombre del método
     * @param args       Argumentos del método
     * @param start      Timestamp de entrada (desde onEnter)
     * @param result     Valor de retorno (si no hay excepción)
     * @param throwable  Excepción lanzada (si hubo error)
     */
    @Advice.OnMethodExit(onThrowable = Throwable.class)
    public static void onExit(@Advice.Origin("#t") String className,
                              @Advice.Origin("#m") String methodName,
                              @Advice.AllArguments Object[] args,
                              @Advice.Enter long start,
                              @Advice.Return Object result,
                              @Advice.Thrown Throwable throwable) {
        try {
            long duration = System.nanoTime() - start;
            FlowTraceLogger.log("EXIT", className, methodName, args, result, throwable, duration);
        } catch (Throwable t) {
            System.err.println("[FlowTrace] Error in onExit: " + t.getMessage());
            t.printStackTrace();
        }
    }
}
