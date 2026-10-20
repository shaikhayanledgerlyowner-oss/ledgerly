// src/lib/pivot.ts
import { formatCurrency, formatCurrencyPDF } from "@/lib/currency";

export type Agg = "sum" | "average" | "count" | "min" | "max";

export interface ValueSpec { col: string; agg: Agg }

export interface PivotConfig {
  rowCols: string[];          // Rows — ek ya zyada (nested grouping)
  colCols: string[];          // Columns — ek ya zyada (optional)
  values: ValueSpec[];        // Values — ek ya zyada, har ek ka apna Sum/Average/...
  filterCol?: string;         // Filter column (optional)
  filterVals?: string[];      // Filter ki ek ya zyada values
  sort?: "none" | "asc" | "desc";
  currency?: boolean;
}

export interface SeriesInfo { key: string; label: string; agg: Agg }
export interface PivotRow { label: string; values: Record<string, number | null>; total: number | null }
export interface PivotResult {
  series: SeriesInfo[];
  rows: PivotRow[];
  grand: Record<string, number | null>;
  grandTotal: number | null;
  hasTotal: boolean;          // Total column tab hota hai jab Columns set ho aur Value sirf ek ho
}

export const AGG_LABELS: Record<Agg, string> = {
  sum: "Sum", average: "Average", count: "Count", min: "Min", max: "Max",
};

export const parseNum = (v: any): number | null => {
  if (v == null) return null;
  const s = String(v).replace(/[₹$€£,\s]/g, "").trim();
  if (s === "") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
};

const clean = (v: any) => (v == null ? "" : String(v).trim());

// Purani (single-field) saved analyses ko bhi naye format me badal deta hai
export function normalizeConfig(c: any): PivotConfig {
  const rowCols: string[] = c?.rowCols?.length ? c.rowCols : c?.rowCol ? [c.rowCol] : [];
  const colCols: string[] = c?.colCols?.length ? c.colCols : c?.colCol ? [c.colCol] : [];
  const values: ValueSpec[] = c?.values?.length ? c.values
    : c?.valueCol ? [{ col: c.valueCol, agg: (c.agg ?? "sum") as Agg }] : [];
  const filterVals: string[] = c?.filterVals?.length ? c.filterVals : c?.filterVal ? [c.filterVal] : [];
  return {
    rowCols, colCols, values,
    filterCol: c?.filterCol || undefined,
    filterVals,
    sort: c?.sort ?? "none",
    currency: !!c?.currency,
  };
}

// "NO", "Sr No", "S.No", "ID" jaise serial-number columns — inka sum/average kaam ka nahi hota
const SERIAL_NAME = /^(no\.?|sr\.?\s?no\.?|sl\.?\s?no\.?|s\.?\s?no\.?|sno|serial(\s?no\.?)?|id|#)$/i;
export function isSerialColumn(name: string, rows: Record<string, any>[]): boolean {
  if (SERIAL_NAME.test(name.trim())) return true;
  const nums = rows.map(r => parseNum(r?.[name])).filter((x): x is number => x !== null);
  if (nums.length < 3) return false;
  return nums.every((x, i) => i === 0 || x === nums[i - 1] + 1);   // 1,2,3,4...
}

export function distinctValues(rows: Record<string, any>[], col: string, limit = 200): string[] {
  const s = new Set<string>();
  for (const r of rows) {
    const v = clean(r?.[col]);
    if (v) s.add(v);
    if (s.size >= limit) break;
  }
  return [...s];
}

type Cell = { nums: number[]; count: number };
const newCell = (): Cell => ({ nums: [], count: 0 });
const addTo = (c: Cell, n: number | null) => { c.count++; if (n !== null) c.nums.push(n); };

function calc(a: Agg, c?: Cell): number | null {
  if (!c) return null;
  if (a === "count") return c.count;
  if (!c.nums.length) return null;
  const sum = c.nums.reduce((x, y) => x + y, 0);
  if (a === "sum") return sum;
  if (a === "average") return sum / c.nums.length;
  if (a === "min") return c.nums.reduce((x, y) => (y < x ? y : x), c.nums[0]);
  return c.nums.reduce((x, y) => (y > x ? y : x), c.nums[0]);
}

const specLabel = (s: ValueSpec) => `${AGG_LABELS[s.agg]} of ${s.col}`;

export function computePivot(rows: Record<string, any>[], rawCfg: any): PivotResult {
  const cfg = normalizeConfig(rawCfg);
  const specs = cfg.values;
  const hasCols = cfg.colCols.length > 0;
  const single = specs.length === 1;
  const hasTotal = hasCols && single;

  const byRow = new Map<string, Map<string, Cell>>();
  const colTot = new Map<string, Cell>();
  const rowTot = new Map<string, Cell>();
  const grand = newCell();
  const rowOrder: string[] = [];
  const colOrder: string[] = [];
  const fset = new Set(cfg.filterVals ?? []);
  const useFilter = !!cfg.filterCol && fset.size > 0;

  if (cfg.rowCols.length && specs.length) {
    for (const r of rows) {
      if (!r) continue;
      if (useFilter && !fset.has(clean(r[cfg.filterCol!]))) continue;

      const parts = cfg.rowCols.map(c => clean(r[c]));
      // pehla label khaali (AutoSum wali row) ya "Total" ho to chhod do
      if (!parts[0] || /^total$/i.test(parts[0])) continue;
      const rk = parts.filter(Boolean).join(" › ");
      const ckBase = hasCols ? (cfg.colCols.map(c => clean(r[c])).filter(Boolean).join(" › ") || "Other") : "";

      let rowAdded = false;
      for (const sp of specs) {
        const raw = r[sp.col];
        const n = parseNum(raw);
        if (sp.agg === "count" ? clean(raw) === "" : n === null) continue;

        const key = hasCols ? (single ? ckBase : `${ckBase} · ${specLabel(sp)}`) : specLabel(sp);
        const nn = sp.agg === "count" ? null : n;

        if (!byRow.has(rk)) { byRow.set(rk, new Map()); rowOrder.push(rk); }
        if (hasCols && !colOrder.includes(ckBase)) colOrder.push(ckBase);
        const rm = byRow.get(rk)!;
        if (!rm.has(key)) rm.set(key, newCell());
        if (!colTot.has(key)) colTot.set(key, newCell());
        addTo(rm.get(key)!, nn);
        addTo(colTot.get(key)!, nn);
        if (single) {
          if (!rowTot.has(rk)) rowTot.set(rk, newCell());
          addTo(rowTot.get(rk)!, nn);
          addTo(grand, nn);
        }
        rowAdded = true;
      }
      void rowAdded;
    }
  }

  // series (columns of the pivot)
  const series: SeriesInfo[] = [];
  if (!hasCols) {
    specs.forEach(sp => series.push({ key: specLabel(sp), label: specLabel(sp), agg: sp.agg }));
  } else {
    colOrder.forEach(cb => specs.forEach(sp => {
      const k = single ? cb : `${cb} · ${specLabel(sp)}`;
      series.push({ key: k, label: k, agg: sp.agg });
    }));
  }

  let out: PivotRow[] = rowOrder.map(rk => {
    const values: Record<string, number | null> = {};
    series.forEach(s => { values[s.key] = calc(s.agg, byRow.get(rk)?.get(s.key)); });
    return { label: rk, values, total: hasTotal ? calc(specs[0].agg, rowTot.get(rk)) : null };
  });

  if (cfg.sort === "asc" || cfg.sort === "desc") {
    const dir = cfg.sort === "asc" ? 1 : -1;
    const keyOf = (r: PivotRow) => (hasTotal ? r.total : series[0] ? r.values[series[0].key] : null);
    out = [...out].sort((a, b) => {
      const x = keyOf(a), y = keyOf(b);
      if (x == null && y == null) return 0;
      if (x == null) return 1;
      if (y == null) return -1;
      return (x - y) * dir;
    });
  }

  const grandVals: Record<string, number | null> = {};
  series.forEach(s => { grandVals[s.key] = calc(s.agg, colTot.get(s.key)); });

  return {
    series, rows: out, grand: grandVals, hasTotal,
    grandTotal: hasTotal ? calc(specs[0].agg, grand) : null,
  };
}

export function describePivot(rawCfg: any): string {
  const c = normalizeConfig(rawCfg);
  return `${c.values.map(specLabel).join(", ")} by ${c.rowCols.join(" › ")}`
    + (c.colCols.length ? ` × ${c.colCols.join(" › ")}` : "")
    + (c.filterCol && c.filterVals?.length ? ` · ${c.filterCol} = ${c.filterVals.join(", ")}` : "");
}

const fmtWith = (cfgRaw: any, pdf: boolean, cur: string) => {
  const cfg = normalizeConfig(cfgRaw);
  const first = cfg.values[0]?.agg;
  return (v: number | null | undefined, agg?: Agg) => {
    if (v == null || !Number.isFinite(v)) return "–";
    const a = agg ?? first;
    if (a === "count") return v.toLocaleString("en-IN");
    if (cfg.currency) return pdf ? formatCurrencyPDF(v, cur) : formatCurrency(v, cur);
    return Number(v.toFixed(2)).toLocaleString("en-IN");
  };
};
export const makeFormatter = (cfg: any, cur: string) => fmtWith(cfg, false, cur);
export const makePdfFormatter = (cfg: any, cur: string) => fmtWith(cfg, true, cur);

export const totalLabel = (a: Agg) => (a === "sum" || a === "count" ? "Grand Total" : `Overall ${AGG_LABELS[a]}`);
