# m-05: COOKIE_SAMESITE cast without runtime validation

**Severity:** Minor  
**Status:** completed  
**Component:** `apps/backend` (NestJS, configuration)

## Resolution

**Fixed in `apps/backend/src/config/config.ts:44–52`.** The `parseCookieSameSite()` function was implemented with proper allowlist validation:

```typescript
function parseCookieSameSite(raw: string | undefined): 'lax' | 'strict' | 'none' {
  const value = raw ?? 'lax';
  if (!['lax', 'strict', 'none'].includes(value)) {
    throw new Error(
      `Invalid COOKIE_SAMESITE: "${value}". Expected one of: lax, strict, none`,
    );
  }
  return value as 'lax' | 'strict' | 'none';
}
```

Called at `loadConfig()` line 86:
```typescript
sameSite: parseCookieSameSite(process.env.COOKIE_SAMESITE),
```

Invalid env vars now throw a descriptive error at boot, preventing silent misconfiguration.

---
