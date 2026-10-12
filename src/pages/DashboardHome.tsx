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

/* ── Apne project ke routes yahan ek jagah badlo ── */
const ROUTES = {
  tables: "/tables",
  documents: "/documents",
  docEditor: "/doc-editor",
  analytics: "/analytics",
  pricing: "/pricing",
};

type Recent = {
  key: string; kind: "table" | "document"; name: string; sub: string; date: string;
};
type Filter = "all" | "table" | "document";

const num = (v: any) => {
  const n = Number(String(v ?? "").replace(/[₹$,\s]/g, ""));
  return Number.isFinite(n) ? n : 0;
};
const invTotal = (t: any) => num(t?.grandTotal ?? t?.grand_total ?? t?.total ?? 0);
const ago = (iso: string) => {
  const d = new Date(iso); if (isNaN(d.getTime())) return "";
  const s = (Date.now() - d.getTime()) / 1000;
  if (s < 60) return "Just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} hr ago`;
  if (s < 86400 * 7) return `${Math.floor(s / 86400)} d ago`;
  return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
};
const greet = () => {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
};

export default function DashboardPage() {
  const nav = useNavigate();
  const { profile, hasAccess, userCurrency } = useAuth() as any;
  const uid = profile?.id;
  const cur = userCurrency || "INR";

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

  const recent: Recent[] = useMemo(() => {
    const a: Recent[] = tables.map(t => ({
      key: "t" + t.id, kind: "table", name: t.name || "Untitled table", sub: "Table", date: t.created_at,
    }));
    const b: Recent[] = docs.map((x, i) => ({
      key: "d" + (x.id ?? i), kind: "document",
      name: x.title || x.number || x.invoice_number || `${cap(x.type)} ${x.id ? "#" + String(x.id).slice(0, 6) : ""}`.trim(),
      sub: cap(x.type) + (x.status ? ` · ${cap(x.status)}` : ""),
      date: x.updated_at || x.created_at,
    }));
    return [...a, ...b]
      .filter(r => (filter === "all" ? true : r.kind === filter))
      .filter(r => r.name.toLowerCase().includes(q.trim().toLowerCase()))
      .sort((x, y) => +new Date(y.date) - +new Date(x.date))
      .slice(0, 8);
  }, [tables, docs, filter, q]);

  /* ── real overview: last 6 months of document totals ── */
  const months = useMemo(() => {
    const out: { label: string; key: string; total: number }[] = [];
    const now = new Date();
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      out.push({ key: `${d.getFullYear()}-${d.getMonth()}`, label: d.toLocaleString("en-IN", { month: "short" }), total: 0 });
    }
    docs.forEach(x => {
      const d = new Date(x.created_at);
      const m = out.find(o => o.key === `${d.getFullYear()}-${d.getMonth()}`);
      if (m) m.total += invTotal(x.totals);
    });
    return out;
  }, [docs]);
  const grand = docs.reduce((s, x) => s + invTotal(x.totals), 0);
  const maxM = Math.max(...months.map(m => m.total), 1);
  const hasMoney = grand > 0;

  const name = profile?.full_name || profile?.name || profile?.email?.split("@")[0] || "there";
  const plan = profile?.plan || profile?.subscription_plan || (hasAccess ? "Premium" : "Free");

  const openItem = (r: Recent) =>
    r.kind === "table" ? nav(`${ROUTES.tables}?t=${r.key.slice(1)}`) : nav(ROUTES.documents);

  const quick = [
    { t: "Create table", d: "Excel-style sheet with formulas and import", icon: Table2, to: ROUTES.tables, c: "bg-blue-50 text-blue-700" },
    { t: "Create document", d: "Write in the Word-style editor", icon: FilePlus2, to: ROUTES.docEditor, c: "bg-violet-50 text-violet-700" },
    { t: "View analytics", d: "Charts and pivots built from your data", icon: BarChart3, to: ROUTES.analytics, c: "bg-emerald-50 text-emerald-700" },
    { t: "My files", d: "Invoices, quotations and bills", icon: FolderOpen, to: ROUTES.documents, c: "bg-orange-50 text-orange-700" },
  ];

  return (
    <div className="mx-auto w-full max-w-6xl space-y-6 pb-12">
      {/* ── Hero: navy band with the user's own last-6-months numbers ── */}
      <section className="relative overflow-hidden rounded-2xl bg-[#0f1f3d] text-white">
        <div className="grid gap-6 p-6 md:grid-cols-[1.2fr_1fr] md:p-8">
          <div className="flex flex-col justify-between gap-6">
            <div>
              <p className="text-sm text-blue-200/80">{greet()}</p>
              <h1 className="mt-1 text-2xl font-semibold tracking-tight md:text-3xl">{name}</h1>
              <p className="mt-2 max-w-md text-sm text-blue-100/70">
                Your business workspace, all in one place.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => nav(ROUTES.tables)} className="bg-blue-500 text-white hover:bg-blue-400">
                <Plus className="mr-1.5 h-4 w-4" /> New table
              </Button>
              <Button onClick={() => nav(ROUTES.docEditor)} variant="outline"
                className="border-white/20 bg-white/5 text-white hover:bg-white/10 hover:text-white">
                <FilePlus2 className="mr-1.5 h-4 w-4" /> New document
              </Button>
            </div>
          </div>

          <div className="rounded-xl bg-white/[0.06] p-4 ring-1 ring-white/10">
            {hasMoney ? (
              <>
                <p className="text-xs text-blue-200/70">Billed in documents · last 6 months</p>
                <p className="mt-1 text-2xl font-semibold tabular-nums">
                  {formatCurrency(months.reduce((s, m) => s + m.total, 0), cur)}
                </p>
                <div className="mt-4 flex h-24 items-end gap-2" role="img" aria-label="Monthly billed totals">
                  {months.map(m => (
                    <div key={m.key} className="flex flex-1 flex-col items-center gap-1.5">
                      <div className="w-full rounded-t bg-blue-400/90"
                        style={{ height: `${Math.max(4, (m.total / maxM) * 100)}%`, opacity: m.total ? 1 : 0.25 }}
                        title={`${m.label}: ${formatCurrency(m.total, cur)}`} />
                      <span className="text-[10px] text-blue-200/70">{m.label}</span>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <div className="flex h-full min-h-[140px] flex-col items-center justify-center text-center">
                <Sparkles className="mb-2 h-5 w-5 text-blue-300" />
                <p className="text-sm text-blue-100/80">Create an invoice or quotation and your monthly totals will appear here.</p>
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
            <span className={cn("flex h-10 w-10 items-center justify-center rounded-lg", c.c)}>
              <c.icon className="h-5 w-5" />
            </span>
            <span>
              <span className="block text-sm font-semibold">{c.t}</span>
              <span className="mt-0.5 block text-xs text-muted-foreground">{c.d}</span>
            </span>
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
              <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search files"
                aria-label="Search recent files"
                className="h-8 w-40 rounded-md border bg-background pl-8 pr-2 text-xs outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <div className="flex rounded-lg bg-muted p-0.5" role="tablist">
              {(["all", "table", "document"] as Filter[]).map(f => (
                <button key={f} role="tab" aria-selected={filter === f} onClick={() => setFilter(f)}
                  className={cn("rounded-md px-3 py-1 text-xs font-medium",
                    filter === f ? "bg-background shadow-sm" : "text-muted-foreground hover:text-foreground")}>
                  {f === "all" ? "All" : f === "table" ? "Tables" : "Documents"}
                </button>
              ))}
            </div>
          </div>

          {loading ? (
            <ul className="divide-y">{[0, 1, 2, 3].map(i => (
              <li key={i} className="flex items-center gap-3 px-4 py-3">
                <div className="h-9 w-9 animate-pulse rounded-lg bg-muted" />
                <div className="flex-1 space-y-1.5"><div className="h-3 w-1/3 animate-pulse rounded bg-muted" /><div className="h-2.5 w-1/5 animate-pulse rounded bg-muted" /></div>
              </li>))}
            </ul>
          ) : error ? (
            <p className="px-4 py-10 text-center text-sm text-red-600">Could not load your files: {error}</p>
          ) : recent.length === 0 ? (
            <div className="flex flex-col items-center gap-3 px-4 py-12 text-center">
              <FolderOpen className="h-9 w-9 text-muted-foreground/40" />
              <p className="text-sm text-muted-foreground">
                {q || filter !== "all" ? "Nothing matches this filter." : "No files yet. Start with a table or a document."}
              </p>
              {!q && filter === "all" && (
                <div className="flex gap-2">
                  <Button size="sm" onClick={() => nav(ROUTES.tables)}>Create table</Button>
                  <Button size="sm" variant="outline" onClick={() => nav(ROUTES.docEditor)}>Create document</Button>
                </div>
              )}
            </div>
          ) : (
            <ul className="divide-y">
              {recent.map(r => (
                <li key={r.key}>
                  <button onClick={() => openItem(r)}
                    className="flex w-full items-center gap-3 px-4 py-3 text-left transition hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:outline-none">
                    <span className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-lg",
                      r.kind === "table" ? "bg-blue-50 text-blue-700" : "bg-violet-50 text-violet-700")}>
                      {r.kind === "table" ? <Table2 className="h-4 w-4" /> : <FileText className="h-4 w-4" />}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{r.name}</span>
                      <span className="block text-xs text-muted-foreground">{r.sub}</span>
                    </span>
                    <span className="hidden items-center gap-1 text-xs text-muted-foreground sm:flex">
                      <Clock className="h-3 w-3" />{ago(r.date)}
                    </span>
                    <ArrowRight className="h-4 w-4 text-muted-foreground" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* ── Side column: counts + plan ── */}
        <aside className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <Stat label="Tables" value={tables.length} onClick={() => nav(ROUTES.tables)} />
            <Stat label="Documents" value={docs.length} onClick={() => nav(ROUTES.documents)} />
          </div>
          <div className="rounded-xl border bg-card p-4">
            <div className="flex items-center gap-2">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-50 text-amber-600"><Crown className="h-4 w-4" /></span>
              <div>
                <p className="text-xs text-muted-foreground">Current plan</p>
                <p className="text-sm font-semibold capitalize">{String(plan)}</p>
              </div>
            </div>
            {!hasAccess && (
              <Button size="sm" variant="outline" className="mt-3 w-full" onClick={() => nav(ROUTES.pricing)}>
                See plans
              </Button>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}

function cap(s?: string) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : "Document"; }

function Stat({ label, value, onClick }: { label: string; value: number; onClick: () => void }) {
  return (
    <button onClick={onClick}
      className="rounded-xl border bg-card p-4 text-left transition hover:border-blue-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
    </button>
  );
}
