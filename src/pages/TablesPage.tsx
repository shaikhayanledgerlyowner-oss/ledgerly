import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Plus, Table2, Trash2, Edit3, Search, SortAsc, SortDesc,
  MoreHorizontal, X, Calculator, Download, FileSpreadsheet,
  AlignLeft, AlignCenter, AlignRight, Palette, RefreshCw,
  ChevronDown, Sigma, Upload,
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
// `text` sirf sheet-title (META__title) ke liye use hota hai
interface CellStyle{ bg?:string; color?:string; bold?:boolean; align?:"left"|"center"|"right"; text?:string; }
type StyleMap = Record<string,CellStyle>;

// ── pure helpers ─────────────────────────────────────────────────────────────
// NOTE: sheet "plain text" hai — jo type karoge wahi dikhega (Excel jaisa).

const safeFile=(n:string)=>String(n||"table").replace(/[\/\\:*?"<>|]/g,"-").trim()||"table";

const parseNum=(v:any):number|null=>{
  if(v==null) return null;
  const s=String(v).replace(/[₹$,\s]/g,"").trim();
  if(s==="") return null;
  const n=Number(s);
  return isFinite(n)?n:null;
};

// ── fill series (drag handle) ────────────────────────────────────────────────
const calcFill=(anchor:any, step:number, isCopy:boolean):any=>{
  const s=String(anchor??"");
  if(isCopy||s==="") return anchor;

  const prefix=s.match(/^[₹$]/)?.[0]??"";
  const bare=s.replace(/[₹$,\s]/g,"");
  if(bare!==""&&isFinite(Number(bare))&&/^-?\d+(\.\d+)?$/.test(bare)){
    const n=Number(bare)+step;
    return prefix?`${prefix}${n}`:String(n);
  }

  const dm=s.match(/^(\d{1,2})([\/\-])(\d{1,2})\2(\d{4})$/);
  if(dm){
    const d=new Date(+dm[4],+dm[3]-1,+dm[1]);
    if(!isNaN(d.getTime())){
      d.setDate(d.getDate()+step);
      const sep=dm[2];
      return `${String(d.getDate()).padStart(2,"0")}${sep}${String(d.getMonth()+1).padStart(2,"0")}${sep}${d.getFullYear()}`;
    }
  }

  if(/^\d{4}-\d{2}-\d{2}$/.test(s)){
    const d=new Date(s+"T00:00:00");
    if(!isNaN(d.getTime())){d.setDate(d.getDate()+step);return d.toISOString().slice(0,10);}
  }

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
const META_TITLE="META__title";                          // sheet ka bada title (Excel ke top wale title jaisa)
const splitKey=(k:string)=>{const i=k.indexOf("__");return [k.slice(0,i),k.slice(i+2)];};

interface Ctx{x:number;y:number;rowId?:string;colId?:string;colName?:string;}

// ── SMART LAYOUT DETECTION (Excel / OCR dono ke liye) ────────────────────────
// Problem: file me sabse upar "Medicine / Invoice Table" jaisa title hota hai,
// uske neeche asli header (Sr. No., HSN ...). Pehle hum seedha pehli row ko
// header bana dete the — isliye "Column 2, Column 3..." aa jata tha.
// Ab: 1) upar ki title-jaisi rows (1-2 cell bhari) alag nikalte hain
//     2) uske baad wali row header hai ya data — text/number ratio se decide
const isNumLike=(s:string)=>{const t=s.trim();return t!==""&&parseNum(t)!==null;};
const hasLetters=(s:string)=>/[A-Za-z\u0900-\u097F]/.test(s);

const detectLayout=(raw:string[][])=>{
  let g=raw.map(r=>r.map(c=>String(c??"").trim())).filter(r=>r.some(c=>c!==""));
  if(!g.length) return {title:"",header:null as string[]|null,body:[] as string[][],nCols:0};

  // sab rows barabar width ki karo
  const width=Math.max(...g.map(r=>r.length));
  g=g.map(r=>{const c=[...r];while(c.length<width)c.push("");return c;});

  // poori khali columns hata do
  const keep:number[]=[];
  for(let j=0;j<width;j++) if(g.some(r=>r[j]!=="")) keep.push(j);
  g=g.map(r=>keep.map(j=>r[j]));
  const nCols=keep.length;
  const filled=(r:string[])=>r.filter(c=>c!=="").length;

  // upar ki title rows (bahut kam cells bhari, neeche wali row me zyada)
  const titles:string[]=[];
  if(nCols>=3){
    const maxTitleCells=Math.min(2,Math.floor(nCols/3));
    while(g.length>1&&titles.length<3&&filled(g[0])>0&&filled(g[0])<=maxTitleCells&&filled(g[1])>filled(g[0])){
      titles.push(g.shift()!.filter(Boolean).join(" "));
    }
  }

  // ab pehli row header hai ya nahi?
  const first=g[0]??[];
  const ne=first.filter(c=>c!=="");
  const textish=ne.filter(c=>hasLetters(c)&&!isNumLike(c)).length;
  const isHeader=ne.length>0&&ne.length>=Math.ceil(nCols/2)&&textish/ne.length>=0.6;

  return {
    title:titles.join(" — "),
    header:isHeader?first.map((h,i)=>h||`Column ${i+1}`):null,
    body:isHeader?g.slice(1):g,
    nCols,
  };
};

// OCR kabhi kabhi decimal point ("148.10" → "14810") kha jata hai.
// Agar column ke zyadatar numbers "xx.xx" format me hain to bache hue
// sirf-digit numbers me last 2 digits se pehle "." laga dete hain.
const fixDroppedDecimals=(g:string[][]):string[][]=>{
  if(!g.length)return g;
  const w=Math.max(...g.map(r=>r.length));
  const out=g.map(r=>[...r]);
  for(let j=0;j<w;j++){
    const vals=g.map(r=>(r[j]??"").trim()).filter(v=>v!=="");
    if(vals.length<3)continue;
    const dec=vals.filter(v=>/^\d+\.\d{2}$/.test(v)).length;
    if(dec/vals.length<0.4)continue;
    out.forEach(r=>{
      const v=(r[j]??"").trim();
      if(/^\d{3,7}$/.test(v))r[j]=v.slice(0,-2)+"."+v.slice(-2);
    });
  }
  return out;
};

// ── OCR words → proper GRID (column to column, row to row) ───────────────────
type OcrWord={text:string;x0:number;x1:number;y0:number;y1:number};

const wordsToGrid=(all:OcrWord[]):string[][]=>{
  const ws=all.filter(w=>w.text&&w.text.trim()!=="");
  if(!ws.length)return [];

  const hs=ws.map(w=>w.y1-w.y0).filter(h=>h>0).sort((a,b)=>a-b);
  const H=hs[Math.floor(hs.length/2)]||12;

  // 1) ROWS
  const sorted=[...ws].sort((a,b)=>((a.y0+a.y1)/2)-((b.y0+b.y1)/2));
  const lines:OcrWord[][]=[];
  for(const w of sorted){
    const c=(w.y0+w.y1)/2;
    const last=lines[lines.length-1];
    if(last){
      const lc=last.reduce((s,x)=>s+(x.y0+x.y1)/2,0)/last.length;
      if(Math.abs(c-lc)<=H*0.6){last.push(w);continue;}
    }
    lines.push([w]);
  }

  // 2) COLUMNS
  const iv=ws.map(w=>[w.x0,w.x1] as [number,number]).sort((a,b)=>a[0]-b[0]);
  const GAP=H*0.7;
  const blocks:[number,number][]=[];
  for(const [a,b] of iv){
    const last=blocks[blocks.length-1];
    if(last&&a<=last[1]+GAP){last[1]=Math.max(last[1],b);}
    else blocks.push([a,b]);
  }
  const bounds:number[]=[];
  for(let i=1;i<blocks.length;i++)bounds.push((blocks[i-1][1]+blocks[i][0])/2);
  const nCols=Math.max(1,blocks.length);
  const colOf=(x:number)=>{let i=0;while(i<bounds.length&&x>bounds[i])i++;return Math.min(i,nCols-1);};

  // 3) har word ko row+column me daalo
  return lines.map(line=>{
    const cells:string[]=new Array(nCols).fill("");
    [...line].sort((a,b)=>a.x0-b.x0).forEach(w=>{
      const i=colOf((w.x0+w.x1)/2);
      cells[i]=cells[i]?`${cells[i]} ${w.text.trim()}`:w.text.trim();
    });
    return cells;
  });
};

const loadTesseract=():Promise<any>=>new Promise((res,rej)=>{
  const w=window as any;
  if(w.Tesseract) return res(w.Tesseract);
  const s=document.createElement("script");
  s.src="https://cdn.jsdelivr.net/npm/tesseract.js@5.1.0/dist/tesseract.min.js";
  s.onload=()=>res((window as any).Tesseract);
  s.onerror=()=>rej(new Error("OCR load fail"));
  document.body.appendChild(s);
});

// ── image preprocessing ──────────────────────────────────────────────────────
// ✅ NAYA: gehre (dark blue) header band me SAFED text hota hai. Tesseract ko
// "safed background par kaala text" chahiye, isliye pehle wo header ka band
// detect karke usko invert kar dete hain (safed text → kaala text). Isi wajah
// se pehle blue header OCR me aata hi nahi tha aur pehli data row header ban jaati thi.
const preprocessForOCR=(file:File):Promise<Blob>=>new Promise((resolve,reject)=>{
  const img=new Image();
  const url=URL.createObjectURL(file);
  img.onload=()=>{
    const TARGET_W=img.width<1500?3000:2400;   // chhoti image ko zyada bada karo (decimal point bachane ke liye)
    const scale=Math.max(1,TARGET_W/img.width);
    const w=Math.round(img.width*scale),h=Math.round(img.height*scale);
    const canvas=document.createElement("canvas");
    canvas.width=w;canvas.height=h;
    const ctx=canvas.getContext("2d")!;
    ctx.imageSmoothingEnabled=true;
    ctx.imageSmoothingQuality="high";
    ctx.drawImage(img,0,0,w,h);

    const id=ctx.getImageData(0,0,w,h);
    const d=id.data;

    // har row ka average brightness
    const rowMean=new Float32Array(h);
    for(let y=0;y<h;y++){
      let s=0;
      for(let x=0;x<w;x++){const i=(y*w+x)*4;s+=0.299*d[i]+0.587*d[i+1]+0.114*d[i+2];}
      rowMean[y]=s/w;
    }
    const med=[...rowMean].sort((a,b)=>a-b)[Math.floor(h/2)];
    const invertAll=med<110;                       // poori image dark-mode ho to sab invert
    const thr=Math.min(150,med*0.72);
    const dark=new Uint8Array(h);
    for(let y=0;y<h;y++)dark[y]=invertAll||rowMean[y]<thr?1:0;
    // band ke andar chhote gaps (text ke beech) bhar do
    const gap=Math.round(4*scale);
    let lastDark=-1;
    for(let y=0;y<h;y++){
      if(!dark[y])continue;
      if(lastDark>=0&&y-lastDark>1&&y-lastDark-1<=gap){for(let k=lastDark+1;k<y;k++)dark[k]=1;}
      lastDark=y;
    }

    for(let y=0;y<h;y++){
      for(let x=0;x<w;x++){
        const i=(y*w+x)*4;
        let gray=0.299*d[i]+0.587*d[i+1]+0.114*d[i+2];
        if(dark[y])gray=255-gray;
        const boosted=Math.min(255,Math.max(0,(gray-128)*1.35+128));
        d[i]=d[i+1]=d[i+2]=boosted;
      }
    }
    ctx.putImageData(id,0,0);
    URL.revokeObjectURL(url);
    canvas.toBlob(b=>b?resolve(b):reject(new Error("canvas fail")),"image/png",1);
  };
  img.onerror=()=>{URL.revokeObjectURL(url);reject(new Error("image load fail"));};
  img.src=url;
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
  const cellRefs=useRef<Record<string,HTMLInputElement|null>>({});
  const colsRef=useRef<DbColumn[]>([]);
  const rowsRef=useRef<DbRow[]>([]);          // filtered/sorted (jo screen par dikh raha hai)

  // ✅ NAYA: poori rows ki "sach" copy jo turant (synchronously) update hoti hai,
  // aur DB writes ek queue me order se jaate hain. Isse Enter dabate hi cursor
  // turant agle cell/row me chala jata hai — network ka wait nahi hota.
  const allRowsRef=useRef<DbRow[]>([]);
  const writeQ=useRef<Promise<any>>(Promise.resolve());
  const commitRows=(next:DbRow[])=>{allRowsRef.current=next;setRows(next);};

  // file input (upload)
  const upRef=useRef<HTMLInputElement>(null);

  // ── drag fill ─────────────────────────────────────────────────────────────
  const DR=useRef({
    active:false, anchorRowId:"", anchorColName:"", anchorIdx:-1,
    anchorVal:null as any, endRowId:"", endIdx:-1, isCopy:false,
  });
  const [dragRows,setDragRows]=useState<string[]>([]);

  // ── range selection ───────────────────────────────────────────────────────
  const selStart=useRef<{r:number;c:number}|null>(null);
  const [rangeMode,setRangeMode]=useState(false);

  // ── header (column) selection ─────────────────────────────────────────────
  const hdrAnchor=useRef<number|null>(null);   // mouse drag ke waqt starting column
  const lastHdr=useRef<number>(0);             // shift+click ke liye

  // ── sheet title ───────────────────────────────────────────────────────────
  const [titleEdit,setTitleEdit]=useState(false);
  const [titleVal,setTitleVal]=useState("");

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

  // input render hone tak thoda retry karta hai (naya row turant add hota hai)
  const focusCell=(rid:string,cn:string)=>{
    let tries=0;
    const t=()=>{
      const el=cellRefs.current[ck(rid,cn)];
      if(el){el.focus();try{el.select();}catch{}}
      else if(tries++<15)setTimeout(t,20);
    };
    setTimeout(t,10);
  };

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
    commitRows(((rr.data??[]) as any[]).map(r=>({...r,row_data:r.row_data??{}})));
    const {data:meta}=await supabase.from("user_tables").select("*").eq("id",tid).single();
    try{if((meta as any)?.style_map)setStyleMap(JSON.parse((meta as any).style_map));else setStyleMap({});}catch{setStyleMap({});}
  };
  useEffect(()=>{loadTables();},[uid]);
  useEffect(()=>{
    if(selTable)loadData(selTable.id);
    else{setColumns([]);commitRows([]);setStyleMap({});}
    undoStack.current=[];redoStack.current=[];
    setCanUndo(false);setCanRedo(false);
    setSelCells(new Set());
    setTitleEdit(false);
  },[selTable?.id]);

  const saveStyles=async(map:StyleMap)=>{
    if(!selTable)return;
    const {error}=await supabase.from("user_tables").update({style_map:JSON.stringify(map)} as any).eq("id",selTable.id);
    if(error) console.error("[saveStyles] DB error:",error.message,"— Run SQL: ALTER TABLE user_tables ADD COLUMN IF NOT EXISTS style_map text;");
  };
  const applyStyle=(patch:Partial<CellStyle>)=>{
    if(!selCells.size) return toast.error("Pehle cell select karo");
    setStyleMap(p=>{
      const n={...p};
      selCells.forEach(k=>{
        n[k]={...(n[k]??{}),...patch};
        // header select hai to formatting poori column (saari row-values) par bhi jaati hai
        if(k.startsWith("HDR__")){
          const colName=k.slice(5);
          allRowsRef.current.forEach(r=>{
            const rk=ck(r.id,colName);
            n[rk]={...(n[rk]??{}),...patch};
          });
        }
      });
      saveStyles(n);return n;
    });
  };

  // ── sheet title ───────────────────────────────────────────────────────────
  const saveTitle=(v:string)=>{
    setStyleMap(p=>{
      const n={...p};
      n[META_TITLE]={bold:true,...(n[META_TITLE]??{}),text:v.trim()};
      saveStyles(n);return n;
    });
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
    await writeQ.current;
    const name=`Column ${columns.length+1}`;
    await supabase.from("user_columns").insert({table_id:selTable.id,name,type:"text"});
    if(allRowsRef.current.length)await Promise.all(allRowsRef.current.map(r=>supabase.from("user_rows").update({row_data:{...r.row_data,[name]:""}}).eq("id",r.id)));
    await loadData(selTable.id);
    setTimeout(()=>{const nc=colsRef.current.at(-1);if(nc){setRenamingColId(nc.id);setRenamingColVal(nc.name);}},80);
  };
  const deleteColumn=async(col:DbColumn)=>{
    await writeQ.current;
    await supabase.from("user_columns").delete().eq("id",col.id);
    if(allRowsRef.current.length)await Promise.all(allRowsRef.current.map(r=>{const rd={...r.row_data};delete rd[col.name];return supabase.from("user_rows").update({row_data:rd}).eq("id",r.id);}));
    await loadData(selTable!.id);
  };
  const updateColumn=async(col:DbColumn,nm:string)=>{
    if(!nm.trim()){setRenamingColId(null);return;}
    if(nm.trim()===col.name){setRenamingColId(null);return;}
    const newName=nm.trim();
    const {error}=await supabase.from("user_columns").update({name:newName}).eq("id",col.id);
    if(error){toast.error("Failed to save: "+error.message);return;}
    setColumns(prev=>prev.map(c=>c.id===col.id?{...c,name:newName}:c));
    if(allRowsRef.current.length){
      const next=allRowsRef.current.map(r=>{const rd={...r.row_data};rd[newName]=rd[col.name];delete rd[col.name];return {...r,row_data:rd};});
      commitRows(next);
      await Promise.all(next.map(r=>supabase.from("user_rows").update({row_data:r.row_data}).eq("id",r.id)));
    }
    // styles ko naye column name par shift karo
    setStyleMap(prev=>{
      const n:StyleMap={};
      Object.entries(prev).forEach(([k,v])=>{
        if(k.startsWith("META__")){n[k]=v;return;}
        const [rid,cn]=splitKey(k);
        n[cn===col.name?`${rid}__${newName}`:k]=v;
      });
      saveStyles(n);return n;
    });
    setRenamingColId(null);
    toast.success("Saved",{duration:800});
  };

  // ── row CRUD (optimistic — UI turant, DB background me) ───────────────────
  const persistRow=(rowId:string)=>{
    const row=allRowsRef.current.find(r=>r.id===rowId);if(!row)return;
    const data=row.row_data;
    writeQ.current=writeQ.current.then(async()=>{
      const {error}=await supabase.from("user_rows").update({row_data:data}).eq("id",rowId);
      if(error)toast.error("Save failed: "+error.message);
    }).catch(()=>{});
  };
  const setLocalCell=(rowId:string,colName:string,value:any)=>{
    commitRows(allRowsRef.current.map(r=>r.id!==rowId?r:{...r,row_data:{...r.row_data,[colName]:value}}));
  };

  const addRow=(silent=false):DbRow|null=>{
    if(!selTable||!columns.length)return null;
    const empty:Record<string,any>={};columns.forEach(c=>(empty[c.name]=""));
    const nr:DbRow={id:crypto.randomUUID(),table_id:selTable.id,row_data:empty,created_at:new Date().toISOString()};
    commitRows([...allRowsRef.current,nr]);          // ✅ turant screen par
    const payload={id:nr.id,table_id:nr.table_id,row_data:empty};
    writeQ.current=writeQ.current.then(async()=>{
      const {error}=await supabase.from("user_rows").insert(payload as any);
      if(error){toast.error(error.message);commitRows(allRowsRef.current.filter(r=>r.id!==nr.id));}
    }).catch(()=>{});
    if(!silent&&columns[0])startEdit(nr.id,columns[0].name,true);
    return nr;
  };
  const deleteRow=(id:string)=>{
    commitRows(allRowsRef.current.filter(r=>r.id!==id));
    writeQ.current=writeQ.current.then(async()=>{
      const {error}=await supabase.from("user_rows").delete().eq("id",id);
      if(error)toast.error(error.message);
    }).catch(()=>{});
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
    const row=allRowsRef.current.find(r=>r.id===rowId);
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

  // ✅ ab synchronous hai — state turant badalta hai, DB save queue me jaata hai.
  // Value same ho to kuch nahi karta (blur + Enter ka double-save khatam).
  const saveCell=(rowId:string,colName:string,val:string,skipHistory=false):void=>{
    const row=allRowsRef.current.find(r=>r.id===rowId);
    if(!row)return;
    const oldVal=row.row_data?.[colName]??"";
    if(String(oldVal)===String(val))return;
    if(!skipHistory){
      undoStack.current.push({rowId,colName,oldVal,newVal:val});
      if(undoStack.current.length>100)undoStack.current.shift();
      redoStack.current=[];
      setCanUndo(true);setCanRedo(false);
    }
    setLocalCell(rowId,colName,val);
    persistRow(rowId);
  };

  // ── undo / redo ───────────────────────────────────────────────────────────
  const doUndo=async()=>{
    const entry=undoStack.current.pop();
    if(!entry){toast("Nothing to undo",{duration:800});return;}
    redoStack.current.push(entry);
    setCanUndo(undoStack.current.length>0);setCanRedo(true);
    setLocalCell(entry.rowId,entry.colName,entry.oldVal);
    persistRow(entry.rowId);
    toast("↩ Undone",{duration:800});
  };
  const doRedo=async()=>{
    const entry=redoStack.current.pop();
    if(!entry){toast("Nothing to redo",{duration:800});return;}
    undoStack.current.push(entry);
    setCanUndo(true);setCanRedo(redoStack.current.length>0);
    setLocalCell(entry.rowId,entry.colName,entry.newVal);
    persistRow(entry.rowId);
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
    const keys=[...selCells].filter(k=>!k.startsWith("HDR__")&&!k.startsWith("META__"));
    for(const k of keys){
      const [rid,cn]=splitKey(k);
      saveCell(rid,cn,"");
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

  // ✅ Enter/Tab/Arrow: save background me, cursor TURANT aage
  const moveCell=(rowId:string,colName:string,val:string,dir:"right"|"left"|"down"|"up")=>{
    saveCell(rowId,colName,val);
    setEditCell(null);setEditVal("");setFbar("");setAcSugg("");
    const cols=colsRef.current,list=rowsRef.current;
    const ri=list.findIndex(r=>r.id===rowId),ci=cols.findIndex(c=>c.name===colName);
    let nr=ri,nc=ci;
    if(dir==="right")nc=Math.min(ci+1,cols.length-1);
    else if(dir==="left")nc=Math.max(ci-1,0);
    else if(dir==="down"){
      nr=ri+1;
      if(nr>=list.length){
        const n=addRow(true);                       // turant nayi row
        if(n&&cols[0])startEdit(n.id,cols[0].name,true);
        return;
      }
    }
    else if(dir==="up")nr=Math.max(ri-1,0);
    const nextR=list[nr],nextC=cols[nc];
    if(nextR&&nextC)startEdit(nextR.id,nextC.name,true);
  };

  // ── SELECTION STATS ───────────────────────────────────────────────────────
  const stats=useMemo(()=>{
    const nums:number[]=[];
    selCells.forEach(k=>{
      if(k.startsWith("HDR__")||k.startsWith("META__"))return;
      const [rid,cn]=splitKey(k);
      const row=rows.find(r=>r.id===rid);
      const n=parseNum(row?.row_data?.[cn]);
      if(n!==null)nums.push(n);
    });
    const sum=nums.reduce((a,b)=>a+b,0);
    return {count:selCells.size,numCount:nums.length,sum,avg:nums.length?sum/nums.length:0};
  },[selCells,rows]);

  // ── AUTOSUM ───────────────────────────────────────────────────────────────
  const doSum=async()=>{
    if(!selCells.size)return toast.error("Pehle cells select karo (drag karo)");
    const byCol=new Map<string,number[]>();
    let maxIdx=-1;
    selCells.forEach(k=>{
      if(k.startsWith("HDR__")||k.startsWith("META__"))return;
      const [rid,cn]=splitKey(k);
      const idx=rowsRef.current.findIndex(r=>r.id===rid);
      if(idx<0)return;
      if(!byCol.has(cn))byCol.set(cn,[]);
      byCol.get(cn)!.push(idx);
      if(idx>maxIdx)maxIdx=idx;
    });
    if(!byCol.size)return toast.error("Koi valid cell select nahi hai");

    let target=rowsRef.current[maxIdx+1];
    if(!target){
      const nr=addRow(true);
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
      saveCell(target.id,cn,`${cur}${Number(total.toFixed(2))}`);
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
      hdrAnchor.current=null;
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
        setLocalCell(targetRow.id,anchorColName,newVal);
        persistRow(targetRow.id);
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
    const s=new Set<string>();s.add(hk(colName));rowsRef.current.forEach(r=>s.add(ck(r.id,colName)));
    setSelCells(s);
  };

  // ✅ NAYA: header click = poori column (header + saari cells) select.
  // Drag / Shift+click = kai columns. Ctrl+click = ek-ek karke add/remove.
  const selectColRange=(a:number,b:number)=>{
    setEditCell(null);
    const lo=Math.min(a,b),hi=Math.max(a,b);
    const s=new Set<string>();
    for(let j=lo;j<=hi;j++){
      const cn=colsRef.current[j]?.name;if(!cn)continue;
      s.add(hk(cn));
      rowsRef.current.forEach(r=>s.add(ck(r.id,cn)));
    }
    setSelCells(s);
  };
  const toggleCol=(j:number)=>{
    setEditCell(null);
    const cn=colsRef.current[j]?.name;if(!cn)return;
    setSelCells(prev=>{
      const s=new Set(prev);
      if(s.has(hk(cn))){s.delete(hk(cn));rowsRef.current.forEach(r=>s.delete(ck(r.id,cn)));}
      else{s.add(hk(cn));rowsRef.current.forEach(r=>s.add(ck(r.id,cn)));}
      return s;
    });
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

  // ── IMPORT: smart layout detect karke sheet me daalo ──────────────────────
  const importGrid=async(rawGrid:string[][],name:string)=>{
    if(!uid)return;

    // ✅ title / header / data alag alag pehchano
    const {title,header,body,nCols}=detectLayout(rawGrid);
    if(!nCols||(!body.length&&!header))return toast.error("File me kuch data nahi mila");

    const base=header??Array.from({length:nCols},(_,i)=>`Column ${i+1}`);
    const seen=new Map<string,number>();
    const cols=base.map(h=>{const n=(seen.get(h)??0)+1;seen.set(h,n);return n>1?`${h} ${n}`:h;});

    setBusy("Importing...");
    const {data:tb,error:te}=await supabase.from("user_tables").insert({user_id:uid,name:safeFile(name)}).select("*").single();
    if(te){setBusy("");return toast.error(te.message);}
    const tid=(tb as DbTable).id;

    // created_at explicitly badhta hua — taaki batch insert me bhi order sahi rahe
    const t0=Date.now()-cols.length-body.length-50;

    const {error:ce}=await supabase.from("user_columns").insert(
      cols.map((c,i)=>({table_id:tid,name:c,type:"text",created_at:new Date(t0+i).toISOString()})) as any
    );
    if(ce){setBusy("");return toast.error(ce.message);}

    const payload=body.map((r,i)=>{
      const rd:Record<string,any>={};
      cols.forEach((c,j)=>{rd[c]=r[j]==null?"":String(r[j]);});
      return {table_id:tid,row_data:rd,created_at:new Date(t0+cols.length+i).toISOString()};
    });
    for(let i=0;i<payload.length;i+=200){
      await supabase.from("user_rows").insert(payload.slice(i,i+200) as any);
    }

    // title ko sheet ke bade header ki tarah save karo (agar mila)
    if(title){
      await supabase.from("user_tables")
        .update({style_map:JSON.stringify({[META_TITLE]:{text:title,bold:true,align:"left"}})} as any)
        .eq("id",tid);
    }

    setBusy("");
    await loadTables();
    setSelTable(tb as DbTable);
    toast.success(`Imported: ${cols.length} columns, ${payload.length} rows${title?` • Title: ${title}`:""}`);
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
    let worker:any=null;
    try{
      setBusy("Preparing image...");
      const cleanBlob=await preprocessForOCR(file).catch(()=>file);

      setBusy("Loading OCR engine...");
      const T=await loadTesseract();
      worker=await T.createWorker("eng",1,{
        logger:(m:any)=>{if(m.status==="recognizing text")setBusy(`Scanning... ${Math.round((m.progress||0)*100)}%`);},
      });
      await worker.setParameters({tessedit_pageseg_mode:"6",preserve_interword_spaces:"1",user_defined_dpi:"300"});

      const {data}=await worker.recognize(cleanBlob,{},{blocks:true,text:true});
      await worker.terminate();worker=null;
      setBusy("");

      const raw:any[]=[];
      if(Array.isArray(data?.words)&&data.words.length)raw.push(...data.words);
      else if(Array.isArray(data?.blocks)){
        data.blocks.forEach((b:any)=>(b?.paragraphs??[]).forEach((p:any)=>(p?.lines??[]).forEach((l:any)=>(l?.words??[]).forEach((w:any)=>raw.push(w)))));
      }
      const words:OcrWord[]=raw
        .filter(w=>w?.bbox&&String(w.text??"").trim()!=="")
        .map(w=>({text:String(w.text).trim(),x0:w.bbox.x0,x1:w.bbox.x1,y0:w.bbox.y0,y1:w.bbox.y1}));

      let grid:string[][]=[];
      if(words.length){
        grid=wordsToGrid(words);
      }else{
        const lines=String(data?.text??"").split(/\r?\n/).map((s:string)=>s.trim()).filter(Boolean);
        grid=lines.map((l:string)=>l.split(/\t|\s{2,}|\s*\|\s*/).map(s=>s.trim()));
      }
      if(!grid.length)return toast.error("Image me text nahi mila — saaf, seedhi aur close-up photo lo");

      const width=Math.max(...grid.map(g=>g.length));
      const padded=grid.map(g=>{const c=[...g];while(c.length<width)c.push("");return c;});
      await importGrid(
        fixDroppedDecimals(padded),                 // ✅ khoye hue decimal point wapas
        file.name.replace(/\.[^.]+$/,"")||"Scan",
      );
      toast("Scan hoke aaya — numbers/columns ek baar check kar lo, OCR kabhi thoda galat ho sakta hai",{duration:4000});
    }catch(err:any){
      if(worker)try{await worker.terminate();}catch{}
      setBusy(""); toast.error("Scan fail: "+(err?.message??"OCR load nahi hua"));
    }
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
    const title=styleMap[META_TITLE]?.text?.trim()||selTable.name;
    const doc=new jsPDF({orientation:"l",unit:"pt",format:"a4"});
    doc.setFont("helvetica","bold");doc.setFontSize(16);doc.text(title,40,45);
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
    const title=styleMap[META_TITLE]?.text?.trim()||"";
    const off=title?1:0;                             // title row ke liye 1 row ka offset
    const header=columns.map(c=>c.name);
    const data=filtered.map(r=>columns.map(c=>{
      const v=r.row_data[c.name];
      if(v==null||v==="")return "";
      const n=parseNum(v);
      return n!==null&&/^[₹$]?\s*-?[\d,]+(\.\d+)?$/.test(String(v).trim())?n:String(v);
    }));
    const aoa=title?[[title],header,...data]:[header,...data];
    const ws=XLSX.utils.aoa_to_sheet(aoa);
    if(title)(ws as any)["!merges"]=[{s:{r:0,c:0},e:{r:0,c:Math.max(columns.length-1,0)}}];
    const range=XLSX.utils.decode_range(ws["!ref"]||"A1");
    const ts=styleMap[META_TITLE];
    for(let ri=0;ri<=range.e.r;ri++)for(let ci=0;ci<=range.e.c;ci++){
      const addr=XLSX.utils.encode_cell({r:ri,c:ci});if(!ws[addr])continue;
      if(ri<off){
        ws[addr].s={
          font:{bold:ts?.bold!==false,sz:16,color:{rgb:ts?.color?ts.color.replace("#",""):"000000"}},
          fill:{patternType:"solid",fgColor:{rgb:ts?.bg?ts.bg.replace("#",""):"FFFFFF"}},
          alignment:{horizontal:ts?.align??"left",vertical:"center"},
        };
        continue;
      }
      const rr=ri-off;
      const co=columns[ci];
      const isH=rr===0;
      const cs=isH?(co?styleMap[hk(co.name)]:undefined):(()=>{const ro=filtered[rr-1];return ro&&co?styleMap[ck(ro.id,co.name)]:undefined;})();
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
    if(k===META_TITLE)return"Title";
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
                          allRowsRef.current.forEach(r=>{const k=ck(r.id,col.name);next[k]={...(next[k]??{}),bg:c};});
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
                      allRowsRef.current.forEach(r=>{const k=ck(r.id,col.name);if(next[k])delete next[k].bg;});
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

          {/* ══ SUM ══ */}
          <Button variant="ghost" size="sm" className="h-7 px-2 text-xs gap-1 text-blue-600 hover:bg-blue-50"
            title="Selected cells ka total neeche wale cell me aa jayega"
            onClick={doSum} disabled={!selTable||!columns.length}>
            <Sigma className="w-3.5 h-3.5"/>Sum
          </Button>

          <div className="w-px h-6 bg-border mx-0.5"/>
          {/* ══ UPLOAD (Excel / CSV / Image) ══ */}
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
              if(e.key==="Enter"){e.preventDefault();moveCell(editCell.rowId,editCell.colName,editValRef.current,"down");}
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

            {/* ══ SHEET TITLE — Excel ke upar wale bade header jaisa ══ */}
            {(()=>{
              const ts=styleMap[META_TITLE];
              const tText=ts?.text??"";
              const tSel=selCells.has(META_TITLE);
              const jc=ts?.align==="center"?"center":ts?.align==="right"?"flex-end":"flex-start";
              return(
                <div className="sticky left-0 z-20 bg-white dark:bg-background border-b border-[#d0d0d0]"
                  style={{background:ts?.bg,boxShadow:tSel?"inset 0 0 0 2px #1a73e8":undefined}}>
                  {titleEdit?(
                    <Input
                      autoFocus
                      className="h-12 rounded-none border-0 bg-transparent text-xl px-3 focus-visible:ring-0"
                      value={titleVal}
                      placeholder="Sheet title..."
                      onChange={e=>setTitleVal(e.target.value)}
                      onBlur={()=>{saveTitle(titleVal);setTitleEdit(false);}}
                      onKeyDown={e=>{
                        if(e.key==="Enter"){e.preventDefault();(e.target as HTMLElement).blur();}
                        if(e.key==="Escape"){setTitleVal(tText);setTitleEdit(false);}
                      }}
                      style={{textAlign:ts?.align??"left",color:ts?.color,fontWeight:ts?.bold===false?"normal":"bold"}}
                    />
                  ):(
                    <div className="h-12 px-3 flex items-center text-xl cursor-cell select-none"
                      style={{justifyContent:jc,color:ts?.color,fontWeight:ts?.bold===false?"normal":"bold"}}
                      title="Click = select (toolbar se color/align/bold) • Double-click = edit"
                      onClick={()=>{
                        setEditCell(null);
                        setSelCells(new Set([META_TITLE]));
                        if(!tText){setTitleVal("");setTitleEdit(true);}
                      }}
                      onDoubleClick={()=>{setTitleVal(tText);setTitleEdit(true);}}>
                      {tText||<span className="text-sm italic font-normal text-muted-foreground/60">Click karke sheet ka title likho (jaise "March Invoice")</span>}
                    </div>
                  )}
                </div>
              );
            })()}

            <table className="border-collapse text-sm min-w-full select-none" style={{tableLayout:"fixed"}}>
              <colgroup>
                <col style={{width:"44px"}}/>
                {columns.map((_,i)=><col key={i} style={{width:"150px"}}/>)}
                <col style={{width:"36px"}}/>
              </colgroup>
              <thead className="sticky top-0 z-20">
                <tr>
                  <th className="bg-[#f2f2f2] dark:bg-muted border border-[#d0d0d0] h-8 sticky left-0 z-30 cursor-pointer hover:bg-[#e0e0e0]"
                    onClick={()=>{const s=new Set<string>();colsRef.current.forEach(c=>s.add(hk(c.name)));rowsRef.current.forEach(r=>colsRef.current.forEach(c=>s.add(ck(r.id,c.name))));setSelCells(s);setEditCell(null);toast(`All selected`,{duration:1000});}}>
                    <div className="flex items-center justify-center text-muted-foreground/30 text-xs h-full">⊞</div>
                  </th>
                  {columns.map((col,ci)=>{
                    const hStyleKey=hk(col.name);
                    const isHSel=selCells.has(hStyleKey);
                    const hs=styleMap[hStyleKey];
                    return(
                      <th key={col.id}
                        // ✅ header ab Excel jaisa: click = poori column select, drag/Shift = kai columns,
                        // Ctrl+click = ek-ek add/remove, Double-click = naam badlo
                        className={`border border-[#d0d0d0] h-8 text-xs font-medium select-none relative group transition-colors cursor-pointer ${isHSel?"z-10":"hover:bg-[#e8e8e8]"}`}
                        style={{background:hs?.bg??"#f2f2f2",color:hs?.color,fontWeight:hs?.bold?"bold":600,boxShadow:isHSel?"inset 0 0 0 2px #1a73e8":undefined}}
                        onMouseDown={e=>{
                          if(e.button!==0||renamingColId===col.id)return;
                          if(e.shiftKey){selectColRange(lastHdr.current,ci);}
                          else if(e.ctrlKey||e.metaKey){toggleCol(ci);lastHdr.current=ci;}
                          else{selectColRange(ci,ci);lastHdr.current=ci;hdrAnchor.current=ci;}
                        }}
                        onMouseEnter={e=>{
                          if(hdrAnchor.current!==null&&e.buttons===1)selectColRange(hdrAnchor.current,ci);
                        }}
                        onDoubleClick={()=>{
                          setRenamingColId(col.id);setRenamingColVal(col.name);
                        }}
                        onContextMenu={e=>openCtx(e,undefined,col.id,col.name)}
                        title="Click = poori column select • Drag / Shift+click = kai columns • Ctrl+click = add/remove • Double-click = rename"
                      >
                        {renamingColId===col.id?(
                          <div className="flex items-center gap-1 px-1 h-full" onClick={e=>e.stopPropagation()} onMouseDown={e=>e.stopPropagation()}>
                            <Input
                              className="h-6 text-xs flex-1 min-w-0"
                              value={renamingColVal}
                              autoFocus
                              onChange={e=>setRenamingColVal(e.target.value)}
                              onBlur={()=>updateColumn(col,renamingColVal)}
                              onKeyDown={e=>{
                                if(e.key==="Enter"){updateColumn(col,renamingColVal);(e.target as HTMLElement).blur();}
                                if(e.key==="Escape")setRenamingColId(null);
                                if(e.key==="Tab"){e.preventDefault();updateColumn(col,renamingColVal);const nc=colsRef.current[colsRef.current.findIndex(c=>c.id===col.id)+1];if(nc){setRenamingColId(nc.id);setRenamingColVal(nc.name);selectColRange(colsRef.current.findIndex(c=>c.id===nc.id),colsRef.current.findIndex(c=>c.id===nc.id));}}
                              }}
                            />
                          </div>
                        ):(
                          <div className="flex items-center justify-between px-2 h-full"
                            style={{justifyContent:hs?.align==="center"?"center":hs?.align==="right"?"flex-end":"space-between"}}>
                            <span className="truncate">{col.name}</span>
                            <button
                              className="opacity-0 group-hover:opacity-60 p-0.5 rounded hover:bg-white/60 shrink-0"
                              onMouseDown={e=>e.stopPropagation()}
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
                                  onBlur={()=>{
                                    saveCell(r.id,col.name,editValRef.current);
                                    setEditCell(null);setEditVal("");setFbar("");setAcSugg("");
                                  }}
                                  enterKeyHint="next"
                                  onKeyDown={e=>{
                                    if((e.key==="Tab"||e.key==="ArrowRight")&&acSugg){e.preventDefault();setEditVal(acSugg);setFbar(acSugg);setAcSugg("");if(e.key==="Tab")moveCell(r.id,col.name,acSugg,"right");return;}
                                    if(e.key==="Enter"){e.preventDefault();if(acSugg){setEditVal(acSugg);moveCell(r.id,col.name,acSugg,"down");return;}moveCell(r.id,col.name,editVal,"down");return;}
                                    if(e.key==="Tab"){e.preventDefault();moveCell(r.id,col.name,editVal,e.shiftKey?"left":"right");return;}
                                    if(e.key==="ArrowDown"){e.preventDefault();moveCell(r.id,col.name,editVal,"down");return;}
                                    if(e.key==="ArrowUp"){e.preventDefault();moveCell(r.id,col.name,editVal,"up");return;}
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
