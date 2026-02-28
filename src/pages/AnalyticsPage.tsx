import { useState, useEffect, useMemo, useRef } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { BarChart3, IndianRupee, Download } from "lucide-react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
} from "recharts";

function formatINR(n: number) {
  return `₹${Number(n || 0).toLocaleString("en-IN")}`;
}

// ✅ PDF-safe version: Rs. instead of ₹ (jsPDF default font doesn't support ₹)
function formatINRpdf(n: number) {
  return `Rs. ${Number(n || 0).toLocaleString("en-IN")}`;
}

function toNumberSafe(v: any): number {
  if (!v) return 0;
  const cleaned = String(v).replace(/[₹,\s]/g, "");
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : 0;
}

const COLORS = ["#16a34a", "#dc2626"]; // green revenue, red expense

export default function AnalyticsPage() {
  const { profile } = useAuth();

  const [tables, setTables] = useState<any[]>([]);
  const [columns, setColumns] = useState<any[]>([]);
  const [rows, setRows] = useState<any[]>([]);
  const [downloading, setDownloading] = useState(false);

  const chartRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!profile) return;

    const load = async () => {
      const { data: t } = await supabase
        .from("user_tables")
        .select("id,name")
        .eq("user_id", profile.id);

      setTables(t ?? []);

      if (!t || t.length === 0) return;

      const ids = t.map(x => x.id);

      const { data: c } = await supabase
        .from("user_columns")
        .select("id,name,type,table_id")
        .in("table_id", ids);

      setColumns(c ?? []);

      const { data: r } = await supabase
        .from("user_rows")
        .select("table_id,row_data")
        .in("table_id", ids);

      setRows(r ?? []);
    };

    load();
  }, [profile]);

  // ✅ ONLY currency columns
  const currencyCols = useMemo(
    () => columns.filter(c => c.type === "currency"),
    [columns]
  );

  // ✅ Revenue & Expense calculation
  const moneySummary = useMemo(() => {
    let revenue = 0;
    let expense = 0;

    rows.forEach(r => {
      currencyCols
        .filter(c => c.table_id === r.table_id)
        .forEach(c => {
          const name = String(c.name).toLowerCase();
          const value = toNumberSafe(r.row_data?.[c.name]);

          // ignore total/subtotal to avoid double counting
          if (name.includes("total")) return;

          if (name.includes("expense") || name.includes("cost")) {
            expense += value;
          } else {
            revenue += value;
          }
        });
    });

    return {
      revenue,
      expense,
      profit: revenue - expense,
    };
  }, [rows, currencyCols]);

  // ✅ Bar chart data (currency columns only)
  const barData = useMemo(() => {
    return currencyCols.map(col => {
      let total = 0;

      rows
        .filter(r => r.table_id === col.table_id)
        .forEach(r => {
          total += toNumberSafe(r.row_data?.[col.name]);
        });

      return {
        name: col.name,
        total,
      };
    });
  }, [currencyCols, rows]);

  // ✅ Pie chart Revenue vs Expense only
  const pieData = [
    { name: "Revenue", value: moneySummary.revenue },
    { name: "Expense", value: moneySummary.expense },
  ].filter(x => x.value > 0);

  // ✅ PDF Download
  const handleDownloadPDF = async () => {
    setDownloading(true);
    try {
      const html2canvas = (await import("html2canvas")).default;
      const jsPDF = (await import("jspdf")).default;

      const chartElement = chartRef.current;
      if (!chartElement) return;

      const canvas = await html2canvas(chartElement, {
        scale: 2,
        useCORS: true,
        backgroundColor: "#ffffff",
      });

      const imgData = canvas.toDataURL("image/png");

      const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
      const pageWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();

      // ── Header ──
      pdf.setFillColor(37, 99, 235);
      pdf.rect(0, 0, pageWidth, 18, "F");
      pdf.setTextColor(255, 255, 255);
      pdf.setFontSize(14);
      pdf.setFont("helvetica", "bold");
      pdf.text("Ledgerly - Analytics Report", 14, 12);
      pdf.setFontSize(9);
      pdf.setFont("helvetica", "normal");
      pdf.text(`Generated: ${new Date().toLocaleDateString("en-IN")}`, pageWidth - 14, 12, { align: "right" });

      // ── Charts image ──
      const imgWidth = pageWidth - 28;
      const imgHeight = (canvas.height * imgWidth) / canvas.width;
      pdf.addImage(imgData, "PNG", 14, 24, imgWidth, imgHeight);

      let yPos = 24 + imgHeight + 10;

      // ── Divider ──
      pdf.setDrawColor(200, 200, 200);
      pdf.line(14, yPos, pageWidth - 14, yPos);
      yPos += 8;

      // ── Summary heading ──
      pdf.setFontSize(13);
      pdf.setFont("helvetica", "bold");
      pdf.setTextColor(30, 30, 30);
      pdf.text("Financial Summary", 14, yPos);
      yPos += 8;

      // ── Summary table ──
      const summaryRows = [
        ["Revenue", formatINRpdf(moneySummary.revenue), "#16a34a"],
        ["Expense", formatINRpdf(moneySummary.expense), "#dc2626"],
        ["Net Profit", formatINRpdf(moneySummary.profit), moneySummary.profit >= 0 ? "#16a34a" : "#dc2626"],
      ];

      summaryRows.forEach(([label, value, color]) => {
        pdf.setFillColor(245, 245, 245);
        pdf.roundedRect(14, yPos - 5, pageWidth - 28, 10, 2, 2, "F");
        pdf.setFontSize(11);
        pdf.setFont("helvetica", "normal");
        pdf.setTextColor(60, 60, 60);
        pdf.text(label, 20, yPos + 1);
        const [r, g, b] = color
          .replace("#", "")
          .match(/.{2}/g)!
          .map(x => parseInt(x, 16));
        pdf.setTextColor(r, g, b);
        pdf.setFont("helvetica", "bold");
        pdf.text(value, pageWidth - 20, yPos + 1, { align: "right" });
        yPos += 14;
      });

      yPos += 4;

      // ── Per-column detail ──
      if (barData.length > 0) {
        if (yPos > pageHeight - 60) {
          pdf.addPage();
          yPos = 20;
        }

        pdf.setDrawColor(200, 200, 200);
        pdf.line(14, yPos, pageWidth - 14, yPos);
        yPos += 8;

        pdf.setFontSize(13);
        pdf.setFont("helvetica", "bold");
        pdf.setTextColor(30, 30, 30);
        pdf.text("Column-wise Breakdown", 14, yPos);
        yPos += 8;

        // Table header
        pdf.setFillColor(37, 99, 235);
        pdf.rect(14, yPos - 5, pageWidth - 28, 10, "F");
        pdf.setTextColor(255, 255, 255);
        pdf.setFontSize(10);
        pdf.setFont("helvetica", "bold");
        pdf.text("Column Name", 20, yPos + 1);
        pdf.text("Total Amount", pageWidth - 20, yPos + 1, { align: "right" });
        yPos += 13;

        barData.forEach((item, idx) => {
          if (yPos > pageHeight - 20) {
            pdf.addPage();
            yPos = 20;
          }
          if (idx % 2 === 0) {
            pdf.setFillColor(245, 247, 255);
            pdf.rect(14, yPos - 5, pageWidth - 28, 10, "F");
          }
          pdf.setFontSize(10);
          pdf.setFont("helvetica", "normal");
          pdf.setTextColor(50, 50, 50);
          pdf.text(item.name, 20, yPos + 1);
          pdf.setFont("helvetica", "bold");
          pdf.setTextColor(37, 99, 235);
          pdf.text(formatINRpdf(item.total), pageWidth - 20, yPos + 1, { align: "right" });
          yPos += 12;
        });
      }

      // ── Footer ──
      pdf.setFontSize(8);
      pdf.setTextColor(150, 150, 150);
      pdf.setFont("helvetica", "normal");
      pdf.text("Ledgerly - Smart Business Management", pageWidth / 2, pageHeight - 8, { align: "center" });

      pdf.save("ledgerly-analytics.pdf");
    } catch (err) {
      console.error("PDF error:", err);
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div className="space-y-6">

      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <BarChart3 className="h-6 w-6" />
          Analytics
        </h1>
        <Button onClick={handleDownloadPDF} disabled={downloading} className="gap-2">
          <Download className="h-4 w-4" />
          {downloading ? "Generating..." : "Download PDF"}
        </Button>
      </div>

      <div ref={chartRef}>

        {/* ✅ GRAND TOTAL = REVENUE ONLY */}
        <Card>
          <CardContent className="flex items-center gap-4 pt-6">
            <div className="bg-primary/10 p-3 rounded-xl">
              <IndianRupee className="h-6 w-6 text-primary" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">
                Grand Total (Revenue Only)
              </p>
              <p className="text-2xl font-bold">
                {formatINR(moneySummary.revenue)}
              </p>
            </div>
          </CardContent>
        </Card>

        {/* Revenue & Expense Bar */}
        <Card className="mt-6">
          <CardHeader>
            <CardTitle>Revenue & Expense</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart
                data={[
                  { name: "Revenue", value: moneySummary.revenue },
                  { name: "Expense", value: moneySummary.expense },
                ]}
              >
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="name" />
                <YAxis />
                <Tooltip formatter={(v:any)=>formatINR(v)} />
                <Bar dataKey="value" fill="#2563eb" />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* Revenue vs Expense Pie */}
        {pieData.length > 0 && (
          <Card className="mt-6">
            <CardHeader>
              <CardTitle>Revenue vs Expense</CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={300}>
                <PieChart>
                  <Pie
                    data={pieData}
                    dataKey="value"
                    nameKey="name"
                    outerRadius={110}
                    label={({ name, value }) =>
                      `${name}: ${formatINR(value)}`
                    }
                  >
                    {pieData.map((_, i) => (
                      <Cell key={i} fill={COLORS[i]} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(v:any)=>formatINR(v)} />
                </PieChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        )}

        {/* Summary */}
        <Card className="mt-6">
          <CardHeader>
            <CardTitle>Summary</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <p>Revenue: {formatINR(moneySummary.revenue)}</p>
            <p>Expense: {formatINR(moneySummary.expense)}</p>
            <p className="font-bold">
              Profit: {formatINR(moneySummary.profit)}
            </p>
          </CardContent>
        </Card>

      </div>

    </div>
  );
}
