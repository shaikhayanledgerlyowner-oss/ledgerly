// src/components/SavedAnalyses.tsx
import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  ResponsiveContainer, BarChart, Bar, LineChart, Line, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from "recharts";
import { BarChart2, TrendingUp, PieChart as PieIcon, Trash2, Table2 } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { computePivot, describePivot, makeFormatter, totalLabel } from "@/lib/pivot";
import type { PivotConfig } from "@/lib/pivot";

interface Saved { id: string; table_id: string; name: string; config: PivotConfig; created_at: string }
type Mode = "bar" | "line" | "pie";
type RowData = Record<string, any>;

const COLORS = ["#3b82f6", "#22c55e", "#f59e0b", "#ef4444", "#a855f7", "#06b6d4", "#f97316", "#ec4899", "#84cc16", "#14b8a6"];
const PAGE = 1000;

// Supabase ek baar me 1000 rows deta hai — isliye pages me saari rows layi jati hain
async function fetchAllRows(tableId: string): Promise<RowData[]> {
  const all: RowData[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase.from("user_rows").select("row_data")
      .eq("table_id", tableId).order("created_at").order("id").range(from, from + PAGE - 1);
    if (error || !data?.length) break;
    all.push(...data.map((r: any) => r.row_data ?? {}));
    if (data.length < PAGE) break;
  }
  return all;
}

function AnalysisCard({ a, rows, tableName, cur, onDelete, onOpenTable }: {
  a: Saved; rows: RowData[]; tableName: string; cur: string;
  onDelete: () => void; onOpenTable: () => void;
}) {
  const cfg = a.config;
  const res = useMemo(() => computePivot(rows, cfg), [rows, cfg]);
  const fmt = useMemo(() => makeFormatter(cfg, cur), [cfg, cur]);
  const [mode, setMode] = useState<Mode>("bar");
  const multi = res.series.length > 1;

  const data = useMemo(() => res.rows.map(r => ({ name: r.label, ...r.values })), [res]);
  const pie = useMemo(
    () => res.rows.map(r => ({ name: r.label, value: r.total ?? 0 })).filter(d => d.value > 0),
    [res],
  );

  const tip = <Tooltip formatter={(v: any) => fmt(Number(v))} />;
  const common = { data, margin: { top: 8, right: 16, bottom: 48, left: 8 } };
  const xAx = <XAxis dataKey="name" tick={{ fontSize: 10 }} tickLine={false} angle={-30} textAnchor="end" interval={0} />;
  const yAx = <YAxis tick={{ fontSize: 10 }} tickLine={false} axisLine={false} width={80} tickFormatter={v => fmt(Number(v))} />;
  const grid = <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" vertical={false} />;

  return (
    <div className="overflow-hidden rounded-2xl border bg-card">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b bg-muted/30 px-5 py-4">
        <div className="min-w-0">
          <h3 className="truncate text-sm font-semibold">{a.name}</h3>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Table: {tableName} · {describePivot(cfg)}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex gap-0.5 rounded-lg bg-muted p-0.5">
            {([["bar", "Bar", BarChart2], ["line", "Line", TrendingUp], ["pie", "Pie", PieIcon]] as const).map(([k, l, Icon]) => (
              <button key={k} onClick={() => setMode(k)}
                className={cn("flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-medium",
                  mode === k ? "bg-background shadow-sm" : "text-muted-foreground hover:text-foreground")}>
                <Icon className="h-3 w-3" />{l}
              </button>
            ))}
          </div>
          <Button variant="outline" size="icon" className="h-8 w-8" title="Open table" onClick={onOpenTable}><Table2 className="h-3.5 w-3.5" /></Button>
          <Button variant="outline" size="icon" className="h-8 w-8 text-destructive hover:text-destructive" title="Delete analysis" onClick={onDelete}><Trash2 className="h-3.5 w-3.5" /></Button>
        </div>
      </div>

      {res.rows.length === 0 ? (
        <p className="px-5 py-10 text-center text-sm text-muted-foreground">
          Is analysis ke liye abhi table me data nahi mila (columns rename ya delete hue ho sakte hain).
        </p>
      ) : (
        <div className="grid gap-5 p-5 lg:grid-cols-2">
          <div>
            <p className="mb-3 text-xs text-muted-foreground">{totalLabel(cfg.agg)}</p>
            <p className="mb-4 text-2xl font-bold tabular-nums">{fmt(res.grandTotal)}</p>
            <ResponsiveContainer width="100%" height={300}>
              {mode === "pie" ? (
                <PieChart>
                  <Pie data={pie} dataKey="value" nameKey="name" cx="50%" cy="45%" outerRadius={100} innerRadius={42} paddingAngle={3}>
                    {pie.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                  </Pie>
                  {tip}<Legend wrapperStyle={{ fontSize: 10 }} />
                </PieChart>
              ) : mode === "line" ? (
                <LineChart {...common}>{grid}{xAx}{yAx}{tip}{multi && <Legend wrapperStyle={{ fontSize: 11 }} />}
                  {res.series.map((s, i) => <Line key={s} type="monotone" dataKey={s} stroke={COLORS[i % COLORS.length]} strokeWidth={2.5} dot={{ r: 3 }} />)}
                </LineChart>
              ) : (
                <BarChart {...common}>{grid}{xAx}{yAx}{tip}{multi && <Legend wrapperStyle={{ fontSize: 11 }} />}
                  {res.series.map((s, i) => <Bar key={s} dataKey={s} fill={COLORS[i % COLORS.length]} radius={[6, 6, 0, 0]} maxBarSize={48} />)}
                </BarChart>
              )}
            </ResponsiveContainer>
          </div>

          <div className="max-h-[400px] min-w-0 overflow-auto rounded-lg border">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-muted/80 backdrop-blur">
                <tr>
                  <th className="px-3 py-2 text-left text-xs font-semibold">{cfg.rowCol}</th>
                  {res.series.map(s => <th key={s} className="px-3 py-2 text-right text-xs font-semibold">{s}</th>)}
                  {multi && <th className="px-3 py-2 text-right text-xs font-semibold">{totalLabel(cfg.agg)}</th>}
                </tr>
              </thead>
              <tbody>
                {res.rows.map(r => (
                  <tr key={r.label} className="border-t">
                    <td className="px-3 py-1.5 font-medium">{r.label}</td>
                    {res.series.map(s => <td key={s} className="px-3 py-1.5 text-right tabular-nums">{fmt(r.values[s])}</td>)}
                    {multi && <td className="px-3 py-1.5 text-right font-semibold tabular-nums">{fmt(r.total)}</td>}
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 bg-blue-600 text-white">
                  <td className="px-3 py-2 text-xs font-bold">{totalLabel(cfg.agg)}</td>
                  {res.series.map(s => <td key={s} className="px-3 py-2 text-right text-xs font-bold tabular-nums">{fmt(res.grand[s])}</td>)}
                  {multi && <td className="px-3 py-2 text-right text-xs font-bold tabular-nums">{fmt(res.grandTotal)}</td>}
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

export default function SavedAnalyses({ hideEmpty = false }: { hideEmpty?: boolean }) {
  const { profile, userCurrency } = useAuth() as any;
  const navigate = useNavigate();
  const uid = profile?.id;
  const cur = userCurrency || "INR";

  const [items, setItems] = useState<Saved[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});
  const [rowsByTable, setRowsByTable] = useState<Record<string, RowData[]>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    if (!uid) return;
    setLoading(true); setError("");
    const { data, error: e } = await (supabase as any).from("user_analyses")
      .select("*").eq("user_id", uid).order("created_at", { ascending: false });
    if (e) {
      setError(/user_analyses/.test(e.message) ? "user_analyses table nahi mila — pehle user_analyses.sql run karo." : e.message);
      setLoading(false); return;
    }
    const list = (data ?? []) as Saved[];
    setItems(list);
    const tids = [...new Set(list.map(a => a.table_id))];
    if (tids.length) {
      const { data: t } = await supabase.from("user_tables").select("id,name").in("id", tids);
      setNames(Object.fromEntries((t ?? []).map((x: any) => [x.id, x.name])));
      const pairs = await Promise.all(tids.map(async id => [id, await fetchAllRows(id)] as const));
      setRowsByTable(Object.fromEntries(pairs));
    }
    setLoading(false);
  }, [uid]);

  useEffect(() => { load(); }, [load]);

  const remove = async (a: Saved) => {
    if (!window.confirm(`"${a.name}" delete karna hai?`)) return;
    const { error: e } = await (supabase as any).from("user_analyses").delete().eq("id", a.id);
    if (e) return toast.error(e.message);
    setItems(p => p.filter(x => x.id !== a.id));
    toast.success("Deleted");
  };

  if (loading) return hideEmpty ? null : (
    <div className="flex h-48 items-center justify-center">
      <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
    </div>
  );
  if (error) return <p className="rounded-xl border bg-muted/30 px-4 py-8 text-center text-sm text-red-600">{error}</p>;

  if (!items.length && hideEmpty) return null;

  if (!items.length) return (
    <div className="flex flex-col items-center gap-3 rounded-xl border bg-muted/30 px-4 py-14 text-center">
      <BarChart2 className="h-10 w-10 text-muted-foreground/40" />
      <div>
        <p className="text-sm font-semibold">Abhi koi analysis nahi hai</p>
        <p className="mt-1 max-w-sm text-xs text-muted-foreground">
          Tables page par kisi sheet me <strong>Create Analysis</strong> dabao, fields chuno aur save karo. Wo yahan dikhegi.
        </p>
      </div>
      <Button size="sm" onClick={() => navigate("/dashboard/tables")}>Tables par jao</Button>
    </div>
  );

  return (
    <div className="space-y-5">
      {hideEmpty && <h2 className="text-sm font-semibold text-muted-foreground">Your Analyses</h2>}
      {items.map(a => (
        <AnalysisCard key={a.id} a={a} rows={rowsByTable[a.table_id] ?? []}
          tableName={names[a.table_id] ?? "Table"} cur={cur}
          onDelete={() => remove(a)}
          onOpenTable={() => navigate(`/dashboard/tables?t=${a.table_id}`)} />
      ))}
    </div>
  );
}
