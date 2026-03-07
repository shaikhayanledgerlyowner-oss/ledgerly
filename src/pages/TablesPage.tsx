import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Plus, Table2, Trash2, Edit3, Search, SortAsc, SortDesc,
  MoreHorizontal, X, Calculator, HelpCircle, Download,
  FileSpreadsheet, Hash, Calendar, DollarSign, ChevronDown, Type, RefreshCw
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
interface DbTable  { id: string; user_id: string; name: string; created_at: string; }
interface DbColumn { id: string; table_id: string; name: string; type: string; created_at: string; }
interface DbRow    { id: string; table_id: string; row_data: Record<string,any>; created_at: string; }

// ─── helpers ────────────────────────────────────────────────────────────────
function toNum(v:any):number {
  if(v==null||v==="") return 0;
  if(typeof v==="number") return isFinite(v)?v:0;
  const n=Number(String(v).replace(/,/g,""));
  return isFinite(n)?n:0;
}
function safeFileName(n:string){ return String(n||"table").replace(/[\/\\:*?"<>|]/g,"-").trim()||"table"; }

// Always store dates as ISO YYYY-MM-DD internally
function toISODate(val:string):string {
  if(!val) return "";
  // YYYY-MM-DD  (native date input output)
  if(/^\d{4}-\d{2}-\d{2}$/.test(val)) return val;
  // DD/MM/YYYY or DD-MM-YYYY
  const m=val.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if(m){ const dt=new Date(+m[3],+m[2]-1,+m[1]); if(!isNaN(dt.getTime())) return dt.toISOString().slice(0,10); }
  return "";
}
// Display as DD/MM/YYYY
function toDMY(iso:string):string {
  if(!iso) return "";
  const d=new Date(iso+"T00:00:00");
  if(isNaN(d.getTime())) return iso;
  return `${String(d.getDate()).padStart(2,"0")}/${String(d.getMonth()+1).padStart(2,"0")}/${d.getFullYear()}`;
}
function displayCell(v:any, type:ColumnType):string {
  if(v==null||v==="") return "";
  if(type==="currency") return `₹${toNum(v).toLocaleString("en-IN")}`;
  if(type==="number")   return toNum(v).toLocaleString("en-IN");
  if(type==="date")     return toDMY(String(v));
  return String(v);
}

// Fill series logic
function fillValue(anchor:any, type:ColumnType, step:number, ctrlKey:boolean):any {
  if(ctrlKey) return anchor; // Ctrl = copy
  if(type==="number"||type==="currency") return toNum(anchor)+step;
  if(type==="date"&&anchor){
    const d=new Date(String(anchor)+"T00:00:00");
    if(!isNaN(d.getTime())){ d.setDate(d.getDate()+step); return d.toISOString().slice(0,10); }
  }
  return anchor; // text = copy always
}

const TYPE_ICONS:Record<string,React.ReactNode>={
  text:<Type className="w-3 h-3"/>,
  number:<Hash className="w-3 h-3"/>,
  currency:<DollarSign className="w-3 h-3"/>,
  date:<Calendar className="w-3 h-3"/>,
};
function colLetter(i:number):string {
  let s="",n=i+1;
  while(n>0){s=String.fromCharCode(64+(n%26||26))+s;n=Math.floor((n-1)/26);}
  return s;
}

interface CtxMenu{x:number;y:number;rowId?:string;colId?:string;colName?:string;}

// ─── Component ───────────────────────────────────────────────────────────────
export default function TablesPage(){
  const {profile,hasAccess}=useAuth();
  const uid=profile?.id;

  const [tables,setTables]=useState<DbTable[]>([]);
  const [selTable,setSelTable]=useState<DbTable|null>(null);
  const [columns,setColumns]=useState<DbColumn[]>([]);
  const [rows,setRows]=useState<DbRow[]>([]);

  const [search,setSearch]=useState("");
  const [sortCol,setSortCol]=useState<string|null>(null);
  const [sortDir,setSortDir]=useState<"asc"|"desc">("asc");

  // ── editing state ──
  // editCell stores {rowId, colName, rawValue}
  // rawValue for dates is ISO string (YYYY-MM-DD) — never DMY in state
  const [editCell,setEditCell]=useState<{rowId:string;colName:string}|null>(null);
  const [editVal,setEditVal]=useState(""); // for date cols: ISO string
  const origValRef=useRef("");
  const editValRef=useRef("");
  const savingRef=useRef(false);
  const cellRefs=useRef<Record<string,HTMLInputElement|null>>({});
  const colsRef=useRef<DbColumn[]>([]);
  const rowsRef=useRef<DbRow[]>([]);

  // formula bar shows DMY for dates, raw for others
  const [formulaBarVal,setFormulaBarVal]=useState("");

  // ── drag fill ──
  const [dragAnchor,setDragAnchor]=useState<{rowId:string;colName:string}|null>(null);
  const [dragEnd,setDragEnd]=useState<{rowId:string;colName:string}|null>(null);
  const isDragging=useRef(false);
  const dragCtrlRef=useRef(false);

  // ── rename col inline ──
  const [renamingColId,setRenamingColId]=useState<string|null>(null);
  const [renamingColVal,setRenamingColVal]=useState("");
  const [renamingColType,setRenamingColType]=useState<ColumnType>("text");

  // ── delete confirm ──
  const [delTarget,setDelTarget]=useState<DbTable|null>(null);
  const [delOpen,setDelOpen]=useState(false);

  // ── easycount ──
  const [countOpen,setCountOpen]=useState(false);
  const [countConds,setCountConds]=useState<{col:string;crit:string}[]>([{col:"",crit:""}]);
  const [countResult,setCountResult]=useState<number|null>(null);

  // ── new table ──
  const [newTableName,setNewTableName]=useState("");
  const [addingTable,setAddingTable]=useState(false);

  useEffect(()=>{editValRef.current=editVal;},[editVal]);
  useEffect(()=>{colsRef.current=columns;},[columns]);

  const cellKey=(r:string,c:string)=>`${r}__${c}`;
  const focusCell=(rowId:string,colName:string)=>{
    setTimeout(()=>{
      const el=cellRefs.current[cellKey(rowId,colName)];
      if(el){el.focus();el.select?.();}
    },30);
  };

  // ── load ────────────────────────────────────────────────────────────────────
  const loadTables=async()=>{
    if(!uid) return;
    const {data}=await supabase.from("user_tables").select("*").eq("user_id",uid).order("created_at",{ascending:true});
    const list=(data??[]) as DbTable[];
    setTables(list);
    setSelTable(prev=>{
      if(prev){const found=list.find(t=>t.id===prev.id);return found??list[0]??null;}
      return list[0]??null;
    });
  };
  const loadData=async(tid:string)=>{
    const [cr,rr]=await Promise.all([
      supabase.from("user_columns").select("*").eq("table_id",tid).order("created_at",{ascending:true}),
      supabase.from("user_rows").select("*").eq("table_id",tid).order("created_at",{ascending:true}),
    ]);
    setColumns((cr.data??[]) as DbColumn[]);
    setRows(((rr.data??[]) as any[]).map(r=>({...r,row_data:r.row_data??{}})));
  };
  useEffect(()=>{loadTables();},[uid]);
  useEffect(()=>{if(selTable)loadData(selTable.id);else{setColumns([]);setRows([]);}},[selTable?.id]);

  // ── table CRUD ──────────────────────────────────────────────────────────────
  const createTable=async()=>{
    if(!uid||!newTableName.trim()) return;
    const {data,error}=await supabase.from("user_tables").insert({user_id:uid,name:newTableName.trim()}).select("*").single();
    if(error) return toast.error(error.message);
    setNewTableName("");setAddingTable(false);
    await loadTables();setSelTable(data as DbTable);
    toast.success("Sheet created");
  };
  const deleteTable=async(tid:string)=>{
    await supabase.from("user_rows").delete().eq("table_id",tid);
    await supabase.from("user_columns").delete().eq("table_id",tid);
    await supabase.from("user_tables").delete().eq("id",tid);
    toast.success("Deleted");await loadTables();
  };
  const renameTable=async(t:DbTable)=>{
    const n=prompt("Rename:",t.name);
    if(!n?.trim()) return;
    await supabase.from("user_tables").update({name:n.trim()}).eq("id",t.id);
    await loadTables();
  };

  // ── column CRUD ─────────────────────────────────────────────────────────────
  const addColumn=async()=>{
    if(!selTable) return;
    const name=`Column ${columns.length+1}`;
    await supabase.from("user_columns").insert({table_id:selTable.id,name,type:"text"});
    if(rows.length>0){
      await Promise.all(rows.map(r=>{
        const rd={...r.row_data};
        return supabase.from("user_rows").update({row_data:{...rd,[name]:""}}).eq("id",r.id);
      }));
    }
    await loadData(selTable.id);
    setTimeout(()=>{
      const nc=colsRef.current[colsRef.current.length-1];
      if(nc){setRenamingColId(nc.id);setRenamingColVal(nc.name);setRenamingColType("text");}
    },80);
  };
  const deleteColumn=async(col:DbColumn)=>{
    if(!selTable) return;
    await supabase.from("user_columns").delete().eq("id",col.id);
    if(rows.length>0){
      await Promise.all(rows.map(r=>{
        const rd={...r.row_data};delete rd[col.name];
        return supabase.from("user_rows").update({row_data:rd}).eq("id",r.id);
      }));
    }
    await loadData(selTable.id);
  };
  const updateColumn=async(col:DbColumn,newName:string,newType:ColumnType)=>{
    if(!newName.trim()) return;
    const old=col.name;
    await supabase.from("user_columns").update({name:newName.trim(),type:newType}).eq("id",col.id);
    if(rows.length>0&&old!==newName.trim()){
      await Promise.all(rows.map(r=>{
        const rd={...r.row_data};rd[newName.trim()]=rd[old];delete rd[old];
        return supabase.from("user_rows").update({row_data:rd}).eq("id",r.id);
      }));
    }
    setRenamingColId(null);
    if(selTable) await loadData(selTable.id);
  };

  // ── row CRUD ─────────────────────────────────────────────────────────────────
  const addRow=async()=>{
    if(!selTable||columns.length===0) return;
    const empty:Record<string,any>={};
    columns.forEach(c=>(empty[c.name]=""));
    const {data,error}=await supabase.from("user_rows").insert({table_id:selTable.id,row_data:empty}).select("*").single();
    if(error) return toast.error(error.message);
    await loadData(selTable.id);
    setTimeout(()=>{
      const nr=rowsRef.current[rowsRef.current.length-1];
      if(nr&&colsRef.current[0]) startEditAndFocus(nr.id,colsRef.current[0].name);
    },80);
  };
  const deleteRow=async(rowId:string)=>{
    await supabase.from("user_rows").delete().eq("id",rowId);
    setRows(prev=>prev.filter(r=>r.id!==rowId));
  };

  // ── cell editing ─────────────────────────────────────────────────────────────
  const startEdit=(rowId:string,colName:string)=>{
    const col=colsRef.current.find(c=>c.name===colName);
    const type=(col?.type as ColumnType)??"text";
    const row=rowsRef.current.find(r=>r.id===rowId);
    const raw=(row?.row_data??{})[colName];
    // ✅ For dates: always store ISO in state, display separately
    let stateVal= raw==null?"":String(raw);
    // formula bar display
    let fbarVal= type==="date"?toDMY(stateVal):stateVal;
    origValRef.current=stateVal;
    setEditCell({rowId,colName});
    setEditVal(stateVal);
    setFormulaBarVal(fbarVal);
  };
  const startEditAndFocus=(rowId:string,colName:string)=>{
    startEdit(rowId,colName);focusCell(rowId,colName);
  };

  const saveCellNow=async(rowId:string,colName:string,val:string)=>{
    if(savingRef.current) return;
    savingRef.current=true;
    const col=colsRef.current.find(c=>c.name===colName);
    const type=(col?.type as ColumnType)??"text";
    let value:any=val;
    if(type==="number"||type==="currency") value=val===""?"":toNum(val);
    else if(type==="date") value=val; // already ISO from input
    setRows(prev=>prev.map(r=>{
      if(r.id!==rowId) return r;
      return {...r,row_data:{...r.row_data,[colName]:value}};
    }));
    const row=rowsRef.current.find(r=>r.id===rowId);
    const rd={...(row?.row_data??{})};
    await supabase.from("user_rows").update({row_data:{...rd,[colName]:value}}).eq("id",rowId);
    savingRef.current=false;
  };

  // ── filtered rows ────────────────────────────────────────────────────────────
  const filtered=useMemo(()=>{
    let list=[...rows];
    if(search.trim()){
      const q=search.toLowerCase();
      list=list.filter(r=>Object.values(r.row_data).some(v=>String(v??"").toLowerCase().includes(q)));
    }
    if(sortCol){
      const col=columns.find(c=>c.name===sortCol);
      const type=(col?.type as ColumnType)??"text";
      list.sort((a,b)=>{
        const av=a.row_data[sortCol]??"",bv=b.row_data[sortCol]??"";
        if(type==="number"||type==="currency"){const na=toNum(av),nb=toNum(bv);return sortDir==="asc"?na-nb:nb-na;}
        if(type==="date") return sortDir==="asc"?String(av).localeCompare(String(bv)):String(bv).localeCompare(String(av));
        return sortDir==="asc"?String(av).localeCompare(String(bv)):String(bv).localeCompare(String(av));
      });
    }
    return list;
  },[rows,search,sortCol,sortDir,columns]);
  useEffect(()=>{rowsRef.current=filtered;},[filtered]);

  // ── move cell ────────────────────────────────────────────────────────────────
  const moveCell=async(rowId:string,colName:string,val:string,dir:"right"|"left"|"down"|"up")=>{
    await saveCellNow(rowId,colName,val);
    setEditCell(null);setEditVal("");setFormulaBarVal("");
    const cols=colsRef.current,list=rowsRef.current;
    const ri=list.findIndex(r=>r.id===rowId),ci=cols.findIndex(c=>c.name===colName);
    let nr=ri,nc=ci;
    if(dir==="right") nc=Math.min(ci+1,cols.length-1);
    else if(dir==="left") nc=Math.max(ci-1,0);
    else if(dir==="down"){ nr=ri+1; if(nr>=list.length){addRow();return;} }
    else if(dir==="up") nr=Math.max(ri-1,0);
    const nextRow=list[nr],nextCol=cols[nc];
    if(nextRow&&nextCol) startEditAndFocus(nextRow.id,nextCol.name);
  };

  // ── totals ────────────────────────────────────────────────────────────────────
  const totals=useMemo(()=>{
    const t:Record<string,number>={};
    columns.forEach(c=>{
      if(c.type==="number"||c.type==="currency")
        t[c.name]=rows.reduce((s,r)=>s+toNum(r.row_data[c.name]),0);
    });
    return t;
  },[columns,rows]);

  // ── drag fill ────────────────────────────────────────────────────────────────
  const dragFillSelected=useMemo(()=>{
    if(!dragAnchor||!dragEnd) return new Set<string>();
    const list=rowsRef.current;
    const ai=list.findIndex(r=>r.id===dragAnchor.rowId);
    const ei=list.findIndex(r=>r.id===dragEnd.rowId);
    if(ai<0||ei<0||dragAnchor.colName!==dragEnd.colName) return new Set<string>();
    const from=Math.min(ai,ei),to=Math.max(ai,ei);
    const s=new Set<string>();
    for(let i=from;i<=to;i++) s.add(list[i]?.id??"");
    return s;
  },[dragAnchor,dragEnd,filtered]);

  const applyDragFill=async()=>{
    if(!dragAnchor||!dragEnd) return;
    const list=rowsRef.current;
    const ai=list.findIndex(r=>r.id===dragAnchor.rowId);
    const ei=list.findIndex(r=>r.id===dragEnd.rowId);
    if(ai<0||ei<0||dragAnchor.colName!==dragEnd.colName) return;
    const col=colsRef.current.find(c=>c.name===dragAnchor.colName);
    const type=(col?.type as ColumnType)??"text";
    const anchorRow=list[ai];
    const anchorVal=(anchorRow?.row_data??{})[dragAnchor.colName];
    const from=Math.min(ai,ei),to=Math.max(ai,ei);
    const ctrl=dragCtrlRef.current;
    for(let i=from;i<=to;i++){
      if(i===ai) continue; // skip anchor itself
      const targetRow=list[i];if(!targetRow) continue;
      const step=i-ai;
      const newVal=fillValue(anchorVal,type,step,ctrl);
      const rd={...targetRow.row_data};
      setRows(prev=>prev.map(r=>r.id!==targetRow.id?r:{...r,row_data:{...r.row_data,[dragAnchor.colName]:newVal}}));
      await supabase.from("user_rows").update({row_data:{...rd,[dragAnchor.colName]:newVal}}).eq("id",targetRow.id);
    }
    toast.success(ctrl?"Copied!":"Filled!");
    setDragAnchor(null);setDragEnd(null);
  };

  // global mouseup for drag
  useEffect(()=>{
    const up=async(e:MouseEvent)=>{
      if(!isDragging.current) return;
      isDragging.current=false;
      await applyDragFill();
    };
    window.addEventListener("mouseup",up);
    return ()=>window.removeEventListener("mouseup",up);
  },[dragAnchor,dragEnd]);

  // ── context menu ─────────────────────────────────────────────────────────────
  const [ctx,setCtx]=useState<CtxMenu|null>(null);
  const openCtx=(e:React.MouseEvent,rowId?:string,colId?:string,colName?:string)=>{
    e.preventDefault();e.stopPropagation();
    setCtx({x:e.clientX,y:e.clientY,rowId,colId,colName});
  };
  useEffect(()=>{
    const close=()=>setCtx(null);
    window.addEventListener("click",close);
    return ()=>window.removeEventListener("click",close);
  },[]);

  // ── easycount ────────────────────────────────────────────────────────────────
  const doCount=()=>{
    const active=countConds.filter(c=>c.col&&c.crit);
    if(!active.length) return toast.error("Add at least 1 condition");
    const n=rows.filter(r=>active.every(cond=>String(r.row_data[cond.col]??"").toLowerCase().includes(cond.crit.toLowerCase()))).length;
    setCountResult(n);toast.success(`Found ${n} rows`);
  };

  // ── downloads ────────────────────────────────────────────────────────────────
  const dlPDF=()=>{
    if(!hasAccess) return toast.error("Upgrade to download");
    if(!selTable||!columns.length) return;
    const doc=new jsPDF({orientation:"l",unit:"pt",format:"a4"});
    doc.setFont("helvetica","bold");doc.setFontSize(16);
    doc.text(selTable.name,40,45);
    doc.setFont("helvetica","normal");doc.setFontSize(10);
    doc.text(`Exported: ${new Date().toLocaleString()}`,40,62);
    const head=[columns.map(c=>c.name)];
    const body=filtered.map(r=>columns.map(c=>{
      const v=r.row_data[c.name];const type=c.type as ColumnType;
      if(type==="currency") return `Rs. ${toNum(v).toLocaleString("en-IN",{minimumFractionDigits:2,maximumFractionDigits:2})}`;
      if(type==="number") return toNum(v).toLocaleString("en-IN");
      if(type==="date") return toDMY(String(v??""));
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
    doc.save(`${safeFileName(selTable.name)}.pdf`);toast.success("PDF downloaded");
  };
  const dlExcel=()=>{
    if(!hasAccess) return toast.error("Upgrade to download");
    if(!selTable||!columns.length) return;
    const header=columns.map(c=>c.name);
    const data=filtered.map(r=>columns.map(c=>{
      const v=r.row_data[c.name];const type=c.type as ColumnType;
      if(type==="number"||type==="currency") return v===""||v==null?"":toNum(v);
      if(type==="date") return toDMY(String(v??""));
      return v==null?"":String(v);
    }));
    if(Object.keys(totals).length) data.push(columns.map((c,i)=>{const t=totals[c.name];return t!=null?t:i===0?"Total":""}) as any);
    const ws=XLSX.utils.aoa_to_sheet([header,...data]);
    (ws as any)["!cols"]=header.map((_,i)=>({wch:Math.min(Math.max(...[header[i].length,...data.map(row=>String(row[i]??"").length)])+2,40)}));
    const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,ws,"Sheet1");
    saveAs(new Blob([XLSX.write(wb,{bookType:"xlsx",type:"array"})],{type:"application/octet-stream"}),`${safeFileName(selTable.name)}.xlsx`);
    toast.success("Excel downloaded");
  };

  const activeCellLabel=useMemo(()=>{
    if(!editCell) return "";
    const ci=columns.findIndex(c=>c.name===editCell.colName);
    const ri=rowsRef.current.findIndex(r=>r.id===editCell.rowId);
    return `${colLetter(ci)}${ri+1}`;
  },[editCell,columns]);

  // ─── RENDER ──────────────────────────────────────────────────────────────────
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
      {ctx&&(
        <div className="fixed z-50 bg-card border border-border rounded-lg shadow-xl py-1 min-w-[180px] text-sm" style={{top:ctx.y,left:ctx.x}} onClick={e=>e.stopPropagation()}>
          {ctx.rowId&&<>
            <button className="w-full px-4 py-2 text-left hover:bg-muted flex items-center gap-2" onClick={()=>{addRow();setCtx(null);}}><Plus className="w-3.5 h-3.5"/>Insert Row Below</button>
            <button className="w-full px-4 py-2 text-left hover:bg-muted text-destructive flex items-center gap-2" onClick={()=>{deleteRow(ctx.rowId!);setCtx(null);}}><Trash2 className="w-3.5 h-3.5"/>Delete Row</button>
            <div className="border-t border-border my-1"/>
          </>}
          {ctx.colId&&ctx.colName&&<>
            <button className="w-full px-4 py-2 text-left hover:bg-muted flex items-center gap-2" onClick={()=>{addColumn();setCtx(null);}}><Plus className="w-3.5 h-3.5"/>Insert Column</button>
            <button className="w-full px-4 py-2 text-left hover:bg-muted text-destructive flex items-center gap-2" onClick={()=>{const col=columns.find(c=>c.id===ctx.colId);if(col)deleteColumn(col);setCtx(null);}}><Trash2 className="w-3.5 h-3.5"/>Delete Column</button>
          </>}
          {!ctx.rowId&&!ctx.colId&&<>
            <button className="w-full px-4 py-2 text-left hover:bg-muted flex items-center gap-2" onClick={()=>{addRow();setCtx(null);}}><Plus className="w-3.5 h-3.5"/>Add Row</button>
            <button className="w-full px-4 py-2 text-left hover:bg-muted flex items-center gap-2" onClick={()=>{addColumn();setCtx(null);}}><Plus className="w-3.5 h-3.5"/>Add Column</button>
          </>}
        </div>
      )}

      <div className="flex flex-col h-[calc(100vh-4rem)] -m-4 md:-m-6 lg:-m-8 overflow-hidden">

        {/* ── Toolbar ─────────────────────────────────────────────────────── */}
        <div className="flex items-center gap-1 px-3 py-1.5 border-b border-border bg-card shrink-0 flex-wrap">
          <div className="relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground"/>
            <Input className="h-7 pl-7 w-36 text-xs" placeholder="Search..." value={search} onChange={e=>setSearch(e.target.value)}/>
          </div>
          <div className="w-px h-5 bg-border mx-1"/>
          <Button variant="ghost" size="sm" className="h-7 px-2 text-xs gap-1" onClick={addRow} disabled={!selTable||columns.length===0}><Plus className="w-3.5 h-3.5"/>Row</Button>
          <Button variant="ghost" size="sm" className="h-7 px-2 text-xs gap-1" onClick={addColumn} disabled={!selTable}><Plus className="w-3.5 h-3.5"/>Column</Button>
          {sortCol&&<Button variant="ghost" size="sm" className="h-7 px-2 text-xs gap-1" onClick={()=>setSortCol(null)}><RefreshCw className="w-3 h-3"/>Clear Sort</Button>}
          <div className="w-px h-5 bg-border mx-1"/>
          <Popover open={countOpen} onOpenChange={setCountOpen}>
            <PopoverTrigger asChild>
              <Button variant="ghost" size="sm" className="h-7 px-2 text-xs gap-1"><Calculator className="w-3.5 h-3.5"/>EasyCount</Button>
            </PopoverTrigger>
            <PopoverContent className="w-80" align="start">
              <div className="space-y-3">
                <div className="flex items-center gap-2"><h4 className="font-semibold text-sm">EasyCount</h4></div>
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
                <Button variant="outline" size="sm" className="w-full h-7 text-xs" onClick={()=>setCountConds([...countConds,{col:"",crit:""}])}><Plus className="w-3 h-3 mr-1"/>Add Condition</Button>
                <Button size="sm" className="w-full h-7 text-xs" onClick={doCount}>Count Rows</Button>
                {countResult!==null&&<div className="p-2 rounded bg-primary/10 text-center"><p className="text-xs text-muted-foreground">Matching rows</p><p className="text-2xl font-bold text-primary">{countResult}</p></div>}
              </div>
            </PopoverContent>
          </Popover>
          <div className="w-px h-5 bg-border mx-1"/>
          <Button variant="ghost" size="sm" className="h-7 px-2 text-xs gap-1" onClick={dlPDF} disabled={!hasAccess}><Download className="w-3.5 h-3.5"/>PDF</Button>
          <Button variant="ghost" size="sm" className="h-7 px-2 text-xs gap-1" onClick={dlExcel} disabled={!hasAccess}><FileSpreadsheet className="w-3.5 h-3.5"/>Excel</Button>
        </div>

        {/* ── Formula Bar ─────────────────────────────────────────────────── */}
        <div className="flex items-center gap-2 px-3 py-1 border-b border-border bg-card shrink-0">
          <div className="flex items-center justify-center w-14 h-6 border border-border rounded text-xs font-mono text-muted-foreground bg-muted/30 shrink-0">{activeCellLabel||"—"}</div>
          <div className="w-px h-4 bg-border"/>
          <Input
            className="h-6 text-xs font-mono border-0 bg-transparent focus-visible:ring-0 focus-visible:ring-offset-0 p-0 flex-1"
            placeholder="Select a cell..."
            value={formulaBarVal}
            onChange={e=>{
              setFormulaBarVal(e.target.value);
              if(editCell){
                const col=colsRef.current.find(c=>c.name===editCell.colName);
                const type=(col?.type as ColumnType)??"text";
                if(type==="date"){
                  // user types DD/MM/YYYY in formula bar → convert to ISO for input
                  const iso=toISODate(e.target.value);
                  setEditVal(iso||e.target.value);
                } else setEditVal(e.target.value);
              }
            }}
            onKeyDown={async e=>{
              if(!editCell) return;
              if(e.key==="Enter"){e.preventDefault();await moveCell(editCell.rowId,editCell.colName,editValRef.current,"down");}
              if(e.key==="Escape"){setEditVal(origValRef.current);setFormulaBarVal(origValRef.current);setEditCell(null);}
            }}
          />
        </div>

        {/* ── Sheet Tab Bar ────────────────────────────────────────────────── */}
        <div className="flex items-center gap-0 border-b border-border bg-muted/30 px-2 pt-1.5 overflow-x-auto shrink-0">
          {tables.map(t=>(
            <div key={t.id} className="relative group flex items-center shrink-0">
              <button
                onClick={()=>setSelTable(t)}
                className={`px-4 py-1.5 text-sm rounded-t-md border border-b-0 transition-all whitespace-nowrap ${selTable?.id===t.id?"bg-background border-border text-foreground font-medium":"border-transparent text-muted-foreground hover:text-foreground hover:bg-muted/60"}`}
              >{t.name}</button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button className="p-0.5 rounded opacity-0 group-hover:opacity-100 ml-0.5"><MoreHorizontal className="w-3 h-3"/></button>
                </DropdownMenuTrigger>
                <DropdownMenuContent>
                  <DropdownMenuItem onClick={()=>renameTable(t)}><Edit3 className="w-4 h-4 mr-2"/>Rename</DropdownMenuItem>
                  <DropdownMenuSeparator/>
                  <DropdownMenuItem className="text-destructive" onClick={()=>{setDelTarget(t);setDelOpen(true);}}><Trash2 className="w-4 h-4 mr-2"/>Delete</DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          ))}
          {addingTable?(
            <div className="flex items-center gap-1 px-2">
              <Input className="h-7 w-28 text-xs" placeholder="Sheet name..." value={newTableName} onChange={e=>setNewTableName(e.target.value)} autoFocus onKeyDown={e=>{if(e.key==="Enter")createTable();if(e.key==="Escape"){setAddingTable(false);setNewTableName("");}}}/>
              <Button size="sm" className="h-7 px-2 text-xs" onClick={createTable}>Add</Button>
              <Button size="sm" variant="ghost" className="h-7 px-2" onClick={()=>{setAddingTable(false);setNewTableName("");}}><X className="w-3 h-3"/></Button>
            </div>
          ):(
            <button onClick={()=>setAddingTable(true)} className="p-1.5 ml-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground" title="New sheet"><Plus className="w-4 h-4"/></button>
          )}
        </div>

        {/* ── Grid ────────────────────────────────────────────────────────── */}
        {!selTable?(
          <div className="flex-1 flex items-center justify-center p-8 text-center">
            <div><Table2 className="w-16 h-16 mx-auto mb-4 text-muted-foreground/30"/><h3 className="text-lg font-semibold mb-2">No sheets yet</h3><Button onClick={()=>setAddingTable(true)} className="gap-2 mt-2"><Plus className="w-4 h-4"/>New Sheet</Button></div>
          </div>
        ):columns.length===0?(
          <div className="flex-1 flex items-center justify-center p-8 text-center" onContextMenu={e=>openCtx(e)}>
            <div><Table2 className="w-12 h-12 mx-auto mb-3 text-muted-foreground/30"/><h3 className="font-semibold mb-1">Empty Sheet</h3><p className="text-muted-foreground text-sm mb-3">Right-click or use toolbar to add columns</p><Button onClick={addColumn} className="gap-2"><Plus className="w-4 h-4"/>Add First Column</Button></div>
          </div>
        ):(
          <div className="flex-1 overflow-auto select-none" onContextMenu={e=>openCtx(e)}>
            <table className="border-collapse text-sm min-w-full" style={{tableLayout:"fixed"}}>
              <colgroup>
                <col style={{width:"44px"}}/>
                {columns.map((_,i)=><col key={i} style={{width:"150px"}}/>)}
                <col style={{width:"36px"}}/>
              </colgroup>
              <thead className="sticky top-0 z-20">
                <tr>
                  <th className="bg-muted/90 border border-border h-8 text-xs text-muted-foreground font-normal select-none sticky left-0 z-30"/>
                  {columns.map((col,ci)=>{
                    const type=(col.type as ColumnType)??"text";
                    return (
                      <th key={col.id} className="bg-muted/90 border border-border h-8 text-xs font-medium select-none relative group" onContextMenu={e=>openCtx(e,undefined,col.id,col.name)}>
                        {renamingColId===col.id?(
                          <div className="flex items-center gap-1 px-1">
                            <Input className="h-6 text-xs flex-1 min-w-0" value={renamingColVal} autoFocus onChange={e=>setRenamingColVal(e.target.value)}
                              onBlur={()=>updateColumn(col,renamingColVal,renamingColType)}
                              onKeyDown={e=>{if(e.key==="Enter")updateColumn(col,renamingColVal,renamingColType);if(e.key==="Escape")setRenamingColId(null);}}
                            />
                            <Select value={renamingColType} onValueChange={v=>setRenamingColType(v as ColumnType)}>
                              <SelectTrigger className="h-6 w-8 p-0 border-0 bg-transparent text-xs [&>svg]:hidden shrink-0">
                                <span className="flex items-center justify-center">{TYPE_ICONS[renamingColType]}</span>
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="text"><span className="flex items-center gap-2"><Type className="w-3 h-3"/>Text</span></SelectItem>
                                <SelectItem value="number"><span className="flex items-center gap-2"><Hash className="w-3 h-3"/>Number</span></SelectItem>
                                <SelectItem value="currency"><span className="flex items-center gap-2"><DollarSign className="w-3 h-3"/>Currency</span></SelectItem>
                                <SelectItem value="date"><span className="flex items-center gap-2"><Calendar className="w-3 h-3"/>Date</span></SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                        ):(
                          <div className="flex items-center justify-between px-2 h-full">
                            <div className="flex items-center gap-1.5 overflow-hidden">
                              <span className="text-muted-foreground/40 shrink-0">{TYPE_ICONS[type]}</span>
                              <span className="truncate">{col.name}</span>
                            </div>
                            <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 shrink-0">
                              <button className="p-0.5 rounded hover:bg-muted" title="Sort" onClick={()=>{setSortCol(col.name);setSortDir(sortCol===col.name&&sortDir==="asc"?"desc":"asc");}}>
                                {sortCol===col.name?(sortDir==="asc"?<SortAsc className="w-3 h-3"/>:<SortDesc className="w-3 h-3"/>):<ChevronDown className="w-3 h-3 text-muted-foreground/50"/>}
                              </button>
                              <button className="p-0.5 rounded hover:bg-muted" title="Double-click to rename" onDoubleClick={()=>{setRenamingColId(col.id);setRenamingColVal(col.name);setRenamingColType(type);}}>
                                <Edit3 className="w-3 h-3 text-muted-foreground/50"/>
                              </button>
                            </div>
                          </div>
                        )}
                      </th>
                    );
                  })}
                  <th className="bg-muted/90 border border-border h-8">
                    <button className="w-full h-full flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted transition-colors" onClick={addColumn} title="Add column"><Plus className="w-3.5 h-3.5"/></button>
                  </th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((r,ri)=>(
                  <tr key={r.id} className="group">
                    <td className="bg-muted/40 border border-border text-center text-xs text-muted-foreground select-none h-8 cursor-context-menu font-mono hover:bg-muted/70 sticky left-0" onContextMenu={e=>openCtx(e,r.id)}>{ri+1}</td>
                    {columns.map(col=>{
                      const type=(col.type as ColumnType)??"text";
                      const isEd=editCell?.rowId===r.id&&editCell?.colName===col.name;
                      const isDragSel=dragFillSelected.has(r.id)&&dragAnchor?.colName===col.name;
                      const raw=r.row_data[col.name];

                      return (
                        <td
                          key={col.id}
                          className={`border border-border h-8 p-0 relative overflow-visible
                            ${isEd?"ring-2 ring-inset ring-primary z-10 overflow-visible":""}
                            ${isDragSel&&!isEd?"bg-blue-500/15":""}
                            ${!isEd?"hover:bg-muted/30 cursor-cell":""}
                          `}
                          onContextMenu={e=>openCtx(e,r.id,col.id,col.name)}
                          onClick={()=>{if(!isEd) startEditAndFocus(r.id,col.name);}}
                          // drag-fill: start drag from this cell
                          onMouseEnter={()=>{
                            if(isDragging.current&&dragAnchor&&dragAnchor.colName===col.name){
                              setDragEnd({rowId:r.id,colName:col.name});
                            }
                          }}
                        >
                          {isEd?(
                            // ✅ DATE FIX: use type="date" with pure ISO value in state
                            // No shared state — each cell has its own editVal
                            <Input
                              ref={el=>{cellRefs.current[cellKey(r.id,col.name)]=el;}}
                              type={type==="date"?"date":"text"}
                              inputMode={type==="number"||type==="currency"?"decimal":undefined}
                              value={editVal}
                              onChange={e=>{
                                setEditVal(e.target.value);
                                // update formula bar: show DMY for dates
                                const fbar=type==="date"?toDMY(e.target.value):e.target.value;
                                setFormulaBarVal(fbar);
                              }}
                              onBlur={async()=>{
                                const val=editValRef.current;
                                await saveCellNow(r.id,col.name,val);
                                setEditCell(null);setEditVal("");setFormulaBarVal("");
                              }}
                              enterKeyHint="next"
                              onKeyDown={async e=>{
                                if(e.key==="Enter"){e.preventDefault();await moveCell(r.id,col.name,editVal,"down");return;}
                                if(e.key==="Tab"){e.preventDefault();await moveCell(r.id,col.name,editVal,e.shiftKey?"left":"right");return;}
                                if(e.key==="ArrowDown"&&type!=="date"){e.preventDefault();await moveCell(r.id,col.name,editVal,"down");return;}
                                if(e.key==="ArrowUp"&&type!=="date"){e.preventDefault();await moveCell(r.id,col.name,editVal,"up");return;}
                                if(e.key==="Escape"){e.preventDefault();setEditVal(origValRef.current);setFormulaBarVal(type==="date"?toDMY(origValRef.current):origValRef.current);setEditCell(null);return;}
                              }}
                              className="absolute inset-0 h-full w-full border-0 rounded-none bg-background text-xs px-2 focus-visible:ring-0 focus-visible:ring-offset-0"
                              autoFocus
                            />
                          ):(
                            <div className={`px-2 h-full flex items-center text-xs overflow-hidden whitespace-nowrap ${type==="currency"?"text-primary font-medium":""} ${type==="number"?"justify-end":""}`}>
                              {displayCell(raw,type)||<span className="text-transparent select-none">·</span>}
                            </div>
                          )}

                          {/* ✅ Drag fill handle — bottom-right corner of cell */}
                          {isEd&&(
                            <div
                              className="absolute bottom-0 right-0 w-3 h-3 bg-primary border border-background cursor-crosshair z-20 translate-x-1/2 translate-y-1/2"
                              title="Drag to fill"
                              onMouseDown={e=>{
                                e.preventDefault();e.stopPropagation();
                                dragCtrlRef.current=e.ctrlKey||e.metaKey;
                                isDragging.current=true;
                                setDragAnchor({rowId:r.id,colName:col.name});
                                setDragEnd({rowId:r.id,colName:col.name});
                              }}
                            />
                          )}
                        </td>
                      );
                    })}
                    <td className="border border-border bg-transparent"/>
                  </tr>
                ))}

                {/* Totals */}
                {rows.length>0&&Object.keys(totals).length>0&&(
                  <tr>
                    <td className="bg-muted/60 border border-border text-center text-xs text-muted-foreground font-mono h-8 sticky left-0">Σ</td>
                    {columns.map((col,i)=>{
                      const total=totals[col.name];const type=col.type as ColumnType;
                      return (
                        <td key={col.id} className="bg-muted/40 border border-border px-2 h-8 text-xs font-semibold">
                          {total!=null?<span className={type==="currency"?"text-primary":""}>{type==="currency"?`₹${total.toLocaleString("en-IN")}`:total.toLocaleString("en-IN")}</span>:(i===0?<span className="text-muted-foreground">Total</span>:"")}
                        </td>
                      );
                    })}
                    <td className="border border-border bg-muted/40"/>
                  </tr>
                )}

                {/* Add Row */}
                <tr>
                  <td colSpan={columns.length+2} className="border-t border-border">
                    <button className="w-full h-8 text-xs text-muted-foreground hover:text-foreground hover:bg-muted/30 transition-colors flex items-center justify-center gap-1" onClick={addRow}>
                      <Plus className="w-3.5 h-3.5"/>Add Row
                    </button>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        )}

        {/* Status Bar */}
        <div className="flex items-center justify-between px-4 py-1 border-t border-border bg-muted/30 text-xs text-muted-foreground shrink-0">
          <span>{filtered.length} row{filtered.length!==1?"s":""} · {columns.length} column{columns.length!==1?"s":""}</span>
          {dragAnchor&&isDragging.current&&<span className="text-primary font-medium">Drag filling... {dragCtrlRef.current?"(Copy)":"(Series)"} — Hold Ctrl to copy</span>}
          {editCell&&!isDragging.current&&<span className="font-mono">{activeCellLabel}</span>}
          <span>{selTable?.name??""}</span>
        </div>
      </div>
    </>
  );
}
