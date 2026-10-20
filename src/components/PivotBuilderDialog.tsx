// src/components/PivotBuilderDialog.tsx
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { BarChart3, ChevronDown } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  AGG_LABELS, computePivot, describePivot, distinctValues, makeFormatter, parseNum, totalLabel,
} from "@/lib/pivot";
import type { Agg, PivotConfig, ValueSpec } from "@/lib/pivot";

const NONE = "__none__";
const FIELD_LABEL = "text-[11px] font-semibold uppercase tracking-wide text-muted-foreground";

// ✅ Checkbox wali multi-select list — click karne ke order me select hota hai
function MultiSelect({ label, options, value, onChange, placeholder = "Select…", hint }: {
  label: string; options: string[]; value: string[]; onChange: (v: string[]) => void;
  placeholder?: string; hint?: string;
}) {
  const toggle = (o: string) => onChange(value.includes(o) ? value.filter(x => x !== o) : [...value, o]);
  return (
    <div className="space-y-1">
      <Label className={FIELD_LABEL}>{label}</Label>
      <Popover>
        <PopoverTrigger asChild>
          <button type="button"
            className="flex h-8 w-full items-center justify-between gap-2 rounded-md border bg-background px-2 text-left text-xs">
            <span className={value.length ? "truncate" : "truncate text-muted-foreground"}>
              {value.length ? value.join(", ") : placeholder}
            </span>
            <ChevronDown className="h-3.5 w-3.5 shrink-0 opacity-60" />
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-64 p-1">
          <div className="max-h-60 overflow-auto">
            {options.length === 0 && <p className="px-2 py-3 text-xs text-muted-foreground">Koi option nahi</p>}
            {options.map(o => (
              <label key={o} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-xs hover:bg-muted">
                <input type="checkbox" checked={value.includes(o)} onChange={() => toggle(o)} />
                <span className="truncate">{o}</span>
                {value.includes(o) && value.length > 1 && (
                  <span className="ml-auto text-[10px] text-muted-foreground">#{value.indexOf(o) + 1}</span>
                )}
              </label>
            ))}
          </div>
          {value.length > 0 && (
            <button type="button" onClick={() => onChange([])}
              className="mt-1 w-full rounded border-t px-2 py-1.5 text-left text-[11px] text-muted-foreground hover:bg-muted">
              ✕ Clear all
            </button>
          )}
        </PopoverContent>
      </Popover>
      {hint && <p className="text-[10px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

export default function PivotBuilderDialog({ open, onOpenChange, tableId, tableName, columns, rows }: {
  open: boolean; onOpenChange: (o: boolean) => void;
  tableId: string; tableName: string; columns: string[]; rows: Record<string, any>[];
}) {
  const { profile, userCurrency } = useAuth() as any;
  const navigate = useNavigate();
  const cur = userCurrency || "INR";

  const [name, setName] = useState("");
  const [rowCols, setRowCols] = useState<string[]>([]);
  const [colCols, setColCols] = useState<string[]>([]);
  const [values, setValues] = useState<ValueSpec[]>([]);
  const [filterCol, setFilterCol] = useState(NONE);
  const [filterVals, setFilterVals] = useState<string[]>([]);
  const [sort, setSort] = useState<"none" | "asc" | "desc">("none");
  const [currency, setCurrency] = useState(true);
  const [saving, setSaving] = useState(false);

  const numericCols = useMemo(() => columns.filter(c => {
    const v = rows.map(r => r?.[c]).filter(x => x != null && String(x).trim() !== "");
    return v.length > 0 && v.filter(x => parseNum(x) !== null).length / v.length >= 0.6;
  }), [columns, rows]);

  useEffect(() => {
    if (!open) return;
    const textFirst = columns.find(c => !numericCols.includes(c)) ?? columns[0] ?? "";
    const val = numericCols.find(c => c !== textFirst) ?? numericCols[0] ?? columns[1] ?? columns[0] ?? "";
    setRowCols(textFirst ? [textFirst] : []);
    setColCols([]);
    setValues(val ? [{ col: val, agg: numericCols.includes(val) ? "sum" : "count" }] : []);
    setFilterCol(NONE); setFilterVals([]); setSort("none"); setCurrency(true); setName("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, tableId]);

  const valueCols = values.map(v => v.col);
  const setValueCols = (cols: string[]) =>
    setValues(prev => cols.map(c => prev.find(p => p.col === c) ?? { col: c, agg: numericCols.includes(c) ? "sum" : "count" }));
  const setAgg = (col: string, agg: Agg) => setValues(prev => prev.map(v => (v.col === col ? { ...v, agg } : v)));

  const cfg: PivotConfig = {
    rowCols, colCols, values,
    filterCol: filterCol === NONE ? undefined : filterCol,
    filterVals: filterCol === NONE ? [] : filterVals,
    sort,
    currency: currency && values.some(v => v.agg !== "count"),
  };

  const filterOptions = useMemo(
    () => (filterCol === NONE ? [] : distinctValues(rows, filterCol)),
    [rows, filterCol],
  );
  const ready = rowCols.length > 0 && values.length > 0;
  const res = useMemo(
    () => (ready ? computePivot(rows, cfg) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rows, rowCols, colCols, values, filterCol, filterVals, sort],
  );
  const fmt = makeFormatter(cfg, cur);
  const nonNumeric = values.filter(v => v.agg !== "count" && !numericCols.includes(v.col)).map(v => v.col);

  const save = async () => {
    if (!profile?.id) return;
    if (!res || !res.rows.length) return toast.error("Is selection me koi data nahi hai");
    setSaving(true);
    const { error } = await (supabase as any).from("user_analyses").insert({
      user_id: profile.id, table_id: tableId, name: name.trim() || describePivot(cfg), config: cfg,
    });
    setSaving(false);
    if (error) {
      return toast.error(/user_analyses/.test(error.message)
        ? "Pehle user_analyses.sql Supabase me run karo"
        : error.message);
    }
    toast.success("Analysis saved", {
      action: { label: "Analytics me dekho", onClick: () => navigate("/dashboard/analytics") },
    });
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-5xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <BarChart3 className="h-4 w-4 text-emerald-600" /> Create Analysis — {tableName}
          </DialogTitle>
        </DialogHeader>

        <div className="grid gap-5 md:grid-cols-[320px_1fr]">
          {/* ── PivotTable Fields ── */}
          <div className="space-y-3">
            <div className="space-y-1">
              <Label className={FIELD_LABEL}>Analysis name</Label>
              <Input className="h-8 text-xs" value={name} onChange={e => setName(e.target.value)}
                placeholder={ready ? describePivot(cfg) : "Name"} />
            </div>

            <MultiSelect label="Rows (group by)" options={columns.filter(c => !colCols.includes(c))}
              value={rowCols} onChange={setRowCols} placeholder="Column chuno"
              hint="Ek se zyada chuno to nested group banega (A › B)" />

            <MultiSelect label="Columns (optional)" options={columns.filter(c => !rowCols.includes(c))}
              value={colCols} onChange={setColCols} placeholder="None" />

            <MultiSelect label="Values (fields)" options={columns}
              value={valueCols} onChange={setValueCols} placeholder="Column chuno" />

            {values.length > 0 && (
              <div className="space-y-1.5 rounded-lg border bg-muted/20 p-2">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Summarize each by</p>
                {values.map(v => (
                  <div key={v.col} className="flex items-center gap-2">
                    <span className="min-w-0 flex-1 truncate text-xs font-medium">{v.col}</span>
                    <Select value={v.agg} onValueChange={a => setAgg(v.col, a as Agg)}>
                      <SelectTrigger className="h-7 w-28 text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {(Object.keys(AGG_LABELS) as Agg[]).map(a => (
                          <SelectItem key={a} value={a} className="text-xs">{AGG_LABELS[a]}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                ))}
              </div>
            )}

            <div className="space-y-1">
              <Label className={FIELD_LABEL}>Filter (optional)</Label>
              <Select value={filterCol} onValueChange={v => { setFilterCol(v); setFilterVals([]); }}>
                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE} className="text-xs">No filter</SelectItem>
                  {columns.map(c => <SelectItem key={c} value={c} className="text-xs">{c}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            {filterCol !== NONE && (
              <MultiSelect label="Filter values" options={filterOptions} value={filterVals}
                onChange={setFilterVals} placeholder="All"
                hint="Kuch na chuno to sab values count hongi" />
            )}

            <div className="space-y-1">
              <Label className={FIELD_LABEL}>Sort rows</Label>
              <Select value={sort} onValueChange={v => setSort(v as any)}>
                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none" className="text-xs">As in sheet</SelectItem>
                  <SelectItem value="desc" className="text-xs">Largest first</SelectItem>
                  <SelectItem value="asc" className="text-xs">Smallest first</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {values.some(v => v.agg !== "count") && (
              <label className="flex items-center gap-2 text-xs">
                <input type="checkbox" checked={currency} onChange={e => setCurrency(e.target.checked)} />
                Show as currency ({cur})
              </label>
            )}
          </div>

          {/* ── Live preview ── */}
          <div className="min-w-0 space-y-2">
            <p className="text-xs text-muted-foreground">
              Preview: <span className="font-medium text-foreground">{ready ? describePivot(cfg) : "—"}</span>
            </p>
            {nonNumeric.length > 0 && (
              <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                {nonNumeric.map(c => `"${c}"`).join(", ")} me numbers nahi mile. Sum/Average ke liye number wala column chuno, ya Count use karo.
              </p>
            )}
            <div className="max-h-[460px] overflow-auto rounded-lg border">
              {!res || !res.rows.length ? (
                <p className="px-4 py-12 text-center text-sm text-muted-foreground">
                  {ready ? "Is selection me koi data nahi mila." : "Rows aur Values chuno — yahan preview dikhega."}
                </p>
              ) : (
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-muted/80 backdrop-blur">
                    <tr>
                      <th className="px-3 py-2 text-left text-xs font-semibold">{rowCols.join(" › ")}</th>
                      {res.series.map(s => <th key={s.key} className="px-3 py-2 text-right text-xs font-semibold">{s.label}</th>)}
                      {res.hasTotal && <th className="px-3 py-2 text-right text-xs font-semibold">{totalLabel(values[0].agg)}</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {res.rows.slice(0, 200).map(r => (
                      <tr key={r.label} className="border-t">
                        <td className="px-3 py-1.5 font-medium">{r.label}</td>
                        {res.series.map(s => <td key={s.key} className="px-3 py-1.5 text-right tabular-nums">{fmt(r.values[s.key], s.agg)}</td>)}
                        {res.hasTotal && <td className="px-3 py-1.5 text-right font-semibold tabular-nums">{fmt(r.total, values[0].agg)}</td>}
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="border-t-2 bg-blue-600 text-white">
                      <td className="px-3 py-2 text-xs font-bold">{values.length === 1 ? totalLabel(values[0].agg) : "Grand"}</td>
                      {res.series.map(s => <td key={s.key} className="px-3 py-2 text-right text-xs font-bold tabular-nums">{fmt(res.grand[s.key], s.agg)}</td>)}
                      {res.hasTotal && <td className="px-3 py-2 text-right text-xs font-bold tabular-nums">{fmt(res.grandTotal, values[0].agg)}</td>}
                    </tr>
                  </tfoot>
                </table>
              )}
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-1">
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button size="sm" onClick={save} disabled={saving || !res || !res.rows.length}>
            {saving ? "Saving…" : "Save analysis"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
