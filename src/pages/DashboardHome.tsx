import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Table2, FileText, BarChart3, FolderOpen, Plus, Search, ArrowRight,
  Crown, Clock, FilePlus2, Sparkles,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { formatCurrency } from "@/lib/currency";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/* ════════════════════════════════════════════════════════════════════
   ROUTES — App.tsx ke hisaab se. Saare pages /dashboard ke andar hain.
   ════════════════════════════════════════════════════════════════════ */
const ROUTES = {
  tables: "/dashboard/tables",
  documents: "/dashboard/invoices",
  docEditor: "/dashboard/document-editor",
  analytics: "/dashboard/analytics",
  pricing: "/dashboard/pricing",
  // "Create table" par table page khulke naam wala box turant khul jaye:
  newTable: "/dashboard/tables?new=1",
  // Recent work me table par click:
  openTable: (id: string) => `/dashboard/tables?t=${id}`,
  // Recent work me quotation/invoice par click
  openDocument: (_d: any) => `/dashboard/invoices`,
};

/* ═════════ small helpers ═════════ */
type Period = "7d" | "6m" | "12m" | "year";
type Source = "both" | "docs" | "tables";
type Filter = "all" | "table" | "document";
type Entry = { date: Date; income: number; expense: number; src: "doc" | "table"; tableId?: string };
type Recent = { key: string; kind: "table" | "document"; name: string; sub: string; date: string; raw: any };

const parseNum = (v: any): number | null => {
  if (v == null) return null;
  let s = String(v).trim(); if (!s) return null;
  const neg = /^\(.*\)$/.test(s);
  s = s.replace(/[₹$€£,\s()]/g, "");
  if (!/^-?\d+(\.\d+)?$/.test(s)) return null;
  const n = Number(s); return Number.isFinite(n) ? (neg ? -Math.abs(n) : n) : null;
};
const parseDate = (v: any): Date | null => {
  const s = String(v ?? "").trim(); if (!s) return null;
  let m = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})$/);
  if (m) { const d = new Date(+m[3], +m[2] - 1, +m[1]); return isNaN(+d) ? null : d; }
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) { const d = new Date(+m[1], +m[2] - 1, +m[3]); return isNaN(+d) ? null : d; }
  return null;
};
const invTotal = (t: any) => parseNum(t?.grandTotal ?? t?.grand_total ?? t?.total ?? 0) ?? 0;
const pad = (n: number) => String(n).padStart(2, "0");
const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const ym = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
const cap = (s?: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1).toLowerCase() : "");
const shortDate = (iso: string) => new Date(iso).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
const ago = (iso: string) => {
  const d = new Date(iso); if (isNaN(+d)) return "";
  const s = (Date.now() - +d) / 1000;
  if (s < 60) return "Just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} hr ago`;
  if (s < 86400 * 7) return `${Math.floor(s / 86400)} d ago`;
  return shortDate(iso);
};
const greet = () => { const h = new Date().getHours(); return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening"; };
const pick = (o: any, keys: string[]) => { for (const k of keys) { const v = o?.[k]; if (v != null && String(v).trim()) return String(v).trim(); } return ""; };

/* readable document name: number > party name > date (kabhi uuid nahi) */
function docLabel(x: any) {
  const type = cap(x.type) || "Document";
  const number = pick(x, ["doc_no", "invoice_number", "quotation_number", "bill_number", "doc_number", "document_number", "number", "title", "name"])
    || pick(x.data, ["invoice_number", "number", "title"]);
  const party = pick(x, ["customer_name", "client_name", "party_name", "buyer_name", "bill_to_name"])
    || pick(x.customer ?? x.client ?? x.party ?? x.data?.customer ?? x.data?.client, ["name"]);
  const amt = invTotal(x.totals);
  return {
    name: number ? `${type} ${number.startsWith("#") ? number : "#" + number}` : party ? `${type} · ${party}` : `${type} · ${shortDate(x.created_at)}`,
    sub: [number && party ? party : "", x.status ? cap(String(x.status)) : "", amt ? `${amt.toLocaleString("en-IN")}` : ""].filter(Boolean).join(" · "),
  };
}

/* ═════════ table smartness: amount / expense columns ═════════ */
const INC = /amount|income|credit|received|sales|revenue|total|earning|payment/i;
const EXP = /expense|debit|cost|spend|spent|purchase|withdraw|outflow/i;
const ID_NAME = /^(sr\.?|s\.?\s?no\.?|sno|serial|id|hsn|sac|phone|mobile|pin|pincode|gst|gstin|year|no\.?)(\b|\s|$)/i;

function tableEntries(tables: any[], cols: any[], rows: any[]): Entry[] {
  const out: Entry[] = [];
  tables.forEach(t => {
    const names: string[] = cols.filter(c => c.table_id === t.id).map(c => c.name);
    const tr = rows.filter(r => r.table_id === t.id).map(r => ({ d: r.row_data ?? {}, at: r.created_at }))
      .filter(r => names.some(n => String(r.d[n] ?? "").trim() !== ""));
    if (!tr.length) return;
    const vals = (n: string) => tr.map(r => r.d[n]).filter(v => v != null && String(v).trim() !== "");
    const dateCol = names.find(n => { const v = vals(n); return v.length && v.filter(x => parseDate(x)).length / v.length >= 0.7; });
    const money = names.map(n => {
      if (ID_NAME.test(n.trim())) return null;
      const v = vals(n); if (!v.length) return null;
      const nums = v.map(parseNum).filter((x): x is number => x !== null);
      if (nums.length / v.length < 0.7) return null;
      if (nums.length > 2 && nums.every((x, i) => i === 0 || x === nums[i - 1] + 1)) return null;
      return EXP.test(n) ? { n, exp: true } : INC.test(n) ? { n, exp: false } : null;
    }).filter(Boolean) as { n: string; exp: boolean }[];
    if (!money.length) return;
    const textCols = names.filter(n => !money.some(m => m.n === n) && n !== dateCol);
    const withText = tr.filter(r => textCols.some(n => String(r.d[n] ?? "").trim() !== "" && parseNum(r.d[n]) === null));
    const skipTotals = textCols.length > 0 && withText.length / tr.length > 0.6;
    tr.forEach(r => {
      if (skipTotals && !withText.includes(r)) return;                 // AutoSum / total row
      if (names.some(n => /^total$/i.test(String(r.d[n] ?? "").trim()))) return;
      const date = (dateCol && parseDate(r.d[dateCol])) || new Date(r.at);
      if (isNaN(+date)) return;
      let income = 0, expense = 0;
      money.forEach(m => {
        const n = parseNum(r.d[m.n]); if (n === null) return;
        if (m.exp) expense += n; else if (n >= 0) income += n; else expense += -n;
      });
      if (income || expense) out.push({ date, income, expense, src: "table", tableId: t.id });
    });
  });
  return out;
}

/* ═════════ period buckets ═════════ */
function makeBuckets(p: Period, year: number) {
  const now = new Date(); const b: { key: string; label: string }[] = [];
  if (p === "7d") for (let i = 6; i >= 0; i--) { const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i); b.push({ key: ymd(d), label: d.toLocaleString("en-IN", { weekday: "short" }) }); }
  else if (p === "year") for (let m = 0; m < 12; m++) { const d = new Date(year, m, 1); b.push({ key: ym(d), label: d.toLocaleString("en-IN", { month: "short" }) }); }
  else for (let i = (p === "6m" ? 5 : 11); i >= 0; i--) { const d = new Date(now.getFullYear(), now.getMonth() - i, 1); b.push({ key: ym(d), label: d.toLocaleString("en-IN", { month: "short" }) }); }
  return b;
}

/* ═════════ page ═════════ */
export default function DashboardPage() {
  const nav = useNavigate();
  const { profile, hasAccess, userCurrency } = useAuth() as any;
  const uid = profile?.id;
  const cur = userCurrency || "INR";

  const [tables, setTables] = useState<any[]>([]);
  const [docs, setDocs] = useState<any[]>([]);
  const [tCols, setTCols] = useState<any[]>([]);
  const [tRows, setTRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [q, setQ] = useState("");
  const [period, setPeriod] = useState<Period>("6m");
  const [year, setYear] = useState(new Date().getFullYear());
  const [source, setSource] = useState<Source>("both");

  useEffect(() => {
    if (!uid) return;
    (async () => {
      setLoading(true); setError("");
      const [t, d] = await Promise.all([
        supabase.from("user_tables").select("id,name,created_at").eq("user_id", uid).order("created_at", { ascending: false }),
        supabase.from("invoices").select("*").eq("user_id", uid).order("created_at", { ascending: false }),
      ]);
      if (t.error || d.error) setError((t.error || d.error)!.message);
      const tl = t.data ?? [];
      setTables(tl); setDocs(d.data ?? []);
      if (tl.length) {
        const ids = tl.map((x: any) => x.id);
        const [c, r] = await Promise.all([
          supabase.from("user_columns").select("table_id,name").in("table_id", ids),
          supabase.from("user_rows").select("table_id,row_data,created_at").in("table_id", ids).limit(5000),
        ]);
        setTCols(c.data ?? []); setTRows(r.data ?? []);
      }
      setLoading(false);
    })();
  }, [uid]);

  /* every money entry (documents + tables) */
  const entries: Entry[] = useMemo(() => {
    const a: Entry[] = docs.map(x => ({ date: new Date(x.created_at), income: invTotal(x.totals), expense: 0, src: "doc" as const }));
    return [...a, ...tableEntries(tables, tCols, tRows)].filter(e => !isNaN(+e.date));
  }, [docs, tables, tCols, tRows]);

  const years = useMemo(() => {
    const s = new Set<number>([new Date().getFullYear()]);
    entries.forEach(e => s.add(e.date.getFullYear()));
    return [...s].sort((a, b) => b - a);
  }, [entries]);

  const buckets = useMemo(() => makeBuckets(period, year), [period, year]);
  const series = useMemo(() => {
    const map = new Map(buckets.map(b => [b.key, { ...b, income: 0, expense: 0 }]));
    const keyOf = (d: Date) => (period === "7d" ? ymd(d) : ym(d));
    entries.forEach(e => {
      if (source === "docs" && e.src !== "doc") return;
      if (source === "tables" && e.src !== "table") return;
      const s = map.get(keyOf(e.date)); if (!s) return;
      s.income += e.income; s.expense += e.expense;
    });
    return [...map.values()];
  }, [entries, buckets, period, source]);

  const inc = series.reduce((s, x) => s + x.income, 0);
  const exp = series.reduce((s, x) => s + x.expense, 0);
  const maxV = Math.max(...series.flatMap(s => [s.income, s.expense]), 1);
  const hasMoney = inc > 0 || exp > 0;
  const incLabel = source === "docs" ? "Billed" : source === "tables" ? "Income" : "Income & billed";

  /* per-table figures for the side card (same period) */
  const tableFigures = useMemo(() => {
    const keys = new Set(buckets.map(b => b.key));
    const keyOf = (d: Date) => (period === "7d" ? ymd(d) : ym(d));
    const m = new Map<string, { income: number; expense: number }>();
    entries.forEach(e => {
      if (e.src !== "table" || !e.tableId || !keys.has(keyOf(e.date))) return;
      const c = m.get(e.tableId) ?? { income: 0, expense: 0 };
      c.income += e.income; c.expense += e.expense; m.set(e.tableId, c);
    });
    return [...m.entries()].map(([id, v]) => ({ id, name: tables.find(t => t.id === id)?.name ?? "Table", ...v }))
      .sort((a, b) => b.income + b.expense - (a.income + a.expense)).slice(0, 4);
  }, [entries, buckets, period, tables]);

  /* recent work */
  const recent: Recent[] = useMemo(() => {
    const a: Recent[] = tables.map(t => ({ key: "t" + t.id, kind: "table", name: t.name || "Untitled table", sub: "Table", date: t.created_at, raw: t }));
    const b: Recent[] = docs.map((x, i) => { const l = docLabel(x); return { key: "d" + (x.id ?? i), kind: "document", name: l.name, sub: l.sub, date: x.updated_at || x.created_at, raw: x }; });
    return [...a, ...b]
      .filter(r => (filter === "all" ? true : r.kind === filter))
      .filter(r => (r.name + " " + r.sub).toLowerCase().includes(q.trim().toLowerCase()))
      .sort((x, y) => +new Date(y.date) - +new Date(x.date)).slice(0, 8);
  }, [tables, docs, filter, q]);

  const openItem = (r: Recent) => nav(r.kind === "table" ? ROUTES.openTable(r.raw.id) : ROUTES.openDocument(r.raw));

  const name = profile?.full_name || profile?.name || profile?.email?.split("@")[0] || "there";
  const plan = profile?.plan || profile?.subscription_plan || (hasAccess ? "Premium" : "Free");

  const quick = [
    { t: "Create table", d: "Excel-style sheet with formulas and import", icon: Table2, to: ROUTES.newTable, c: "bg-blue-50 text-blue-700" },
    { t: "Create document", d: "Write in the Word-style editor", icon: FilePlus2, to: ROUTES.docEditor, c: "bg-violet-50 text-violet-700" },
    { t: "View analytics", d: "Charts and pivots built from your data", icon: BarChart3, to: ROUTES.analytics, c: "bg-emerald-50 text-emerald-700" },
    { t: "My files", d: "Invoices, quotations and bills", icon: FolderOpen, to: ROUTES.documents, c: "bg-orange-50 text-orange-700" },
  ];

  return (
    <div className="mx-auto w-full max-w-6xl space-y-6 pb-12">
      {/* ── Hero ── */}
      <section className="overflow-hidden rounded-2xl bg-[#0f1f3d] text-white">
        <div className="grid gap-6 p-6 md:grid-cols-[1fr_1.15fr] md:p-8">
          <div className="flex flex-col justify-between gap-6">
            <div>
              <p className="text-sm text-blue-200/80">{greet()}</p>
              <h1 className="mt-1 break-words text-2xl font-semibold tracking-tight md:text-3xl">{name}</h1>
              <p className="mt-2 max-w-md text-sm text-blue-100/70">Your business workspace, all in one place.</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => nav(ROUTES.newTable)} className="bg-blue-500 text-white hover:bg-blue-400"><Plus className="mr-1.5 h-4 w-4" />New table</Button>
              <Button onClick={() => nav(ROUTES.docEditor)} variant="outline" className="border-white/20 bg-white/5 text-white hover:bg-white/10 hover:text-white"><FilePlus2 className="mr-1.5 h-4 w-4" />New document</Button>
            </div>
          </div>

          <div className="rounded-xl bg-white/[0.06] p-4 ring-1 ring-white/10">
            {/* controls */}
            <div className="flex flex-wrap items-center gap-2">
              <Seg value={source} onChange={v => setSource(v as Source)} opts={[["both", "All"], ["docs", "Documents"], ["tables", "Tables"]]} label="Data source" />
              <div className="ml-auto flex items-center gap-2">
                <Seg value={period} onChange={v => setPeriod(v as Period)} opts={[["7d", "7 days"], ["6m", "6 months"], ["12m", "1 year"], ["year", "Year"]]} label="Period" />
                {period === "year" && (
                  <select value={year} onChange={e => setYear(+e.target.value)} aria-label="Choose year"
                    className="h-7 rounded-md border border-white/15 bg-[#17294d] px-2 text-xs text-white outline-none focus:ring-2 focus:ring-blue-400">
                    {years.map(y => <option key={y} value={y}>{y}</option>)}
                  </select>
                )}
              </div>
            </div>

            {hasMoney ? (
              <>
                <div className="mt-4 flex flex-wrap items-end gap-x-6 gap-y-1">
                  <div>
                    <p className="text-xs text-blue-200/70">{incLabel}</p>
                    <p className="text-2xl font-semibold tabular-nums">{formatCurrency(inc, cur)}</p>
                  </div>
                  {exp > 0 && (
                    <>
                      <div><p className="text-xs text-blue-200/70">Expenses</p><p className="text-lg font-semibold tabular-nums text-orange-300">{formatCurrency(exp, cur)}</p></div>
                      <div><p className="text-xs text-blue-200/70">Net</p><p className={cn("text-lg font-semibold tabular-nums", inc - exp >= 0 ? "text-emerald-300" : "text-red-300")}>{formatCurrency(inc - exp, cur)}</p></div>
                    </>
                  )}
                </div>
                <div className="mt-4 flex gap-1.5" role="img" aria-label="Income and expense by period">
                  {series.map(s => (
                    <div key={s.key} className="flex flex-1 flex-col items-center gap-1.5" title={`${s.label}: ${formatCurrency(s.income, cur)}${s.expense ? ` · expense ${formatCurrency(s.expense, cur)}` : ""}`}>
                      <div className="flex h-24 w-full items-end justify-center gap-0.5">
                        <div className="w-full max-w-[18px] rounded-t bg-blue-400" style={{ height: s.income ? Math.max(3, (s.income / maxV) * 96) : 2, opacity: s.income ? 1 : 0.25 }} />
                        {exp > 0 && <div className="w-full max-w-[18px] rounded-t bg-orange-400" style={{ height: s.expense ? Math.max(3, (s.expense / maxV) * 96) : 2, opacity: s.expense ? 1 : 0.25 }} />}
                      </div>
                      <span className="text-[10px] text-blue-200/70">{s.label}</span>
                    </div>
                  ))}
                </div>
                {exp > 0 && (
                  <div className="mt-2 flex gap-4 text-[11px] text-blue-200/80">
                    <span className="flex items-center gap-1.5"><i className="h-2 w-2 rounded-full bg-blue-400" />{incLabel}</span>
                    <span className="flex items-center gap-1.5"><i className="h-2 w-2 rounded-full bg-orange-400" />Expenses</span>
                  </div>
                )}
              </>
            ) : (
              <div className="flex min-h-[170px] flex-col items-center justify-center text-center">
                <Sparkles className="mb-2 h-5 w-5 text-blue-300" />
                <p className="max-w-xs text-sm text-blue-100/80">
                  {loading ? "Loading your numbers…" : "No amounts in this period. Create an invoice, or name a table column Amount or Expense, and it shows up here."}
                </p>
              </div>
            )}
          </div>
        </div>
      </section>

      {/* ── Quick create ── */}
      <section aria-label="Quick create" className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {quick.map(c => (
          <button key={c.t} onClick={() => nav(c.to)}
            className="group flex flex-col items-start gap-3 rounded-xl border bg-card p-4 text-left transition hover:border-blue-300 hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500">
            <span className={cn("flex h-10 w-10 items-center justify-center rounded-lg", c.c)}><c.icon className="h-5 w-5" /></span>
            <span><span className="block text-sm font-semibold">{c.t}</span><span className="mt-0.5 block text-xs text-muted-foreground">{c.d}</span></span>
            <ArrowRight className="ml-auto h-4 w-4 text-muted-foreground transition group-hover:translate-x-0.5 group-hover:text-blue-600" />
          </button>
        ))}
      </section>

      <div className="grid gap-6 lg:grid-cols-[1fr_300px]">
        {/* ── Recent work ── */}
        <section className="rounded-xl border bg-card" aria-label="Recent work">
          <div className="flex flex-wrap items-center gap-3 border-b px-4 py-3">
            <h2 className="mr-auto text-sm font-semibold">Recent work</h2>
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search files" aria-label="Search recent files"
                className="h-8 w-40 rounded-md border bg-background pl-8 pr-2 text-xs outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <div className="flex rounded-lg bg-muted p-0.5" role="tablist">
              {(["all", "table", "document"] as Filter[]).map(f => (
                <button key={f} role="tab" aria-selected={filter === f} onClick={() => setFilter(f)}
                  className={cn("rounded-md px-3 py-1 text-xs font-medium", filter === f ? "bg-background shadow-sm" : "text-muted-foreground hover:text-foreground")}>
                  {f === "all" ? "All" : f === "table" ? "Tables" : "Documents"}
                </button>
              ))}
            </div>
          </div>

          {loading ? (
            <ul className="divide-y">{[0, 1, 2, 3].map(i => (
              <li key={i} className="flex items-center gap-3 px-4 py-3"><div className="h-9 w-9 animate-pulse rounded-lg bg-muted" />
                <div className="flex-1 space-y-1.5"><div className="h-3 w-1/3 animate-pulse rounded bg-muted" /><div className="h-2.5 w-1/5 animate-pulse rounded bg-muted" /></div></li>))}
            </ul>
          ) : error ? (
            <p className="px-4 py-10 text-center text-sm text-red-600">Could not load your files: {error}</p>
          ) : recent.length === 0 ? (
            <div className="flex flex-col items-center gap-3 px-4 py-12 text-center">
              <FolderOpen className="h-9 w-9 text-muted-foreground/40" />
              <p className="text-sm text-muted-foreground">{q || filter !== "all" ? "Nothing matches this filter." : "No files yet. Start with a table or a document."}</p>
              {!q && filter === "all" && (
                <div className="flex gap-2">
                  <Button size="sm" onClick={() => nav(ROUTES.newTable)}>Create table</Button>
                  <Button size="sm" variant="outline" onClick={() => nav(ROUTES.docEditor)}>Create document</Button>
                </div>
              )}
            </div>
          ) : (
            <ul className="divide-y">
              {recent.map(r => (
                <li key={r.key}>
                  <button onClick={() => openItem(r)} className="flex w-full items-center gap-3 px-4 py-3 text-left transition hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:outline-none">
                    <span className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-lg", r.kind === "table" ? "bg-blue-50 text-blue-700" : "bg-violet-50 text-violet-700")}>
                      {r.kind === "table" ? <Table2 className="h-4 w-4" /> : <FileText className="h-4 w-4" />}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{r.name}</span>
                      <span className="block truncate text-xs text-muted-foreground">{r.sub}</span>
                    </span>
                    <span className="hidden items-center gap-1 whitespace-nowrap text-xs text-muted-foreground sm:flex"><Clock className="h-3 w-3" />{ago(r.date)}</span>
                    <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* ── Side column ── */}
        <aside className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <Stat label="Tables" value={tables.length} onClick={() => nav(ROUTES.tables)} />
            <Stat label="Documents" value={docs.length} onClick={() => nav(ROUTES.documents)} />
          </div>

          {tableFigures.length > 0 && (
            <div className="rounded-xl border bg-card p-4">
              <p className="mb-2 text-sm font-semibold">From your tables</p>
              <ul className="space-y-2.5">
                {tableFigures.map(t => (
                  <li key={t.id}>
                    <button onClick={() => nav(ROUTES.openTable(t.id))} className="w-full text-left">
                      <span className="block truncate text-xs font-medium">{t.name}</span>
                      <span className="mt-0.5 flex justify-between text-xs tabular-nums">
                        <span className="text-emerald-600">{formatCurrency(t.income, cur)}</span>
                        {t.expense > 0 && <span className="text-orange-600">− {formatCurrency(t.expense, cur)}</span>}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="rounded-xl border bg-card p-4">
            <div className="flex items-center gap-2">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-50 text-amber-600"><Crown className="h-4 w-4" /></span>
              <div><p className="text-xs text-muted-foreground">Current plan</p><p className="text-sm font-semibold capitalize">{String(plan)}</p></div>
            </div>
            {!hasAccess && <Button size="sm" variant="outline" className="mt-3 w-full" onClick={() => nav(ROUTES.pricing)}>See plans</Button>}
          </div>
        </aside>
      </div>
    </div>
  );
}

function Stat({ label, value, onClick }: { label: string; value: number; onClick: () => void }) {
  return (
    <button onClick={onClick} className="rounded-xl border bg-card p-4 text-left transition hover:border-blue-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
    </button>
  );
}

function Seg({ value, onChange, opts, label }: { value: string; onChange: (v: string) => void; opts: [string, string][]; label: string }) {
  return (
    <div role="group" aria-label={label} className="flex rounded-lg bg-white/10 p-0.5">
      {opts.map(([k, l]) => (
        <button key={k} onClick={() => onChange(k)} aria-pressed={value === k}
          className={cn("rounded-md px-2.5 py-1 text-xs font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400",
            value === k ? "bg-white text-[#0f1f3d]" : "text-blue-100/80 hover:text-white")}>{l}</button>
      ))}
    </div>
  );
}
