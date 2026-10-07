import type { z } from 'zod';

/** Thrown by {@link parseOrThrow}; carries the Zod issues for logging/inspection. */
export class ContractParseError extends Error {
  override readonly name = 'ContractParseError';
  constructor(
    readonly label: string | undefined,
    readonly issues: z.core.$ZodIssue[],
    cause: unknown,
  ) {
    const detail = issues
      .map((i) => `${i.path.length > 0 ? i.path.join('.') : '(root)'}: ${i.message}`)
      .join('; ');
    super(`${label ? `${label}: ` : ''}response does not match the contract: ${detail}`, {
      cause,
    });
  }
}

/**
 * Parse `data` against `schema`, returning the typed value or throwing a
 * {@link ContractParseError}. `label` (e.g. the endpoint) prefixes the message.
 */
export function parseOrThrow<S extends z.ZodType>(
  schema: S,
  data: unknown,
  label?: string,
): z.output<S> {
  const result = schema.safeParse(data);
  if (!result.success) {
    throw new ContractParseError(label, result.error.issues, result.error);
  }
  return result.data;
}
