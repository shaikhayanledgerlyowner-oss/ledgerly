// src/components/PivotBuilderDialog.tsx
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { BarChart3 } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  AGG_LABELS, computePivot, describePivot, distinctValues, makeFormatter, parseNum, totalLabel,
} from "@/lib/pivot";
import type { Agg, PivotConfig } from "@/lib/pivot";

const NONE = "__none__";

function FieldSelect({ label, value, onChange, options, none }: {
  label: string; value: string; onChange: (v: string) => void; options: string[]; none?: string;
}) {
  return (
    <div className="space-y-1">
      <Label className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</Label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
        <SelectContent>
          {none && <SelectItem value={NONE} className="text-xs">{none}</SelectItem>}
          {options.map(o => <SelectItem key={o} value={o} className="text-xs">{o}</SelectItem>)}
        </SelectContent>
      </Select>
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
  const [rowCol, setRowCol] = useState("");
  const [colCol, setColCol] = useState(NONE);
  const [valueCol, setValueCol] = useState("");
  const [agg, setAgg] = useState<Agg>("sum");
  const [filterCol, setFilterCol] = useState(NONE);
  const [filterVal, setFilterVal] = useState("");
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
    setRowCol(textFirst); setValueCol(val); setColCol(NONE); setAgg("sum");
    setFilterCol(NONE); setFilterVal(""); setSort("none"); setCurrency(true); setName("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, tableId]);

  const cfg: PivotConfig = {
    rowCol, valueCol, agg, sort,
    colCol: colCol === NONE ? undefined : colCol,
    filterCol: filterCol === NONE ? undefined : filterCol,
    filterVal: filterCol === NONE || !filterVal ? undefined : filterVal,
    currency: currency && agg !== "count",
  };

  const filterOptions = useMemo(
    () => (filterCol === NONE ? [] : distinctValues(rows, filterCol)),
    [rows, filterCol],
  );
  const res = useMemo(
    () => (rowCol && valueCol ? computePivot(rows, cfg) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rows, rowCol, valueCol, agg, colCol, filterCol, filterVal, sort],
  );
  const fmt = makeFormatter(cfg, cur);
  const multi = (res?.series.length ?? 0) > 1;
  const nonNumeric = agg !== "count" && valueCol && !numericCols.includes(valueCol);

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
      action: { label: "Analytics me dekho", onClick: () => navigate("/dashboard/analytics?tab=analyses") },
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

        <div className="grid gap-5 md:grid-cols-[300px_1fr]">
          {/* ── PivotTable Fields ── */}
          <div className="space-y-3">
            <div className="space-y-1">
              <Label className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Analysis name</Label>
              <Input className="h-8 text-xs" value={name} onChange={e => setName(e.target.value)}
                placeholder={rowCol && valueCol ? describePivot(cfg) : "Name"} />
            </div>

            <FieldSelect label="Rows (group by)" value={rowCol} onChange={setRowCol} options={columns} />
            <FieldSelect label="Columns (optional)" value={colCol} onChange={setColCol}
              options={columns.filter(c => c !== rowCol)} none="None" />
            <FieldSelect label="Values (field)" value={valueCol} onChange={setValueCol} options={columns} />

            <div className="space-y-1">
              <Label className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Summarize by</Label>
              <Select value={agg} onValueChange={v => setAgg(v as Agg)}>
                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {(Object.keys(AGG_LABELS) as Agg[]).map(a => (
                    <SelectItem key={a} value={a} className="text-xs">{AGG_LABELS[a]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <FieldSelect label="Filter (optional)" value={filterCol}
              onChange={v => { setFilterCol(v); setFilterVal(""); }} options={columns} none="No filter" />
            {filterCol !== NONE && (
              <FieldSelect label="Filter value" value={filterVal || NONE}
                onChange={v => setFilterVal(v === NONE ? "" : v)} options={filterOptions} none="All" />
            )}

            <div className="space-y-1">
              <Label className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Sort rows</Label>
              <Select value={sort} onValueChange={v => setSort(v as any)}>
                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none" className="text-xs">As in sheet</SelectItem>
                  <SelectItem value="desc" className="text-xs">Largest first</SelectItem>
                  <SelectItem value="asc" className="text-xs">Smallest first</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {agg !== "count" && (
              <label className="flex items-center gap-2 text-xs">
                <input type="checkbox" checked={currency} onChange={e => setCurrency(e.target.checked)} />
                Show as currency ({cur})
              </label>
            )}
          </div>

          {/* ── Live preview ── */}
          <div className="min-w-0 space-y-2">
            <p className="text-xs text-muted-foreground">
              Preview: <span className="font-medium text-foreground">{rowCol && valueCol ? describePivot(cfg) : "—"}</span>
            </p>
            {nonNumeric && (
              <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                "{valueCol}" me numbers nahi mile. Sum/Average ke liye number wala column chuno, ya Count use karo.
              </p>
            )}
            <div className="max-h-[420px] overflow-auto rounded-lg border">
              {!res || !res.rows.length ? (
                <p className="px-4 py-12 text-center text-sm text-muted-foreground">Is selection me koi data nahi mila.</p>
              ) : (
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-muted/80 backdrop-blur">
                    <tr>
                      <th className="px-3 py-2 text-left text-xs font-semibold">{rowCol}</th>
                      {res.series.map(s => <th key={s} className="px-3 py-2 text-right text-xs font-semibold">{s}</th>)}
                      {multi && <th className="px-3 py-2 text-right text-xs font-semibold">{totalLabel(agg)}</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {res.rows.slice(0, 200).map(r => (
                      <tr key={r.label} className="border-t">
                        <td className="px-3 py-1.5 font-medium">{r.label}</td>
                        {res.series.map(s => <td key={s} className="px-3 py-1.5 text-right tabular-nums">{fmt(r.values[s])}</td>)}
                        {multi && <td className="px-3 py-1.5 text-right font-semibold tabular-nums">{fmt(r.total)}</td>}
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="border-t-2 bg-blue-600 text-white">
                      <td className="px-3 py-2 text-xs font-bold">{totalLabel(agg)}</td>
                      {res.series.map(s => <td key={s} className="px-3 py-2 text-right text-xs font-bold tabular-nums">{fmt(res.grand[s])}</td>)}
                      {multi && <td className="px-3 py-2 text-right text-xs font-bold tabular-nums">{fmt(res.grandTotal)}</td>}
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
