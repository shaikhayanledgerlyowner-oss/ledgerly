import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Plus, Table2, Trash2, Edit3, Search, SortAsc, SortDesc,
  MoreHorizontal, X, Calculator, Download, FileSpreadsheet,
  AlignLeft, AlignCenter, AlignRight, Palette, RefreshCw,
  ChevronDown, Calendar, Hash, DollarSign, Type,
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

type ColType = "text"|"number"|"currency"|"date"|"amount";
interface DbTable  { id:string; user_id:string; name:string; created_at:string; }
interface DbColumn { id:string; table_id:string; name:string; type:string; created_at:string; }
interface DbRow    { id:string; table_id:string; row_data:Record<string,any>; created_at:string; }
interface CellStyle{ bg?:string; color?:string; bold?:boolean; align?:"left"|"center"|"right"; }
type StyleMap = Record<string,CellStyle>;

// ── pure helpers ─────────────────────────────────────────────────────────────
const toNum=(v:any):number=>{
  if(v==null||v==="") return 0;
  if(typeof v==="number") return isFinite(v)?v:0;
  const n=Number(String(v).replace(/,/g,""));
  return isFinite(n)?n:0;
};
const safeFile=(n:string)=>String(n||"table").replace(/[\/\\:*?"<>|]/g,"-").trim()||"table";
const toISO=(val:string):string=>{
  if(!val) return "";
  if(/^\d{4}-\d{2}-\d{2}$/.test(val)) return val;
  const m=val.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if(m){const d=new Date(+m[3],+m[2]-1,+m[1]);if(!isNaN(d.getTime()))return d.toISOString().slice(0,10);}
  const d=new Date(val); return isNaN(d.getTime())?"":d.toISOString().slice(0,10);
};
const toDMY=(iso:string):string=>{
  if(!iso) return "";
  const d=new Date(iso+"T00:00:00");
  if(isNaN(d.getTime())) return iso;
  return `${String(d.getDate()).padStart(2,"0")}/${String(d.getMonth()+1).padStart(2,"0")}/${d.getFullYear()}`;
};
const dispCell=(v:any,t:ColType):string=>{
  if(v==null||v==="") return "";
  if(t==="currency") return `₹${toNum(v).toLocaleString("en-IN")}`;
  if(t==="amount")   return `₹${toNum(v).toLocaleString("en-IN")}`;
  if(t==="number")   return toNum(v).toLocaleString("en-IN");
  if(t==="date")     return toDMY(String(v));
  return String(v);
};

// ── fill series ───────────────────────────────────────────────────────────────
// isCopy=true  → always return anchorVal (Ctrl+drag)
// isCopy=false → number/date series; text always copies
const calcFill=(anchor:any, t:ColType, step:number, isCopy:boolean):any=>{
  if(isCopy || t==="text") return anchor;
  if(t==="number"||t==="currency"||t==="amount") return toNum(anchor)+step;
  if(t==="date"&&anchor){
    const d=new Date(String(anchor)+"T00:00:00");
    if(!isNaN(d.getTime())){d.setDate(d.getDate()+step);return d.toISOString().slice(0,10);}
  }
  return anchor;
};

const BG_COLORS=["#ffffff","#fef9c3","#dcfce7","#dbeafe","#fce7f3","#fee2e2","#e0e7ff","#f3f4f6","#ffd700","#ff8c00","#ff6b6b","#22c55e","#3b82f6","#a855f7","#1e293b"];
const TX_COLORS=["#000000","#1e293b","#dc2626","#16a34a","#2563eb","#9333ea","#ea580c","#0891b2","#ffffff","#6b7280"];
const TYPE_ICO:Record<string,React.ReactNode>={
  text:<Type className="w-3 h-3"/>,number:<Hash className="w-3 h-3"/>,
  currency:<DollarSign className="w-3 h-3"/>,date:<Calendar className="w-3 h-3"/>,
  amount:<span className="text-[10px] font-bold leading-none">₹</span>,
};
const colLetter=(i:number):string=>{
  let s="",n=i+1;while(n>0){s=String.fromCharCode(64+(n%26||26))+s;n=Math.floor((n-1)/26);}return s;
};
const ck=(r:string,c:string)=>`${r}__${c}`;

interface Ctx{x:number;y:number;rowId?:string;colId?:string;colName?:string;}

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

  // ── drag fill: 100% ref-based, zero state dependency ──────────────────────
  // These refs hold the ONLY source of truth for drag logic
  const DR=useRef({
    active: false,
    anchorRowId: "",
    anchorColName: "",
    anchorIdx: -1,
    anchorVal: null as any,
    colType: "text" as ColType,
    endRowId: "",
    endIdx: -1,
    isCopy: false,
  });
  const [dragRows,setDragRows]=useState<string[]>([]); // just for visual highlight

  const [renamingColId,setRenamingColId]=useState<string|null>(null);
  const [renamingColVal,setRenamingColVal]=useState("");
  const [renamingColType,setRenamingColType]=useState<ColType>("text");
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
    // clear history on table switch
    undoStack.current=[];redoStack.current=[];
    setCanUndo(false);setCanRedo(false);
  },[selTable?.id]);

  const saveStyles=async(map:StyleMap)=>{
    if(!selTable)return;
    await supabase.from("user_tables").update({style_map:JSON.stringify(map)} as any).eq("id",selTable.id);
  };
  const applyStyle=(patch:Partial<CellStyle>)=>{
    if(!selCells.size) return;
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
    setTimeout(()=>{const nc=colsRef.current.at(-1);if(nc){setRenamingColId(nc.id);setRenamingColVal(nc.name);setRenamingColType("text");}},80);
  };
  const deleteColumn=async(col:DbColumn)=>{
    await supabase.from("user_columns").delete().eq("id",col.id);
    if(rows.length)await Promise.all(rows.map(r=>{const rd={...r.row_data};delete rd[col.name];return supabase.from("user_rows").update({row_data:rd}).eq("id",r.id);}));
    await loadData(selTable!.id);
  };
  const updateColumn=async(col:DbColumn,nm:string,tp:ColType)=>{
    if(!nm.trim())return;
    await supabase.from("user_columns").update({name:nm.trim(),type:tp}).eq("id",col.id);
    if(rows.length&&col.name!==nm.trim())await Promise.all(rows.map(r=>{const rd={...r.row_data};rd[nm.trim()]=rd[col.name];delete rd[col.name];return supabase.from("user_rows").update({row_data:rd}).eq("id",r.id);}));
    setRenamingColId(null);if(selTable)await loadData(selTable.id);
  };

  // ── row CRUD ──────────────────────────────────────────────────────────────
  const addRow=async()=>{
    if(!selTable||!columns.length)return;
    const empty:Record<string,any>={};columns.forEach(c=>(empty[c.name]=""));
    const {error}=await supabase.from("user_rows").insert({table_id:selTable.id,row_data:empty});
    if(error)return toast.error(error.message);
    await loadData(selTable.id);
    setTimeout(()=>{const nr=rowsRef.current.at(-1);if(nr&&colsRef.current[0])startEdit(nr.id,colsRef.current[0].name,true);},80);
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
    const col=colsRef.current.find(c=>c.name===colName);
    const type=(col?.type as ColType)??"text";
    const row=rowsRef.current.find(r=>r.id===rowId);
    const raw=(row?.row_data??{})[colName];
    const sv=raw==null?"":String(raw);
    origRef.current=sv;
    setEditCell({rowId,colName});
    setEditVal(sv);
    setFbar(type==="date"?toDMY(sv):sv);
    setSelCells(new Set([ck(rowId,colName)]));
    setAcSugg("");
    if(focus)focusCell(rowId,colName);
  };

  const saveCell=async(rowId:string,colName:string,val:string,skipHistory=false)=>{
    if(savingRef.current){
      // wait briefly and retry once
      await new Promise(r=>setTimeout(r,50));
    }
    savingRef.current=true;
    try{
      const col=colsRef.current.find(c=>c.name===colName);
      const type=(col?.type as ColType)??"text";
      let value:any=val;
      if(type==="number"||type==="currency"||type==="amount")value=val===""?"":toNum(val);
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
    }finally{
      savingRef.current=false;
    }
  };

  // ── undo / redo ───────────────────────────────────────────────────────────
  const doUndo=async()=>{
    const entry=undoStack.current.pop();
    if(!entry){toast("Nothing to undo",{duration:800});return;}
    redoStack.current.push(entry);
    setCanUndo(undoStack.current.length>0);setCanRedo(true);
    // directly update rows + DB, bypass saveCell history tracking
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
  // keep refs updated so keydown listener always calls latest version
  useEffect(()=>{doUndoRef.current=doUndo;doRedoRef.current=doRedo;});

  const filtered=useMemo(()=>{
    let list=[...rows];
    if(search.trim()){const q=search.toLowerCase();list=list.filter(r=>Object.values(r.row_data).some(v=>String(v??"").toLowerCase().includes(q)));}
    if(sortCol){
      const col=columns.find(c=>c.name===sortCol);const tp=(col?.type as ColType)??"text";
      list.sort((a,b)=>{
        const av=a.row_data[sortCol]??"",bv=b.row_data[sortCol]??"";
        if(tp==="number"||tp==="currency"||tp==="amount")return sortDir==="asc"?toNum(av)-toNum(bv):toNum(bv)-toNum(av);
        return sortDir==="asc"?String(av).localeCompare(String(bv)):String(bv).localeCompare(String(av));
      });
    }
    return list;
  },[rows,search,sortCol,sortDir,columns]);
  useEffect(()=>{rowsRef.current=filtered;},[filtered]);

  // ── Ctrl+Z / Ctrl+Y global ─────────────────────────────────────────────────
  // doUndo/doRedo are defined AFTER this, so use refs to avoid stale closure
  const doUndoRef=useRef<()=>Promise<void>>(async()=>{});
  const doRedoRef=useRef<()=>Promise<void>>(async()=>{});
  useEffect(()=>{
    const onKey=async(e:KeyboardEvent)=>{
      if((e.ctrlKey||e.metaKey)&&!e.shiftKey&&e.key==="z"){e.preventDefault();await doUndoRef.current();}
      if((e.ctrlKey||e.metaKey)&&(e.key==="y"||(e.shiftKey&&e.key==="z"))){e.preventDefault();await doRedoRef.current();}
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

  const totals=useMemo(()=>{
    const t:Record<string,number>={};
    columns.forEach(c=>{if(c.type==="number"||c.type==="currency"||c.type==="amount")t[c.name]=rows.reduce((s,r)=>s+toNum(r.row_data[c.name]),0);});
    return t;
  },[columns,rows]);

  // ── DRAG FILL — completely self-contained ─────────────────────────────────
  // Strategy: listen to window mousemove + mouseup
  // Everything stored in DR ref — no React state involved in the logic
  useEffect(()=>{
    const onMove=(e:MouseEvent)=>{
      if(!DR.current.active) return;
      // find which row the mouse is over using elementsFromPoint
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
            // update highlight
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
      if(!DR.current.active)return;
      DR.current.isCopy=e.ctrlKey||e.metaKey; // ✅ read directly from mouseup event — always accurate
      DR.current.active=false;
      setDragRows([]);

      const {anchorIdx,anchorColName,anchorVal,colType,endIdx,isCopy}=DR.current;
      if(anchorIdx<0||endIdx<0||anchorIdx===endIdx){return;}

      const from=Math.min(anchorIdx,endIdx);
      const to=Math.max(anchorIdx,endIdx);
      const list=rowsRef.current;

      for(let i=from;i<=to;i++){
        if(i===anchorIdx)continue;
        const targetRow=list[i];if(!targetRow)continue;
        const step=i-anchorIdx; // positive=down, negative=up
        const newVal=calcFill(anchorVal,colType,step,isCopy);
        const rd={...(targetRow.row_data??{})};
        setRows(p=>p.map(r=>r.id!==targetRow.id?r:{...r,row_data:{...r.row_data,[anchorColName]:newVal}}));
        await supabase.from("user_rows").update({row_data:{...rd,[anchorColName]:newVal}}).eq("id",targetRow.id);
      }
      toast.success(isCopy?"Copied (Ctrl)!":colType==="text"?"Copied!":"Series filled!");
    };

    window.addEventListener("mousemove",onMove);
    window.addEventListener("mouseup",onUp);
    return()=>{window.removeEventListener("mousemove",onMove);window.removeEventListener("mouseup",onUp);};
  },[]); // ✅ empty deps — reads everything from DR ref and rowsRef, never stale

  // ── select column ─────────────────────────────────────────────────────────
  const selectCol=(colName:string)=>{
    setEditCell(null);
    const s=new Set<string>();rowsRef.current.forEach(r=>s.add(ck(r.id,colName)));
    setSelCells(s);
  };

  // ── context menu ──────────────────────────────────────────────────────────
  const openCtx=(e:React.MouseEvent,rowId?:string,colId?:string,colName?:string)=>{
    e.preventDefault();e.stopPropagation();setCtx({x:e.clientX,y:e.clientY,rowId,colId,colName});
  };
  useEffect(()=>{const c=()=>setCtx(null);window.addEventListener("click",c);return()=>window.removeEventListener("click",c);},[]);

  const doCount=()=>{
    const a=countConds.filter(c=>c.col&&c.crit);
    if(!a.length)return toast.error("Add at least 1 condition");
    const n=rows.filter(r=>a.every(c=>String(r.row_data[c.col]??"").toLowerCase().includes(c.crit.toLowerCase()))).length;
    setCountResult(n);toast.success(`Found ${n} rows`);
  };

  // ── downloads ─────────────────────────────────────────────────────────────
  const dlPDF=()=>{
    if(!hasAccess)return toast.error("Upgrade to download");
    if(!selTable||!columns.length)return;
    const doc=new jsPDF({orientation:"l",unit:"pt",format:"a4"});
    doc.setFont("helvetica","bold");doc.setFontSize(16);doc.text(selTable.name,40,45);
    doc.setFont("helvetica","normal");doc.setFontSize(10);doc.text(`Exported: ${new Date().toLocaleString()}`,40,62);
    const body=filtered.map(r=>columns.map(c=>{
      const v=r.row_data[c.name];const t=c.type as ColType;
      if(t==="currency"||t==="amount")return`Rs. ${toNum(v).toLocaleString("en-IN",{minimumFractionDigits:2})}`;
      if(t==="number")return toNum(v).toLocaleString("en-IN");
      if(t==="date")return toDMY(String(v??""));
      return v==null?"":String(v);
    }));
    if(Object.keys(totals).length)body.push(columns.map((c,i)=>{const t=totals[c.name];return t!=null?(c.type==="currency"?`Rs. ${t.toLocaleString("en-IN",{minimumFractionDigits:2})}`:t.toLocaleString("en-IN")):(i===0?"Total":"");}));
    autoTable(doc,{startY:75,head:[columns.map(c=>c.name)],body,styles:{font:"helvetica",fontSize:9,cellPadding:5},headStyles:{fillColor:[30,30,30],textColor:255},margin:{left:40,right:40}});
    doc.save(`${safeFile(selTable.name)}.pdf`);toast.success("PDF downloaded");
  };

  const dlExcel=()=>{
    if(!hasAccess)return toast.error("Upgrade to download");
    if(!selTable||!columns.length)return;
    const header=columns.map(c=>c.name);
    const data=filtered.map(r=>columns.map(c=>{
      const v=r.row_data[c.name];const t=c.type as ColType;
      if(t==="number"||t==="currency"||t==="amount")return v===""||v==null?"":toNum(v);
      if(t==="date")return toDMY(String(v??""));
      return v==null?"":String(v);
    }));
    if(Object.keys(totals).length)data.push(columns.map((c,i)=>{const t=totals[c.name];return t!=null?t:(i===0?"Total":"")}) as any);
    const ws=XLSX.utils.aoa_to_sheet([header,...data]);
    const range=XLSX.utils.decode_range(ws["!ref"]||"A1");
    for(let ri=0;ri<=range.e.r;ri++)for(let ci=0;ci<=range.e.c;ci++){
      const addr=XLSX.utils.encode_cell({r:ri,c:ci});if(!ws[addr])continue;
      const ro=ri===0?null:filtered[ri-1];const co=columns[ci];
      const sk=ro&&co?ck(ro.id,co.name):"";const cs=sk?styleMap[sk]:undefined;const isH=ri===0;
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

  const cellLabel=useMemo(()=>{
    if(selCells.size===0)return"";
    if(selCells.size>1)return`${selCells.size} cells`;
    const k=[...selCells][0];const[rid,cn]=k.split("__");
    const ci=columns.findIndex(c=>c.name===cn);const ri=rowsRef.current.findIndex(r=>r.id===rid);
    return`${colLetter(ci)}${ri+1}`;
  },[selCells,columns]);

  const firstStyle=useMemo(()=>{const k=[...selCells][0];return k?(styleMap[k]??{} as CellStyle):{} as CellStyle;},[selCells,styleMap]);

  // ═══════════════════════════════════════════════════════════════════════════
  return(
    <>
      <AlertDialog open={delOpen} onOpenChange={setDelOpen}>
        <AlertDialogContent>
          <AlertDialogHeader><AlertDialogTitle>Delete "{delTarget?.name}"?</AlertDialogTitle><AlertDialogDescription>All data will be permanently deleted.</AlertDialogDescription></AlertDialogHeader>
          <AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction onClick={async()=>{if(delTarget){await deleteTable(delTarget.id);setDelOpen(false);setDelTarget(null);}}}>Delete</AlertDialogAction></AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {ctx&&(
        <div className="fixed z-50 bg-card border shadow-xl rounded-lg py-1 min-w-[180px] text-sm" style={{top:ctx.y,left:ctx.x}} onClick={e=>e.stopPropagation()}>
          {ctx.rowId&&<><button className="w-full px-4 py-2 text-left hover:bg-muted flex items-center gap-2" onClick={()=>{addRow();setCtx(null);}}><Plus className="w-3.5 h-3.5"/>Insert Row Below</button><button className="w-full px-4 py-2 text-left hover:bg-muted text-destructive flex items-center gap-2" onClick={()=>{deleteRow(ctx.rowId!);setCtx(null);}}><Trash2 className="w-3.5 h-3.5"/>Delete Row</button><div className="border-t my-1"/></>}
          {ctx.colId&&<><button className="w-full px-4 py-2 text-left hover:bg-muted flex items-center gap-2" onClick={()=>{addColumn();setCtx(null);}}><Plus className="w-3.5 h-3.5"/>Insert Column</button><button className="w-full px-4 py-2 text-left hover:bg-muted text-destructive flex items-center gap-2" onClick={()=>{const col=columns.find(c=>c.id===ctx.colId);if(col)deleteColumn(col);setCtx(null);}}><Trash2 className="w-3.5 h-3.5"/>Delete Column</button></>}
          {!ctx.rowId&&!ctx.colId&&<><button className="w-full px-4 py-2 text-left hover:bg-muted flex items-center gap-2" onClick={()=>{addRow();setCtx(null);}}><Plus className="w-3.5 h-3.5"/>Add Row</button><button className="w-full px-4 py-2 text-left hover:bg-muted flex items-center gap-2" onClick={()=>{addColumn();setCtx(null);}}><Plus className="w-3.5 h-3.5"/>Add Column</button></>}
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
          {/* Undo / Redo */}
          <button title="Undo (Ctrl+Z)" onClick={doUndo} disabled={!canUndo}
            className={`w-7 h-7 flex items-center justify-center rounded border border-transparent text-sm font-bold transition-colors ${canUndo?"hover:bg-white text-gray-700":"text-gray-300 cursor-not-allowed"}`}>
            ↩
          </button>
          <button title="Redo (Ctrl+Y)" onClick={doRedo} disabled={!canRedo}
            className={`w-7 h-7 flex items-center justify-center rounded border border-transparent text-sm font-bold transition-colors ${canRedo?"hover:bg-white text-gray-700":"text-gray-300 cursor-not-allowed"}`}>
            ↪
          </button>
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
          <Button variant="ghost" size="sm" className="h-7 px-2 text-xs gap-1" onClick={addRow} disabled={!selTable||!columns.length}><Plus className="w-3 h-3"/>Row</Button>
          <Button variant="ghost" size="sm" className="h-7 px-2 text-xs gap-1" onClick={addColumn} disabled={!selTable}><Plus className="w-3 h-3"/>Col</Button>
          {sortCol&&<Button variant="ghost" size="sm" className="h-7 px-2 text-xs gap-1 text-orange-500" onClick={()=>setSortCol(null)}><RefreshCw className="w-3 h-3"/>Clear</Button>}
          <div className="w-px h-6 bg-border mx-0.5"/>
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
            onChange={e=>{
              setFbar(e.target.value);
              if(editCell){const col=colsRef.current.find(c=>c.name===editCell.colName);const t=(col?.type as ColType)??"text";setEditVal(t==="date"?toISO(e.target.value):e.target.value);}
            }}
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
            <table className="border-collapse text-sm min-w-full" style={{tableLayout:"fixed"}}>
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
                    const type=(col.type as ColType)??"text";
                    // check if entire column is selected (for highlight)
                    const colSel=rowsRef.current.length>0&&rowsRef.current.every(r=>selCells.has(ck(r.id,col.name)));
                    // get first cell style of this column for color preview
                    const firstColStyle=rowsRef.current[0]?styleMap[ck(rowsRef.current[0].id,col.name)]:undefined;
                    return(
                      <th key={col.id}
                        className={`border border-[#d0d0d0] h-8 text-xs font-medium select-none relative group transition-colors ${colSel?"bg-[#cce0ff]":"bg-[#f2f2f2] dark:bg-muted"}`}
                        onContextMenu={e=>openCtx(e,undefined,col.id,col.name)}
                      >
                        {renamingColId===col.id?(
                          // ── EDIT MODE ──
                          <div className="flex items-center gap-1 px-1 h-full" onClick={e=>e.stopPropagation()}>
                            <Input
                              className="h-6 text-xs flex-1 min-w-0"
                              value={renamingColVal}
                              autoFocus
                              onChange={e=>setRenamingColVal(e.target.value)}
                              onBlur={()=>updateColumn(col,renamingColVal,renamingColType)}
                              onKeyDown={e=>{
                                if(e.key==="Enter")updateColumn(col,renamingColVal,renamingColType);
                                if(e.key==="Escape")setRenamingColId(null);
                              }}
                            />
                            <Select value={renamingColType} onValueChange={v=>setRenamingColType(v as ColType)}>
                              <SelectTrigger className="h-6 w-8 p-0 border-0 bg-transparent [&>svg]:hidden shrink-0">
                                <span className="flex items-center justify-center">{TYPE_ICO[renamingColType]}</span>
                              </SelectTrigger>
                              <SelectContent>
                                {["text","number","currency","amount","date"].map(t=>(
                                  <SelectItem key={t} value={t}>
                                    <span className="flex gap-2 items-center">{TYPE_ICO[t]}{t==="amount"?"Amount (₹)":t.charAt(0).toUpperCase()+t.slice(1)}</span>
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                        ):(
                          // ── DISPLAY MODE ──
                          <div className="flex items-center justify-between px-1.5 h-full">
                            {/* Left: icon + name — click to edit */}
                            <div
                              className="flex items-center gap-1 overflow-hidden flex-1 cursor-pointer hover:bg-white/50 rounded px-1 h-6"
                              onClick={e=>{
                                e.stopPropagation();
                                setRenamingColId(col.id);
                                setRenamingColVal(col.name);
                                setRenamingColType(type);
                              }}
                              title="Click to rename / change type"
                            >
                              <span className="text-muted-foreground/40 shrink-0">{TYPE_ICO[type]}</span>
                              <span className="truncate text-xs">{col.name}</span>
                            </div>

                            {/* Right: color + sort — always visible on hover */}
                            <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 shrink-0">
                              {/* Column color button */}
                              <Popover>
                                <PopoverTrigger asChild>
                                  <button
                                    className="w-5 h-5 flex items-center justify-center rounded hover:bg-white/70"
                                    title="Color this column"
                                    onClick={e=>e.stopPropagation()}
                                  >
                                    <div className="w-3 h-3 rounded-sm border border-gray-400" style={{background:firstColStyle?.bg??"transparent"}}/>
                                  </button>
                                </PopoverTrigger>
                                <PopoverContent className="w-auto p-2 z-50" align="start" onClick={e=>e.stopPropagation()}>
                                  <p className="text-xs font-semibold mb-2 text-gray-600">Column color</p>
                                  <div className="grid grid-cols-5 gap-1 mb-1">
                                    {BG_COLORS.map(c=>(
                                      <button key={c}
                                        className="w-6 h-6 rounded border-2 hover:scale-110 transition-all border-gray-200"
                                        style={{background:c}}
                                        onClick={e=>{
                                          e.stopPropagation();
                                          // apply bg to ALL cells in this column
                                          setStyleMap(prev=>{
                                            const next={...prev};
                                            rowsRef.current.forEach(r=>{
                                              const k=ck(r.id,col.name);
                                              next[k]={...(next[k]??{}),bg:c};
                                            });
                                            saveStyles(next);
                                            return next;
                                          });
                                        }}
                                      />
                                    ))}
                                  </div>
                                  <button
                                    className="w-full text-xs py-1 rounded hover:bg-gray-100 text-gray-500 border border-dashed border-gray-300"
                                    onClick={e=>{
                                      e.stopPropagation();
                                      setStyleMap(prev=>{
                                        const next={...prev};
                                        rowsRef.current.forEach(r=>{
                                          const k=ck(r.id,col.name);
                                          if(next[k])delete next[k].bg;
                                        });
                                        saveStyles(next);
                                        return next;
                                      });
                                    }}
                                  >Clear</button>
                                </PopoverContent>
                              </Popover>

                              {/* Sort button */}
                              <button
                                className="w-5 h-5 flex items-center justify-center rounded hover:bg-white/70"
                                title="Sort"
                                onClick={e=>{e.stopPropagation();setSortCol(col.name);setSortDir(sortCol===col.name&&sortDir==="asc"?"desc":"asc");}}
                              >
                                {sortCol===col.name
                                  ?(sortDir==="asc"?<SortAsc className="w-3 h-3"/>:<SortDesc className="w-3 h-3"/>)
                                  :<ChevronDown className="w-3 h-3 opacity-40"/>}
                              </button>
                            </div>
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
                        onClick={()=>{const s=new Set<string>();colsRef.current.forEach(c=>s.add(ck(r.id,c.name)));setSelCells(s);}}>
                        {ri+1}
                      </td>
                      {columns.map(col=>{
                        const type=(col.type as ColType)??"text";
                        const isEd=editCell?.rowId===r.id&&editCell?.colName===col.name;
                        const isSel=selCells.has(ck(r.id,col.name));
                        // drag highlight: this row is in drag range AND same column
                        const isDH=dragRows.includes(r.id)&&DR.current.anchorColName===col.name;
                        const raw=r.row_data[col.name];
                        const cs=styleMap[ck(r.id,col.name)];

                        return(
                          <td
                            key={col.id}
                            // ✅ data attrs used by mousemove elementsFromPoint
                            data-rowid={r.id}
                            data-colname={col.name}
                            className={[
                              "border border-[#d0d0d0] h-8 p-0 relative overflow-visible cursor-cell",
                              isEd?"outline outline-2 outline-[#1a73e8] z-10":"",
                              isDH&&!isEd?"!bg-[#b3d4ff]":"",
                              isSel&&!isEd&&!isDH?"bg-[#cce0ff]/50":"",
                              !isSel&&!isEd&&!isDH?"hover:bg-[#f5f5f5]":"",
                            ].join(" ")}
                            style={{background:cs?.bg&&!isSel&&!isDH?cs.bg:undefined}}
                            onContextMenu={e=>openCtx(e,r.id,col.id,col.name)}
                            onMouseDown={e=>{
                              if(e.button!==0||DR.current.active)return;
                              e.preventDefault();
                              // select cell immediately so drag handle shows at once
                              setSelCells(new Set([ck(r.id,col.name)]));
                              startEdit(r.id,col.name,true);
                            }}
                          >
                            {isEd?(
                              <div className="relative w-full h-full">
                                <Input
                                  ref={el=>{cellRefs.current[ck(r.id,col.name)]=el;}}
                                  type={type==="date"?"date":"text"}
                                  inputMode={type==="number"||type==="currency"||type==="amount"?"decimal":undefined}
                                  value={editVal}
                                  onChange={e=>{
                                    const v=e.target.value;setEditVal(v);
                                    setFbar(type==="date"?toDMY(v):v);
                                    if(type==="text")setAcSugg(getAC(col.name,v,r.id));
                                  }}
                                  onBlur={async()=>{
                                    await saveCell(r.id,col.name,editValRef.current);
                                    setEditCell(null);setEditVal("");setFbar("");setAcSugg("");
                                  }}
                                  enterKeyHint="next"
                                  onKeyDown={async e=>{
                                    if((e.key==="Tab"||e.key==="ArrowRight")&&acSugg){e.preventDefault();setEditVal(acSugg);setFbar(acSugg);setAcSugg("");if(e.key==="Tab")await moveCell(r.id,col.name,acSugg,"right");return;}
                                    if(e.key==="Enter"){if(acSugg){setEditVal(acSugg);await moveCell(r.id,col.name,acSugg,"down");return;}e.preventDefault();await moveCell(r.id,col.name,editVal,"down");return;}
                                    if(e.key==="Tab"){e.preventDefault();await moveCell(r.id,col.name,editVal,e.shiftKey?"left":"right");return;}
                                    if(e.key==="ArrowDown"&&type!=="date"){e.preventDefault();await moveCell(r.id,col.name,editVal,"down");return;}
                                    if(e.key==="ArrowUp"&&type!=="date"){e.preventDefault();await moveCell(r.id,col.name,editVal,"up");return;}
                                    if(e.key==="Escape"){e.preventDefault();setEditVal(origRef.current);setFbar(type==="date"?toDMY(origRef.current):origRef.current);setEditCell(null);setAcSugg("");return;}
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
                              <div className={`px-2 h-full flex items-center text-xs overflow-hidden whitespace-nowrap ${type==="currency"||type==="amount"?"text-primary font-medium":""} ${type==="number"&&!cs?.align?"justify-end":""}`}
                                style={{fontWeight:cs?.bold?"bold":"normal",color:cs?.color,justifyContent:cs?.align==="center"?"center":cs?.align==="right"?"flex-end":cs?.align==="left"?"flex-start":undefined}}>
                                {dispCell(raw,type)||<span className="text-transparent">·</span>}
                              </div>
                            )}

                            {/* DRAG HANDLE — visible on any selected cell */}
                            {isSel&&(
                              <div
                                className="absolute z-50 cursor-crosshair"
                                style={{
                                  bottom:"-5px",
                                  right:"-5px",
                                  width:"10px",
                                  height:"10px",
                                  background:"#1a73e8",
                                  border:"2px solid white",
                                  boxShadow:"0 0 0 1px #1a73e8",
                                  pointerEvents:"all",
                                }}
                                title="Drag to fill • Ctrl = copy"
                                onMouseDown={e=>{
                                  e.preventDefault();e.stopPropagation();
                                  const anchorIdx=rowsRef.current.findIndex(x=>x.id===r.id);
                                  DR.current={
                                    active:true,
                                    anchorRowId:r.id,
                                    anchorColName:col.name,
                                    anchorIdx,
                                    anchorVal:r.row_data[col.name],
                                    colType:type,
                                    endRowId:r.id,
                                    endIdx:anchorIdx,
                                    isCopy:false,
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

                {rows.length>0&&Object.keys(totals).length>0&&(
                  <tr>
                    <td className="bg-[#f2f2f2] border border-[#d0d0d0] text-center text-xs text-muted-foreground font-mono h-8 sticky left-0">Σ</td>
                    {columns.map((col,i)=>{const t=totals[col.name];const tp=col.type as ColType;return(
                      <td key={col.id} className="bg-[#f7f7f7] border border-[#d0d0d0] px-2 h-8 text-xs font-semibold">
                        {t!=null?<span className={tp==="currency"?"text-primary":""}>{tp==="currency"?`₹${t.toLocaleString("en-IN")}`:t.toLocaleString("en-IN")}</span>:(i===0?<span className="text-muted-foreground">Total</span>:"")}
                      </td>
                    );})}
                    <td className="border border-[#d0d0d0] bg-[#f7f7f7]"/>
                  </tr>
                )}
                <tr>
                  <td colSpan={columns.length+2}>
                    <button className="w-full h-8 text-xs text-muted-foreground hover:bg-gray-50 flex items-center justify-center gap-1 border-t border-[#d0d0d0]" onClick={addRow}>
                      <Plus className="w-3.5 h-3.5"/>Add Row
                    </button>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        )}

        {/* Status bar */}
        <div className="flex items-center justify-between px-4 py-1 border-t bg-[#f0f0f0] dark:bg-muted/30 text-xs text-muted-foreground shrink-0">
          <span>{filtered.length} rows · {columns.length} cols</span>
          <span className="text-[#1a73e8] font-medium">
            {DR.current.active ? "Drag to fill • release Ctrl = series, hold Ctrl = copy" : ""}
            {selCells.size>1&&!DR.current.active?`${selCells.size} cells selected`:""}
          </span>
          <span className="font-medium">{selTable?.name??""}</span>
        </div>
      </div>
    </>
  );
}
