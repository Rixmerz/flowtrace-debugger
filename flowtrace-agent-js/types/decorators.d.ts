/**
 * FlowTrace TypeScript Decorators
 *
 * Ergonomic decorators for TypeScript classes and methods
 * Requires experimentalDecorators in tsconfig.json
 */

declare module 'flowtrace-agent-js/decorators' {
  /**
   * Decorator options
   */
  export interface DecoratorOptions {
    /**
     * Override class name in logs
     */
    className?: string;

    /**
     * Override method name in logs
     */
    methodName?: string;

    /**
     * Capture function arguments
     * @default true
     */
    captureArgs?: boolean;

    /**
     * Capture return value
     * @default true
     */
    captureResult?: boolean;

    /**
     * Capture exceptions
     * @default true
     */
    captureExceptions?: boolean;

    /**
     * Exclude specific argument indices
     * Useful for sensitive data (passwords, tokens)
     *
     * @example [0, 2] // excludes 1st and 3rd arguments
     */
    excludeArgs?: number[];
  }

  /**
   * Method decorator: Trace method execution
   *
   * @example
   * ```typescript
   * class UserService {
   *   @Trace()
   *   async getUser(id: string): Promise<User> {
   *     // Automatically traced by FlowTrace
   *   }
   *
   *   @Trace({ captureArgs: false })
   *   async login(email: string, password: string): Promise<Token> {
   *     // Password not captured in logs
   *   }
   *
   *   @Trace({ excludeArgs: [1] })
   *   async createUser(data: UserData, token: string): Promise<User> {
   *     // Token (2nd argument) excluded from logs
   *   }
   * }
   * ```
   */
  export function Trace(options?: DecoratorOptions): MethodDecorator;

  /**
   * Class decorator: Trace all methods in a class
   *
   * @example
   * ```typescript
   * @TraceClass()
   * class ProductService {
   *   async getProduct(id: string): Promise<Product> {
   *     // Automatically traced
   *   }
   *
   *   async createProduct(data: ProductData): Promise<Product> {
   *     // Automatically traced
   *   }
   * }
   *
   * @TraceClass({ captureArgs: false })
   * class AuthService {
   *   // All methods traced without capturing arguments
   *   async login(email: string, password: string): Promise<Token> { }
   *   async register(data: UserData): Promise<User> { }
   * }
   * ```
   */
  export function TraceClass(options?: DecoratorOptions): ClassDecorator;

  /**
   * Property decorator: Mark property for exclusion from logs
   *
   * Useful for sensitive class properties that shouldn't be logged
   * when captured as part of method arguments or results.
   *
   * @example
   * ```typescript
   * class UserCredentials {
   *   email: string;
   *
   *   @ExcludeFromTrace
   *   password: string; // Never logged
   *
   *   @ExcludeFromTrace
   *   apiToken?: string; // Never logged
   * }
   *
   * class AuthService {
   *   @Trace()
   *   async authenticate(credentials: UserCredentials) {
   *     // credentials.email logged, password/apiToken excluded
   *   }
   * }
   * ```
   */
  export function ExcludeFromTrace(
    target: any,
    propertyKey: string | symbol
  ): void;

  /**
   * Parameter decorator: Exclude specific parameter from logging
   *
   * @example
   * ```typescript
   * class PaymentService {
   *   @Trace()
   *   async processPayment(
   *     amount: number,
   *     @ExcludeParam currency: string,
   *     @ExcludeParam cardNumber: string
   *   ): Promise<PaymentResult> {
   *     // Only 'amount' is logged, currency and cardNumber excluded
   *   }
   * }
   * ```
   */
  export function ExcludeParam(
    target: any,
    propertyKey: string | symbol,
    parameterIndex: number
  ): void;

  /**
   * Async method decorator: Specialized for async/Promise-returning methods
   *
   * Automatically handles Promise resolution and rejection.
   *
   * @example
   * ```typescript
   * class DataService {
   *   @TraceAsync()
   *   async fetchData(id: string): Promise<Data> {
   *     // Logs include Promise resolution time
   *   }
   *
   *   @TraceAsync({ methodName: 'getData' })
   *   getData(id: string): Promise<Data> {
   *     // Works with Promise-returning methods too
   *   }
   * }
   * ```
   */
  export function TraceAsync(options?: DecoratorOptions): MethodDecorator;

  /**
   * Conditional tracing decorator
   *
   * Only traces when condition function returns true.
   *
   * @example
   * ```typescript
   * class AnalyticsService {
   *   @TraceIf((args) => args[0] === 'production')
   *   async track(environment: string, event: string) {
   *     // Only traced in production environment
   *   }
   *
   *   @TraceIf(() => process.env.DEBUG === 'true')
   *   debugOperation() {
   *     // Only traced when DEBUG mode is enabled
   *   }
   * }
   * ```
   */
  export function TraceIf(
    condition: (...args: any[]) => boolean,
    options?: DecoratorOptions
  ): MethodDecorator;

  /**
   * React component lifecycle decorator
   *
   * Specialized decorator for React class components.
   * Automatically traces render, componentDidMount, etc.
   *
   * @example
   * ```typescript
   * @TraceReactComponent
   * class UserProfile extends React.Component<Props, State> {
   *   // All lifecycle methods automatically traced
   *   componentDidMount() { }
   *   componentDidUpdate() { }
   *   render() { }
   * }
   * ```
   */
  export function TraceReactComponent(options?: DecoratorOptions): ClassDecorator;

  /**
   * Vue component decorator
   *
   * Specialized decorator for Vue class-style components.
   *
   * @example
   * ```typescript
   * @TraceVueComponent
   * @Component
   * class UserList extends Vue {
   *   // All lifecycle hooks automatically traced
   *   mounted() { }
   *   updated() { }
   * }
   * ```
   */
  export function TraceVueComponent(options?: DecoratorOptions): ClassDecorator;
}

/**
 * Global type augmentation for decorator metadata
 */
declare global {
  namespace FlowTrace {
    /**
     * Metadata stored on decorated classes/methods
     */
    interface DecoratorMetadata {
      className?: string;
      methodName?: string;
      captureArgs: boolean;
      captureResult: boolean;
      captureExceptions: boolean;
      excludeArgs: number[];
    }

    /**
     * Get decorator metadata for a target
     */
    function getMetadata(
      target: any,
      propertyKey?: string | symbol
    ): DecoratorMetadata | undefined;
  }
}

export {};
