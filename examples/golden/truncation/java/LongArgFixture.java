/**
 * Truncation golden fixture — Java.
 * Calls a method with a 1000-char string argument.
 * When run with flowtrace.max-arg-length=64, the arg must appear truncated in JSONL.
 */
public class LongArgFixture {

    public static String process(String data) {
        return "processed:" + data.length();
    }

    public static void main(String[] args) {
        // 1000-char string argument.
        String longArg = "x".repeat(1000);
        String result = process(longArg);
        System.out.println("result=" + result);
    }
}
