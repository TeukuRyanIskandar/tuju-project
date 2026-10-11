# C-04: No global ValidationPipe — all @Body() inputs unvalidated

**Severity:** Critical  
**Status:** completed  
**Component:** `apps/backend` (NestJS)

## Problem

NestJS is running without a global `ValidationPipe`, meaning all `@Body()` decorated parameters receive raw objects with no schema validation, type coercion, or sanitization.

```typescript
// main.ts — NO ValidationPipe registered
const app = await NestFactory.create(AppModule);
// Should have: app.useGlobalPipes(new ValidationPipe(...));

// Example: auth.controller.ts:33–53
@Post('login')
async login(
  @Body() body: { userId?: string; tier?: Tier },  // ← raw object, no validation
```

### Consequences

1. **Trust boundary violation:** Any caller can pass unexpected properties (`{ userId: '...', tier: 'pro', adminFlag: true, __proto__: {...} }`).
2. **XSS injection:** String fields like `symbol` in `analysis.controller.ts:46` pass through to business logic without sanitization.
3. **Type confusion:** A `tier` value of `'premium'` (string) vs `Tier.PREMIUM` (enum) is not normalized; enum validation is skipped.
4. **No class-validator DTOs:** The project lists `class-validator` and `class-transformer` in `dependencies` but never uses them.

### Current State

- `package.json` has `class-validator` and `class-transformer` listed
- No `ValidationPipe` instance created
- No DTOs with decorators (e.g., `@IsEnum(Tier)`, `@IsString()`)
- Only the implicit TypeScript type hints exist (which are erased at runtime)

## Fix

1. **Register global ValidationPipe:**
   ```typescript
   app.useGlobalPipes(
     new ValidationPipe({
       whitelist: true,             // strip unknown properties
       forbidNonWhitelisted: true,  // reject unknown properties
       transform: true,             // coerce types (string '123' → number 123)
       transformOptions: { enableImplicitConversion: true },
     })
   );
   ```

2. **Create DTO classes with decorators:**
   ```typescript
   export class LoginRequestDto {
     @IsUUID()
     userId: string;
     
     @IsEnum(Tier)
     tier: Tier;
   }
   ```

3. **Update controllers to use DTOs:**
   ```typescript
   @Post('login')
   async login(@Body() body: LoginRequestDto) { ... }
   ```

## Files Affected

- `apps/backend/src/main.ts` (entry point; add ValidationPipe)
- `apps/backend/src/auth/auth.controller.ts:35` (add LoginRequestDto)
- `apps/backend/src/analysis/analysis.controller.ts:46` (add AnalysisRequestDto)
- Create new file: `apps/backend/src/common/dto/` (shared DTOs)

## Testing Opportunity

Add integration test: `test_validation_pipe_rejects_unknown_properties()` to verify `{ userId: '...', xyz: 'malicious' }` is rejected.

---
