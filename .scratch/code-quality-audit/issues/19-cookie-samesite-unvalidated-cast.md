# m-05: COOKIE_SAMESITE cast without runtime validation

**Severity:** Minor  
**Status:** needs-triage  
**Component:** `apps/backend` (NestJS, configuration)

## Problem

`COOKIE_SAMESITE` env var is cast without validation:

```typescript
// config.ts:67–68
sameSite:
  (process.env.COOKIE_SAMESITE as 'lax' | 'strict' | 'none') ?? 'lax',
```

If `COOKIE_SAMESITE` is set to an invalid value (e.g., `'None'` with capital N, a common misconfiguration), the cast bypasses TypeScript's type system, and Express's `res.cookie()` silently ignores the invalid value or throws at runtime.

### Consequences

1. **Silent misconfiguration:** A typo in the env var is not caught at startup.
2. **Type system bypass:** The `as` cast tells TypeScript "I know this is valid," but there's no runtime check.
3. **Unpredictable behavior:** Invalid values either become a server error or silently fall back to a default, depending on Express version.

## Fix

Use explicit validation via `AppConfig` pattern (same as M-6):

```typescript
// config.ts
export interface AppConfig {
  cookie: {
    sameSite: 'lax' | 'strict' | 'none';
  };
}

// loadConfig()
cookie: {
  sameSite: (() => {
    const value = process.env.COOKIE_SAMESITE ?? 'lax';
    if (!['lax', 'strict', 'none'].includes(value)) {
      throw new Error(
        `Invalid COOKIE_SAMESITE: "${value}". Expected one of: lax, strict, none`,
      );
    }
    return value as 'lax' | 'strict' | 'none';
  })(),
}
```

## Files Affected

- `apps/backend/src/config/config.ts:67–68` (remove cast, add validation)
- `apps/backend/src/config/load-config.ts` (validate at boot)

---
