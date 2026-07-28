/**
 * Shared sentence-building helpers.
 *
 * Several detectors were each hand-rolling "a, b and c" joining for squares,
 * files and piece names. It lives here once so every explanation reads the same
 * way and no detector re-implements English.
 */

/** "d4", "d4 and e4", "d4, e4 and d5" — natural-language list. */
export function joinList(items: readonly string[], conjunction = 'and'): string {
  if (items.length === 0) return '';
  if (items.length === 1) return items[0] as string;
  return `${items.slice(0, -1).join(', ')} ${conjunction} ${items[items.length - 1]}`;
}

/** "the d- and f-files" style list from bare file letters. */
export function joinFiles(files: readonly string[]): string {
  return joinList(files.map((f) => `${f}-file`));
}

/** "3 points" / "1 point". */
export function points(n: number): string {
  const v = Math.abs(n);
  return `${v} point${v === 1 ? '' : 's'}`;
}
