import { useState, useEffect, useMemo } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { BarChart3, IndianRupee } from "lucide-react";
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

  return (
    <div className="space-y-6">

      <h1 className="text-2xl font-bold flex items-center gap-2">
        <BarChart3 className="h-6 w-6" />
        Analytics
      </h1>

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
      <Card>
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
        <Card>
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
      <Card>
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
  );
}