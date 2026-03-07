import React, { useEffect, useMemo, useRef, useState, useCallback } from "react";
import {
  Plus, Table2, Trash2, Edit3, Search, SortAsc, SortDesc,
  MoreHorizontal, X, Calculator, HelpCircle, Download,
  FileSpreadsheet, Bold, AlignLeft, Hash, Calendar, DollarSign,
  ChevronDown, Type, RefreshCw
} from "lucide-react";

import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuTrigger, DropdownMenuSeparator, DropdownMenuSub,
  DropdownMenuSubContent, DropdownMenuSubTrigger,
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

function toNum(v: any): number {
  if (v == null || v === "") return 0;
  if (typeof v === "number") return isFinite(v) ? v : 0;
  const n = Number(String(v).replace(/,/g, ""));
  return isFinite(n) ? n : 0;
}
function safeFileName(n: string) { return String(n || "table").replace(/[\/\\:*?"<>|]/g, "-").trim() || "table"; }

function formatDateDMY(v: any): string {
  if (!v) return "";
  const d = new Date(String(v));
  if (isNaN(d.getTime())) return String(v);
  return `${String(d.getDate()).padStart(2,"0")}/${String(d.getMonth()+1).padStart(2,"0")}/${d.getFullYear()}`;
}

function parseDateInput(val: string): string {
  if (!val) return "";
  const dmy = val.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (dmy) { const dt = new Date(+dmy[3], +dmy[2]-1, +dmy[1]); if (!isNaN(dt.getTime())) return dt.toISOString().slice(0,10); }
  const iso = val.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) return val;
  const dt = new Date(val);
  if (!isNaN(dt.getTime())) return dt.toISOString().slice(0,10);
  return "";
}

function displayVal(value: any, type: ColumnType): string {
  if (value == null || value === "") return "";
  switch (type) {
    case "currency": return `₹${toNum(value).toLocaleString("en-IN")}`;
    case "number": return toNum(value).toLocaleString("en-IN");
    case "date": return formatDateDMY(value);
    default: return String(value);
  }
}

const COL_TYPE_ICONS: Record<ColumnType, React.ReactNode> = {
  text: <Type className="w-3 h-3" />,
  number: <Hash className="w-3 h-3" />,
  currency: <DollarSign className="w-3 h-3" />,
  date: <Calendar className="w-3 h-3" />,
};

// ─── Context Menu ────────────────────────────────────────────────
interface CtxMenu { x: number; y: number; rowId?: string; colId?: string; colName?: string; }

export default function TablesPage() {
  const { profile, hasAccess } = useAuth();
  const uid = profile?.id;

  const [tables, setTables]     = useState<DbTable[]>([]);
  const [selTable, setSelTable] = useState<DbTable | null>(null);
  const [columns, setColumns]   = useState<DbColumn[]>([]);
  const [rows, setRows]         = useState<DbRow[]>([]);

  const [search, setSearch]           = useState("");
  const [sortCol, setSortCol]         = useState<string|null>(null);
  const [sortDir, setSortDir]         = useState<"asc"|"desc">("asc");

  // editing
  const [editCell, setEditCell]   = useState<{rowId:string;colName:string}|null>(null);
  const [editVal, setEditVal]     = useState("");
  const origVal                   = useRef("");
  const editValRef                = useRef("");
  const colsRef                   = useRef<DbColumn[]>([]);
  const rowsRef                   = useRef<DbRow[]>([]);
  const savingRef                 = useRef(false);
  const cellRefs                  = useRef<Record<string,HTMLInputElement|null>>({});

  // formula bar
  const [formulaBar, setFormulaBar] = useState("");

  // context menu
  const [ctx, setCtx] = useState<CtxMenu|null>(null);

  // inline col rename
  const [renamingColId, setRenamingColId] = useState<string|null>(null);
  const [renamingColVal, setRenamingColVal] = useState("");
  const [renamingColType, setRenamingColType] = useState<ColumnType>("text");

  // delete confirm
  const [delTarget, setDelTarget] = useState<DbTable|null>(null);
  const [delOpen, setDelOpen]     = useState(false);

  // easycount
  const [countOpen, setCountOpen] = useState(false);
  const [countConds, setCountConds] = useState<{col:string;crit:string}[]>([{col:"",crit:""}]);
  const [countResult, setCountResult] = useState<number|null>(null);

  // new table name (inline in tab bar)
  const [newTableName, setNewTableName] = useState("");
  const [addingTable, setAddingTable]   = useState(false);

  useEffect(() => { editValRef.current = editVal; }, [editVal]);
  useEffect(() => { colsRef.current = columns; }, [columns]);

  const cellKey = (r:string,c:string) => `${r}__${c}`;
  const focusCell = (rowId:string,colName:string) => {
    setTimeout(() => {
      const el = cellRefs.current[cellKey(rowId,colName)];
      if (el) { el.focus(); el.select?.(); }
    }, 30);
  };

  // ── Data loading ──────────────────────────────────────────────
  const loadTables = async () => {
    if (!uid) return;
    const { data } = await supabase.from("user_tables").select("*").eq("user_id",uid).order("created_at",{ascending:true});
    const list = (data??[]) as DbTable[];
    setTables(list);
    setSelTable(prev => {
      if (prev && list.some(t=>t.id===prev.id)) return list.find(t=>t.id===prev.id)!;
      return list[0]??null;
    });
  };

  const loadData = async (tid:string) => {
    const [cr,rr] = await Promise.all([
      supabase.from("user_columns").select("*").eq("table_id",tid).order("created_at",{ascending:true}),
      supabase.from("user_rows").select("*").eq("table_id",tid).order("created_at",{ascending:true}),
    ]);
    setColumns(((cr.data??[]) as DbColumn[]).map(c=>({...c,type:c.type??"text"})));
    setRows(((rr.data??[]) as DbRow[]).map(r=>({...r,row_data:(r.row_data??{})})));
  };

  useEffect(() => { loadTables(); }, [uid]);
  useEffect(() => { if (selTable) loadData(selTable.id); else {setColumns([]); setRows([]); } }, [selTable?.id]);

  // ── Table CRUD ────────────────────────────────────────────────
  const createTable = async () => {
    if (!uid||!newTableName.trim()) return;
    const { data,error } = await supabase.from("user_tables").insert({user_id:uid,name:newTableName.trim()}).select("*").single();
    if (error) return toast.error(error.message);
    setNewTableName(""); setAddingTable(false);
    await loadTables(); setSelTable(data as DbTable);
    toast.success("Table created");
  };

  const deleteTable = async (tid:string) => {
    await supabase.from("user_rows").delete().eq("table_id",tid);
    await supabase.from("user_columns").delete().eq("table_id",tid);
    await supabase.from("user_tables").delete().eq("id",tid);
    toast.success("Deleted"); await loadTables();
  };

  const renameTable = async (table:DbTable) => {
    const n = prompt("Rename table:",table.name);
    if (!n?.trim()) return;
    await supabase.from("user_tables").update({name:n.trim()}).eq("id",table.id);
    await loadTables();
  };

  // ── Column CRUD ───────────────────────────────────────────────
  const addColumn = async (afterColId?:string) => {
    if (!selTable) return;
    const name = `Column ${columns.length+1}`;
    const { error } = await supabase.from("user_columns").insert({table_id:selTable.id,name,type:"text"});
    if (error) return toast.error(error.message);
    if (rows.length>0) {
      await Promise.all(rows.map(r=>{
        const rd=(r.row_data??{}) as Record<string,any>;
        return supabase.from("user_rows").update({row_data:{...rd,[name]:""}}).eq("id",r.id);
      }));
    }
    await loadData(selTable.id);
    // Start renaming the new column
    setTimeout(()=>{
      const newCols = colsRef.current;
      const nc = newCols[newCols.length-1];
      if (nc) { setRenamingColId(nc.id); setRenamingColVal(nc.name); setRenamingColType("text"); }
    },100);
  };

  const deleteColumn = async (col:DbColumn) => {
    if (!selTable) return;
    await supabase.from("user_columns").delete().eq("id",col.id);
    if (rows.length>0) {
      await Promise.all(rows.map(r=>{
        const rd={...(r.row_data??{})} as Record<string,any>;
        delete rd[col.name];
        return supabase.from("user_rows").update({row_data:rd}).eq("id",r.id);
      }));
    }
    await loadData(selTable.id);
  };

  const updateColumn = async (col:DbColumn, newName:string, newType:ColumnType) => {
    if (!selTable||!newName.trim()) return;
    const old = col.name;
    await supabase.from("user_columns").update({name:newName.trim(),type:newType}).eq("id",col.id);
    if (rows.length>0 && old!==newName.trim()) {
      await Promise.all(rows.map(r=>{
        const rd={...(r.row_data??{})} as Record<string,any>;
        rd[newName.trim()]=rd[old]; delete rd[old];
        return supabase.from("user_rows").update({row_data:rd}).eq("id",r.id);
      }));
    }
    setRenamingColId(null);
    await loadData(selTable.id);
  };

  // ── Row CRUD ──────────────────────────────────────────────────
  const addRow = async (afterRowId?:string) => {
    if (!selTable||columns.length===0) return;
    const empty:Record<string,any>={};
    columns.forEach(c=>(empty[c.name]=""));
    const { data,error } = await supabase.from("user_rows").insert({table_id:selTable.id,row_data:empty}).select("*").single();
    if (error) return toast.error(error.message);
    await loadData(selTable.id);
    // focus first cell of new row
    setTimeout(()=>{
      const newRows = rowsRef.current;
      const nr = newRows[newRows.length-1];
      if (nr && colsRef.current[0]) startEditAndFocus(nr.id, colsRef.current[0].name);
    }, 80);
  };

  const deleteRow = async (rowId:string) => {
    await supabase.from("user_rows").delete().eq("id",rowId);
    setRows(prev=>prev.filter(r=>r.id!==rowId));
  };

  // ── Cell editing ──────────────────────────────────────────────
  const startEdit = (rowId:string, colName:string) => {
    const col = colsRef.current.find(c=>c.name===colName);
    const type = (col?.type as ColumnType)??"text";
    const row = rowsRef.current.find(r=>r.id===rowId);
    const raw = row ? ((row.row_data??{}) as Record<string,any>)[colName] : "";
    let dv = raw==null?"":String(raw);
    if (type==="date"&&dv) dv = formatDateDMY(dv)||dv;
    origVal.current = dv;
    setEditCell({rowId,colName});
    setEditVal(dv);
    setFormulaBar(dv);
  };

  const startEditAndFocus = (rowId:string, colName:string) => {
    startEdit(rowId,colName);
    focusCell(rowId,colName);
  };

  const saveCellNow = async (rowId:string, colName:string, val:string) => {
    if (savingRef.current) return;
    savingRef.current=true;
    const col = colsRef.current.find(c=>c.name===colName);
    const type=(col?.type as ColumnType)??"text";
    let value:any=val;
    if (type==="number"||type==="currency") value=val===""?"":toNum(val);
    else if (type==="date") value=parseDateInput(val);
    setRows(prev=>prev.map(r=>{
      if(r.id!==rowId) return r;
      return {...r,row_data:{...(r.row_data??{}),[colName]:value}};
    }));
    const row=rowsRef.current.find(r=>r.id===rowId);
    const rd=(row?.row_data??{}) as Record<string,any>;
    await supabase.from("user_rows").update({row_data:{...rd,[colName]:value}}).eq("id",rowId);
    savingRef.current=false;
  };

  const filtered = useMemo(()=>{
    let list=[...rows];
    if(search.trim()){
      const q=search.toLowerCase();
      list=list.filter(r=>Object.values((r.row_data??{}) as Record<string,any>).some(v=>String(v??"").toLowerCase().includes(q)));
    }
    if(sortCol){
      const col=columns.find(c=>c.name===sortCol);
      const type=(col?.type as ColumnType)??"text";
      list.sort((a,b)=>{
        const av=((a.row_data??{}) as Record<string,any>)[sortCol]??"";
        const bv=((b.row_data??{}) as Record<string,any>)[sortCol]??"";
        if(type==="number"||type==="currency"){const na=toNum(av),nb=toNum(bv);return sortDir==="asc"?na-nb:nb-na;}
        return sortDir==="asc"?String(av).localeCompare(String(bv)):String(bv).localeCompare(String(av));
      });
    }
    return list;
  },[rows,search,sortCol,sortDir,columns]);

  useEffect(()=>{rowsRef.current=filtered;},[filtered]);

  const moveCell = async (rowId:string, colName:string, val:string, dir:"right"|"left"|"down"|"up"|"next") => {
    await saveCellNow(rowId,colName,val);
    setEditCell(null); setEditVal(""); setFormulaBar("");
    const cols=colsRef.current; const list=rowsRef.current;
    const ri=list.findIndex(r=>r.id===rowId);
    const ci=cols.findIndex(c=>c.name===colName);
    let nr=ri,nc=ci;
    if(dir==="right"||dir==="next") nc=Math.min(ci+1,cols.length-1);
    else if(dir==="left") nc=Math.max(ci-1,0);
    else if(dir==="down"){
      nr=ri+1;
      // last row + Enter = add new row
      if(nr>=list.length){ addRow(); return; }
    }
    else if(dir==="up") nr=Math.max(ri-1,0);
    const nextRow=list[nr]; const nextCol=cols[nc];
    if(nextRow&&nextCol) startEditAndFocus(nextRow.id,nextCol.name);
  };

  // ── Totals ────────────────────────────────────────────────────
  const totals = useMemo(()=>{
    const t:Record<string,number>={};
    columns.forEach(c=>{
      if(c.type==="number"||c.type==="currency")
        t[c.name]=rows.reduce((s,r)=>s+toNum(((r.row_data??{}) as any)[c.name]),0);
    });
    return t;
  },[columns,rows]);

  // ── Context menu ──────────────────────────────────────────────
  const openCtx = (e:React.MouseEvent, rowId?:string, colId?:string, colName?:string) => {
    e.preventDefault(); e.stopPropagation();
    setCtx({x:e.clientX,y:e.clientY,rowId,colId,colName});
  };
  useEffect(()=>{
    const close=()=>setCtx(null);
    window.addEventListener("click",close);
    return ()=>window.removeEventListener("click",close);
  },[]);

  // ── EasyCount ─────────────────────────────────────────────────
  const doCount = () => {
    const active=countConds.filter(c=>c.col&&c.crit);
    if(!active.length) return toast.error("Add at least 1 condition");
    const n=rows.filter(r=>active.every(cond=>String(((r.row_data??{}) as any)[cond.col]??"").toLowerCase().includes(cond.crit.toLowerCase()))).length;
    setCountResult(n);
  };

  // ── Downloads ─────────────────────────────────────────────────
  const dlPDF = () => {
    if(!hasAccess) return toast.error("Upgrade to download");
    if(!selTable||!columns.length) return;
    const doc=new jsPDF({orientation:"l",unit:"pt",format:"a4"});
    doc.setFont("helvetica","bold"); doc.setFontSize(16);
    doc.text(`${selTable.name}`,40,45);
    doc.setFont("helvetica","normal"); doc.setFontSize(10);
    doc.text(`Exported: ${new Date().toLocaleString()}`,40,62);
    const head=[columns.map(c=>c.name)];
    const body=filtered.map(r=>columns.map(c=>{
      const v=((r.row_data??{}) as any)[c.name];
      if(c.type==="currency") return `Rs. ${toNum(v).toLocaleString("en-IN",{minimumFractionDigits:2,maximumFractionDigits:2})}`;
      if(c.type==="number") return toNum(v).toLocaleString("en-IN");
      if(c.type==="date") return formatDateDMY(v);
      return v==null?"":String(v);
    }));
    if(Object.keys(totals).length){
      body.push(columns.map((c,i)=>{
        const t=totals[c.name];
        if(t!=null) return c.type==="currency"?`Rs. ${t.toLocaleString("en-IN",{minimumFractionDigits:2})}`:t.toLocaleString("en-IN");
        return i===0?"Total":"";
      }));
    }
    autoTable(doc,{startY:75,head,body,styles:{font:"helvetica",fontSize:9,cellPadding:5},headStyles:{fillColor:[30,30,30],textColor:255},margin:{left:40,right:40}});
    doc.save(`${safeFileName(selTable.name)}.pdf`);
    toast.success("PDF downloaded");
  };

  const dlExcel = () => {
    if(!hasAccess) return toast.error("Upgrade to download");
    if(!selTable||!columns.length) return;
    const header=columns.map(c=>c.name);
    const data=filtered.map(r=>columns.map(c=>{
      const v=((r.row_data??{}) as any)[c.name];
      if(c.type==="number"||c.type==="currency") return v===""||v==null?"":toNum(v);
      if(c.type==="date") return formatDateDMY(v);
      return v==null?"":String(v);
    }));
    if(Object.keys(totals).length) data.push(columns.map((c,i)=>{const t=totals[c.name];return t!=null?t:i===0?"Total":""}) as any);
    const ws=XLSX.utils.aoa_to_sheet([header,...data]);
    (ws as any)["!cols"]=header.map((_,i)=>({wch:Math.min(Math.max(...[header[i].length,...data.map(row=>String(row[i]??"").length)])+2,40)}));
    const wb=XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb,ws,"Sheet1");
    saveAs(new Blob([XLSX.write(wb,{bookType:"xlsx",type:"array"})],{type:"application/octet-stream"}),`${safeFileName(selTable.name)}.xlsx`);
    toast.success("Excel downloaded");
  };

  // ── Column letter (A, B, C ...) ───────────────────────────────
  const colLetter = (i:number) => {
    let s=""; let n=i+1;
    while(n>0){s=String.fromCharCode(64+(n%26||26))+s; n=Math.floor((n-1)/26);}
    return s;
  };

  // ── Active cell display ───────────────────────────────────────
  const activeCellLabel = useMemo(()=>{
    if(!editCell) return "";
    const ci=columns.findIndex(c=>c.name===editCell.colName);
    const ri=rowsRef.current.findIndex(r=>r.id===editCell.rowId);
    return `${colLetter(ci)}${ri+1}`;
  },[editCell,columns]);

  return (
    <>
      <AlertDialog open={delOpen} onOpenChange={setDelOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete "{delTarget?.name}"?</AlertDialogTitle>
            <AlertDialogDescription>All data will be permanently deleted.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={async()=>{if(delTarget){await deleteTable(delTarget.id);setDelOpen(false);setDelTarget(null);}}}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Context Menu */}
      {ctx && (
        <div
          className="fixed z-50 bg-card border border-border rounded-lg shadow-xl py-1 min-w-[180px] text-sm"
          style={{top:ctx.y,left:ctx.x}}
          onClick={e=>e.stopPropagation()}
        >
          {ctx.rowId && <>
            <button className="w-full px-4 py-2 text-left hover:bg-muted flex items-center gap-2" onClick={()=>{addRow(ctx.rowId);setCtx(null);}}>
              <Plus className="w-3.5 h-3.5"/>Insert Row Below
            </button>
            <button className="w-full px-4 py-2 text-left hover:bg-muted text-destructive flex items-center gap-2" onClick={()=>{deleteRow(ctx.rowId!);setCtx(null);}}>
              <Trash2 className="w-3.5 h-3.5"/>Delete Row
            </button>
            <div className="border-t border-border my-1"/>
          </>}
          {ctx.colId && ctx.colName && <>
            <button className="w-full px-4 py-2 text-left hover:bg-muted flex items-center gap-2" onClick={()=>{addColumn(ctx.colId);setCtx(null);}}>
              <Plus className="w-3.5 h-3.5"/>Insert Column
            </button>
            <button className="w-full px-4 py-2 text-left hover:bg-muted text-destructive flex items-center gap-2" onClick={()=>{const col=columns.find(c=>c.id===ctx.colId);if(col)deleteColumn(col);setCtx(null);}}>
              <Trash2 className="w-3.5 h-3.5"/>Delete Column
            </button>
          </>}
          {!ctx.rowId && !ctx.colId && <>
            <button className="w-full px-4 py-2 text-left hover:bg-muted flex items-center gap-2" onClick={()=>{addRow();setCtx(null);}}>
              <Plus className="w-3.5 h-3.5"/>Add Row
            </button>
            <button className="w-full px-4 py-2 text-left hover:bg-muted flex items-center gap-2" onClick={()=>{addColumn();setCtx(null);}}>
              <Plus className="w-3.5 h-3.5"/>Add Column
            </button>
          </>}
        </div>
      )}

      <div className="flex flex-col h-[calc(100vh-4rem)] -m-4 md:-m-6 lg:-m-8 overflow-hidden">

        {/* ── Sheet Tab Bar ───────────────────────────────────── */}
        <div className="flex items-center gap-0 border-b border-border bg-muted/30 px-2 pt-2 overflow-x-auto shrink-0">
          {tables.map(t=>(
            <div key={t.id} className="relative group flex items-center">
              <button
                onClick={()=>setSelTable(t)}
                onContextMenu={e=>{e.preventDefault();}}
                className={`px-4 py-1.5 text-sm rounded-t-md border-t border-l border-r border-transparent transition-all whitespace-nowrap ${selTable?.id===t.id?"bg-background border-border text-foreground font-medium shadow-sm":"text-muted-foreground hover:text-foreground hover:bg-muted/60"}`}
              >
                {t.name}
              </button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button className={`p-0.5 rounded hover:bg-muted ml-0.5 opacity-0 group-hover:opacity-100 transition-opacity`}><MoreHorizontal className="w-3 h-3"/></button>
                </DropdownMenuTrigger>
                <DropdownMenuContent>
                  <DropdownMenuItem onClick={()=>renameTable(t)}><Edit3 className="w-4 h-4 mr-2"/>Rename</DropdownMenuItem>
                  <DropdownMenuSeparator/>
                  <DropdownMenuItem className="text-destructive" onClick={()=>{setDelTarget(t);setDelOpen(true);}}><Trash2 className="w-4 h-4 mr-2"/>Delete</DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          ))}
          {addingTable ? (
            <div className="flex items-center gap-1 px-2">
              <Input
                className="h-7 w-32 text-xs"
                placeholder="Sheet name..."
                value={newTableName}
                onChange={e=>setNewTableName(e.target.value)}
                autoFocus
                onKeyDown={e=>{if(e.key==="Enter")createTable();if(e.key==="Escape"){setAddingTable(false);setNewTableName("");}}}
              />
              <Button size="sm" className="h-7 px-2 text-xs" onClick={createTable}>Add</Button>
              <Button size="sm" variant="ghost" className="h-7 px-2" onClick={()=>{setAddingTable(false);setNewTableName("");}}>
                <X className="w-3 h-3"/>
              </Button>
            </div>
          ) : (
            <button onClick={()=>setAddingTable(true)} className="p-1.5 ml-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors" title="New sheet">
              <Plus className="w-4 h-4"/>
            </button>
          )}
        </div>

        {/* ── Excel Toolbar ───────────────────────────────────── */}
        <div className="flex items-center gap-1 px-3 py-1.5 border-b border-border bg-card shrink-0 flex-wrap">
          {/* Search */}
          <div className="relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground"/>
            <Input className="h-7 pl-7 w-40 text-xs" placeholder="Search..." value={search} onChange={e=>setSearch(e.target.value)}/>
          </div>

          <div className="w-px h-5 bg-border mx-1"/>

          {/* Add Row / Col */}
          <Button variant="ghost" size="sm" className="h-7 px-2 text-xs gap-1" onClick={()=>addRow()} disabled={!selTable||columns.length===0}>
            <Plus className="w-3.5 h-3.5"/>Row
          </Button>
          <Button variant="ghost" size="sm" className="h-7 px-2 text-xs gap-1" onClick={()=>addColumn()} disabled={!selTable}>
            <Plus className="w-3.5 h-3.5"/>Column
          </Button>

          <div className="w-px h-5 bg-border mx-1"/>

          {/* Sort */}
          {sortCol && (
            <Button variant="ghost" size="sm" className="h-7 px-2 text-xs gap-1" onClick={()=>{setSortCol(null);}}>
              <RefreshCw className="w-3 h-3"/>Clear Sort
            </Button>
          )}

          <div className="w-px h-5 bg-border mx-1"/>

          {/* EasyCount */}
          <Popover open={countOpen} onOpenChange={setCountOpen}>
            <PopoverTrigger asChild>
              <Button variant="ghost" size="sm" className="h-7 px-2 text-xs gap-1">
                <Calculator className="w-3.5 h-3.5"/>EasyCount
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-80" align="start">
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <h4 className="font-semibold text-sm">EasyCount</h4>
                  <Popover>
                    <PopoverTrigger asChild><button type="button"><HelpCircle className="w-3.5 h-3.5 text-muted-foreground"/></button></PopoverTrigger>
                    <PopoverContent className="w-64 text-xs">Count rows where columns contain your criteria.</PopoverContent>
                  </Popover>
                </div>
                {countConds.map((cond,i)=>(
                  <div key={i} className="flex gap-2">
                    <Select value={cond.col} onValueChange={v=>{const n=[...countConds];n[i].col=v;setCountConds(n);}}>
                      <SelectTrigger className="w-28 h-7 text-xs"><SelectValue placeholder="Column"/></SelectTrigger>
                      <SelectContent>{columns.map(c=><SelectItem key={c.id} value={c.name}>{c.name}</SelectItem>)}</SelectContent>
                    </Select>
                    <Input className="h-7 text-xs flex-1" placeholder="contains..." value={cond.crit} onChange={e=>{const n=[...countConds];n[i].crit=e.target.value;setCountConds(n);}}/>
                    {countConds.length>1&&<button onClick={()=>setCountConds(countConds.filter((_,j)=>j!==i))}><X className="w-3.5 h-3.5 text-muted-foreground"/></button>}
                  </div>
                ))}
                <Button variant="outline" size="sm" className="w-full h-7 text-xs" onClick={()=>setCountConds([...countConds,{col:"",crit:""}])}>
                  <Plus className="w-3 h-3 mr-1"/>Add Condition
                </Button>
                <Button size="sm" className="w-full h-7 text-xs" onClick={doCount}>Count Rows</Button>
                {countResult!==null&&(
                  <div className="p-2 rounded bg-primary/10 text-center">
                    <p className="text-xs text-muted-foreground">Matching rows</p>
                    <p className="text-2xl font-bold text-primary">{countResult}</p>
                  </div>
                )}
              </div>
            </PopoverContent>
          </Popover>

          <div className="w-px h-5 bg-border mx-1"/>

          {/* Downloads */}
          <Button variant="ghost" size="sm" className="h-7 px-2 text-xs gap-1" onClick={dlPDF} disabled={!hasAccess}>
            <Download className="w-3.5 h-3.5"/>PDF
          </Button>
          <Button variant="ghost" size="sm" className="h-7 px-2 text-xs gap-1" onClick={dlExcel} disabled={!hasAccess}>
            <FileSpreadsheet className="w-3.5 h-3.5"/>Excel
          </Button>
        </div>

        {/* ── Formula Bar ─────────────────────────────────────── */}
        <div className="flex items-center gap-2 px-3 py-1 border-b border-border bg-card shrink-0">
          <div className="flex items-center justify-center w-16 h-6 border border-border rounded text-xs font-mono text-muted-foreground bg-muted/30 shrink-0">
            {activeCellLabel||"—"}
          </div>
          <div className="w-px h-4 bg-border"/>
          <Input
            className="h-6 text-xs font-mono border-0 bg-transparent focus-visible:ring-0 focus-visible:ring-offset-0 p-0 flex-1"
            placeholder="Select a cell to edit..."
            value={formulaBar}
            onChange={e=>{setFormulaBar(e.target.value);setEditVal(e.target.value);}}
            onKeyDown={async e=>{
              if(!editCell) return;
              if(e.key==="Enter"){e.preventDefault();await moveCell(editCell.rowId,editCell.colName,formulaBar,"down");}
              if(e.key==="Escape"){setEditVal(origVal.current);setFormulaBar(origVal.current);setEditCell(null);}
            }}
          />
        </div>

        {/* ── Spreadsheet Grid ─────────────────────────────────── */}
        {!selTable ? (
          <div className="flex-1 flex items-center justify-center text-center p-8">
            <div>
              <Table2 className="w-16 h-16 mx-auto mb-4 text-muted-foreground/30"/>
              <h3 className="text-lg font-semibold mb-2">No sheets yet</h3>
              <p className="text-muted-foreground text-sm mb-4">Click the <span className="font-mono bg-muted px-1 rounded">+</span> button below to create your first sheet</p>
              <Button onClick={()=>setAddingTable(true)} className="gap-2"><Plus className="w-4 h-4"/>New Sheet</Button>
            </div>
          </div>
        ) : columns.length===0 ? (
          <div className="flex-1 flex items-center justify-center text-center p-8" onContextMenu={e=>openCtx(e)}>
            <div>
              <Table2 className="w-12 h-12 mx-auto mb-3 text-muted-foreground/30"/>
              <h3 className="font-semibold mb-1">Empty Sheet</h3>
              <p className="text-muted-foreground text-sm mb-3">Right-click to add a column, or use the toolbar above</p>
              <Button onClick={()=>addColumn()} className="gap-2"><Plus className="w-4 h-4"/>Add First Column</Button>
            </div>
          </div>
        ) : (
          <div className="flex-1 overflow-auto" onContextMenu={e=>openCtx(e)}>
            <table className="border-collapse text-sm min-w-full" style={{tableLayout:"fixed"}}>
              <colgroup>
                {/* Row number col */}
                <col style={{width:"48px"}}/>
                {columns.map((_,i)=><col key={i} style={{width:"140px"}}/>)}
                {/* Add col button */}
                <col style={{width:"36px"}}/>
              </colgroup>
              <thead className="sticky top-0 z-20">
                <tr>
                  {/* Corner cell */}
                  <th className="bg-muted/80 border border-border h-8 text-xs text-muted-foreground font-normal select-none"/>
                  {columns.map((col,ci)=>{
                    const type=(col.type as ColumnType)??"text";
                    return (
                      <th
                        key={col.id}
                        className="bg-muted/80 border border-border h-8 text-xs font-medium select-none relative group"
                        onContextMenu={e=>openCtx(e,undefined,col.id,col.name)}
                      >
                        {renamingColId===col.id ? (
                          <div className="flex items-center gap-1 px-1">
                            <Input
                              className="h-6 text-xs flex-1 min-w-0"
                              value={renamingColVal}
                              autoFocus
                              onChange={e=>setRenamingColVal(e.target.value)}
                              onBlur={()=>updateColumn(col,renamingColVal,renamingColType)}
                              onKeyDown={e=>{if(e.key==="Enter")updateColumn(col,renamingColVal,renamingColType);if(e.key==="Escape")setRenamingColId(null);}}
                            />
                            <Select value={renamingColType} onValueChange={v=>setRenamingColType(v as ColumnType)}>
                              <SelectTrigger className="h-6 w-8 p-0 border-0 bg-transparent text-xs [&>svg]:hidden">
                                <span className="flex items-center justify-center">{COL_TYPE_ICONS[renamingColType]}</span>
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="text"><span className="flex items-center gap-2"><Type className="w-3 h-3"/>Text</span></SelectItem>
                                <SelectItem value="number"><span className="flex items-center gap-2"><Hash className="w-3 h-3"/>Number</span></SelectItem>
                                <SelectItem value="currency"><span className="flex items-center gap-2"><DollarSign className="w-3 h-3"/>Currency</span></SelectItem>
                                <SelectItem value="date"><span className="flex items-center gap-2"><Calendar className="w-3 h-3"/>Date</span></SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                        ) : (
                          <div className="flex items-center justify-between px-2 h-full">
                            <div className="flex items-center gap-1.5 overflow-hidden">
                              <span className="text-muted-foreground/50">{COL_TYPE_ICONS[type]}</span>
                              <span className="truncate">{col.name}</span>
                            </div>
                            <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100">
                              <button className="p-0.5 rounded hover:bg-muted" onClick={()=>{setSortCol(col.name);setSortDir(sortCol===col.name&&sortDir==="asc"?"desc":"asc");}}>
                                {sortCol===col.name?(sortDir==="asc"?<SortAsc className="w-3 h-3"/>:<SortDesc className="w-3 h-3"/>):<ChevronDown className="w-3 h-3 text-muted-foreground/50"/>}
                              </button>
                              <button className="p-0.5 rounded hover:bg-muted" onDoubleClick={()=>{setRenamingColId(col.id);setRenamingColVal(col.name);setRenamingColType(type);}}>
                                <Edit3 className="w-3 h-3 text-muted-foreground/50"/>
                              </button>
                            </div>
                          </div>
                        )}
                      </th>
                    );
                  })}
                  {/* + col button */}
                  <th className="bg-muted/80 border border-border h-8">
                    <button className="w-full h-full flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted transition-colors" onClick={()=>addColumn()} title="Add column">
                      <Plus className="w-3.5 h-3.5"/>
                    </button>
                  </th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((r,ri)=>{
                  const rd=(r.row_data??{}) as Record<string,any>;
                  return (
                    <tr key={r.id} className="group">
                      {/* Row number */}
                      <td
                        className="bg-muted/40 border border-border text-center text-xs text-muted-foreground select-none h-8 cursor-context-menu font-mono hover:bg-muted/70"
                        onContextMenu={e=>openCtx(e,r.id)}
                      >
                        {ri+1}
                      </td>
                      {columns.map(col=>{
                        const type=(col.type as ColumnType)??"text";
                        const isEd=editCell?.rowId===r.id&&editCell?.colName===col.name;
                        const isActive=editCell?.rowId===r.id||editCell?.colName===col.name;
                        return (
                          <td
                            key={col.id}
                            className={`border border-border h-8 p-0 relative overflow-hidden
                              ${isEd?"ring-2 ring-inset ring-primary z-10":""}
                              ${isActive&&!isEd?"bg-primary/5":""}
                              ${!isEd?"hover:bg-muted/30 cursor-cell":""}
                            `}
                            onContextMenu={e=>openCtx(e,r.id,col.id,col.name)}
                            onClick={()=>{ if(!isEd) startEditAndFocus(r.id,col.name); }}
                          >
                            {isEd ? (
                              <Input
                                ref={el=>{cellRefs.current[cellKey(r.id,col.name)]=el;}}
                                type={type==="date"?"date":"text"}
                                inputMode={type==="number"||type==="currency"?"decimal":undefined}
                                value={type==="date"?(editVal?(parseDateInput(editVal)||editVal):""):editVal}
                                onChange={e=>{setEditVal(e.target.value);setFormulaBar(e.target.value);}}
                                onBlur={async()=>{
                                  await saveCellNow(r.id,col.name,editValRef.current);
                                  setEditCell(null);setEditVal("");setFormulaBar("");
                                }}
                                enterKeyHint="next"
                                onKeyDown={async e=>{
                                  if(e.key==="Enter"){e.preventDefault();await moveCell(r.id,col.name,editVal,"down");return;}
                                  if(e.key==="Tab"){e.preventDefault();await moveCell(r.id,col.name,editVal,e.shiftKey?"left":"right");return;}
                                  if(e.key==="ArrowDown"){e.preventDefault();await moveCell(r.id,col.name,editVal,"down");return;}
                                  if(e.key==="ArrowUp"){e.preventDefault();await moveCell(r.id,col.name,editVal,"up");return;}
                                  if(e.key==="Escape"){e.preventDefault();setEditVal(origVal.current);setFormulaBar(origVal.current);setEditCell(null);return;}
                                }}
                                className="absolute inset-0 h-full w-full border-0 rounded-none bg-background text-xs px-2 focus-visible:ring-0 focus-visible:ring-offset-0"
                                autoFocus
                              />
                            ) : (
                              <div className={`px-2 h-full flex items-center text-xs overflow-hidden whitespace-nowrap ${type==="currency"?"text-primary font-medium":""} ${type==="number"?"text-right justify-end":""}`}>
                                {displayVal(rd[col.name],type)||<span className="text-transparent select-none">·</span>}
                              </div>
                            )}
                          </td>
                        );
                      })}
                      <td className="border border-border bg-transparent"/>
                    </tr>
                  );
                })}

                {/* ── Totals row ─────────────────────────────── */}
                {rows.length>0&&Object.keys(totals).length>0&&(
                  <tr>
                    <td className="bg-muted/60 border border-border text-center text-xs text-muted-foreground font-mono h-8">Σ</td>
                    {columns.map((col,i)=>{
                      const type=(col.type as ColumnType)??"text";
                      const total=totals[col.name];
                      return (
                        <td key={col.id} className="bg-muted/40 border border-border px-2 h-8 text-xs font-semibold">
                          {total!=null?(
                            <span className={`${type==="currency"?"text-primary":""} ${type==="number"?"block text-right":""}`}>
                              {type==="currency"?`₹${total.toLocaleString("en-IN")}`:total.toLocaleString("en-IN")}
                            </span>
                          ):(i===0?<span className="text-muted-foreground">Total</span>:"")}
                        </td>
                      );
                    })}
                    <td className="border border-border bg-muted/40"/>
                  </tr>
                )}

                {/* ── Add Row ───────────────────────────────── */}
                <tr>
                  <td colSpan={columns.length+2} className="border-t border-border">
                    <button
                      className="w-full h-8 text-xs text-muted-foreground hover:text-foreground hover:bg-muted/30 transition-colors flex items-center justify-center gap-1"
                      onClick={()=>addRow()}
                    >
                      <Plus className="w-3.5 h-3.5"/>Add Row
                    </button>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        )}

        {/* ── Status Bar ──────────────────────────────────────── */}
        <div className="flex items-center justify-between px-4 py-1 border-t border-border bg-muted/30 text-xs text-muted-foreground shrink-0">
          <span>{filtered.length} row{filtered.length!==1?"s":""} · {columns.length} column{columns.length!==1?"s":""}</span>
          {editCell&&<span className="font-mono">{activeCellLabel}</span>}
          <span>{selTable?.name??""}</span>
        </div>
      </div>
    </>
  );
}
