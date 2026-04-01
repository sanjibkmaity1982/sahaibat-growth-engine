// src/classify.ts
// WHO growth classification functions.
// FIX A: Monthly anchor data (0-60m) in whoTables.ts
// FIX Issue4/5: Math.min/max guard on SD-2/SD-3 thresholds

import {
  WHO_WAZ_FEMALE, WHO_WAZ_MALE,
  WHO_LAZ_FEMALE, WHO_LAZ_MALE,
  WHO_WFH_FEMALE, WHO_WFH_MALE,
} from './whoTables';

export type WHOCategory =
  | 'normal'
  | 'underweight' | 'severely_underweight'
  | 'stunted'     | 'severely_stunted'
  | 'wasted'      | 'severely_wasted'
  | 'overweight';

export interface WHOResult {
  waz: WHOCategory;
  laz: WHOCategory;
  wlz: WHOCategory;
}

// ── Interpolation ─────────────────────────────────────────────────────────────

export function interpolateWHO(
  table: Record<number, number[]>,
  ageMonths: number
): number[] | null {
  if (table[ageMonths]) return table[ageMonths];
  const keys = Object.keys(table).map(Number).sort((a, b) => a - b);
  const lower = keys.filter(k => k <= ageMonths).pop();
  const upper = keys.find(k => k > ageMonths);
  if (lower == null || upper == null) return null;
  const lo = table[lower], hi = table[upper];
  const frac = (ageMonths - lower) / (upper - lower);
  return lo.map((v, i) => v + frac * (hi[i] - v));
}

export function interpolateWFH(
  table: Record<number, number[]>,
  heightCm: number
): number[] | null {
  const rounded = Math.round(heightCm);
  if (table[rounded]) return table[rounded];
  const keys = Object.keys(table).map(Number).sort((a, b) => a - b);
  const lower = keys.filter(k => k <= heightCm).pop();
  const upper = keys.find(k => k > heightCm);
  if (lower == null || upper == null) return null;
  const lo = table[lower], hi = table[upper];
  const frac = (heightCm - lower) / (upper - lower);
  return lo.map((v, i) => v + frac * (hi[i] - v));
}

// ── Classifiers ───────────────────────────────────────────────────────────────

/** Weight-for-Age Z-score classification */
export function classifyWAZ(
  weight: number,
  ageMonths: number,
  isMale: boolean
): WHOCategory {
  const ref = interpolateWHO(isMale ? WHO_WAZ_MALE : WHO_WAZ_FEMALE, ageMonths);
  if (!ref) return 'normal';
  // FIX: Math.min/max guard ensures SD-3 is always the lower threshold
  // regardless of array index ordering across different ages
  const sd3 = Math.min(ref[3], ref[2]);
  const sd2 = Math.max(ref[3], ref[2]);
  if (weight < sd3) return 'severely_underweight';
  if (weight < sd2) return 'underweight';
  return 'normal';
}

/** Length/Height-for-Age Z-score classification */
export function classifyLAZ(
  height: number,
  ageMonths: number,
  isMale: boolean
): WHOCategory {
  const ref = interpolateWHO(isMale ? WHO_LAZ_MALE : WHO_LAZ_FEMALE, ageMonths);
  if (!ref) return 'normal';
  // FIX: same Math.min/max guard
  const sd3 = Math.min(ref[3], ref[2]);
  const sd2 = Math.max(ref[3], ref[2]);
  if (height < sd3) return 'severely_stunted';
  if (height < sd2) return 'stunted';
  return 'normal';
}

/** Weight-for-Height Z-score classification */
export function classifyWLZ(
  weight: number,
  height: number,
  isMale: boolean
): WHOCategory {
  const ref = interpolateWFH(isMale ? WHO_WFH_MALE : WHO_WFH_FEMALE, height);
  if (!ref) return 'normal';
  // ref = [SD-3, SD-2, SD-1, median, SD+1, SD+2, SD+3]
  if (weight < ref[0]) return 'severely_wasted';
  if (weight < ref[1]) return 'wasted';       // FIX A: was 'severely_wasted'
  if (weight > ref[5]) return 'overweight';
  return 'normal';
}

/** Full WHO classification — returns all 3 indicators */
export function computeWHOClassification(
  weightKg: number | null,
  heightCm: number | null,
  ageMonths: number,
  gender: string | undefined
): WHOResult | null {
  if (!weightKg || !heightCm) return null;
  const isMale = gender !== 'female';
  return {
    waz: classifyWAZ(weightKg, ageMonths, isMale),
    laz: classifyLAZ(heightCm, ageMonths, isMale),
    wlz: classifyWLZ(weightKg, heightCm, isMale),
  };
}

// ── MUAC ──────────────────────────────────────────────────────────────────────

/** Mid-upper arm circumference interpretation (WHO thresholds, 6–59 months) */
export function interpretMUAC(
  muac: number,
  ageMonths: number
): 'sam' | 'mam' | 'normal' {
  if (ageMonths < 6) return 'normal';
  if (muac < 11.5) return 'sam';
  if (muac < 12.5) return 'mam';
  return 'normal';
}

// ── Age-aware height plausibility check ───────────────────────────────────────

/** Returns true if height is plausible for the given age in months */
export function isHeightPlausible(heightCm: number, ageMonths: number): boolean {
  const max = ageMonths <= 6  ? 80
    : ageMonths <= 12 ? 90
    : ageMonths <= 24 ? 105
    : ageMonths <= 36 ? 115
    : ageMonths <= 48 ? 120
    : 130;
  const min = ageMonths <= 3 ? 40 : ageMonths <= 12 ? 50 : 55;
  return heightCm >= min && heightCm <= max;
}

// ── Display helpers ───────────────────────────────────────────────────────────

export function whoEmoji(cat: WHOCategory): string {
  if (cat === 'severely_underweight' || cat === 'severely_stunted' || cat === 'severely_wasted') return '🔴';
  if (cat !== 'normal') return '🟡';
  return '🟢';
}

export function whoLabel(cat: WHOCategory, lang: 'id' | 'en' = 'id'): string {
  const labels: Record<WHOCategory, { id: string; en: string }> = {
    normal:               { id: 'Normal',              en: 'Normal' },
    underweight:          { id: 'Berat kurang (BB/U)', en: 'Underweight' },
    severely_underweight: { id: 'Berat sangat kurang', en: 'Severely underweight' },
    stunted:              { id: 'Pendek (TB/U)',       en: 'Stunted' },
    severely_stunted:     { id: 'Sangat pendek',       en: 'Severely stunted' },
    wasted:               { id: 'Kurus (BB/TB)',       en: 'Wasted' },
    severely_wasted:      { id: 'Sangat kurus',        en: 'Severely wasted' },
    overweight:           { id: 'Risiko lebih berat',  en: 'At risk of overweight' },
  };
  return lang === 'id' ? labels[cat].id : labels[cat].en;
}
