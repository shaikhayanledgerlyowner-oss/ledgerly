import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Plus, Table2, Trash2, Edit3, Search, SortAsc, SortDesc,
  MoreHorizontal, X, Calculator, Download, FileSpreadsheet,
  AlignLeft, AlignCenter, AlignRight, Palette, RefreshCw, ChevronDown, Calendar, Hash, DollarSign, Type,
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
interface CellStyle { bg?:string; color?:string; bold?:boolean; align?:"left"|"center"|"right"; }
type StyleMap = Record<string,CellStyle>;

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

// ✅ THE REAL FIX: fillSeries uses refs so no stale closure
function fillSeries(anchorVal:any, type:ColumnType, step:number, isCopy:boolean):any {
  if(isCopy) return anchorVal;
  if(type==="number"||type==="currency"){
    const n=toNum(anchorVal);
    return n+step; // step=1,2,3... so 9+1=10, 9+2=11 etc
  }
  if(type==="date"&&anchorVal){
    const d=new Date(String(anchorVal)+"T00:00:00");
    if(!isNaN(d.getTime())){ d.setDate(d.getDate()+step); return d.toISOString().slice(0,10); }
  }
  return anchorVal;
}

const CELL_COLORS=["#ffffff","#fef9c3","#dcfce7","#dbeafe","#fce7f3","#fee2e2","#e0e7ff","#f3f4f6","#ffd700","#ff8c00","#ff6b6b","#22c55e","#3b82f6","#a855f7","#000000"];
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

export default function TablesPage(){
  const {profile,hasAccess}=useAuth();
  const uid=profile?.id;

  const [tables,setTables]=useState<DbTable[]>([]);
  const [selTable,setSelTable]=useState<DbTable|null>(null);
  const [columns,setColumns]=useState<DbColumn[]>([]);
  const [rows,setRows]=useState<DbRow[]>([]);
  const [styleMap,setStyleMap]=useState<StyleMap>({});

  // ── selection: Set of "rowId__colName" keys ──
  const [selectedCells,setSelectedCells]=useState<Set<string>>(new Set());
  const [isSelecting,setIsSelecting]=useState(false);
  const selStartRef=useRef<{rowId:string;colName:string}|null>(null);

  const [search,setSearch]=useState("");
  const [sortCol,setSortCol]=useState<string|null>(null);
  const [sortDir,setSortDir]=useState<"asc"|"desc">("asc");

  const [editCell,setEditCell]=useState<{rowId:string;colName:string}|null>(null);
  const [editVal,setEditVal]=useState("");
  const [fbarVal,setFbarVal]=useState("");
  const origRef=useRef("");
  const editValRef=useRef("");
  const savingRef=useRef(false);
  const cellRefs=useRef<Record<string,HTMLInputElement|null>>({});
  const colsRef=useRef<DbColumn[]>([]);
  const rowsRef=useRef<DbRow[]>([]);

  const [acSugg,setAcSugg]=useState("");

  // ── drag fill — ALL in refs, NO state dependency in handler ──
  const dragAnchorRef=useRef<{rowId:string;colName:string;anchorIdx:number}|null>(null);
  const dragEndRowIdRef=useRef<string|null>(null);
  const ctrlDragRef=useRef(false);
  const isDragging=useRef(false);
  // for visual highlight only
  const [dragHighlight,setDragHighlight]=useState<Set<string>>(new Set());

  const [renamingColId,setRenamingColId]=useState<string|null>(null);
  const [renamingColVal,setRenamingColVal]=useState("");
  const [renamingColType,setRenamingColType]=useState<ColumnType>("text");

  const [delTarget,setDelTarget]=useState<DbTable|null>(null);
  const [delOpen,setDelOpen]=useState(false);
  const [countOpen,setCountOpen]=useState(false);
  const [countConds,setCountConds]=useState<{col:string;crit:string}[]>([{col:"",crit:""}]);
  const [countResult,setCountResult]=useState<number|null>(null);
  const [newTableName,setNewTableName]=useState("");
  const [addingTable,setAddingTable]=useState(false);
  const [showBgPicker,setShowBgPicker]=useState(false);
  const [showTextPicker,setShowTextPicker]=useState(false);
  const [ctx,setCtx]=useState<CtxMenu|null>(null);

  useEffect(()=>{editValRef.current=editVal;},[editVal]);
  useEffect(()=>{colsRef.current=columns;},[columns]);
  const cellKey=(r:string,c:string)=>`${r}__${c}`;
  const focusCell=(rid:string,cn:string)=>setTimeout(()=>{const el=cellRefs.current[cellKey(rid,cn)];if(el){el.focus();try{el.select();}catch{}}},30);

  // ── Load ──
  const loadTables=async()=>{
    if(!uid) return;
    const {data}=await supabase.from("user_tables").select("*").eq("user_id",uid).order("created_at",{ascending:true});
    const list=(data??[]) as DbTable[];
    setTables(list);
    setSelTable(prev=>{if(prev){const f=list.find(t=>t.id===prev.id);return f??list[0]??null;}return list[0]??null;});
  };
  const loadData=async(tid:string)=>{
    const [cr,rr]=await Promise.all([
      supabase.from("user_columns").select("*").eq("table_id",tid).order("created_at",{ascending:true}),
      supabase.from("user_rows").select("*").eq("table_id",tid).order("created_at",{ascending:true}),
    ]);
    setColumns((cr.data??[]) as DbColumn[]);
    setRows(((rr.data??[]) as any[]).map(r=>({...r,row_data:r.row_data??{}})));
    const {data:meta}=await supabase.from("user_tables").select("*").eq("id",tid).single();
    if((meta as any)?.style_map){try{setStyleMap(JSON.parse((meta as any).style_map));}catch{}}else setStyleMap({});
  };
  useEffect(()=>{loadTables();},[uid]);
  useEffect(()=>{if(selTable)loadData(selTable.id);else{setColumns([]);setRows([]);setStyleMap({});}},[selTable?.id]);

  const saveStyles=async(map:StyleMap)=>{
    if(!selTable) return;
    await supabase.from("user_tables").update({style_map:JSON.stringify(map)} as any).eq("id",selTable.id);
  };

  // Apply style to ALL selected cells (or single if nothing selected)
  const applyStyleToSelected=(patch:Partial<CellStyle>)=>{
    if(selectedCells.size===0) return;
    setStyleMap(prev=>{
      const next={...prev};
      selectedCells.forEach(key=>{next[key]={...(next[key]??{}),...patch};});
      saveStyles(next);
      return next;
    });
  };

  // ── Table CRUD ──
  const createTable=async()=>{
    if(!uid||!newTableName.trim()) return;
    const {data,error}=await supabase.from("user_tables").insert({user_id:uid,name:newTableName.trim()}).select("*").single();
    if(error) return toast.error(error.message);
    setNewTableName("");setAddingTable(false);await loadTables();setSelTable(data as DbTable);toast.success("Sheet created");
  };
  const deleteTable=async(tid:string)=>{
    await supabase.from("user_rows").delete().eq("table_id",tid);
    await supabase.from("user_columns").delete().eq("table_id",tid);
    await supabase.from("user_tables").delete().eq("id",tid);
    toast.success("Deleted");await loadTables();
  };
  const renameTable=async(t:DbTable)=>{
    const n=prompt("Rename:",t.name);if(!n?.trim()) return;
    await supabase.from("user_tables").update({name:n.trim()}).eq("id",t.id);await loadTables();
  };

  // ── Column CRUD ──
  const addColumn=async()=>{
    if(!selTable) return;
    const name=`Column ${columns.length+1}`;
    await supabase.from("user_columns").insert({table_id:selTable.id,name,type:"text"});
    if(rows.length>0) await Promise.all(rows.map(r=>supabase.from("user_rows").update({row_data:{...r.row_data,[name]:""}}).eq("id",r.id)));
    await loadData(selTable.id);
    setTimeout(()=>{const nc=colsRef.current[colsRef.current.length-1];if(nc){setRenamingColId(nc.id);setRenamingColVal(nc.name);setRenamingColType("text");}},80);
  };
  const deleteColumn=async(col:DbColumn)=>{
    await supabase.from("user_columns").delete().eq("id",col.id);
    if(rows.length>0) await Promise.all(rows.map(r=>{const rd={...r.row_data};delete rd[col.name];return supabase.from("user_rows").update({row_data:rd}).eq("id",r.id);}));
    await loadData(selTable!.id);
  };
  const updateColumn=async(col:DbColumn,newName:string,newType:ColumnType)=>{
    if(!newName.trim()) return;
    const old=col.name;
    await supabase.from("user_columns").update({name:newName.trim(),type:newType}).eq("id",col.id);
    if(rows.length>0&&old!==newName.trim()) await Promise.all(rows.map(r=>{const rd={...r.row_data};rd[newName.trim()]=rd[old];delete rd[old];return supabase.from("user_rows").update({row_data:rd}).eq("id",r.id);}));
    setRenamingColId(null);if(selTable) await loadData(selTable.id);
  };

  // ── Row CRUD ──
  const addRow=async()=>{
    if(!selTable||columns.length===0) return;
    const empty:Record<string,any>={};columns.forEach(c=>(empty[c.name]=""));
    const {error}=await supabase.from("user_rows").insert({table_id:selTable.id,row_data:empty});
    if(error) return toast.error(error.message);
    await loadData(selTable.id);
    setTimeout(()=>{const nr=rowsRef.current[rowsRef.current.length-1];if(nr&&colsRef.current[0])startEditAndFocus(nr.id,colsRef.current[0].name);},80);
  };
  const deleteRow=async(rowId:string)=>{
    await supabase.from("user_rows").delete().eq("id",rowId);
    setRows(prev=>prev.filter(r=>r.id!==rowId));
  };

  // ── Autocomplete ──
  const getAutoSugg=(colName:string,typed:string,curRowId:string):string=>{
    if(!typed) return "";
    const q=typed.toLowerCase();
    for(const r of rowsRef.current){
      if(r.id===curRowId) continue;
      const v=String(r.row_data[colName]??"");
      if(v&&v.toLowerCase().startsWith(q)&&v.toLowerCase()!==q) return v;
    }
    return "";
  };

  // ── Cell editing ──
  const startEdit=(rowId:string,colName:string)=>{
    const col=colsRef.current.find(c=>c.name===colName);
    const type=(col?.type as ColumnType)??"text";
    const row=rowsRef.current.find(r=>r.id===rowId);
    const raw=(row?.row_data??{})[colName];
    const sv=raw==null?"":String(raw);
    origRef.current=sv;
    setEditCell({rowId,colName});
    setEditVal(sv);
    setFbarVal(type==="date"?toDMY(sv):sv);
    setSelectedCells(new Set([cellKey(rowId,colName)]));
    setAcSugg("");
  };
  const startEditAndFocus=(r:string,c:string)=>{startEdit(r,c);focusCell(r,c);};

  const saveCellNow=async(rowId:string,colName:string,val:string)=>{
    if(savingRef.current) return;
    savingRef.current=true;
    const col=colsRef.current.find(c=>c.name===colName);
    const type=(col?.type as ColumnType)??"text";
    let value:any=val;
    if(type==="number"||type==="currency") value=val===""?"":toNum(val);
    setRows(prev=>prev.map(r=>r.id!==rowId?r:{...r,row_data:{...r.row_data,[colName]:value}}));
    const row=rowsRef.current.find(r=>r.id===rowId);
    await supabase.from("user_rows").update({row_data:{...(row?.row_data??{}),[colName]:value}}).eq("id",rowId);
    savingRef.current=false;
  };

  const filtered=useMemo(()=>{
    let list=[...rows];
    if(search.trim()){const q=search.toLowerCase();list=list.filter(r=>Object.values(r.row_data).some(v=>String(v??"").toLowerCase().includes(q)));}
    if(sortCol){
      const col=columns.find(c=>c.name===sortCol);const type=(col?.type as ColumnType)??"text";
      list.sort((a,b)=>{
        const av=a.row_data[sortCol]??"",bv=b.row_data[sortCol]??"";
        if(type==="number"||type==="currency") return sortDir==="asc"?toNum(av)-toNum(bv):toNum(bv)-toNum(av);
        return sortDir==="asc"?String(av).localeCompare(String(bv)):String(bv).localeCompare(String(av));
      });
    }
    return list;
  },[rows,search,sortCol,sortDir,columns]);
  useEffect(()=>{rowsRef.current=filtered;},[filtered]);

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

  const totals=useMemo(()=>{
    const t:Record<string,number>={};
    columns.forEach(c=>{if(c.type==="number"||c.type==="currency") t[c.name]=rows.reduce((s,r)=>s+toNum(r.row_data[c.name]),0);});
    return t;
  },[columns,rows]);

  // ── SELECT COLUMN ──
  const selectColumn=(colName:string)=>{
    setEditCell(null);
    const s=new Set<string>();
    rowsRef.current.forEach(r=>s.add(cellKey(r.id,colName)));
    setSelectedCells(s);
    toast(`Column selected — ${s.size} cells`,{duration:1500});
  };

  // ── MULTI-CELL RANGE SELECTION via mouse drag ──
  const onCellMouseDown=(rowId:string,colName:string,e:React.MouseEvent)=>{
    if(e.button!==0) return;
    setIsSelecting(true);
    selStartRef.current={rowId,colName};
    setSelectedCells(new Set([cellKey(rowId,colName)]));
  };
  const onCellMouseEnter=(rowId:string,colName:string)=>{
    if(!isSelecting||!selStartRef.current) return;
    if(isDragging.current){
      // drag fill takes priority
      if(dragAnchorRef.current&&dragAnchorRef.current.colName===colName){
        dragEndRowIdRef.current=rowId;
        // update highlight
        const ai=dragAnchorRef.current.anchorIdx;
        const ei=rowsRef.current.findIndex(r=>r.id===rowId);
        const hs=new Set<string>();
        if(ai>=0&&ei>=0){const from=Math.min(ai,ei),to=Math.max(ai,ei);for(let i=from;i<=to;i++)hs.add(rowsRef.current[i]?.id??"");}
        setDragHighlight(hs);
      }
      return;
    }
    // range select
    const list=rowsRef.current;const cols=colsRef.current;
    const r0=list.findIndex(r=>r.id===selStartRef.current!.rowId);
    const r1=list.findIndex(r=>r.id===rowId);
    const c0=cols.findIndex(c=>c.name===selStartRef.current!.colName);
    const c1=cols.findIndex(c=>c.name===colName);
    const rMin=Math.min(r0,r1),rMax=Math.max(r0,r1);
    const cMin=Math.min(c0,c1),cMax=Math.max(c0,c1);
    const s=new Set<string>();
    for(let ri=rMin;ri<=rMax;ri++) for(let ci=cMin;ci<=cMax;ci++){
      const row=list[ri],col2=cols[ci];if(row&&col2)s.add(cellKey(row.id,col2.name));
    }
    setSelectedCells(s);
  };

  // ── DRAG FILL: all logic in refs, applied on mouseup ──
  // mouseup is on window so it always fires
  useEffect(()=>{
    const handleUp=async()=>{
      setIsSelecting(false);
      if(!isDragging.current) return;
      isDragging.current=false;
      // read everything from refs — no stale state!
      const anchor=dragAnchorRef.current;
      const endRowId=dragEndRowIdRef.current;
      if(!anchor||!endRowId) return;
      const list=rowsRef.current;
      const ai=anchor.anchorIdx;
      const ei=list.findIndex(r=>r.id===endRowId);
      if(ai<0||ei<0||ai===ei){setDragHighlight(new Set());dragAnchorRef.current=null;dragEndRowIdRef.current=null;return;}
      const col=colsRef.current.find(c=>c.name===anchor.colName);
      const type=(col?.type as ColumnType)??"text";
      const anchorRow=list[ai];
      const anchorVal=(anchorRow?.row_data??{})[anchor.colName];
      const isCopy=ctrlDragRef.current;
      const from=Math.min(ai,ei),to=Math.max(ai,ei);
      for(let i=from;i<=to;i++){
        if(i===ai) continue;
        const targetRow=list[i];if(!targetRow) continue;
        const step=i-ai; // 1,2,3 going down; -1,-2,-3 going up
        const newVal=fillSeries(anchorVal,type,step,isCopy);
        setRows(prev=>prev.map(r=>r.id!==targetRow.id?r:{...r,row_data:{...r.row_data,[anchor.colName]:newVal}}));
        const fresh=rowsRef.current.find(r=>r.id===targetRow.id);
        await supabase.from("user_rows").update({row_data:{...(fresh?.row_data??targetRow.row_data),[anchor.colName]:newVal}}).eq("id",targetRow.id);
      }
      toast.success(isCopy?"Copied!":(type==="text"?"Copied!":"Series filled!"));
      setDragHighlight(new Set());
      dragAnchorRef.current=null;dragEndRowIdRef.current=null;
    };
    window.addEventListener("mouseup",handleUp);
    return()=>window.removeEventListener("mouseup",handleUp);
  },[]); // ✅ empty deps — never stale, reads from refs

  const openCtx=(e:React.MouseEvent,rowId?:string,colId?:string,colName?:string)=>{e.preventDefault();e.stopPropagation();setCtx({x:e.clientX,y:e.clientY,rowId,colId,colName});};
  useEffect(()=>{const close=()=>setCtx(null);window.addEventListener("click",close);return()=>window.removeEventListener("click",close);},[]);

  const doCount=()=>{
    const active=countConds.filter(c=>c.col&&c.crit);
    if(!active.length) return toast.error("Add at least 1 condition");
    const n=rows.filter(r=>active.every(cond=>String(r.row_data[cond.col]??"").toLowerCase().includes(cond.crit.toLowerCase()))).length;
    setCountResult(n);toast.success(`Found ${n} rows`);
  };

  const dlPDF=()=>{
    if(!hasAccess) return toast.error("Upgrade to download");
    if(!selTable||!columns.length) return;
    const doc=new jsPDF({orientation:"l",unit:"pt",format:"a4"});
    doc.setFont("helvetica","bold");doc.setFontSize(16);doc.text(selTable.name,40,45);
    doc.setFont("helvetica","normal");doc.setFontSize(10);doc.text(`Exported: ${new Date().toLocaleString()}`,40,62);
    const head=[columns.map(c=>c.name)];
    const body=filtered.map(r=>columns.map(c=>{
      const v=r.row_data[c.name];const type=c.type as ColumnType;
      if(type==="currency") return `Rs. ${toNum(v).toLocaleString("en-IN",{minimumFractionDigits:2})}`;
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
    const data=filtered.map(r=>columns.map(c=>{
      const v=r.row_data[c.name];const type=c.type as ColumnType;
      if(type==="number"||type==="currency") return v===""||v==null?"":toNum(v);
      if(type==="date") return toDMY(String(v??""));
      return v==null?"":String(v);
    }));
    if(Object.keys(totals).length) data.push(columns.map((c,i)=>{const t=totals[c.name];return t!=null?t:(i===0?"Total":"")}) as any);
    const ws=XLSX.utils.aoa_to_sheet([header,...data]);
    // apply colors
    const range=XLSX.utils.decode_range(ws["!ref"]||"A1");
    for(let ri=0;ri<=range.e.r;ri++) for(let ci=0;ci<=range.e.c;ci++){
      const addr=XLSX.utils.encode_cell({r:ri,c:ci});
      if(!ws[addr]) continue;
      const rowObj=ri===0?null:filtered[ri-1];const colObj=columns[ci];
      const sk=rowObj&&colObj?cellKey(rowObj.id,colObj.name):"";
      const cs=sk?styleMap[sk]:undefined;const isH=ri===0;
      ws[addr].s={
        fill:{patternType:"solid",fgColor:{rgb:isH?"1e1e1e":(cs?.bg?cs.bg.replace("#",""):"FFFFFF")}},
        font:{bold:isH||(cs?.bold??false),color:{rgb:isH?"FFFFFF":(cs?.color?cs.color.replace("#",""):"000000")}},
        alignment:{horizontal:cs?.align??"left",vertical:"center"},
        border:{top:{style:"thin",color:{rgb:"D1D5DB"}},bottom:{style:"thin",color:{rgb:"D1D5DB"}},left:{style:"thin",color:{rgb:"D1D5DB"}},right:{style:"thin",color:{rgb:"D1D5DB"}}},
      };
    }
    (ws as any)["!cols"]=header.map((_,i)=>({wch:Math.min(Math.max(...[header[i].length,...data.map(row=>String(row[i]??"").length)])+2,40)}));
    const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,ws,"Sheet1");
    saveAs(new Blob([XLSX.write(wb,{bookType:"xlsx",type:"array",cellStyles:true})],{type:"application/octet-stream"}),`${safeFile(selTable.name)}.xlsx`);
    toast.success("Excel downloaded");
  };

  const activeCellLabel=useMemo(()=>{
    if(selectedCells.size!==1) return selectedCells.size>1?`${selectedCells.size} cells`:"";
    const key=[...selectedCells][0];
    const [rid,cn]=key.split("__");
    const ci=columns.findIndex(c=>c.name===cn);
    const ri=rowsRef.current.findIndex(r=>r.id===rid);
    return `${colLetter(ci)}${ri+1}`;
  },[selectedCells,columns]);

  // first selected cell style (for toolbar display)
  const firstSelStyle=useMemo(()=>{
    const first=[...selectedCells][0];
    return first?(styleMap[first]??{} as CellStyle):{} as CellStyle;
  },[selectedCells,styleMap]);

  return (
    <>
      <AlertDialog open={delOpen} onOpenChange={setDelOpen}>
        <AlertDialogContent>
          <AlertDialogHeader><AlertDialogTitle>Delete "{delTarget?.name}"?</AlertDialogTitle><AlertDialogDescription>All data will be permanently deleted.</AlertDialogDescription></AlertDialogHeader>
          <AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction onClick={async()=>{if(delTarget){await deleteTable(delTarget.id);setDelOpen(false);setDelTarget(null);}}}>Delete</AlertDialogAction></AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {ctx&&(
        <div className="fixed z-50 bg-card border border-border rounded-lg shadow-xl py-1 min-w-[180px] text-sm" style={{top:ctx.y,left:ctx.x}} onClick={e=>e.stopPropagation()}>
          {ctx.rowId&&<><button className="w-full px-4 py-2 text-left hover:bg-muted flex items-center gap-2" onClick={()=>{addRow();setCtx(null);}}><Plus className="w-3.5 h-3.5"/>Insert Row Below</button><button className="w-full px-4 py-2 text-left hover:bg-muted text-destructive flex items-center gap-2" onClick={()=>{deleteRow(ctx.rowId!);setCtx(null);}}><Trash2 className="w-3.5 h-3.5"/>Delete Row</button><div className="border-t my-1"/></>}
          {ctx.colId&&<><button className="w-full px-4 py-2 text-left hover:bg-muted flex items-center gap-2" onClick={()=>{addColumn();setCtx(null);}}><Plus className="w-3.5 h-3.5"/>Insert Column</button><button className="w-full px-4 py-2 text-left hover:bg-muted text-destructive flex items-center gap-2" onClick={()=>{const col=columns.find(c=>c.id===ctx.colId);if(col)deleteColumn(col);setCtx(null);}}><Trash2 className="w-3.5 h-3.5"/>Delete Column</button></>}
          {!ctx.rowId&&!ctx.colId&&<><button className="w-full px-4 py-2 text-left hover:bg-muted flex items-center gap-2" onClick={()=>{addRow();setCtx(null);}}><Plus className="w-3.5 h-3.5"/>Add Row</button><button className="w-full px-4 py-2 text-left hover:bg-muted flex items-center gap-2" onClick={()=>{addColumn();setCtx(null);}}><Plus className="w-3.5 h-3.5"/>Add Column</button></>}
        </div>
      )}

      <div className="flex flex-col h-[calc(100vh-4rem)] -m-4 md:-m-6 lg:-m-8 overflow-hidden">

        {/* ══ TOOLBAR ════════════════════════════════════════════════════════ */}
        <div className="flex items-center gap-0.5 px-2 py-1.5 border-b border-border bg-[#f8f8f8] dark:bg-muted/40 shrink-0 flex-wrap">
          <div className="relative mr-1">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none"/>
            <Input className="h-7 pl-7 w-32 text-xs bg-white dark:bg-background" placeholder="Search..." value={search} onChange={e=>setSearch(e.target.value)}/>
          </div>
          <div className="w-px h-6 bg-border mx-0.5"/>

          {/* Bold */}
          <button title="Bold (Ctrl+B)" onClick={()=>applyStyleToSelected({bold:!firstSelStyle.bold})}
            className={`w-7 h-7 flex items-center justify-center rounded text-sm font-bold border hover:bg-white transition-colors ${firstSelStyle.bold?"bg-blue-100 border-blue-400 text-blue-700":"border-transparent text-gray-700"}`}>B</button>

          {/* Italic style marker — just visual, same as bold for now */}
          <button title="Italic" onClick={()=>{}}
            className="w-7 h-7 flex items-center justify-center rounded text-sm italic border border-transparent text-gray-500 hover:bg-white transition-colors opacity-40 cursor-not-allowed">I</button>

          <div className="w-px h-6 bg-border mx-0.5"/>

          {/* Align buttons */}
          {(["left","center","right"] as const).map(a=>(
            <button key={a} title={`Align ${a}`} onClick={()=>applyStyleToSelected({align:a})}
              className={`w-7 h-7 flex items-center justify-center rounded border hover:bg-white transition-colors ${firstSelStyle.align===a?"bg-blue-100 border-blue-400":"border-transparent"}`}>
              {a==="left"?<AlignLeft className="w-3.5 h-3.5"/>:a==="center"?<AlignCenter className="w-3.5 h-3.5"/>:<AlignRight className="w-3.5 h-3.5"/>}
            </button>
          ))}

          <div className="w-px h-6 bg-border mx-0.5"/>

          {/* BG Color */}
          <Popover open={showBgPicker} onOpenChange={setShowBgPicker}>
            <PopoverTrigger asChild>
              <button title="Fill color" className="w-7 h-7 flex flex-col items-center justify-center gap-0.5 rounded border border-transparent hover:bg-white hover:border-gray-300 transition-colors">
                <Palette className="w-3.5 h-3.5 text-gray-600"/>
                <div className="w-4 h-1 rounded-sm" style={{background:firstSelStyle.bg??"transparent",border:"1px solid #ccc"}}/>
              </button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-2" align="start">
              <p className="text-xs font-semibold mb-2 text-gray-600">Cell Color</p>
              <div className="grid grid-cols-5 gap-1 mb-1">
                {CELL_COLORS.map(c=>(
                  <button key={c} onClick={()=>{applyStyleToSelected({bg:c});setShowBgPicker(false);}}
                    className={`w-6 h-6 rounded border-2 transition-all hover:scale-110 ${firstSelStyle.bg===c?"border-blue-500":"border-gray-200"}`}
                    style={{background:c}}/>
                ))}
              </div>
              <button className="w-full text-xs text-center py-1 rounded hover:bg-gray-100 text-gray-500 border border-dashed border-gray-300 mt-1" onClick={()=>{applyStyleToSelected({bg:undefined});setShowBgPicker(false);}}>Clear color</button>
            </PopoverContent>
          </Popover>

          {/* Text Color */}
          <Popover open={showTextPicker} onOpenChange={setShowTextPicker}>
            <PopoverTrigger asChild>
              <button title="Text color" className="w-7 h-7 flex flex-col items-center justify-center gap-0.5 rounded border border-transparent hover:bg-white hover:border-gray-300 transition-colors">
                <span className="text-sm font-bold leading-none" style={{color:firstSelStyle.color??"#333"}}>A</span>
                <div className="w-4 h-1 rounded-sm" style={{background:firstSelStyle.color??"#333",border:"1px solid #ccc"}}/>
              </button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-2" align="start">
              <p className="text-xs font-semibold mb-2 text-gray-600">Text Color</p>
              <div className="grid grid-cols-5 gap-1 mb-1">
                {TEXT_COLORS.map(c=>(
                  <button key={c} onClick={()=>{applyStyleToSelected({color:c});setShowTextPicker(false);}}
                    className={`w-6 h-6 rounded border-2 transition-all hover:scale-110 ${firstSelStyle.color===c?"border-blue-500":"border-gray-200"}`}
                    style={{background:c}}/>
                ))}
              </div>
              <button className="w-full text-xs text-center py-1 rounded hover:bg-gray-100 text-gray-500 border border-dashed border-gray-300 mt-1" onClick={()=>{applyStyleToSelected({color:undefined});setShowTextPicker(false);}}>Clear color</button>
            </PopoverContent>
          </Popover>

          <div className="w-px h-6 bg-border mx-0.5"/>

          <Button variant="ghost" size="sm" className="h-7 px-2 text-xs gap-1" onClick={addRow} disabled={!selTable||columns.length===0}><Plus className="w-3 h-3"/>Row</Button>
          <Button variant="ghost" size="sm" className="h-7 px-2 text-xs gap-1" onClick={addColumn} disabled={!selTable}><Plus className="w-3 h-3"/>Col</Button>
          {sortCol&&<Button variant="ghost" size="sm" className="h-7 px-2 text-xs gap-1 text-orange-500" onClick={()=>setSortCol(null)}><RefreshCw className="w-3 h-3"/>Clear Sort</Button>}

          <div className="w-px h-6 bg-border mx-0.5"/>

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
          <div className="w-px h-6 bg-border mx-0.5"/>
          <Button variant="ghost" size="sm" className="h-7 px-2 text-xs gap-1" onClick={dlPDF} disabled={!hasAccess}><Download className="w-3.5 h-3.5"/>PDF</Button>
          <Button variant="ghost" size="sm" className="h-7 px-2 text-xs gap-1" onClick={dlExcel} disabled={!hasAccess}><FileSpreadsheet className="w-3.5 h-3.5"/>Excel</Button>
        </div>

        {/* ══ FORMULA BAR ══════════════════════════════════════════════════ */}
        <div className="flex items-center gap-2 px-3 py-1 border-b border-border bg-white dark:bg-card shrink-0">
          <div className="flex items-center justify-center min-w-[56px] h-6 border border-border rounded text-xs font-mono text-muted-foreground bg-muted/30 px-1">{activeCellLabel||"—"}</div>
          <div className="w-px h-4 bg-border"/>
          <Input
            className="h-6 text-xs font-mono border-0 bg-transparent focus-visible:ring-0 focus-visible:ring-offset-0 p-0 flex-1"
            placeholder="Click a cell..."
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

        {/* ══ SHEET TABS ═══════════════════════════════════════════════════ */}
        <div className="flex items-center gap-0 border-b border-border bg-[#f0f0f0] dark:bg-muted/30 px-2 pt-1 overflow-x-auto shrink-0">
          {tables.map(t=>(
            <div key={t.id} className="relative group flex items-center shrink-0">
              <button onClick={()=>setSelTable(t)} className={`px-4 py-1.5 text-xs rounded-t border border-b-0 transition-all whitespace-nowrap ${selTable?.id===t.id?"bg-white dark:bg-background border-border font-medium":"border-transparent text-muted-foreground hover:bg-white/50"}`}>{t.name}</button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild><button className="p-0.5 rounded opacity-0 group-hover:opacity-100 text-muted-foreground"><MoreHorizontal className="w-3 h-3"/></button></DropdownMenuTrigger>
                <DropdownMenuContent><DropdownMenuItem onClick={()=>renameTable(t)}><Edit3 className="w-4 h-4 mr-2"/>Rename</DropdownMenuItem><DropdownMenuSeparator/><DropdownMenuItem className="text-destructive" onClick={()=>{setDelTarget(t);setDelOpen(true);}}><Trash2 className="w-4 h-4 mr-2"/>Delete</DropdownMenuItem></DropdownMenuContent>
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
            <button onClick={()=>setAddingTable(true)} className="p-1 ml-1 rounded hover:bg-white/70 text-muted-foreground" title="New sheet"><Plus className="w-3.5 h-3.5"/></button>
          )}
        </div>

        {/* ══ GRID ══════════════════════════════════════════════════════════ */}
        {!selTable?(
          <div className="flex-1 flex items-center justify-center"><div className="text-center"><Table2 className="w-16 h-16 mx-auto mb-4 text-muted-foreground/30"/><h3 className="text-lg font-semibold mb-2">No sheets yet</h3><Button onClick={()=>setAddingTable(true)} className="gap-2 mt-2"><Plus className="w-4 h-4"/>New Sheet</Button></div></div>
        ):columns.length===0?(
          <div className="flex-1 flex items-center justify-center" onContextMenu={e=>openCtx(e)}><div className="text-center"><Table2 className="w-12 h-12 mx-auto mb-3 text-muted-foreground/30"/><h3 className="font-semibold mb-1">Empty Sheet</h3><Button onClick={addColumn} className="gap-2 mt-2"><Plus className="w-4 h-4"/>Add Column</Button></div></div>
        ):(
          <div className="flex-1 overflow-auto bg-white dark:bg-background select-none" onContextMenu={e=>openCtx(e)}>
            <table className="border-collapse text-sm min-w-full" style={{tableLayout:"fixed"}}>
              <colgroup>
                <col style={{width:"44px"}}/>
                {columns.map((_,i)=><col key={i} style={{width:"150px"}}/>)}
                <col style={{width:"36px"}}/>
              </colgroup>
              <thead className="sticky top-0 z-20">
                <tr>
                  {/* top-left corner — click to select all */}
                  <th className="bg-[#f2f2f2] dark:bg-muted border border-[#d0d0d0] dark:border-border h-8 select-none sticky left-0 z-30 cursor-pointer hover:bg-[#e0e0e0]"
                    title="Select all" onClick={()=>{const s=new Set<string>();rowsRef.current.forEach(r=>colsRef.current.forEach(c=>s.add(cellKey(r.id,c.name))));setSelectedCells(s);toast(`All ${s.size} cells selected`,{duration:1200});}}>
                    <div className="w-full h-full flex items-center justify-center text-muted-foreground/30 text-xs">⊞</div>
                  </th>
                  {columns.map((col,ci)=>{
                    const type=(col.type as ColumnType)??"text";
                    // check if whole column is selected
                    const colSelected=rowsRef.current.length>0&&rowsRef.current.every(r=>selectedCells.has(cellKey(r.id,col.name)));
                    return (
                      <th key={col.id}
                        className={`border border-[#d0d0d0] dark:border-border h-8 text-xs font-medium select-none relative group cursor-pointer transition-colors ${colSelected?"bg-[#cce0ff] dark:bg-blue-900/40":"bg-[#f2f2f2] dark:bg-muted hover:bg-[#e8e8e8]"}`}
                        onContextMenu={e=>openCtx(e,undefined,col.id,col.name)}
                        onClick={e=>{
                          // single click on header = select column (unless renaming)
                          if(renamingColId!==col.id) selectColumn(col.name);
                        }}
                        onDoubleClick={()=>{setRenamingColId(col.id);setRenamingColVal(col.name);setRenamingColType(type);}}
                      >
                        {renamingColId===col.id?(
                          <div className="flex items-center gap-1 px-1" onClick={e=>e.stopPropagation()}>
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
                          <div className="flex items-center justify-between px-2 h-full pointer-events-none">
                            <div className="flex items-center gap-1.5 overflow-hidden">
                              <span className="text-muted-foreground/40 shrink-0">{TYPE_ICONS[type]}</span>
                              <span className="truncate">{col.name}</span>
                            </div>
                            <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 shrink-0 pointer-events-auto" onClick={e=>e.stopPropagation()}>
                              <button className="p-0.5 rounded hover:bg-white/60" title="Sort" onClick={e=>{e.stopPropagation();setSortCol(col.name);setSortDir(sortCol===col.name&&sortDir==="asc"?"desc":"asc");}}>
                                {sortCol===col.name?(sortDir==="asc"?<SortAsc className="w-3 h-3"/>:<SortDesc className="w-3 h-3"/>):<ChevronDown className="w-3 h-3 opacity-50"/>}
                              </button>
                            </div>
                          </div>
                        )}
                      </th>
                    );
                  })}
                  <th className="bg-[#f2f2f2] dark:bg-muted border border-[#d0d0d0] dark:border-border h-8">
                    <button className="w-full h-full flex items-center justify-center text-muted-foreground hover:bg-[#e0e0e0]" onClick={addColumn}><Plus className="w-3.5 h-3.5"/></button>
                  </th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((r,ri)=>{
                  // check if whole row selected (for row number highlight)
                  const rowSelected=columns.length>0&&columns.every(c=>selectedCells.has(cellKey(r.id,c.name)));
                  return (
                    <tr key={r.id}>
                      <td
                        className={`border border-[#d0d0d0] dark:border-border text-center text-xs text-muted-foreground select-none h-8 font-mono sticky left-0 cursor-pointer transition-colors
                          ${rowSelected?"bg-[#cce0ff] dark:bg-blue-900/40 font-bold":"bg-[#f2f2f2] dark:bg-muted/40 hover:bg-[#e8e8e8]"}`}
                        onContextMenu={e=>openCtx(e,r.id)}
                        onClick={()=>{
                          // click row number = select whole row
                          const s=new Set<string>();colsRef.current.forEach(c=>s.add(cellKey(r.id,c.name)));
                          setSelectedCells(s);toast(`Row ${ri+1} selected`,{duration:1200});
                        }}
                      >{ri+1}</td>
                      {columns.map(col=>{
                        const type=(col.type as ColumnType)??"text";
                        const isEd=editCell?.rowId===r.id&&editCell?.colName===col.name;
                        const isSel=selectedCells.has(cellKey(r.id,col.name));
                        const isDragH=dragHighlight.has(r.id)&&dragAnchorRef.current?.colName===col.name;
                        const raw=r.row_data[col.name];
                        const cs=styleMap[cellKey(r.id,col.name)];

                        return (
                          <td
                            key={col.id}
                            className={`border border-[#d0d0d0] dark:border-border h-8 p-0 relative overflow-visible cursor-cell
                              ${isEd?"outline outline-2 outline-[#1a73e8] z-10":""}
                              ${isSel&&!isEd?"bg-[#cce0ff]/60 dark:bg-blue-900/30":""}
                              ${isDragH&&!isEd?"bg-[#b3d1ff] dark:bg-blue-700/40":""}
                              ${!isSel&&!isEd&&!isDragH?"hover:bg-[#f5f5f5]":""}
                            `}
                            style={{background:cs?.bg&&!isSel&&!isDragH?cs.bg:undefined}}
                            onContextMenu={e=>openCtx(e,r.id,col.id,col.name)}
                            onMouseDown={e=>{
                              if(isDragging.current) return;
                              if(!isEd){
                                onCellMouseDown(r.id,col.name,e);
                                // double click = edit handled separately by onClick timing
                              }
                            }}
                            onMouseEnter={()=>onCellMouseEnter(r.id,col.name)}
                            onClick={()=>{if(!isEd)startEditAndFocus(r.id,col.name);}}
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
                                    setFbarVal(type==="date"?toDMY(v):v);
                                    if(type==="text") setAcSugg(getAutoSugg(col.name,v,r.id));
                                  }}
                                  onBlur={async()=>{
                                    await saveCellNow(r.id,col.name,editValRef.current);
                                    setEditCell(null);setEditVal("");setFbarVal("");setAcSugg("");
                                  }}
                                  enterKeyHint="next"
                                  onKeyDown={async e=>{
                                    if((e.key==="Tab"||e.key==="ArrowRight")&&acSugg){e.preventDefault();setEditVal(acSugg);setFbarVal(acSugg);setAcSugg("");if(e.key==="Tab") await moveCell(r.id,col.name,acSugg,"right");return;}
                                    if(e.key==="Enter"){if(acSugg){setEditVal(acSugg);await moveCell(r.id,col.name,acSugg,"down");return;}e.preventDefault();await moveCell(r.id,col.name,editVal,"down");return;}
                                    if(e.key==="Tab"){e.preventDefault();await moveCell(r.id,col.name,editVal,e.shiftKey?"left":"right");return;}
                                    if(e.key==="ArrowDown"&&type!=="date"){e.preventDefault();await moveCell(r.id,col.name,editVal,"down");return;}
                                    if(e.key==="ArrowUp"&&type!=="date"){e.preventDefault();await moveCell(r.id,col.name,editVal,"up");return;}
                                    if(e.key==="Escape"){e.preventDefault();setEditVal(origRef.current);setFbarVal(type==="date"?toDMY(origRef.current):origRef.current);setEditCell(null);setAcSugg("");return;}
                                    if(e.key==="b"&&(e.ctrlKey||e.metaKey)){e.preventDefault();applyStyleToSelected({bold:!cs?.bold});return;}
                                    if(e.key.length===1) setAcSugg("");
                                  }}
                                  className="absolute inset-0 h-full w-full border-0 rounded-none bg-background text-xs px-2 focus-visible:ring-0 focus-visible:ring-offset-0 z-10"
                                  style={{fontWeight:cs?.bold?"bold":"normal",color:cs?.color,textAlign:cs?.align??"left"}}
                                  autoFocus
                                />
                                {acSugg&&(
                                  <div className="absolute inset-0 flex items-center px-2 pointer-events-none z-0 text-xs overflow-hidden whitespace-nowrap">
                                    <span className="invisible">{editVal}</span>
                                    <span className="text-gray-400">{acSugg.slice(editVal.length)}</span>
                                  </div>
                                )}
                              </div>
                            ):(
                              <div className={`px-2 h-full flex items-center text-xs overflow-hidden whitespace-nowrap ${type==="currency"?"text-primary font-medium":""} ${type==="number"&&!cs?.align?"justify-end":""}`}
                                style={{fontWeight:cs?.bold?"bold":"normal",color:cs?.color,justifyContent:cs?.align==="center"?"center":cs?.align==="right"?"flex-end":cs?.align==="left"?"flex-start":undefined}}>
                                {dispCell(raw,type)||<span className="text-transparent">·</span>}
                              </div>
                            )}

                            {/* Drag fill handle — shown on selected cell (not editing) */}
                            {isSel&&!isEd&&(
                              <div
                                className="absolute bottom-0 right-0 w-2.5 h-2.5 bg-[#1a73e8] border-2 border-white z-20 cursor-crosshair"
                                style={{transform:"translate(50%,50%)"}}
                                title="Drag to fill (Ctrl = copy)"
                                onMouseDown={e=>{
                                  e.preventDefault();e.stopPropagation();
                                  ctrlDragRef.current=e.ctrlKey||e.metaKey;
                                  isDragging.current=true;
                                  dragAnchorRef.current={rowId:r.id,colName:col.name,anchorIdx:rowsRef.current.findIndex(x=>x.id===r.id)};
                                  dragEndRowIdRef.current=r.id;
                                  setDragHighlight(new Set([r.id]));
                                  setIsSelecting(false);
                                }}
                              />
                            )}
                          </td>
                        );
                      })}
                      <td className="border border-[#d0d0d0] dark:border-border"/>
                    </tr>
                  );
                })}

                {/* Totals row */}
                {rows.length>0&&Object.keys(totals).length>0&&(
                  <tr>
                    <td className="bg-[#f2f2f2] dark:bg-muted/60 border border-[#d0d0d0] text-center text-xs text-muted-foreground font-mono h-8 sticky left-0">Σ</td>
                    {columns.map((col,i)=>{const t=totals[col.name];const type=col.type as ColumnType;return(
                      <td key={col.id} className="bg-[#f7f7f7] dark:bg-muted/40 border border-[#d0d0d0] dark:border-border px-2 h-8 text-xs font-semibold">
                        {t!=null?<span className={type==="currency"?"text-primary":""}>{type==="currency"?`₹${t.toLocaleString("en-IN")}`:t.toLocaleString("en-IN")}</span>:(i===0?<span className="text-muted-foreground">Total</span>:"")}
                      </td>
                    );})}
                    <td className="border border-[#d0d0d0] dark:border-border bg-[#f7f7f7]"/>
                  </tr>
                )}
                <tr>
                  <td colSpan={columns.length+2}>
                    <button className="w-full h-8 text-xs text-muted-foreground hover:bg-gray-50 transition-colors flex items-center justify-center gap-1 border-t border-[#d0d0d0] dark:border-border" onClick={addRow}>
                      <Plus className="w-3.5 h-3.5"/>Add Row
                    </button>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        )}

        {/* Status bar */}
        <div className="flex items-center justify-between px-4 py-1 border-t border-border bg-[#f0f0f0] dark:bg-muted/30 text-xs text-muted-foreground shrink-0">
          <span>{filtered.length} rows · {columns.length} cols</span>
          <span className="font-mono text-[#1a73e8]">
            {isDragging.current?(ctrlDragRef.current?"Ctrl+Drag: Copy":"Drag Fill: Series ↓"):""}
            {selectedCells.size>1&&!isDragging.current?`${selectedCells.size} cells selected`:""}
          </span>
          <span className="font-medium">{selTable?.name??""}</span>
        </div>
      </div>
    </>
  );
}
