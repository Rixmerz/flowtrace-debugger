package io.flowtrace.example;

import io.flowtrace.agent.annotation.FlowTrace;

/**
 * Servicio de ejemplo para demostrar el uso de @FlowTrace.
 * Esta clase tiene la anotación a nivel de clase, por lo que todos sus métodos serán instrumentados.
 */
@FlowTrace("UserService - User management operations")
public class UserService {

    /**
     * Carga un usuario por ID.
     * Este método será instrumentado porque la clase tiene @FlowTrace.
     */
    public User loadUser(int userId) {
        System.out.println("Loading user " + userId);

        // Simular delay de base de datos
        sleep(50);

        // Llamada a método privado
        validateUserId(userId);

        return new User(userId, "User" + userId, "user" + userId + "@example.com");
    }

    /**
     * Guarda un usuario.
     * También será instrumentado por la anotación de clase.
     */
    public void saveUser(User user) {
        System.out.println("Saving user: " + user.getName());

        // Simular delay de base de datos
        sleep(30);

        // Validar antes de guardar
        if (!isValidEmail(user.getEmail())) {
            throw new IllegalArgumentException("Invalid email: " + user.getEmail());
        }
    }

    /**
     * Método privado - también será instrumentado.
     */
    private void validateUserId(int userId) {
        if (userId <= 0) {
            throw new IllegalArgumentException("Invalid user ID: " + userId);
        }
    }

    /**
     * Método privado de validación - también instrumentado.
     */
    private boolean isValidEmail(String email) {
        return email != null && email.contains("@");
    }

    /**
     * Método helper para simular operaciones lentas.
     */
    private void sleep(long millis) {
        try {
            Thread.sleep(millis);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        }
    }

    /**
     * Clase interna User para el ejemplo.
     */
    public static class User {
        private final int id;
        private final String name;
        private final String email;

        public User(int id, String name, String email) {
            this.id = id;
            this.name = name;
            this.email = email;
        }

        public int getId() { return id; }
        public String getName() { return name; }
        public String getEmail() { return email; }

        @Override
        public String toString() {
            return "User{id=" + id + ", name='" + name + "', email='" + email + "'}";
        }
    }
}
