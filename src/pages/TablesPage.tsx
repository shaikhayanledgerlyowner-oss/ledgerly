import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Plus, Table2, Trash2, Edit3, Search, SortAsc, SortDesc,
  MoreHorizontal, X, Calculator, Download, FileSpreadsheet,
  AlignLeft, AlignCenter, AlignRight, Palette, RefreshCw,
  ChevronDown, Sigma, Camera, Upload,
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

interface DbTable  { id:string; user_id:string; name:string; created_at:string; }
interface DbColumn { id:string; table_id:string; name:string; type:string; created_at:string; }
interface DbRow    { id:string; table_id:string; row_data:Record<string,any>; created_at:string; }
interface CellStyle{ bg?:string; color?:string; bold?:boolean; align?:"left"|"center"|"right"; }
type StyleMap = Record<string,CellStyle>;

// ── pure helpers ─────────────────────────────────────────────────────────────
// NOTE: sheet ab pura "plain text" hai — jo type karoge wahi dikhega (Excel jaisa).
// Koi auto ₹, koi auto date convert, koi auto number format nahi.

const safeFile=(n:string)=>String(n||"table").replace(/[\/\\:*?"<>|]/g,"-").trim()||"table";

// number nikalne ke liye (sum ke waqt) — ₹ , spaces sab hata deta hai
const parseNum=(v:any):number|null=>{
  if(v==null) return null;
  const s=String(v).replace(/[₹$,\s]/g,"").trim();
  if(s==="") return null;
  const n=Number(s);
  return isFinite(n)?n:null;
};

// ── fill series (drag handle) ────────────────────────────────────────────────
// isCopy=true → hamesha same value. warna: number badhega, date badhegi,
// "ABC 1" jaise text ka last number badhega, baaki sab copy.
const calcFill=(anchor:any, step:number, isCopy:boolean):any=>{
  const s=String(anchor??"");
  if(isCopy||s==="") return anchor;

  // pure number (₹900 / 900 / 1,200)
  const prefix=s.match(/^[₹$]/)?.[0]??"";
  const bare=s.replace(/[₹$,\s]/g,"");
  if(bare!==""&&isFinite(Number(bare))&&/^-?\d+(\.\d+)?$/.test(bare)){
    const n=Number(bare)+step;
    return prefix?`${prefix}${n}`:String(n);
  }

  // date dd/mm/yyyy ya dd-mm-yyyy
  const dm=s.match(/^(\d{1,2})([\/\-])(\d{1,2})\2(\d{4})$/);
  if(dm){
    const d=new Date(+dm[4],+dm[3]-1,+dm[1]);
    if(!isNaN(d.getTime())){
      d.setDate(d.getDate()+step);
      const sep=dm[2];
      return `${String(d.getDate()).padStart(2,"0")}${sep}${String(d.getMonth()+1).padStart(2,"0")}${sep}${d.getFullYear()}`;
    }
  }

  // yyyy-mm-dd
  if(/^\d{4}-\d{2}-\d{2}$/.test(s)){
    const d=new Date(s+"T00:00:00");
    if(!isNaN(d.getTime())){d.setDate(d.getDate()+step);return d.toISOString().slice(0,10);}
  }

  // text jiske end me number ho → "Patient 1" → "Patient 2"
  const tm=s.match(/^(.*?)(\d+)$/);
  if(tm){
    const num=String(Number(tm[2])+step);
    return tm[1]+num.padStart(tm[2].length,"0").slice(-Math.max(num.length,tm[2].length));
  }

  return anchor;
};

const BG_COLORS=["#ffffff","#fef9c3","#dcfce7","#dbeafe","#fce7f3","#fee2e2","#e0e7ff","#f3f4f6","#ffd700","#ff8c00","#ff6b6b","#22c55e","#3b82f6","#a855f7","#1e293b"];
const TX_COLORS=["#000000","#1e293b","#dc2626","#16a34a","#2563eb","#9333ea","#ea580c","#0891b2","#ffffff","#6b7280"];

const colLetter=(i:number):string=>{
  let s="",n=i+1;while(n>0){s=String.fromCharCode(64+(n%26||26))+s;n=Math.floor((n-1)/26);}return s;
};
const ck=(r:string,c:string)=>`${r}__${c}`;
const hk=(c:string)=>`HDR__${c}`;                       // header cell style key
const splitKey=(k:string)=>{const i=k.indexOf("__");return [k.slice(0,i),k.slice(i+2)];};

interface Ctx{x:number;y:number;rowId?:string;colId?:string;colName?:string;}

// tesseract (OCR) ko CDN se load karte hain — npm install ki zarurat nahi
const loadTesseract=():Promise<any>=>new Promise((res,rej)=>{
  const w=window as any;
  if(w.Tesseract) return res(w.Tesseract);
  const s=document.createElement("script");
  s.src="https://cdn.jsdelivr.net/npm/tesseract.js@5.1.0/dist/tesseract.min.js";
  s.onload=()=>res((window as any).Tesseract);
  s.onerror=()=>rej(new Error("OCR load fail"));
  document.body.appendChild(s);
});

// ─────────────────────────────────────────────────────────────────────────────
export default function TablesPage(){
  const {profile,hasAccess}=useAuth();
  const uid=profile?.id;

  const [tables,setTables]=useState<DbTable[]>([]);
  const [selTable,setSelTable]=useState<DbTable|null>(null);
  const [columns,setColumns]=useState<DbColumn[]>([]);
  const [rows,setRows]=useState<DbRow[]>([]);
  const [styleMap,setStyleMap]=useState<StyleMap>({});

  const [selCells,setSelCells]=useState<Set<string>>(new Set());
  const [busy,setBusy]=useState<string>("");

  // ── undo/redo ────────────────────────────────────────────────────────────
  const undoStack=useRef<{rowId:string;colName:string;oldVal:any;newVal:any;}[]>([]);
  const redoStack=useRef<{rowId:string;colName:string;oldVal:any;newVal:any;}[]>([]);
  const [canUndo,setCanUndo]=useState(false);
  const [canRedo,setCanRedo]=useState(false);

  const [search,setSearch]=useState("");
  const [sortCol,setSortCol]=useState<string|null>(null);
  const [sortDir,setSortDir]=useState<"asc"|"desc">("asc");

  const [editCell,setEditCell]=useState<{rowId:string;colName:string}|null>(null);
  const [editVal,setEditVal]=useState("");
  const [fbar,setFbar]=useState("");
  const [acSugg,setAcSugg]=useState("");
  const origRef=useRef("");
  const editValRef=useRef("");
  const savingRef=useRef(false);
  const cellRefs=useRef<Record<string,HTMLInputElement|null>>({});
  const colsRef=useRef<DbColumn[]>([]);
  const rowsRef=useRef<DbRow[]>([]);

  // file inputs (scan + upload)
  const camRef=useRef<HTMLInputElement>(null);
  const upRef=useRef<HTMLInputElement>(null);

  // ── drag fill ─────────────────────────────────────────────────────────────
  const DR=useRef({
    active:false, anchorRowId:"", anchorColName:"", anchorIdx:-1,
    anchorVal:null as any, endRowId:"", endIdx:-1, isCopy:false,
  });
  const [dragRows,setDragRows]=useState<string[]>([]);

  // ── range selection (mouse drag se multiple cells select) ─────────────────
  const selStart=useRef<{r:number;c:number}|null>(null);
  const [rangeMode,setRangeMode]=useState(false);

  const [renamingColId,setRenamingColId]=useState<string|null>(null);
  const [renamingColVal,setRenamingColVal]=useState("");
  const [delTarget,setDelTarget]=useState<DbTable|null>(null);
  const [delOpen,setDelOpen]=useState(false);
  const [countOpen,setCountOpen]=useState(false);
  const [countConds,setCountConds]=useState<{col:string;crit:string}[]>([{col:"",crit:""}]);
  const [countResult,setCountResult]=useState<number|null>(null);
  const [newTableName,setNewTableName]=useState("");
  const [addingTable,setAddingTable]=useState(false);
  const [showBg,setShowBg]=useState(false);
  const [showTx,setShowTx]=useState(false);
  const [ctx,setCtx]=useState<Ctx|null>(null);

  useEffect(()=>{editValRef.current=editVal;},[editVal]);
  useEffect(()=>{colsRef.current=columns;},[columns]);
  const focusCell=(rid:string,cn:string)=>setTimeout(()=>{
    const el=cellRefs.current[ck(rid,cn)];if(el){el.focus();try{el.select();}catch{}}
  },25);

  // ── load ──────────────────────────────────────────────────────────────────
  const loadTables=async()=>{
    if(!uid) return;
    const {data}=await supabase.from("user_tables").select("*").eq("user_id",uid).order("created_at");
    const list=(data??[]) as DbTable[];
    setTables(list);
    setSelTable(p=>{if(p){const f=list.find(t=>t.id===p.id);return f??list[0]??null;}return list[0]??null;});
  };
  const loadData=async(tid:string)=>{
    const [cr,rr]=await Promise.all([
      supabase.from("user_columns").select("*").eq("table_id",tid).order("created_at"),
      supabase.from("user_rows").select("*").eq("table_id",tid).order("created_at"),
    ]);
    setColumns((cr.data??[]) as DbColumn[]);
    setRows(((rr.data??[]) as any[]).map(r=>({...r,row_data:r.row_data??{}})));
    const {data:meta}=await supabase.from("user_tables").select("*").eq("id",tid).single();
    try{if((meta as any)?.style_map)setStyleMap(JSON.parse((meta as any).style_map));else setStyleMap({});}catch{setStyleMap({});}
  };
  useEffect(()=>{loadTables();},[uid]);
  useEffect(()=>{
    if(selTable)loadData(selTable.id);
    else{setColumns([]);setRows([]);setStyleMap({});}
    undoStack.current=[];redoStack.current=[];
    setCanUndo(false);setCanRedo(false);
    setSelCells(new Set());
  },[selTable?.id]);

  const saveStyles=async(map:StyleMap)=>{
    if(!selTable)return;
    const {error}=await supabase.from("user_tables").update({style_map:JSON.stringify(map)} as any).eq("id",selTable.id);
    if(error) console.error("[saveStyles] DB error:",error.message,"— Run SQL: ALTER TABLE user_tables ADD COLUMN IF NOT EXISTS style_map text;");
  };
  const applyStyle=(patch:Partial<CellStyle>)=>{
    if(!selCells.size) return toast.error("Pehle cell select karo");
    setStyleMap(p=>{const n={...p};selCells.forEach(k=>{n[k]={...(n[k]??{}),...patch};});saveStyles(n);return n;});
  };

  // ── table CRUD ────────────────────────────────────────────────────────────
  const createTable=async()=>{
    if(!uid||!newTableName.trim())return;
    const {data,error}=await supabase.from("user_tables").insert({user_id:uid,name:newTableName.trim()}).select("*").single();
    if(error)return toast.error(error.message);
    setNewTableName("");setAddingTable(false);await loadTables();setSelTable(data as DbTable);toast.success("Sheet created");
  };
  const deleteTable=async(tid:string)=>{
    await supabase.from("user_rows").delete().eq("table_id",tid);
    await supabase.from("user_columns").delete().eq("table_id",tid);
    await supabase.from("user_tables").delete().eq("id",tid);
    toast.success("Deleted");await loadTables();
  };
  const renameTable=async(t:DbTable)=>{
    const n=prompt("Rename:",t.name);if(!n?.trim())return;
    await supabase.from("user_tables").update({name:n.trim()}).eq("id",t.id);await loadTables();
  };

  // ── column CRUD ───────────────────────────────────────────────────────────
  const addColumn=async()=>{
    if(!selTable)return;
    const name=`Column ${columns.length+1}`;
    await supabase.from("user_columns").insert({table_id:selTable.id,name,type:"text"});
    if(rows.length)await Promise.all(rows.map(r=>supabase.from("user_rows").update({row_data:{...r.row_data,[name]:""}}).eq("id",r.id)));
    await loadData(selTable.id);
    setTimeout(()=>{const nc=colsRef.current.at(-1);if(nc){setRenamingColId(nc.id);setRenamingColVal(nc.name);}},80);
  };
  const deleteColumn=async(col:DbColumn)=>{
    await supabase.from("user_columns").delete().eq("id",col.id);
    if(rows.length)await Promise.all(rows.map(r=>{const rd={...r.row_data};delete rd[col.name];return supabase.from("user_rows").update({row_data:rd}).eq("id",r.id);}));
    await loadData(selTable!.id);
  };
  const updateColumn=async(col:DbColumn,nm:string)=>{
    if(!nm.trim()){setRenamingColId(null);return;}
    if(nm.trim()===col.name){setRenamingColId(null);return;}
    const {error}=await supabase.from("user_columns").update({name:nm.trim()}).eq("id",col.id);
    if(error){toast.error("Failed to save: "+error.message);return;}
    setColumns(prev=>prev.map(c=>c.id===col.id?{...c,name:nm.trim()}:c));
    if(rows.length){
      setRows(prev=>prev.map(r=>{const rd={...r.row_data};rd[nm.trim()]=rd[col.name];delete rd[col.name];return {...r,row_data:rd};}));
      await Promise.all(rows.map(r=>{const rd={...r.row_data};rd[nm.trim()]=rd[col.name];delete rd[col.name];return supabase.from("user_rows").update({row_data:rd}).eq("id",r.id);}));
    }
    // styles ko naye column name par shift karo
    setStyleMap(prev=>{
      const n:StyleMap={};
      Object.entries(prev).forEach(([k,v])=>{
        const [rid,cn]=splitKey(k);
        n[cn===col.name?`${rid}__${nm.trim()}`:k]=v;
      });
      saveStyles(n);return n;
    });
    setRenamingColId(null);
    toast.success("Saved",{duration:800});
  };

  // ── row CRUD ──────────────────────────────────────────────────────────────
  const addRow=async(silent=false)=>{
    if(!selTable||!columns.length)return null;
    const empty:Record<string,any>={};columns.forEach(c=>(empty[c.name]=""));
    const {data,error}=await supabase.from("user_rows").insert({table_id:selTable.id,row_data:empty}).select("*").single();
    if(error){toast.error(error.message);return null;}
    const nr={...(data as any),row_data:(data as any).row_data??{}} as DbRow;
    setRows(p=>[...p,nr]);
    if(!silent)setTimeout(()=>{if(colsRef.current[0])startEdit(nr.id,colsRef.current[0].name,true);},80);
    return nr;
  };
  const deleteRow=async(id:string)=>{
    await supabase.from("user_rows").delete().eq("id",id);
    setRows(p=>p.filter(r=>r.id!==id));
  };

  // ── autocomplete ──────────────────────────────────────────────────────────
  const getAC=(colName:string,typed:string,curId:string):string=>{
    if(!typed)return "";
    const q=typed.toLowerCase();
    for(const r of rowsRef.current){
      if(r.id===curId)continue;
      const v=String(r.row_data[colName]??"");
      if(v&&v.toLowerCase().startsWith(q)&&v.toLowerCase()!==q)return v;
    }
    return "";
  };

  // ── cell edit ─────────────────────────────────────────────────────────────
  const startEdit=(rowId:string,colName:string,focus=false)=>{
    const row=rowsRef.current.find(r=>r.id===rowId);
    const raw=(row?.row_data??{})[colName];
    const sv=raw==null?"":String(raw);
    origRef.current=sv;
    setEditCell({rowId,colName});
    setEditVal(sv);
    setFbar(sv);
    setSelCells(new Set([ck(rowId,colName)]));
    setAcSugg("");
    if(focus)focusCell(rowId,colName);
  };

  const saveCell=async(rowId:string,colName:string,val:string,skipHistory=false)=>{
    if(savingRef.current)await new Promise(r=>setTimeout(r,50));
    savingRef.current=true;
    try{
      const value:any=val; // ✅ sab kuch plain text — jaisa type kiya waisa hi
      if(!skipHistory){
        const row=rowsRef.current.find(r=>r.id===rowId);
        const oldVal=(row?.row_data??{})[colName]??"";
        if(String(oldVal)!==String(value)){
          undoStack.current.push({rowId,colName,oldVal,newVal:value});
          if(undoStack.current.length>100)undoStack.current.shift();
          redoStack.current=[];
          setCanUndo(true);setCanRedo(false);
        }
      }
      setRows(p=>p.map(r=>r.id!==rowId?r:{...r,row_data:{...r.row_data,[colName]:value}}));
      const row=rowsRef.current.find(r=>r.id===rowId);
      await supabase.from("user_rows").update({row_data:{...(row?.row_data??{}),[colName]:value}}).eq("id",rowId);
    }finally{ savingRef.current=false; }
  };

  // ── undo / redo ───────────────────────────────────────────────────────────
  const doUndo=async()=>{
    const entry=undoStack.current.pop();
    if(!entry){toast("Nothing to undo",{duration:800});return;}
    redoStack.current.push(entry);
    setCanUndo(undoStack.current.length>0);setCanRedo(true);
    setRows(p=>p.map(r=>r.id!==entry.rowId?r:{...r,row_data:{...r.row_data,[entry.colName]:entry.oldVal}}));
    const row=rowsRef.current.find(r=>r.id===entry.rowId);
    await supabase.from("user_rows").update({row_data:{...(row?.row_data??{}),[entry.colName]:entry.oldVal}}).eq("id",entry.rowId);
    toast("↩ Undone",{duration:800});
  };
  const doRedo=async()=>{
    const entry=redoStack.current.pop();
    if(!entry){toast("Nothing to redo",{duration:800});return;}
    undoStack.current.push(entry);
    setCanUndo(true);setCanRedo(redoStack.current.length>0);
    setRows(p=>p.map(r=>r.id!==entry.rowId?r:{...r,row_data:{...r.row_data,[entry.colName]:entry.newVal}}));
    const row=rowsRef.current.find(r=>r.id===entry.rowId);
    await supabase.from("user_rows").update({row_data:{...(row?.row_data??{}),[entry.colName]:entry.newVal}}).eq("id",entry.rowId);
    toast("↪ Redone",{duration:800});
  };
  const doUndoRef=useRef<()=>Promise<void>>(async()=>{});
  const doRedoRef=useRef<()=>Promise<void>>(async()=>{});
  useEffect(()=>{doUndoRef.current=doUndo;doRedoRef.current=doRedo;});

  const filtered=useMemo(()=>{
    let list=[...rows];
    if(search.trim()){const q=search.toLowerCase();list=list.filter(r=>Object.values(r.row_data).some(v=>String(v??"").toLowerCase().includes(q)));}
    if(sortCol){
      list.sort((a,b)=>{
        const av=a.row_data[sortCol]??"",bv=b.row_data[sortCol]??"";
        const an=parseNum(av),bn=parseNum(bv);
        if(an!==null&&bn!==null)return sortDir==="asc"?an-bn:bn-an;
        return sortDir==="asc"?String(av).localeCompare(String(bv)):String(bv).localeCompare(String(av));
      });
    }
    return list;
  },[rows,search,sortCol,sortDir]);
  useEffect(()=>{rowsRef.current=filtered;},[filtered]);

  // ── keyboard: Ctrl+Z / Ctrl+Y / Delete ────────────────────────────────────
  const clearSelected=async()=>{
    if(!selCells.size)return;
    const keys=[...selCells].filter(k=>!k.startsWith("HDR__"));
    for(const k of keys){
      const [rid,cn]=splitKey(k);
      await saveCell(rid,cn,"");
    }
    toast("Cleared",{duration:800});
  };
  const clearRef=useRef<()=>Promise<void>>(async()=>{});
  useEffect(()=>{clearRef.current=clearSelected;});
  useEffect(()=>{
    const onKey=async(e:KeyboardEvent)=>{
      if((e.ctrlKey||e.metaKey)&&!e.shiftKey&&e.key==="z"){e.preventDefault();await doUndoRef.current();}
      if((e.ctrlKey||e.metaKey)&&(e.key==="y"||(e.shiftKey&&e.key==="z"))){e.preventDefault();await doRedoRef.current();}
      if((e.key==="Delete"||e.key==="Backspace")&&!(e.target as HTMLElement)?.closest?.("input,textarea")){
        e.preventDefault();await clearRef.current();
      }
    };
    window.addEventListener("keydown",onKey);
    return()=>window.removeEventListener("keydown",onKey);
  },[]);

  const moveCell=async(rowId:string,colName:string,val:string,dir:"right"|"left"|"down"|"up")=>{
    await saveCell(rowId,colName,val);
    setEditCell(null);setEditVal("");setFbar("");setAcSugg("");
    const cols=colsRef.current,list=rowsRef.current;
    const ri=list.findIndex(r=>r.id===rowId),ci=cols.findIndex(c=>c.name===colName);
    let nr=ri,nc=ci;
    if(dir==="right")nc=Math.min(ci+1,cols.length-1);
    else if(dir==="left")nc=Math.max(ci-1,0);
    else if(dir==="down"){nr=ri+1;if(nr>=list.length){addRow();return;}}
    else if(dir==="up")nr=Math.max(ri-1,0);
    const nextR=list[nr],nextC=cols[nc];
    if(nextR&&nextC)startEdit(nextR.id,nextC.name,true);
  };

  // ── SELECTION STATS (Excel jaisa live: Sum / Avg / Count) ─────────────────
  const stats=useMemo(()=>{
    const nums:number[]=[];
    selCells.forEach(k=>{
      if(k.startsWith("HDR__"))return;
      const [rid,cn]=splitKey(k);
      const row=rows.find(r=>r.id===rid);
      const n=parseNum(row?.row_data?.[cn]);
      if(n!==null)nums.push(n);
    });
    const sum=nums.reduce((a,b)=>a+b,0);
    return {count:selCells.size,numCount:nums.length,sum,avg:nums.length?sum/nums.length:0};
  },[selCells,rows]);

  // ── AUTOSUM: selected cells ka total, neeche wale cell me (Excel jaisa) ────
  const doSum=async()=>{
    if(!selCells.size)return toast.error("Pehle cells select karo (drag karo)");
    const byCol=new Map<string,number[]>();      // colName → row indexes
    let maxIdx=-1;
    selCells.forEach(k=>{
      if(k.startsWith("HDR__"))return;
      const [rid,cn]=splitKey(k);
      const idx=rowsRef.current.findIndex(r=>r.id===rid);
      if(idx<0)return;
      if(!byCol.has(cn))byCol.set(cn,[]);
      byCol.get(cn)!.push(idx);
      if(idx>maxIdx)maxIdx=idx;
    });
    if(!byCol.size)return toast.error("Koi valid cell select nahi hai");

    // target row = selection ke neeche wali row; na ho to nayi bana do
    let target=rowsRef.current[maxIdx+1];
    if(!target){
      const nr=await addRow(true);
      if(!nr)return;
      target=nr;
    }

    let done=0;
    for(const [cn,idxs] of byCol){
      let total=0,found=0;
      idxs.forEach(i=>{
        const n=parseNum(rowsRef.current[i]?.row_data?.[cn]);
        if(n!==null){total+=n;found++;}
      });
      if(!found)continue;
      const sample=String(rowsRef.current[idxs[0]]?.row_data?.[cn]??"");
      const cur=sample.trim().startsWith("₹")?"₹":"";
      await saveCell(target.id,cn,`${cur}${Number(total.toFixed(2))}`);
      // total cell ko bold kar dete hain (Excel jaisa look)
      setStyleMap(prev=>{const n={...prev};const key=ck(target!.id,cn);n[key]={...(n[key]??{}),bold:true};saveStyles(n);return n;});
      done++;
    }
    if(!done)return toast.error("Selected cells me koi number nahi mila");
    toast.success(`Σ Sum = ${Number(stats.sum.toFixed(2)).toLocaleString("en-IN")}`);
    setSelCells(new Set());
  };

  // ── DRAG FILL ─────────────────────────────────────────────────────────────
  useEffect(()=>{
    const onMove=(e:MouseEvent)=>{
      if(!DR.current.active) return;
      const els=document.elementsFromPoint(e.clientX,e.clientY);
      for(const el of els){
        const td=el.closest("td[data-rowid]") as HTMLElement|null;
        if(td){
          const rowId=td.dataset.rowid!;
          const colName=td.dataset.colname!;
          if(colName===DR.current.anchorColName){
            DR.current.endRowId=rowId;
            const idx=rowsRef.current.findIndex(r=>r.id===rowId);
            DR.current.endIdx=idx;
            const ai=DR.current.anchorIdx,ei=idx;
            if(ai>=0&&ei>=0){
              const from=Math.min(ai,ei),to=Math.max(ai,ei);
              setDragRows(rowsRef.current.slice(from,to+1).map(r=>r.id));
            }
          }
          break;
        }
      }
    };

    const onUp=async(e:MouseEvent)=>{
      selStart.current=null;setRangeMode(false);
      if(!DR.current.active)return;
      DR.current.isCopy=e.ctrlKey||e.metaKey;
      DR.current.active=false;
      setDragRows([]);

      const {anchorIdx,anchorColName,anchorVal,endIdx,isCopy}=DR.current;
      if(anchorIdx<0||endIdx<0||anchorIdx===endIdx){return;}

      const from=Math.min(anchorIdx,endIdx);
      const to=Math.max(anchorIdx,endIdx);
      const list=rowsRef.current;

      for(let i=from;i<=to;i++){
        if(i===anchorIdx)continue;
        const targetRow=list[i];if(!targetRow)continue;
        const step=i-anchorIdx;
        const newVal=calcFill(anchorVal,step,isCopy);
        const rd={...(targetRow.row_data??{})};
        setRows(p=>p.map(r=>r.id!==targetRow.id?r:{...r,row_data:{...r.row_data,[anchorColName]:newVal}}));
        await supabase.from("user_rows").update({row_data:{...rd,[anchorColName]:newVal}}).eq("id",targetRow.id);
      }
      toast.success(isCopy?"Copied (Ctrl)!":"Filled!");
    };

    window.addEventListener("mousemove",onMove);
    window.addEventListener("mouseup",onUp);
    return()=>{window.removeEventListener("mousemove",onMove);window.removeEventListener("mouseup",onUp);};
  },[]);

  // ── range select helper ───────────────────────────────────────────────────
  const buildRange=(r1:number,c1:number,r2:number,c2:number)=>{
    const rs=Math.min(r1,r2),re=Math.max(r1,r2);
    const cs=Math.min(c1,c2),ce=Math.max(c1,c2);
    const s=new Set<string>();
    for(let i=rs;i<=re;i++){
      const row=rowsRef.current[i];if(!row)continue;
      for(let j=cs;j<=ce;j++){
        const col=colsRef.current[j];if(!col)continue;
        s.add(ck(row.id,col.name));
      }
    }
    setSelCells(s);
  };

  const selectCol=(colName:string)=>{
    setEditCell(null);
    const s=new Set<string>();rowsRef.current.forEach(r=>s.add(ck(r.id,colName)));
    setSelCells(s);
  };

  // ── context menu ──────────────────────────────────────────────────────────
  const openCtx=(e:React.MouseEvent,rowId?:string,colId?:string,colName?:string)=>{
    e.preventDefault();e.stopPropagation();setCtx({x:e.clientX,y:e.clientY,rowId,colId,colName});
  };
  useEffect(()=>{
    const c=()=>setCtx(null);
    window.addEventListener("click",c);
    return()=>window.removeEventListener("click",c);
  },[]);

  const doCount=()=>{
    const a=countConds.filter(c=>c.col&&c.crit);
    if(!a.length)return toast.error("Add at least 1 condition");
    const n=rows.filter(r=>a.every(c=>String(r.row_data[c.col]??"").toLowerCase().includes(c.crit.toLowerCase()))).length;
    setCountResult(n);toast.success(`Found ${n} rows`);
  };

  // ── IMPORT: rows/cols ko as-it-is sheet me daalo ──────────────────────────
  const importGrid=async(grid:string[][],name:string)=>{
    if(!uid)return;
    const clean=grid.filter(r=>r.some(c=>String(c??"").trim()!==""));
    if(!clean.length)return toast.error("File me kuch data nahi mila");

    const header=clean[0].map((h,i)=>String(h??"").trim()||`Column ${i+1}`);
    // duplicate names fix
    const seen=new Map<string,number>();
    const cols=header.map(h=>{const n=(seen.get(h)??0)+1;seen.set(h,n);return n>1?`${h} ${n}`:h;});
    const body=clean.slice(1);

    setBusy("Importing...");
    const {data:tb,error:te}=await supabase.from("user_tables").insert({user_id:uid,name:safeFile(name)}).select("*").single();
    if(te){setBusy("");return toast.error(te.message);}
    const tid=(tb as DbTable).id;

    for(const c of cols) await supabase.from("user_columns").insert({table_id:tid,name:c,type:"text"});

    const payload=body.map(r=>{
      const rd:Record<string,any>={};
      cols.forEach((c,i)=>{rd[c]=r[i]==null?"":String(r[i]);});
      return {table_id:tid,row_data:rd};
    });
    for(let i=0;i<payload.length;i+=200){
      await supabase.from("user_rows").insert(payload.slice(i,i+200) as any);
    }
    setBusy("");
    await loadTables();
    setSelTable(tb as DbTable);
    toast.success(`Imported: ${cols.length} columns, ${payload.length} rows`);
  };

  // Excel / CSV
  const handleSheetFile=async(file:File)=>{
    try{
      setBusy("Reading file...");
      const buf=await file.arrayBuffer();
      const wb=XLSX.read(buf,{type:"array",cellDates:false,raw:false});
      const ws=wb.Sheets[wb.SheetNames[0]];
      const grid=XLSX.utils.sheet_to_json(ws,{header:1,defval:"",raw:false}) as any[][];
      setBusy("");
      await importGrid(grid.map(r=>r.map(c=>String(c??""))),file.name.replace(/\.[^.]+$/,""));
    }catch(err:any){ setBusy(""); toast.error("Excel read fail: "+err.message); }
  };

  // Image (PNG/JPG) → OCR → grid
  const handleImageFile=async(file:File)=>{
    try{
      setBusy("Scanning image...");
      const T=await loadTesseract();
      const {data}=await T.recognize(file,"eng",{logger:(m:any)=>{
        if(m.status==="recognizing text")setBusy(`Scanning... ${Math.round((m.progress||0)*100)}%`);
      }});
      setBusy("");
      const lines:string[]=String(data?.text??"").split(/\r?\n/).map(s=>s.trim()).filter(Boolean);
      if(!lines.length)return toast.error("Image me text nahi mila — saaf photo lo");
      const grid=lines.map(l=>l.split(/\t|\s{2,}|\s*\|\s*/).map(s=>s.trim()).filter(s=>s!==""));
      const width=Math.max(...grid.map(g=>g.length));
      await importGrid(grid.map(g=>{const c=[...g];while(c.length<width)c.push("");return c;}),file.name.replace(/\.[^.]+$/,"")||"Scan");
    }catch(err:any){ setBusy(""); toast.error("Scan fail: "+(err?.message??"OCR load nahi hua")); }
  };

  const handleFile=async(f?:File|null)=>{
    if(!f)return;
    const n=f.name.toLowerCase();
    if(/\.(xlsx|xls|xlsm|csv|tsv)$/.test(n))return handleSheetFile(f);
    if(/\.(png|jpg|jpeg|webp|bmp)$/.test(n)||f.type.startsWith("image/"))return handleImageFile(f);
    toast.error("Sirf Excel/CSV ya image file chalegi");
  };

  // ── downloads ─────────────────────────────────────────────────────────────
  const dlPDF=()=>{
    if(!hasAccess)return toast.error("Upgrade to download");
    if(!selTable||!columns.length)return;
    const doc=new jsPDF({orientation:"l",unit:"pt",format:"a4"});
    doc.setFont("helvetica","bold");doc.setFontSize(16);doc.text(selTable.name,40,45);
    doc.setFont("helvetica","normal");doc.setFontSize(10);doc.text(`Exported: ${new Date().toLocaleString()}`,40,62);
    const body=filtered.map(r=>columns.map(c=>{
      const v=r.row_data[c.name];
      return v==null?"":String(v).replace(/₹/g,"Rs. ");
    }));
    autoTable(doc,{startY:75,head:[columns.map(c=>c.name)],body,styles:{font:"helvetica",fontSize:9,cellPadding:5},headStyles:{fillColor:[30,30,30],textColor:255},margin:{left:40,right:40}});
    doc.save(`${safeFile(selTable.name)}.pdf`);toast.success("PDF downloaded");
  };

  const dlExcel=()=>{
    if(!hasAccess)return toast.error("Upgrade to download");
    if(!selTable||!columns.length)return;
    const header=columns.map(c=>c.name);
    const data=filtered.map(r=>columns.map(c=>{
      const v=r.row_data[c.name];
      if(v==null||v==="")return "";
      const n=parseNum(v);
      // pure number ho to number ki tarah jaye, warna text
      return n!==null&&/^[₹$]?\s*-?[\d,]+(\.\d+)?$/.test(String(v).trim())?n:String(v);
    }));
    const ws=XLSX.utils.aoa_to_sheet([header,...data]);
    const range=XLSX.utils.decode_range(ws["!ref"]||"A1");
    for(let ri=0;ri<=range.e.r;ri++)for(let ci=0;ci<=range.e.c;ci++){
      const addr=XLSX.utils.encode_cell({r:ri,c:ci});if(!ws[addr])continue;
      const co=columns[ci];
      const isH=ri===0;
      const cs=isH?(co?styleMap[hk(co.name)]:undefined):(()=>{const ro=filtered[ri-1];return ro&&co?styleMap[ck(ro.id,co.name)]:undefined;})();
      ws[addr].s={
        fill:{patternType:"solid",fgColor:{rgb:cs?.bg?cs.bg.replace("#",""):(isH?"F2F2F2":"FFFFFF")}},
        font:{bold:isH||(cs?.bold??false),color:{rgb:cs?.color?cs.color.replace("#",""):"000000"}},
        alignment:{horizontal:cs?.align??"left",vertical:"center"},
        border:{top:{style:"thin",color:{rgb:"D1D5DB"}},bottom:{style:"thin",color:{rgb:"D1D5DB"}},left:{style:"thin",color:{rgb:"D1D5DB"}},right:{style:"thin",color:{rgb:"D1D5DB"}}},
      };
    }
    (ws as any)["!cols"]=header.map((_,i)=>({wch:Math.min(Math.max(...[header[i].length,...data.map(row=>String(row[i]??"").length)])+2,40)}));
    const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,ws,"Sheet1");
    saveAs(new Blob([XLSX.write(wb,{bookType:"xlsx",type:"array",cellStyles:true})],{type:"application/octet-stream"}),`${safeFile(selTable.name)}.xlsx`);
    toast.success("Excel downloaded");
  };

  const cellLabel=useMemo(()=>{
    if(selCells.size===0)return"";
    if(selCells.size>1)return`${selCells.size} cells`;
    const k=[...selCells][0];
    if(k.startsWith("HDR__"))return"Header";
    const [rid,cn]=splitKey(k);
    const ci=columns.findIndex(c=>c.name===cn);const ri=rowsRef.current.findIndex(r=>r.id===rid);
    return`${colLetter(ci)}${ri+1}`;
  },[selCells,columns]);

  const firstStyle=useMemo(()=>{const k=[...selCells][0];return k?(styleMap[k]??{} as CellStyle):{} as CellStyle;},[selCells,styleMap]);

  // ═══════════════════════════════════════════════════════════════════════════
  return(
    <>
      {/* hidden inputs: camera + upload */}
      <input ref={camRef} type="file" accept="image/*" capture="environment" className="hidden"
        onChange={e=>{handleFile(e.target.files?.[0]);e.currentTarget.value="";}}/>
      <input ref={upRef} type="file" accept=".xlsx,.xls,.xlsm,.csv,.tsv,image/*" className="hidden"
        onChange={e=>{handleFile(e.target.files?.[0]);e.currentTarget.value="";}}/>

      {busy&&(
        <div className="fixed inset-0 z-[10000] bg-black/40 flex items-center justify-center">
          <div className="bg-white rounded-lg px-6 py-4 shadow-xl text-sm font-medium">{busy}</div>
        </div>
      )}

      <AlertDialog open={delOpen} onOpenChange={setDelOpen}>
        <AlertDialogContent>
          <AlertDialogHeader><AlertDialogTitle>Delete "{delTarget?.name}"?</AlertDialogTitle><AlertDialogDescription>All data will be permanently deleted.</AlertDialogDescription></AlertDialogHeader>
          <AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction onClick={async()=>{if(delTarget){await deleteTable(delTarget.id);setDelOpen(false);setDelTarget(null);}}}>Delete</AlertDialogAction></AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {ctx&&(
        <div className="fixed z-[9999] bg-white border shadow-xl rounded-lg py-1 min-w-[210px] text-sm" style={{top:ctx.y,left:ctx.x}} onClick={e=>e.stopPropagation()}>
          {ctx.rowId&&<>
            <button className="w-full px-4 py-2 text-left hover:bg-gray-50 flex items-center gap-2" onClick={()=>{addRow();setCtx(null);}}><Plus className="w-3.5 h-3.5"/>Insert Row Below</button>
            <button className="w-full px-4 py-2 text-left hover:bg-gray-50 text-red-500 flex items-center gap-2" onClick={()=>{deleteRow(ctx.rowId!);setCtx(null);}}><Trash2 className="w-3.5 h-3.5"/>Delete Row</button>
            <div className="border-t my-1"/>
          </>}

          {ctx.colId&&(()=>{
            const col=columns.find(c=>c.id===ctx.colId);
            if(!col) return null;
            return(<>
              <button className="w-full px-4 py-2 text-left hover:bg-gray-50 flex items-center gap-2"
                onClick={()=>{setRenamingColId(col.id);setRenamingColVal(col.name);setCtx(null);}}>
                <Edit3 className="w-3.5 h-3.5"/>Rename Column
              </button>
              <button className="w-full px-4 py-2 text-left hover:bg-gray-50 flex items-center gap-2"
                onClick={()=>{selectCol(col.name);setCtx(null);}}>
                <Table2 className="w-3.5 h-3.5"/>Select Whole Column
              </button>

              {/* HEADER color — ✅ ab header bhi color ho sakta hai */}
              <div className="px-3 py-1.5">
                <p className="text-[10px] text-gray-400 mb-1 uppercase tracking-wide">Header Color</p>
                <div className="grid grid-cols-5 gap-1 mb-1">
                  {BG_COLORS.map(c=>(
                    <button key={"h"+c} className="w-6 h-6 rounded border-2 hover:scale-110 transition-all"
                      style={{background:c,borderColor:"#e5e7eb"}}
                      onClick={()=>{
                        setStyleMap(prev=>{const n={...prev};const k=hk(col.name);n[k]={...(n[k]??{}),bg:c};saveStyles(n);return n;});
                        setCtx(null);
                      }}/>
                  ))}
                </div>
                <div className="flex gap-1">
                  {TX_COLORS.slice(0,6).map(c=>(
                    <button key={"ht"+c} title="Header text color"
                      className="w-6 h-6 rounded border flex items-center justify-center text-[10px] font-bold"
                      style={{color:c,background:"#fff"}}
                      onClick={()=>{
                        setStyleMap(prev=>{const n={...prev};const k=hk(col.name);n[k]={...(n[k]??{}),color:c};saveStyles(n);return n;});
                        setCtx(null);
                      }}>A</button>
                  ))}
                </div>
              </div>

              {/* COLUMN cells color */}
              <div className="px-3 py-1.5">
                <p className="text-[10px] text-gray-400 mb-1 uppercase tracking-wide">Column Color</p>
                <div className="grid grid-cols-5 gap-1 mb-1">
                  {BG_COLORS.map(c=>(
                    <button key={c}
                      className="w-6 h-6 rounded border-2 hover:scale-110 transition-all"
                      style={{background:c,borderColor:"#e5e7eb"}}
                      onClick={()=>{
                        setStyleMap(prev=>{
                          const next={...prev};
                          rowsRef.current.forEach(r=>{const k=ck(r.id,col.name);next[k]={...(next[k]??{}),bg:c};});
                          saveStyles(next);return next;
                        });
                        setCtx(null);
                      }}
                    />
                  ))}
                </div>
                <button className="w-full text-[10px] py-1 rounded hover:bg-gray-100 text-gray-400 border border-dashed border-gray-200"
                  onClick={()=>{
                    setStyleMap(prev=>{
                      const next={...prev};
                      rowsRef.current.forEach(r=>{const k=ck(r.id,col.name);if(next[k])delete next[k].bg;});
                      const h=hk(col.name);if(next[h]){delete next[h].bg;delete next[h].color;}
                      saveStyles(next);return next;
                    });
                    setCtx(null);
                  }}>✕ Clear color</button>
              </div>

              <div className="border-t my-1"/>
              <button className="w-full px-4 py-2 text-left hover:bg-gray-50 flex items-center gap-2" onClick={()=>{addColumn();setCtx(null);}}><Plus className="w-3.5 h-3.5"/>Add Column</button>
              <button className="w-full px-4 py-2 text-left hover:bg-gray-50 text-red-500 flex items-center gap-2" onClick={()=>{deleteColumn(col);setCtx(null);}}><Trash2 className="w-3.5 h-3.5"/>Delete Column</button>
            </>);
          })()}

          {!ctx.rowId&&!ctx.colId&&<>
            <button className="w-full px-4 py-2 text-left hover:bg-gray-50 flex items-center gap-2" onClick={()=>{addRow();setCtx(null);}}><Plus className="w-3.5 h-3.5"/>Add Row</button>
            <button className="w-full px-4 py-2 text-left hover:bg-gray-50 flex items-center gap-2" onClick={()=>{addColumn();setCtx(null);}}><Plus className="w-3.5 h-3.5"/>Add Column</button>
          </>}
        </div>
      )}

      <div className="flex flex-col h-[calc(100vh-4rem)] -m-4 md:-m-6 lg:-m-8 overflow-hidden">

        {/* ══ TOOLBAR ════════════════════════════════════════════════════════ */}
        <div className="flex items-center gap-0.5 px-2 py-1.5 border-b bg-[#f8f8f8] dark:bg-muted/40 shrink-0 flex-wrap">
          <div className="relative mr-1">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none"/>
            <Input className="h-7 pl-7 w-32 text-xs bg-white dark:bg-background" placeholder="Search..." value={search} onChange={e=>setSearch(e.target.value)}/>
          </div>
          <div className="w-px h-6 bg-border mx-0.5"/>
          <button title="Undo (Ctrl+Z)" onClick={doUndo} disabled={!canUndo}
            className={`w-7 h-7 flex items-center justify-center rounded border border-transparent text-sm font-bold transition-colors ${canUndo?"hover:bg-white text-gray-700":"text-gray-300 cursor-not-allowed"}`}>↩</button>
          <button title="Redo (Ctrl+Y)" onClick={doRedo} disabled={!canRedo}
            className={`w-7 h-7 flex items-center justify-center rounded border border-transparent text-sm font-bold transition-colors ${canRedo?"hover:bg-white text-gray-700":"text-gray-300 cursor-not-allowed"}`}>↪</button>
          <div className="w-px h-6 bg-border mx-0.5"/>
          <button title="Bold" onClick={()=>applyStyle({bold:!firstStyle.bold})}
            className={`w-7 h-7 flex items-center justify-center rounded text-sm font-bold border hover:bg-white transition-colors ${firstStyle.bold?"bg-blue-100 border-blue-400 text-blue-700":"border-transparent text-gray-700"}`}>B</button>
          <div className="w-px h-6 bg-border mx-0.5"/>
          {(["left","center","right"] as const).map(a=>(
            <button key={a} title={`Align ${a}`} onClick={()=>applyStyle({align:a})}
              className={`w-7 h-7 flex items-center justify-center rounded border hover:bg-white transition-colors ${firstStyle.align===a?"bg-blue-100 border-blue-400":"border-transparent"}`}>
              {a==="left"?<AlignLeft className="w-3.5 h-3.5"/>:a==="center"?<AlignCenter className="w-3.5 h-3.5"/>:<AlignRight className="w-3.5 h-3.5"/>}
            </button>
          ))}
          <div className="w-px h-6 bg-border mx-0.5"/>
          <Popover open={showBg} onOpenChange={setShowBg}>
            <PopoverTrigger asChild>
              <button title="Cell color" className="w-7 h-7 flex flex-col items-center justify-center gap-0.5 rounded border border-transparent hover:bg-white hover:border-gray-300 transition-colors">
                <Palette className="w-3.5 h-3.5 text-gray-600"/>
                <div className="w-4 h-1 rounded-sm" style={{background:firstStyle.bg??"transparent",border:"1px solid #ccc"}}/>
              </button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-2" align="start">
              <p className="text-xs font-semibold mb-2 text-gray-600">Cell Color</p>
              <div className="grid grid-cols-5 gap-1 mb-1">
                {BG_COLORS.map(c=><button key={c} onClick={()=>{applyStyle({bg:c});setShowBg(false);}} className={`w-6 h-6 rounded border-2 hover:scale-110 transition-all ${firstStyle.bg===c?"border-blue-500":"border-gray-200"}`} style={{background:c}}/>)}
              </div>
              <button className="w-full text-xs py-1 rounded hover:bg-gray-100 text-gray-500 border border-dashed border-gray-300 mt-1" onClick={()=>{applyStyle({bg:undefined});setShowBg(false);}}>Clear</button>
            </PopoverContent>
          </Popover>
          <Popover open={showTx} onOpenChange={setShowTx}>
            <PopoverTrigger asChild>
              <button title="Text color" className="w-7 h-7 flex flex-col items-center justify-center gap-0.5 rounded border border-transparent hover:bg-white hover:border-gray-300 transition-colors">
                <span className="text-sm font-bold leading-none" style={{color:firstStyle.color??"#333"}}>A</span>
                <div className="w-4 h-1 rounded-sm" style={{background:firstStyle.color??"#333",border:"1px solid #ccc"}}/>
              </button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-2" align="start">
              <p className="text-xs font-semibold mb-2 text-gray-600">Text Color</p>
              <div className="grid grid-cols-5 gap-1 mb-1">
                {TX_COLORS.map(c=><button key={c} onClick={()=>{applyStyle({color:c});setShowTx(false);}} className={`w-6 h-6 rounded border-2 hover:scale-110 transition-all ${firstStyle.color===c?"border-blue-500":"border-gray-200"}`} style={{background:c}}/>)}
              </div>
              <button className="w-full text-xs py-1 rounded hover:bg-gray-100 text-gray-500 border border-dashed border-gray-300 mt-1" onClick={()=>{applyStyle({color:undefined});setShowTx(false);}}>Clear</button>
            </PopoverContent>
          </Popover>
          <div className="w-px h-6 bg-border mx-0.5"/>
          <Button variant="ghost" size="sm" className="h-7 px-2 text-xs gap-1" onClick={()=>addRow()} disabled={!selTable||!columns.length}><Plus className="w-3 h-3"/>Row</Button>
          <Button variant="ghost" size="sm" className="h-7 px-2 text-xs gap-1" onClick={addColumn} disabled={!selTable}><Plus className="w-3 h-3"/>Col</Button>
          {sortCol&&<Button variant="ghost" size="sm" className="h-7 px-2 text-xs gap-1 text-orange-500" onClick={()=>setSortCol(null)}><RefreshCw className="w-3 h-3"/>Clear</Button>}
          <div className="w-px h-6 bg-border mx-0.5"/>

          {/* ══ EASYCOUNT ══ */}
          <Popover open={countOpen} onOpenChange={setCountOpen}>
            <PopoverTrigger asChild><Button variant="ghost" size="sm" className="h-7 px-2 text-xs gap-1"><Calculator className="w-3.5 h-3.5"/>EasyCount</Button></PopoverTrigger>
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
                <Button variant="outline" size="sm" className="w-full h-7 text-xs" onClick={()=>setCountConds([...countConds,{col:"",crit:""}])}><Plus className="w-3 h-3 mr-1"/>Add</Button>
                <Button size="sm" className="w-full h-7 text-xs" onClick={doCount}>Count Rows</Button>
                {countResult!==null&&<div className="p-2 rounded bg-primary/10 text-center"><p className="text-xs text-muted-foreground">Matching rows</p><p className="text-2xl font-bold text-primary">{countResult}</p></div>}
              </div>
            </PopoverContent>
          </Popover>

          {/* ══ SUM (EasyCount ke baju me) ══ */}
          <Button variant="ghost" size="sm" className="h-7 px-2 text-xs gap-1 text-blue-600 hover:bg-blue-50"
            title="Selected cells ka total neeche wale cell me aa jayega"
            onClick={doSum} disabled={!selTable||!columns.length}>
            <Sigma className="w-3.5 h-3.5"/>Sum
          </Button>

          <div className="w-px h-6 bg-border mx-0.5"/>
          {/* ══ SCAN + UPLOAD ══ */}
          <Button variant="ghost" size="sm" className="h-7 px-2 text-xs gap-1" title="Camera se photo lo"
            onClick={()=>camRef.current?.click()}><Camera className="w-3.5 h-3.5"/>Scan</Button>
          <Button variant="ghost" size="sm" className="h-7 px-2 text-xs gap-1" title="Excel / CSV / PNG import"
            onClick={()=>upRef.current?.click()}><Upload className="w-3.5 h-3.5"/>Upload</Button>

          <div className="w-px h-6 bg-border mx-0.5"/>
          <Button variant="ghost" size="sm" className="h-7 px-2 text-xs gap-1" onClick={dlPDF} disabled={!hasAccess}><Download className="w-3.5 h-3.5"/>PDF</Button>
          <Button variant="ghost" size="sm" className="h-7 px-2 text-xs gap-1" onClick={dlExcel} disabled={!hasAccess}><FileSpreadsheet className="w-3.5 h-3.5"/>Excel</Button>
        </div>

        {/* ══ FORMULA BAR ══════════════════════════════════════════════════════ */}
        <div className="flex items-center gap-2 px-3 py-1 border-b bg-white dark:bg-card shrink-0">
          <div className="flex items-center justify-center min-w-[56px] h-6 border rounded text-xs font-mono text-muted-foreground bg-muted/30 px-1">{cellLabel||"—"}</div>
          <div className="w-px h-4 bg-border"/>
          <Input className="h-6 text-xs font-mono border-0 bg-transparent focus-visible:ring-0 p-0 flex-1" placeholder="Click a cell..."
            value={fbar}
            onChange={e=>{setFbar(e.target.value);if(editCell)setEditVal(e.target.value);}}
            onKeyDown={async e=>{
              if(!editCell)return;
              if(e.key==="Enter"){e.preventDefault();await moveCell(editCell.rowId,editCell.colName,editValRef.current,"down");}
              if(e.key==="Escape"){setEditVal(origRef.current);setFbar(origRef.current);setEditCell(null);}
            }}
          />
        </div>

        {/* ══ SHEET TABS ═══════════════════════════════════════════════════════ */}
        <div className="flex items-center border-b bg-[#f0f0f0] dark:bg-muted/30 px-2 pt-1 overflow-x-auto shrink-0">
          {tables.map(t=>(
            <div key={t.id} className="relative group flex items-center shrink-0">
              <button onClick={()=>setSelTable(t)} className={`px-4 py-1.5 text-xs rounded-t border border-b-0 whitespace-nowrap transition-all ${selTable?.id===t.id?"bg-white dark:bg-background border-border font-medium":"border-transparent text-muted-foreground hover:bg-white/50"}`}>{t.name}</button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild><button className="p-0.5 rounded opacity-0 group-hover:opacity-100 text-muted-foreground"><MoreHorizontal className="w-3 h-3"/></button></DropdownMenuTrigger>
                <DropdownMenuContent><DropdownMenuItem onClick={()=>renameTable(t)}><Edit3 className="w-4 h-4 mr-2"/>Rename</DropdownMenuItem><DropdownMenuSeparator/><DropdownMenuItem className="text-destructive" onClick={()=>{setDelTarget(t);setDelOpen(true);}}><Trash2 className="w-4 h-4 mr-2"/>Delete</DropdownMenuItem></DropdownMenuContent>
              </DropdownMenu>
            </div>
          ))}
          {addingTable?(
            <div className="flex items-center gap-1 px-2">
              <Input className="h-6 w-24 text-xs" placeholder="Name..." value={newTableName} onChange={e=>setNewTableName(e.target.value)} autoFocus onKeyDown={e=>{if(e.key==="Enter")createTable();if(e.key==="Escape"){setAddingTable(false);setNewTableName("");}}}/>
              <Button size="sm" className="h-6 px-2 text-xs" onClick={createTable}>Add</Button>
              <Button size="sm" variant="ghost" className="h-6 px-1" onClick={()=>{setAddingTable(false);setNewTableName("");}}><X className="w-3 h-3"/></Button>
            </div>
          ):(
            <button onClick={()=>setAddingTable(true)} className="p-1 ml-1 rounded hover:bg-white/70 text-muted-foreground"><Plus className="w-3.5 h-3.5"/></button>
          )}
        </div>

        {/* ══ GRID ═════════════════════════════════════════════════════════════ */}
        {!selTable?(
          <div className="flex-1 flex items-center justify-center"><div className="text-center"><Table2 className="w-16 h-16 mx-auto mb-4 text-muted-foreground/30"/><h3 className="text-lg font-semibold mb-2">No sheets yet</h3><Button onClick={()=>setAddingTable(true)} className="gap-2 mt-2"><Plus className="w-4 h-4"/>New Sheet</Button></div></div>
        ):columns.length===0?(
          <div className="flex-1 flex items-center justify-center" onContextMenu={e=>openCtx(e)}><div className="text-center"><Table2 className="w-12 h-12 mx-auto mb-3 text-muted-foreground/30"/><h3 className="font-semibold mb-1">Empty Sheet</h3><Button onClick={addColumn} className="gap-2 mt-2"><Plus className="w-4 h-4"/>Add Column</Button></div></div>
        ):(
          <div className="flex-1 overflow-auto bg-white dark:bg-background" style={{overflowX:"auto",overflowY:"auto"}} onContextMenu={e=>openCtx(e)}>
            <table className="border-collapse text-sm min-w-full select-none" style={{tableLayout:"fixed"}}>
              <colgroup>
                <col style={{width:"44px"}}/>
                {columns.map((_,i)=><col key={i} style={{width:"150px"}}/>)}
                <col style={{width:"36px"}}/>
              </colgroup>
              <thead className="sticky top-0 z-20">
                <tr>
                  <th className="bg-[#f2f2f2] dark:bg-muted border border-[#d0d0d0] h-8 sticky left-0 z-30 cursor-pointer hover:bg-[#e0e0e0]"
                    onClick={()=>{const s=new Set<string>();rowsRef.current.forEach(r=>colsRef.current.forEach(c=>s.add(ck(r.id,c.name))));setSelCells(s);toast(`All selected`,{duration:1000});}}>
                    <div className="flex items-center justify-center text-muted-foreground/30 text-xs h-full">⊞</div>
                  </th>
                  {columns.map((col)=>{
                    const colSel=rowsRef.current.length>0&&rowsRef.current.every(r=>selCells.has(ck(r.id,col.name)));
                    const hs=styleMap[hk(col.name)];
                    return(
                      <th key={col.id}
                        className={`border border-[#d0d0d0] h-8 text-xs font-medium select-none relative group transition-colors cursor-pointer ${colSel?"bg-[#cce0ff]":(hs?.bg?"":"bg-[#f2f2f2] dark:bg-muted hover:bg-[#e8e8e8]")}`}
                        style={{background:!colSel&&hs?.bg?hs.bg:undefined,color:hs?.color}}
                        onClick={()=>{if(renamingColId!==col.id)selectCol(col.name);}}
                        onDoubleClick={()=>{setRenamingColId(col.id);setRenamingColVal(col.name);}}
                        onContextMenu={e=>openCtx(e,undefined,col.id,col.name)}
                        title="Click = poora column select · Double-click = rename · Right-click = color / delete"
                      >
                        {renamingColId===col.id?(
                          <div className="flex items-center gap-1 px-1 h-full" onClick={e=>e.stopPropagation()}>
                            <Input
                              className="h-6 text-xs flex-1 min-w-0"
                              value={renamingColVal}
                              autoFocus
                              onChange={e=>setRenamingColVal(e.target.value)}
                              onBlur={()=>updateColumn(col,renamingColVal)}
                              onKeyDown={e=>{
                                if(e.key==="Enter")updateColumn(col,renamingColVal);
                                if(e.key==="Escape")setRenamingColId(null);
                              }}
                            />
                          </div>
                        ):(
                          <div className="flex items-center justify-between px-2 h-full">
                            <span className="truncate">{col.name}</span>
                            <button
                              className="opacity-0 group-hover:opacity-60 p-0.5 rounded hover:bg-white/60 shrink-0"
                              onClick={e=>{e.stopPropagation();setSortCol(col.name);setSortDir(sortCol===col.name&&sortDir==="asc"?"desc":"asc");}}
                            >
                              {sortCol===col.name?(sortDir==="asc"?<SortAsc className="w-3 h-3"/>:<SortDesc className="w-3 h-3"/>):<ChevronDown className="w-3 h-3"/>}
                            </button>
                          </div>
                        )}
                      </th>
                    );
                  })}
                  <th className="bg-[#f2f2f2] dark:bg-muted border border-[#d0d0d0] h-8">
                    <button className="w-full h-full flex items-center justify-center text-muted-foreground hover:bg-[#e0e0e0]" onClick={addColumn}><Plus className="w-3.5 h-3.5"/></button>
                  </th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((r,ri)=>{
                  const rowSel=columns.length>0&&columns.every(c=>selCells.has(ck(r.id,c.name)));
                  return(
                    <tr key={r.id}>
                      <td className={`border border-[#d0d0d0] text-center text-xs text-muted-foreground h-8 font-mono sticky left-0 cursor-pointer transition-colors ${rowSel?"bg-[#cce0ff] font-bold":"bg-[#f2f2f2] dark:bg-muted/40 hover:bg-[#e8e8e8]"}`}
                        onContextMenu={e=>openCtx(e,r.id)}
                        onClick={()=>{setEditCell(null);const s=new Set<string>();colsRef.current.forEach(c=>s.add(ck(r.id,c.name)));setSelCells(s);}}>
                        {ri+1}
                      </td>
                      {columns.map((col,ci)=>{
                        const isEd=editCell?.rowId===r.id&&editCell?.colName===col.name;
                        const isSel=selCells.has(ck(r.id,col.name));
                        const isDH=dragRows.includes(r.id)&&DR.current.anchorColName===col.name;
                        const raw=r.row_data[col.name];
                        const cs=styleMap[ck(r.id,col.name)];

                        return(
                          <td
                            key={col.id}
                            data-rowid={r.id}
                            data-colname={col.name}
                            className={[
                              "border border-[#d0d0d0] h-8 p-0 relative overflow-visible cursor-cell",
                              isEd?"outline outline-2 outline-[#1a73e8] z-10":"",
                              isDH&&!isEd?"!bg-[#b3d4ff]":"",
                              isSel&&!isEd&&!isDH?"bg-[#cce0ff]/60":"",
                              !isSel&&!isEd&&!isDH?"hover:bg-[#f5f5f5]":"",
                            ].join(" ")}
                            style={{background:cs?.bg&&!isSel&&!isDH?cs.bg:undefined}}
                            onContextMenu={e=>openCtx(e,r.id,col.id,col.name)}
                            onMouseDown={e=>{
                              if(e.button!==0||DR.current.active)return;
                              e.preventDefault();
                              selStart.current={r:ri,c:ci};
                              setRangeMode(false);
                              setSelCells(new Set([ck(r.id,col.name)]));
                              startEdit(r.id,col.name,true);
                            }}
                            // ✅ mouse dabaye hue doosre cell par jaoge to RANGE select ho jayega
                            onMouseEnter={()=>{
                              if(DR.current.active)return;
                              if(!selStart.current)return;
                              if((window.event as MouseEvent)?.buttons!==1)return;
                              if(selStart.current.r===ri&&selStart.current.c===ci)return;
                              setRangeMode(true);
                              setEditCell(null);
                              buildRange(selStart.current.r,selStart.current.c,ri,ci);
                            }}
                          >
                            {isEd&&!rangeMode?(
                              <div className="relative w-full h-full">
                                <Input
                                  ref={el=>{cellRefs.current[ck(r.id,col.name)]=el;}}
                                  type="text"
                                  value={editVal}
                                  onChange={e=>{
                                    const v=e.target.value;setEditVal(v);setFbar(v);
                                    setAcSugg(getAC(col.name,v,r.id));
                                  }}
                                  onBlur={async()=>{
                                    await saveCell(r.id,col.name,editValRef.current);
                                    setEditCell(null);setEditVal("");setFbar("");setAcSugg("");
                                  }}
                                  enterKeyHint="next"
                                  onKeyDown={async e=>{
                                    if((e.key==="Tab"||e.key==="ArrowRight")&&acSugg){e.preventDefault();setEditVal(acSugg);setFbar(acSugg);setAcSugg("");if(e.key==="Tab")await moveCell(r.id,col.name,acSugg,"right");return;}
                                    if(e.key==="Enter"){e.preventDefault();if(acSugg){setEditVal(acSugg);await moveCell(r.id,col.name,acSugg,"down");return;}await moveCell(r.id,col.name,editVal,"down");return;}
                                    if(e.key==="Tab"){e.preventDefault();await moveCell(r.id,col.name,editVal,e.shiftKey?"left":"right");return;}
                                    if(e.key==="ArrowDown"){e.preventDefault();await moveCell(r.id,col.name,editVal,"down");return;}
                                    if(e.key==="ArrowUp"){e.preventDefault();await moveCell(r.id,col.name,editVal,"up");return;}
                                    if(e.key==="Escape"){e.preventDefault();setEditVal(origRef.current);setFbar(origRef.current);setEditCell(null);setAcSugg("");return;}
                                    if(e.key.length===1)setAcSugg("");
                                  }}
                                  className="absolute inset-0 h-full w-full border-0 rounded-none bg-background text-xs px-2 focus-visible:ring-0 z-10"
                                  style={{fontWeight:cs?.bold?"bold":"normal",color:cs?.color,textAlign:cs?.align??"left"}}
                                  autoFocus
                                />
                                {acSugg&&(
                                  <div className="absolute inset-0 flex items-center px-2 pointer-events-none z-0 text-xs whitespace-nowrap overflow-hidden">
                                    <span className="invisible">{editVal}</span>
                                    <span className="text-gray-400">{acSugg.slice(editVal.length)}</span>
                                  </div>
                                )}
                              </div>
                            ):(
                              <div className="px-2 h-full flex items-center text-xs overflow-hidden whitespace-nowrap"
                                style={{
                                  fontWeight:cs?.bold?"bold":"normal",
                                  color:cs?.color,
                                  justifyContent:cs?.align==="center"?"center":cs?.align==="right"?"flex-end":"flex-start",
                                }}>
                                {raw==null||raw===""?<span className="text-transparent">·</span>:String(raw)}
                              </div>
                            )}

                            {/* DRAG FILL HANDLE — sirf single cell select par */}
                            {isSel&&selCells.size===1&&(
                              <div
                                className="absolute z-50 cursor-crosshair"
                                style={{
                                  bottom:"-5px",right:"-5px",width:"10px",height:"10px",
                                  background:"#1a73e8",border:"2px solid white",
                                  boxShadow:"0 0 0 1px #1a73e8",pointerEvents:"all",
                                }}
                                title="Drag to fill • Ctrl = copy"
                                onMouseDown={e=>{
                                  e.preventDefault();e.stopPropagation();
                                  selStart.current=null;
                                  const anchorIdx=rowsRef.current.findIndex(x=>x.id===r.id);
                                  DR.current={
                                    active:true,anchorRowId:r.id,anchorColName:col.name,anchorIdx,
                                    anchorVal:r.row_data[col.name],endRowId:r.id,endIdx:anchorIdx,isCopy:false,
                                  };
                                  setDragRows([r.id]);
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

                {/* ✅ auto TOTAL row hata diya gaya — sheet ab bilkul plain hai */}
                <tr>
                  <td colSpan={columns.length+2}>
                    <button className="w-full h-8 text-xs text-muted-foreground hover:bg-gray-50 flex items-center justify-center gap-1 border-t border-[#d0d0d0]" onClick={()=>addRow()}>
                      <Plus className="w-3.5 h-3.5"/>Add Row
                    </button>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        )}

        {/* ══ STATUS BAR — Excel jaisa live Sum / Average / Count ══ */}
        <div className="flex items-center justify-between px-4 py-1 border-t bg-[#f0f0f0] dark:bg-muted/30 text-xs text-muted-foreground shrink-0 gap-4">
          <span>{filtered.length} rows · {columns.length} cols</span>
          <span className="flex items-center gap-4 font-medium text-[#1a73e8] whitespace-nowrap overflow-hidden">
            {DR.current.active&&"Drag to fill • Ctrl = copy"}
            {!DR.current.active&&stats.numCount>0&&<>
              <span>Sum: {Number(stats.sum.toFixed(2)).toLocaleString("en-IN")}</span>
              <span>Average: {Number(stats.avg.toFixed(2)).toLocaleString("en-IN")}</span>
              <span>Count: {stats.numCount}</span>
            </>}
            {!DR.current.active&&stats.numCount===0&&stats.count>1&&<span>{stats.count} cells selected</span>}
          </span>
          <span className="font-medium">{selTable?.name??""}</span>
        </div>
      </div>
    </>
  );
}
