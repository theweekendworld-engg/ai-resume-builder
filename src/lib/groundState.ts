/**
 * Client-safe mirror of the Prisma `GroundState` enum. Importing enum *values*
 * from `@prisma/client` into a client bundle pulls server-only code, so client
 * components use these plain string constants instead. Values are identical to
 * the Prisma enum members, so they interoperate structurally.
 */
export const GROUND_STATE = {
  grounded: 'grounded',
  needs_confirmation: 'needs_confirmation',
  unsupported: 'unsupported',
} as const;

export type GroundStateValue = (typeof GROUND_STATE)[keyof typeof GROUND_STATE];
