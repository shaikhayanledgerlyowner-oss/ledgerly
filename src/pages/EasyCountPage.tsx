import { useState, useEffect } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Calculator } from "lucide-react";

export default function EasyCountPage() {
  const { profile } = useAuth();
  const [tables, setTables] = useState<{ id: string; name: string }[]>([]);
  const [columns, setColumns] = useState<{ id: string; name: string }[]>([]);
  const [selectedTable, setSelectedTable] = useState("");
  const [colA, setColA] = useState("");
  const [valA, setValA] = useState("");
  const [colB, setColB] = useState("");
  const [valB, setValB] = useState("");
  const [result, setResult] = useState<number | null>(null);

  useEffect(() => {
    if (!profile) return;
    supabase.from("user_tables").select("id, name").eq("user_id", profile.id).then(({ data }) => setTables(data ?? []));
  }, [profile]);

  useEffect(() => {
    if (!selectedTable) { setColumns([]); return; }
    supabase.from("user_columns").select("id, name").eq("table_id", selectedTable).then(({ data }) => setColumns(data ?? []));
  }, [selectedTable]);

  const count = async () => {
    if (!selectedTable || !colA || !valA) return;
    const { data } = await supabase.from("user_rows").select("row_data").eq("table_id", selectedTable);
    if (!data) { setResult(0); return; }
    const filtered = data.filter(r => {
      const rd = r.row_data as Record<string, any>;
      const matchA = String(rd[colA] ?? "").toLowerCase() === valA.toLowerCase();
      if (!colB || !valB) return matchA;
      const matchB = String(rd[colB] ?? "").toLowerCase() === valB.toLowerCase();
      return matchA && matchB;
    });
    setResult(filtered.length);
  };

  return (
    <div className="animate-fade-in space-y-6">
      <h1 className="text-2xl font-display font-bold">Easy Count</h1>
      <Card className="glass-card max-w-lg">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg"><Calculator className="h-5 w-5" /> Count Rows</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>Table</Label>
            <Select value={selectedTable} onValueChange={setSelectedTable}>
              <SelectTrigger><SelectValue placeholder="Select table" /></SelectTrigger>
              <SelectContent>
                {tables.map(t => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>Column A</Label>
              <Select value={colA} onValueChange={setColA}>
                <SelectTrigger><SelectValue placeholder="Column" /></SelectTrigger>
                <SelectContent>
                  {columns.map(c => <SelectItem key={c.id} value={c.name}>{c.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Value A</Label>
              <Input value={valA} onChange={e => setValA(e.target.value)} placeholder="e.g. Nimesh" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>Column B (optional)</Label>
              <Select value={colB} onValueChange={setColB}>
                <SelectTrigger><SelectValue placeholder="Column" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="">None</SelectItem>
                  {columns.map(c => <SelectItem key={c.id} value={c.name}>{c.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Value B</Label>
              <Input value={valB} onChange={e => setValB(e.target.value)} placeholder="e.g. USG" />
            </div>
          </div>
          <Button onClick={count} className="w-full">Count</Button>
          {result !== null && (
            <div className="rounded-lg bg-primary/10 p-4 text-center">
              <p className="text-sm text-muted-foreground">Matching rows</p>
              <p className="text-4xl font-bold text-primary">{result}</p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
