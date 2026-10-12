/**
 * Escapes the LIKE/ILIKE wildcards (% and _) and the escape char itself, so a
 * user-typed value matches literally: ilike('name', escapeLike(input)) is an exact,
 * case-insensitive comparison instead of a pattern ("Dieg%" no longer matches "Diego").
 */
export function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, ch => `\\${ch}`)
}
