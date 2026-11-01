import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Table2, FileText, BarChart3, FolderOpen, Plus, Search, ArrowRight,
  Crown, Clock, FilePlus2,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
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
type Filter = "all" | "table" | "document";
type Recent = { key: string; kind: "table" | "document"; name: string; sub: string; date: string; raw: any };

const parseNum = (v: any): number | null => {
  if (v == null) return null;
  let s = String(v).trim(); if (!s) return null;
  const neg = /^\(.*\)$/.test(s);
  s = s.replace(/[₹$€£,\s()]/g, "");
  if (!/^-?\d+(\.\d+)?$/.test(s)) return null;
  const n = Number(s); return Number.isFinite(n) ? (neg ? -Math.abs(n) : n) : null;
};
const invTotal = (t: any) => parseNum(t?.grandTotal ?? t?.grand_total ?? t?.total ?? 0) ?? 0;
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

/* ═════════ page ═════════ */
export default function DashboardPage() {
  const nav = useNavigate();
  const { profile, hasAccess } = useAuth() as any;
  const uid = profile?.id;

  const [tables, setTables] = useState<any[]>([]);
  const [docs, setDocs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [q, setQ] = useState("");

  useEffect(() => {
    if (!uid) return;
    (async () => {
      setLoading(true); setError("");
      const [t, d] = await Promise.all([
        supabase.from("user_tables").select("id,name,created_at").eq("user_id", uid).order("created_at", { ascending: false }),
        supabase.from("invoices").select("*").eq("user_id", uid).order("created_at", { ascending: false }),
      ]);
      if (t.error || d.error) setError((t.error || d.error)!.message);
      setTables(t.data ?? []);
      setDocs(d.data ?? []);
      setLoading(false);
    })();
  }, [uid]);

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
      {/* ── Hero (no charts / no amounts) ── */}
      <section className="overflow-hidden rounded-2xl bg-[#0f1f3d] text-white">
        <div className="flex flex-col gap-8 p-6 md:p-8">
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
