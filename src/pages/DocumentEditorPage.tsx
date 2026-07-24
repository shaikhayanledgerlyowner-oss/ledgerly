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
  RotateCw, RotateCcw, FlipHorizontal, FlipVertical, Crop,
} from "lucide-react";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

declare const mammoth: any;
declare const pdfjsLib: any;

interface Doc {
  id: string;
  title: string;
  content: string;
  updated_at: string;
}

const FONT_SIZES = ["8","9","10","11","12","14","16","18","20","22","24","26","28","36","48","72"];
const FONT_FAMILIES = [
  "Arial","Times New Roman","Calibri","Georgia","Verdana",
  "Courier New","Trebuchet MS","Comic Sans MS","Impact","Tahoma",
];
const COLORS = [
  "#000000","#1f1f1f","#434343","#666666","#999999","#b7b7b7","#cccccc","#d9d9d9","#f3f3f3","#ffffff",
  "#ff0000","#ff4500","#ff9900","#ffff00","#00ff00","#00ffff","#4a86e8","#0000ff","#9900ff","#ff00ff",
  "#ea9999","#f9cb9c","#ffe599","#b6d7a8","#a2c4c9","#9fc5e8","#b4a7d6","#d5a6bd",
  "#cc0000","#e69138","#f1c232","#6aa84f","#45818e","#3d85c6","#674ea7","#a64d79",
  "#990000","#b45f06","#bf9000","#38761d","#134f5c","#1155cc","#351c75","#741b47",
];

// ─── Arrow helper ───
function drawArrow(ctx: CanvasRenderingContext2D, x1:number,y1:number,x2:number,y2:number,w:number,color:string){
  const hl=Math.max(12,w*5), angle=Math.atan2(y2-y1,x2-x1);
  ctx.strokeStyle=color; ctx.fillStyle=color; ctx.lineWidth=w; ctx.lineCap="round";
  ctx.beginPath(); ctx.moveTo(x1,y1); ctx.lineTo(x2,y2); ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x2,y2);
  ctx.lineTo(x2-hl*Math.cos(angle-Math.PI/6), y2-hl*Math.sin(angle-Math.PI/6));
  ctx.lineTo(x2-hl*Math.cos(angle+Math.PI/6), y2-hl*Math.sin(angle+Math.PI/6));
  ctx.closePath(); ctx.fill();
}

// ─── Word logo fragment merger ───
function getMaxFontPx(el:HTMLElement):number{
  let max=0;
  const check=(e:HTMLElement)=>{
    const m=e.style?.fontSize?.match(/([\d.]+)\s*(px|pt)/);
    if(m){ let v=parseFloat(m[1]); if(m[2]==="pt") v*=1.333; if(v>max) max=v; }
  };
  check(el); el.querySelectorAll<HTMLElement>("*").forEach(check);
  return max;
}
function mergeLogoFragments(root:HTMLElement){
  const paras=Array.from(root.querySelectorAll("p"));
  let i=0;
  while(i<paras.length){
    const group:HTMLElement[]=[];
    let j=i;
    while(j<paras.length){
      const p=paras[j];
      if(!p.isConnected){j++;continue;}
      const text=p.textContent?.trim()||"";
      const fs=getMaxFontPx(p);
      const logoLike=text.length>0&&text.length<=30&&fs>=16;
      const consecutive=group.length===0||(
        p.previousElementSibling===group[group.length-1]&&
        p.parentElement===group[group.length-1].parentElement
      );
      if(logoLike&&consecutive){group.push(p);j++;}
      else break;
    }
    if(group.length>=2){
      const wrap=document.createElement("p");
      wrap.style.cssText="display:flex;align-items:baseline;flex-wrap:wrap;gap:0;margin:.15em 0;";
      group.forEach(p=>{
        const span=document.createElement("span");
        span.style.cssText="display:inline;white-space:pre;";
        span.innerHTML=p.innerHTML;
        wrap.appendChild(span);
      });
      group[0].parentElement?.insertBefore(wrap,group[0]);
      group.forEach(p=>p.remove());
    }
    i=j>i?j:i+1;
  }
}

// ─── Image Editor Modal ───
type ImgTab="adjust"|"transform"|"crop"|"draw";
type DrawTool="pen"|"highlighter"|"eraser"|"rect"|"circle"|"arrow"|"text";

function ImageEditorModal({src,onSave,onDelete,onReplace,onClose}:{
  src:string; onSave:(d:string)=>void; onDelete:()=>void;
  onReplace:(f:File)=>void; onClose:()=>void;
}){
  const baseRef=useRef<HTMLCanvasElement>(null);
  const overlayRef=useRef<HTMLCanvasElement>(null);
  const replaceRef=useRef<HTMLInputElement>(null);
  const [tab,setTab]=useState<ImgTab>("adjust");
  const [brightness,setBrightness]=useState(100);
  const [contrast,setContrast]=useState(100);
  const [saturation,setSaturation]=useState(100);
  const [blur,setBlur]=useState(0);
  const [zoom,setZoom]=useState(1);
  const [tool,setTool]=useState<DrawTool>("pen");
  const [color,setColor]=useState("#ff0000");
  const [sw,setSw]=useState(4);
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

  const syncSize=()=>{
    const b=baseRef.current,o=overlayRef.current;
    if(!b||!o)return;
    o.width=b.width;o.height=b.height;
  };
  useEffect(()=>{
    const img=new Image();
    img.crossOrigin="anonymous";
    img.onload=()=>{
      const c=baseRef.current!;
      c.width=img.naturalWidth||img.width||800;
      c.height=img.naturalHeight||img.height||600;
      c.getContext("2d")!.drawImage(img,0,0,c.width,c.height);
      syncSize();
      setHist({list:[c.toDataURL("image/png")],idx:0});
      setReady(true);
    };
    img.onerror=()=>toast.error("Cannot load image");
    img.src=src;
  },[src]);

  const push=()=>{
    const url=baseRef.current!.toDataURL("image/png");
    setHist(({list,idx})=>{const t=list.slice(0,idx+1);return{list:[...t,url],idx:t.length};});
  };
  const loadIdx=(idx:number,list:string[])=>{
    const img=new Image();
    img.onload=()=>{
      const c=baseRef.current!;c.width=img.width;c.height=img.height;
      c.getContext("2d")!.drawImage(img,0,0);syncSize();
    };img.src=list[idx];
  };
  const undo=()=>setHist(({list,idx})=>{if(idx<=0)return{list,idx};loadIdx(idx-1,list);return{list,idx:idx-1};});
  const redo=()=>setHist(({list,idx})=>{if(idx>=list.length-1)return{list,idx};loadIdx(idx+1,list);return{list,idx:idx+1};});

  const rotate=(d:1|-1)=>{
    const b=baseRef.current!,tmp=document.createElement("canvas");
    tmp.width=b.height;tmp.height=b.width;
    const t=tmp.getContext("2d")!;
    t.translate(tmp.width/2,tmp.height/2);t.rotate(Math.PI/2*d);
    t.drawImage(b,-b.width/2,-b.height/2);
    b.width=tmp.width;b.height=tmp.height;
    b.getContext("2d")!.drawImage(tmp,0,0);syncSize();push();
  };
  const flip=(ax:"h"|"v")=>{
    const b=baseRef.current!,tmp=document.createElement("canvas");
    tmp.width=b.width;tmp.height=b.height;
    const t=tmp.getContext("2d")!;
    if(ax==="h"){t.translate(tmp.width,0);t.scale(-1,1);}
    else{t.translate(0,tmp.height);t.scale(1,-1);}
    t.drawImage(b,0,0);
    const bctx=b.getContext("2d")!;bctx.clearRect(0,0,b.width,b.height);bctx.drawImage(tmp,0,0);push();
  };

  const getPos=(clientX:number,clientY:number)=>{
    const c=baseRef.current!,r=c.getBoundingClientRect();
    return{x:(clientX-r.left)*(c.width/r.width),y:(clientY-r.top)*(c.height/r.height)};
  };

  const commitOverlay=()=>{
    if(!hadDraw.current)return;
    const b=baseRef.current!,o=overlayRef.current!;
    b.getContext("2d")!.drawImage(o,0,0);
    o.getContext("2d")!.clearRect(0,0,o.width,o.height);
    hadDraw.current=false;push();
  };

  const onDown=(e:React.PointerEvent<HTMLCanvasElement>)=>{
    if(tab!=="draw")return;
    const p=getPos(e.clientX,e.clientY);
    if(tool==="text"){setTextPos(p);return;}
    drawing.current=true;hadDraw.current=false;startPos.current=p;lastPos.current=p;
  };
  const onMove=(e:React.PointerEvent<HTMLCanvasElement>)=>{
    if(tab!=="draw"||!drawing.current)return;
    const o=overlayRef.current!,ctx=o.getContext("2d")!,p=getPos(e.clientX,e.clientY);
    hadDraw.current=true;
    if(["pen","highlighter","eraser"].includes(tool)){
      ctx.globalCompositeOperation=tool==="eraser"?"destination-out":"source-over";
      ctx.strokeStyle=tool==="highlighter"?color+"55":color;
      ctx.lineWidth=tool==="highlighter"?sw*5:tool==="eraser"?sw*6:sw;
      ctx.lineCap="round";ctx.lineJoin="round";
      ctx.beginPath();ctx.moveTo(lastPos.current!.x,lastPos.current!.y);ctx.lineTo(p.x,p.y);ctx.stroke();
      lastPos.current=p;
    }else{
      ctx.clearRect(0,0,o.width,o.height);
      ctx.globalCompositeOperation="source-over";
      ctx.strokeStyle=color;ctx.fillStyle=color;ctx.lineWidth=sw;
      const s=startPos.current!;
      if(tool==="rect") ctx.strokeRect(Math.min(s.x,p.x),Math.min(s.y,p.y),Math.abs(p.x-s.x),Math.abs(p.y-s.y));
      else if(tool==="circle"){
        const rx=Math.abs(p.x-s.x)/2,ry=Math.abs(p.y-s.y)/2;
        ctx.beginPath();ctx.ellipse((s.x+p.x)/2,(s.y+p.y)/2,rx,ry,0,0,Math.PI*2);ctx.stroke();
      }else if(tool==="arrow") drawArrow(ctx,s.x,s.y,p.x,p.y,sw,color);
    }
  };
  const onUp=()=>{if(tab==="draw"&&drawing.current){drawing.current=false;commitOverlay();}};

  const placeText=()=>{
    if(!textPos||!textInput.trim())return;
    const ctx=overlayRef.current!.getContext("2d")!;
    ctx.font=`${Math.max(16,sw*8)}px Arial`;ctx.fillStyle=color;ctx.textBaseline="top";
    ctx.fillText(textInput,textPos.x,textPos.y);
    hadDraw.current=true;commitOverlay();setTextInput("");setTextPos(null);
  };

  const handleSave=()=>{
    const b=baseRef.current!,tmp=document.createElement("canvas");
    tmp.width=b.width;tmp.height=b.height;
    const t=tmp.getContext("2d")!;
    (t as any).filter=cssFilter;t.drawImage(b,0,0);
    onSave(tmp.toDataURL("image/png"));
  };

  const cropCss=cropRect?{
    left:cropRect.x*(baseRef.current?.getBoundingClientRect().width||1)/(baseRef.current?.width||1),
    top:cropRect.y*(baseRef.current?.getBoundingClientRect().height||1)/(baseRef.current?.height||1),
    width:cropRect.w*(baseRef.current?.getBoundingClientRect().width||1)/(baseRef.current?.width||1),
    height:cropRect.h*(baseRef.current?.getBoundingClientRect().height||1)/(baseRef.current?.height||1),
  }:null;

  const applyCrop=()=>{
    if(!cropRect||cropRect.w<4||cropRect.h<4){toast.error("Select crop area first");return;}
    const b=baseRef.current!,{x,y,w,h}=cropRect;
    const tmp=document.createElement("canvas");tmp.width=w;tmp.height=h;
    tmp.getContext("2d")!.drawImage(b,x,y,w,h,0,0,w,h);
    b.width=w;b.height=h;b.getContext("2d")!.drawImage(tmp,0,0);
    syncSize();setCropRect(null);push();setTab("adjust");
  };

  const S={btn:(a?:boolean)=>({padding:"5px 10px",borderRadius:6,fontSize:12,fontWeight:600,border:"1px solid",cursor:"pointer",background:a?"white":"transparent",color:a?"black":"white",borderColor:a?"white":"rgba(255,255,255,0.3)"} as React.CSSProperties)};

  return(
    <div className="fixed inset-0 z-[200] flex flex-col" style={{background:"rgba(0,0,0,0.95)"}}>
      {/* Top bar */}
      <div style={{background:"#1a1a1a",borderBottom:"1px solid rgba(255,255,255,0.1)",padding:"8px 12px",display:"flex",alignItems:"center",gap:8,flexWrap:"wrap"}}>
        <span style={{color:"white",fontWeight:600,fontSize:13,marginRight:4}}>Edit Image</span>
        {(["adjust","transform","crop","draw"] as ImgTab[]).map(t=>(
          <button key={t} style={S.btn(tab===t)} onClick={()=>setTab(t)}>{t.charAt(0).toUpperCase()+t.slice(1)}</button>
        ))}
        <div style={{width:1,height:20,background:"rgba(255,255,255,0.2)",margin:"0 4px"}}/>
        <button onClick={undo} disabled={hist.idx<=0} style={{...S.btn(),opacity:hist.idx<=0?0.3:1}}><Undo className="h-4 w-4"/></button>
        <button onClick={redo} disabled={hist.idx>=hist.list.length-1} style={{...S.btn(),opacity:hist.idx>=hist.list.length-1?0.3:1}}><Redo className="h-4 w-4"/></button>
        <div style={{width:1,height:20,background:"rgba(255,255,255,0.2)",margin:"0 4px"}}/>
        <button onClick={()=>setZoom(z=>Math.max(0.25,+(z-0.25).toFixed(2)))} style={S.btn()}><ZoomOut className="h-4 w-4"/></button>
        <span style={{color:"rgba(255,255,255,0.7)",fontSize:12,minWidth:36,textAlign:"center"}}>{Math.round(zoom*100)}%</span>
        <button onClick={()=>setZoom(z=>Math.min(3,+(z+0.25).toFixed(2)))} style={S.btn()}><ZoomIn className="h-4 w-4"/></button>
        <div style={{marginLeft:"auto",display:"flex",gap:8}}>
          <input ref={replaceRef} type="file" accept="image/*" className="hidden" onChange={e=>{const f=e.target.files?.[0];if(f)onReplace(f);e.target.value="";}}/>
          <button onClick={()=>replaceRef.current?.click()} style={S.btn()}>Replace</button>
          <button onClick={onDelete} style={{...S.btn(),borderColor:"#ef4444",color:"#ef4444"}}>Delete</button>
          <button onClick={onClose} style={S.btn()}>Cancel</button>
          <button onClick={handleSave} style={{padding:"5px 14px",borderRadius:6,border:"none",background:"white",color:"black",cursor:"pointer",fontSize:12,fontWeight:700}}>Save</button>
        </div>
      </div>

      {/* Sub toolbar */}
      <div style={{background:"#111",padding:"6px 12px",display:"flex",alignItems:"center",gap:8,flexWrap:"wrap",minHeight:44}}>
        {tab==="adjust"&&<>
          {[["Brightness",brightness,setBrightness,40,160],["Contrast",contrast,setContrast,40,160],["Saturation",saturation,setSaturation,0,200],["Blur",blur,setBlur,0,10]].map(([label,val,setter,min,max])=>(
            <label key={label as string} style={{color:"rgba(255,255,255,0.7)",fontSize:12,display:"flex",alignItems:"center",gap:6}}>
              {label as string}
              <input type="range" min={min as number} max={max as number} value={val as number} onChange={e=>(setter as any)(Number(e.target.value))} style={{width:90}}/>
              <span style={{minWidth:28}}>{val as number}{label==="Blur"?"px":"%"}</span>
            </label>
          ))}
          <button onClick={()=>{setBrightness(100);setContrast(100);setSaturation(100);setBlur(0);}} style={S.btn()}>Reset</button>
        </>}
        {tab==="transform"&&<>
          <button onClick={()=>rotate(-1)} style={S.btn()} title="Rotate Left"><RotateCcw className="h-4 w-4"/></button>
          <button onClick={()=>rotate(1)} style={S.btn()} title="Rotate Right"><RotateCw className="h-4 w-4"/></button>
          <button onClick={()=>flip("h")} style={S.btn()} title="Flip H"><FlipHorizontal className="h-4 w-4"/></button>
          <button onClick={()=>flip("v")} style={S.btn()} title="Flip V"><FlipVertical className="h-4 w-4"/></button>
        </>}
        {tab==="crop"&&<>
          <span style={{color:"rgba(255,255,255,0.6)",fontSize:12}}>Drag to select crop area</span>
          <button onClick={applyCrop} style={{...S.btn(),background:"white",color:"black",borderColor:"white"}}>Apply Crop</button>
          <button onClick={()=>setCropRect(null)} style={S.btn()}>Clear</button>
        </>}
        {tab==="draw"&&<>
          {([["pen",<Pencil className="h-4 w-4"/>],["highlighter",<Highlighter className="h-4 w-4"/>],["eraser",<Eraser className="h-4 w-4"/>],["rect",<Square className="h-4 w-4"/>],["circle",<Circle className="h-4 w-4"/>],["arrow",<ArrowUpRight className="h-4 w-4"/>],["text",<Type className="h-4 w-4"/>]] as [DrawTool,React.ReactNode][]).map(([t,icon])=>(
            <button key={t} onClick={()=>setTool(t)} style={S.btn(tool===t)}>{icon}</button>
          ))}
          <input type="color" value={color} onChange={e=>setColor(e.target.value)} style={{width:28,height:28,borderRadius:4,cursor:"pointer",border:"none"}}/>
          <label style={{color:"rgba(255,255,255,0.6)",fontSize:12,display:"flex",alignItems:"center",gap:4}}>
            Size<input type="range" min={1} max={20} value={sw} onChange={e=>setSw(Number(e.target.value))} style={{width:70}}/>
          </label>
          {tool==="text"&&textPos&&<>
            <input autoFocus value={textInput} onChange={e=>setTextInput(e.target.value)} onKeyDown={e=>e.key==="Enter"&&placeText()}
              placeholder="Type text…" style={{background:"rgba(255,255,255,0.1)",color:"white",border:"1px solid rgba(255,255,255,0.2)",borderRadius:6,padding:"4px 8px",fontSize:13,outline:"none",width:140}}/>
            <button onClick={placeText} style={{...S.btn(),background:"white",color:"black",borderColor:"white"}}>Place</button>
          </>}
        </>}
      </div>

      {/* Canvas */}
      <div style={{flex:1,overflow:"auto",display:"flex",alignItems:"center",justifyContent:"center",padding:16}}>
        {!ready&&<span style={{color:"white",fontSize:13}}>Loading image…</span>}
        <div style={{position:"relative",transform:`scale(${zoom})`,transformOrigin:"center center"}}>
          <div style={{position:"relative",filter:cssFilter}}>
            <canvas ref={baseRef} style={{display:"block",maxWidth:"80vw",maxHeight:"68vh",border:"2px solid rgba(255,255,255,0.15)",borderRadius:4}}/>
            <canvas ref={overlayRef} style={{position:"absolute",top:0,left:0,width:"100%",height:"100%",
              cursor:tab==="draw"?(tool==="eraser"?"cell":tool==="text"?"text":"crosshair"):"default"}}
              onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerLeave={onUp}/>
            {tab==="crop"&&(
              <div style={{position:"absolute",inset:0,cursor:"crosshair"}}
                onPointerDown={e=>{const p=getPos(e.clientX,e.clientY);cropStart.current=p;setCropRect({x:p.x,y:p.y,w:0,h:0});}}
                onPointerMove={e=>{if(!cropStart.current)return;const p=getPos(e.clientX,e.clientY),s=cropStart.current;setCropRect({x:Math.min(s.x,p.x),y:Math.min(s.y,p.y),w:Math.abs(p.x-s.x),h:Math.abs(p.y-s.y)});}}
                onPointerUp={()=>{cropStart.current=null;}} onPointerLeave={()=>{cropStart.current=null;}}>
                {cropCss&&<div style={{position:"absolute",...cropCss,border:"2px dashed #fff",background:"rgba(255,255,255,0.15)",pointerEvents:"none"}}/>}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Insert Table Modal ───
function InsertTableModal({onInsert,onClose}:{onInsert:(r:number,c:number)=>void;onClose:()=>void}){
  const [rows,setRows]=useState(3);
  const [cols,setCols]=useState(3);
  return(
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-xs">
        <DialogHeader><DialogTitle>Insert Table</DialogTitle></DialogHeader>
        <div className="space-y-3 py-2">
          <div className="flex items-center gap-3"><label className="text-sm w-20">Rows:</label><Input type="number" min={1} max={50} value={rows} onChange={e=>setRows(Number(e.target.value))} className="w-24"/></div>
          <div className="flex items-center gap-3"><label className="text-sm w-20">Columns:</label><Input type="number" min={1} max={10} value={cols} onChange={e=>setCols(Number(e.target.value))} className="w-24"/></div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={()=>onInsert(rows,cols)}>Insert</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ══════════════════════════════════════════════
//  MAIN EDITOR
// ══════════════════════════════════════════════
export default function DocumentEditorPage(){
  const {profile}=useAuth();
  const editorRef=useRef<HTMLDivElement>(null);
  const wordRef=useRef<HTMLInputElement>(null);
  const pdfRef=useRef<HTMLInputElement>(null);
  const imgRef=useRef<HTMLInputElement>(null);
  const saveTimer=useRef<NodeJS.Timeout|null>(null);
  const savedRange=useRef<Range|null>(null);
  const dragStartX=useRef<number|null>(null);

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

  // ── Load docs ──
  const loadDocs=useCallback(async()=>{
    if(!profile)return;
    const{data}=await supabase.from("user_documents").select("*")
      .eq("user_id",profile.id).order("updated_at",{ascending:false});
    setDocs((data??[]) as Doc[]);
  },[profile]);

  useEffect(()=>{loadDocs();},[loadDocs]);

  const filteredDocs=useMemo(()=>{
    let list=docs;
    if(docSearch.trim()){const q=docSearch.trim().toLowerCase();list=list.filter(d=>d.title.toLowerCase().includes(q));}
    list=[...list];
    if(docSort==="name") list.sort((a,b)=>a.title.localeCompare(b.title));
    else list.sort((a,b)=>new Date(b.updated_at).getTime()-new Date(a.updated_at).getTime());
    return list;
  },[docs,docSearch,docSort]);

  // ── Track selection ──
  useEffect(()=>{
    const h=()=>{
      const s=window.getSelection();
      if(!s||s.rangeCount===0)return;
      const r=s.getRangeAt(0);
      if(editorRef.current?.contains(r.commonAncestorContainer)) savedRange.current=r.cloneRange();
    };
    document.addEventListener("selectionchange",h);
    return()=>document.removeEventListener("selectionchange",h);
  },[]);

  const restoreSel=():Range|null=>{
    const ed=editorRef.current;if(!ed)return null;
    ed.focus();
    const sel=window.getSelection();if(!sel)return null;
    if(savedRange.current&&ed.contains(savedRange.current.startContainer)){
      sel.removeAllRanges();sel.addRange(savedRange.current);return savedRange.current;
    }
    const r=document.createRange();r.selectNodeContents(ed);r.collapse(false);
    sel.removeAllRanges();sel.addRange(r);return r;
  };

  // ── Image click → editor ──
  useEffect(()=>{
    const ed=editorRef.current;if(!ed)return;
    const fn=(e:MouseEvent)=>{const t=e.target as HTMLElement;if(t.tagName==="IMG"){setEditImgEl(t as HTMLImageElement);setEditImgSrc((t as HTMLImageElement).src);}};
    ed.addEventListener("click",fn);
    return()=>ed.removeEventListener("click",fn);
  },[sel]);

  // ── Select doc ──
  const selectDoc=(doc:Doc)=>{
    setSel(doc);setTitle(doc.title);
    requestAnimationFrame(()=>{
      if(editorRef.current){editorRef.current.innerHTML=doc.content||"";editorRef.current.focus();}
    });
  };

  // ── CRUD ──
  const createDoc=async()=>{
    if(!profile)return;
    const{data,error}=await supabase.from("user_documents")
      .insert({user_id:profile.id,title:"Untitled Document",content:""}).select("*").single();
    if(error)return toast.error(error.message);
    toast.success("New document created!");
    await loadDocs();selectDoc(data as Doc);
  };

  const dupDoc=async(doc:Doc)=>{
    if(!profile)return;
    const{data,error}=await supabase.from("user_documents")
      .insert({user_id:profile.id,title:doc.title+" (Copy)",content:doc.content}).select("*").single();
    if(error)return toast.error(error.message);
    toast.success("Duplicated!");await loadDocs();selectDoc(data as Doc);
  };

  const startRename=(doc:Doc)=>{setRenamingId(doc.id);setRenameVal(doc.title);};
  const commitRename=async(doc:Doc)=>{
    const t=renameVal.trim()||doc.title;setRenamingId(null);
    if(t===doc.title)return;
    const{error}=await supabase.from("user_documents").update({title:t}).eq("id",doc.id);
    if(error)return toast.error(error.message);
    setDocs(prev=>prev.map(d=>d.id===doc.id?{...d,title:t}:d));
    if(sel?.id===doc.id)setTitle(t);
  };

  const autoSave=useCallback(async()=>{
    if(!sel||!profile)return;
    const content=editorRef.current?.innerHTML||"";
    const{error}=await supabase.from("user_documents").update({title,content,updated_at:new Date().toISOString()}).eq("id",sel.id);
    if(!error)setDocs(prev=>prev.map(d=>d.id===sel.id?{...d,title,content}:d));
  },[sel,title,profile]);

  const handleSave=async()=>{setSaving(true);await autoSave();setSaving(false);toast.success("Saved!");};

  const triggerSave=()=>{
    if(saveTimer.current)clearTimeout(saveTimer.current);
    saveTimer.current=setTimeout(autoSave,1500);
    updateFmts();
  };

  const handleDelete=async()=>{
    if(!deleteTarget)return;
    await supabase.from("user_documents").delete().eq("id",deleteTarget.id);
    toast.success("Deleted!");setDeleteOpen(false);setDeleteTarget(null);
    if(sel?.id===deleteTarget.id){setSel(null);if(editorRef.current)editorRef.current.innerHTML="";}
    await loadDocs();
  };

  // ── Format ──
  const exec=(cmd:string,val?:string)=>{restoreSel();document.execCommand(cmd,false,val);updateFmts();triggerSave();};

  const updateFmts=()=>{
    try{setFormats({
      bold:document.queryCommandState("bold"),
      italic:document.queryCommandState("italic"),
      underline:document.queryCommandState("underline"),
      strikeThrough:document.queryCommandState("strikeThrough"),
      justifyLeft:document.queryCommandState("justifyLeft"),
      justifyCenter:document.queryCommandState("justifyCenter"),
      justifyRight:document.queryCommandState("justifyRight"),
      justifyFull:document.queryCommandState("justifyFull"),
      insertUnorderedList:document.queryCommandState("insertUnorderedList"),
      insertOrderedList:document.queryCommandState("insertOrderedList"),
    });}catch{}
  };

  const applyBlock=(tag:string)=>{restoreSel();document.execCommand("formatBlock",false,`<${tag}>`);updateFmts();triggerSave();};

  // ── Insert Table ──
  const insertTable=(rows:number,cols:number)=>{
    const ed=editorRef.current;if(!ed)return;
    const range=restoreSel();if(!range)return;
    let html=`<br><table style="border-collapse:collapse;width:100%;margin:6px 0;table-layout:fixed;">`;
    for(let r=0;r<rows;r++){
      html+="<tr>";
      for(let c=0;c<cols;c++){
        const isH=r===0;
        const sty=`border:1px solid #999;padding:5px 8px;min-width:30px;word-break:break-word;vertical-align:top;${isH?"background:#f0f0f0;font-weight:600;":""}`;
        html+=isH?`<th style="${sty}">H${c+1}</th>`:`<td style="${sty}">&nbsp;</td>`;
      }
      html+="</tr>";
    }
    html+="</table><br>";
    const sel=window.getSelection()!;
    const lr=sel.rangeCount>0?sel.getRangeAt(0):range;
    lr.deleteContents();
    const frag=lr.createContextualFragment(html);
    const last=frag.lastChild;
    lr.insertNode(frag);
    if(last){const ar=document.createRange();ar.setStartAfter(last);ar.collapse(true);sel.removeAllRanges();sel.addRange(ar);savedRange.current=ar.cloneRange();}
    setShowTableModal(false);triggerSave();toast.success("Table inserted!");
  };

  // ── Image upload ──
  const handleImgUpload=(e:React.ChangeEvent<HTMLInputElement>)=>{
    const files=Array.from(e.target.files||[]);if(!files.length)return;
    const range=restoreSel();
    files.forEach(file=>{
      const reader=new FileReader();
      reader.onload=ev=>{
        const src=ev.target?.result as string;
        const ed=editorRef.current;if(!ed||!range)return;
        ed.focus();
        const html=`<img src="${src}" style="max-width:100%;height:auto;display:block;margin:6px 0;cursor:pointer;"/>`;
        const sel=window.getSelection();
        if(sel&&sel.rangeCount>0){const lr=sel.getRangeAt(0);const frag=lr.createContextualFragment(html);lr.insertNode(frag);lr.collapse(false);}
        else ed.innerHTML+=html;
        triggerSave();
      };
      reader.readAsDataURL(file);
    });
    e.target.value="";
  };

  // ── Word Import ──
  const handleWordUpload=async(e:React.ChangeEvent<HTMLInputElement>)=>{
    const files=Array.from(e.target.files||[]);if(!files.length)return;
    e.target.value="";
    if(typeof mammoth==="undefined"){toast.error("Word converter not loaded — please refresh.");return;}
    setImporting(true);
    for(const file of files){
      try{
        const buf=await file.arrayBuffer();
        const result=await mammoth.convertToHtml(
          {arrayBuffer:buf},
          {styleMap:["p[style-name='Heading 1'] => h1:fresh","p[style-name='Heading 2'] => h2:fresh","p[style-name='Heading 3'] => h3:fresh"]}
        );
        const parser=new DOMParser();
        const dom=parser.parseFromString(result.value,"text/html");

        // Fix absolute positioning (Word text boxes)
        dom.querySelectorAll<HTMLElement>("[style]").forEach(el=>{
          const s=el.style;
          if(s.position==="absolute"||s.position==="fixed") s.position="static";
          if(s.top) s.top="";if(s.left) s.left="";if(s.right) s.right="";if(s.bottom) s.bottom="";
          if(s.marginTop&&parseFloat(s.marginTop)<0) s.marginTop="0";
          if(s.marginLeft&&parseFloat(s.marginLeft)<0) s.marginLeft="0";
          if(s.textIndent&&parseFloat(s.textIndent)<0) s.textIndent="0";
          if(s.transform) s.transform="";
        });

        // Merge logo fragments inline
        mergeLogoFragments(dom.body);

        // Style tables
        dom.querySelectorAll("table").forEach(t=>{
          (t as HTMLElement).style.cssText="border-collapse:collapse;width:100%;margin:6px 0;";
        });
        dom.querySelectorAll("td,th").forEach(c=>{
          (c as HTMLElement).style.cssText+="border:1px solid #999;padding:5px 8px;vertical-align:top;word-break:break-word;";
        });
        dom.querySelectorAll("th").forEach(c=>{
          (c as HTMLElement).style.background="#f0f0f0";(c as HTMLElement).style.fontWeight="600";
        });
        dom.querySelectorAll("img").forEach(img=>{
          (img as HTMLElement).style.cssText="max-width:100%;height:auto;display:block;margin:6px 0;cursor:pointer;";
        });

        const styledHtml=dom.body.innerHTML;
        const newTitle=file.name.replace(/\.docx?$/i,"");
        const{data,error}=await supabase.from("user_documents")
          .insert({user_id:profile?.id,title:newTitle,content:styledHtml}).select("*").single();
        if(error)throw error;
        await loadDocs();selectDoc(data as Doc);
        toast.success(`"${newTitle}" imported!`);
      }catch(err:any){
        toast.error(`Failed: "${file.name}" — ${err?.message||"Unknown error"}`);
      }
    }
    setImporting(false);
  };

  // ── PDF Import (renders pages as images — pixel-perfect) ──
  const handlePdfUpload=async(e:React.ChangeEvent<HTMLInputElement>)=>{
    const files=Array.from(e.target.files||[]);if(!files.length)return;
    e.target.value="";
    if(typeof pdfjsLib==="undefined"){toast.error("PDF renderer not loaded — please refresh.");return;}
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
          pagesHtml+=`<div style="page-break-after:always;margin-bottom:16px;"><img src="${canvas.toDataURL("image/jpeg",0.92)}" style="width:100%;display:block;cursor:pointer;"/></div>`;
        }
        const newTitle=file.name.replace(/\.pdf$/i,"");
        const{data,error}=await supabase.from("user_documents")
          .insert({user_id:profile?.id,title:newTitle,content:pagesHtml}).select("*").single();
        if(error)throw error;
        await loadDocs();selectDoc(data as Doc);
        toast.success(`"${newTitle}" imported (${pdf.numPages} pages)`);
      }catch(err:any){
        toast.error(`Failed: "${file.name}" — ${err?.message||"Unknown error"}`);
      }
    }
    setImporting(false);
  };

  // ── Export ──
  const exportCSS=`
    body{font-family:Calibri,Arial,sans-serif;width:816px;margin:0 auto;padding:72px 96px;line-height:1.15;font-size:11pt;color:#000;}
    h1{font-size:20pt;font-weight:700;margin:.3em 0;}h2{font-size:16pt;font-weight:700;margin:.3em 0;}h3{font-size:13pt;font-weight:600;margin:.3em 0;}
    table{border-collapse:collapse;width:100%;margin:6px 0;}td,th{border:1px solid #999;padding:5px 8px;vertical-align:top;}th{background:#f0f0f0;font-weight:600;}
    ul{list-style:disc;padding-left:1.5em;}ol{list-style:decimal;padding-left:1.5em;}
    img{max-width:100%;height:auto;}
    @media print{body{padding:0.75in 1in;}}
  `;
  const fullHtml=(body:string)=>`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>${title}</title><style>${exportCSS}</style></head><body>${body}</body></html>`;
  const dl=(content:string,type:string,name:string)=>{Object.assign(document.createElement("a"),{href:URL.createObjectURL(new Blob([content],{type})),download:name}).click();};
  const printDoc=()=>{const w=window.open("","_blank");if(!w)return;w.document.write(fullHtml(editorRef.current?.innerHTML||""));w.document.close();w.print();};

  // ── Toolbar btn ──
  const tb=(active:boolean)=>cn("h-7 w-7 p-0 rounded flex items-center justify-center transition-colors shrink-0 border",
    active?"bg-blue-100 border-blue-400 text-blue-700":"border-transparent hover:bg-gray-100 text-gray-700");

  // ══════════════ RENDER ══════════════
  return(
    <>
      {showTableModal&&<InsertTableModal onInsert={insertTable} onClose={()=>setShowTableModal(false)}/>}
      {editImgEl&&editImgSrc&&(
        <ImageEditorModal src={editImgSrc}
          onSave={d=>{if(editImgEl)editImgEl.src=d;triggerSave();toast.success("Image updated!");setEditImgEl(null);setEditImgSrc(null);}}
          onDelete={()=>{if(editImgEl)editImgEl.remove();triggerSave();toast.success("Image removed");setEditImgEl(null);setEditImgSrc(null);}}
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

      {/* Drawer pull tab */}
      <div onClick={()=>setDrawerOpen(o=>!o)}
        onPointerDown={e=>{dragStartX.current=e.clientX;}}
        onPointerMove={e=>{if(dragStartX.current!==null&&e.clientX-dragStartX.current>24){setDrawerOpen(true);dragStartX.current=null;}}}
        onPointerUp={()=>{dragStartX.current=null;}}
        className="fixed left-0 top-1/2 -translate-y-1/2 z-40 flex items-center justify-center w-4 h-14 bg-blue-600 hover:bg-blue-700 rounded-r-lg cursor-pointer shadow-lg transition-colors"
        title="Documents">
        <ChevronRight className={cn("h-3 w-3 text-white transition-transform",drawerOpen&&"rotate-180")}/>
      </div>

      {drawerOpen&&<div className="fixed inset-0 z-30 bg-black/20" onClick={()=>setDrawerOpen(false)}/>}

      {/* Document drawer */}
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
              className={cn("flex items-center justify-between rounded px-2 py-1.5 cursor-pointer group transition-colors text-sm",
                sel?.id===doc.id?"bg-blue-50 text-blue-700":"hover:bg-gray-100 text-gray-700")}>
              <div className="flex items-center gap-1.5 min-w-0 flex-1">
                <FileText className="h-3.5 w-3.5 shrink-0"/>
                {renamingId===doc.id?(
                  <Input autoFocus value={renameVal} onClick={e=>e.stopPropagation()}
                    onChange={e=>setRenameVal(e.target.value)}
                    onBlur={()=>commitRename(doc)}
                    onKeyDown={e=>{if(e.key==="Enter")commitRename(doc);if(e.key==="Escape")setRenamingId(null);}}
                    className="h-6 text-xs px-1"/>
                ):(
                  <span className="text-xs truncate">{doc.title}</span>
                )}
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

      {/* ══ MAIN LAYOUT ══ */}
      <div className="flex flex-col h-[calc(100vh-56px)] overflow-hidden bg-[#f0f0f0]">

        {/* ══ WORD-STYLE RIBBON TOOLBAR ══ */}
        <div className="bg-white border-b border-gray-300 select-none" style={{boxShadow:"0 1px 3px rgba(0,0,0,0.1)"}}>

          {/* Row 1: File actions */}
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
                <DropdownMenuItem onClick={printDoc}>🖨️ Save as PDF (Print)</DropdownMenuItem>
                <DropdownMenuItem onClick={()=>dl(fullHtml(editorRef.current?.innerHTML||""),"text/html",`${title}.html`)}>📄 Download HTML</DropdownMenuItem>
                <DropdownMenuItem onClick={()=>dl(editorRef.current?.innerText||"","text/plain",`${title}.txt`)}>📝 Download TXT</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <div className="w-px h-5 bg-gray-300 mx-1"/>
            <button onClick={()=>exec("undo")} className={tb(false)} title="Undo (Ctrl+Z)"><Undo className="h-3.5 w-3.5"/></button>
            <button onClick={()=>exec("redo")} className={tb(false)} title="Redo (Ctrl+Y)"><Redo className="h-3.5 w-3.5"/></button>
          </div>

          {/* Row 2: Formatting — exactly like Word */}
          <div className="flex items-center gap-0.5 px-3 py-1 flex-wrap">

            {/* Block format */}
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

            <div className="w-px h-5 bg-gray-300 mx-1"/>

            {/* Font family */}
            <Select value={fontFamily} onValueChange={v=>{setFontFamily(v);exec("fontName",v);}}>
              <SelectTrigger className="h-7 w-36 text-xs border-gray-300"><SelectValue/></SelectTrigger>
              <SelectContent>
                {FONT_FAMILIES.map(f=><SelectItem key={f} value={f} style={{fontFamily:f}}>{f}</SelectItem>)}
              </SelectContent>
            </Select>

            {/* Font size */}
            <Select value={fontSize} onValueChange={v=>{
              setFontSize(v);restoreSel();
              const s=window.getSelection();
              if(s&&s.rangeCount>0&&!s.isCollapsed){
                const r=s.getRangeAt(0);const span=document.createElement("span");
                span.style.fontSize=v+"pt";
                try{r.surroundContents(span);}catch{}
                triggerSave();
              }
            }}>
              <SelectTrigger className="h-7 w-16 text-xs border-gray-300"><SelectValue/></SelectTrigger>
              <SelectContent>{FONT_SIZES.map(s=><SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
            </Select>

            <div className="w-px h-5 bg-gray-300 mx-1"/>

            {/* B I U S */}
            <button className={tb(formats.bold)} onClick={()=>exec("bold")} title="Bold (Ctrl+B)"><Bold className="h-4 w-4"/></button>
            <button className={tb(formats.italic)} onClick={()=>exec("italic")} title="Italic (Ctrl+I)"><Italic className="h-4 w-4"/></button>
            <button className={tb(formats.underline)} onClick={()=>exec("underline")} title="Underline (Ctrl+U)"><Underline className="h-4 w-4"/></button>
            <button className={tb(formats.strikeThrough)} onClick={()=>exec("strikeThrough")} title="Strikethrough"><Strikethrough className="h-4 w-4"/></button>

            <div className="w-px h-5 bg-gray-300 mx-1"/>

            {/* Text color */}
            <div className="relative">
              <button className={tb(false)} title="Font Color" onClick={()=>{setShowColorPicker(p=>!p);setShowBgPicker(false);}}>
                <Type className="h-4 w-4"/>
              </button>
              {showColorPicker&&(
                <div className="absolute top-8 left-0 z-50 bg-white border border-gray-200 rounded-lg shadow-xl p-2 grid grid-cols-10 gap-1" style={{width:220}}>
                  {COLORS.map(c=>(
                    <button key={c} style={{backgroundColor:c,width:18,height:18,borderRadius:3,border:"1px solid rgba(0,0,0,0.15)"}}
                      className="hover:scale-125 transition-transform"
                      onClick={()=>{exec("foreColor",c);setShowColorPicker(false);}}/>
                  ))}
                </div>
              )}
            </div>

            {/* Highlight */}
            <div className="relative">
              <button className={tb(false)} title="Highlight Color" onClick={()=>{setShowBgPicker(p=>!p);setShowColorPicker(false);}}>
                <Palette className="h-4 w-4"/>
              </button>
              {showBgPicker&&(
                <div className="absolute top-8 left-0 z-50 bg-white border border-gray-200 rounded-lg shadow-xl p-2 grid grid-cols-10 gap-1" style={{width:220}}>
                  {COLORS.map(c=>(
                    <button key={c} style={{backgroundColor:c,width:18,height:18,borderRadius:3,border:"1px solid rgba(0,0,0,0.15)"}}
                      className="hover:scale-125 transition-transform"
                      onClick={()=>{exec("hiliteColor",c);setShowBgPicker(false);}}/>
                  ))}
                </div>
              )}
            </div>

            <div className="w-px h-5 bg-gray-300 mx-1"/>

            {/* Alignment */}
            <button className={tb(formats.justifyLeft)} onClick={()=>exec("justifyLeft")} title="Align Left"><AlignLeft className="h-4 w-4"/></button>
            <button className={tb(formats.justifyCenter)} onClick={()=>exec("justifyCenter")} title="Center"><AlignCenter className="h-4 w-4"/></button>
            <button className={tb(formats.justifyRight)} onClick={()=>exec("justifyRight")} title="Right"><AlignRight className="h-4 w-4"/></button>
            <button className={tb(formats.justifyFull)} onClick={()=>exec("justifyFull")} title="Justify"><AlignJustify className="h-4 w-4"/></button>

            <div className="w-px h-5 bg-gray-300 mx-1"/>

            {/* Lists */}
            <button className={tb(formats.insertUnorderedList)} onClick={()=>exec("insertUnorderedList")} title="Bullet List"><List className="h-4 w-4"/></button>
            <button className={tb(formats.insertOrderedList)} onClick={()=>exec("insertOrderedList")} title="Numbered List"><ListOrdered className="h-4 w-4"/></button>

            <div className="w-px h-5 bg-gray-300 mx-1"/>

            {/* Insert */}
            <button className={tb(false)} onClick={()=>{restoreSel();setShowTableModal(true);}} title="Insert Table"><Table className="h-4 w-4"/></button>
            <button className={tb(false)} onClick={()=>imgRef.current?.click()} title="Insert Image"><ImageIcon className="h-4 w-4"/></button>
            <button className={tb(false)} onClick={()=>{const u=prompt("Enter URL:");if(u)exec("createLink",u);}} title="Insert Link"><Link className="h-4 w-4"/></button>
          </div>
        </div>

        {/* Title bar */}
        {sel&&(
          <div className="flex items-center gap-2 px-4 py-1 bg-white border-b border-gray-200">
            <Input value={title} onChange={e=>setTitle(e.target.value)} onBlur={handleSave}
              className="text-sm font-medium border-none shadow-none focus-visible:ring-0 px-0 h-7 bg-transparent text-gray-800"
              placeholder="Document title…"/>
            {importing&&<span className="text-xs text-gray-500 animate-pulse">Importing…</span>}
          </div>
        )}

        {/* ══ PAGE CANVAS ══ */}
        {sel?(
          <div className="flex-1 overflow-auto" style={{background:"#e8eaed"}}>
            <style>{`
              #ld-ed{outline:none;min-height:100%;color:#000;font-family:Calibri,Arial,sans-serif;font-size:11pt;line-height:1.15;}
              #ld-ed:empty:before{content:"Start typing here…";color:#9ca3af;pointer-events:none;}
              #ld-ed h1{font-size:20pt;font-weight:700;margin:.3em 0;color:#000;}
              #ld-ed h2{font-size:16pt;font-weight:700;margin:.3em 0;color:#000;}
              #ld-ed h3{font-size:13pt;font-weight:600;margin:.3em 0;color:#000;}
              #ld-ed blockquote{border-left:3px solid #ccc;padding:3px 12px;color:#555;margin:4px 0;}
              #ld-ed pre{background:#f5f5f5;padding:10px;border-radius:4px;font-family:monospace;font-size:.85em;overflow-x:auto;}
              #ld-ed ul{list-style:disc !important;padding-left:1.5em !important;margin:3px 0;}
              #ld-ed ol{list-style:decimal !important;padding-left:1.5em !important;margin:3px 0;}
              #ld-ed li{display:list-item !important;}
              #ld-ed table{border-collapse:collapse;width:100%;margin:6px 0;}
              #ld-ed td,#ld-ed th{border:1px solid #999;padding:5px 8px;vertical-align:top;min-width:30px;word-break:break-word;}
              #ld-ed th{background:#f0f0f0;font-weight:600;}
              #ld-ed img{max-width:100%;height:auto;cursor:pointer;display:block;margin:6px 0;}
              #ld-ed img:hover{outline:2px solid #4a86e8;outline-offset:2px;}
              #ld-ed a{color:#1155cc;text-decoration:underline;}
              #ld-ed p{margin:0 0 1px 0;min-height:1.15em;}
            `}</style>

            {/* Word A4 page — exact margins like Word default */}
            <div style={{display:"flex",justifyContent:"center",padding:"40px 24px 80px 24px"}}>
              <div style={{
                transform:`scale(${pageZoom/100})`,
                transformOrigin:"top center",
                transition:"transform 0.1s",
              }}>
                <div style={{
                  background:"#fff",
                  width:"816px",       // 8.5in @ 96dpi
                  minHeight:"1056px",  // 11in @ 96dpi
                  padding:"96px 96px", // 1 inch margins all sides — exactly Word default
                  boxShadow:"0 1px 8px rgba(0,0,0,0.18)",
                  fontFamily:fontFamily,
                  fontSize:fontSize+"pt",
                  lineHeight:"1.15",
                  wordBreak:"break-word",
                  boxSizing:"border-box" as any,
                  color:"#000",
                }}>
                  <div id="ld-ed" ref={editorRef}
                    contentEditable suppressContentEditableWarning
                    onInput={triggerSave} onKeyUp={updateFmts} onMouseUp={updateFmts}
                    style={{minHeight:"864px"}}/>
                </div>
              </div>
            </div>

            {/* ── Word-style zoom bar at bottom ── */}
            <div style={{
              position:"fixed",bottom:16,right:24,
              display:"flex",alignItems:"center",gap:6,
              background:"white",border:"1px solid #d0d0d0",
              borderRadius:20,padding:"4px 12px",
              boxShadow:"0 2px 8px rgba(0,0,0,0.15)",
              zIndex:30,
            }}>
              <button onClick={()=>setPageZoom(z=>Math.max(25,z-10))}
                className="w-6 h-6 flex items-center justify-center rounded-full hover:bg-gray-100 text-gray-600 transition-colors" title="Zoom Out">
                <ZoomOut className="h-4 w-4"/>
              </button>
              <input type="range" min={25} max={200} step={5} value={pageZoom}
                onChange={e=>setPageZoom(Number(e.target.value))}
                style={{width:100,accentColor:"#4a86e8"}}/>
              <button onClick={()=>setPageZoom(z=>Math.min(200,z+10))}
                className="w-6 h-6 flex items-center justify-center rounded-full hover:bg-gray-100 text-gray-600 transition-colors" title="Zoom In">
                <ZoomIn className="h-4 w-4"/>
              </button>
              <button onClick={()=>setPageZoom(100)}
                className="text-xs font-medium text-blue-600 hover:text-blue-800 min-w-[36px] text-center" title="Reset to 100%">
                {pageZoom}%
              </button>
            </div>
          </div>
        ):(
          <div className="flex-1 flex flex-col items-center justify-center text-center p-8" style={{background:"#e8eaed"}}>
            <FileText className="h-16 w-16 text-gray-400 mb-4"/>
            <h2 className="text-xl font-semibold mb-2 text-gray-700">No document selected</h2>
            <p className="text-gray-500 mb-6 text-sm">Click the arrow on the left edge to open documents, or start a new one</p>
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
