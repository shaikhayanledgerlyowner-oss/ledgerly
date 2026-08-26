import React, { useEffect, useRef, useState, useCallback, useMemo } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Bold, Italic, Underline, Strikethrough,
  AlignLeft, AlignCenter, AlignRight, AlignJustify,
  List, ListOrdered, Undo, Redo, Save, FileText,
  Plus, Trash2, Type, Palette, Link,
  ChevronDown, Download, Table, Image as ImageIcon,
  Upload, FileUp, ChevronRight, X, Search, ArrowUpDown,
  Copy, Pencil, ZoomIn, ZoomOut,
  Square, Circle, ArrowUpRight, Highlighter, Eraser,
  RotateCw, RotateCcw, FlipHorizontal, FlipVertical,
} from "lucide-react";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { renderAsync } from "docx-preview";

// PDF import needs pdf.js loaded globally — add to index.html if not already there:
//   <script src="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js"></script>
//   <script>pdfjsLib.GlobalWorkerOptions.workerSrc =
//     "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";</script>
declare const pdfjsLib: any;

interface Doc { id: string; title: string; content: string; updated_at: string; }

const FONT_SIZES = ["8","9","10","11","12","14","16","18","20","22","24","26","28","36","48","72"];
const FONT_FAMILIES = ["Arial","Times New Roman","Calibri","Georgia","Verdana","Courier New","Trebuchet MS","Tahoma"];
const COLORS = [
  "#000000","#1f1f1f","#434343","#666666","#999999","#b7b7b7","#cccccc","#ffffff",
  "#ff0000","#ff4500","#ff9900","#ffff00","#00ff00","#00ffff","#4a86e8","#0000ff","#9900ff","#ff00ff",
  "#ea9999","#f9cb9c","#ffe599","#b6d7a8","#a2c4c9","#9fc5e8","#b4a7d6","#d5a6bd",
  "#cc0000","#e69138","#f1c232","#6aa84f","#45818e","#3d85c6","#674ea7","#a64d79",
];

const PAGE_WIDTH = 816;   // 8.5in @ 96dpi — matches Word/Google Docs "Letter" page
const PAGE_MIN_HEIGHT = 1056; // 11in @ 96dpi

function drawArrow(ctx:CanvasRenderingContext2D,x1:number,y1:number,x2:number,y2:number,w:number,color:string){
  const hl=Math.max(12,w*5),angle=Math.atan2(y2-y1,x2-x1);
  ctx.strokeStyle=color;ctx.fillStyle=color;ctx.lineWidth=w;ctx.lineCap="round";
  ctx.beginPath();ctx.moveTo(x1,y1);ctx.lineTo(x2,y2);ctx.stroke();
  ctx.beginPath();ctx.moveTo(x2,y2);
  ctx.lineTo(x2-hl*Math.cos(angle-Math.PI/6),y2-hl*Math.sin(angle-Math.PI/6));
  ctx.lineTo(x2-hl*Math.cos(angle+Math.PI/6),y2-hl*Math.sin(angle+Math.PI/6));
  ctx.closePath();ctx.fill();
}

const cellStyleFor = (isHead: boolean) =>
  `border:1px solid #999;padding:5px 8px;min-width:40px;word-break:break-word;vertical-align:top;${isHead?"background:#f0f0f0;font-weight:600;":"background:#ffffff;"}`;

/* Plain table markup — no baked-in buttons. Row/column insertion is handled
   globally by the hover "+" system further down, so it works the same way
   whether the table was typed, inserted, or came from an import. */
function makeTableHtml(rows:number, cols:number): string {
  let html = `<table style="border-collapse:collapse;width:100%;table-layout:fixed;margin:8px 0;">`;
  for (let r = 0; r < rows; r++) {
    html += "<tr>";
    for (let c = 0; c < cols; c++) {
      const isHead = r === 0;
      html += isHead
        ? `<th style="${cellStyleFor(true)}">Header ${c+1}</th>`
        : `<td style="${cellStyleFor(false)}">&nbsp;</td>`;
    }
    html += "</tr>";
  }
  html += "</table>";
  return html;
}

/* Word invoice/letterhead templates often have a big logo-style heading made
   of one long unbroken run of colored letters (no spaces) at a huge font
   size — e.g. "S.N.ELEVATORS" with per-letter colors. On a normal page width
   that overflows, and the browser breaks it mid-word into a tall, ugly,
   multi-line mess instead of the single-line logo it's meant to be.
   This finds any such oversized leaf block, measures how wide it actually
   renders, and shrinks it (uniformly, via CSS transform) just enough to fit
   in one line — the same "auto-fit" behaviour Word itself uses for WordArt
   and text boxes. Must run while attached to a real, correctly-sized DOM
   (fontSize/family matching the real page) so scrollWidth is accurate. */
function fitOversizedText(root: HTMLElement, maxWidth: number) {
  const blocks = Array.from(root.querySelectorAll<HTMLElement>("p,h1,h2,h3,h4,h5,h6,div"));
  blocks.forEach(el => {
    // Only touch "leaf" text blocks — skip anything containing structural children.
    if (el.querySelector("table,ul,ol,img,p,div,h1,h2,h3,h4,h5,h6")) return;
    const text = (el.textContent || "").trim();
    if (!text) return;

    const prevWhiteSpace = el.style.whiteSpace;
    el.style.whiteSpace = "nowrap";
    const fullWidth = el.scrollWidth;
    const naturalHeight = el.offsetHeight || parseFloat(getComputedStyle(el).lineHeight) || 20;

    if (fullWidth > maxWidth * 1.03) {
      const scale = Math.max(0.2, maxWidth / fullWidth);
      const wrapper = document.createElement("div");
      wrapper.style.cssText = `width:${maxWidth}px;height:${Math.ceil(naturalHeight * scale)}px;overflow:hidden;`;
      el.style.transformOrigin = "left top";
      el.style.transform = `scale(${scale})`;
      el.parentElement?.insertBefore(wrapper, el);
      wrapper.appendChild(el);
    } else {
      el.style.whiteSpace = prevWhiteSpace;
    }
  });
}

/* ─── Image Editor Modal ─── */
type ImgTab="adjust"|"transform"|"crop"|"draw";
type DrawTool="pen"|"highlighter"|"eraser"|"rect"|"circle"|"arrow"|"text";

function ImageEditorModal({src,onSave,onDelete,onReplace,onClose}:{
  src:string;onSave:(d:string)=>void;onDelete:()=>void;onReplace:(f:File)=>void;onClose:()=>void;
}){
  const baseRef=useRef<HTMLCanvasElement>(null);
  const overlayRef=useRef<HTMLCanvasElement>(null);
  const replaceRef=useRef<HTMLInputElement>(null);
  const [tab,setTab]=useState<ImgTab>("draw");
  const [brightness,setBrightness]=useState(100);
  const [contrast,setContrast]=useState(100);
  const [saturation,setSaturation]=useState(100);
  const [blur,setBlur]=useState(0);
  const [zoom,setZoom]=useState(1);
  const [tool,setTool]=useState<DrawTool>("pen");
  const [color,setColor]=useState("#ff0000");
  const [sw,setSw]=useState(3);
  const [textInput,setTextInput]=useState("");
  const [textPos,setTextPos]=useState<{x:number;y:number}|null>(null);
  const [cropRect,setCropRect]=useState<{x:number;y:number;w:number;h:number}|null>(null);
  const cropStart=useRef<{x:number;y:number}|null>(null);
  const [hist,setHist]=useState<{list:string[];idx:number}>({list:[],idx:-1});
  const [ready,setReady]=useState(false);
  const drawing=useRef(false);
  const hadDraw=useRef(false);
  const startPos=useRef<{x:number;y:number}|null>(null);
  const lastPos=useRef<{x:number;y:number}|null>(null);
  const cssFilter=`brightness(${brightness}%) contrast(${contrast}%) saturate(${saturation}%) blur(${blur}px)`;

  const syncSize=()=>{const b=baseRef.current,o=overlayRef.current;if(!b||!o)return;o.width=b.width;o.height=b.height;};

  useEffect(()=>{
    const img=new Image();img.crossOrigin="anonymous";
    img.onload=()=>{
      const c=baseRef.current!;c.width=img.naturalWidth||800;c.height=img.naturalHeight||600;
      c.getContext("2d")!.drawImage(img,0,0,c.width,c.height);syncSize();
      setHist({list:[c.toDataURL()],idx:0});setReady(true);
    };
    img.onerror=()=>toast.error("Cannot load image");img.src=src;
  },[src]);

  const push=()=>{const url=baseRef.current!.toDataURL();setHist(({list,idx})=>{const t=list.slice(0,idx+1);return{list:[...t,url],idx:t.length};});};
  const loadIdx=(idx:number,list:string[])=>{const img=new Image();img.onload=()=>{const c=baseRef.current!;c.width=img.width;c.height=img.height;c.getContext("2d")!.drawImage(img,0,0);syncSize();};img.src=list[idx];};
  const undo=()=>setHist(({list,idx})=>{if(idx<=0)return{list,idx};loadIdx(idx-1,list);return{list,idx:idx-1};});
  const redo=()=>setHist(({list,idx})=>{if(idx>=list.length-1)return{list,idx};loadIdx(idx+1,list);return{list,idx:idx+1};});

  const rotate=(d:1|-1)=>{const b=baseRef.current!,tmp=document.createElement("canvas");tmp.width=b.height;tmp.height=b.width;const t=tmp.getContext("2d")!;t.translate(tmp.width/2,tmp.height/2);t.rotate(Math.PI/2*d);t.drawImage(b,-b.width/2,-b.height/2);b.width=tmp.width;b.height=tmp.height;b.getContext("2d")!.drawImage(tmp,0,0);syncSize();push();};
  const flip=(ax:"h"|"v")=>{const b=baseRef.current!,tmp=document.createElement("canvas");tmp.width=b.width;tmp.height=b.height;const t=tmp.getContext("2d")!;if(ax==="h"){t.translate(tmp.width,0);t.scale(-1,1);}else{t.translate(0,tmp.height);t.scale(1,-1);}t.drawImage(b,0,0);const bctx=b.getContext("2d")!;bctx.clearRect(0,0,b.width,b.height);bctx.drawImage(tmp,0,0);push();};

  const getPos=(clientX:number,clientY:number)=>{const c=baseRef.current!,r=c.getBoundingClientRect();return{x:(clientX-r.left)*(c.width/r.width),y:(clientY-r.top)*(c.height/r.height)};};
  const commitOverlay=()=>{if(!hadDraw.current)return;const b=baseRef.current!,o=overlayRef.current!;b.getContext("2d")!.drawImage(o,0,0);o.getContext("2d")!.clearRect(0,0,o.width,o.height);hadDraw.current=false;push();};

  const onDown=(e:React.PointerEvent<HTMLCanvasElement>)=>{if(tab!=="draw")return;const p=getPos(e.clientX,e.clientY);if(tool==="text"){setTextPos(p);return;}drawing.current=true;hadDraw.current=false;startPos.current=p;lastPos.current=p;};
  const onMove=(e:React.PointerEvent<HTMLCanvasElement>)=>{
    if(tab!=="draw"||!drawing.current)return;
    const o=overlayRef.current!,ctx=o.getContext("2d")!,p=getPos(e.clientX,e.clientY);hadDraw.current=true;
    if(["pen","highlighter","eraser"].includes(tool)){
      ctx.globalCompositeOperation=tool==="eraser"?"destination-out":"source-over";
      ctx.strokeStyle=tool==="highlighter"?color+"66":color;ctx.lineWidth=tool==="highlighter"?sw*4:tool==="eraser"?sw*5:sw;ctx.lineCap="round";ctx.lineJoin="round";
      ctx.beginPath();ctx.moveTo(lastPos.current!.x,lastPos.current!.y);ctx.lineTo(p.x,p.y);ctx.stroke();lastPos.current=p;
    }else{
      ctx.clearRect(0,0,o.width,o.height);ctx.globalCompositeOperation="source-over";ctx.strokeStyle=color;ctx.fillStyle=color;ctx.lineWidth=sw;
      const s=startPos.current!;
      if(tool==="rect")ctx.strokeRect(Math.min(s.x,p.x),Math.min(s.y,p.y),Math.abs(p.x-s.x),Math.abs(p.y-s.y));
      else if(tool==="circle"){const rx=Math.abs(p.x-s.x)/2,ry=Math.abs(p.y-s.y)/2;ctx.beginPath();ctx.ellipse((s.x+p.x)/2,(s.y+p.y)/2,rx,ry,0,0,Math.PI*2);ctx.stroke();}
      else if(tool==="arrow")drawArrow(ctx,s.x,s.y,p.x,p.y,sw,color);
    }
  };
  const onUp=()=>{if(tab==="draw"&&drawing.current){drawing.current=false;commitOverlay();}};
  const placeText=()=>{if(!textPos||!textInput.trim())return;const ctx=overlayRef.current!.getContext("2d")!;ctx.font=`${Math.max(16,sw*7)}px Arial`;ctx.fillStyle=color;ctx.textBaseline="top";ctx.fillText(textInput,textPos.x,textPos.y);hadDraw.current=true;commitOverlay();setTextInput("");setTextPos(null);};

  const applyCrop=()=>{if(!cropRect||cropRect.w<4||cropRect.h<4){toast.error("Select crop area first");return;}const b=baseRef.current!,{x,y,w,h}=cropRect;const tmp=document.createElement("canvas");tmp.width=w;tmp.height=h;tmp.getContext("2d")!.drawImage(b,x,y,w,h,0,0,w,h);b.width=w;b.height=h;b.getContext("2d")!.drawImage(tmp,0,0);syncSize();setCropRect(null);push();setTab("draw");};

  const handleSave=()=>{
    const b=baseRef.current!,tmp=document.createElement("canvas");tmp.width=b.width;tmp.height=b.height;
    const t=tmp.getContext("2d")!;(t as any).filter=cssFilter;t.drawImage(b,0,0);onSave(tmp.toDataURL("image/png"));
  };

  const cropCssPos=cropRect&&baseRef.current?{
    left:cropRect.x*(baseRef.current.getBoundingClientRect().width/baseRef.current.width),
    top:cropRect.y*(baseRef.current.getBoundingClientRect().height/baseRef.current.height),
    width:cropRect.w*(baseRef.current.getBoundingClientRect().width/baseRef.current.width),
    height:cropRect.h*(baseRef.current.getBoundingClientRect().height/baseRef.current.height),
  }:null;

  const Btn=(label:any,active=false,onClick?:()=>void,extra?:React.CSSProperties)=>(
    <button onClick={onClick} style={{padding:"4px 10px",borderRadius:6,fontSize:12,fontWeight:600,border:"1px solid",cursor:"pointer",background:active?"white":"transparent",color:active?"black":"white",borderColor:active?"white":"rgba(255,255,255,0.3)",...extra}}>
      {label}
    </button>
  );

  return(
    <div className="fixed inset-0 z-[200] flex flex-col" style={{background:"rgba(0,0,0,0.95)"}}>
      <div style={{background:"#1a1a1a",borderBottom:"1px solid rgba(255,255,255,0.12)",padding:"7px 12px",display:"flex",alignItems:"center",gap:7,flexWrap:"wrap"}}>
        <span style={{color:"white",fontWeight:700,fontSize:13,marginRight:4}}>Edit Image</span>
        {(["draw","adjust","transform","crop"] as ImgTab[]).map(t=>Btn(t.charAt(0).toUpperCase()+t.slice(1),tab===t,()=>setTab(t)))}
        <div style={{width:1,height:20,background:"rgba(255,255,255,0.2)",margin:"0 2px"}}/>
        {Btn(<Undo className="h-4 w-4"/>,false,undo,{opacity:hist.idx<=0?0.3:1})}
        {Btn(<Redo className="h-4 w-4"/>,false,redo,{opacity:hist.idx>=hist.list.length-1?0.3:1})}
        <div style={{width:1,height:20,background:"rgba(255,255,255,0.2)",margin:"0 2px"}}/>
        {Btn(<ZoomOut className="h-4 w-4"/>,false,()=>setZoom(z=>Math.max(0.25,+(z-0.25).toFixed(2))))}
        <span style={{color:"rgba(255,255,255,0.7)",fontSize:12,minWidth:36,textAlign:"center"}}>{Math.round(zoom*100)}%</span>
        {Btn(<ZoomIn className="h-4 w-4"/>,false,()=>setZoom(z=>Math.min(4,+(z+0.25).toFixed(2))))}
        <div style={{marginLeft:"auto",display:"flex",gap:6}}>
          <input ref={replaceRef} type="file" accept="image/*" style={{display:"none"}} onChange={e=>{const f=e.target.files?.[0];if(f)onReplace(f);e.target.value="";}}/>
          {Btn("Replace",false,()=>replaceRef.current?.click())}
          {Btn("Delete",false,onDelete,{borderColor:"#f87171",color:"#f87171"})}
          {Btn("Cancel",false,onClose)}
          <button onClick={handleSave} style={{padding:"4px 16px",borderRadius:6,border:"none",background:"white",color:"black",cursor:"pointer",fontSize:12,fontWeight:700}}>Save</button>
        </div>
      </div>
      <div style={{background:"#111",padding:"5px 12px",display:"flex",alignItems:"center",gap:8,flexWrap:"wrap",minHeight:42}}>
        {tab==="draw"&&<>
          {([["pen",<Pencil className="h-4 w-4"/>],["highlighter",<Highlighter className="h-4 w-4"/>],["eraser",<Eraser className="h-4 w-4"/>],["rect",<Square className="h-4 w-4"/>],["circle",<Circle className="h-4 w-4"/>],["arrow",<ArrowUpRight className="h-4 w-4"/>],["text",<Type className="h-4 w-4"/>]] as [DrawTool,React.ReactNode][]).map(([t,icon])=>Btn(icon,tool===t,()=>setTool(t)))}
          <input type="color" value={color} onChange={e=>setColor(e.target.value)} style={{width:26,height:26,borderRadius:4,cursor:"pointer",border:"none"}}/>
          <label style={{color:"rgba(255,255,255,0.6)",fontSize:12,display:"flex",alignItems:"center",gap:4}}>Size<input type="range" min={1} max={20} value={sw} onChange={e=>setSw(Number(e.target.value))} style={{width:70}}/></label>
          {tool==="text"&&textPos&&<>
            <input autoFocus value={textInput} onChange={e=>setTextInput(e.target.value)} onKeyDown={e=>e.key==="Enter"&&placeText()} placeholder="Type, then click image…" style={{background:"rgba(255,255,255,0.1)",color:"white",border:"1px solid rgba(255,255,255,0.2)",borderRadius:6,padding:"3px 8px",fontSize:13,outline:"none",width:150}}/>
            {Btn("Place",false,placeText,{background:"white",color:"black",borderColor:"white"})}
          </>}
        </>}
        {tab==="adjust"&&<>
          {[["Brightness",brightness,setBrightness,40,180],["Contrast",contrast,setContrast,40,180],["Saturation",saturation,setSaturation,0,200],["Blur",blur,setBlur,0,10]].map(([l,v,s,mn,mx])=>(
            <label key={l as string} style={{color:"rgba(255,255,255,0.7)",fontSize:12,display:"flex",alignItems:"center",gap:5}}>
              {l as string}<input type="range" min={mn as number} max={mx as number} value={v as number} onChange={e=>(s as any)(Number(e.target.value))} style={{width:80}}/><span style={{minWidth:28}}>{v as number}{l==="Blur"?"px":"%"}</span>
            </label>
          ))}
          {Btn("Reset",false,()=>{setBrightness(100);setContrast(100);setSaturation(100);setBlur(0);})}
        </>}
        {tab==="transform"&&<>
          {Btn(<RotateCcw className="h-4 w-4"/>,false,()=>rotate(-1))}
          {Btn(<RotateCw className="h-4 w-4"/>,false,()=>rotate(1))}
          {Btn(<FlipHorizontal className="h-4 w-4"/>,false,()=>flip("h"))}
          {Btn(<FlipVertical className="h-4 w-4"/>,false,()=>flip("v"))}
        </>}
        {tab==="crop"&&<>
          <span style={{color:"rgba(255,255,255,0.6)",fontSize:12}}>Drag to select crop area on image</span>
          {Btn("Apply Crop",false,applyCrop,{background:"white",color:"black",borderColor:"white"})}
          {Btn("Clear",false,()=>setCropRect(null))}
        </>}
      </div>
      <div style={{flex:1,overflow:"auto",display:"flex",alignItems:"center",justifyContent:"center",padding:16}}>
        {!ready&&<span style={{color:"white",fontSize:13}}>Loading image…</span>}
        <div style={{position:"relative",transform:`scale(${zoom})`,transformOrigin:"center center"}}>
          <div style={{position:"relative",filter:cssFilter}}>
            <canvas ref={baseRef} style={{display:"block",maxWidth:"80vw",maxHeight:"66vh",border:"2px solid rgba(255,255,255,0.15)",borderRadius:4}}/>
            <canvas ref={overlayRef}
              style={{position:"absolute",top:0,left:0,width:"100%",height:"100%",
                cursor:tab==="draw"?(tool==="eraser"?"cell":tool==="text"?"text":"crosshair"):"default"}}
              onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerLeave={onUp}/>
            {tab==="crop"&&(
              <div style={{position:"absolute",inset:0,cursor:"crosshair"}}
                onPointerDown={e=>{const p=getPos(e.clientX,e.clientY);cropStart.current=p;setCropRect({x:p.x,y:p.y,w:0,h:0});}}
                onPointerMove={e=>{if(!cropStart.current)return;const p=getPos(e.clientX,e.clientY),ss=cropStart.current;setCropRect({x:Math.min(ss.x,p.x),y:Math.min(ss.y,p.y),w:Math.abs(p.x-ss.x),h:Math.abs(p.y-ss.y)});}}
                onPointerUp={()=>{cropStart.current=null;}} onPointerLeave={()=>{cropStart.current=null;}}>
                {cropCssPos&&<div style={{position:"absolute",...cropCssPos,border:"2px dashed #fff",background:"rgba(255,255,255,0.12)",pointerEvents:"none"}}/>}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ─── Insert Table Modal ─── */
function InsertTableModal({onInsert,onClose}:{onInsert:(r:number,c:number)=>void;onClose:()=>void}){
  const [rows,setRows]=useState(3);const [cols,setCols]=useState(3);
  return(
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-xs">
        <DialogHeader><DialogTitle>Insert Table</DialogTitle></DialogHeader>
        <div className="space-y-3 py-2">
          <div className="flex items-center gap-3"><label className="text-sm w-20">Rows:</label><Input type="number" min={1} max={50} value={rows} onChange={e=>setRows(Number(e.target.value))} className="w-24"/></div>
          <div className="flex items-center gap-3"><label className="text-sm w-20">Columns:</label><Input type="number" min={1} max={10} value={cols} onChange={e=>setCols(Number(e.target.value))} className="w-24"/></div>
        </div>
        <DialogFooter><Button variant="outline" onClick={onClose}>Cancel</Button><Button onClick={()=>onInsert(rows,cols)}>Insert</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ══════════════════════════════════════════════
   MAIN EDITOR
══════════════════════════════════════════════ */
export default function DocumentEditorPage(){
  const {profile}=useAuth();
  const editorRef=useRef<HTMLDivElement>(null);
  const wordRef=useRef<HTMLInputElement>(null);
  const pdfRef=useRef<HTMLInputElement>(null);
  const imgRef=useRef<HTMLInputElement>(null);
  const saveTimer=useRef<NodeJS.Timeout|null>(null);
  const savedRange=useRef<Range|null>(null);

  const [docs,setDocs]=useState<Doc[]>([]);
  const [sel,setSel]=useState<Doc|null>(null);
  const [title,setTitle]=useState("Untitled Document");
  const [saving,setSaving]=useState(false);
  const [importing,setImporting]=useState(false);
  const [deleteOpen,setDeleteOpen]=useState(false);
  const [deleteTarget,setDeleteTarget]=useState<Doc|null>(null);
  const [showColorPicker,setShowColorPicker]=useState(false);
  const [showBgPicker,setShowBgPicker]=useState(false);
  const [formats,setFormats]=useState<Record<string,boolean>>({});
  const [fontSize,setFontSize]=useState("11");
  const [fontFamily,setFontFamily]=useState("Calibri");
  const [pageZoom,setPageZoom]=useState(100);
  const [showTableModal,setShowTableModal]=useState(false);
  const [editImgEl,setEditImgEl]=useState<HTMLImageElement|null>(null);
  const [editImgSrc,setEditImgSrc]=useState<string|null>(null);
  const [drawerOpen,setDrawerOpen]=useState(false);
  const [docSearch,setDocSearch]=useState("");
  const [docSort,setDocSort]=useState<"recent"|"name">("recent");
  const [renamingId,setRenamingId]=useState<string|null>(null);
  const [renameVal,setRenameVal]=useState("");

  const loadDocs=useCallback(async()=>{
    if(!profile)return;
    const{data}=await supabase.from("user_documents").select("*").eq("user_id",profile.id).order("updated_at",{ascending:false});
    setDocs((data??[]) as Doc[]);
  },[profile]);
  useEffect(()=>{loadDocs();},[loadDocs]);

  const filteredDocs=useMemo(()=>{
    let list=docs;
    if(docSearch.trim()){const q=docSearch.trim().toLowerCase();list=list.filter(d=>d.title.toLowerCase().includes(q));}
    list=[...list];
    if(docSort==="name")list.sort((a,b)=>a.title.localeCompare(b.title));
    else list.sort((a,b)=>new Date(b.updated_at).getTime()-new Date(a.updated_at).getTime());
    return list;
  },[docs,docSearch,docSort]);

  useEffect(()=>{
    const h=()=>{const s=window.getSelection();if(!s||s.rangeCount===0)return;const r=s.getRangeAt(0);if(editorRef.current?.contains(r.commonAncestorContainer))savedRange.current=r.cloneRange();};
    document.addEventListener("selectionchange",h);return()=>document.removeEventListener("selectionchange",h);
  },[]);

  const restoreSel=():Range|null=>{
    const ed=editorRef.current;if(!ed)return null;ed.focus();
    const s=window.getSelection();if(!s)return null;
    if(savedRange.current&&ed.contains(savedRange.current.startContainer)){s.removeAllRanges();s.addRange(savedRange.current);return savedRange.current;}
    const r=document.createRange();r.selectNodeContents(ed);r.collapse(false);s.removeAllRanges();s.addRange(r);return r;
  };

  // Image click → editor
  useEffect(()=>{
    const ed=editorRef.current;if(!ed)return;
    const fn=(e:MouseEvent)=>{const t=e.target as HTMLElement;if(t.tagName==="IMG"){setEditImgEl(t as HTMLImageElement);setEditImgSrc((t as HTMLImageElement).src);}};
    ed.addEventListener("click",fn);return()=>ed.removeEventListener("click",fn);
  },[sel]);

  /* ── Word-style table resize + hover "+" insert (same size as neighbor) ── */
  useEffect(()=>{
    const editor=editorRef.current;
    if(!editor)return;

    const RESIZE_ZONE=6, GUTTER=22, TOL=10;
    type Resizing =
      | {type:"col"; colgroup:HTMLTableColElement[]; colIndex:number; startX:number; startWidth:number}
      | {type:"row"; row:HTMLTableRowElement; startY:number; startHeight:number}
      | null;
    let resizing:Resizing=null;
    let hoverBtn:HTMLButtonElement|null=null;
    const removeBtn=()=>{hoverBtn?.remove();hoverBtn=null;};

    const ensureColgroup=(table:HTMLTableElement):HTMLTableColElement[]=>{
      let cg=table.querySelector(":scope > colgroup") as HTMLElement|null;
      const firstRow=table.rows[0];
      if(!firstRow)return[];
      if(!cg){
        cg=document.createElement("colgroup");
        for(let i=0;i<firstRow.cells.length;i++){
          const col=document.createElement("col");
          col.style.width=firstRow.cells[i].getBoundingClientRect().width+"px";
          cg.appendChild(col);
        }
        table.insertBefore(cg,table.firstChild);
      }else{
        while(cg.children.length<firstRow.cells.length){
          const col=document.createElement("col");
          const prev=cg.children[cg.children.length-1] as HTMLElement|undefined;
          col.style.width=(prev?.style.width)||"80px";
          cg.appendChild(col);
        }
      }
      return Array.from(cg.children) as HTMLTableColElement[];
    };

    // New row copies the height of the row it's inserted next to (same size).
    const insertRowAt=(table:HTMLTableElement,afterIndex:number)=>{
      const rows=table.rows;
      const ref=rows[afterIndex];
      const cellCount=ref?ref.cells.length:rows[0]?.cells.length||1;
      const refHeight=ref?ref.getBoundingClientRect().height:undefined;
      const tr=document.createElement("tr");
      for(let i=0;i<cellCount;i++){
        const td=document.createElement("td");
        td.innerHTML="&nbsp;";
        td.setAttribute("style",cellStyleFor(false)+(refHeight?`height:${refHeight}px;`:""));
        tr.appendChild(td);
      }
      if(ref)ref.after(tr);else table.appendChild(tr);
      triggerSave();
      toast.success("Row added");
    };

    // New column copies the width of the column it's inserted next to (same size).
    const insertColAt=(table:HTMLTableElement,afterIndex:number)=>{
      const cols=ensureColgroup(table);
      const refWidth=cols[afterIndex]?.style.width||"80px";
      const col=document.createElement("col");
      col.style.width=refWidth;
      const refCol=cols[afterIndex];
      if(refCol)refCol.after(col);else table.querySelector("colgroup")!.appendChild(col);

      Array.from(table.rows).forEach(row=>{
        const isHead=row.cells[0]?.tagName==="TH";
        const cell=document.createElement(isHead?"th":"td");
        cell.innerHTML=isHead?"Header":"&nbsp;";
        cell.setAttribute("style",cellStyleFor(isHead));
        const refCell=row.cells[afterIndex];
        if(refCell)refCell.after(cell);else row.appendChild(cell);
      });
      triggerSave();
      toast.success("Column added");
    };

    const showPlus=(x:number,y:number,onClick:()=>void)=>{
      removeBtn();
      const btn=document.createElement("button");
      btn.textContent="+";
      Object.assign(btn.style,{
        position:"fixed",left:`${x-9}px`,top:`${y-9}px`,width:"18px",height:"18px",
        borderRadius:"50%",border:"none",background:"#4a86e8",color:"white",
        fontSize:"13px",lineHeight:"18px",textAlign:"center",cursor:"pointer",
        zIndex:"9999",padding:"0",boxShadow:"0 1px 4px rgba(0,0,0,0.35)",
      });
      btn.onmousedown=ev=>ev.stopPropagation();
      btn.onclick=ev=>{ev.stopPropagation();onClick();removeBtn();};
      document.body.appendChild(btn);
      hoverBtn=btn;
    };

    const onMouseMove=(e:MouseEvent)=>{
      if(resizing){
        if(resizing.type==="col"){
          const dx=e.clientX-resizing.startX;
          resizing.colgroup[resizing.colIndex].style.width=Math.max(30,resizing.startWidth+dx)+"px";
        }else{
          const dy=e.clientY-resizing.startY;
          const h=Math.max(20,resizing.startHeight+dy)+"px";
          Array.from(resizing.row.cells).forEach(c=>((c as HTMLElement).style.height=h));
        }
        return;
      }
      const target=e.target as HTMLElement;
      const cell=target.closest("td,th") as HTMLTableCellElement|null;
      if(cell){
        const rect=cell.getBoundingClientRect();
        const isLastCol=cell.parentElement!.lastElementChild===cell;
        const nearRight=!isLastCol&&(rect.right-e.clientX)<RESIZE_ZONE;
        const nearBottom=(rect.bottom-e.clientY)<RESIZE_ZONE;
        editor.style.cursor=nearRight?"col-resize":nearBottom?"row-resize":"";
      }else editor.style.cursor="";

      const tables=editor.querySelectorAll("table");
      let matched=false;
      tables.forEach(table=>{
        if(matched)return;
        const tRect=table.getBoundingClientRect();
        if(e.clientX>=tRect.left-GUTTER&&e.clientX<=tRect.left-2&&e.clientY>=tRect.top&&e.clientY<=tRect.bottom){
          const rows=Array.from(table.rows);
          for(let i=0;i<rows.length;i++){
            const rRect=rows[i].getBoundingClientRect();
            if(Math.abs(e.clientY-rRect.bottom)<TOL){
              showPlus(tRect.left-11,rRect.bottom,()=>insertRowAt(table,i));
              matched=true;break;
            }
          }
        }
        if(!matched&&e.clientY>=tRect.top-GUTTER&&e.clientY<=tRect.top-2&&e.clientX>=tRect.left&&e.clientX<=tRect.right){
          const cells=Array.from(table.rows[0]?.cells||[]);
          for(let j=0;j<cells.length;j++){
            const cRect=cells[j].getBoundingClientRect();
            if(Math.abs(e.clientX-cRect.right)<TOL){
              showPlus(cRect.right,tRect.top-11,()=>insertColAt(table,j));
              matched=true;break;
            }
          }
        }
      });
      if(!matched&&hoverBtn&&!hoverBtn.matches(":hover"))removeBtn();
    };

    const onMouseDown=(e:MouseEvent)=>{
      const target=e.target as HTMLElement;
      const cell=target.closest("td,th") as HTMLTableCellElement|null;
      if(!cell)return;
      const table=cell.closest("table") as HTMLTableElement;
      const rect=cell.getBoundingClientRect();
      const isLastCol=cell.parentElement!.lastElementChild===cell;
      if(!isLastCol&&(rect.right-e.clientX)<RESIZE_ZONE){
        const colgroup=ensureColgroup(table);
        const colIndex=Array.from(cell.parentElement!.children).indexOf(cell);
        resizing={type:"col",colgroup,colIndex,startX:e.clientX,startWidth:parseFloat(colgroup[colIndex]?.style.width)||rect.width};
        e.preventDefault();
      }else if((rect.bottom-e.clientY)<RESIZE_ZONE){
        resizing={type:"row",row:cell.parentElement as HTMLTableRowElement,startY:e.clientY,startHeight:rect.height};
        e.preventDefault();
      }
    };
    const onMouseUp=()=>{if(resizing){resizing=null;triggerSave();}};
    const onLeave=()=>{removeBtn();editor.style.cursor="";};

    editor.addEventListener("mousemove",onMouseMove);
    editor.addEventListener("mousedown",onMouseDown);
    editor.addEventListener("mouseleave",onLeave);
    document.addEventListener("mouseup",onMouseUp);
    return()=>{
      editor.removeEventListener("mousemove",onMouseMove);
      editor.removeEventListener("mousedown",onMouseDown);
      editor.removeEventListener("mouseleave",onLeave);
      document.removeEventListener("mouseup",onMouseUp);
      removeBtn();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[sel]);

  /* ── Load a doc's content into the editor. Older documents saved before
     the multi-page layout existed are auto-wrapped in a text page so they
     still display correctly. ── */
  const selectDoc=(doc:Doc)=>{
    setSel(doc);setTitle(doc.title);
    requestAnimationFrame(()=>{
      if(editorRef.current){
        let content=doc.content||"";
        if(!content.includes("doc-page")){
          content=`<div class="doc-page doc-page-text">${content}</div>`;
        }
        editorRef.current.innerHTML=content;
        editorRef.current.focus();
      }
    });
  };

  const createDoc=async()=>{
    if(!profile)return;
    const{data,error}=await supabase.from("user_documents").insert({user_id:profile.id,title:"Untitled Document",content:""}).select("*").single();
    if(error)return toast.error(error.message);
    toast.success("New document created!");await loadDocs();selectDoc(data as Doc);
  };

  const dupDoc=async(doc:Doc)=>{
    if(!profile)return;
    const{data,error}=await supabase.from("user_documents").insert({user_id:profile.id,title:doc.title+" (Copy)",content:doc.content}).select("*").single();
    if(error)return toast.error(error.message);
    toast.success("Duplicated!");await loadDocs();selectDoc(data as Doc);
  };

  const startRename=(doc:Doc)=>{setRenamingId(doc.id);setRenameVal(doc.title);};
  const commitRename=async(doc:Doc)=>{
    const t=renameVal.trim()||doc.title;setRenamingId(null);if(t===doc.title)return;
    const{error}=await supabase.from("user_documents").update({title:t}).eq("id",doc.id);
    if(error)return toast.error(error.message);
    setDocs(prev=>prev.map(d=>d.id===doc.id?{...d,title:t}:d));if(sel?.id===doc.id)setTitle(t);
  };

  const autoSave=useCallback(async()=>{
    if(!sel||!profile)return;
    const content=editorRef.current?.innerHTML||"";
    const{error}=await supabase.from("user_documents").update({title,content,updated_at:new Date().toISOString()}).eq("id",sel.id);
    if(!error)setDocs(prev=>prev.map(d=>d.id===sel.id?{...d,title,content}:d));
  },[sel,title,profile]);

  const handleSave=async()=>{setSaving(true);await autoSave();setSaving(false);toast.success("Saved!");};
  const triggerSave=()=>{if(saveTimer.current)clearTimeout(saveTimer.current);saveTimer.current=setTimeout(autoSave,1500);updateFmts();};

  const handleDelete=async()=>{
    if(!deleteTarget)return;
    await supabase.from("user_documents").delete().eq("id",deleteTarget.id);
    toast.success("Deleted!");setDeleteOpen(false);setDeleteTarget(null);
    if(sel?.id===deleteTarget.id){setSel(null);if(editorRef.current)editorRef.current.innerHTML="";}
    await loadDocs();
  };

  const exec=(cmd:string,val?:string)=>{restoreSel();document.execCommand(cmd,false,val);updateFmts();triggerSave();};
  const updateFmts=()=>{try{setFormats({bold:document.queryCommandState("bold"),italic:document.queryCommandState("italic"),underline:document.queryCommandState("underline"),strikeThrough:document.queryCommandState("strikeThrough"),justifyLeft:document.queryCommandState("justifyLeft"),justifyCenter:document.queryCommandState("justifyCenter"),justifyRight:document.queryCommandState("justifyRight"),justifyFull:document.queryCommandState("justifyFull"),insertUnorderedList:document.queryCommandState("insertUnorderedList"),insertOrderedList:document.queryCommandState("insertOrderedList"),});}catch{}};
  const applyBlock=(tag:string)=>{restoreSel();document.execCommand("formatBlock",false,`<${tag}>`);updateFmts();triggerSave();};

  const insertTable=(rows:number,cols:number)=>{
    const ed=editorRef.current;if(!ed)return;
    const html=makeTableHtml(rows,cols)+"<p><br></p>";
    const range=restoreSel();
    const s=window.getSelection();
    if(s&&s.rangeCount>0&&range){
      const lr=s.getRangeAt(0);
      lr.deleteContents();
      const frag=lr.createContextualFragment(html);
      const last=frag.lastChild;
      lr.insertNode(frag);
      if(last){const ar=document.createRange();ar.setStartAfter(last);ar.collapse(true);s.removeAllRanges();s.addRange(ar);savedRange.current=ar.cloneRange();}
    }else{
      const page=ed.querySelector(".doc-page-text")||ed;
      page.innerHTML+=html;
    }
    setShowTableModal(false);triggerSave();toast.success("Table inserted!");
  };

  const handleImgUpload=(e:React.ChangeEvent<HTMLInputElement>)=>{
    const files=Array.from(e.target.files||[]);if(!files.length)return;
    restoreSel();
    files.forEach(file=>{
      const reader=new FileReader();
      reader.onload=ev=>{
        const src=ev.target?.result as string;const ed=editorRef.current;if(!ed)return;
        ed.focus();const html=`<img src="${src}" style="max-width:100%;height:auto;display:block;margin:6px 0;cursor:pointer;"/>`;
        const s=window.getSelection();
        if(s&&s.rangeCount>0){const lr=s.getRangeAt(0);const frag=lr.createContextualFragment(html);lr.insertNode(frag);lr.collapse(false);}
        else{const page=ed.querySelector(".doc-page-text")||ed;page.innerHTML+=html;}
        triggerSave();
      };reader.readAsDataURL(file);
    });e.target.value="";
  };

  /* ── Word import — client-side via docx-preview, which renders the docx's
     actual OOXML formatting (fonts, sizes, colors, real page layout, tables,
     images) straight into inline CSS — this is what makes it look like the
     real document instead of the stripped-down plain text mammoth.js used to
     produce. Each source page becomes its own sized page section, exactly as
     docx-preview lays it out, so multi-page documents keep their formatting
     all the way through instead of losing it after the first heading. ── */
  const handleWordUpload=async(e:React.ChangeEvent<HTMLInputElement>)=>{
    const files=Array.from(e.target.files||[]);if(!files.length)return;e.target.value="";
    setImporting(true);
    for(const file of files){
      const stage=document.createElement("div");
      stage.style.cssText="position:fixed;left:-99999px;top:0;";
      document.body.appendChild(stage);
      try{
        const buf=await file.arrayBuffer();

        await renderAsync(buf,stage,stage,{
          className:"wimp",
          inWrapper:true,
          breakPages:true,
          ignoreLastRenderedPageBreak:false,
          experimental:true,
          useBase64URL:true, // embed images/fonts as data URLs so they still work after being saved & reloaded from Supabase
        });

        // Keep docx-preview's own markup + generated <style> tag fully intact
        // (moving/renaming elements would break its scoped CSS selectors) —
        // just wrap the whole rendered result as one page block, consistent
        // with how PDF imports are wrapped.
        const importedHtml=stage.innerHTML;
        const pageHtml=`<div class="doc-page doc-page-docximport">${importedHtml}</div>`;

        const newTitle=file.name.replace(/\.docx?$/i,"");
        const{data,error}=await supabase.from("user_documents").insert({user_id:profile?.id,title:newTitle,content:pageHtml}).select("*").single();
        if(error)throw error;
        toast.success(`"${newTitle}" imported!`);
        await loadDocs();selectDoc(data as Doc);
      }catch(err:any){
        toast.error(`Failed: "${file.name}" — ${err?.message||"Unknown error"}`);
      }finally{
        document.body.removeChild(stage);
      }
    }
    setImporting(false);
  };

  /* ── PDF import — renders every page through pdf.js's own renderer, then
     drops each page in as its OWN full-bleed page (no padding squeezing
     it down) at the same width as every other page in the app, so it
     genuinely looks like separate A4/Letter sheets — pixel-identical to
     the source PDF, because it IS the rendered PDF page. Trade-off: page
     content is an image, not editable text (see note in handleWordUpload
     if you want an editable-text import path added too). ── */
  const handlePdfUpload=async(e:React.ChangeEvent<HTMLInputElement>)=>{
    const files=Array.from(e.target.files||[]);if(!files.length)return;e.target.value="";
    if(typeof pdfjsLib==="undefined"){toast.error("PDF renderer not loaded — refresh the page and try again.");return;}
    setImporting(true);
    for(const file of files){
      try{
        const buf=await file.arrayBuffer();
        const pdf=await pdfjsLib.getDocument({data:buf}).promise;
        let pagesHtml="";
        for(let i=1;i<=pdf.numPages;i++){
          const page=await pdf.getPage(i);
          const vp=page.getViewport({scale:2});
          const canvas=document.createElement("canvas");
          canvas.width=vp.width;canvas.height=vp.height;
          await page.render({canvasContext:canvas.getContext("2d")!,viewport:vp}).promise;
          const dataUrl=canvas.toDataURL("image/jpeg",0.95);
          pagesHtml+=`<div class="doc-page doc-page-image"><img src="${dataUrl}"/></div>`;
        }
        const newTitle=file.name.replace(/\.pdf$/i,"");
        const{data,error}=await supabase.from("user_documents").insert({user_id:profile?.id,title:newTitle,content:pagesHtml}).select("*").single();
        if(error)throw error;
        toast.success(`"${newTitle}" imported (${pdf.numPages} page${pdf.numPages>1?"s":""})`);
        await loadDocs();selectDoc(data as Doc);
      }catch(err:any){
        toast.error(`Failed: "${file.name}" — ${err?.message||"Unknown error"}`);
      }
    }
    setImporting(false);
  };

  const exportCSS=`
    body{background:#e8eaed;margin:0;padding:32px 0;display:flex;flex-direction:column;align-items:center;gap:24px;}
    .doc-page{background:#fff;width:${PAGE_WIDTH}px;box-sizing:border-box;box-shadow:0 1px 3px rgba(0,0,0,0.3);}
    .doc-page-text{min-height:${PAGE_MIN_HEIGHT}px;padding:96px;font-family:Calibri,Arial,sans-serif;font-size:11pt;line-height:1.15;color:#000;}
    .doc-page-image{padding:0;line-height:0;}
    .doc-page-image img{width:100%;height:auto;display:block;}
    .doc-page-docximport{width:auto;background:transparent;box-shadow:none;padding:0;min-height:0;}
    h1{font-size:20pt;font-weight:700;margin:.3em 0;}h2{font-size:16pt;font-weight:700;margin:.3em 0;}h3{font-size:13pt;font-weight:600;margin:.3em 0;}
    table{border-collapse:collapse;width:100%;margin:6px 0;}td,th{border:1px solid #999;padding:5px 8px;vertical-align:top;}th{background:#f0f0f0;font-weight:600;}
    ul{list-style:disc;padding-left:1.5em;}ol{list-style:decimal;padding-left:1.5em;}
    @media print{
      body{background:#fff;padding:0;gap:0;}
      .doc-page{box-shadow:none;page-break-after:always;}
      .doc-page-image img{page-break-inside:avoid;}
    }
  `;
  const fullHtml=(body:string)=>`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>${title}</title><style>${exportCSS}</style></head><body>${body}</body></html>`;
  const dl=(content:string,type:string,name:string)=>{Object.assign(document.createElement("a"),{href:URL.createObjectURL(new Blob([content],{type})),download:name}).click();};
  const printDoc=()=>{const w=window.open("","_blank");if(!w)return;w.document.write(fullHtml(editorRef.current?.innerHTML||""));w.document.close();w.print();};

  const tb=(active:boolean)=>cn("h-7 w-7 p-0 rounded flex items-center justify-center transition-colors shrink-0 border",active?"bg-blue-100 border-blue-400 text-blue-700":"border-transparent hover:bg-gray-100 text-gray-700");

  return(
    <>
      {showTableModal&&<InsertTableModal onInsert={insertTable} onClose={()=>setShowTableModal(false)}/>}
      {editImgEl&&editImgSrc&&(
        <ImageEditorModal src={editImgSrc}
          onSave={d=>{if(editImgEl){editImgEl.src=d;}triggerSave();toast.success("Image updated!");setEditImgEl(null);setEditImgSrc(null);}}
          onDelete={()=>{if(editImgEl)editImgEl.remove();triggerSave();toast.success("Removed");setEditImgEl(null);setEditImgSrc(null);}}
          onReplace={f=>{const r=new FileReader();r.onload=ev=>{if(editImgEl){editImgEl.src=ev.target?.result as string;setEditImgSrc(ev.target?.result as string);}};r.readAsDataURL(f);}}
          onClose={()=>{setEditImgEl(null);setEditImgSrc(null);}}/>
      )}
      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader><AlertDialogTitle>Delete Document?</AlertDialogTitle>
            <AlertDialogDescription>"{deleteTarget?.title}" will be permanently deleted.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction onClick={handleDelete}>Delete</AlertDialogAction></AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <input ref={wordRef} type="file" accept=".doc,.docx" multiple className="hidden" onChange={handleWordUpload}/>
      <input ref={pdfRef} type="file" accept=".pdf" multiple className="hidden" onChange={handlePdfUpload}/>
      <input ref={imgRef} type="file" accept="image/*" multiple className="hidden" onChange={handleImgUpload}/>

      <div onClick={()=>setDrawerOpen(o=>!o)}
        className="fixed left-0 top-1/2 -translate-y-1/2 z-40 flex items-center justify-center w-4 h-14 bg-blue-600 hover:bg-blue-700 rounded-r-lg cursor-pointer shadow-lg transition-colors" title="Documents">
        <ChevronRight className={cn("h-3 w-3 text-white transition-transform",drawerOpen&&"rotate-180")}/>
      </div>
      {drawerOpen&&<div className="fixed inset-0 z-30 bg-black/20" onClick={()=>setDrawerOpen(false)}/>}

      <div className={cn("fixed left-0 top-0 h-full w-64 bg-white border-r border-gray-200 z-40 flex flex-col shadow-2xl transition-transform duration-200",drawerOpen?"translate-x-0":"-translate-x-full")}>
        <div className="p-3 border-b border-gray-200 space-y-2">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-gray-800">Documents</h3>
            <button onClick={()=>setDrawerOpen(false)} className="p-1 hover:bg-gray-100 rounded"><X className="h-4 w-4 text-gray-500"/></button>
          </div>
          <div className="flex gap-1">
            <Button size="sm" className="flex-1 gap-1 h-7 text-xs" onClick={()=>{createDoc();setDrawerOpen(false);}}>
              <Plus className="h-3.5 w-3.5"/>New
            </Button>
            <Button size="sm" variant="outline" className="flex-1 gap-1 h-7 text-xs" onClick={()=>wordRef.current?.click()} disabled={importing}>
              <Upload className="h-3.5 w-3.5"/>Word
            </Button>
            <Button size="sm" variant="outline" className="flex-1 gap-1 h-7 text-xs" onClick={()=>pdfRef.current?.click()} disabled={importing}>
              <FileUp className="h-3.5 w-3.5"/>PDF
            </Button>
          </div>
          <div className="relative">
            <Search className="h-3.5 w-3.5 absolute left-2 top-1/2 -translate-y-1/2 text-gray-400"/>
            <Input value={docSearch} onChange={e=>setDocSearch(e.target.value)} placeholder="Search…" className="h-7 text-xs pl-7"/>
          </div>
          <button onClick={()=>setDocSort(s=>s==="recent"?"name":"recent")} className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-800">
            <ArrowUpDown className="h-3 w-3"/>Sort: {docSort==="recent"?"Recent":"Name"}
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-2 space-y-0.5">
          {filteredDocs.length===0&&<p className="text-xs text-gray-400 text-center py-6">{docSearch?"No results":"No documents yet"}</p>}
          {filteredDocs.map(doc=>(
            <div key={doc.id} onClick={()=>{selectDoc(doc);setDrawerOpen(false);}}
              className={cn("flex items-center justify-between rounded px-2 py-1.5 cursor-pointer group transition-colors",sel?.id===doc.id?"bg-blue-50 text-blue-700":"hover:bg-gray-100 text-gray-700")}>
              <div className="flex items-center gap-1.5 min-w-0 flex-1">
                <FileText className="h-3.5 w-3.5 shrink-0"/>
                {renamingId===doc.id?(
                  <Input autoFocus value={renameVal} onClick={e=>e.stopPropagation()} onChange={e=>setRenameVal(e.target.value)}
                    onBlur={()=>commitRename(doc)} onKeyDown={e=>{if(e.key==="Enter")commitRename(doc);if(e.key==="Escape")setRenamingId(null);}} className="h-6 text-xs px-1"/>
                ):<span className="text-xs truncate">{doc.title}</span>}
              </div>
              <div className="flex items-center opacity-0 group-hover:opacity-100 shrink-0 gap-0.5">
                <button onClick={e=>{e.stopPropagation();startRename(doc);}} className="p-1 rounded hover:bg-gray-200" title="Rename"><Pencil className="h-3 w-3"/></button>
                <button onClick={e=>{e.stopPropagation();dupDoc(doc);}} className="p-1 rounded hover:bg-gray-200" title="Duplicate"><Copy className="h-3 w-3"/></button>
                <button onClick={e=>{e.stopPropagation();setDeleteTarget(doc);setDeleteOpen(true);}} className="p-1 rounded hover:bg-red-100" title="Delete"><Trash2 className="h-3 w-3 text-red-500"/></button>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="flex flex-col h-[calc(100vh-56px)] overflow-hidden" style={{background:"#f0f0f0"}}>
        <div className="bg-white border-b border-gray-300 select-none" style={{boxShadow:"0 1px 3px rgba(0,0,0,0.1)"}}>
          <div className="flex items-center gap-1 px-3 py-1.5 border-b border-gray-200">
            <button onClick={handleSave} disabled={saving||!sel}
              className="flex items-center gap-1 px-3 py-1 rounded text-xs font-medium bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 transition-colors">
              <Save className="h-3.5 w-3.5"/>{saving?"Saving…":"Save"}
            </button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button disabled={!sel} className="flex items-center gap-1 px-3 py-1 rounded text-xs font-medium border border-gray-300 hover:bg-gray-50 disabled:opacity-50">
                  <Download className="h-3.5 w-3.5"/>Export<ChevronDown className="h-3 w-3"/>
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                <DropdownMenuItem onClick={printDoc}>Save as PDF (Print)</DropdownMenuItem>
                <DropdownMenuItem onClick={()=>dl(fullHtml(editorRef.current?.innerHTML||""),"text/html",`${title}.html`)}>Download HTML</DropdownMenuItem>
                <DropdownMenuItem onClick={()=>dl(editorRef.current?.innerText||"","text/plain",`${title}.txt`)}>Download TXT</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <div className="w-px h-5 bg-gray-300 mx-1"/>
            <button onClick={()=>exec("undo")} className={tb(false)} title="Undo"><Undo className="h-3.5 w-3.5"/></button>
            <button onClick={()=>exec("redo")} className={tb(false)} title="Redo"><Redo className="h-3.5 w-3.5"/></button>
          </div>
          <div className="flex items-center gap-0.5 px-3 py-1 flex-wrap">
            <Select defaultValue="p" onValueChange={applyBlock}>
              <SelectTrigger className="h-7 w-28 text-xs border-gray-300"><SelectValue placeholder="Style"/></SelectTrigger>
              <SelectContent>
                <SelectItem value="p">Normal</SelectItem>
                <SelectItem value="h1"><span className="font-bold text-lg">Heading 1</span></SelectItem>
                <SelectItem value="h2"><span className="font-bold text-base">Heading 2</span></SelectItem>
                <SelectItem value="h3"><span className="font-semibold">Heading 3</span></SelectItem>
                <SelectItem value="blockquote">Quote</SelectItem>
                <SelectItem value="pre">Code</SelectItem>
              </SelectContent>
            </Select>
            <div className="w-px h-5 bg-gray-300 mx-0.5"/>
            <Select value={fontFamily} onValueChange={v=>{setFontFamily(v);exec("fontName",v);}}>
              <SelectTrigger className="h-7 w-32 text-xs border-gray-300"><SelectValue/></SelectTrigger>
              <SelectContent>{FONT_FAMILIES.map(f=><SelectItem key={f} value={f} style={{fontFamily:f}}>{f}</SelectItem>)}</SelectContent>
            </Select>
            <Select value={fontSize} onValueChange={v=>{
              setFontSize(v);restoreSel();const s=window.getSelection();
              if(s&&s.rangeCount>0&&!s.isCollapsed){const r=s.getRangeAt(0);const span=document.createElement("span");span.style.fontSize=v+"pt";try{r.surroundContents(span);}catch{}triggerSave();}
            }}>
              <SelectTrigger className="h-7 w-14 text-xs border-gray-300"><SelectValue/></SelectTrigger>
              <SelectContent>{FONT_SIZES.map(s=><SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
            </Select>
            <div className="w-px h-5 bg-gray-300 mx-0.5"/>
            <button className={tb(formats.bold)} onClick={()=>exec("bold")} title="Bold"><Bold className="h-4 w-4"/></button>
            <button className={tb(formats.italic)} onClick={()=>exec("italic")} title="Italic"><Italic className="h-4 w-4"/></button>
            <button className={tb(formats.underline)} onClick={()=>exec("underline")} title="Underline"><Underline className="h-4 w-4"/></button>
            <button className={tb(formats.strikeThrough)} onClick={()=>exec("strikeThrough")} title="Strikethrough"><Strikethrough className="h-4 w-4"/></button>
            <div className="w-px h-5 bg-gray-300 mx-0.5"/>
            <div className="relative">
              <button className={tb(false)} title="Font Color" onClick={()=>{setShowColorPicker(p=>!p);setShowBgPicker(false);}}>
                <Type className="h-4 w-4"/>
              </button>
              {showColorPicker&&(
                <div className="absolute top-8 left-0 z-50 bg-white border border-gray-200 rounded-lg shadow-xl p-2 grid grid-cols-8 gap-1" style={{width:192}}>
                  {COLORS.map(c=><button key={c} style={{backgroundColor:c,width:18,height:18,borderRadius:3,border:"1px solid rgba(0,0,0,0.15)"}} className="hover:scale-125 transition-transform" onClick={()=>{exec("foreColor",c);setShowColorPicker(false);}}/>)}
                </div>
              )}
            </div>
            <div className="relative">
              <button className={tb(false)} title="Highlight" onClick={()=>{setShowBgPicker(p=>!p);setShowColorPicker(false);}}>
                <Palette className="h-4 w-4"/>
              </button>
              {showBgPicker&&(
                <div className="absolute top-8 left-0 z-50 bg-white border border-gray-200 rounded-lg shadow-xl p-2 grid grid-cols-8 gap-1" style={{width:192}}>
                  {COLORS.map(c=><button key={c} style={{backgroundColor:c,width:18,height:18,borderRadius:3,border:"1px solid rgba(0,0,0,0.15)"}} className="hover:scale-125 transition-transform" onClick={()=>{exec("hiliteColor",c);setShowBgPicker(false);}}/>)}
                </div>
              )}
            </div>
            <div className="w-px h-5 bg-gray-300 mx-0.5"/>
            <button className={tb(formats.justifyLeft)} onClick={()=>exec("justifyLeft")}><AlignLeft className="h-4 w-4"/></button>
            <button className={tb(formats.justifyCenter)} onClick={()=>exec("justifyCenter")}><AlignCenter className="h-4 w-4"/></button>
            <button className={tb(formats.justifyRight)} onClick={()=>exec("justifyRight")}><AlignRight className="h-4 w-4"/></button>
            <button className={tb(formats.justifyFull)} onClick={()=>exec("justifyFull")}><AlignJustify className="h-4 w-4"/></button>
            <div className="w-px h-5 bg-gray-300 mx-0.5"/>
            <button className={tb(formats.insertUnorderedList)} onClick={()=>exec("insertUnorderedList")}><List className="h-4 w-4"/></button>
            <button className={tb(formats.insertOrderedList)} onClick={()=>exec("insertOrderedList")}><ListOrdered className="h-4 w-4"/></button>
            <div className="w-px h-5 bg-gray-300 mx-0.5"/>
            <button className={tb(false)} onClick={()=>{restoreSel();setShowTableModal(true);}} title="Insert Table"><Table className="h-4 w-4"/></button>
            <button className={tb(false)} onClick={()=>imgRef.current?.click()} title="Insert Image"><ImageIcon className="h-4 w-4"/></button>
            <button className={tb(false)} onClick={()=>{const u=prompt("Enter URL:");if(u)exec("createLink",u);}} title="Insert Link"><Link className="h-4 w-4"/></button>
          </div>
        </div>

        {sel&&(
          <div className="flex items-center gap-2 px-4 py-1 bg-white border-b border-gray-200">
            <Input value={title} onChange={e=>setTitle(e.target.value)} onBlur={handleSave}
              className="text-sm font-medium border-none shadow-none focus-visible:ring-0 px-0 h-7 bg-transparent text-gray-800" placeholder="Document title…"/>
            {importing&&<span className="text-xs text-blue-500 animate-pulse">Importing…</span>}
          </div>
        )}

        {sel?(
          <div className="flex-1 overflow-auto" style={{background:"#e8eaed"}}>
            <style>{`
              #ld-ed{outline:none;display:flex;flex-direction:column;align-items:center;gap:24px;padding:32px 0 96px 0;}
              .doc-page{background:#fff;width:${PAGE_WIDTH}px;box-shadow:0 1px 8px rgba(0,0,0,0.18);box-sizing:border-box;flex-shrink:0;}
              .doc-page-text{min-height:${PAGE_MIN_HEIGHT}px;padding:96px;outline:none;}
              .doc-page-text:empty:before{content:"Start typing here…";color:#9ca3af;pointer-events:none;}
              .doc-page-image{padding:0;line-height:0;}
              .doc-page-image img{width:100%;height:auto;display:block;cursor:pointer;}
              .doc-page-docximport{width:auto;background:transparent;box-shadow:none;padding:0;min-height:0;}
              #ld-ed h1{font-size:20pt;font-weight:700;margin:.3em 0;}
              #ld-ed h2{font-size:16pt;font-weight:700;margin:.3em 0;}
              #ld-ed h3{font-size:13pt;font-weight:600;margin:.3em 0;}
              #ld-ed blockquote{border-left:3px solid #ccc;padding:3px 12px;color:#555;margin:4px 0;}
              #ld-ed pre{background:#f5f5f5;padding:10px;border-radius:4px;font-family:monospace;font-size:.85em;overflow-x:auto;}
              #ld-ed ul{list-style:disc !important;padding-left:1.5em !important;margin:3px 0;}
              #ld-ed ol{list-style:decimal !important;padding-left:1.5em !important;margin:3px 0;}
              #ld-ed li{display:list-item !important;}
              #ld-ed table{border-collapse:collapse;width:100%;margin:6px 0;}
              #ld-ed td,#ld-ed th{border:1px solid #999;padding:5px 8px;vertical-align:top;min-width:30px;word-break:break-word;}
              #ld-ed th{background:#f0f0f0;font-weight:600;}
              #ld-ed .doc-page-text img{max-width:100%;height:auto;cursor:pointer;display:block;margin:6px 0;}
              #ld-ed .doc-page-text img:hover{outline:2px solid #4a86e8;outline-offset:2px;}
              #ld-ed a{color:#1155cc;text-decoration:underline;}
              #ld-ed .doc-page-text p{margin:0 0 1px 0;min-height:1.15em;}
            `}</style>

            <div style={{transform:`scale(${pageZoom/100})`,transformOrigin:"top center",transition:"transform 0.1s",display:"flex",justifyContent:"center"}}>
              <div id="ld-ed" ref={editorRef} contentEditable suppressContentEditableWarning
                onInput={triggerSave} onKeyUp={updateFmts} onMouseUp={updateFmts}
                style={{fontFamily,fontSize:fontSize+"pt",lineHeight:"1.15",color:"#000"}}/>
            </div>

            <div style={{position:"fixed",bottom:16,right:24,display:"flex",alignItems:"center",gap:6,background:"white",border:"1px solid #d0d0d0",borderRadius:20,padding:"4px 12px",boxShadow:"0 2px 8px rgba(0,0,0,0.15)",zIndex:30}}>
              <button onClick={()=>setPageZoom(z=>Math.max(25,z-10))} className="w-6 h-6 flex items-center justify-center rounded-full hover:bg-gray-100 text-gray-600"><ZoomOut className="h-4 w-4"/></button>
              <input type="range" min={25} max={200} step={5} value={pageZoom} onChange={e=>setPageZoom(Number(e.target.value))} style={{width:100,accentColor:"#4a86e8"}}/>
              <button onClick={()=>setPageZoom(z=>Math.min(200,z+10))} className="w-6 h-6 flex items-center justify-center rounded-full hover:bg-gray-100 text-gray-600"><ZoomIn className="h-4 w-4"/></button>
              <button onClick={()=>setPageZoom(100)} className="text-xs font-medium text-blue-600 hover:text-blue-800 min-w-[36px] text-center">{pageZoom}%</button>
            </div>
          </div>
        ):(
          <div className="flex-1 flex flex-col items-center justify-center text-center p-8" style={{background:"#e8eaed"}}>
            <FileText className="h-16 w-16 text-gray-400 mb-4"/>
            <h2 className="text-xl font-semibold mb-2 text-gray-700">No document selected</h2>
            <p className="text-gray-500 mb-6 text-sm">Click the blue arrow on the left edge to open or create documents</p>
            <div className="flex gap-3 flex-wrap justify-center">
              <Button onClick={createDoc} className="gap-2"><Plus className="h-4 w-4"/>New Document</Button>
              <Button variant="outline" className="gap-2" onClick={()=>wordRef.current?.click()}><Upload className="h-4 w-4"/>Import Word</Button>
              <Button variant="outline" className="gap-2" onClick={()=>pdfRef.current?.click()}><FileUp className="h-4 w-4"/>Import PDF</Button>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
