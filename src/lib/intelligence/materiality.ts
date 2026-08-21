// ---------------------------------------------------------------------------
// "What Changed?" materiality ranking (M8 §30-31).
//
// A 0.5 percentage-point inflation move and a 0.5% GSE-CI move are not
// equally material — they're different units on different scales. Rather
// than inventing a cross-metric "materiality score" (which M8 §31 warns
// against when it becomes arbitrary), this ranks each candidate by how
// many multiples of ITS OWN documented noise band (the same bands the
// dimension evaluators already use — inflation.ts/fx.ts/rates.ts/
// equities.ts) its actual change represents. A metric that moved 3x its
// own noise floor is treated as more newsworthy than one that moved 1x
// its own noise floor, regardless of what unit either is measured in —
// genuinely comparable without pretending the units are the same thing.
// ---------------------------------------------------------------------------

export interface MaterialityCandidate {
  key: string;
  /** Absolute change in the metric's own native unit (pp, %, bps-as-percentage-points, etc). */
  absChange: number;
  /** That metric's own documented noise band, same unit as absChange. */
  noiseBand: number;
}

/**
 * Orders candidate keys by normalized magnitude (absChange / noiseBand),
 * descending — most-multiples-of-noise first. Ties broken by the order
 * candidates were given, so ranking is fully deterministic. A candidate
 * with noiseBand <= 0 is treated as maximally material (can't normalize
 * against a zero/negative band) rather than causing a division error.
 */
export function rankByMateriality(candidates: MaterialityCandidate[]): string[] {
  return candidates
    .map((c, index) => ({ key: c.key, index, normalized: c.noiseBand > 0 ? c.absChange / c.noiseBand : Number.POSITIVE_INFINITY }))
    .sort((a, b) => b.normalized - a.normalized || a.index - b.index)
    .map((c) => c.key);
}
