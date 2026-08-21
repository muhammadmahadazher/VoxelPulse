/** Lightweight fuzzy matcher (subsequence match with contiguity + prefix
 *  scoring). Returns null when there is no match. */
export interface FuzzyResult {
  score: number;
  /** character indices in `text` that matched the query (for highlighting) */
  indices: number[];
}

export function fuzzyMatch(query: string, text: string): FuzzyResult | null {
  const q = query.toLowerCase();
  const t = text.toLowerCase();
  if (!q) return { score: 0, indices: [] };
  let qi = 0;
  let score = 0;
  let run = 0;
  const indices: number[] = [];
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) {
      indices.push(ti);
      run++;
      score += 1 + run * 0.5;               // contiguous runs score higher
      if (ti === 0) score += 5;             // prefix bonus
      if (ti > 0 && /[\s/_.-]/.test(t[ti - 1] ?? "")) score += 3; // word-start bonus
      qi++;
    } else {
      run = 0;
    }
  }
  if (qi < q.length) return null;
  return { score: score / Math.sqrt(q.length), indices };
}

export function fuzzyRank<T>(query: string, items: T[], key: (item: T) => string): { item: T; result: FuzzyResult }[] {
  return items
    .map((item) => {
      const result = fuzzyMatch(query, key(item));
      return result ? { item, result } : null;
    })
    .filter((x): x is { item: T; result: FuzzyResult } => x !== null)
    .sort((a, b) => b.result.score - a.result.score);
}
