# TypeScript Architecture Patterns

## Clean Architecture
Dependencies point inward: Infrastructure -> Application -> Domain.
```
domain/          -> Entities, Value Objects, Domain Events (no imports from infra)
application/     -> Use cases, DTOs, port interfaces
infrastructure/  -> Adapter implementations (Prisma, HTTP controllers)
main.ts          -> Composition root (DI wiring)
```

## Hexagonal (Ports & Adapters)
```typescript
// PORT (domain interface)
interface NotificationPort { send(userId: string, msg: string): Promise<void>; }
// ADAPTER (infra implementation)
class EmailAdapter implements NotificationPort { async send(u, m) { await sendgrid.send({to: u, body: m}); } }
class SmsAdapter implements NotificationPort { async send(u, m) { await twilio.messages.create({to: u, body: m}); } }
// USE CASE (depends only on port)
class NotifyUser { constructor(private notifications: NotificationPort) {} }
```

## Vertical Slice Architecture
Organize by feature, not by layer. Each slice is self-contained:
```
features/create-user/  -> command, handler, controller, validator, test
features/get-user/     -> query, handler, controller, test
features/place-order/  -> command, handler, controller, validator, test
```
Combines naturally with CQRS — each command/query is a natural slice boundary.

## CQRS with NestJS
```typescript
@CommandHandler(CreateUserCommand)
class CreateUserHandler implements ICommandHandler<CreateUserCommand> {
  constructor(private repo: UserRepository) {}
  async execute(cmd: CreateUserCommand) { /* write model */ }
}
@QueryHandler(GetUserQuery)
class GetUserHandler implements IQueryHandler<GetUserQuery> {
  constructor(private readRepo: UserReadRepository) {}
  async execute(q: GetUserQuery): Promise<UserDto> { /* read model */ }
}
```
Write and read models can use different databases/schemas.

## Event Sourcing: Decider pattern
```typescript
type Decider<S, E, C> = {
  initialState: S;
  evolve: (state: S, event: E) => S;     // Rebuild state from events
  decide: (state: S, command: C) => E[];  // Decide new events
};
```
Use with EventStoreDB (`@eventstore/db-client`).

## Modular Monolith (NestJS + Nx)
Each NestJS module = bounded context. Nx `enforce-module-boundaries` prevents cross-imports:
```json
{ "depConstraints": [
  { "sourceTag": "scope:orders", "onlyDependOnLibsWithTags": ["scope:orders", "scope:shared"] }
]}
```

## DDD with TypeScript
- **Value Objects**: Immutable classes with factory methods or branded types
- **Entities**: Identity-based, not value-based
- **Aggregates**: Root entities with domain events (`apply()` + `commit()`)

## BFF with tRPC
Frontend calls backend functions as if local, with full autocompletion:
```typescript
// Server
const appRouter = router({ getUser: publicProcedure.input(z.string()).query(({ input }) => db.user.findUnique({ where: { id: input } })) });
// Client
const user = trpc.getUser.useQuery("user-123"); // Fully typed
```
Alternatives: ts-rest (REST principles), oRPC (emerging), Elysia Eden (Bun).
