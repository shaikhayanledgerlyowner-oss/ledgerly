import React, { useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import {
  Plus,
  Table2,
  Trash2,
  Edit3,
  Search,
  SortAsc,
  SortDesc,
  MoreHorizontal,
  ChevronDown,
  X,
  Save,
  Calculator,
  HelpCircle,
  Download,
  FileSpreadsheet,
} from "lucide-react";

import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

import { toast } from "sonner";

// ✅ PDF libs
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

// ✅ Excel export
import * as XLSX from "xlsx";
import { saveAs } from "file-saver";

type ColumnType = "text" | "number" | "currency" | "date";

interface DbTable {
  id: string;
  user_id: string;
  name: string;
  created_at: string;
}

interface DbColumn {
  id: string;
  table_id: string;
  name: string;
  type: ColumnType | string;
  created_at: string;
}

interface DbRow {
  id: string;
  table_id: string;
  row_data: Record<string, any> | null;
  created_at: string;
}

function toNumberSafe(v: any): number {
  if (v === null || v === undefined || v === "") return 0;
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  const n = Number(String(v).replace(/,/g, ""));
  return Number.isFinite(n) ? n : 0;
}

function safeFileName(name: string) {
  return String(name || "table").replace(/[\/\\:*?"<>|]/g, "-").trim() || "table";
}

function formatCellValue(value: any, type: ColumnType): string {
  if (value === undefined || value === null || value === "") return "";
  switch (type) {
    case "currency":
      return `₹${toNumberSafe(value).toLocaleString("en-IN")}`;
    case "number":
      return toNumberSafe(value).toLocaleString("en-IN");
    case "date":
      try {
        return new Date(String(value)).toLocaleDateString();
      } catch {
        return String(value);
      }
    default:
      return String(value);
  }
}

// ✅ PDF currency formatting (avoid ₹ issue in jsPDF)
function moneyPDF(v: any) {
  const num = toNumberSafe(v);
  return `Rs. ${num.toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export default function TablesPage() {
  const { profile } = useAuth();
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

  // Inline cell edit
  const [editingCell, setEditingCell] = useState<{ rowId: string; colName: string } | null>(null);
  const [editValue, setEditValue] = useState("");

  // Column edit (name + type)
  const [editingColumnId, setEditingColumnId] = useState<string | null>(null);
  const [editingColumnName, setEditingColumnName] = useState("");
  const [editingColumnType, setEditingColumnType] = useState<ColumnType>("text");

  // EasyCount
  const [showEasyCount, setShowEasyCount] = useState(false);
  const [countConditions, setCountConditions] = useState<{ column: string; criteria: string }[]>([
    { column: "", criteria: "" },
  ]);
  const [countResult, setCountResult] = useState<number | null>(null);

  // ✅ Excel-like navigation refs
  const cellRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const columnsRef = useRef<DbColumn[]>([]);
  const rowsRef = useRef<DbRow[]>([]);

  // ✅ FIX: stable delete confirm dialog
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<DbTable | null>(null);

  const cellKey = (rowId: string, colName: string) => `${rowId}__${colName}`;

  const focusCell = (rowId: string, colName: string) => {
    const el = cellRefs.current[cellKey(rowId, colName)];
    if (el) {
      el.focus();
      el.select?.();
    }
  };

  const loadTables = async () => {
    if (!userId) return;

    const { data, error } = await supabase
      .from("user_tables")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: true });

    if (error) {
      toast.error(error.message);
      return;
    }

    const list = (data ?? []) as DbTable[];
    setTables(list);

    // if selected table deleted, auto select first
    if (selectedTable) {
      const stillExists = list.some((t) => t.id === selectedTable.id);
      if (!stillExists) setSelectedTable(list[0] ?? null);
    } else if (list.length > 0) {
      setSelectedTable(list[0]);
    }
  };

  const loadTableData = async (tableId: string) => {
    const [colRes, rowRes] = await Promise.all([
      supabase
        .from("user_columns")
        .select("*")
        .eq("table_id", tableId)
        .order("created_at", { ascending: true }),
      supabase
        .from("user_rows")
        .select("*")
        .eq("table_id", tableId)
        .order("created_at", { ascending: true }),
    ]);

    if (colRes.error) toast.error(colRes.error.message);
    if (rowRes.error) toast.error(rowRes.error.message);

    setColumns(
      ((colRes.data ?? []) as DbColumn[]).map((c) => ({ ...c, type: (c.type as any) ?? "text" }))
    );
    setRows(((rowRes.data ?? []) as DbRow[]).map((r) => ({ ...r, row_data: (r.row_data ?? {}) as any })));
  };

  useEffect(() => {
    loadTables();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  useEffect(() => {
    if (!selectedTable) return;
    loadTableData(selectedTable.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedTable?.id]);

  const handleCreateTable = async () => {
    if (!userId) return;
    if (!newTableName.trim()) return toast.error("Please enter a table name");

    const { data, error } = await supabase
      .from("user_tables")
      .insert({ user_id: userId, name: newTableName.trim() })
      .select("*")
      .single();

    if (error) return toast.error(error.message);

    toast.success("Table created");
    setNewTableName("");
    setIsCreateDialogOpen(false);

    const created = data as DbTable;
    await loadTables();
    setSelectedTable(created);
  };

  const handleRenameTable = async (table: DbTable) => {
    const newName = prompt("Enter new table name:", table.name);
    if (!newName || !newName.trim()) return;

    const { error } = await supabase
      .from("user_tables")
      .update({ name: newName.trim() })
      .eq("id", table.id);

    if (error) return toast.error(error.message);

    toast.success("Table renamed");
    await loadTables();
    if (selectedTable?.id === table.id) setSelectedTable({ ...table, name: newName.trim() });
  };

  // ✅ FIX: Delete table + child rows/columns first (FK/RLS friendly)
  const handleDeleteTable = async (tableId: string) => {
    try {
      // 1) delete rows
      const rowsDel = await supabase.from("user_rows").delete().eq("table_id", tableId);
      if (rowsDel.error) throw rowsDel.error;

      // 2) delete columns
      const colsDel = await supabase.from("user_columns").delete().eq("table_id", tableId);
      if (colsDel.error) throw colsDel.error;

      // 3) delete table
      const tableDel = await supabase.from("user_tables").delete().eq("id", tableId);
      if (tableDel.error) throw tableDel.error;

      toast.success("Table deleted");

      if (selectedTable?.id === tableId) {
        setSelectedTable(null);
        setColumns([]);
        setRows([]);
      }

      await loadTables();
    } catch (e: any) {
      toast.error(e?.message || "Table delete failed");
    }
  };

  const openDeleteConfirm = (table: DbTable) => {
    setDeleteTarget(table);
    setDeleteDialogOpen(true);
  };

  const handleAddColumn = async () => {
    if (!selectedTable) return;
    if (!newColumnName.trim()) return toast.error("Please enter a column name");

    const colName = newColumnName.trim();

    const { error } = await supabase
      .from("user_columns")
      .insert({ table_id: selectedTable.id, name: colName, type: newColumnType });

    if (error) return toast.error(error.message);

    // Add key in all existing rows
    if (rows.length > 0) {
      await Promise.all(
        rows.map((r) => {
          const rd = (r.row_data ?? {}) as Record<string, any>;
          if (rd[colName] !== undefined) return Promise.resolve();
          const updated = { ...rd, [colName]: "" };
          return supabase.from("user_rows").update({ row_data: updated }).eq("id", r.id);
        })
      );
    }

    toast.success("Column added");
    setNewColumnName("");
    setNewColumnType("text");
    setIsColumnDialogOpen(false);
    await loadTableData(selectedTable.id);
  };

  const handleDeleteColumn = async (col: DbColumn) => {
    if (!selectedTable) return;

    const { error } = await supabase.from("user_columns").delete().eq("id", col.id);
    if (error) return toast.error(error.message);

    if (rows.length > 0) {
      await Promise.all(
        rows.map((r) => {
          const rd = (r.row_data ?? {}) as Record<string, any>;
          if (!(col.name in rd)) return Promise.resolve();
          const updated = { ...rd };
          delete updated[col.name];
          return supabase.from("user_rows").update({ row_data: updated }).eq("id", r.id);
        })
      );
    }

    toast.success("Column deleted");
    await loadTableData(selectedTable.id);
  };

  // ✅ Column Update: name + type + data sanitize
  const handleColumnUpdate = async (col: DbColumn) => {
    if (!selectedTable) return;

    const newName = editingColumnName.trim();
    const newType = editingColumnType;

    if (!newName) return toast.error("Column name required");

    const oldName = col.name;

    const { error } = await supabase
      .from("user_columns")
      .update({ name: newName, type: newType })
      .eq("id", col.id);

    if (error) return toast.error(error.message);

    if (rows.length > 0) {
      await Promise.all(
        rows.map(async (r) => {
          const rd = (r.row_data ?? {}) as Record<string, any>;
          const updated: Record<string, any> = { ...rd };

          // rename key if changed
          if (oldName !== newName) {
            updated[newName] = updated[oldName];
            delete updated[oldName];
          }

          // sanitize based on new type
          const v = updated[newName];

          if (newType === "number" || newType === "currency") {
            updated[newName] = v === "" || v === null || v === undefined ? "" : toNumberSafe(v);
          } else if (newType === "date") {
            if (!v) updated[newName] = "";
            else {
              const dt = new Date(String(v));
              updated[newName] = isNaN(dt.getTime()) ? "" : dt.toISOString().slice(0, 10);
            }
          } else {
            updated[newName] = v === null || v === undefined ? "" : String(v);
          }

          return supabase.from("user_rows").update({ row_data: updated }).eq("id", r.id);
        })
      );
    }

    toast.success("Column updated");
    setEditingColumnId(null);
    setEditingColumnName("");
    setEditingColumnType("text");
    await loadTableData(selectedTable.id);
  };

  const handleAddRow = async () => {
    if (!selectedTable) return;
    if (columns.length === 0) return toast.error("Add columns first");

    const empty: Record<string, any> = {};
    columns.forEach((c) => (empty[c.name] = ""));

    const { error } = await supabase
      .from("user_rows")
      .insert({ table_id: selectedTable.id, row_data: empty });

    if (error) return toast.error(error.message);

    await loadTableData(selectedTable.id);
  };

  const handleDeleteRow = async (rowId: string) => {
    const { error } = await supabase.from("user_rows").delete().eq("id", rowId);
    if (error) return toast.error(error.message);

    toast.success("Row deleted");
    setRows((prev) => prev.filter((r) => r.id !== rowId));
  };

  const startEditCell = (rowId: string, colName: string, current: any) => {
    setEditingCell({ rowId, colName });
    setEditValue(current === undefined || current === null ? "" : String(current));
  };

  const saveCell = async () => {
    if (!editingCell) return;

    const { rowId, colName } = editingCell;

    const col = columns.find((c) => c.name === colName);
    const type = (col?.type as ColumnType) ?? "text";

    let value: any = editValue;

    if (type === "number" || type === "currency") {
      value = editValue === "" ? "" : toNumberSafe(editValue);
    }

    if (type === "date") {
      if (!editValue) value = "";
      else {
        const dt = new Date(String(editValue));
        value = isNaN(dt.getTime()) ? "" : dt.toISOString().slice(0, 10);
      }
    }

    // update local
    setRows((prev) =>
      prev.map((r) => {
        if (r.id !== rowId) return r;
        const rd = (r.row_data ?? {}) as Record<string, any>;
        return { ...r, row_data: { ...rd, [colName]: value } };
      })
    );

    // update DB
    const row = rows.find((r) => r.id === rowId);
    const rd = ((row?.row_data ?? {}) as Record<string, any>) ?? {};
    const updated = { ...rd, [colName]: value };

    const { error } = await supabase.from("user_rows").update({ row_data: updated }).eq("id", rowId);
    if (error) toast.error(error.message);

    setEditingCell(null);
    setEditValue("");
  };

  // ✅ Search + Sort
  const filteredAndSortedRows = useMemo(() => {
    let list = [...rows];

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      list = list.filter((r) => {
        const rd = (r.row_data ?? {}) as Record<string, any>;
        return Object.values(rd).some((v) => String(v ?? "").toLowerCase().includes(q));
      });
    }

    if (sortColumnName) {
      const col = columns.find((c) => c.name === sortColumnName);
      const type = (col?.type as ColumnType) ?? "text";

      list.sort((a, b) => {
        const aVal = ((a.row_data ?? {}) as Record<string, any>)[sortColumnName] ?? "";
        const bVal = ((b.row_data ?? {}) as Record<string, any>)[sortColumnName] ?? "";

        if (type === "number" || type === "currency") {
          const na = toNumberSafe(aVal);
          const nb = toNumberSafe(bVal);
          return sortDirection === "asc" ? na - nb : nb - na;
        }

        const sa = String(aVal);
        const sb = String(bVal);
        return sortDirection === "asc" ? sa.localeCompare(sb) : sb.localeCompare(sa);
      });
    }

    return list;
  }, [rows, searchQuery, sortColumnName, sortDirection, columns]);

  // keep refs updated for navigation
  useEffect(() => {
    columnsRef.current = columns;
  }, [columns]);

  useEffect(() => {
    rowsRef.current = filteredAndSortedRows;
  }, [filteredAndSortedRows]);

  const startEditAndFocus = (rowId: string, colName: string) => {
    const row = rowsRef.current.find((r) => r.id === rowId);
    const rd = (row?.row_data ?? {}) as Record<string, any>;
    startEditCell(rowId, colName, rd[colName]);
    setTimeout(() => focusCell(rowId, colName), 0);
  };

  const moveFromCell = async (
    rowId: string,
    colName: string,
    dir: "right" | "left" | "down" | "up"
  ) => {
    const cols = columnsRef.current;
    const list = rowsRef.current;

    const rIndex = list.findIndex((r) => r.id === rowId);
    const cIndex = cols.findIndex((c) => c.name === colName);

    if (rIndex < 0 || cIndex < 0) return;

    let nr = rIndex;
    let nc = cIndex;

    if (dir === "right") nc = Math.min(cIndex + 1, cols.length - 1);
    if (dir === "left") nc = Math.max(cIndex - 1, 0);
    if (dir === "down") nr = Math.min(rIndex + 1, list.length - 1);
    if (dir === "up") nr = Math.max(rIndex - 1, 0);

    const nextRow = list[nr];
    const nextCol = cols[nc];
    if (!nextRow || !nextCol) return;

    await saveCell();
    startEditAndFocus(nextRow.id, nextCol.name);
  };

  const handleSort = (colName: string) => {
    if (sortColumnName === colName) {
      setSortDirection((prev) => (prev === "asc" ? "desc" : "asc"));
    } else {
      setSortColumnName(colName);
      setSortDirection("asc");
    }
  };

  const columnTotals = useMemo(() => {
    const totals: Record<string, number> = {};
    columns.forEach((c) => {
      const type = (c.type as ColumnType) ?? "text";
      if (type === "number" || type === "currency") {
        totals[c.name] = rows.reduce((sum, r) => {
          const rd = (r.row_data ?? {}) as Record<string, any>;
          return sum + toNumberSafe(rd[c.name]);
        }, 0);
      }
    });
    return totals;
  }, [columns, rows]);

  const handleEasyCount = () => {
    if (!selectedTable) return;

    const active = countConditions
      .map((c) => ({ column: c.column.trim(), criteria: c.criteria.trim() }))
      .filter((c) => c.column && c.criteria);

    if (active.length === 0) {
      setCountResult(0);
      return toast.error("Add at least 1 condition");
    }

    const result = rows.filter((r) => {
      const rd = (r.row_data ?? {}) as Record<string, any>;
      return active.every((cond) => {
        const v = String(rd[cond.column] ?? "").toLowerCase();
        return v.includes(cond.criteria.toLowerCase());
      });
    }).length;

    setCountResult(result);
    toast.success(`Found ${result} matching rows`);
  };

  // ✅ PDF Download (Selected Table)
  const downloadSelectedTablePDF = () => {
    if (!selectedTable) return toast.error("Select a table first");
    if (columns.length === 0) return toast.error("No columns to export");

    const doc = new jsPDF({ orientation: "l", unit: "pt", format: "a4" });

    doc.setFont("helvetica", "bold");
    doc.setFontSize(16);
    doc.text(`Ledgerly - ${selectedTable.name}`, 40, 45);

    doc.setFont("helvetica", "normal");
    doc.setFontSize(11);
    doc.text(`Generated: ${new Date().toLocaleString()}`, 40, 65);

    const head = [columns.map((c) => c.name)];

    const body = filteredAndSortedRows.map((r) => {
      const rd = (r.row_data ?? {}) as Record<string, any>;
      return columns.map((c) => {
        const type = (c.type as ColumnType) ?? "text";
        const v = rd[c.name];

        if (type === "currency") return moneyPDF(v);
        if (type === "number") return toNumberSafe(v).toLocaleString("en-IN");
        if (type === "date") {
          if (!v) return "";
          const dt = new Date(String(v));
          return isNaN(dt.getTime()) ? "" : dt.toLocaleDateString();
        }
        return v === null || v === undefined ? "" : String(v);
      });
    });

    const hasTotals = rows.length > 0 && Object.keys(columnTotals).length > 0;
    if (hasTotals) {
      const totalRow = columns.map((c, idx) => {
        const type = (c.type as ColumnType) ?? "text";
        const total = columnTotals[c.name];

        if (total !== undefined) {
          return type === "currency"
            ? `Rs. ${total.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
            : total.toLocaleString("en-IN");
        }
        return idx === 0 ? "Total" : "";
      });
      body.push(totalRow);
    }

    autoTable(doc, {
      startY: 85,
      head,
      body,
      styles: { font: "helvetica", fontSize: 9, cellPadding: 6, overflow: "linebreak" },
      headStyles: { fillColor: [30, 30, 30], textColor: 255 },
      didParseCell: (data) => {
        if (hasTotals && data.row.index === body.length - 1) {
          data.cell.styles.fontStyle = "bold";
        }
      },
      margin: { left: 40, right: 40 },
    });

    doc.save(`Ledgerly-${safeFileName(selectedTable.name)}.pdf`);
    toast.success("PDF downloaded");
  };

  // ✅ Excel Download (Selected Table)
  const downloadSelectedTableExcel = () => {
    if (!selectedTable) return toast.error("Select a table first");
    if (columns.length === 0) return toast.error("No columns to export");

    try {
      const header = columns.map((c) => c.name);

      const data = filteredAndSortedRows.map((r) => {
        const rd = (r.row_data ?? {}) as Record<string, any>;
        return columns.map((c) => {
          const type = (c.type as ColumnType) ?? "text";
          const v = rd[c.name];

          if (type === "number" || type === "currency") {
            return v === "" || v === null || v === undefined ? "" : toNumberSafe(v);
          }

          if (type === "date") {
            if (!v) return "";
            const dt = new Date(String(v));
            return isNaN(dt.getTime()) ? "" : dt.toISOString().slice(0, 10);
          }

          return v === null || v === undefined ? "" : String(v);
        });
      });

      const hasTotals = rows.length > 0 && Object.keys(columnTotals).length > 0;
      if (hasTotals) {
        const totalRow = columns.map((c, idx) => {
          const total = columnTotals[c.name];
          if (total !== undefined) return total;
          return idx === 0 ? "Total" : "";
        });
        data.push(totalRow as any);
      }

      const ws = XLSX.utils.aoa_to_sheet([header, ...data]);

      (ws as any)["!cols"] = header.map((h, i) => {
        const maxLen = Math.max(h.length, ...data.slice(0, 200).map((row) => String(row[i] ?? "").length));
        return { wch: Math.min(Math.max(maxLen + 2, 10), 40) };
      });

      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Data");

      const out = XLSX.write(wb, { bookType: "xlsx", type: "array" });
      saveAs(
        new Blob([out], { type: "application/octet-stream" }),
        `Ledgerly-${safeFileName(selectedTable.name)}.xlsx`
      );

      toast.success("Excel downloaded");
    } catch (e: any) {
      toast.error(e?.message || "Excel download failed");
    }
  };

  return (
    <>
      {/* ✅ FIXED: One global confirm dialog (stable) */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete table?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTarget ? (
                <>
                  This will permanently delete <b>{deleteTarget.name}</b> and all its data.
                </>
              ) : (
                "This will permanently delete the table and all its data."
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel
              onClick={() => {
                setDeleteDialogOpen(false);
                setDeleteTarget(null);
              }}
            >
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={async () => {
                if (!deleteTarget) return;
                const id = deleteTarget.id;
                setDeleteDialogOpen(false);
                setDeleteTarget(null);
                await handleDeleteTable(id);
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-6 animate-fade-in">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-2xl font-display font-bold">Tables</h1>
            <p className="text-muted-foreground">Create and manage your custom data tables</p>
          </div>

          <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
            <DialogTrigger asChild>
              <Button className="gap-2">
                <Plus className="w-4 h-4" />
                New Table
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Create New Table</DialogTitle>
              </DialogHeader>
              <div className="space-y-4 pt-4">
                <div>
                  <label className="text-sm font-medium">Table Name</label>
                  <Input
                    placeholder="e.g., Monthly Expenses"
                    value={newTableName}
                    onChange={(e) => setNewTableName(e.target.value)}
                    className="mt-2"
                    onKeyDown={(e) => e.key === "Enter" && handleCreateTable()}
                  />
                </div>
                <p className="text-xs text-muted-foreground">
                  Your table will start empty. Add columns and rows after creation.
                </p>
                <Button onClick={handleCreateTable} className="w-full">
                  Create Table
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>

        {/* Table List */}
        {tables.length > 0 && (
          <div className="flex gap-2 overflow-x-auto pb-2">
            {tables.map((table) => (
              <button
                key={table.id}
                onClick={() => setSelectedTable(table)}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg whitespace-nowrap transition-all ${
                  selectedTable?.id === table.id
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted hover:bg-muted/80 text-foreground"
                }`}
              >
                <Table2 className="w-4 h-4" />
                {table.name}

                <DropdownMenu>
                  <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
                    <button className="ml-1 p-1 rounded hover:bg-foreground/10" type="button">
                      <MoreHorizontal className="w-3 h-3" />
                    </button>
                  </DropdownMenuTrigger>

                  <DropdownMenuContent onClick={(e) => e.stopPropagation()}>
                    <DropdownMenuItem
                      onSelect={(e) => {
                        e.preventDefault();
                        handleRenameTable(table);
                      }}
                    >
                      <Edit3 className="w-4 h-4 mr-2" />
                      Rename
                    </DropdownMenuItem>

                    <DropdownMenuSeparator />

                    {/* ✅ FIX: prevent dropdown close glitch + open stable dialog */}
                    <DropdownMenuItem
                      className="text-destructive"
                      onSelect={(e) => {
                        e.preventDefault(); // important
                        openDeleteConfirm(table);
                      }}
                      onClick={(e) => {
                        e.stopPropagation(); // important
                      }}
                    >
                      <Trash2 className="w-4 h-4 mr-2" />
                      Delete
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </button>
            ))}
          </div>
        )}

        {/* Selected Table */}
        {selectedTable ? (
          <motion.div
            key={selectedTable.id}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="glass-card overflow-hidden"
          >
            {/* Controls */}
            <div className="p-4 border-b border-border flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between">
              <div className="flex items-center gap-2 flex-1 w-full sm:w-auto">
                <div className="relative flex-1 max-w-xs">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input
                    placeholder="Search..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="pl-9"
                  />
                </div>

                {/* EasyCount */}
                <Popover open={showEasyCount} onOpenChange={setShowEasyCount}>
                  <PopoverTrigger asChild>
                    <Button variant="outline" size="sm">
                      <Calculator className="w-4 h-4 mr-1" />
                      EasyCount
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-80" align="start">
                    <div className="space-y-4">
                      <div className="flex items-center gap-2">
                        <h4 className="font-semibold">EasyCount Filter</h4>
                        <Popover>
                          <PopoverTrigger asChild>
                            <button type="button">
                              <HelpCircle className="w-4 h-4 text-muted-foreground cursor-help" />
                            </button>
                          </PopoverTrigger>
                          <PopoverContent className="w-72 text-xs">
                            <p className="font-medium mb-2">How to use:</p>
                            <p>Count rows where column values contain your criteria.</p>
                          </PopoverContent>
                        </Popover>
                      </div>

                      {countConditions.map((cond, idx) => (
                        <div key={idx} className="flex gap-2">
                          <Select
                            value={cond.column}
                            onValueChange={(v) => {
                              const newConds = [...countConditions];
                              newConds[idx].column = v;
                              setCountConditions(newConds);
                            }}
                          >
                            <SelectTrigger className="w-28">
                              <SelectValue placeholder="Column" />
                            </SelectTrigger>
                            <SelectContent>
                              {columns.map((col) => (
                                <SelectItem key={col.id} value={col.name}>
                                  {col.name}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>

                          <Input
                            placeholder="contains..."
                            value={cond.criteria}
                            onChange={(e) => {
                              const newConds = [...countConditions];
                              newConds[idx].criteria = e.target.value;
                              setCountConditions(newConds);
                            }}
                            className="flex-1"
                          />

                          {countConditions.length > 1 && (
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => setCountConditions(countConditions.filter((_, i) => i !== idx))}
                            >
                              <X className="w-4 h-4" />
                            </Button>
                          )}
                        </div>
                      ))}

                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() =>
                          setCountConditions([...countConditions, { column: "", criteria: "" }])
                        }
                        className="w-full"
                      >
                        <Plus className="w-4 h-4 mr-1" /> Add Condition
                      </Button>

                      <Button onClick={handleEasyCount} className="w-full">
                        Count
                      </Button>

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
                <Button variant="outline" size="sm" onClick={downloadSelectedTablePDF} className="gap-2">
                  <Download className="w-4 h-4" />
                  Download PDF
                </Button>

                <Button variant="outline" size="sm" onClick={downloadSelectedTableExcel} className="gap-2">
                  <FileSpreadsheet className="w-4 h-4" />
                  Download Excel
                </Button>

                <Dialog open={isColumnDialogOpen} onOpenChange={setIsColumnDialogOpen}>
                  <DialogTrigger asChild>
                    <Button variant="outline" size="sm">
                      <Plus className="w-4 h-4 mr-1" />
                      Add Column
                    </Button>
                  </DialogTrigger>
                  <DialogContent>
                    <DialogHeader>
                      <DialogTitle>Add Column</DialogTitle>
                    </DialogHeader>
                    <div className="space-y-4 pt-4">
                      <div>
                        <label className="text-sm font-medium">Column Name</label>
                        <Input
                          placeholder="e.g., Amount"
                          value={newColumnName}
                          onChange={(e) => setNewColumnName(e.target.value)}
                          className="mt-2"
                        />
                      </div>
                      <div>
                        <label className="text-sm font-medium">Column Type</label>
                        <Select value={newColumnType} onValueChange={(v) => setNewColumnType(v as ColumnType)}>
                          <SelectTrigger className="mt-2">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="text">Text</SelectItem>
                            <SelectItem value="number">Number</SelectItem>
                            <SelectItem value="currency">Currency (₹)</SelectItem>
                            <SelectItem value="date">Date</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <Button onClick={handleAddColumn} className="w-full">
                        Add Column
                      </Button>
                    </div>
                  </DialogContent>
                </Dialog>

                <Button onClick={handleAddRow} variant="outline" size="sm">
                  <Plus className="w-4 h-4 mr-1" />
                  Add Row
                </Button>
              </div>
            </div>

            {/* Table */}
            {columns.length === 0 ? (
              <div className="p-12 text-center">
                <Table2 className="w-12 h-12 mx-auto mb-4 text-muted-foreground" />
                <h3 className="font-semibold mb-2">Empty Table</h3>
                <p className="text-muted-foreground mb-4">Start by adding columns to your table</p>
                <Button onClick={() => setIsColumnDialogOpen(true)} className="gap-2">
                  <Plus className="w-4 h-4" />
                  Add First Column
                </Button>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="bg-muted/50">
                      {columns.map((col) => {
                        const type = (col.type as ColumnType) ?? "text";
                        return (
                          <th
                            key={col.id}
                            className="px-3 py-2 text-left text-sm font-medium border-b border-border group whitespace-nowrap"
                          >
                            <div className="flex items-center gap-2">
                              {editingColumnId === col.id ? (
                                <div className="flex items-center gap-2">
                                  <Input
                                    value={editingColumnName}
                                    onChange={(e) => setEditingColumnName(e.target.value)}
                                    className="h-7 text-xs w-40"
                                    autoFocus
                                    onKeyDown={(e) => {
                                      if (e.key === "Enter") handleColumnUpdate(col);
                                      if (e.key === "Escape") {
                                        setEditingColumnId(null);
                                        setEditingColumnName("");
                                        setEditingColumnType("text");
                                      }
                                    }}
                                  />

                                  <Select
                                    value={editingColumnType}
                                    onValueChange={(v) => setEditingColumnType(v as ColumnType)}
                                  >
                                    <SelectTrigger className="h-7 text-xs w-28">
                                      <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                      <SelectItem value="text">Text</SelectItem>
                                      <SelectItem value="number">Number</SelectItem>
                                      <SelectItem value="currency">Currency (₹)</SelectItem>
                                      <SelectItem value="date">Date</SelectItem>
                                    </SelectContent>
                                  </Select>

                                  <button onClick={() => handleColumnUpdate(col)} type="button">
                                    <Save className="w-3 h-3 text-primary" />
                                  </button>
                                  <button
                                    onClick={() => {
                                      setEditingColumnId(null);
                                      setEditingColumnName("");
                                      setEditingColumnType("text");
                                    }}
                                    type="button"
                                  >
                                    <X className="w-3 h-3 text-muted-foreground" />
                                  </button>
                                </div>
                              ) : (
                                <>
                                  <span
                                    className="cursor-pointer hover:text-foreground"
                                    onClick={() => {
                                      setEditingColumnId(col.id);
                                      setEditingColumnName(col.name);
                                      setEditingColumnType(((col.type as any) ?? "text") as ColumnType);
                                    }}
                                  >
                                    {col.name}
                                  </span>

                                  <button onClick={() => handleSort(col.name)} type="button">
                                    {sortColumnName === col.name ? (
                                      sortDirection === "asc" ? (
                                        <SortAsc className="w-3 h-3" />
                                      ) : (
                                        <SortDesc className="w-3 h-3" />
                                      )
                                    ) : (
                                      <ChevronDown className="w-3 h-3 text-muted-foreground/60" />
                                    )}
                                  </button>

                                  <DropdownMenu>
                                    <DropdownMenuTrigger asChild>
                                      <button type="button" className="opacity-0 group-hover:opacity-100">
                                        <MoreHorizontal className="w-3 h-3" />
                                      </button>
                                    </DropdownMenuTrigger>
                                    <DropdownMenuContent>
                                      <DropdownMenuItem
                                        className="text-destructive"
                                        onSelect={(e) => e.preventDefault()}
                                        onClick={() => handleDeleteColumn(col)}
                                      >
                                        <Trash2 className="w-4 h-4 mr-2" />
                                        Delete Column
                                      </DropdownMenuItem>
                                    </DropdownMenuContent>
                                  </DropdownMenu>
                                </>
                              )}
                            </div>
                          </th>
                        );
                      })}
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

                            return (
                              <td
                                key={col.id}
                                className="px-3 py-2 text-sm cursor-pointer"
                                onClick={() => startEditAndFocus(r.id, col.name)}
                              >
                                {isEditing ? (
                                  <Input
                                    ref={(el) => {
                                      cellRefs.current[cellKey(r.id, col.name)] = el;
                                    }}
                                    type={type === "date" ? "date" : "text"}
                                    inputMode={type === "number" || type === "currency" ? "decimal" : undefined}
                                    value={editValue}
                                    onChange={(e) => setEditValue(e.target.value)}
                                    onBlur={saveCell}
                                    onKeyDown={async (e) => {
                                      if (e.key === "Enter") {
                                        e.preventDefault();
                                        await moveFromCell(r.id, col.name, "down");
                                        return;
                                      }
                                      if (e.key === "Tab") {
                                        e.preventDefault();
                                        await moveFromCell(r.id, col.name, e.shiftKey ? "left" : "right");
                                        return;
                                      }
                                      if (e.key === "ArrowRight") {
                                        e.preventDefault();
                                        await moveFromCell(r.id, col.name, "right");
                                        return;
                                      }
                                      if (e.key === "ArrowLeft") {
                                        e.preventDefault();
                                        await moveFromCell(r.id, col.name, "left");
                                        return;
                                      }
                                      if (e.key === "ArrowDown") {
                                        e.preventDefault();
                                        await moveFromCell(r.id, col.name, "down");
                                        return;
                                      }
                                      if (e.key === "ArrowUp") {
                                        e.preventDefault();
                                        await moveFromCell(r.id, col.name, "up");
                                        return;
                                      }
                                      if (e.key === "Escape") {
                                        e.preventDefault();
                                        setEditingCell(null);
                                        setEditValue("");
                                        return;
                                      }
                                    }}
                                    className="h-8 text-sm"
                                    autoFocus
                                  />
                                ) : (
                                  <span className={type === "currency" ? "text-primary font-medium" : ""}>
                                    {formatCellValue(rd[col.name], type) || (
                                      <span className="text-muted-foreground/30">-</span>
                                    )}
                                  </span>
                                )}
                              </td>
                            );
                          })}

                          <td className="px-3 py-2">
                            <Button
                              variant="ghost"
                              size="sm"
                              className="opacity-0 group-hover:opacity-100"
                              onClick={() => handleDeleteRow(r.id)}
                            >
                              <Trash2 className="w-4 h-4 text-destructive" />
                            </Button>
                          </td>
                        </tr>
                      );
                    })}

                    {rows.length === 0 && (
                      <tr>
                        <td colSpan={columns.length + 1} className="text-center py-10 text-muted-foreground">
                          No rows yet. Click "Add Row" to add data.
                        </td>
                      </tr>
                    )}
                  </tbody>

                  {/* Totals */}
                  {rows.length > 0 && Object.keys(columnTotals).length > 0 && (
                    <tfoot>
                      <tr className="bg-muted/30 font-semibold">
                        {columns.map((col, idx) => {
                          const type = (col.type as ColumnType) ?? "text";
                          const total = columnTotals[col.name];
                          return (
                            <td key={col.id} className="px-3 py-2 text-sm">
                              {total !== undefined ? (
                                <span className="text-primary">
                                  {type === "currency"
                                    ? `₹${total.toLocaleString("en-IN")}`
                                    : total.toLocaleString("en-IN")}
                                </span>
                              ) : idx === 0 ? (
                                "Total"
                              ) : (
                                ""
                              )}
                            </td>
                          );
                        })}
                        <td className="px-3 py-2" />
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
            <Button onClick={() => setIsCreateDialogOpen(true)} className="gap-2">
              <Plus className="w-4 h-4" />
              Create First Table
            </Button>
          </div>
        )}
      </motion.div>
    </>
  );
}