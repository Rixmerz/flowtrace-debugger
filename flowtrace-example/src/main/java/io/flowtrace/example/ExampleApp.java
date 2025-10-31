package io.flowtrace.example;

import io.flowtrace.agent.annotation.FlowTrace;

/**
 * Aplicación de ejemplo para demostrar FlowTrace Agent.
 *
 * Ejecutar con:
 *   ./run.sh full        # Instrumenta TODO excepto JDK/librerías
 *   ./run.sh annotation  # Solo instrumenta métodos con @FlowTrace
 *   ./run.sh package     # Solo instrumenta paquete io.flowtrace.example
 */
@FlowTrace("Main application")
public class ExampleApp {

    public static void main(String[] args) {
        System.out.println("========================================");
        System.out.println("   FlowTrace Example Application");
        System.out.println("========================================\n");

        ExampleApp app = new ExampleApp();
        app.run();
    }

    @FlowTrace("Main execution flow")
    public void run() {
        System.out.println("🚀 Starting example scenarios...\n");

        // Escenario 1: UserService (toda la clase anotada)
        runUserScenario();

        System.out.println("\n" + "=".repeat(50) + "\n");

        // Escenario 2: OrderService (solo algunos métodos anotados)
        runOrderScenario();

        System.out.println("\n" + "=".repeat(50) + "\n");

        // Escenario 3: Manejo de errores
        runErrorScenario();

        System.out.println("\n✅ All scenarios completed");
    }

    /**
     * Demuestra el uso de UserService con @FlowTrace a nivel de clase.
     */
    private void runUserScenario() {
        System.out.println("📝 Scenario 1: UserService (class-level @FlowTrace)");
        System.out.println("All methods will be traced\n");

        UserService userService = new UserService();

        // Cargar usuario - éxito
        UserService.User user = userService.loadUser(42);
        System.out.println("✓ Loaded: " + user);

        // Guardar usuario - éxito
        userService.saveUser(user);
        System.out.println("✓ Saved: " + user.getName());
    }

    /**
     * Demuestra el uso de OrderService con @FlowTrace selectivo.
     */
    private void runOrderScenario() {
        System.out.println("📦 Scenario 2: OrderService (method-level @FlowTrace)");
        System.out.println("Only annotated methods will be traced (in annotation mode)\n");

        OrderService orderService = new OrderService();

        // Procesar orden - tiene @FlowTrace
        OrderService.Order order = orderService.processOrder(101, 99.99);
        System.out.println("✓ Processed: " + order);

        // Cancelar orden - NO tiene @FlowTrace
        orderService.cancelOrder(101);
        System.out.println("✓ Cancelled order 101");

        // Audit interno - tiene @FlowTrace(enabled=false)
        orderService.internalAudit(101);
        System.out.println("✓ Audit completed (not traced)");
    }

    /**
     * Demuestra el manejo de errores y excepciones.
     */
    private void runErrorScenario() {
        System.out.println("⚠️  Scenario 3: Error Handling");
        System.out.println("Testing exception capture\n");

        UserService userService = new UserService();

        // Intentar guardar usuario con email inválido
        try {
            UserService.User invalidUser = new UserService.User(999, "Invalid", "not-an-email");
            userService.saveUser(invalidUser);
        } catch (IllegalArgumentException e) {
            System.out.println("✓ Caught expected error: " + e.getMessage());
        }

        // Intentar cargar usuario con ID inválido
        try {
            userService.loadUser(-1);
        } catch (IllegalArgumentException e) {
            System.out.println("✓ Caught expected error: " + e.getMessage());
        }
    }
}
