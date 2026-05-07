package io.flowtrace.agent.annotation;

import java.lang.annotation.ElementType;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;

/**
 * Anotación para marcar métodos o clases que deben ser instrumentados por FlowTrace.
 *
 * Cuando se aplica a nivel de clase, todos los métodos de esa clase serán instrumentados.
 * Cuando se aplica a nivel de método, solo ese método específico será instrumentado.
 *
 * Ejemplo de uso:
 * <pre>
 * {@code
 * @FlowTrace
 * public class UserService {
 *     public void loadUser(int id) {
 *         // Este método será instrumentado
 *     }
 * }
 *
 * public class OrderService {
 *     @FlowTrace
 *     public Order processOrder(Order order) {
 *         // Solo este método será instrumentado
 *     }
 *
 *     public void cancelOrder(int orderId) {
 *         // Este método NO será instrumentado
 *     }
 * }
 * }
 * </pre>
 */
@Retention(RetentionPolicy.RUNTIME)
@Target({ElementType.TYPE, ElementType.METHOD})
public @interface FlowTrace {
    /**
     * Descripción opcional del método/clase para facilitar análisis.
     */
    String value() default "";

    /**
     * Si es false, desactiva el tracing incluso si la clase padre tiene @FlowTrace.
     */
    boolean enabled() default true;
}
