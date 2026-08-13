/**
 * Error-path golden fixture — Java.
 *
 * Two traced frames deep so the fixture asserts more than "a throw is
 * recorded": inner() raises, outer() does not catch, so BOTH exit events must
 * carry the error. An agent that only tagged the frame where the throw
 * originated would still pass a single-frame fixture.
 *
 * main() catches, so the process exits 0 and its own exit event records a
 * normal void return — giving the fixture a successful exit and two failed
 * ones in a single trace.
 */
public class ErrorFixture {

    public static int inner(int n) {
        throw new IllegalStateException("inner refused " + n);
    }

    public static int outer(int n) {
        return inner(n);
    }

    public static void main(String[] args) {
        try {
            outer(7);
        } catch (IllegalStateException e) {
            System.out.println("caught: " + e.getMessage());
        }
    }
}
