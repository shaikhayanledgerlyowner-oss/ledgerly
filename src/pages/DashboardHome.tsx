import { useAuth } from "@/contexts/AuthContext";
import { formatCurrency } from "@/lib/currency";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  FileText,
  Table2,
  CreditCard,
  TrendingUp,
  Plus,
  Clock,
  IndianRupee,
  ArrowRight,
  TrendingDown,
} from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface TableSummary {
  id: string;
  name: string;
  rowCount: number;
}

type TabKey = "tables" | "documents";

function toNumberSafe(v: any): number {
  if (v === null || v === undefined || v === "") return 0;
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;

  const s = String(v);
  const cleaned = s.replace(/[₹,\s]/g, "");
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : 0;
}

/** ✅ DAILY key: YYYY-MM-DD */
function dayKey(dateStr: string) {
  const d = new Date(dateStr);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** ✅ DAILY label: "26 Feb" */
function dayLabelFromKey(key: string) {
  const [y, m, d] = key.split("-").map(Number);
  const dt = new Date(y, (m ?? 1) - 1, d ?? 1);
  return dt.toLocaleDateString("en-US", { day: "2-digit", month: "short" });
}

type ChartPoint = { key: string; name: string; revenue: number; expense: number };

function mapToChartPoints(
  map: Record<string, { revenue: number; expense: number }>
): ChartPoint[] {
  return Object.entries(map)
    .map(([key, v]) => ({
      key,
      name: dayLabelFromKey(key),
      revenue: v.revenue,
      expense: v.expense,
    }))
    .sort((a, b) => (a.key > b.key ? 1 : -1));
}

type TableAnalytics = {
  id: string;
  name: string;
  rowCount: number;
  revenue: number;
  expense: number;
  net: number;
};

export default function DashboardHome() {
  // ✅ userCurrency added
  const { profile, isOwner, isPremium, userCurrency } = useAuth();
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

  const [docSummary, setDocSummary] = useState<{
    invoices: number;
    quotations: number;
    bills: number;
  }>({ invoices: 0, quotations: 0, bills: 0 });

  const [docStatusBreakdown, setDocStatusBreakdown] = useState<
    { label: string; count: number; total: number }[]
  >([]);

  const [tableAnalytics, setTableAnalytics] = useState<TableAnalytics[]>([]);
  const [selectedAnalyticsTableId, setSelectedAnalyticsTableId] = useState<string>("all");

  useEffect(() => {
    if (!profile) return;

    const load = async () => {
      const [t, i, p] = await Promise.all([
        supabase
          .from("user_tables")
          .select("id", { count: "exact", head: true })
          .eq("user_id", profile.id),
        supabase
          .from("invoices")
          .select("id", { count: "exact", head: true })
          .eq("user_id", profile.id),
        isOwner
          ? supabase
              .from("purchase_requests")
              .select("id", { count: "exact", head: true })
              .eq("status", "pending")
          : Promise.resolve({ count: 0 } as any),
      ]);

      setStats({
        tables: t.count ?? 0,
        invoices: i.count ?? 0,
        pending: (p as any).count ?? 0,
      });

      // --------- DOCUMENTS ANALYTICS ----------
      let docsRev = 0;
      let docsExp = 0;
      const docsDayMap: Record<string, { revenue: number; expense: number }> = {};

      const ensureDocsDay = (k: string) => {
        if (!docsDayMap[k]) docsDayMap[k] = { revenue: 0, expense: 0 };
      };

      const { data: invoiceData } = await supabase
        .from("invoices")
        .select("type, totals, created_at, status")
        .eq("user_id", profile.id);

      let invCount = 0;
      let quoCount = 0;
      let billCount = 0;

      const statusMap: Record<string, { count: number; total: number }> = {};

      (invoiceData ?? []).forEach((inv: any) => {
        const totals = inv.totals as Record<string, any> | null;
        const grandTotal = toNumberSafe(
          totals?.grandTotal ?? totals?.grand_total ?? totals?.total ?? 0
        );
        if (!Number.isFinite(grandTotal)) return;

        const k = dayKey(inv.created_at);
        ensureDocsDay(k);

        const type = String(inv.type || "").toLowerCase();
        const st = String(inv.status || "unknown").toLowerCase();

        if (type === "invoice") invCount += 1;
        else if (type === "quotation") quoCount += 1;
        else if (type === "bill") billCount += 1;

        if (!statusMap[st]) statusMap[st] = { count: 0, total: 0 };
        statusMap[st].count += 1;
        statusMap[st].total += grandTotal;

        if (type === "invoice" || type === "quotation") {
          docsRev += grandTotal;
          docsDayMap[k].revenue += grandTotal;
        } else if (type === "bill") {
          docsExp += grandTotal;
          docsDayMap[k].expense += grandTotal;
        }
      });

      const todayDocs = dayKey(new Date().toISOString());
      ensureDocsDay(todayDocs);

      setDocSummary({ invoices: invCount, quotations: quoCount, bills: billCount });

      const statusArr = Object.entries(statusMap)
        .map(([label, v]) => ({ label, count: v.count, total: v.total }))
        .sort((a, b) => b.total - a.total);
      setDocStatusBreakdown(statusArr);

      setDocRevenue(docsRev);
      setDocExpenses(docsExp);
      setDocChartData(mapToChartPoints(docsDayMap));

      // --------- TABLE ANALYTICS ----------
      let tblRev = 0;
      let tblExp = 0;

      const allDayMap: Record<string, { revenue: number; expense: number }> = {};
      const ensureAllDay = (k: string) => {
        if (!allDayMap[k]) allDayMap[k] = { revenue: 0, expense: 0 };
      };

      const amountNameRegex =
        /(amount|revenue|income|sale|sales|price|paid|payment|total|subtotal)/i;
      const expenseNameRegex =
        /(expense|cost|spent|purchase|fee|charges|rent|salary|tax|gst|vat)/i;

      const { data: allTables } = await supabase
        .from("user_tables")
        .select("id,name")
        .eq("user_id", profile.id);

      const tableIds = (allTables ?? []).map((x: any) => x.id);

      const perTableMoney: Record<string, { revenue: number; expense: number }> = {};
      const perTableDayMap: Record<string, Record<string, { revenue: number; expense: number }>> =
        {};

      const ensureTbl = (tid: string) => {
        if (!perTableMoney[tid]) perTableMoney[tid] = { revenue: 0, expense: 0 };
        if (!perTableDayMap[tid]) perTableDayMap[tid] = {};
      };

      const ensureTblDay = (tid: string, dk: string) => {
        ensureTbl(tid);
        if (!perTableDayMap[tid][dk]) perTableDayMap[tid][dk] = { revenue: 0, expense: 0 };
      };

      if (tableIds.length > 0) {
        const { data: colsData } = await supabase
          .from("user_columns")
          .select("table_id,name,type")
          .in("table_id", tableIds);

        const colsByTable = new Map<string, { name: string; bucket: "revenue" | "expense" }[]>();

        (colsData ?? []).forEach((c: any) => {
          const typeOk = c.type === "number" || c.type === "currency";
          if (!typeOk) return;

          const colName = String(c.name || "").trim();
          if (!colName) return;

          const looksRelevant = amountNameRegex.test(colName) || expenseNameRegex.test(colName);
          if (!looksRelevant) return;

          const bucket: "revenue" | "expense" = expenseNameRegex.test(colName)
            ? "expense"
            : "revenue";

          const arr = colsByTable.get(c.table_id) ?? [];
          arr.push({ name: colName, bucket });
          colsByTable.set(c.table_id, arr);
        });

        const { data: rowsData } = await supabase
          .from("user_rows")
          .select("table_id,row_data,created_at")
          .in("table_id", tableIds);

        (rowsData ?? []).forEach((r: any) => {
          const cols = colsByTable.get(r.table_id) ?? [];
          if (cols.length === 0) return;

          const dk = dayKey(r.created_at);
          ensureAllDay(dk);
          ensureTblDay(r.table_id, dk);

          for (const col of cols) {
            const raw = r.row_data?.[col.name];
            const num = toNumberSafe(raw);
            if (!Number.isFinite(num)) continue;

            if (col.bucket === "revenue") {
              tblRev += num;
              allDayMap[dk].revenue += num;
              perTableMoney[r.table_id] = perTableMoney[r.table_id] ?? { revenue: 0, expense: 0 };
              perTableMoney[r.table_id].revenue += num;
              perTableDayMap[r.table_id][dk].revenue += num;
            } else {
              tblExp += num;
              allDayMap[dk].expense += num;
              perTableMoney[r.table_id] = perTableMoney[r.table_id] ?? { revenue: 0, expense: 0 };
              perTableMoney[r.table_id].expense += num;
              perTableDayMap[r.table_id][dk].expense += num;
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
      (allTables ?? []).forEach((t: any) => {
        const tid = t.id;
        const dmap = perTableDayMap[tid] ?? {};
        chartById[tid] = mapToChartPoints(dmap);
      });
      setTableChartById(chartById);

      if ((allTables ?? []).length > 0) {
        const counts = await Promise.all(
          (allTables ?? []).map(async (tb: any) => {
            const { count } = await supabase
              .from("user_rows")
              .select("id", { count: "exact", head: true })
              .eq("table_id", tb.id);

            const money = perTableMoney[tb.id] ?? { revenue: 0, expense: 0 };
            return {
              id: tb.id,
              name: tb.name,
              rowCount: count ?? 0,
              revenue: money.revenue,
              expense: money.expense,
              net: money.revenue - money.expense,
            } as TableAnalytics;
          })
        );

        setTableAnalytics(counts.sort((a, b) => Math.abs(b.net) - Math.abs(a.net)));
      } else {
        setTableAnalytics([]);
      }

      const { data: tablesData } = await supabase
        .from("user_tables")
        .select("id, name")
        .eq("user_id", profile.id)
        .order("created_at", { ascending: false })
        .limit(5);

      if (tablesData && tablesData.length > 0) {
        const counts = await Promise.all(
          tablesData.map(async (tb: any) => {
            const { count } = await supabase
              .from("user_rows")
              .select("id", { count: "exact", head: true })
              .eq("table_id", tb.id);
            return { id: tb.id, name: tb.name, rowCount: count ?? 0 };
          })
        );
        setRecentTables(counts);
      } else {
        setRecentTables([]);
      }

      if (selectedAnalyticsTableId !== "all") {
        const exists = (allTables ?? []).some((t: any) => t.id === selectedAnalyticsTableId);
        if (!exists) setSelectedAnalyticsTableId("all");
      }
    };

    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile, isOwner]);

  const displayName = profile?.display_name || profile?.email?.split("@")[0] || "User";

  const activeRevenue = activeTab === "tables" ? tableRevenue : docRevenue;
  const activeExpenses = activeTab === "tables" ? tableExpenses : docExpenses;
  const activeNetProfit = activeRevenue - activeExpenses;

  const activeChartData =
    activeTab === "documents"
      ? docChartData
      : selectedAnalyticsTableId === "all"
      ? tableChartData
      : tableChartById[selectedAnalyticsTableId] ?? [];

  const chartTitle =
    activeTab === "tables"
      ? selectedAnalyticsTableId === "all"
        ? "Tables Overview (All)"
        : `Tables Overview (${
            tableAnalytics.find((t) => t.id === selectedAnalyticsTableId)?.name ?? "Selected"
          })`
      : "Documents Overview";

  const chartSubtitle =
    activeTab === "tables"
      ? selectedAnalyticsTableId === "all"
        ? "Daily revenue vs expenses from all tables"
        : "Daily revenue vs expenses from selected table"
      : "Daily revenue vs expenses from your documents";

  const quickActions = [
    {
      label: "Create Table",
      desc: "Add a new table",
      icon: Plus,
      color: "text-success",
      bg: "bg-success/10",
      onClick: () => navigate("/dashboard/tables"),
    },
    {
      label: "New Invoice",
      desc: "Create document",
      icon: FileText,
      color: "text-info",
      bg: "bg-info/10",
      onClick: () => navigate("/dashboard/invoices"),
    },
    {
      label: "New Quotation",
      desc: "Quote a customer",
      icon: FileText,
      color: "text-primary",
      bg: "bg-primary/10",
      onClick: () => navigate("/dashboard/invoices"),
    },
  ];

  return (
    <div className="animate-fade-in space-y-6">
      <div>
        <h1 className="text-2xl md:text-3xl font-display font-bold">
          Welcome back, {displayName}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Here's what's happening with your business today
        </p>
      </div>

      {/* MAIN TOGGLE */}
      <Card className="glass-card">
        <CardContent className="py-3 flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant={activeTab === "tables" ? "default" : "outline"}
              className="gap-2"
              onClick={() => setActiveTab("tables")}
            >
              <Table2 className="h-4 w-4" />
              Tables
            </Button>

            <Button
              size="sm"
              variant={activeTab === "documents" ? "default" : "outline"}
              className="gap-2"
              onClick={() => setActiveTab("documents")}
            >
              <FileText className="h-4 w-4" />
              Documents
            </Button>
          </div>

          <p className="text-xs text-muted-foreground">
            Viewing: <span className="font-medium capitalize">{activeTab}</span>
          </p>
        </CardContent>
      </Card>

      {/* ✅ Stat Cards — formatCurrency se */}
      <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
        <StatCard
          title={activeTab === "tables" ? "Tables Revenue" : "Documents Revenue"}
          value={formatCurrency(activeRevenue, userCurrency)}
          icon={TrendingUp}
          color="text-success"
        />
        <StatCard
          title={activeTab === "tables" ? "Tables Expenses" : "Documents Expenses"}
          value={formatCurrency(activeExpenses, userCurrency)}
          icon={TrendingDown}
          color="text-destructive"
        />
        <StatCard
          title={activeTab === "tables" ? "Tables Net" : "Documents Net"}
          value={formatCurrency(activeNetProfit, userCurrency)}
          icon={IndianRupee}
          color="text-primary"
        />
        <StatCard
          title="Plan"
          value={isPremium ? "Premium" : "Free"}
          icon={CreditCard}
          color="text-accent"
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Chart */}
        <Card className="glass-card lg:col-span-2">
          <CardHeader className="space-y-2">
            <div className="flex items-start justify-between gap-3 flex-wrap">
              <div>
                <CardTitle className="text-base">{chartTitle}</CardTitle>
                <p className="text-xs text-muted-foreground">{chartSubtitle}</p>
              </div>

              {activeTab === "tables" && (
                <div className="min-w-[220px]">
                  <Select value={selectedAnalyticsTableId} onValueChange={setSelectedAnalyticsTableId}>
                    <SelectTrigger className="h-9">
                      <SelectValue placeholder="Select table" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Tables</SelectItem>
                      {tableAnalytics.map((t) => (
                        <SelectItem key={t.id} value={t.id}>
                          {t.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>
          </CardHeader>

          <CardContent>
            {activeChartData.length > 0 ? (
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={activeChartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip />
                  <Bar
                    dataKey="revenue"
                    fill="hsl(152,69%,31%)"
                    radius={[4, 4, 0, 0]}
                    name="Revenue"
                  />
                  <Bar
                    dataKey="expense"
                    fill="hsl(0,72%,51%)"
                    radius={[4, 4, 0, 0]}
                    name="Expenses"
                  />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex flex-col items-center justify-center h-[220px] text-muted-foreground">
                <TrendingUp className="h-10 w-10 mb-2 opacity-30" />
                <p className="text-sm">No data yet</p>
                <p className="text-xs">
                  {activeTab === "documents"
                    ? "Create invoices/quotations/bills to see charts"
                    : "Add amount columns and rows in tables to see charts"}
                </p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Quick Actions */}
        <Card className="glass-card">
          <CardHeader>
            <CardTitle className="text-base">Quick Actions</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {quickActions.map((a) => (
              <Button
                key={a.label}
                variant="ghost"
                className="w-full justify-start gap-3 h-auto py-2.5"
                onClick={a.onClick}
              >
                <div className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-lg", a.bg)}>
                  <a.icon className={cn("h-4 w-4", a.color)} />
                </div>
                <div className="text-left">
                  <p className="text-sm font-medium">{a.label}</p>
                  <p className="text-xs text-muted-foreground">{a.desc}</p>
                </div>
              </Button>
            ))}
          </CardContent>
        </Card>
      </div>

      {/* Details */}
      <Card className="glass-card">
        <CardHeader className="flex flex-row items-center justify-between flex-wrap gap-3">
          <CardTitle className="text-base">Details</CardTitle>

          <Button
            size="sm"
            variant="outline"
            className="gap-2"
            onClick={() => navigate(activeTab === "tables" ? "/dashboard/tables" : "/dashboard/invoices")}
          >
            {activeTab === "tables" ? <Table2 className="h-4 w-4" /> : <FileText className="h-4 w-4" />}
            Open {activeTab === "tables" ? "Tables" : "Documents"}
          </Button>
        </CardHeader>

        <CardContent className="space-y-4">
          {activeTab === "tables" ? (
            <>
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium">Your Tables (Analysis)</p>
                <Button variant="link" size="sm" className="gap-1" onClick={() => navigate("/dashboard/tables")}>
                  View Details <ArrowRight className="h-3 w-3" />
                </Button>
              </div>

              {tableAnalytics.length === 0 ? (
                <p className="text-sm text-muted-foreground">No tables yet. Create one to get started.</p>
              ) : (
                <div className="space-y-2">
                  {tableAnalytics.slice(0, 8).map((t) => (
                    <div
                      key={t.id}
                      className="rounded-lg border border-border/50 px-4 py-3 hover:bg-muted/30 transition-colors cursor-pointer"
                      onClick={() => setSelectedAnalyticsTableId(t.id)}
                    >
                      <div className="flex items-center justify-between gap-3 flex-wrap">
                        <div className="flex items-center gap-3">
                          <Table2 className="h-4 w-4 text-muted-foreground" />
                          <span className="font-medium text-sm">{t.name}</span>
                          <span className="text-xs text-muted-foreground">({t.rowCount} rows)</span>
                        </div>

                        {/* ✅ formatCurrency se */}
                        <div className="flex items-center gap-4 text-xs">
                          <span className="text-success font-medium">+{formatCurrency(t.revenue, userCurrency)}</span>
                          <span className="text-destructive font-medium">-{formatCurrency(t.expense, userCurrency)}</span>
                          <span className={cn("font-semibold", t.net >= 0 ? "text-primary" : "text-destructive")}>
                            Net: {formatCurrency(t.net, userCurrency)}
                          </span>
                        </div>
                      </div>
                    </div>
                  ))}
                  <p className="text-[11px] text-muted-foreground">
                    Tip: kisi table pe click karo, upar chart automatically us table ka ho jayega.
                  </p>
                </div>
              )}

              {recentTables.length > 0 && (
                <div className="pt-2">
                  <p className="text-xs text-muted-foreground mb-2">Recently created</p>
                  <div className="space-y-2">
                    {recentTables.map((t) => (
                      <div
                        key={t.id}
                        className="flex items-center justify-between rounded-lg border border-border/50 px-4 py-3 hover:bg-muted/30 transition-colors cursor-pointer"
                        onClick={() => navigate("/dashboard/tables")}
                      >
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
                <Button variant="link" size="sm" className="gap-1" onClick={() => navigate("/dashboard/invoices")}>
                  View Details <ArrowRight className="h-3 w-3" />
                </Button>
              </div>

              <div className="grid gap-3 grid-cols-3">
                <MiniStat label="Invoices" value={docSummary.invoices} />
                <MiniStat label="Quotations" value={docSummary.quotations} />
                <MiniStat label="Bills" value={docSummary.bills} />
              </div>

              {docStatusBreakdown.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No documents yet. Create an invoice/quotation/bill to see breakdown.
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b">
                        <th className="px-3 py-2 text-left font-medium text-muted-foreground">Status</th>
                        <th className="px-3 py-2 text-right font-medium text-muted-foreground">Count</th>
                        <th className="px-3 py-2 text-right font-medium text-muted-foreground">Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {/* ✅ formatCurrency se */}
                      {docStatusBreakdown.map((s) => (
                        <tr key={s.label} className="border-b border-border/50">
                          <td className="px-3 py-2 capitalize">{s.label}</td>
                          <td className="px-3 py-2 text-right">{s.count}</td>
                          <td className="px-3 py-2 text-right font-medium">{formatCurrency(s.total, userCurrency)}</td>
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
        <Card className="glass-card border-warning/30">
          <CardContent className="flex items-center justify-between py-4">
            <p className="text-sm font-medium">{stats.pending} pending verification request(s)</p>
            <Button size="sm" variant="outline" onClick={() => navigate("/dashboard/verification")}>
              Review
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-border/50 px-4 py-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-lg font-bold">{value}</p>
    </div>
  );
}

function StatCard({
  title,
  value,
  icon: Icon,
  color,
}: {
  title: string;
  value: string;
  icon: any;
  color: string;
}) {
  return (
    <Card className="glass-card">
      <CardContent className="flex items-center gap-4 pt-6">
        <div className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-muted", color)}>
          <Icon className="h-5 w-5" />
        </div>
        <div>
          <p className="text-xs text-muted-foreground">{title}</p>
          <p className="text-lg font-bold">{value}</p>
        </div>
      </CardContent>
    </Card>
  );
}
