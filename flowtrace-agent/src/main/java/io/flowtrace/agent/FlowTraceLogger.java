package io.flowtrace.agent;

import com.google.gson.Gson;
import com.google.gson.GsonBuilder;
import java.io.File;
import java.io.FileWriter;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;

/**
 * Logger centralizado para FlowTrace que genera logs en formato JSON Lines (JSONL).
 * Cada línea es un objeto JSON válido, facilitando el procesamiento por herramientas de análisis y IA.
 */
public class FlowTraceLogger {
    private static final Gson gson = new GsonBuilder()
        .serializeNulls()
        .create();

    private static final String LOG_FILE = System.getProperty("flowtrace.logfile", "flowtrace.jsonl");
    private static final boolean LOG_TO_STDOUT = Boolean.parseBoolean(System.getProperty("flowtrace.stdout", "false"));
    // Allow disabling truncation by setting to 0 or negative value
    private static final int MAX_ARG_LENGTH = Integer.parseInt(System.getProperty("flowtrace.max-arg-length", "0"));

    // Log segmentation configurations
    private static final int TRUNCATE_THRESHOLD = Integer.parseInt(System.getProperty("flowtrace.truncate-threshold", "1000"));
    private static final String SEGMENT_DIRECTORY = System.getProperty("flowtrace.segment-directory", "flowtrace-jsonsl");
    private static final boolean ENABLE_SEGMENTATION = Boolean.parseBoolean(System.getProperty("flowtrace.enable-segmentation", "true"));
    private static volatile boolean segmentDirCreated = false;

    /**
     * Registra un evento de entrada o salida de método.
     *
     * @param event       Tipo de evento: "ENTER" o "EXIT"
     * @param className   Nombre completo de la clase
     * @param methodName  Nombre del método
     * @param args        Argumentos del método
     * @param result      Valor de retorno (solo en EXIT)
     * @param throwable   Excepción lanzada (solo en EXIT con error)
     * @param duration    Duración en nanosegundos
     */
    public static synchronized void log(String event,
                                        String className,
                                        String methodName,
                                        Object[] args,
                                        Object result,
                                        Throwable throwable,
                                        long duration) {
        try {
            Map<String, Object> data = new HashMap<>();
            data.put("timestamp", Instant.now().toEpochMilli());
            data.put("event", event);
            data.put("thread", Thread.currentThread().getName());
            data.put("class", className);
            data.put("method", methodName);
            data.put("args", serializeArgs(args));

            if (result != null) {
                data.put("result", serializeObject(result));
            }

            if (throwable != null) {
                Map<String, Object> exceptionData = new HashMap<>();
                exceptionData.put("type", throwable.getClass().getName());
                exceptionData.put("message", throwable.getMessage());
                exceptionData.put("stackTrace", getStackTracePreview(throwable, 3));
                data.put("exception", exceptionData);
            }

            if (duration > 0) {
                data.put("durationMicros", duration / 1000);
                data.put("durationMillis", duration / 1_000_000);
            }

            // Check if we need to segment this log (check both args and result)
            Map<String, Object> dataToWrite = data;
            List<String> fieldsToCheck = Arrays.asList("args", "result");
            List<String> truncatedFields = new ArrayList<>();

            // Check all fields that might need truncation
            for (String field : fieldsToCheck) {
                if (shouldTruncateField(data, field)) {
                    truncatedFields.add(field);
                }
            }

            // If any field needs truncation, handle segmentation
            if (!truncatedFields.isEmpty()) {
                // Write full log to separate file
                String filename = writeSegmentedLog(data, (Long) data.get("timestamp"), event);

                if (filename != null) {
                    // Create truncated version for main log
                    dataToWrite = new HashMap<>(data);
                    Map<String, Object> truncatedFieldsMetadata = new HashMap<>();

                    // Truncate all fields that exceed threshold
                    for (String field : truncatedFields) {
                        Map<String, Object> truncationInfo = truncateField(data, field);
                        dataToWrite.put(field, truncationInfo.get("truncated"));

                        // Add metadata about truncation
                        Map<String, Object> fieldMetadata = new HashMap<>();
                        fieldMetadata.put("originalLength", truncationInfo.get("originalLength"));
                        fieldMetadata.put("threshold", TRUNCATE_THRESHOLD);
                        truncatedFieldsMetadata.put(field, fieldMetadata);
                    }

                    dataToWrite.put("truncatedFields", truncatedFieldsMetadata);
                    dataToWrite.put("fullLogFile", SEGMENT_DIRECTORY + "/" + filename);
                }
            }

            String jsonLine = gson.toJson(dataToWrite);

            // Escribir a archivo
            try (FileWriter fw = new FileWriter(LOG_FILE, true)) {
                fw.write(jsonLine + "\n");
            }

            // Opcionalmente escribir a stdout
            if (LOG_TO_STDOUT) {
                System.out.println("[FlowTrace] " + jsonLine);
            }

        } catch (IOException e) {
            System.err.println("[FlowTrace] Error writing log: " + e.getMessage());
        } catch (Exception e) {
            System.err.println("[FlowTrace] Unexpected error: " + e.getMessage());
        }
    }

    /**
     * Serializa los argumentos del método de forma segura.
     */
    private static String serializeArgs(Object[] args) {
        if (args == null || args.length == 0) {
            return "[]";
        }

        return Arrays.stream(args)
            .map(FlowTraceLogger::serializeObject)
            .collect(Collectors.joining(", ", "[", "]"));
    }

    /**
     * Serializa un objeto de forma segura, con truncamiento opcional.
     */
    private static String serializeObject(Object obj) {
        if (obj == null) {
            return "null";
        }

        try {
            String str;
            if (obj instanceof String) {
                str = "\"" + obj + "\"";
            } else if (obj.getClass().isPrimitive() ||
                       obj instanceof Number ||
                       obj instanceof Boolean) {
                str = obj.toString();
            } else {
                // Para objetos complejos, intentar serializar a JSON completo
                try {
                    str = gson.toJson(obj);
                } catch (Exception jsonError) {
                    // Si falla la serialización JSON, usar toString()
                    str = obj.toString();
                }
            }

            // Truncar solo si MAX_ARG_LENGTH > 0
            if (MAX_ARG_LENGTH > 0 && str.length() > MAX_ARG_LENGTH) {
                return str.substring(0, MAX_ARG_LENGTH) + "...[truncated]";
            }
            return str;
        } catch (Exception e) {
            return "<error-serializing:" + obj.getClass().getSimpleName() + ">";
        }
    }

    /**
     * Obtiene un preview del stack trace limitado a N frames.
     */
    private static String getStackTracePreview(Throwable throwable, int maxFrames) {
        StackTraceElement[] elements = throwable.getStackTrace();
        int limit = Math.min(maxFrames, elements.length);

        return Arrays.stream(elements)
            .limit(limit)
            .map(StackTraceElement::toString)
            .collect(Collectors.joining(" > "));
    }

    /**
     * Ensure segment directory exists
     */
    private static void ensureSegmentDirectory() {
        if (segmentDirCreated) return;

        try {
            Path dirPath = Paths.get(SEGMENT_DIRECTORY);
            if (!Files.exists(dirPath)) {
                Files.createDirectories(dirPath);
            }
            segmentDirCreated = true;
        } catch (IOException e) {
            System.err.println("[FlowTrace] Failed to create segment directory: " + e.getMessage());
        }
    }

    /**
     * Write full log to separate file
     */
    private static String writeSegmentedLog(Map<String, Object> data, long timestamp, String eventType) {
        try {
            ensureSegmentDirectory();

            String filename = String.format("flowtrace-%d-%s.json", timestamp, eventType);
            Path filepath = Paths.get(SEGMENT_DIRECTORY, filename);

            Gson prettyGson = new GsonBuilder().setPrettyPrinting().serializeNulls().create();
            String prettyJson = prettyGson.toJson(data);

            Files.write(filepath, prettyJson.getBytes());

            return filename;
        } catch (IOException e) {
            System.err.println("[FlowTrace] Failed to write segmented log: " + e.getMessage());
            return null;
        }
    }

    /**
     * Check if a specific field needs truncation
     * @param data The log data map
     * @param field The field name to check ('args' or 'result')
     * @return true if field needs truncation
     */
    private static boolean shouldTruncateField(Map<String, Object> data, String field) {
        if (!ENABLE_SEGMENTATION) return false;
        if (!data.containsKey(field)) return false;

        Object fieldValue = data.get(field);
        if (fieldValue == null) return false;

        String fieldStr = fieldValue instanceof String
            ? (String) fieldValue
            : gson.toJson(fieldValue);

        return fieldStr.length() > TRUNCATE_THRESHOLD;
    }

    /**
     * Truncate a specific field
     * @param data The log data map
     * @param field The field to truncate
     * @return Map with truncated value and original length
     */
    private static Map<String, Object> truncateField(Map<String, Object> data, String field) {
        Object fieldValue = data.get(field);
        String fieldStr = fieldValue instanceof String
            ? (String) fieldValue
            : gson.toJson(fieldValue);

        Map<String, Object> truncationInfo = new HashMap<>();
        truncationInfo.put("truncated", fieldStr.substring(0, TRUNCATE_THRESHOLD) + "...(truncated)");
        truncationInfo.put("originalLength", fieldStr.length());

        return truncationInfo;
    }
}
