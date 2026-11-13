/**
 * Lexicographic ordering of tuples, element by element. Strings compare by UTF-16 code unit,
 * never by locale, so the order is the same on every machine.
 */
export function compareTuples(a: readonly (string | number)[], b: readonly (string | number)[]): number {
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    const x = a[i] as string | number;
    const y = b[i] as string | number;
    if (x < y) return -1;
    if (x > y) return 1;
  }
  return a.length - b.length;
}
