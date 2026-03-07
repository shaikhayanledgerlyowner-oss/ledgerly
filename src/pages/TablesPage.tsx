import React, { useEffect, useMemo, useRef, useState, useCallback } from "react";
import {
  Plus, Table2, Trash2, Edit3, Search, SortAsc, SortDesc,
  MoreHorizontal, X, Calculator, Download, FileSpreadsheet,
  Hash, Calendar, DollarSign, ChevronDown, Type, RefreshCw,
  Bold, Italic, AlignLeft, AlignCenter, AlignRight, Palette,
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

type ColumnType = "text"|"number"|"currency"|"date";

interface DbTable  { id:string; user_id:string; name:string; created_at:string; }
interface DbColumn { id:string; table_id:string; name:string; type:string; created_at:string; }
interface DbRow    { id:string; table_id:string; row_data:Record<string,any>; created_at:string; }

// Cell styling — per cell bg + text color + bold + align
interface CellStyle { bg?:string; color?:string; bold?:boolean; align?:"left"|"center"|"right"; }
type StyleMap = Record<string, CellStyle>; // key = "rowId__colName"

// ─── Helpers ────────────────────────────────────────────────────────────────
function toNum(v:any):number {
  if(v==null||v==="") return 0;
  if(typeof v==="number") return isFinite(v)?v:0;
  const n=Number(String(v).replace(/,/g,""));
  return isFinite(n)?n:0;
}
function safeFile(n:string){ return String(n||"table").replace(/[\/\\:*?"<>|]/g,"-").trim()||"table"; }
function toISO(val:string):string {
  if(!val) return "";
  if(/^\d{4}-\d{2}-\d{2}$/.test(val)) return val;
  const m=val.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if(m){ const dt=new Date(+m[3],+m[2]-1,+m[1]); if(!isNaN(dt.getTime())) return dt.toISOString().slice(0,10); }
  const dt=new Date(val);
  return isNaN(dt.getTime())?"":dt.toISOString().slice(0,10);
}
function toDMY(iso:string):string {
  if(!iso) return "";
  const d=new Date(iso+"T00:00:00");
  if(isNaN(d.getTime())) return iso;
  return `${String(d.getDate()).padStart(2,"0")}/${String(d.getMonth()+1).padStart(2,"0")}/${d.getFullYear()}`;
}
function dispCell(v:any,type:ColumnType):string {
  if(v==null||v==="") return "";
  if(type==="currency") return `₹${toNum(v).toLocaleString("en-IN")}`;
  if(type==="number")   return toNum(v).toLocaleString("en-IN");
  if(type==="date")     return toDMY(String(v));
  return String(v);
}

// ✅ FIXED fill series — always uses step from anchor (not from=min trick)
function fillSeries(anchorVal:any, type:ColumnType, stepFromAnchor:number, isCopy:boolean):any {
  if(isCopy) return anchorVal;
  if(type==="number"||type==="currency"){
    const n=toNum(anchorVal);
    return isNaN(n)?anchorVal:n+stepFromAnchor;
  }
  if(type==="date"&&anchorVal){
    const d=new Date(String(anchorVal)+"T00:00:00");
    if(!isNaN(d.getTime())){ d.setDate(d.getDate()+stepFromAnchor); return d.toISOString().slice(0,10); }
  }
  return anchorVal; // text always copies
}

const CELL_COLORS=["#ffffff","#fef9c3","#dcfce7","#dbeafe","#fce7f3","#fee2e2","#e0e7ff","#f3f4f6","#ffd700","#ff8c00","#ff4444","#22c55e","#3b82f6","#a855f7","#000000"];
const TEXT_COLORS=["#000000","#1e293b","#dc2626","#16a34a","#2563eb","#9333ea","#ea580c","#0891b2","#ffffff","#6b7280"];

const TYPE_ICONS:Record<string,React.ReactNode>={
  text:<Type className="w-3 h-3"/>, number:<Hash className="w-3 h-3"/>,
  currency:<DollarSign className="w-3 h-3"/>, date:<Calendar className="w-3 h-3"/>,
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

  // ── cell styles (stored in memory, also persisted per table in supabase as JSON) ──
  const [styleMap,setStyleMap]=useState<StyleMap>({});
  const [selCell,setSelCell]=useState<{rowId:string;colName:string}|null>(null);

  const [search,setSearch]=useState("");
  const [sortCol,setSortCol]=useState<string|null>(null);
  const [sortDir,setSortDir]=useState<"asc"|"desc">("asc");

  // editing
  const [editCell,setEditCell]=useState<{rowId:string;colName:string}|null>(null);
  const [editVal,setEditVal]=useState("");
  const [fbarVal,setFbarVal]=useState("");
  const origRef=useRef("");
  const editValRef=useRef("");
  const savingRef=useRef(false);
  const cellRefs=useRef<Record<string,HTMLInputElement|null>>({});
  const colsRef=useRef<DbColumn[]>([]);
  const rowsRef=useRef<DbRow[]>([]);

  // ── autocomplete ──
  const [acSugg,setAcSugg]=useState("");  // suggestion overlay text

  // ── drag fill ──
  const [dragAnchor,setDragAnchor]=useState<{rowId:string;colName:string}|null>(null);
  const [dragEnd,setDragEnd]=useState<{rowId:string;colName:string}|null>(null);
  const isDragging=useRef(false);
  const ctrlDrag=useRef(false);
  // store anchor row index at drag start (not recomputed)
  const dragAnchorIdxRef=useRef(-1);

  // ── rename col ──
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

  // ── color pickers ──
  const [showBgPicker,setShowBgPicker]=useState(false);
  const [showTextPicker,setShowTextPicker]=useState(false);

  // ── context menu ──
  const [ctx,setCtx]=useState<CtxMenu|null>(null);

  useEffect(()=>{editValRef.current=editVal;},[editVal]);
  useEffect(()=>{colsRef.current=columns;},[columns]);
  const cellKey=(r:string,c:string)=>`${r}__${c}`;

  const focusCell=(rowId:string,colName:string)=>{
    setTimeout(()=>{
      const el=cellRefs.current[cellKey(rowId,colName)];
      if(el){el.focus();try{el.select();}catch{}}
    },30);
  };

  // ─── Load ────────────────────────────────────────────────────────────────────
  const loadTables=async()=>{
    if(!uid) return;
    const {data}=await supabase.from("user_tables").select("*").eq("user_id",uid).order("created_at",{ascending:true});
    const list=(data??[]) as DbTable[];
    setTables(list);
    setSelTable(prev=>{
      if(prev){const f=list.find(t=>t.id===prev.id);return f??list[0]??null;}
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
    // load styles from table meta if stored
    const {data:meta}=await supabase.from("user_tables").select("*").eq("id",tid).single();
    if((meta as any)?.style_map) try{setStyleMap(JSON.parse((meta as any).style_map));}catch{}
    else setStyleMap({});
  };
  useEffect(()=>{loadTables();},[uid]);
  useEffect(()=>{if(selTable)loadData(selTable.id);else{setColumns([]);setRows([]);setStyleMap({});}},[selTable?.id]);

  // ─── Save styles to DB ───────────────────────────────────────────────────────
  const saveStyles=useCallback(async(map:StyleMap)=>{
    if(!selTable) return;
    await supabase.from("user_tables").update({style_map:JSON.stringify(map)} as any).eq("id",selTable.id);
  },[selTable]);

  const setCellStyle=(rowId:string,colName:string,patch:Partial<CellStyle>)=>{
    const key=cellKey(rowId,colName);
    setStyleMap(prev=>{
      const next={...prev,[key]:{...(prev[key]??{}), ...patch}};
      saveStyles(next);
      return next;
    });
  };

  // ─── Table CRUD ──────────────────────────────────────────────────────────────
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
    const n=prompt("Rename:",t.name);if(!n?.trim()) return;
    await supabase.from("user_tables").update({name:n.trim()}).eq("id",t.id);
    await loadTables();
  };

  // ─── Column CRUD ─────────────────────────────────────────────────────────────
  const addColumn=async()=>{
    if(!selTable) return;
    const name=`Column ${columns.length+1}`;
    await supabase.from("user_columns").insert({table_id:selTable.id,name,type:"text"});
    if(rows.length>0) await Promise.all(rows.map(r=>supabase.from("user_rows").update({row_data:{...r.row_data,[name]:""}}).eq("id",r.id)));
    await loadData(selTable.id);
    setTimeout(()=>{const nc=colsRef.current[colsRef.current.length-1];if(nc){setRenamingColId(nc.id);setRenamingColVal(nc.name);setRenamingColType("text");}},80);
  };
  const deleteColumn=async(col:DbColumn)=>{
    if(!selTable) return;
    await supabase.from("user_columns").delete().eq("id",col.id);
    if(rows.length>0){
      await Promise.all(rows.map(r=>{const rd={...r.row_data};delete rd[col.name];return supabase.from("user_rows").update({row_data:rd}).eq("id",r.id);}));
    }
    await loadData(selTable.id);
  };
  const updateColumn=async(col:DbColumn,newName:string,newType:ColumnType)=>{
    if(!newName.trim()) return;
    const old=col.name;
    await supabase.from("user_columns").update({name:newName.trim(),type:newType}).eq("id",col.id);
    if(rows.length>0&&old!==newName.trim()){
      await Promise.all(rows.map(r=>{const rd={...r.row_data};rd[newName.trim()]=rd[old];delete rd[old];return supabase.from("user_rows").update({row_data:rd}).eq("id",r.id);}));
    }
    setRenamingColId(null);
    if(selTable) await loadData(selTable.id);
  };

  // ─── Row CRUD ────────────────────────────────────────────────────────────────
  const addRow=async()=>{
    if(!selTable||columns.length===0) return;
    const empty:Record<string,any>={};columns.forEach(c=>(empty[c.name]=""));
    const {error}=await supabase.from("user_rows").insert({table_id:selTable.id,row_data:empty});
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

  // ─── Autocomplete ────────────────────────────────────────────────────────────
  const getAutoSugg=(colName:string, typed:string, curRowId:string):string=>{
    if(!typed) return "";
    const q=typed.toLowerCase();
    for(const r of rowsRef.current){
      if(r.id===curRowId) continue;
      const v=String(r.row_data[colName]??"");
      if(v&&v.toLowerCase().startsWith(q)&&v.toLowerCase()!==q) return v;
    }
    return "";
  };

  // ─── Cell editing ────────────────────────────────────────────────────────────
  const startEdit=(rowId:string,colName:string)=>{
    const col=colsRef.current.find(c=>c.name===colName);
    const type=(col?.type as ColumnType)??"text";
    const row=rowsRef.current.find(r=>r.id===rowId);
    const raw=(row?.row_data??{})[colName];
    const stateVal=raw==null?"":String(raw);
    const fbar=type==="date"?toDMY(stateVal):stateVal;
    origRef.current=stateVal;
    setEditCell({rowId,colName});
    setEditVal(stateVal);
    setFbarVal(fbar);
    setSelCell({rowId,colName});
    setAcSugg("");
  };
  const startEditAndFocus=(rowId:string,colName:string)=>{startEdit(rowId,colName);focusCell(rowId,colName);};

  const saveCellNow=async(rowId:string,colName:string,val:string)=>{
    if(savingRef.current) return;
    savingRef.current=true;
    const col=colsRef.current.find(c=>c.name===colName);
    const type=(col?.type as ColumnType)??"text";
    let value:any=val;
    if(type==="number"||type==="currency") value=val===""?"":toNum(val);
    else if(type==="date") value=val;
    setRows(prev=>prev.map(r=>r.id!==rowId?r:{...r,row_data:{...r.row_data,[colName]:value}}));
    const row=rowsRef.current.find(r=>r.id===rowId);
    const rd={...(row?.row_data??{})};
    await supabase.from("user_rows").update({row_data:{...rd,[colName]:value}}).eq("id",rowId);
    savingRef.current=false;
  };

  // ─── Filtered rows ───────────────────────────────────────────────────────────
  const filtered=useMemo(()=>{
    let list=[...rows];
    if(search.trim()){const q=search.toLowerCase();list=list.filter(r=>Object.values(r.row_data).some(v=>String(v??"").toLowerCase().includes(q)));}
    if(sortCol){
      const col=columns.find(c=>c.name===sortCol);const type=(col?.type as ColumnType)??"text";
      list.sort((a,b)=>{
        const av=a.row_data[sortCol]??"",bv=b.row_data[sortCol]??"";
        if(type==="number"||type==="currency"){return sortDir==="asc"?toNum(av)-toNum(bv):toNum(bv)-toNum(av);}
        return sortDir==="asc"?String(av).localeCompare(String(bv)):String(bv).localeCompare(String(av));
      });
    }
    return list;
  },[rows,search,sortCol,sortDir,columns]);
  useEffect(()=>{rowsRef.current=filtered;},[filtered]);

  // ─── Move cell ───────────────────────────────────────────────────────────────
  const moveCell=async(rowId:string,colName:string,val:string,dir:"right"|"left"|"down"|"up")=>{
    await saveCellNow(rowId,colName,val);
    setEditCell(null);setEditVal("");setFbarVal("");setAcSugg("");
    const cols=colsRef.current,list=rowsRef.current;
    const ri=list.findIndex(r=>r.id===rowId),ci=cols.findIndex(c=>c.name===colName);
    let nr=ri,nc=ci;
    if(dir==="right") nc=Math.min(ci+1,cols.length-1);
    else if(dir==="left") nc=Math.max(ci-1,0);
    else if(dir==="down"){nr=ri+1;if(nr>=list.length){addRow();return;}}
    else if(dir==="up") nr=Math.max(ri-1,0);
    const nextRow=list[nr],nextCol=cols[nc];
    if(nextRow&&nextCol) startEditAndFocus(nextRow.id,nextCol.name);
  };

  // ─── Totals ──────────────────────────────────────────────────────────────────
  const totals=useMemo(()=>{
    const t:Record<string,number>={};
    columns.forEach(c=>{if(c.type==="number"||c.type==="currency") t[c.name]=rows.reduce((s,r)=>s+toNum(r.row_data[c.name]),0);});
    return t;
  },[columns,rows]);

  // ─── DRAG FILL (FIXED) ───────────────────────────────────────────────────────
  // Key fix: anchor index stored at mousedown, step = currentIdx - anchorIdx (always positive going down)
  const dragSelected=useMemo(()=>{
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

  const applyDrag=useCallback(async()=>{
    if(!dragAnchor||!dragEnd) return;
    const list=rowsRef.current;
    const ai=dragAnchorIdxRef.current; // use stored anchor idx
    const ei=list.findIndex(r=>r.id===dragEnd.rowId);
    if(ai<0||ei<0||ai===ei||dragAnchor.colName!==dragEnd.colName){setDragAnchor(null);setDragEnd(null);return;}
    const col=colsRef.current.find(c=>c.name===dragAnchor.colName);
    const type=(col?.type as ColumnType)??"text";
    const anchorRow=list[ai];
    const anchorVal=(anchorRow?.row_data??{})[dragAnchor.colName];
    const isCopy=ctrlDrag.current;
    // always fill downward (ei > ai means going down, ei < ai means going up)
    const from=Math.min(ai,ei),to=Math.max(ai,ei);
    for(let i=from;i<=to;i++){
      if(i===ai) continue;
      const targetRow=list[i];if(!targetRow) continue;
      // step is ALWAYS distance from anchor (so 9 -> 10,11,12 going down OR 8,7,6 going up)
      const step=i-ai; // positive going down, negative going up
      const newVal=fillSeries(anchorVal,type,step,isCopy);
      setRows(prev=>prev.map(r=>r.id!==targetRow.id?r:{...r,row_data:{...r.row_data,[dragAnchor.colName]:newVal}}));
      await supabase.from("user_rows").update({row_data:{...targetRow.row_data,[dragAnchor.colName]:newVal}}).eq("id",targetRow.id);
    }
    toast.success(isCopy?"Copied!":type==="text"?"Copied!":"Filled!");
    setDragAnchor(null);setDragEnd(null);
  },[dragAnchor,dragEnd]);

  useEffect(()=>{
    const up=async()=>{
      if(!isDragging.current) return;
      isDragging.current=false;
      await applyDrag();
    };
    window.addEventListener("mouseup",up);
    return ()=>window.removeEventListener("mouseup",up);
  },[applyDrag]);

  // ─── Context menu ────────────────────────────────────────────────────────────
  const openCtx=(e:React.MouseEvent,rowId?:string,colId?:string,colName?:string)=>{
    e.preventDefault();e.stopPropagation();
    setCtx({x:e.clientX,y:e.clientY,rowId,colId,colName});
  };
  useEffect(()=>{const close=()=>setCtx(null);window.addEventListener("click",close);return()=>window.removeEventListener("click",close);},[]);

  // ─── EasyCount ───────────────────────────────────────────────────────────────
  const doCount=()=>{
    const active=countConds.filter(c=>c.col&&c.crit);
    if(!active.length) return toast.error("Add at least 1 condition");
    const n=rows.filter(r=>active.every(cond=>String(r.row_data[cond.col]??"").toLowerCase().includes(cond.crit.toLowerCase()))).length;
    setCountResult(n);toast.success(`Found ${n} rows`);
  };

  // ─── Downloads ───────────────────────────────────────────────────────────────
  const dlPDF=()=>{
    if(!hasAccess) return toast.error("Upgrade to download");
    if(!selTable||!columns.length) return;
    const doc=new jsPDF({orientation:"l",unit:"pt",format:"a4"});
    doc.setFont("helvetica","bold");doc.setFontSize(16);doc.text(selTable.name,40,45);
    doc.setFont("helvetica","normal");doc.setFontSize(10);doc.text(`Exported: ${new Date().toLocaleString()}`,40,62);
    const head=[columns.map(c=>c.name)];
    const body=filtered.map(r=>columns.map(c=>{
      const v=r.row_data[c.name];const type=c.type as ColumnType;
      if(type==="currency") return `Rs. ${toNum(v).toLocaleString("en-IN",{minimumFractionDigits:2,maximumFractionDigits:2})}`;
      if(type==="number") return toNum(v).toLocaleString("en-IN");
      if(type==="date") return toDMY(String(v??""));
      return v==null?"":String(v);
    }));
    if(Object.keys(totals).length) body.push(columns.map((c,i)=>{const t=totals[c.name];return t!=null?(c.type==="currency"?`Rs. ${t.toLocaleString("en-IN",{minimumFractionDigits:2})}`:t.toLocaleString("en-IN")):(i===0?"Total":"");}));
    autoTable(doc,{startY:75,head,body,styles:{font:"helvetica",fontSize:9,cellPadding:5},headStyles:{fillColor:[30,30,30],textColor:255},margin:{left:40,right:40}});
    doc.save(`${safeFile(selTable.name)}.pdf`);toast.success("PDF downloaded");
  };

  const dlExcel=()=>{
    if(!hasAccess) return toast.error("Upgrade to download");
    if(!selTable||!columns.length) return;
    const header=columns.map(c=>c.name);
    const data=filtered.map((r,ri)=>columns.map((c,ci)=>{
      const v=r.row_data[c.name];const type=c.type as ColumnType;
      if(type==="number"||type==="currency") return v===""||v==null?"":toNum(v);
      if(type==="date") return toDMY(String(v??""));
      return v==null?"":String(v);
    }));
    if(Object.keys(totals).length) data.push(columns.map((c,i)=>{const t=totals[c.name];return t!=null?t:(i===0?"Total":"")}) as any);

    const ws=XLSX.utils.aoa_to_sheet([header,...data]);

    // ✅ Apply cell colors to Excel
    const range=XLSX.utils.decode_range(ws["!ref"]||"A1");
    for(let ri2=0;ri2<=range.e.r;ri2++){
      for(let ci2=0;ci2<=range.e.c;ci2++){
        const addr=XLSX.utils.encode_cell({r:ri2,c:ci2});
        if(!ws[addr]) continue;
        const rowObj=ri2===0?null:filtered[ri2-1];
        const colObj=columns[ci2];
        const styleKey=rowObj&&colObj?cellKey(rowObj.id,colObj.name):"";
        const cs=styleKey?styleMap[styleKey]:undefined;
        const isHeader=ri2===0;
        ws[addr].s={
          fill:{patternType:"solid",fgColor:{rgb:isHeader?"1e1e1e":(cs?.bg?cs.bg.replace("#",""):"FFFFFF")}},
          font:{bold:isHeader||(cs?.bold??false),color:{rgb:isHeader?"FFFFFF":(cs?.color?cs.color.replace("#",""):"000000")}},
          alignment:{horizontal:cs?.align??"left",vertical:"center"},
          border:{top:{style:"thin",color:{rgb:"D1D5DB"}},bottom:{style:"thin",color:{rgb:"D1D5DB"}},left:{style:"thin",color:{rgb:"D1D5DB"}},right:{style:"thin",color:{rgb:"D1D5DB"}}},
        };
      }
    }
    (ws as any)["!cols"]=header.map((_,i)=>({wch:Math.min(Math.max(...[header[i].length,...data.map(row=>String(row[i]??"").length)])+2,40)}));
    const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,ws,"Sheet1");
    // Use xlsx with cellStyles support
    const out=XLSX.write(wb,{bookType:"xlsx",type:"array",cellStyles:true});
    saveAs(new Blob([out],{type:"application/octet-stream"}),`${safeFile(selTable.name)}.xlsx`);
    toast.success("Excel downloaded");
  };

  const activeCellLabel=useMemo(()=>{
    if(!editCell) return "";
    const ci=columns.findIndex(c=>c.name===editCell.colName);
    const ri=rowsRef.current.findIndex(r=>r.id===editCell.rowId);
    return `${colLetter(ci)}${ri+1}`;
  },[editCell,columns]);

  const selStyle=useMemo(()=>{
    if(!selCell) return {} as CellStyle;
    return styleMap[cellKey(selCell.rowId,selCell.colName)]??{};
  },[selCell,styleMap]);

  // ─── RENDER ──────────────────────────────────────────────────────────────────
  return (
    <>
      <AlertDialog open={delOpen} onOpenChange={setDelOpen}>
        <AlertDialogContent>
          <AlertDialogHeader><AlertDialogTitle>Delete "{delTarget?.name}"?</AlertDialogTitle><AlertDialogDescription>All data will be permanently deleted.</AlertDialogDescription></AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={async()=>{if(delTarget){await deleteTable(delTarget.id);setDelOpen(false);setDelTarget(null);}}}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {ctx&&(
        <div className="fixed z-50 bg-card border border-border rounded-lg shadow-xl py-1 min-w-[180px] text-sm" style={{top:ctx.y,left:ctx.x}} onClick={e=>e.stopPropagation()}>
          {ctx.rowId&&<><button className="w-full px-4 py-2 text-left hover:bg-muted flex items-center gap-2" onClick={()=>{addRow();setCtx(null);}}><Plus className="w-3.5 h-3.5"/>Insert Row Below</button><button className="w-full px-4 py-2 text-left hover:bg-muted text-destructive flex items-center gap-2" onClick={()=>{deleteRow(ctx.rowId!);setCtx(null);}}><Trash2 className="w-3.5 h-3.5"/>Delete Row</button><div className="border-t border-border my-1"/></>}
          {ctx.colId&&<><button className="w-full px-4 py-2 text-left hover:bg-muted flex items-center gap-2" onClick={()=>{addColumn();setCtx(null);}}><Plus className="w-3.5 h-3.5"/>Insert Column</button><button className="w-full px-4 py-2 text-left hover:bg-muted text-destructive flex items-center gap-2" onClick={()=>{const col=columns.find(c=>c.id===ctx.colId);if(col)deleteColumn(col);setCtx(null);}}><Trash2 className="w-3.5 h-3.5"/>Delete Column</button></>}
          {!ctx.rowId&&!ctx.colId&&<><button className="w-full px-4 py-2 text-left hover:bg-muted flex items-center gap-2" onClick={()=>{addRow();setCtx(null);}}><Plus className="w-3.5 h-3.5"/>Add Row</button><button className="w-full px-4 py-2 text-left hover:bg-muted flex items-center gap-2" onClick={()=>{addColumn();setCtx(null);}}><Plus className="w-3.5 h-3.5"/>Add Column</button></>}
        </div>
      )}

      <div className="flex flex-col h-[calc(100vh-4rem)] -m-4 md:-m-6 lg:-m-8 overflow-hidden">

        {/* ── Excel Toolbar ─────────────────────────────────────────────────── */}
        <div className="flex items-center gap-0.5 px-2 py-1 border-b border-border bg-[#f8f8f8] dark:bg-muted/40 shrink-0 flex-wrap">
          {/* Search */}
          <div className="relative mr-1">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground"/>
            <Input className="h-7 pl-7 w-32 text-xs bg-white dark:bg-background" placeholder="Search..." value={search} onChange={e=>setSearch(e.target.value)}/>
          </div>

          <div className="w-px h-6 bg-border mx-1"/>

          {/* Bold */}
          <button
            title="Bold (Ctrl+B)"
            onClick={()=>selCell&&setCellStyle(selCell.rowId,selCell.colName,{bold:!selStyle.bold})}
            className={`w-7 h-7 flex items-center justify-center rounded text-sm font-bold hover:bg-muted transition-colors ${selStyle.bold?"bg-primary/20 text-primary":""}`}
          >B</button>

          {/* Align */}
          {(["left","center","right"] as const).map(a=>(
            <button key={a} title={`Align ${a}`}
              onClick={()=>selCell&&setCellStyle(selCell.rowId,selCell.colName,{align:a})}
              className={`w-7 h-7 flex items-center justify-center rounded hover:bg-muted transition-colors ${selStyle.align===a?"bg-primary/20 text-primary":""}`}
            >
              {a==="left"?<AlignLeft className="w-3.5 h-3.5"/>:a==="center"?<AlignCenter className="w-3.5 h-3.5"/>:<AlignRight className="w-3.5 h-3.5"/>}
            </button>
          ))}

          <div className="w-px h-6 bg-border mx-1"/>

          {/* Background color */}
          <Popover open={showBgPicker} onOpenChange={setShowBgPicker}>
            <PopoverTrigger asChild>
              <button title="Cell background color" className="w-7 h-7 flex flex-col items-center justify-center rounded hover:bg-muted transition-colors gap-0.5">
                <Palette className="w-3.5 h-3.5"/>
                <div className="w-4 h-1 rounded-sm border border-border" style={{background:selStyle.bg??"#ffffff"}}/>
              </button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-2" align="start">
              <p className="text-xs font-medium mb-2">Cell Background</p>
              <div className="grid grid-cols-5 gap-1">
                {CELL_COLORS.map(c=>(
                  <button key={c} className={`w-6 h-6 rounded border-2 transition-all ${selStyle.bg===c?"border-primary scale-110":"border-transparent hover:border-muted-foreground"}`}
                    style={{background:c}} onClick={()=>{if(selCell)setCellStyle(selCell.rowId,selCell.colName,{bg:c});setShowBgPicker(false);}}/>
                ))}
                <button className="w-6 h-6 rounded border-2 border-dashed border-muted-foreground text-xs flex items-center justify-center" onClick={()=>{if(selCell)setCellStyle(selCell.rowId,selCell.colName,{bg:undefined});setShowBgPicker(false);}}>✕</button>
              </div>
            </PopoverContent>
          </Popover>

          {/* Text color */}
          <Popover open={showTextPicker} onOpenChange={setShowTextPicker}>
            <PopoverTrigger asChild>
              <button title="Text color" className="w-7 h-7 flex flex-col items-center justify-center rounded hover:bg-muted transition-colors gap-0.5">
                <span className="text-xs font-bold" style={{color:selStyle.color??"#000000",lineHeight:1}}>A</span>
                <div className="w-4 h-1 rounded-sm border border-border" style={{background:selStyle.color??"#000000"}}/>
              </button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-2" align="start">
              <p className="text-xs font-medium mb-2">Text Color</p>
              <div className="grid grid-cols-5 gap-1">
                {TEXT_COLORS.map(c=>(
                  <button key={c} className={`w-6 h-6 rounded border-2 transition-all ${selStyle.color===c?"border-primary scale-110":"border-transparent hover:border-muted-foreground"}`}
                    style={{background:c}} onClick={()=>{if(selCell)setCellStyle(selCell.rowId,selCell.colName,{color:c});setShowTextPicker(false);}}/>
                ))}
                <button className="w-6 h-6 rounded border-2 border-dashed border-muted-foreground text-xs flex items-center justify-center" onClick={()=>{if(selCell)setCellStyle(selCell.rowId,selCell.colName,{color:undefined});setShowTextPicker(false);}}>✕</button>
              </div>
            </PopoverContent>
          </Popover>

          <div className="w-px h-6 bg-border mx-1"/>

          <Button variant="ghost" size="sm" className="h-7 px-2 text-xs gap-1" onClick={addRow} disabled={!selTable||columns.length===0}><Plus className="w-3 h-3"/>Row</Button>
          <Button variant="ghost" size="sm" className="h-7 px-2 text-xs gap-1" onClick={addColumn} disabled={!selTable}><Plus className="w-3 h-3"/>Column</Button>
          {sortCol&&<Button variant="ghost" size="sm" className="h-7 px-2 text-xs gap-1" onClick={()=>setSortCol(null)}><RefreshCw className="w-3 h-3"/>Clear Sort</Button>}

          <div className="w-px h-6 bg-border mx-1"/>

          <Popover open={countOpen} onOpenChange={setCountOpen}>
            <PopoverTrigger asChild>
              <Button variant="ghost" size="sm" className="h-7 px-2 text-xs gap-1"><Calculator className="w-3.5 h-3.5"/>EasyCount</Button>
            </PopoverTrigger>
            <PopoverContent className="w-80" align="start">
              <div className="space-y-3">
                <h4 className="font-semibold text-sm">EasyCount</h4>
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

          <div className="w-px h-6 bg-border mx-1"/>
          <Button variant="ghost" size="sm" className="h-7 px-2 text-xs gap-1" onClick={dlPDF} disabled={!hasAccess}><Download className="w-3.5 h-3.5"/>PDF</Button>
          <Button variant="ghost" size="sm" className="h-7 px-2 text-xs gap-1" onClick={dlExcel} disabled={!hasAccess}><FileSpreadsheet className="w-3.5 h-3.5"/>Excel</Button>
        </div>

        {/* ── Formula Bar ─────────────────────────────────────────────────── */}
        <div className="flex items-center gap-2 px-3 py-1 border-b border-border bg-white dark:bg-card shrink-0">
          <div className="flex items-center justify-center w-14 h-6 border border-border rounded text-xs font-mono text-muted-foreground bg-muted/30 shrink-0">{activeCellLabel||"—"}</div>
          <div className="w-px h-4 bg-border"/>
          <Input
            className="h-6 text-xs font-mono border-0 bg-transparent focus-visible:ring-0 focus-visible:ring-offset-0 p-0 flex-1"
            placeholder="Click a cell to edit..."
            value={fbarVal}
            onChange={e=>{
              setFbarVal(e.target.value);
              if(editCell){
                const col=colsRef.current.find(c=>c.name===editCell.colName);
                const type=(col?.type as ColumnType)??"text";
                setEditVal(type==="date"?toISO(e.target.value):e.target.value);
              }
            }}
            onKeyDown={async e=>{
              if(!editCell) return;
              if(e.key==="Enter"){e.preventDefault();await moveCell(editCell.rowId,editCell.colName,editValRef.current,"down");}
              if(e.key==="Escape"){setEditVal(origRef.current);setFbarVal(origRef.current);setEditCell(null);}
            }}
          />
        </div>

        {/* ── Sheet Tabs ───────────────────────────────────────────────────── */}
        <div className="flex items-center gap-0 border-b border-border bg-[#f0f0f0] dark:bg-muted/30 px-2 pt-1 overflow-x-auto shrink-0">
          {tables.map(t=>(
            <div key={t.id} className="relative group flex items-center shrink-0">
              <button onClick={()=>setSelTable(t)}
                className={`px-4 py-1.5 text-xs rounded-t border border-b-0 transition-all whitespace-nowrap ${selTable?.id===t.id?"bg-white dark:bg-background border-border text-foreground font-medium":"border-transparent text-muted-foreground hover:text-foreground hover:bg-white/50"}`}
              >{t.name}</button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild><button className="p-0.5 rounded opacity-0 group-hover:opacity-100 ml-0.5 text-muted-foreground"><MoreHorizontal className="w-3 h-3"/></button></DropdownMenuTrigger>
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
              <Input className="h-6 w-24 text-xs" placeholder="Sheet name..." value={newTableName} onChange={e=>setNewTableName(e.target.value)} autoFocus onKeyDown={e=>{if(e.key==="Enter")createTable();if(e.key==="Escape"){setAddingTable(false);setNewTableName("");}}}/>
              <Button size="sm" className="h-6 px-2 text-xs" onClick={createTable}>Add</Button>
              <Button size="sm" variant="ghost" className="h-6 px-1" onClick={()=>{setAddingTable(false);setNewTableName("");}}><X className="w-3 h-3"/></Button>
            </div>
          ):(
            <button onClick={()=>setAddingTable(true)} className="p-1 ml-1 rounded hover:bg-white/70 text-muted-foreground hover:text-foreground" title="New sheet"><Plus className="w-3.5 h-3.5"/></button>
          )}
        </div>

        {/* ── Grid ─────────────────────────────────────────────────────────── */}
        {!selTable?(
          <div className="flex-1 flex items-center justify-center p-8 text-center">
            <div><Table2 className="w-16 h-16 mx-auto mb-4 text-muted-foreground/30"/><h3 className="text-lg font-semibold mb-2">No sheets yet</h3><Button onClick={()=>setAddingTable(true)} className="gap-2 mt-2"><Plus className="w-4 h-4"/>New Sheet</Button></div>
          </div>
        ):columns.length===0?(
          <div className="flex-1 flex items-center justify-center p-8 text-center" onContextMenu={e=>openCtx(e)}>
            <div><Table2 className="w-12 h-12 mx-auto mb-3 text-muted-foreground/30"/><h3 className="font-semibold mb-1">Empty Sheet</h3><p className="text-muted-foreground text-sm mb-3">Right-click or use toolbar to add columns</p><Button onClick={addColumn} className="gap-2"><Plus className="w-4 h-4"/>Add Column</Button></div>
          </div>
        ):(
          <div className="flex-1 overflow-auto bg-white dark:bg-background" onContextMenu={e=>openCtx(e)}>
            <table className="border-collapse text-sm min-w-full" style={{tableLayout:"fixed"}}>
              <colgroup>
                <col style={{width:"44px"}}/>
                {columns.map((_,i)=><col key={i} style={{width:"150px"}}/>)}
                <col style={{width:"36px"}}/>
              </colgroup>
              <thead className="sticky top-0 z-20">
                <tr>
                  <th className="bg-[#f2f2f2] dark:bg-muted border border-[#d0d0d0] dark:border-border h-8 select-none sticky left-0 z-30"/>
                  {columns.map((col,ci)=>{
                    const type=(col.type as ColumnType)??"text";
                    return (
                      <th key={col.id} className="bg-[#f2f2f2] dark:bg-muted border border-[#d0d0d0] dark:border-border h-8 text-xs font-medium select-none relative group" onContextMenu={e=>openCtx(e,undefined,col.id,col.name)}>
                        {renamingColId===col.id?(
                          <div className="flex items-center gap-1 px-1">
                            <Input className="h-6 text-xs flex-1 min-w-0" value={renamingColVal} autoFocus onChange={e=>setRenamingColVal(e.target.value)} onBlur={()=>updateColumn(col,renamingColVal,renamingColType)} onKeyDown={e=>{if(e.key==="Enter")updateColumn(col,renamingColVal,renamingColType);if(e.key==="Escape")setRenamingColId(null);}}/>
                            <Select value={renamingColType} onValueChange={v=>setRenamingColType(v as ColumnType)}>
                              <SelectTrigger className="h-6 w-8 p-0 border-0 bg-transparent [&>svg]:hidden shrink-0"><span className="flex items-center justify-center">{TYPE_ICONS[renamingColType]}</span></SelectTrigger>
                              <SelectContent>
                                <SelectItem value="text"><span className="flex gap-2 items-center"><Type className="w-3 h-3"/>Text</span></SelectItem>
                                <SelectItem value="number"><span className="flex gap-2 items-center"><Hash className="w-3 h-3"/>Number</span></SelectItem>
                                <SelectItem value="currency"><span className="flex gap-2 items-center"><DollarSign className="w-3 h-3"/>Currency</span></SelectItem>
                                <SelectItem value="date"><span className="flex gap-2 items-center"><Calendar className="w-3 h-3"/>Date</span></SelectItem>
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
                              <button className="p-0.5 rounded hover:bg-white/60" onClick={()=>{setSortCol(col.name);setSortDir(sortCol===col.name&&sortDir==="asc"?"desc":"asc");}}>
                                {sortCol===col.name?(sortDir==="asc"?<SortAsc className="w-3 h-3"/>:<SortDesc className="w-3 h-3"/>):<ChevronDown className="w-3 h-3 opacity-50"/>}
                              </button>
                              <button className="p-0.5 rounded hover:bg-white/60" onDoubleClick={()=>{setRenamingColId(col.id);setRenamingColVal(col.name);setRenamingColType(type);}}><Edit3 className="w-3 h-3 opacity-50"/></button>
                            </div>
                          </div>
                        )}
                      </th>
                    );
                  })}
                  <th className="bg-[#f2f2f2] dark:bg-muted border border-[#d0d0d0] dark:border-border h-8">
                    <button className="w-full h-full flex items-center justify-center text-muted-foreground hover:bg-white/60 transition-colors" onClick={addColumn}><Plus className="w-3.5 h-3.5"/></button>
                  </th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((r,ri)=>(
                  <tr key={r.id}>
                    <td className="bg-[#f2f2f2] dark:bg-muted/40 border border-[#d0d0d0] dark:border-border text-center text-xs text-muted-foreground select-none h-8 cursor-context-menu font-mono hover:bg-[#e8e8e8] sticky left-0" onContextMenu={e=>openCtx(e,r.id)}>{ri+1}</td>
                    {columns.map(col=>{
                      const type=(col.type as ColumnType)??"text";
                      const isEd=editCell?.rowId===r.id&&editCell?.colName===col.name;
                      const isSel=selCell?.rowId===r.id&&selCell?.colName===col.name;
                      const isDragSel=dragSelected.has(r.id)&&dragAnchor?.colName===col.name;
                      const raw=r.row_data[col.name];
                      const cs=styleMap[cellKey(r.id,col.name)];

                      return (
                        <td
                          key={col.id}
                          className={`border border-[#d0d0d0] dark:border-border h-8 p-0 relative overflow-visible cursor-cell
                            ${isEd?"outline outline-2 outline-[#1a73e8] z-10 overflow-visible":""}
                            ${isSel&&!isEd?"outline outline-2 outline-[#1a73e8]/60":""}
                            ${isDragSel&&!isEd?"bg-blue-100 dark:bg-blue-900/30":""}
                          `}
                          style={{background:cs?.bg&&!isDragSel?cs.bg:undefined}}
                          onContextMenu={e=>openCtx(e,r.id,col.id,col.name)}
                          onClick={()=>{if(!isEd)startEditAndFocus(r.id,col.name);}}
                          onMouseEnter={()=>{if(isDragging.current&&dragAnchor?.colName===col.name)setDragEnd({rowId:r.id,colName:col.name});}}
                        >
                          {isEd?(
                            <div className="relative w-full h-full">
                              <Input
                                ref={el=>{cellRefs.current[cellKey(r.id,col.name)]=el;}}
                                type={type==="date"?"date":"text"}
                                inputMode={type==="number"||type==="currency"?"decimal":undefined}
                                value={editVal}
                                onChange={e=>{
                                  const v=e.target.value;
                                  setEditVal(v);
                                  const fb=type==="date"?toDMY(v):v;
                                  setFbarVal(fb);
                                  // autocomplete for text cols
                                  if(type==="text"){
                                    setAcSugg(getAutoSugg(col.name,v,r.id));
                                  }
                                }}
                                onBlur={async()=>{
                                  await saveCellNow(r.id,col.name,editValRef.current);
                                  setEditCell(null);setEditVal("");setFbarVal("");setAcSugg("");
                                }}
                                enterKeyHint="next"
                                onKeyDown={async e=>{
                                  // ✅ Autocomplete accept with Tab or ArrowRight
                                  if((e.key==="Tab"||e.key==="ArrowRight")&&acSugg){
                                    e.preventDefault();
                                    setEditVal(acSugg);setFbarVal(acSugg);setAcSugg("");
                                    if(e.key==="Tab") await moveCell(r.id,col.name,acSugg,"right");
                                    return;
                                  }
                                  if(e.key==="Enter"){
                                    // accept autocomplete if present
                                    if(acSugg){setEditVal(acSugg);await moveCell(r.id,col.name,acSugg,"down");return;}
                                    e.preventDefault();await moveCell(r.id,col.name,editVal,"down");return;
                                  }
                                  if(e.key==="Tab"){e.preventDefault();await moveCell(r.id,col.name,editVal,e.shiftKey?"left":"right");return;}
                                  if(e.key==="ArrowDown"&&type!=="date"){e.preventDefault();await moveCell(r.id,col.name,editVal,"down");return;}
                                  if(e.key==="ArrowUp"&&type!=="date"){e.preventDefault();await moveCell(r.id,col.name,editVal,"up");return;}
                                  if(e.key==="Escape"){e.preventDefault();setEditVal(origRef.current);setFbarVal(type==="date"?toDMY(origRef.current):origRef.current);setEditCell(null);setAcSugg("");return;}
                                  if(e.key==="b"&&(e.ctrlKey||e.metaKey)){e.preventDefault();setCellStyle(r.id,col.name,{bold:!cs?.bold});return;}
                                  // clear autocomplete on any other key
                                  if(e.key.length===1) setAcSugg("");
                                }}
                                className="absolute inset-0 h-full w-full border-0 rounded-none bg-background text-xs px-2 focus-visible:ring-0 focus-visible:ring-offset-0 z-10"
                                style={{fontWeight:cs?.bold?"bold":"normal",color:cs?.color,textAlign:cs?.align??"left"}}
                                autoFocus
                              />
                              {/* ✅ Autocomplete ghost text overlay */}
                              {acSugg&&(
                                <div className="absolute inset-0 flex items-center px-2 pointer-events-none z-0 text-xs overflow-hidden whitespace-nowrap">
                                  <span className="invisible">{editVal}</span>
                                  <span className="text-muted-foreground/50">{acSugg.slice(editVal.length)}</span>
                                </div>
                              )}
                            </div>
                          ):(
                            <div
                              className={`px-2 h-full flex items-center text-xs overflow-hidden whitespace-nowrap
                                ${type==="currency"?"text-primary font-medium":""}
                                ${type==="number"?"justify-end":""}
                              `}
                              style={{
                                fontWeight:cs?.bold?"bold":"normal",
                                color:cs?.color,
                                justifyContent:cs?.align==="center"?"center":cs?.align==="right"?"flex-end":undefined,
                              }}
                            >
                              {dispCell(raw,type)||<span className="text-transparent select-none">·</span>}
                            </div>
                          )}

                          {/* ✅ Drag fill handle */}
                          {isSel&&!isEd&&(
                            <div
                              className="absolute bottom-0 right-0 w-2.5 h-2.5 bg-[#1a73e8] border border-white cursor-crosshair z-20"
                              style={{transform:"translate(50%,50%)"}}
                              title="Drag to fill"
                              onMouseDown={e=>{
                                e.preventDefault();e.stopPropagation();
                                ctrlDrag.current=e.ctrlKey||e.metaKey;
                                isDragging.current=true;
                                dragAnchorIdxRef.current=rowsRef.current.findIndex(x=>x.id===r.id);
                                setDragAnchor({rowId:r.id,colName:col.name});
                                setDragEnd({rowId:r.id,colName:col.name});
                              }}
                            />
                          )}
                        </td>
                      );
                    })}
                    <td className="border border-[#d0d0d0] dark:border-border bg-transparent"/>
                  </tr>
                ))}

                {/* Totals */}
                {rows.length>0&&Object.keys(totals).length>0&&(
                  <tr>
                    <td className="bg-[#f2f2f2] dark:bg-muted/60 border border-[#d0d0d0] dark:border-border text-center text-xs text-muted-foreground font-mono h-8 sticky left-0">Σ</td>
                    {columns.map((col,i)=>{
                      const total=totals[col.name];const type=col.type as ColumnType;
                      return (
                        <td key={col.id} className="bg-[#f7f7f7] dark:bg-muted/40 border border-[#d0d0d0] dark:border-border px-2 h-8 text-xs font-semibold">
                          {total!=null?<span className={type==="currency"?"text-primary":""}>{type==="currency"?`₹${total.toLocaleString("en-IN")}`:total.toLocaleString("en-IN")}</span>:(i===0?<span className="text-muted-foreground text-xs">Total</span>:"")}
                        </td>
                      );
                    })}
                    <td className="border border-[#d0d0d0] dark:border-border bg-[#f7f7f7]"/>
                  </tr>
                )}

                {/* Add row button */}
                <tr>
                  <td colSpan={columns.length+2}>
                    <button className="w-full h-8 text-xs text-muted-foreground hover:text-foreground hover:bg-muted/20 transition-colors flex items-center justify-center gap-1 border-t border-[#d0d0d0] dark:border-border" onClick={addRow}>
                      <Plus className="w-3.5 h-3.5"/>Add Row
                    </button>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        )}

        {/* Status Bar */}
        <div className="flex items-center justify-between px-4 py-1 border-t border-border bg-[#f0f0f0] dark:bg-muted/30 text-xs text-muted-foreground shrink-0">
          <span>{filtered.length} row{filtered.length!==1?"s":""} · {columns.length} col{columns.length!==1?"s":""}</span>
          {isDragging.current&&dragAnchor&&<span className="text-[#1a73e8] font-medium">{ctrlDrag.current?"Copy mode (Ctrl)":"Series fill"} ↓</span>}
          {editCell&&<span className="font-mono">{activeCellLabel}</span>}
          <span className="font-medium">{selTable?.name??""}</span>
        </div>
      </div>
    </>
  );
}
