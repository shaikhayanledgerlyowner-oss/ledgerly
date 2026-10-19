import { useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import {
  BarChart, Bar, LineChart, Line, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer, ComposedChart,
} from "recharts";
import {
  TrendingUp, IndianRupee, Download, Table2, FileText,
  BarChart2, PieChart as PieIcon, LayoutDashboard,
  ArrowUpRight, ArrowDownRight, Minus,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { formatCurrency, formatCurrencyPDF, getCurrencySymbol } from "@/lib/currency";
import { cn } from "@/lib/utils";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import SavedAnalyses from "@/components/SavedAnalyses";

interface DbTable  { id: string; name: string; }
interface DbColumn { id: string; table_id: string; name: string; type: string; }
interface DbRow    { id: string; table_id: string; row_data: Record<string, any>; created_at: string; }
interface DbInvoice{ type: string; totals: Record<string, any> | null; created_at: string; status: string; }

const COLORS = ["#3b82f6","#22c55e","#f59e0b","#ef4444","#a855f7","#06b6d4","#f97316","#ec4899","#84cc16","#14b8a6"];
const toNum = (v: any) => { if (v == null || v === "") return 0; const n = Number(String(v).replace(/,/g, "")); return isFinite(n) ? n : 0; };
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
function toDMY(iso: string) { if (!iso) return ""; const d = new Date(iso + "T00:00:00"); if (isNaN(d.getTime())) return iso; return `${String(d.getDate()).padStart(2,"0")}/${String(d.getMonth()+1).padStart(2,"0")}/${d.getFullYear()}`; }
type ChartMode = "bar" | "line" | "pie" | "composed";
type ViewMode = "tables" | "documents";
type DocTypeFilter = "all" | "invoice" | "quotation" | "bill";

const CustomTooltip = ({ active, payload, label, cur }: any) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-white border border-gray-100 rounded-2xl shadow-2xl p-4 text-xs min-w-[160px]">
      <p className="font-bold text-gray-800 mb-2 pb-2 border-b border-gray-100">{label}</p>
      {payload.map((p: any, i: number) => (
        <div key={i} className="flex items-center justify-between gap-4 py-1">
          <span className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full" style={{ background: p.color }} />
            <span className="text-gray-500">{p.name}</span>
          </span>
          <span className="font-bold text-gray-900">{formatCurrency(p.value, cur)}</span>
        </div>
      ))}
    </div>
  );
};

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
  const cls = STATUS_STYLE[(label || "").toLowerCase()] ?? "bg-blue-50 text-blue-700 border-blue-200";
  return <span className={cn("inline-block px-2.5 py-0.5 rounded-full text-[11px] font-medium border capitalize", cls)}>{label || "unknown"}</span>;
}

// ── Canvas chart renderers for PDF ──────────────────────────────────────────
function drawBarChart(canvas: HTMLCanvasElement, chartRows: Record<string,any>[], amtCol: string, cur: string) {
  const ctx = canvas.getContext("2d")!;
  const W = canvas.width, H = canvas.height;
  const pad = { top: 30, right: 30, bottom: 60, left: 80 };
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, W, H);

  const vals = chartRows.map(r => toNum(r[amtCol]));
  const maxV = Math.max(...vals, 1);
  const chartH = H - pad.top - pad.bottom;
  const chartW = W - pad.left - pad.right;
  const barW = Math.min(44, chartW / chartRows.length - 8);

  [0, 0.25, 0.5, 0.75, 1].forEach(f => {
    const y = pad.top + chartH * (1 - f);
    ctx.strokeStyle = f === 0 ? "#e5e7eb" : "#f3f4f6";
    ctx.lineWidth = f === 0 ? 1.5 : 1;
    ctx.beginPath(); ctx.moveTo(pad.left, y); ctx.lineTo(W - pad.right, y); ctx.stroke();
    ctx.fillStyle = "#9ca3af"; ctx.font = "10px Arial"; ctx.textAlign = "right";
    ctx.fillText(formatCurrencyPDF(maxV * f, cur).replace(/\.00$/, ""), pad.left - 8, y + 4);
  });

  chartRows.forEach((r, i) => {
    const x = pad.left + i * (chartW / chartRows.length) + (chartW / chartRows.length - barW) / 2;
    const barH = (toNum(r[amtCol]) / maxV) * chartH;
    const y = pad.top + chartH - barH;
    const grad = ctx.createLinearGradient(x, y, x, y + barH);
    grad.addColorStop(0, "#3b82f6");
    grad.addColorStop(1, "#1d4ed8");
    ctx.fillStyle = grad;
    ctx.beginPath();
    if (typeof (ctx as any).roundRect === "function") { (ctx as any).roundRect(x, y, barW, barH, 4); } else { ctx.rect(x, y, barW, barH); }
    ctx.fill();
    ctx.fillStyle = "#374151"; ctx.font = "bold 9px Arial"; ctx.textAlign = "center";
    if (barH > 16) ctx.fillText(formatCurrencyPDF(toNum(r[amtCol]), cur).replace(/\.00$/, ""), x + barW / 2, y - 5);
    ctx.fillStyle = "#6b7280"; ctx.font = "9px Arial";
    ctx.fillText(String(r.name).slice(0, 10), x + barW / 2, H - pad.bottom + 16);
  });
}

function drawPieChart(canvas: HTMLCanvasElement, chartRows: Record<string,any>[], amtCol: string) {
  const ctx = canvas.getContext("2d")!;
  const W = canvas.width, H = canvas.height;
  ctx.clearRect(0, 0, W, H); ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, W, H);

  const data = chartRows.map(r => ({ name: String(r.name), value: toNum(r[amtCol]) })).filter(d => d.value > 0);
  const total = data.reduce((s, d) => s + d.value, 0);
  const cx = W * 0.36, cy = H / 2, r = Math.min(W, H) * 0.33, innerR = r * 0.45;

  let startAngle = -Math.PI / 2;
  data.forEach((d, i) => {
    const slice = (d.value / total) * 2 * Math.PI;
    ctx.beginPath(); ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, r, startAngle, startAngle + slice);
    ctx.closePath(); ctx.fillStyle = COLORS[i % COLORS.length]; ctx.fill();
    ctx.strokeStyle = "#fff"; ctx.lineWidth = 2.5; ctx.stroke();
    startAngle += slice;
  });

  ctx.beginPath(); ctx.arc(cx, cy, innerR, 0, 2 * Math.PI);
  ctx.fillStyle = "#fff"; ctx.fill();

  ctx.fillStyle = "#374151"; ctx.font = "bold 11px Arial"; ctx.textAlign = "center";
  ctx.fillText("Total", cx, cy - 4);
  ctx.font = "bold 10px Arial"; ctx.fillStyle = "#111827";
  ctx.fillText(String(data.length) + " items", cx, cy + 12);

  const legendX = W * 0.68, legendY = H * 0.1;
  data.slice(0, 9).forEach((d, i) => {
    const y = legendY + i * 20;
    ctx.fillStyle = COLORS[i % COLORS.length];
    ctx.beginPath(); if (typeof (ctx as any).roundRect === "function") { (ctx as any).roundRect(legendX, y, 12, 12, 2); } else { ctx.rect(legendX, y, 12, 12); } ctx.fill();
    ctx.fillStyle = "#374151"; ctx.font = "9px Arial"; ctx.textAlign = "left";
    const pct = ((d.value / total) * 100).toFixed(1);
    ctx.fillText(`${String(d.name).slice(0, 14)}  ${pct}%`, legendX + 16, y + 10);
  });
}

// ✅ same x-label (jaise same date) ki multiple rows ko ek bar/slice me jod
// deta hai — chart saaf rehta hai. Data Table (detail view) alag rehti hai.
function aggregateByName(rows: Record<string, any>[], amtCols: { name: string }[]) {
  const order: string[] = [];
  const map = new Map<string, Record<string, any>>();
  rows.forEach(r => {
    const key = String(r.name);
    if (!map.has(key)) {
      const entry: Record<string, any> = { name: key };
      amtCols.forEach(c => (entry[c.name] = 0));
      map.set(key, entry);
      order.push(key);
    }
    const entry = map.get(key)!;
    amtCols.forEach(c => (entry[c.name] += toNum(r[c.name])));
  });
  return order.map(k => map.get(k)!);
}

type Pivot = {
  table: DbTable; tCols: DbColumn[]; amtCols: DbColumn[];
  chartRows: Record<string,any>[]; detailRows: Record<string,any>[];
  stats: { col: DbColumn; total: number; avg: number; max: number; min: number; count: number }[];
  xCol: string;
};

export default function AnalyticsPage() {
  const { profile, hasAccess, userCurrency } = useAuth();
  const uid = profile?.id;
  const cur = userCurrency || "INR";

  const [tables, setTables] = useState<DbTable[]>([]);
  const [columns, setColumns] = useState<DbColumn[]>([]);
  const [rows, setRows] = useState<DbRow[]>([]);
  const [invoices, setInvoices] = useState<DbInvoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [xAxisMap, setXAxisMap] = useState<Record<string, string>>({});
  const [chartMode, setChartMode] = useState<ChartMode>("bar");
  const [activeTable, setActiveTable] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>("tables");
  const [docTypeFilter, setDocTypeFilter] = useState<DocTypeFilter>("all");

  useEffect(() => {
    if (!uid) return;
    (async () => {
      setLoading(true);
      const [tblsRes, invRes] = await Promise.all([
        supabase.from("user_tables").select("id,name").eq("user_id", uid),
        supabase.from("invoices").select("type, totals, created_at, status").eq("user_id", uid),
      ]);
      const tableList = (tblsRes.data ?? []) as DbTable[];
      setTables(tableList);
      setInvoices((invRes.data ?? []) as DbInvoice[]);

      if (tableList.length) {
        const ids = tableList.map(t => t.id);
        const { data: cols } = await supabase.from("user_columns").select("*").in("table_id", ids);
        const allCols = (cols ?? []) as DbColumn[];
        setColumns(allCols);
        const amtTids = [...new Set(allCols.filter(c => c.type === "amount").map(c => c.table_id))];
        if (amtTids.length) {
          const { data: rowData } = await supabase.from("user_rows").select("*").in("table_id", amtTids).order("created_at");
          setRows(((rowData ?? []) as DbRow[]).map(r => ({ ...r, row_data: r.row_data ?? {} })));
          const map: Record<string, string> = {};
          amtTids.forEach(tid => {
            const tCols = allCols.filter(c => c.table_id === tid);
            map[tid] = (tCols.find(c => c.type === "date") || tCols.find(c => c.type === "text") || tCols[0])?.name ?? "";
          });
          setXAxisMap(map);
          setActiveTable(amtTids[0]);
        }
      }
      setLoading(false);
    })();
  }, [uid]);

  // ── Tables mode: ek pivot per table (jin me Amount column hai) ────────────
  const pivotData = useMemo((): Pivot[] => {
    return tables.map(table => {
      const tCols = columns.filter(c => c.table_id === table.id);
      const amtCols = tCols.filter(c => c.type === "amount");
      if (!amtCols.length) return null;

      // khaali ("+Add Row" se bani) rows hata do — pehle "Row 11,12..." bankar
      // ghost entries ki tarah chart/stats me aa rahi thi
      const tRowsAll = rows.filter(r => r.table_id === table.id);
      const tRows = tRowsAll.filter(r =>
        tCols.some(c => {
          const v = r.row_data?.[c.name];
          return v !== null && v !== undefined && String(v).trim() !== "";
        })
      );
      if (!tRows.length) return null;

      const xCol = xAxisMap[table.id] ?? "";
      const rawChartRows = tRows.map((r, i) => {
        const raw = xCol ? r.row_data[xCol] : null;
        const xVal = raw != null && raw !== ""
          ? (tCols.find(c => c.name === xCol)?.type === "date" ? toDMY(String(raw)) : String(raw))
          : `Row ${i + 1}`;
        const entry: Record<string, any> = { name: xVal };
        amtCols.forEach(c => { entry[c.name] = toNum(r.row_data[c.name]); });
        return entry;
      });
      const chartRows = aggregateByName(rawChartRows, amtCols);

      const stats = amtCols.map(col => {
        const vals = tRows.map(r => toNum(r.row_data[col.name]));
        const total = vals.reduce((a, b) => a + b, 0);
        const nz = vals.filter(v => v > 0);
        return { col, total, avg: nz.length ? total / nz.length : 0, max: Math.max(...vals), min: nz.length ? Math.min(...nz) : 0, count: nz.length };
      });
      return { table, tCols, amtCols, chartRows, detailRows: rawChartRows, stats, xCol };
    }).filter(Boolean) as Pivot[];
  }, [tables, columns, rows, xAxisMap]);

  // ── Documents mode: Invoices/Quotations/Bills ko Amount ki tarah treat karo ─
  const DOC_LABELS: Record<DocTypeFilter, string> = { all: "All Documents", invoice: "Invoices", quotation: "Quotations", bill: "Bills" };
  const docTypeCounts = useMemo(() => {
    const c = { invoice: 0, quotation: 0, bill: 0 };
    invoices.forEach(inv => {
      const t = String(inv.type || "").toLowerCase();
      if (t === "invoice") c.invoice++; else if (t === "quotation") c.quotation++; else if (t === "bill") c.bill++;
    });
    return c;
  }, [invoices]);

  const docPivot = useMemo((): Pivot | null => {
    const filtered = invoices.filter(inv => docTypeFilter === "all" ? true : String(inv.type || "").toLowerCase() === docTypeFilter);
    if (!filtered.length) return null;

    const dayMap: Record<string, number> = {};
    const detailRows: Record<string, any>[] = [];
    filtered.forEach(inv => {
      const amt = toNumberSafe(inv.totals?.grandTotal ?? inv.totals?.grand_total ?? inv.totals?.total ?? 0);
      const dk = dayKey(inv.created_at);
      dayMap[dk] = (dayMap[dk] ?? 0) + amt;
      detailRows.push({ name: toDMY(dk), Amount: amt, type: inv.type, status: inv.status });
    });

    const chartRows = Object.entries(dayMap).sort((a, b) => a[0] > b[0] ? 1 : -1).map(([k, v]) => ({ name: toDMY(k), Amount: v }));
    const vals = filtered.map(inv => toNumberSafe(inv.totals?.grandTotal ?? inv.totals?.grand_total ?? inv.totals?.total ?? 0));
    const total = vals.reduce((a, b) => a + b, 0);
    const nz = vals.filter(v => v > 0);
    const amtCols: DbColumn[] = [{ id: "amount", table_id: "documents", name: "Amount", type: "amount" }];
    const stats = [{ col: amtCols[0], total, avg: nz.length ? total / nz.length : 0, max: Math.max(...vals, 0), min: nz.length ? Math.min(...nz) : 0, count: nz.length }];
    const table: DbTable = { id: "documents", name: DOC_LABELS[docTypeFilter] };
    return { table, tCols: amtCols, amtCols, chartRows, detailRows, stats, xCol: "Date" };
  }, [invoices, docTypeFilter]);

  // ── Beautiful PDF ──────────────────────────────────────────────────────────
  const dlPDF = async (pd: Pivot | null) => {
    if (!hasAccess) return toast.error("Upgrade to download analytics");
    if (!pd) return toast.error("No data to export");

    const barC = document.createElement("canvas"); barC.width = 600; barC.height = 240;
    const pieC = document.createElement("canvas"); pieC.width = 600; pieC.height = 240;
    drawBarChart(barC, pd.chartRows, pd.amtCols[0].name, cur);
    drawPieChart(pieC, pd.chartRows, pd.amtCols[0].name);
    const barImg = barC.toDataURL("image/png");
    const pieImg = pieC.toDataURL("image/png");

    const doc = new jsPDF({ orientation: "l", unit: "pt", format: "a4" });
    const pw = doc.internal.pageSize.width;
    const ph = doc.internal.pageSize.height;

    doc.setFillColor(15, 23, 42);
    doc.rect(0, 0, pw, 56, "F");
    doc.setFillColor(59, 130, 246);
    doc.rect(0, 0, 5, 56, "F");

    doc.setTextColor(255, 255, 255);
    doc.setFont("helvetica", "bold"); doc.setFontSize(18);
    doc.text(pd.table.name, 22, 28);
    doc.setFont("helvetica", "normal"); doc.setFontSize(9); doc.setTextColor(148, 163, 184);
    doc.text("Analytics Report", 22, 42);

    doc.setFont("helvetica", "normal"); doc.setFontSize(8); doc.setTextColor(100, 116, 139);
    doc.text(`Generated: ${new Date().toLocaleString("en-IN")}`, pw - 24, 28, { align: "right" });
    doc.text(`Currency: ${cur}`, pw - 24, 42, { align: "right" });

    let y = 72;

    doc.setFont("helvetica", "bold"); doc.setFontSize(10); doc.setTextColor(15, 23, 42);
    doc.text("Summary", 24, y); y += 8;

    pd.stats.forEach(s => {
      const cards = [
        { l: "Total Revenue", v: formatCurrencyPDF(s.total, cur), color: [59, 130, 246] as [number,number,number] },
        { l: "Average", v: formatCurrencyPDF(s.avg, cur), color: [34, 197, 94] as [number,number,number] },
        { l: "Highest Entry", v: formatCurrencyPDF(s.max, cur), color: [245, 158, 11] as [number,number,number] },
        { l: "Lowest Entry", v: formatCurrencyPDF(s.min, cur), color: [239, 68, 68] as [number,number,number] },
        { l: "Total Entries", v: String(s.count), color: [168, 85, 247] as [number,number,number] },
      ];
      const cw = (pw - 48) / cards.length;
      cards.forEach((c, i) => {
        const x = 24 + i * cw;
        doc.setFillColor(248, 250, 252);
        doc.setDrawColor(226, 232, 240);
        doc.roundedRect(x, y, cw - 6, 38, 4, 4, "FD");
        doc.setFillColor(...c.color);
        doc.roundedRect(x, y, cw - 6, 4, 2, 2, "F");
        doc.setFont("helvetica", "normal"); doc.setFontSize(7); doc.setTextColor(100, 116, 139);
        doc.text(c.l, x + 8, y + 15);
        doc.setFont("helvetica", "bold"); doc.setFontSize(9); doc.setTextColor(...c.color);
        doc.text(c.v, x + 8, y + 29);
      });
      y += 46;
    });

    y += 6;

    doc.setFont("helvetica", "bold"); doc.setFontSize(10); doc.setTextColor(15, 23, 42);
    const chartW = (pw - 56) / 2;
    const chartH = 148;

    doc.setFillColor(248, 250, 252); doc.setDrawColor(226, 232, 240);
    doc.roundedRect(24, y, chartW, chartH + 24, 6, 6, "FD");
    doc.roundedRect(32 + chartW, y, chartW, chartH + 24, 6, 6, "FD");

    doc.setTextColor(15, 23, 42); doc.setFont("helvetica", "bold"); doc.setFontSize(9);
    doc.text("Bar Chart  —  " + (pd.amtCols[0]?.name || "Amount"), 32, y + 13);
    doc.text("Distribution  —  Pie Chart", 40 + chartW, y + 13);

    doc.addImage(barImg, "PNG", 26, y + 18, chartW - 4, chartH);
    doc.addImage(pieImg, "PNG", 34 + chartW, y + 18, chartW - 4, chartH);

    y += chartH + 34;

    doc.setFont("helvetica", "bold"); doc.setFontSize(10); doc.setTextColor(15, 23, 42);
    doc.text("Detailed Data", 24, y); y += 6;

    const head = [[pd.xCol || "Row", ...pd.amtCols.map(c => c.name)]];
    const body = pd.detailRows.map(r => [r.name, ...pd.amtCols.map(c => formatCurrencyPDF(r[c.name] ?? 0, cur))]);
    const totalRow = ["TOTAL", ...pd.stats.map(s => formatCurrencyPDF(s.total, cur))];

    autoTable(doc, {
      startY: y,
      head,
      body: [...body, totalRow],
      styles: { font: "helvetica", fontSize: 8, cellPadding: 5, lineColor: [226, 232, 240], lineWidth: 0.5 },
      headStyles: { fillColor: [15, 23, 42], textColor: 255, fontStyle: "bold", fontSize: 8.5 },
      alternateRowStyles: { fillColor: [248, 250, 252] },
      columnStyles: { 0: { fontStyle: "bold", textColor: [15, 23, 42] } },
      didParseCell: (d: any) => {
        if (d.row.index === body.length) {
          d.cell.styles.fillColor = [59, 130, 246];
          d.cell.styles.textColor = [255, 255, 255];
          d.cell.styles.fontStyle = "bold";
        }
      },
      margin: { left: 24, right: 24 },
    });

    doc.setFillColor(248, 250, 252);
    doc.rect(0, ph - 22, pw, 22, "F");
    doc.setFont("helvetica", "normal"); doc.setFontSize(7); doc.setTextColor(148, 163, 184);
    doc.text("Generated by LedgerlyPro · ledgerlypro.in", pw / 2, ph - 8, { align: "center" });

    doc.save(`${pd.table.name}-analytics.pdf`);
    toast.success("Analytics PDF downloaded!");
  };

  const renderChart = (pd: Pivot | null, mode: ChartMode) => {
    if (!pd || !pd.chartRows.length) return null;
    const { chartRows, amtCols } = pd;
    const common = { data: chartRows, margin: { top: 8, right: 24, bottom: 56, left: 16 } };
    const xAx = <XAxis dataKey="name" tick={{ fontSize: 10, fill: "#6b7280" }} tickLine={false} angle={-30} textAnchor="end" interval={0} />;
    const yAx = <YAxis tick={{ fontSize: 10, fill: "#6b7280" }} tickLine={false} axisLine={false} tickFormatter={v => formatCurrency(Number(v), cur)} width={80} />;
    const grid = <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" vertical={false} />;
    const tip = <Tooltip content={<CustomTooltip cur={cur} />} />;
    const leg = <Legend wrapperStyle={{ fontSize: 11, paddingTop: 8 }} />;

    if (mode === "pie") {
      return (
        <div className={`grid gap-6 ${amtCols.length > 1 ? "grid-cols-2" : "grid-cols-1"}`}>
          {amtCols.map((col, ci) => {
            const pd2 = chartRows.map(r => ({ name: r.name, value: r[col.name] ?? 0 })).filter(d => d.value > 0);
            return (
              <div key={col.id}>
                <p className="text-xs font-semibold text-muted-foreground mb-2 text-center">{col.name}</p>
                <ResponsiveContainer width="100%" height={280}>
                  <PieChart>
                    <Pie data={pd2} dataKey="value" nameKey="name" cx="50%" cy="45%" outerRadius={100} innerRadius={42} paddingAngle={3}>
                      {pd2.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                    </Pie>
                    <Tooltip content={<CustomTooltip cur={cur} />} />
                    <Legend wrapperStyle={{ fontSize: 10 }} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            );
          })}
        </div>
      );
    }
    if (mode === "line") {
      return (
        <ResponsiveContainer width="100%" height={300}>
          <LineChart {...common}>{grid}{xAx}{yAx}{tip}{leg}
            {amtCols.map((col, i) => <Line key={col.id} type="monotone" dataKey={col.name} stroke={COLORS[i % COLORS.length]} strokeWidth={2.5} dot={{ r: 4, strokeWidth: 2 }} activeDot={{ r: 6 }} />)}
          </LineChart>
        </ResponsiveContainer>
      );
    }
    if (mode === "composed") {
      return (
        <ResponsiveContainer width="100%" height={300}>
          <ComposedChart {...common}>{grid}{xAx}{yAx}{tip}{leg}
            {amtCols.map((col, i) => i === 0
              ? <Bar key={col.id} dataKey={col.name} fill={COLORS[0]} radius={[6, 6, 0, 0]} maxBarSize={48} />
              : <Line key={col.id} type="monotone" dataKey={col.name} stroke={COLORS[i % COLORS.length]} strokeWidth={2} dot={{ r: 3 }} />
            )}
          </ComposedChart>
        </ResponsiveContainer>
      );
    }
    return (
      <ResponsiveContainer width="100%" height={300}>
        <BarChart {...common}>{grid}{xAx}{yAx}{tip}{leg}
          {amtCols.map((col, i) => <Bar key={col.id} dataKey={col.name} fill={COLORS[i % COLORS.length]} radius={[6, 6, 0, 0]} maxBarSize={48} />)}
        </BarChart>
      </ResponsiveContainer>
    );
  };

  // ── Tables / Documents switch ─────────────────────────────────────────────
  const modeSwitch = (
    <div className="flex items-center gap-0.5 bg-muted rounded-xl p-1 w-fit">
      {([["tables","Tables",Table2],["documents","Documents",FileText]] as const).map(([k, label, Icon]) => (
        <button key={k} onClick={() => setViewMode(k as ViewMode)}
          className={cn("flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-xs font-medium transition-all",
            viewMode === k ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground")}>
          <Icon className="w-3.5 h-3.5" />{label}
        </button>
      ))}
    </div>
  );

  if (loading) return (
    <div className="flex items-center justify-center h-64">
      <div className="animate-spin w-8 h-8 border-4 border-primary border-t-transparent rounded-full" />
    </div>
  );

  if (!pivotData.length && !invoices.length) return (
    <div className="space-y-6 pb-10">
      <h1 className="text-2xl font-bold flex items-center gap-2">
        <div className="w-8 h-8 rounded-lg bg-blue-500/10 flex items-center justify-center">
          <TrendingUp className="w-4 h-4 text-blue-500" />
        </div>
        Analytics
      </h1>

      {/* Tables page se bani analyses seedha yahan */}
      <SavedAnalyses hideEmpty />

      <div className="flex flex-col items-center justify-center py-10 text-center gap-4">
        <div className="w-20 h-20 rounded-2xl bg-muted/50 flex items-center justify-center">
          <IndianRupee className="w-10 h-10 text-muted-foreground/30" />
        </div>
        <div>
          <h3 className="text-lg font-semibold">No data yet</h3>
          <p className="text-muted-foreground text-sm mt-1 max-w-xs">Tables page par kisi sheet me <strong>Create Analysis</strong> dabao, ya invoice/quotation/bill banao, to analytics yahan dikhegi.</p>
        </div>
      </div>
    </div>
  );

  const sym = getCurrencySymbol(cur);
  const activePD: Pivot | null = viewMode === "documents"
    ? docPivot
    : (pivotData.find(p => p.table.id === activeTable) || pivotData[0] || null);

  return (
    <div className="space-y-6 pb-10">

      {/* ── TOP BAR ── */}
      <div className="flex items-start justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-blue-500/10 flex items-center justify-center">
              <TrendingUp className="w-4 h-4 text-blue-500" />
            </div>
            Analytics
          </h1>
          <p className="text-muted-foreground text-sm mt-1">Currency: <strong>{sym} {cur}</strong></p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex items-center gap-0.5 bg-muted rounded-xl p-1">
            {([["bar","Bar",BarChart2],["line","Line",TrendingUp],["pie","Pie",PieIcon],["composed","Mixed",LayoutDashboard]] as const).map(([k, label, Icon]) => (
              <button key={k} onClick={() => setChartMode(k as ChartMode)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${chartMode === k ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"}`}>
                <Icon className="w-3.5 h-3.5" />{label}
              </button>
            ))}
          </div>
          <Button size="sm" onClick={() => dlPDF(activePD)}
            className="h-9 gap-2 text-xs bg-blue-600 hover:bg-blue-700 text-white">
            <Download className="w-3.5 h-3.5" /> Download PDF
          </Button>
        </div>
      </div>

      {/* ── TABLES PAGE SE BANI ANALYSES — seedha yahan dikhti hain ── */}
      <SavedAnalyses hideEmpty />

      {/* ── TABLES / DOCUMENTS SWITCH ── */}
      {modeSwitch}

      {/* ── SELECTOR ROW — table dropdown ya document-type dropdown ── */}
      {viewMode === "tables" ? (
        pivotData.length > 0 ? (
          <div className="flex items-center gap-3 bg-muted/40 border rounded-xl px-4 py-3 flex-wrap">
            <span className="text-xs text-muted-foreground font-medium">Select Table:</span>
            <Select value={activeTable ?? pivotData[0].table.id} onValueChange={setActiveTable}>
              <SelectTrigger className="h-8 w-56 text-xs bg-background">
                <SelectValue placeholder="Choose a table..." />
              </SelectTrigger>
              <SelectContent>
                {pivotData.map(pd => (
                  <SelectItem key={pd.table.id} value={pd.table.id} className="text-xs">{pd.table.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {activePD && (
              <>
                <span className="text-xs text-muted-foreground">X-Axis:</span>
                <Select value={xAxisMap[activePD.table.id] ?? ""} onValueChange={v => setXAxisMap(p => ({ ...p, [activePD.table.id]: v }))}>
                  <SelectTrigger className="h-8 w-40 text-xs bg-background">
                    <SelectValue placeholder="Column..." />
                  </SelectTrigger>
                  <SelectContent>
                    {activePD.tCols.filter(c => c.type !== "amount").map(c => (
                      <SelectItem key={c.id} value={c.name} className="text-xs">{c.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <span className="text-xs text-muted-foreground">Y-Axis: <strong className="text-foreground">{activePD.amtCols.map(c => c.name).join(", ")}</strong></span>
                {activePD.chartRows.length !== activePD.detailRows.length && (
                  <span className="text-[11px] text-muted-foreground ml-auto">Charts show {activePD.chartRows.length} grouped points from {activePD.detailRows.length} rows</span>
                )}
              </>
            )}
          </div>
        ) : (
          <div className="rounded-xl border bg-muted/30 px-4 py-6 text-center text-sm text-muted-foreground">
            No table has an <strong>Amount (₹)</strong> column yet. Set a column's type to Amount on the Tables page to see it here.
          </div>
        )
      ) : (
        <div className="flex items-center gap-3 bg-muted/40 border rounded-xl px-4 py-3 flex-wrap">
          <span className="text-xs text-muted-foreground font-medium">Select Document Type:</span>
          <Select value={docTypeFilter} onValueChange={v => setDocTypeFilter(v as DocTypeFilter)}>
            <SelectTrigger className="h-8 w-48 text-xs bg-background">
              <SelectValue placeholder="Choose..." />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all" className="text-xs">All Documents</SelectItem>
              <SelectItem value="invoice" className="text-xs">Invoices ({docTypeCounts.invoice})</SelectItem>
              <SelectItem value="quotation" className="text-xs">Quotations ({docTypeCounts.quotation})</SelectItem>
              <SelectItem value="bill" className="text-xs">Bills ({docTypeCounts.bill})</SelectItem>
            </SelectContent>
          </Select>
          <span className="text-xs text-muted-foreground">Grouped by: <strong className="text-foreground">Date</strong></span>
        </div>
      )}

      {!activePD ? (
        <div className="rounded-xl border bg-muted/30 px-4 py-10 text-center text-sm text-muted-foreground">
          {viewMode === "documents" ? "No documents match this selection yet." : "No data to show for this table yet."}
        </div>
      ) : (<>

        {viewMode === "documents" && docTypeFilter === "all" && (
          <div className="grid gap-3 grid-cols-3">
            <div className="rounded-xl border border-border/60 px-4 py-3 bg-muted/20">
              <p className="text-xs text-muted-foreground">Invoices</p>
              <p className="text-lg font-bold mt-0.5">{docTypeCounts.invoice}</p>
            </div>
            <div className="rounded-xl border border-border/60 px-4 py-3 bg-muted/20">
              <p className="text-xs text-muted-foreground">Quotations</p>
              <p className="text-lg font-bold mt-0.5">{docTypeCounts.quotation}</p>
            </div>
            <div className="rounded-xl border border-border/60 px-4 py-3 bg-muted/20">
              <p className="text-xs text-muted-foreground">Bills</p>
              <p className="text-lg font-bold mt-0.5">{docTypeCounts.bill}</p>
            </div>
          </div>
        )}

        {/* ── STAT CARDS ── */}
        {activePD.stats.map((s, si) => (
          <div key={s.col.id}>
            {activePD.stats.length > 1 && (
              <p className="text-xs font-semibold text-muted-foreground mb-3 flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full" style={{ background: COLORS[si % COLORS.length] }} />
                {s.col.name}
              </p>
            )}
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
              {[
                { label: "Total", value: formatCurrency(s.total, cur), icon: "Σ", color: "text-blue-600", bg: "bg-blue-50", border: "border-blue-100" },
                { label: "Average", value: formatCurrency(s.avg, cur), icon: "∅", color: "text-emerald-600", bg: "bg-emerald-50", border: "border-emerald-100" },
                { label: "Highest", value: formatCurrency(s.max, cur), icon: <ArrowUpRight className="w-3.5 h-3.5" />, color: "text-orange-500", bg: "bg-orange-50", border: "border-orange-100" },
                { label: "Lowest", value: formatCurrency(s.min, cur), icon: <ArrowDownRight className="w-3.5 h-3.5" />, color: "text-red-500", bg: "bg-red-50", border: "border-red-100" },
                { label: "Entries", value: String(s.count), icon: "#", color: "text-purple-600", bg: "bg-purple-50", border: "border-purple-100" },
              ].map(c => (
                <div key={c.label} className={`rounded-2xl border p-4 hover:shadow-md transition-all ${c.bg} ${c.border}`}>
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-xs text-muted-foreground font-medium">{c.label}</span>
                    <span className={`text-sm font-bold ${c.color}`}>{c.icon}</span>
                  </div>
                  <p className={`text-xl font-bold tracking-tight ${c.color}`}>{c.value}</p>
                </div>
              ))}
            </div>
          </div>
        ))}

        {/* ── CHARTS ── */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="bg-card border rounded-2xl p-5">
            <div className="mb-4">
              <h3 className="font-semibold text-sm">{activePD.amtCols.map(c => c.name).join(" · ")} — by {activePD.xCol || "Row"}</h3>
              <p className="text-xs text-muted-foreground mt-0.5">{activePD.chartRows.length} data points</p>
            </div>
            {chartMode === "pie" ? renderChart(activePD, "bar") : renderChart(activePD, chartMode)}
          </div>
          <div className="bg-card border rounded-2xl p-5">
            <div className="mb-4">
              <h3 className="font-semibold text-sm">Distribution</h3>
              <p className="text-xs text-muted-foreground mt-0.5">Share per entry</p>
            </div>
            {renderChart(activePD, "pie")}
          </div>
        </div>

        {/* ── DATA TABLE — har row alag se (detail view) ── */}
        <div className="bg-card border rounded-2xl overflow-hidden">
          <div className="px-5 py-4 border-b flex items-center justify-between bg-muted/30">
            <div>
              <h3 className="font-semibold text-sm">Data Table</h3>
              <p className="text-xs text-muted-foreground mt-0.5">{activePD.detailRows.length} rows · {sym} {cur}</p>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-muted/40 border-b">
                  <th className="text-left px-5 py-3 font-semibold text-muted-foreground text-xs tracking-wide uppercase">{activePD.xCol || "Row"}</th>
                  {viewMode === "documents" && (
                    <>
                      <th className="text-left px-5 py-3 font-semibold text-muted-foreground text-xs tracking-wide uppercase">Type</th>
                      <th className="text-left px-5 py-3 font-semibold text-muted-foreground text-xs tracking-wide uppercase">Status</th>
                    </>
                  )}
                  {activePD.amtCols.map(c => (
                    <th key={c.id} className="text-right px-5 py-3 font-semibold text-muted-foreground text-xs tracking-wide uppercase">{c.name}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {activePD.detailRows.map((r, i) => (
                  <tr key={i} className="border-b last:border-0 hover:bg-muted/20 transition-colors">
                    <td className="px-5 py-3 font-medium text-sm">{r.name}</td>
                    {viewMode === "documents" && (
                      <>
                        <td className="px-5 py-3 text-sm capitalize">{r.type}</td>
                        <td className="px-5 py-3"><StatusPill label={r.status} /></td>
                      </>
                    )}
                    {activePD.amtCols.map(c => (
                      <td key={c.id} className="px-5 py-3 text-right font-semibold text-blue-600 text-sm">{formatCurrency(r[c.name] ?? 0, cur)}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="bg-blue-600 text-white">
                  <td className="px-5 py-3.5 font-bold text-sm tracking-wide" colSpan={viewMode === "documents" ? 3 : 1}>TOTAL</td>
                  {activePD.stats.map(s => (
                    <td key={s.col.id} className="px-5 py-3.5 text-right font-bold text-sm">{formatCurrency(s.total, cur)}</td>
                  ))}
                </tr>
              </tfoot>
            </table>
          </div>
        </div>

      </>)}
    </div>
  );
}
