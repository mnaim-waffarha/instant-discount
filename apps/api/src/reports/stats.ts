/** Summary of one group's per-card values (e.g. spend per card). */
export interface Sample {
  n: number;
  mean: number;
  /** Sample variance (n − 1 denominator). */
  variance: number;
}

export interface Comparison {
  /** treated.mean − control.mean */
  diff: number;
  se: number;
  ci95: [number, number];
  z: number;
  pValue: number;
  /** diff ÷ control.mean (null when the control mean is 0). */
  relative: number | null;
  significant: boolean;
}

/** Standard normal CDF (Abramowitz–Stegun 7.1.26 erf approximation, |error| < 1.5e-7). */
export function normalCdf(z: number): number {
  const x = Math.abs(z) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * x);
  const poly =
    t *
    (0.254829592 + t * (-0.284496736 + t * (1.421413741 + t * (-1.453152027 + t * 1.061405429))));
  const erf = 1 - poly * Math.exp(-x * x);
  return z >= 0 ? 0.5 * (1 + erf) : 0.5 * (1 - erf);
}

/**
 * Welch's two-sample test with a normal approximation (fine for the group sizes we require,
 * ≥ 100 cards each). Returns the difference in means with a 95% confidence interval.
 */
export function compare(treated: Sample, control: Sample, alpha = 0.05): Comparison | null {
  if (treated.n < 2 || control.n < 2) return null;
  const diff = treated.mean - control.mean;
  const se = Math.sqrt(treated.variance / treated.n + control.variance / control.n);
  const zCrit = 1.959964;
  if (se === 0) {
    return {
      diff,
      se,
      ci95: [diff, diff],
      z: diff === 0 ? 0 : Infinity,
      pValue: diff === 0 ? 1 : 0,
      relative: control.mean ? diff / control.mean : null,
      significant: diff !== 0,
    };
  }
  const z = diff / se;
  const pValue = 2 * (1 - normalCdf(Math.abs(z)));
  return {
    diff,
    se,
    ci95: [diff - zCrit * se, diff + zCrit * se],
    z,
    pValue,
    relative: control.mean ? diff / control.mean : null,
    significant: pValue < alpha,
  };
}
