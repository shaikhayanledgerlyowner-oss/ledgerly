import { useAuth } from "@/contexts/AuthContext";
import { formatCurrency } from "@/lib/currency";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  FileText, Table2, TrendingUp, Plus, Clock, IndianRupee,
  ArrowRight, TrendingDown, Crown, AlertTriangle, Sparkles,
  LayoutDashboard,
} from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

interface TableSummary { id: string; name: string; rowCount: number; }
type TabKey = "tables" | "documents";

function toNumberSafe(v: any): number {
  if (v === null || v === undefined || v === "") return 0;
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  const n = Number(String(v).replace(/[₹,\s]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

function dayKey(dateStr: string) {
  const d = new Date(dateStr);
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}

function dayLabelFromKey(key: string) {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, (m??1)-1, d??1).toLocaleDateString("en-US", { day: "2-digit", month: "short" });
}

type ChartPoint = { key: string; name: string; revenue: number; expense: number };

function mapToChartPoints(map: Record<string, { revenue: number; expense: number }>): ChartPoint[] {
  return Object.entries(map)
    .map(([key, v]) => ({ key, name: dayLabelFromKey(key), revenue: v.revenue, expense: v.expense }))
    .sort((a, b) => a.key > b.key ? 1 : -1);
}

type TableAnalytics = { id: string; name: string; rowCount: number; revenue: number; expense: number; net: number; };

// ── Tooltip jo Analytics page jaisa hi dikhe — dono jagah same feel ──────────
function ChartTooltip({ active, payload, label, cur }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-white dark:bg-background border border-gray-100 dark:border-border rounded-2xl shadow-2xl p-4 text-xs min-w-[150px]">
      <p className="font-bold text-gray-800 dark:text-foreground mb-2 pb-2 border-b border-gray-100 dark:border-border">{label}</p>
      {payload.map((p: any, i: number) => (
        <div key={i} className="flex items-center justify-between gap-4 py-1">
          <span className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full" style={{ background: p.color }} />
            <span className="text-gray-500">{p.name}</span>
          </span>
          <span className="font-bold text-gray-900 dark:text-foreground">{formatCurrency(p.value, cur)}</span>
        </div>
      ))}
    </div>
  );
}

function PlanBanner() {
  const { isPremium, isTrialActive, isTrialExpired, trialDaysLeft, premiumDaysLeft, profile, isOwner } = useAuth();
  const navigate = useNavigate();

  if (isOwner) return null;

  if (isPremium) {
    const expiryDate = profile?.premium_until
      ? new Date(profile.premium_until).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })
      : null;
    const daysLeft = premiumDaysLeft;
    return (
      <Card className={`rounded-2xl border shadow-sm ${daysLeft <= 5 ? "border-amber-200 bg-amber-50/60 dark:bg-amber-500/5" : "border-emerald-200 bg-emerald-50/60 dark:bg-emerald-500/5"}`}>
        <CardContent className="flex items-center justify-between py-3.5 flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <div className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-xl", daysLeft <= 5 ? "bg-amber-100 text-amber-600" : "bg-emerald-100 text-emerald-600")}>
              {daysLeft <= 5 ? <AlertTriangle className="h-4.5 w-4.5" /> : <Crown className="h-4.5 w-4.5" />}
            </div>
            <div>
              <p className={`text-sm font-semibold ${daysLeft <= 5 ? "text-amber-700" : "text-emerald-700"}`}>
                {daysLeft <= 5 ? "Premium expiring soon!" : "Premium Active ✨"}
              </p>
              <p className="text-xs text-muted-foreground">
                {daysLeft} day{daysLeft !== 1 ? "s" : ""} left · Expires {expiryDate}
              </p>
            </div>
          </div>
          {daysLeft <= 5 && <Button size="sm" className="rounded-xl" onClick={() => navigate("/dashboard/pricing")}>Renew Now</Button>}
        </CardContent>
      </Card>
    );
  }

  if (isTrialActive) {
    const urgency = trialDaysLeft <= 2;
    return (
      <Card className={cn("rounded-2xl border shadow-sm", urgency ? "border-red-200 bg-red-50/60 dark:bg-red-500/5" : "border-blue-200 bg-blue-50/60 dark:bg-blue-500/5")}>
        <CardContent className="flex items-center justify-between py-3.5 flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <div className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-xl", urgency ? "bg-red-100 text-red-600" : "bg-blue-100 text-blue-600")}>
              <Clock className="h-4.5 w-4.5" />
            </div>
            <div>
              <p className={cn("text-sm font-semibold", urgency ? "text-red-700" : "text-blue-700")}>
                Free Trial — {trialDaysLeft} day{trialDaysLeft !== 1 ? "s" : ""} left
              </p>
              <p className="text-xs text-muted-foreground">
                {urgency ? "Trial almost over! Upgrade now to keep access." : "Upgrade anytime to unlock unlimited access."}
              </p>
            </div>
          </div>
          <Button size="sm" className="rounded-xl" variant={urgency ? "destructive" : "default"} onClick={() => navigate("/dashboard/pricing")}>
            <Sparkles className="h-3 w-3 mr-1" /> Upgrade
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (isTrialExpired) {
    return (
      <Card className="rounded-2xl border border-red-200 bg-red-50/60 dark:bg-red-500/5 shadow-sm">
        <CardContent className="flex items-center justify-between py-3.5 flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-red-100 text-red-600">
              <AlertTriangle className="h-4.5 w-4.5" />
            </div>
            <div>
              <p className="text-sm font-semibold text-red-700">Free Trial Expired</p>
              <p className="text-xs text-muted-foreground">Upgrade to continue using all features.</p>
            </div>
          </div>
          <Button size="sm" className="rounded-xl" variant="destructive" onClick={() => navigate("/dashboard/pricing")}>
            <Crown className="h-3 w-3 mr-1" /> Upgrade Now
          </Button>
        </CardContent>
      </Card>
    );
  }

  return null;
}

// ── Professional stat card — Analytics page jaisa hi color-coded style ──────
const CARD_PALETTE = {
  emerald: { bg: "bg-emerald-50 dark:bg-emerald-500/5", border: "border-emerald-100 dark:border-emerald-500/20", text: "text-emerald-600" },
  red:     { bg: "bg-red-50 dark:bg-red-500/5",         border: "border-red-100 dark:border-red-500/20",         text: "text-red-500" },
  blue:    { bg: "bg-blue-50 dark:bg-blue-500/5",       border: "border-blue-100 dark:border-blue-500/20",       text: "text-blue-600" },
  amber:   { bg: "bg-amber-50 dark:bg-amber-500/5",     border: "border-amber-100 dark:border-amber-500/20",     text: "text-amber-600" },
};

function StatCard({ title, value, icon: Icon, tone }: { title: string; value: string; icon: any; tone: keyof typeof CARD_PALETTE }) {
  const p = CARD_PALETTE[tone];
  return (
    <div className={cn("rounded-2xl border p-4 hover:shadow-md transition-all", p.bg, p.border)}>
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs text-muted-foreground font-medium">{title}</span>
        <div className={cn("flex h-7 w-7 items-center justify-center rounded-lg bg-white/70 dark:bg-background/40", p.text)}>
          <Icon className="h-3.5 w-3.5" />
        </div>
      </div>
      <p className={cn("text-xl font-bold tracking-tight", p.text)}>{value}</p>
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-border/60 px-4 py-3 bg-muted/20">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-lg font-bold mt-0.5">{value}</p>
    </div>
  );
}

const STATUS_STYLE: Record<string, string> = {
  paid: "bg-emerald-50 text-emerald-700 border-emerald-200",
  complete: "bg-emerald-50 text-emerald-700 border-emerald-200",
  completed: "bg-emerald-50 text-emerald-700 border-emerald-200",
  pending: "bg-amber-50 text-amber-700 border-amber-200",
  draft: "bg-gray-100 text-gray-600 border-gray-200",
  overdue: "bg-red-50 text-red-700 border-red-200",
  cancelled: "bg-red-50 text-red-700 border-red-200",
};
function StatusPill({ label }: { label: string }) {
  const cls = STATUS_STYLE[label.toLowerCase()] ?? "bg-blue-50 text-blue-700 border-blue-200";
  return <span className={cn("inline-block px-2.5 py-0.5 rounded-full text-[11px] font-medium border capitalize", cls)}>{label}</span>;
}

export default function DashboardHome() {
  const { profile, isOwner, isPremium, userCurrency, isTrialExpired } = useAuth();
  const navigate = useNavigate();

  const [stats, setStats] = useState({ tables: 0, invoices: 0, pending: 0 });
  const [docRevenue, setDocRevenue] = useState(0);
  const [docExpenses, setDocExpenses] = useState(0);
  const [tableRevenue, setTableRevenue] = useState(0);
  const [tableExpenses, setTableExpenses] = useState(0);
  const [docChartData, setDocChartData] = useState<ChartPoint[]>([]);
  const [tableChartData, setTableChartData] = useState<ChartPoint[]>([]);
  const [tableChartById, setTableChartById] = useState<Record<string, ChartPoint[]>>({});
  const [recentTables, setRecentTables] = useState<TableSummary[]>([]);
  const [activeTab, setActiveTab] = useState<TabKey>("tables");
  const [docSummary, setDocSummary] = useState({ invoices: 0, quotations: 0, bills: 0 });
  const [docStatusBreakdown, setDocStatusBreakdown] = useState<{ label: string; count: number; total: number }[]>([]);
  const [tableAnalytics, setTableAnalytics] = useState<TableAnalytics[]>([]);
  const [selectedAnalyticsTableId, setSelectedAnalyticsTableId] = useState<string>("all");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!profile) return;
    const load = async () => {
      setLoading(true);
      const [t, i, p] = await Promise.all([
        supabase.from("user_tables").select("id", { count: "exact", head: true }).eq("user_id", profile.id),
        supabase.from("invoices").select("id", { count: "exact", head: true }).eq("user_id", profile.id),
        isOwner
          ? supabase.from("purchase_requests").select("id", { count: "exact", head: true }).eq("status", "pending")
          : Promise.resolve({ count: 0 } as any),
      ]);
      setStats({ tables: t.count ?? 0, invoices: i.count ?? 0, pending: (p as any).count ?? 0 });

      let docsRev = 0, docsExp = 0;
      const docsDayMap: Record<string, { revenue: number; expense: number }> = {};
      const ensureDocsDay = (k: string) => { if (!docsDayMap[k]) docsDayMap[k] = { revenue: 0, expense: 0 }; };

      const { data: invoiceData } = await supabase.from("invoices").select("type, totals, created_at, status").eq("user_id", profile.id);
      let invCount = 0, quoCount = 0, billCount = 0;
      const statusMap: Record<string, { count: number; total: number }> = {};

      (invoiceData ?? []).forEach((inv: any) => {
        const totals = inv.totals as Record<string, any> | null;
        const grandTotal = toNumberSafe(totals?.grandTotal ?? totals?.grand_total ?? totals?.total ?? 0);
        if (!Number.isFinite(grandTotal)) return;
        const k = dayKey(inv.created_at);
        ensureDocsDay(k);
        const type = String(inv.type || "").toLowerCase();
        const st = String(inv.status || "unknown").toLowerCase();
        if (type === "invoice") invCount++;
        else if (type === "quotation") quoCount++;
        else if (type === "bill") billCount++;
        if (!statusMap[st]) statusMap[st] = { count: 0, total: 0 };
        statusMap[st].count++;
        statusMap[st].total += grandTotal;
        if (type === "invoice" || type === "quotation") { docsRev += grandTotal; docsDayMap[k].revenue += grandTotal; }
        else if (type === "bill") { docsExp += grandTotal; docsDayMap[k].expense += grandTotal; }
      });

      ensureDocsDay(dayKey(new Date().toISOString()));
      setDocSummary({ invoices: invCount, quotations: quoCount, bills: billCount });
      setDocStatusBreakdown(Object.entries(statusMap).map(([label, v]) => ({ label, count: v.count, total: v.total })).sort((a, b) => b.total - a.total));
      setDocRevenue(docsRev);
      setDocExpenses(docsExp);
      setDocChartData(mapToChartPoints(docsDayMap));

      let tblRev = 0, tblExp = 0;
      const allDayMap: Record<string, { revenue: number; expense: number }> = {};
      const ensureAllDay = (k: string) => { if (!allDayMap[k]) allDayMap[k] = { revenue: 0, expense: 0 }; };
      const amountNameRegex = /(amount|revenue|income|sale|sales|price|paid|payment|total|subtotal)/i;
      const expenseNameRegex = /(expense|cost|spent|purchase|fee|charges|rent|salary|tax|gst|vat)/i;

      const { data: allTables } = await supabase.from("user_tables").select("id,name").eq("user_id", profile.id);
      const tableIds = (allTables ?? []).map((x: any) => x.id);
      const perTableMoney: Record<string, { revenue: number; expense: number }> = {};
      const perTableDayMap: Record<string, Record<string, { revenue: number; expense: number }>> = {};
      const ensureTblDay = (tid: string, dk: string) => {
        if (!perTableMoney[tid]) perTableMoney[tid] = { revenue: 0, expense: 0 };
        if (!perTableDayMap[tid]) perTableDayMap[tid] = {};
        if (!perTableDayMap[tid][dk]) perTableDayMap[tid][dk] = { revenue: 0, expense: 0 };
      };

      if (tableIds.length > 0) {
        const { data: colsData } = await supabase.from("user_columns").select("table_id,name,type").in("table_id", tableIds);
        const colsByTable = new Map<string, { name: string; bucket: "revenue" | "expense" }[]>();
        (colsData ?? []).forEach((c: any) => {
          if (c.type !== "number" && c.type !== "currency" && c.type !== "amount") return;
          const colName = String(c.name || "").trim();
          if (!colName || (!amountNameRegex.test(colName) && !expenseNameRegex.test(colName))) return;
          const bucket: "revenue" | "expense" = expenseNameRegex.test(colName) ? "expense" : "revenue";
          const arr = colsByTable.get(c.table_id) ?? [];
          arr.push({ name: colName, bucket });
          colsByTable.set(c.table_id, arr);
        });

        // ✅ sirf un rows ko ginna jo khaali nahi hain — "+Add Row" se bani khaali
        // row ko bhi pehle count kar liya jaata tha, isse chart/number dono me
        // phantom entries aa jaati thi
        const { data: rowsData } = await supabase.from("user_rows").select("table_id,row_data,created_at").in("table_id", tableIds);
        (rowsData ?? []).forEach((r: any) => {
          const cols = colsByTable.get(r.table_id) ?? [];
          if (!cols.length) return;
          const hasAnyValue = Object.values(r.row_data ?? {}).some((v: any) => v !== null && v !== undefined && String(v).trim() !== "");
          if (!hasAnyValue) return;
          const dk = dayKey(r.created_at);
          ensureAllDay(dk);
          ensureTblDay(r.table_id, dk);
          for (const col of cols) {
            const num = toNumberSafe(r.row_data?.[col.name]);
            if (!Number.isFinite(num)) continue;
            if (col.bucket === "revenue") {
              tblRev += num; allDayMap[dk].revenue += num;
              perTableMoney[r.table_id].revenue += num; perTableDayMap[r.table_id][dk].revenue += num;
            } else {
              tblExp += num; allDayMap[dk].expense += num;
              perTableMoney[r.table_id].expense += num; perTableDayMap[r.table_id][dk].expense += num;
            }
          }
        });
      }

      const todayTbl = dayKey(new Date().toISOString());
      ensureAllDay(todayTbl);
      (allTables ?? []).forEach((t: any) => ensureTblDay(t.id, todayTbl));

      setTableRevenue(tblRev);
      setTableExpenses(tblExp);
      setTableChartData(mapToChartPoints(allDayMap));

      const chartById: Record<string, ChartPoint[]> = {};
      (allTables ?? []).forEach((t: any) => { chartById[t.id] = mapToChartPoints(perTableDayMap[t.id] ?? {}); });
      setTableChartById(chartById);

      if ((allTables ?? []).length > 0) {
        const counts = await Promise.all((allTables ?? []).map(async (tb: any) => {
          const { count } = await supabase.from("user_rows").select("id", { count: "exact", head: true }).eq("table_id", tb.id);
          const money = perTableMoney[tb.id] ?? { revenue: 0, expense: 0 };
          return { id: tb.id, name: tb.name, rowCount: count ?? 0, revenue: money.revenue, expense: money.expense, net: money.revenue - money.expense } as TableAnalytics;
        }));
        setTableAnalytics(counts.sort((a, b) => Math.abs(b.net) - Math.abs(a.net)));
      } else setTableAnalytics([]);

      const { data: tablesData } = await supabase.from("user_tables").select("id, name").eq("user_id", profile.id).order("created_at", { ascending: false }).limit(5);
      if (tablesData?.length) {
        const counts = await Promise.all(tablesData.map(async (tb: any) => {
          const { count } = await supabase.from("user_rows").select("id", { count: "exact", head: true }).eq("table_id", tb.id);
          return { id: tb.id, name: tb.name, rowCount: count ?? 0 };
        }));
        setRecentTables(counts);
      } else setRecentTables([]);

      if (selectedAnalyticsTableId !== "all") {
        const exists = (allTables ?? []).some((t: any) => t.id === selectedAnalyticsTableId);
        if (!exists) setSelectedAnalyticsTableId("all");
      }
      setLoading(false);
    };
    load();
  }, [profile, isOwner]);

  const displayName = profile?.display_name || profile?.email?.split("@")[0] || "User";
  const todayLabel = new Date().toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long" });

  const selectedTableAnalytics = selectedAnalyticsTableId !== "all"
    ? tableAnalytics.find(t => t.id === selectedAnalyticsTableId)
    : null;

  const activeRevenue  = activeTab === "documents" ? docRevenue  : selectedTableAnalytics ? selectedTableAnalytics.revenue  : tableRevenue;
  const activeExpenses = activeTab === "documents" ? docExpenses : selectedTableAnalytics ? selectedTableAnalytics.expense : tableExpenses;
  const activeNetProfit = activeRevenue - activeExpenses;
  const selectedTableName = selectedTableAnalytics?.name ?? tableAnalytics.find(t => t.id === selectedAnalyticsTableId)?.name ?? "Selected";
  const activeChartData = activeTab === "documents" ? docChartData : selectedAnalyticsTableId === "all" ? tableChartData : tableChartById[selectedAnalyticsTableId] ?? [];
  const chartTitle = activeTab === "tables"
    ? (selectedAnalyticsTableId === "all" ? "All Tables Overview" : `${selectedTableName}`)
    : "Documents Overview";
  const chartSubtitle = activeTab === "tables"
    ? (selectedAnalyticsTableId === "all" ? "Revenue vs expenses from all tables combined" : `Revenue vs expenses — ${selectedTableName}`)
    : "Daily revenue vs expenses from your documents";

  const quickActions = [
    { label: "Create Table", desc: "Add a new table", icon: Plus, tone: "emerald" as const, onClick: () => navigate("/dashboard/tables") },
    { label: "New Invoice", desc: "Create document", icon: FileText, tone: "blue" as const, onClick: () => navigate("/dashboard/invoices") },
    { label: "New Quotation", desc: "Quote a customer", icon: FileText, tone: "amber" as const, onClick: () => navigate("/dashboard/invoices") },
  ];

  return (
    <div className="animate-fade-in space-y-6">
      {/* ── HEADER ── */}
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold tracking-tight flex items-center gap-2">
            <div className="w-9 h-9 rounded-xl bg-blue-500/10 flex items-center justify-center shrink-0">
              <LayoutDashboard className="w-4.5 h-4.5 text-blue-600" />
            </div>
            Welcome back, {displayName}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">{todayLabel} · Here's what's happening with your business today</p>
        </div>
      </div>

      <PlanBanner />

      {!isOwner && !isPremium && isTrialExpired && (
        <div className="rounded-2xl bg-gradient-to-r from-indigo-600 to-purple-600 p-5 flex flex-col sm:flex-row items-center justify-between gap-4 shadow-lg shadow-indigo-200/60">
          <div className="text-white text-center sm:text-left">
            <p className="font-bold text-base">🔒 Your Free Trial Has Ended</p>
            <p className="text-indigo-100 text-xs mt-0.5">Upgrade to Premium to unlock Tables, Analytics, Documents & more. Your data is safe.</p>
          </div>
          <button
            onClick={() => navigate("/dashboard/pricing")}
            className="shrink-0 bg-white text-indigo-700 font-bold px-6 py-2.5 rounded-xl text-sm hover:bg-indigo-50 transition-all shadow hover:scale-105 active:scale-95 whitespace-nowrap"
          >
            ⭐ Upgrade to Premium
          </button>
        </div>
      )}

      {/* ── TAB SWITCHER — Analytics page ke chart-mode switcher jaisa hi style ── */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-0.5 bg-muted rounded-xl p-1 w-fit">
          {([["tables","Tables",Table2],["documents","Documents",FileText]] as const).map(([k, label, Icon]) => (
            <button key={k} onClick={() => setActiveTab(k as TabKey)}
              className={cn("flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-xs font-medium transition-all",
                activeTab === k ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground")}>
              <Icon className="w-3.5 h-3.5" />{label}
            </button>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">Viewing: <span className="font-medium capitalize text-foreground">{activeTab}</span></p>
      </div>

      {/* ── STAT CARDS ── */}
      <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
        <StatCard
          title={activeTab === "documents" ? "Documents Revenue" : selectedAnalyticsTableId === "all" ? "All Tables Revenue" : `${selectedTableName} Revenue`}
          value={formatCurrency(activeRevenue, userCurrency)} icon={TrendingUp} tone="emerald" />
        <StatCard
          title={activeTab === "documents" ? "Documents Expenses" : selectedAnalyticsTableId === "all" ? "All Tables Expenses" : `${selectedTableName} Expenses`}
          value={formatCurrency(activeExpenses, userCurrency)} icon={TrendingDown} tone="red" />
        <StatCard
          title={activeTab === "documents" ? "Documents Net" : selectedAnalyticsTableId === "all" ? "All Tables Net" : `${selectedTableName} Net`}
          value={formatCurrency(activeNetProfit, userCurrency)} icon={IndianRupee} tone="blue" />
        <StatCard title="Plan" value={isPremium ? "Premium ✨" : "Free Trial"} icon={isPremium ? Crown : Clock} tone="amber" />
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="rounded-2xl border shadow-sm lg:col-span-2">
          <CardHeader className="space-y-2">
            <div className="flex items-start justify-between gap-3 flex-wrap">
              <div>
                <CardTitle className="text-base font-semibold">{chartTitle}</CardTitle>
                <p className="text-xs text-muted-foreground mt-0.5">{chartSubtitle}</p>
              </div>
              {activeTab === "tables" && (
                <div className="min-w-[220px]">
                  <Select value={selectedAnalyticsTableId} onValueChange={setSelectedAnalyticsTableId}>
                    <SelectTrigger className="h-9 rounded-xl"><SelectValue placeholder="Select table" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Tables</SelectItem>
                      {tableAnalytics.map(t => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="h-[220px] flex items-center justify-center">
                <div className="animate-spin w-7 h-7 border-[3px] border-primary border-t-transparent rounded-full" />
              </div>
            ) : activeChartData.length > 0 ? (
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={activeChartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                  <XAxis dataKey="name" tick={{ fontSize: 11 }} tickLine={false} />
                  <YAxis tick={{ fontSize: 11 }} tickLine={false} axisLine={false} width={56} />
                  <Tooltip content={<ChartTooltip cur={userCurrency} />} cursor={{ fill: "rgba(0,0,0,0.03)" }} />
                  <Bar dataKey="revenue" fill="#10b981" radius={[6,6,0,0]} name="Revenue" maxBarSize={44} />
                  <Bar dataKey="expense" fill="#ef4444" radius={[6,6,0,0]} name="Expenses" maxBarSize={44} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex flex-col items-center justify-center h-[220px] text-muted-foreground">
                <TrendingUp className="h-10 w-10 mb-2 opacity-30" />
                <p className="text-sm">No data yet</p>
                <p className="text-xs">{activeTab === "documents" ? "Create invoices/quotations/bills to see charts" : "Add amount columns and rows in tables to see charts"}</p>
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="rounded-2xl border shadow-sm">
          <CardHeader><CardTitle className="text-base font-semibold">Quick Actions</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {quickActions.map(a => {
              const p = CARD_PALETTE[a.tone];
              return (
                <Button key={a.label} variant="ghost" className="w-full justify-start gap-3 h-auto py-2.5 rounded-xl hover:bg-muted/60" onClick={a.onClick}>
                  <div className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-xl", p.bg, p.text)}>
                    <a.icon className="h-4 w-4" />
                  </div>
                  <div className="text-left">
                    <p className="text-sm font-medium">{a.label}</p>
                    <p className="text-xs text-muted-foreground">{a.desc}</p>
                  </div>
                </Button>
              );
            })}
          </CardContent>
        </Card>
      </div>

      <Card className="rounded-2xl border shadow-sm">
        <CardHeader className="flex flex-row items-center justify-between flex-wrap gap-3">
          <CardTitle className="text-base font-semibold">Details</CardTitle>
          <Button size="sm" variant="outline" className="gap-2 rounded-xl" onClick={() => navigate(activeTab === "tables" ? "/dashboard/tables" : "/dashboard/invoices")}>
            {activeTab === "tables" ? <Table2 className="h-4 w-4" /> : <FileText className="h-4 w-4" />}
            Open {activeTab === "tables" ? "Tables" : "Documents"}
          </Button>
        </CardHeader>
        <CardContent className="space-y-4">
          {activeTab === "tables" ? (
            <>
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium">Your Tables (Analysis)</p>
                <Button variant="link" size="sm" className="gap-1" onClick={() => navigate("/dashboard/tables")}>View Details <ArrowRight className="h-3 w-3" /></Button>
              </div>
              {tableAnalytics.length === 0 ? (
                <p className="text-sm text-muted-foreground">No tables yet. Create one to get started.</p>
              ) : (
                <div className="space-y-2">
                  {tableAnalytics.slice(0, 8).map(t => (
                    <div key={t.id} className="rounded-xl border border-border/60 px-4 py-3 hover:bg-muted/40 hover:border-border transition-colors cursor-pointer" onClick={() => setSelectedAnalyticsTableId(t.id)}>
                      <div className="flex items-center justify-between gap-3 flex-wrap">
                        <div className="flex items-center gap-3">
                          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-50 dark:bg-blue-500/10">
                            <Table2 className="h-4 w-4 text-blue-600" />
                          </div>
                          <span className="font-medium text-sm">{t.name}</span>
                          <span className="text-xs text-muted-foreground">({t.rowCount} rows)</span>
                        </div>
                        <div className="flex items-center gap-2 text-xs">
                          <span className="px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 font-medium">+{formatCurrency(t.revenue, userCurrency)}</span>
                          <span className="px-2 py-0.5 rounded-full bg-red-50 text-red-600 font-medium">-{formatCurrency(t.expense, userCurrency)}</span>
                          <span className={cn("px-2 py-0.5 rounded-full font-semibold", t.net >= 0 ? "bg-blue-50 text-blue-700" : "bg-red-50 text-red-700")}>Net: {formatCurrency(t.net, userCurrency)}</span>
                        </div>
                      </div>
                    </div>
                  ))}
                  <p className="text-[11px] text-muted-foreground pt-1">Tip: Click on a table row to view its chart above.</p>
                </div>
              )}
              {recentTables.length > 0 && (
                <div className="pt-2">
                  <p className="text-xs text-muted-foreground mb-2">Recently created</p>
                  <div className="space-y-2">
                    {recentTables.map(t => (
                      <div key={t.id} className="flex items-center justify-between rounded-xl border border-border/60 px-4 py-3 hover:bg-muted/40 transition-colors cursor-pointer" onClick={() => navigate("/dashboard/tables")}>
                        <div className="flex items-center gap-3">
                          <Table2 className="h-4 w-4 text-muted-foreground" />
                          <span className="font-medium text-sm">{t.name}</span>
                        </div>
                        <span className="text-xs text-muted-foreground">{t.rowCount} rows</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          ) : (
            <>
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium">Your Documents</p>
                <Button variant="link" size="sm" className="gap-1" onClick={() => navigate("/dashboard/invoices")}>View Details <ArrowRight className="h-3 w-3" /></Button>
              </div>
              <div className="grid gap-3 grid-cols-3">
                <MiniStat label="Invoices" value={docSummary.invoices} />
                <MiniStat label="Quotations" value={docSummary.quotations} />
                <MiniStat label="Bills" value={docSummary.bills} />
              </div>
              {docStatusBreakdown.length === 0 ? (
                <p className="text-sm text-muted-foreground">No documents yet. Create an invoice/quotation/bill to see breakdown.</p>
              ) : (
                <div className="overflow-x-auto rounded-xl border border-border/60">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b bg-muted/30">
                        <th className="px-4 py-2.5 text-left font-medium text-muted-foreground text-xs uppercase tracking-wide">Status</th>
                        <th className="px-4 py-2.5 text-right font-medium text-muted-foreground text-xs uppercase tracking-wide">Count</th>
                        <th className="px-4 py-2.5 text-right font-medium text-muted-foreground text-xs uppercase tracking-wide">Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {docStatusBreakdown.map(s => (
                        <tr key={s.label} className="border-b border-border/40 last:border-0 hover:bg-muted/20">
                          <td className="px-4 py-2.5"><StatusPill label={s.label} /></td>
                          <td className="px-4 py-2.5 text-right">{s.count}</td>
                          <td className="px-4 py-2.5 text-right font-semibold">{formatCurrency(s.total, userCurrency)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {isOwner && stats.pending > 0 && (
        <Card className="rounded-2xl border border-amber-200 bg-amber-50/50 shadow-sm">
          <CardContent className="flex items-center justify-between py-4">
            <p className="text-sm font-medium">{stats.pending} pending purchase request(s)</p>
            <Button size="sm" variant="outline" className="rounded-xl" onClick={() => navigate("/dashboard/pricing")}>Review</Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
