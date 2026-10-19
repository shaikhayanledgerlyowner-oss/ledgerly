// src/lib/pivot.ts
import { formatCurrency } from "@/lib/currency";

export type Agg = "sum" | "average" | "count" | "min" | "max";

export interface PivotConfig {
  rowCol: string;            // Rows (group by)
  colCol?: string;           // Columns (optional split)
  valueCol: string;          // Values field
  agg: Agg;                  // Summarize by
  filterCol?: string;        // Filter (optional)
  filterVal?: string;
  sort?: "none" | "asc" | "desc";
  currency?: boolean;
}

export interface PivotRow { label: string; values: Record<string, number | null>; total: number | null }
export interface PivotResult {
  series: string[];
  rows: PivotRow[];
  grand: Record<string, number | null>;
  grandTotal: number | null;
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

export function computePivot(rows: Record<string, any>[], cfg: PivotConfig): PivotResult {
  const valueName = `${AGG_LABELS[cfg.agg]} of ${cfg.valueCol}`;
  const byRow = new Map<string, Map<string, Cell>>();
  const rowTot = new Map<string, Cell>();
  const colTot = new Map<string, Cell>();
  const grand = newCell();
  const rowOrder: string[] = [];
  const colOrder: string[] = [];
  const useFilter = !!cfg.filterCol && !!cfg.filterVal;

  for (const r of rows) {
    if (!r) continue;
    if (useFilter && clean(r[cfg.filterCol!]) !== cfg.filterVal) continue;
    const rk = clean(r[cfg.rowCol]);
    // khaali label (AutoSum wali row) aur "Total" rows chhod do
    if (!rk || /^total$/i.test(rk)) continue;
    const raw = r[cfg.valueCol];
    const n = parseNum(raw);
    if (cfg.agg === "count" ? clean(raw) === "" : n === null) continue;
    const ck = cfg.colCol ? (clean(r[cfg.colCol]) || "(blank)") : valueName;

    if (!byRow.has(rk)) { byRow.set(rk, new Map()); rowOrder.push(rk); }
    if (!colTot.has(ck)) { colTot.set(ck, newCell()); colOrder.push(ck); }
    if (!rowTot.has(rk)) rowTot.set(rk, newCell());
    const rm = byRow.get(rk)!;
    if (!rm.has(ck)) rm.set(ck, newCell());

    const nn = cfg.agg === "count" ? null : n;
    addTo(rm.get(ck)!, nn); addTo(rowTot.get(rk)!, nn); addTo(colTot.get(ck)!, nn); addTo(grand, nn);
  }

  const series = colOrder.length ? colOrder : [valueName];
  let out: PivotRow[] = rowOrder.map(rk => {
    const values: Record<string, number | null> = {};
    series.forEach(s => { values[s] = calc(cfg.agg, byRow.get(rk)?.get(s)); });
    return { label: rk, values, total: calc(cfg.agg, rowTot.get(rk)) };
  });

  if (cfg.sort === "asc" || cfg.sort === "desc") {
    const dir = cfg.sort === "asc" ? 1 : -1;
    out = [...out].sort((a, b) => {
      if (a.total == null && b.total == null) return 0;
      if (a.total == null) return 1;
      if (b.total == null) return -1;
      return (a.total - b.total) * dir;
    });
  }

  const grandVals: Record<string, number | null> = {};
  series.forEach(s => { grandVals[s] = calc(cfg.agg, colTot.get(s)); });
  return { series, rows: out, grand: grandVals, grandTotal: calc(cfg.agg, grand) };
}

export function describePivot(cfg: PivotConfig): string {
  return `${AGG_LABELS[cfg.agg]} of ${cfg.valueCol} by ${cfg.rowCol}`
    + (cfg.colCol ? ` × ${cfg.colCol}` : "")
    + (cfg.filterCol && cfg.filterVal ? ` · ${cfg.filterCol} = ${cfg.filterVal}` : "");
}

export const makeFormatter = (cfg: PivotConfig, cur: string) => (v: number | null | undefined) => {
  if (v == null || !Number.isFinite(v)) return "–";
  if (cfg.agg === "count") return v.toLocaleString("en-IN");
  if (cfg.currency) return formatCurrency(v, cur);
  return Number(v.toFixed(2)).toLocaleString("en-IN");
};

export const totalLabel = (a: Agg) => (a === "sum" || a === "count" ? "Grand Total" : `Overall ${AGG_LABELS[a]}`);
