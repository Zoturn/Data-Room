---
paths:
  - "apps/api/src/**/*.module.ts"
  - "apps/api/src/**/*.controller.ts"
  - "apps/api/src/**/*.service.ts"
  - "apps/api/src/**/*.repository.ts"
  - "apps/api/src/main.ts"
---

# NestJS architecture

**Scope:** module boundaries and the layering of `apps/api`.

## Rules

1. One module per domain concept: `auth`, `data-room`, `folders`, `files`, `storage`, `sharing`, `search`. A module owns its controllers, services, repositories and DTOs.
2. Three layers, one direction. Controller → service → repository. A controller never touches Prisma; a repository never contains a business rule; a service never reads the HTTP request.
3. Controllers do routing, DTO validation, and mapping the result to a response. Anything longer than a few lines belongs in a service.
4. Repositories own every Prisma call for their aggregate. Nothing outside a repository imports `PrismaService`.
5. Cross-module access goes through the other module's exported service, never through its repository and never through a direct Prisma query into its tables.
6. Constructor injection only, with `readonly` parameters. No service locators, no circular imports resolved with `forwardRef` unless the cycle is genuinely intrinsic — it usually means a missing third module.
7. Guards decide _may this caller proceed_; services decide _what happens_. Do not re-check ownership inside a service that a guard already established, and do not put business rules in a guard.
8. Multi-write operations run inside one transaction, opened by the repository, not stitched together in a service.
9. Register cross-cutting concerns once, globally: the validation pipe, the exception filter, the request-id middleware, the auth guard. Never per-controller.
10. A service method reads as a sentence of domain language — `resolveAccess`, `deleteSubtree`, `setCurrentVersion` — not as `handleRequest` or `process`.
11. Anything that talks to the outside world (storage, OAuth) sits behind an interface in its own module, so tests substitute a fake without a network.

## Examples

```ts
@Controller("folders")
export class FoldersController {
  constructor(private readonly folders: FoldersService) {}

  @Get(":id/children")
  async children(
    @Param("id") id: string,
    @Query() query: ListChildrenQueryDto,
    @CurrentUser() user: AuthUser,
  ): Promise<PageDto<NodeDto>> {
    return this.folders.listChildren(id, user, query);
  }
}
```

```ts
// storage boundary — one interface, two implementations
export abstract class StorageService {
  abstract createUploadUrl(key: string, opts: UploadUrlOptions): Promise<SignedUpload>;
  abstract deleteObject(key: string): Promise<void>;
}
```

## Anti-patterns

- `prisma.node.findMany(...)` inside a controller or a service.
- A `common` or `shared` module that accumulates unrelated helpers.
- Business logic in a guard, or an ownership check duplicated in three services.
- `forwardRef` used to paper over a layering mistake.
- A service method whose name describes the transport rather than the domain.
