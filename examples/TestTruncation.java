/**
 * Test class to verify truncation system for both args and result
 */
public class TestTruncation {

    // Generate large string
    private static String generateLargeString(int size) {
        StringBuilder sb = new StringBuilder(size);
        for (int i = 0; i < size; i++) {
            sb.append('X');
        }
        return sb.toString();
    }

    // Generate large array
    private static String[] generateLargeArray(int itemCount) {
        String[] items = new String[itemCount];
        for (int i = 0; i < itemCount; i++) {
            items[i] = String.format(
                "{\"id\":%d,\"name\":\"Item %d\",\"description\":\"This is a detailed description with lots of text for item %d\",\"metadata\":{\"prop1\":\"value1\",\"prop2\":\"value2\",\"prop3\":\"value3\"}}",
                i, i, i
            );
        }
        return items;
    }

    // Method with large arguments
    public static String processLargeArgs(String[] largeData, String config) {
        System.out.println("Processing large arguments...");
        return "Processed " + largeData.length + " items";
    }

    // Method returning large result
    public static String[] getLargeResult() {
        System.out.println("Generating large result...");
        return generateLargeArray(50); // 50 items
    }

    // Method with both large args AND large result
    public static String[] transformLargeData(String[] inputData) {
        System.out.println("Transforming large data...");
        String[] output = new String[inputData.length];
        for (int i = 0; i < inputData.length; i++) {
            output[i] = inputData[i] + ",\"transformed\":true,\"extra\":\"" + generateLargeString(50) + "\"}";
        }
        return output;
    }

    // Method that throws exception with large message
    public static void throwLargeException() throws Exception {
        throw new Exception("This is a large error message: " + generateLargeString(2000));
    }

    public static void main(String[] args) {
        try {
            System.out.println("\n=== Test 1: Large Arguments ===");
            String[] largeInput = generateLargeArray(30);
            String result1 = processLargeArgs(largeInput, "verbose=true");
            System.out.println(result1);

            System.out.println("\n=== Test 2: Large Result ===");
            String[] largeOutput = getLargeResult();
            System.out.println("Generated " + largeOutput.length + " items");

            System.out.println("\n=== Test 3: Large Args AND Large Result ===");
            String[] transformedData = transformLargeData(largeInput);
            System.out.println("Transformed " + transformedData.length + " items");

            System.out.println("\n=== Test 4: Large Exception ===");
            try {
                throwLargeException();
            } catch (Exception e) {
                System.err.println("Caught error: " + e.getMessage().substring(0, 50) + "...");
            }

            System.out.println("\n=== All Tests Completed ===");
            System.out.println("Check flowtrace.jsonl and flowtrace-jsonsl/ directory for results");

        } catch (Exception e) {
            e.printStackTrace();
        }
    }
}
