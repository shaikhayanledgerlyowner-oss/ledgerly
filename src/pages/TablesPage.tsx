import React, { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { motion } from "framer-motion";
import {
  Plus, Table2, Trash2, Edit3, Search, SortAsc, SortDesc,
  MoreHorizontal, ChevronDown, X, Save, Calculator, HelpCircle,
  Download, FileSpreadsheet
} from "lucide-react";

import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuTrigger, DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";

import { toast } from "sonner";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import * as XLSX from "xlsx";
import { saveAs } from "file-saver";

type ColumnType = "text" | "number" | "currency" | "date";

interface DbTable { id: string; user_id: string; name: string; created_at: string; }
interface DbColumn { id: string; table_id: string; name: string; type: ColumnType | string; created_at: string; }
interface DbRow { id: string; table_id: string; row_data: Record<string, any> | null; created_at: string; }

function toNumberSafe(v: any): number {
  if (v === null || v === undefined || v === "") return 0;
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  const n = Number(String(v).replace(/,/g, ""));
  return Number.isFinite(n) ? n : 0;
}

function safeFileName(name: string) {
  return String(name || "table").replace(/[\/\\:*?"<>|]/g, "-").trim() || "table";
}

// ✅ DD/MM/YYYY format
function formatDateDMY(value: any): string {
  if (!value) return "";
  const d = new Date(String(value));
  if (isNaN(d.getTime())) return String(value);
  const day = String(d.getDate()).padStart(2, "0");
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const year = d.getFullYear();
  return `${day}/${month}/${year}`;
}

function formatCellValue(value: any, type: ColumnType): string {
  if (value === undefined || value === null || value === "") return "";
  switch (type) {
    case "currency": return `₹${toNumberSafe(value).toLocaleString("en-IN")}`;
    case "number": return toNumberSafe(value).toLocaleString("en-IN");
    case "date": return formatDateDMY(value);
    default: return String(value);
  }
}

function moneyPDF(v: any) {
  return `Rs. ${toNumberSafe(v).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// ✅ Parse user typed date to ISO — supports DD/MM/YYYY, DD-MM-YYYY, YYYY-MM-DD
function parseDateInput(val: string): string {
  if (!val) return "";
  const dmyMatch = val.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (dmyMatch) {
    const [, d, m, y] = dmyMatch;
    const dt = new Date(Number(y), Number(m) - 1, Number(d));
    if (!isNaN(dt.getTime())) return dt.toISOString().slice(0, 10);
  }
  const isoMatch = val.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoMatch) return val;
  const dt = new Date(val);
  if (!isNaN(dt.getTime())) return dt.toISOString().slice(0, 10);
  return "";
}

// ✅ Fill series: numbers → increment, dates → +1 day, text → copy
function fillSeries(value: any, type: ColumnType, step: number): any {
  if (type === "number" || type === "currency") return toNumberSafe(value) + step;
  if (type === "date" && value) {
    const d = new Date(String(value));
    if (!isNaN(d.getTime())) { d.setDate(d.getDate() + step); return d.toISOString().slice(0, 10); }
  }
  return value;
}

export default function TablesPage() {
  const { profile, hasAccess } = useAuth();
  const userId = profile?.id;

  const [tables, setTables] = useState<DbTable[]>([]);
  const [selectedTable, setSelectedTable] = useState<DbTable | null>(null);
  const [columns, setColumns] = useState<DbColumn[]>([]);
  const [rows, setRows] = useState<DbRow[]>([]);

  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [isColumnDialogOpen, setIsColumnDialogOpen] = useState(false);

  const [newTableName, setNewTableName] = useState("");
  const [newColumnName, setNewColumnName] = useState("");
  const [newColumnType, setNewColumnType] = useState<ColumnType>("text");

  const [searchQuery, setSearchQuery] = useState("");
  const [sortColumnName, setSortColumnName] = useState<string | null>(null);
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("asc");

  const [editingCell, setEditingCell] = useState<{ rowId: string; colName: string } | null>(null);
  const [editValue, setEditValue] = useState("");
  const originalValueRef = useRef<string>("");

  const [editingColumnId, setEditingColumnId] = useState<string | null>(null);
  const [editingColumnName, setEditingColumnName] = useState("");
  const [editingColumnType, setEditingColumnType] = useState<ColumnType>("text");

  const [showEasyCount, setShowEasyCount] = useState(false);
  const [countConditions, setCountConditions] = useState<{ column: string; criteria: string }[]>([{ column: "", criteria: "" }]);
  const [countResult, setCountResult] = useState<number | null>(null);

  // ✅ Fill-down state
  const [fillAnchor, setFillAnchor] = useState<{ rowId: string; colName: string } | null>(null);
  const [fillEnd, setFillEnd] = useState<{ rowId: string; colName: string } | null>(null);

  const cellRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const columnsRef = useRef<DbColumn[]>([]);
  const rowsRef = useRef<DbRow[]>([]);
  const savingRef = useRef(false);
  const editValueRef = useRef(editValue);
  const editingCellRef = useRef(editingCell);

  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<DbTable | null>(null);

  // Keep refs in sync
  useEffect(() => { editValueRef.current = editValue; }, [editValue]);
  useEffect(() => { editingCellRef.current = editingCell; }, [editingCell]);

  const cellKey = (rowId: string, colName: string) => `${rowId}__${colName}`;

  const focusCell = (rowId: string, colName: string) => {
    setTimeout(() => {
      const el = cellRefs.current[cellKey(rowId, colName)];
      if (el) { el.focus(); el.select?.(); }
    }, 30);
  };

  const loadTables = async () => {
    if (!userId) return;
    const { data, error } = await supabase.from("user_tables").select("*").eq("user_id", userId).order("created_at", { ascending: true });
    if (error) { toast.error(error.message); return; }
    const list = (data ?? []) as DbTable[];
    setTables(list);
    if (selectedTable) {
      if (!list.some((t) => t.id === selectedTable.id)) setSelectedTable(list[0] ?? null);
    } else if (list.length > 0) setSelectedTable(list[0]);
  };

  const loadTableData = async (tableId: string) => {
    const [colRes, rowRes] = await Promise.all([
      supabase.from("user_columns").select("*").eq("table_id", tableId).order("created_at", { ascending: true }),
      supabase.from("user_rows").select("*").eq("table_id", tableId).order("created_at", { ascending: true }),
    ]);
    setColumns(((colRes.data ?? []) as DbColumn[]).map((c) => ({ ...c, type: (c.type as any) ?? "text" })));
    setRows(((rowRes.data ?? []) as DbRow[]).map((r) => ({ ...r, row_data: (r.row_data ?? {}) as any })));
  };

  useEffect(() => { loadTables(); }, [userId]);
  useEffect(() => { if (!selectedTable) return; loadTableData(selectedTable.id); }, [selectedTable?.id]);

  const handleCreateTable = async () => {
    if (!userId || !newTableName.trim()) return toast.error("Please enter a table name");
    const { data, error } = await supabase.from("user_tables").insert({ user_id: userId, name: newTableName.trim() }).select("*").single();
    if (error) return toast.error(error.message);
    toast.success("Table created");
    setNewTableName(""); setIsCreateDialogOpen(false);
    await loadTables(); setSelectedTable(data as DbTable);
  };

  const handleRenameTable = async (table: DbTable) => {
    const newName = prompt("Enter new table name:", table.name);
    if (!newName?.trim()) return;
    const { error } = await supabase.from("user_tables").update({ name: newName.trim() }).eq("id", table.id);
    if (error) return toast.error(error.message);
    toast.success("Table renamed"); await loadTables();
    if (selectedTable?.id === table.id) setSelectedTable({ ...table, name: newName.trim() });
  };

  const handleDeleteTable = async (tableId: string) => {
    try {
      await supabase.from("user_rows").delete().eq("table_id", tableId);
      await supabase.from("user_columns").delete().eq("table_id", tableId);
      await supabase.from("user_tables").delete().eq("id", tableId);
      toast.success("Table deleted");
      if (selectedTable?.id === tableId) { setSelectedTable(null); setColumns([]); setRows([]); }
      await loadTables();
    } catch (e: any) { toast.error(e?.message || "Delete failed"); }
  };

  const handleAddColumn = async () => {
    if (!selectedTable || !newColumnName.trim()) return toast.error("Please enter a column name");
    const colName = newColumnName.trim();
    const { error } = await supabase.from("user_columns").insert({ table_id: selectedTable.id, name: colName, type: newColumnType });
    if (error) return toast.error(error.message);
    if (rows.length > 0) {
      await Promise.all(rows.map((r) => {
        const rd = (r.row_data ?? {}) as Record<string, any>;
        if (rd[colName] !== undefined) return Promise.resolve();
        return supabase.from("user_rows").update({ row_data: { ...rd, [colName]: "" } }).eq("id", r.id);
      }));
    }
    toast.success("Column added");
    setNewColumnName(""); setNewColumnType("text"); setIsColumnDialogOpen(false);
    await loadTableData(selectedTable.id);
  };

  const handleDeleteColumn = async (col: DbColumn) => {
    if (!selectedTable) return;
    await supabase.from("user_columns").delete().eq("id", col.id);
    if (rows.length > 0) {
      await Promise.all(rows.map((r) => {
        const rd = (r.row_data ?? {}) as Record<string, any>;
        if (!(col.name in rd)) return Promise.resolve();
        const updated = { ...rd }; delete updated[col.name];
        return supabase.from("user_rows").update({ row_data: updated }).eq("id", r.id);
      }));
    }
    toast.success("Column deleted");
    await loadTableData(selectedTable.id);
  };

  const handleColumnUpdate = async (col: DbColumn) => {
    if (!selectedTable || !editingColumnName.trim()) return toast.error("Column name required");
    const newName = editingColumnName.trim(); const oldName = col.name;
    await supabase.from("user_columns").update({ name: newName, type: editingColumnType }).eq("id", col.id);
    if (rows.length > 0) {
      await Promise.all(rows.map(async (r) => {
        const rd = (r.row_data ?? {}) as Record<string, any>;
        const updated: Record<string, any> = { ...rd };
        if (oldName !== newName) { updated[newName] = updated[oldName]; delete updated[oldName]; }
        const v = updated[newName];
        if (editingColumnType === "number" || editingColumnType === "currency") updated[newName] = v === "" || v == null ? "" : toNumberSafe(v);
        else if (editingColumnType === "date") updated[newName] = v ? (parseDateInput(String(v)) || "") : "";
        else updated[newName] = v == null ? "" : String(v);
        return supabase.from("user_rows").update({ row_data: updated }).eq("id", r.id);
      }));
    }
    toast.success("Column updated");
    setEditingColumnId(null); setEditingColumnName(""); setEditingColumnType("text");
    await loadTableData(selectedTable.id);
  };

  const handleAddRow = async () => {
    if (!selectedTable) return;
    if (columns.length === 0) return toast.error("Add columns first");
    const empty: Record<string, any> = {};
    columns.forEach((c) => (empty[c.name] = ""));
    const { error } = await supabase.from("user_rows").insert({ table_id: selectedTable.id, row_data: empty });
    if (error) return toast.error(error.message);
    await loadTableData(selectedTable.id);
  };

  const handleDeleteRow = async (rowId: string) => {
    await supabase.from("user_rows").delete().eq("id", rowId);
    toast.success("Row deleted");
    setRows((prev) => prev.filter((r) => r.id !== rowId));
  };

  // ✅ Track mousedown on cell to prevent onBlur killing the new cell
  const mouseDownOnCellRef = useRef<{ rowId: string; colName: string } | null>(null);

  const startEditCell = (rowId: string, colName: string, _current?: any) => {
    const col = columnsRef.current.find((c) => c.name === colName);
    const type = (col?.type as ColumnType) ?? "text";
    // ✅ Always read fresh value from rowsRef — fixes blank value bug
    const latestRow = rowsRef.current.find((r) => r.id === rowId);
    const latestVal = latestRow ? ((latestRow.row_data ?? {}) as Record<string, any>)[colName] : "";
    let displayVal = latestVal == null ? "" : String(latestVal);
    if (type === "date" && displayVal) displayVal = formatDateDMY(displayVal) || displayVal;
    originalValueRef.current = displayVal;
    setEditingCell({ rowId, colName });
    setEditValue(displayVal);
  };

  // ✅ saveCellNow - saves specific values, no state dependency
  const saveCellNow = async (rowId: string, colName: string, val: string) => {
    if (savingRef.current) return;
    savingRef.current = true;
    const col = columnsRef.current.find((c) => c.name === colName);
    const type = (col?.type as ColumnType) ?? "text";
    let value: any = val;
    if (type === "number" || type === "currency") value = val === "" ? "" : toNumberSafe(val);
    else if (type === "date") value = parseDateInput(val);

    setRows((prev) => prev.map((r) => {
      if (r.id !== rowId) return r;
      const rd = (r.row_data ?? {}) as Record<string, any>;
      return { ...r, row_data: { ...rd, [colName]: value } };
    }));
    const row = rowsRef.current.find((r) => r.id === rowId);
    const rd = ((row?.row_data ?? {}) as Record<string, any>);
    await supabase.from("user_rows").update({ row_data: { ...rd, [colName]: value } }).eq("id", rowId);
    savingRef.current = false;
  };

  const filteredAndSortedRows = useMemo(() => {
    let list = [...rows];
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      list = list.filter((r) => Object.values((r.row_data ?? {}) as Record<string, any>).some((v) => String(v ?? "").toLowerCase().includes(q)));
    }
    if (sortColumnName) {
      const col = columns.find((c) => c.name === sortColumnName);
      const type = (col?.type as ColumnType) ?? "text";
      list.sort((a, b) => {
        const aVal = ((a.row_data ?? {}) as Record<string, any>)[sortColumnName] ?? "";
        const bVal = ((b.row_data ?? {}) as Record<string, any>)[sortColumnName] ?? "";
        if (type === "number" || type === "currency") { const na = toNumberSafe(aVal); const nb = toNumberSafe(bVal); return sortDirection === "asc" ? na - nb : nb - na; }
        return sortDirection === "asc" ? String(aVal).localeCompare(String(bVal)) : String(bVal).localeCompare(String(aVal));
      });
    }
    return list;
  }, [rows, searchQuery, sortColumnName, sortDirection, columns]);

  useEffect(() => { columnsRef.current = columns; }, [columns]);
  useEffect(() => { rowsRef.current = filteredAndSortedRows; }, [filteredAndSortedRows]);

  const startEditAndFocus = (rowId: string, colName: string) => {
    startEditCell(rowId, colName);
    focusCell(rowId, colName);
  };

  const moveFromCell = async (rowId: string, colName: string, val: string, dir: "right" | "left" | "down" | "up") => {
    await saveCellNow(rowId, colName, val);
    setEditingCell(null); setEditValue("");

    const cols = columnsRef.current; const list = rowsRef.current;
    const rIndex = list.findIndex((r) => r.id === rowId);
    const cIndex = cols.findIndex((c) => c.name === colName);
    if (rIndex < 0 || cIndex < 0) return;
    let nr = rIndex, nc = cIndex;
    if (dir === "right") nc = Math.min(cIndex + 1, cols.length - 1);
    else if (dir === "left") nc = Math.max(cIndex - 1, 0);
    else if (dir === "down") nr = Math.min(rIndex + 1, list.length - 1);
    else if (dir === "up") nr = Math.max(rIndex - 1, 0);
    const nextRow = list[nr]; const nextCol = cols[nc];
    if (!nextRow || !nextCol) return;
    startEditAndFocus(nextRow.id, nextCol.name);
  };

  const handleFillDown = async () => {
    if (!fillAnchor || !fillEnd) return;
    const col = columnsRef.current.find((c) => c.name === fillAnchor.colName);
    const type = (col?.type as ColumnType) ?? "text";
    const list = rowsRef.current;
    const ai = list.findIndex((r) => r.id === fillAnchor.rowId);
    const ei = list.findIndex((r) => r.id === fillEnd.rowId);
    if (ai < 0 || ei < 0 || ai >= ei) return;
    const anchorVal = ((list[ai].row_data ?? {}) as Record<string, any>)[fillAnchor.colName];
    for (let i = ai + 1; i <= ei; i++) {
      const targetRow = list[i]; if (!targetRow) continue;
      const newVal = fillSeries(anchorVal, type, i - ai);
      const rd = ((targetRow.row_data ?? {}) as Record<string, any>);
      setRows((prev) => prev.map((r) => r.id !== targetRow.id ? r : { ...r, row_data: { ...rd, [fillAnchor.colName]: newVal } }));
      await supabase.from("user_rows").update({ row_data: { ...rd, [fillAnchor.colName]: newVal } }).eq("id", targetRow.id);
    }
    toast.success("Filled down!");
    setFillAnchor(null); setFillEnd(null);
  };

  const handleSort = (colName: string) => {
    if (sortColumnName === colName) setSortDirection((p) => p === "asc" ? "desc" : "asc");
    else { setSortColumnName(colName); setSortDirection("asc"); }
  };

  const columnTotals = useMemo(() => {
    const totals: Record<string, number> = {};
    columns.forEach((c) => {
      if (c.type === "number" || c.type === "currency")
        totals[c.name] = rows.reduce((sum, r) => sum + toNumberSafe(((r.row_data ?? {}) as any)[c.name]), 0);
    });
    return totals;
  }, [columns, rows]);

  const handleEasyCount = () => {
    const active = countConditions.filter((c) => c.column.trim() && c.criteria.trim());
    if (!active.length) return toast.error("Add at least 1 condition");
    const result = rows.filter((r) => {
      const rd = (r.row_data ?? {}) as Record<string, any>;
      return active.every((cond) => String(rd[cond.column] ?? "").toLowerCase().includes(cond.criteria.toLowerCase()));
    }).length;
    setCountResult(result); toast.success(`Found ${result} matching rows`);
  };

  const downloadSelectedTablePDF = () => {
    if (!hasAccess) return toast.error("Upgrade required to download.");
    if (!selectedTable || columns.length === 0) return;
    const doc = new jsPDF({ orientation: "l", unit: "pt", format: "a4" });
    doc.setFont("helvetica", "bold"); doc.setFontSize(16);
    doc.text(`Ledgerly - ${selectedTable.name}`, 40, 45);
    doc.setFont("helvetica", "normal"); doc.setFontSize(11);
    doc.text(`Generated: ${new Date().toLocaleString()}`, 40, 65);
    const head = [columns.map((c) => c.name)];
    const body = filteredAndSortedRows.map((r) => {
      const rd = (r.row_data ?? {}) as Record<string, any>;
      return columns.map((c) => {
        const type = (c.type as ColumnType) ?? "text"; const v = rd[c.name];
        if (type === "currency") return moneyPDF(v);
        if (type === "number") return toNumberSafe(v).toLocaleString("en-IN");
        if (type === "date") return formatDateDMY(v);
        return v == null ? "" : String(v);
      });
    });
    const hasTotals = rows.length > 0 && Object.keys(columnTotals).length > 0;
    if (hasTotals) {
      body.push(columns.map((c, idx) => {
        const total = columnTotals[c.name]; const type = (c.type as ColumnType) ?? "text";
        if (total !== undefined) return type === "currency" ? `Rs. ${total.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : total.toLocaleString("en-IN");
        return idx === 0 ? "Total" : "";
      }));
    }
    autoTable(doc, { startY: 85, head, body, styles: { font: "helvetica", fontSize: 9, cellPadding: 6 }, headStyles: { fillColor: [30, 30, 30], textColor: 255 }, didParseCell: (data) => { if (hasTotals && data.row.index === body.length - 1) data.cell.styles.fontStyle = "bold"; }, margin: { left: 40, right: 40 } });
    doc.save(`Ledgerly-${safeFileName(selectedTable.name)}.pdf`);
    toast.success("PDF downloaded");
  };

  const downloadSelectedTableExcel = () => {
    if (!hasAccess) return toast.error("Upgrade required to download.");
    if (!selectedTable || columns.length === 0) return;
    try {
      const header = columns.map((c) => c.name);
      const data = filteredAndSortedRows.map((r) => {
        const rd = (r.row_data ?? {}) as Record<string, any>;
        return columns.map((c) => {
          const type = (c.type as ColumnType) ?? "text"; const v = rd[c.name];
          if (type === "number" || type === "currency") return v === "" || v == null ? "" : toNumberSafe(v);
          if (type === "date") return formatDateDMY(v);
          return v == null ? "" : String(v);
        });
      });
      const hasTotals = rows.length > 0 && Object.keys(columnTotals).length > 0;
      if (hasTotals) data.push(columns.map((c, idx) => { const total = columnTotals[c.name]; if (total !== undefined) return total; return idx === 0 ? "Total" : ""; }) as any);
      const ws = XLSX.utils.aoa_to_sheet([header, ...data]);
      (ws as any)["!cols"] = header.map((h, i) => ({ wch: Math.min(Math.max(Math.max(h.length, ...data.slice(0, 200).map((row) => String(row[i] ?? "").length)) + 2, 10), 40) }));
      const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, "Data");
      const out = XLSX.write(wb, { bookType: "xlsx", type: "array" });
      saveAs(new Blob([out], { type: "application/octet-stream" }), `Ledgerly-${safeFileName(selectedTable.name)}.xlsx`);
      toast.success("Excel downloaded");
    } catch (e: any) { toast.error(e?.message || "Excel download failed"); }
  };

  return (
    <>
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete table?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTarget ? (<>This will permanently delete <b>{deleteTarget.name}</b> and all its data.</>) : "This will permanently delete the table and all its data."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => { setDeleteDialogOpen(false); setDeleteTarget(null); }}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={async () => { if (!deleteTarget) return; const id = deleteTarget.id; setDeleteDialogOpen(false); setDeleteTarget(null); await handleDeleteTable(id); }}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-6 animate-fade-in">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-2xl font-display font-bold">Tables</h1>
            <p className="text-muted-foreground">Create and manage your custom data tables</p>
          </div>
          <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
            <DialogTrigger asChild>
              <Button className="gap-2"><Plus className="w-4 h-4" />New Table</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>Create New Table</DialogTitle></DialogHeader>
              <div className="space-y-4 pt-4">
                <div>
                  <label className="text-sm font-medium">Table Name</label>
                  <Input placeholder="e.g., Monthly Expenses" value={newTableName} onChange={(e) => setNewTableName(e.target.value)} className="mt-2" onKeyDown={(e) => e.key === "Enter" && handleCreateTable()} />
                </div>
                <p className="text-xs text-muted-foreground">Your table will start empty. Add columns and rows after creation.</p>
                <Button onClick={handleCreateTable} className="w-full">Create Table</Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>

        {tables.length > 0 && (
          <div className="flex gap-2 overflow-x-auto pb-2">
            {tables.map((table) => (
              <button key={table.id} onClick={() => setSelectedTable(table)}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg whitespace-nowrap transition-all ${selectedTable?.id === table.id ? "bg-primary text-primary-foreground" : "bg-muted hover:bg-muted/80 text-foreground"}`}>
                <Table2 className="w-4 h-4" />{table.name}
                <DropdownMenu>
                  <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
                    <button className="ml-1 p-1 rounded hover:bg-foreground/10" type="button"><MoreHorizontal className="w-3 h-3" /></button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent onClick={(e) => e.stopPropagation()}>
                    <DropdownMenuItem onSelect={(e) => { e.preventDefault(); handleRenameTable(table); }}><Edit3 className="w-4 h-4 mr-2" />Rename</DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem className="text-destructive" onSelect={(e) => { e.preventDefault(); setDeleteTarget(table); setDeleteDialogOpen(true); }}>
                      <Trash2 className="w-4 h-4 mr-2" />Delete
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </button>
            ))}
          </div>
        )}

        {selectedTable ? (
          <motion.div key={selectedTable.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="glass-card overflow-hidden">
            <div className="p-4 border-b border-border flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between">
              <div className="flex items-center gap-2 flex-1 w-full sm:w-auto">
                <div className="relative flex-1 max-w-xs">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input placeholder="Search..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="pl-9" />
                </div>
                <Popover open={showEasyCount} onOpenChange={setShowEasyCount}>
                  <PopoverTrigger asChild>
                    <Button variant="outline" size="sm"><Calculator className="w-4 h-4 mr-1" />EasyCount</Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-80" align="start">
                    <div className="space-y-4">
                      <div className="flex items-center gap-2">
                        <h4 className="font-semibold">EasyCount Filter</h4>
                        <Popover>
                          <PopoverTrigger asChild><button type="button"><HelpCircle className="w-4 h-4 text-muted-foreground cursor-help" /></button></PopoverTrigger>
                          <PopoverContent className="w-72 text-xs"><p>Count rows where column values contain your criteria.</p></PopoverContent>
                        </Popover>
                      </div>
                      {countConditions.map((cond, idx) => (
                        <div key={idx} className="flex gap-2">
                          <Select value={cond.column} onValueChange={(v) => { const n = [...countConditions]; n[idx].column = v; setCountConditions(n); }}>
                            <SelectTrigger className="w-28"><SelectValue placeholder="Column" /></SelectTrigger>
                            <SelectContent>{columns.map((col) => (<SelectItem key={col.id} value={col.name}>{col.name}</SelectItem>))}</SelectContent>
                          </Select>
                          <Input placeholder="contains..." value={cond.criteria} onChange={(e) => { const n = [...countConditions]; n[idx].criteria = e.target.value; setCountConditions(n); }} className="flex-1" />
                          {countConditions.length > 1 && <Button variant="ghost" size="icon" onClick={() => setCountConditions(countConditions.filter((_, i) => i !== idx))}><X className="w-4 h-4" /></Button>}
                        </div>
                      ))}
                      <Button variant="outline" size="sm" onClick={() => setCountConditions([...countConditions, { column: "", criteria: "" }])} className="w-full"><Plus className="w-4 h-4 mr-1" />Add Condition</Button>
                      <Button onClick={handleEasyCount} className="w-full">Count</Button>
                      {countResult !== null && (
                        <div className="p-3 rounded-lg bg-primary/10 text-center">
                          <p className="text-sm text-muted-foreground">Result</p>
                          <p className="text-2xl font-bold text-primary">{countResult}</p>
                          <p className="text-xs text-muted-foreground">matching rows</p>
                        </div>
                      )}
                    </div>
                  </PopoverContent>
                </Popover>
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                <Button variant="outline" size="sm" onClick={downloadSelectedTablePDF} className="gap-2" disabled={!hasAccess}><Download className="w-4 h-4" />PDF</Button>
                <Button variant="outline" size="sm" onClick={downloadSelectedTableExcel} className="gap-2" disabled={!hasAccess}><FileSpreadsheet className="w-4 h-4" />Excel</Button>
                <Dialog open={isColumnDialogOpen} onOpenChange={setIsColumnDialogOpen}>
                  <DialogTrigger asChild><Button variant="outline" size="sm"><Plus className="w-4 h-4 mr-1" />Add Column</Button></DialogTrigger>
                  <DialogContent>
                    <DialogHeader><DialogTitle>Add Column</DialogTitle></DialogHeader>
                    <div className="space-y-4 pt-4">
                      <div><label className="text-sm font-medium">Column Name</label><Input placeholder="e.g., Amount" value={newColumnName} onChange={(e) => setNewColumnName(e.target.value)} className="mt-2" /></div>
                      <div><label className="text-sm font-medium">Column Type</label>
                        <Select value={newColumnType} onValueChange={(v) => setNewColumnType(v as ColumnType)}>
                          <SelectTrigger className="mt-2"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="text">Text</SelectItem>
                            <SelectItem value="number">Number</SelectItem>
                            <SelectItem value="currency">Currency (₹)</SelectItem>
                            <SelectItem value="date">Date</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <Button onClick={handleAddColumn} className="w-full">Add Column</Button>
                    </div>
                  </DialogContent>
                </Dialog>
                <Button onClick={handleAddRow} variant="outline" size="sm"><Plus className="w-4 h-4 mr-1" />Add Row</Button>
              </div>
            </div>

            {/* Fill-down hint bar */}
            {fillAnchor && (
              <div className="px-4 py-2 bg-primary/10 text-xs text-primary flex items-center justify-between">
                <span>Click end cell in <b>{fillAnchor.colName}</b> column to select range, then press <kbd className="bg-primary/20 px-1 rounded font-mono">Ctrl+D</kbd></span>
                <button onClick={() => { setFillAnchor(null); setFillEnd(null); }}><X className="w-3 h-3" /></button>
              </div>
            )}

            {columns.length === 0 ? (
              <div className="p-12 text-center">
                <Table2 className="w-12 h-12 mx-auto mb-4 text-muted-foreground" />
                <h3 className="font-semibold mb-2">Empty Table</h3>
                <p className="text-muted-foreground mb-4">Start by adding columns to your table</p>
                <Button onClick={() => setIsColumnDialogOpen(true)} className="gap-2"><Plus className="w-4 h-4" />Add First Column</Button>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="bg-muted/50">
                      {columns.map((col) => (
                        <th key={col.id} className="px-3 py-2 text-left text-sm font-medium border-b border-border group whitespace-nowrap">
                          <div className="flex items-center gap-2">
                            {editingColumnId === col.id ? (
                              <div className="flex items-center gap-2">
                                <Input value={editingColumnName} onChange={(e) => setEditingColumnName(e.target.value)} className="h-7 text-xs w-40" autoFocus
                                  onKeyDown={(e) => { if (e.key === "Enter") handleColumnUpdate(col); if (e.key === "Escape") { setEditingColumnId(null); } }} />
                                <Select value={editingColumnType} onValueChange={(v) => setEditingColumnType(v as ColumnType)}>
                                  <SelectTrigger className="h-7 text-xs w-28"><SelectValue /></SelectTrigger>
                                  <SelectContent><SelectItem value="text">Text</SelectItem><SelectItem value="number">Number</SelectItem><SelectItem value="currency">Currency (₹)</SelectItem><SelectItem value="date">Date</SelectItem></SelectContent>
                                </Select>
                                <button onClick={() => handleColumnUpdate(col)} type="button"><Save className="w-3 h-3 text-primary" /></button>
                                <button onClick={() => setEditingColumnId(null)} type="button"><X className="w-3 h-3 text-muted-foreground" /></button>
                              </div>
                            ) : (
                              <>
                                <span className="cursor-pointer hover:text-foreground" onClick={() => { setEditingColumnId(col.id); setEditingColumnName(col.name); setEditingColumnType(((col.type as any) ?? "text") as ColumnType); }}>{col.name}</span>
                                <button onClick={() => handleSort(col.name)} type="button">{sortColumnName === col.name ? (sortDirection === "asc" ? <SortAsc className="w-3 h-3" /> : <SortDesc className="w-3 h-3" />) : <ChevronDown className="w-3 h-3 text-muted-foreground/60" />}</button>
                                <DropdownMenu>
                                  <DropdownMenuTrigger asChild><button type="button" className="opacity-0 group-hover:opacity-100"><MoreHorizontal className="w-3 h-3" /></button></DropdownMenuTrigger>
                                  <DropdownMenuContent><DropdownMenuItem className="text-destructive" onSelect={(e) => e.preventDefault()} onClick={() => handleDeleteColumn(col)}><Trash2 className="w-4 h-4 mr-2" />Delete Column</DropdownMenuItem></DropdownMenuContent>
                                </DropdownMenu>
                              </>
                            )}
                          </div>
                        </th>
                      ))}
                      <th className="px-3 py-2 text-left text-sm font-medium border-b border-border w-16">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredAndSortedRows.map((r) => {
                      const rd = (r.row_data ?? {}) as Record<string, any>;
                      return (
                        <tr key={r.id} className="hover:bg-muted/30 group border-b border-border/50">
                          {columns.map((col) => {
                            const type = (col.type as ColumnType) ?? "text";
                            const isEditing = editingCell?.rowId === r.id && editingCell?.colName === col.name;
                            const list = rowsRef.current;
                            const ai = list.findIndex((x) => x.id === fillAnchor?.rowId);
                            const ei = list.findIndex((x) => x.id === fillEnd?.rowId);
                            const ri = list.findIndex((x) => x.id === r.id);
                            const isFillSelected = fillAnchor?.colName === col.name && fillEnd?.colName === col.name && ri > ai && ri <= ei;

                            return (
                              <td key={col.id}
                                className={`px-3 py-2 text-sm cursor-pointer ${isFillSelected ? "bg-primary/10" : ""}`}
                                onMouseDown={() => { mouseDownOnCellRef.current = { rowId: r.id, colName: col.name }; }}
                                onClick={() => {
                                  mouseDownOnCellRef.current = null;
                                  if (fillAnchor && fillAnchor.colName === col.name && !isEditing) {
                                    setFillEnd({ rowId: r.id, colName: col.name }); return;
                                  }
                                  if (isEditing) return; // already editing this cell
                                  startEditAndFocus(r.id, col.name);
                                }}
                              >
                                {isEditing ? (
                                  <Input
                                    ref={(el) => { cellRefs.current[cellKey(r.id, col.name)] = el; }}
                                    type="text"
                                    inputMode={type === "number" || type === "currency" ? "decimal" : "text"}
                                    value={editValue}
                                    onChange={(e) => setEditValue(e.target.value)}
                                    onBlur={() => {
                                      // ✅ If user clicked another cell, skip blur-close (td onClick will open it)
                                      // Small delay so mousedown registers before blur fires
                                      setTimeout(async () => {
                                        await saveCellNow(r.id, col.name, editValueRef.current);
                                        setEditingCell(null);
                                        setEditValue("");
                                      }, 0);
                                    }}
                                    placeholder={type === "date" ? "DD/MM/YYYY" : ""}
                                    // ✅ enterKeyHint="next" prevents mobile keyboard from closing
                                    enterKeyHint="next"
                                    onKeyDown={async (e) => {
                                      if (e.key === "Enter") {
                                        e.preventDefault();
                                        // ✅ Save and move down — keyboard stays open on mobile
                                        const currentVal = editValue;
                                        await moveFromCell(r.id, col.name, currentVal, "down");
                                        return;
                                      }
                                      if (e.key === "Tab") { e.preventDefault(); await moveFromCell(r.id, col.name, editValue, e.shiftKey ? "left" : "right"); return; }
                                      if (e.key === "ArrowDown") { e.preventDefault(); await moveFromCell(r.id, col.name, editValue, "down"); return; }
                                      if (e.key === "ArrowUp") { e.preventDefault(); await moveFromCell(r.id, col.name, editValue, "up"); return; }
                                      if (e.key === "ArrowRight" && !editValue) { e.preventDefault(); await moveFromCell(r.id, col.name, editValue, "right"); return; }
                                      if (e.key === "ArrowLeft" && !editValue) { e.preventDefault(); await moveFromCell(r.id, col.name, editValue, "left"); return; }
                                      // ✅ ESC restores original value
                                      if (e.key === "Escape") { e.preventDefault(); setEditValue(originalValueRef.current); setEditingCell(null); return; }
                                      // ✅ Ctrl+D starts fill-down
                                      if (e.key === "d" && (e.ctrlKey || e.metaKey)) {
                                        e.preventDefault();
                                        setFillAnchor({ rowId: r.id, colName: col.name });
                                        setFillEnd(null);
                                        toast.info(`Click end cell in "${col.name}" column to select range`);
                                        return;
                                      }
                                    }}
                                    className="h-8 text-sm"
                                    autoFocus
                                  />
                                ) : (
                                  <span className={type === "currency" ? "text-primary font-medium" : ""}>
                                    {formatCellValue(rd[col.name], type) || <span className="text-muted-foreground/30">-</span>}
                                  </span>
                                )}
                              </td>
                            );
                          })}
                          <td className="px-3 py-2">
                            <Button variant="ghost" size="sm" className="opacity-0 group-hover:opacity-100" onClick={() => handleDeleteRow(r.id)}><Trash2 className="w-4 h-4 text-destructive" /></Button>
                          </td>
                        </tr>
                      );
                    })}
                    {rows.length === 0 && (<tr><td colSpan={columns.length + 1} className="text-center py-10 text-muted-foreground">No rows yet. Click "Add Row" to add data.</td></tr>)}
                  </tbody>
                  {rows.length > 0 && Object.keys(columnTotals).length > 0 && (
                    <tfoot>
                      <tr className="bg-muted/30 font-semibold">
                        {columns.map((col, idx) => {
                          const type = (col.type as ColumnType) ?? "text";
                          const total = columnTotals[col.name];
                          return (<td key={col.id} className="px-3 py-2 text-sm">{total !== undefined ? <span className="text-primary">{type === "currency" ? `₹${total.toLocaleString("en-IN")}` : total.toLocaleString("en-IN")}</span> : idx === 0 ? "Total" : ""}</td>);
                        })}
                        <td />
                      </tr>
                    </tfoot>
                  )}
                </table>
              </div>
            )}
          </motion.div>
        ) : (
          <div className="glass-card p-12 text-center">
            <Table2 className="w-16 h-16 mx-auto mb-4 text-muted-foreground" />
            <h3 className="text-lg font-semibold mb-2">No Tables Yet</h3>
            <p className="text-muted-foreground mb-4">Create your first table to start tracking data</p>
            <Button onClick={() => setIsCreateDialogOpen(true)} className="gap-2"><Plus className="w-4 h-4" />Create First Table</Button>
          </div>
        )}

        {/* Fill Down floating button */}
        {fillAnchor && fillEnd && (() => {
          const list = rowsRef.current;
          const ai = list.findIndex((x) => x.id === fillAnchor.rowId);
          const ei = list.findIndex((x) => x.id === fillEnd.rowId);
          const count = Math.max(0, ei - ai);
          return count > 0 ? (
            <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex gap-2">
              <Button onClick={handleFillDown} className="shadow-lg gap-2"><Plus className="w-4 h-4" />Fill Down ({count} cells)</Button>
              <Button variant="outline" onClick={() => { setFillAnchor(null); setFillEnd(null); }} className="shadow-lg"><X className="w-4 h-4" /></Button>
            </div>
          ) : null;
        })()}
      </motion.div>
    </>
  );
}
