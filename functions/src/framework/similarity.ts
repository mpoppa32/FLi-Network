// Corsair framework — string similarity utilities
//
// Jaro-Winkler similarity, used by:
//   - framework/personResolver — fuzzy merge candidate generator
//   - sources/usaSpending/orgResolver — fuzzy merge candidate generator
//
// Promoted from the resolvers once both had identical inline copies.
// Pure functions; no I/O. Tested mentally against the standard
// Winkler 1990 reference values (e.g., martha/marhta → 0.961).

/**
 * Standard Jaro similarity.
 *
 * Returns 1.0 for identical strings, 0 for no matching characters
 * within the match window (floor(max(len) / 2) - 1 chars). Between
 * 0 and 1 otherwise.
 */
export function jaroSimilarity(s1: string, s2: string): number {
  if (s1 === s2) return 1.0;
  const len1 = s1.length;
  const len2 = s2.length;
  if (len1 === 0 || len2 === 0) return 0;
  const matchDistance = Math.max(Math.floor(Math.max(len1, len2) / 2) - 1, 0);
  const s1Matches = new Array<boolean>(len1).fill(false);
  const s2Matches = new Array<boolean>(len2).fill(false);
  let matches = 0;
  for (let i = 0; i < len1; i++) {
    const start = Math.max(0, i - matchDistance);
    const end = Math.min(i + matchDistance + 1, len2);
    for (let j = start; j < end; j++) {
      if (s2Matches[j]) continue;
      if (s1[i] !== s2[j]) continue;
      s1Matches[i] = true;
      s2Matches[j] = true;
      matches++;
      break;
    }
  }
  if (matches === 0) return 0;
  let transpositions = 0;
  let k = 0;
  for (let i = 0; i < len1; i++) {
    if (!s1Matches[i]) continue;
    while (!s2Matches[k]) k++;
    if (s1[i] !== s2[k]) transpositions++;
    k++;
  }
  return (
    matches / len1 +
    matches / len2 +
    (matches - transpositions / 2) / matches
  ) / 3;
}

/**
 * Jaro-Winkler similarity.
 *
 * Jaro + a prefix bonus that rewards strings sharing the first few
 * characters. Prefix length capped at 4 per Winkler 1990. Returns
 * 1.0 for identical strings; 0 when Jaro returns 0; in between
 * otherwise.
 *
 * Typical thresholds in this codebase:
 *   0.92 — Person merge candidate emission floor (conservative)
 *   0.92 — Org merge candidate emission floor (with first-word gate
 *           at 0.75 to skip obviously different surnames / names)
 */
export function jaroWinklerSimilarity(s1: string, s2: string): number {
  const j = jaroSimilarity(s1, s2);
  if (j === 0 || j === 1) return j;
  let prefix = 0;
  const maxPrefix = 4;
  const upper = Math.min(s1.length, s2.length, maxPrefix);
  for (let i = 0; i < upper; i++) {
    if (s1[i] === s2[i]) prefix++;
    else break;
  }
  return j + prefix * 0.1 * (1 - j);
}
