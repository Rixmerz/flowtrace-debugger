package io.flowtrace.example;

import io.flowtrace.agent.annotation.FlowTrace;

/**
 * Servicio de ejemplo SIN anotación a nivel de clase.
 * Solo los métodos específicamente anotados serán instrumentados (en modo annotation-only).
 */
public class OrderService {

    /**
     * Este método SERÁ instrumentado porque tiene @FlowTrace.
     */
    @FlowTrace("Process order - Critical operation")
    public Order processOrder(int orderId, double amount) {
        System.out.println("Processing order " + orderId);

        // Validar monto
        validateAmount(amount);

        // Simular procesamiento
        sleep(100);

        return new Order(orderId, amount, "COMPLETED");
    }

    /**
     * Este método NO será instrumentado en modo annotation-only
     * (pero SÍ en modo full).
     */
    public void cancelOrder(int orderId) {
        System.out.println("Cancelling order " + orderId);
        sleep(30);
    }

    /**
     * Este método tiene @FlowTrace(enabled=false), por lo que NUNCA será instrumentado.
     */
    @FlowTrace(enabled = false)
    public void internalAudit(int orderId) {
        System.out.println("Internal audit for order " + orderId);
        // Método sensible que no queremos trazar
    }

    /**
     * Método privado de validación.
     * En modo full: instrumentado
     * En modo annotation: NO instrumentado (no tiene @FlowTrace)
     */
    private void validateAmount(double amount) {
        if (amount <= 0) {
            throw new IllegalArgumentException("Invalid amount: " + amount);
        }
    }

    private void sleep(long millis) {
        try {
            Thread.sleep(millis);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        }
    }

    /**
     * Clase interna Order.
     */
    public static class Order {
        private final int id;
        private final double amount;
        private final String status;

        public Order(int id, double amount, String status) {
            this.id = id;
            this.amount = amount;
            this.status = status;
        }

        public int getId() { return id; }
        public double getAmount() { return amount; }
        public String getStatus() { return status; }

        @Override
        public String toString() {
            return "Order{id=" + id + ", amount=" + amount + ", status='" + status + "'}";
        }
    }
}
