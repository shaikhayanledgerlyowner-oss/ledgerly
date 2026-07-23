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
  Copy, Pencil, Crop, RotateCw, RotateCcw, FlipHorizontal, FlipVertical,
  Square, Circle, ArrowUpRight, Highlighter, Eraser, ZoomIn, ZoomOut,
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

declare const mammoth: any;
// PDF import requires pdf.js loaded globally, e.g. in index.html:
//   <script src="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js"></script>
//   <script>pdfjsLib.GlobalWorkerOptions.workerSrc =
//     "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";</script>
declare const pdfjsLib: any;

interface Doc {
  id: string;
  title: string;
  content: string;
  updated_at: string;
}

const FONT_SIZES = ["8","10","12","14","16","18","20","24","28","32","36","48","64","72"];
const FONT_FAMILIES = ["Arial","Times New Roman","Courier New","Georgia","Verdana","Trebuchet MS","Impact"];
const COLORS = [
  "#000000","#434343","#666666","#999999","#b7b7b7","#cccccc","#ffffff",
  "#ff0000","#ff4500","#ff9900","#ffff00","#00ff00","#00ffff","#0000ff","#9900ff",
  "#ff00ff","#ff69b4","#8b0000","#006400","#00008b","#4b0082","#ff6347","#ffa500",
];

function drawArrowHead(ctx: CanvasRenderingContext2D, x1:number, y1:number, x2:number, y2:number, width:number, color:string) {
  const headlen = Math.max(10, width * 4);
  const angle = Math.atan2(y2 - y1, x2 - x1);
  ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineWidth = width; ctx.lineCap = "round";
  ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x2, y2);
  ctx.lineTo(x2 - headlen * Math.cos(angle - Math.PI / 6), y2 - headlen * Math.sin(angle - Math.PI / 6));
  ctx.lineTo(x2 - headlen * Math.cos(angle + Math.PI / 6), y2 - headlen * Math.sin(angle + Math.PI / 6));
  ctx.closePath(); ctx.fill();
}

/* ════════════════════════════════════════════
   IMAGE EDITOR — full-screen, mobile-gallery style
   Tabs: Adjust / Transform / Crop / Draw. Undo/redo history.
═══════════════════════════════════════════ */
type ImgTab = "adjust" | "transform" | "crop" | "draw";
type DrawTool = "pen" | "highlighter" | "eraser" | "rect" | "circle" | "arrow" | "text";

function ImageEditorModal({ src, onSave, onDelete, onReplace, onClose }: {
  src: string;
  onSave: (dataUrl: string) => void;
  onDelete: () => void;
  onReplace: (file: File) => void;
  onClose: () => void;
}) {
  const baseCanvasRef    = useRef<HTMLCanvasElement>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement>(null);
  const replaceInputRef  = useRef<HTMLInputElement>(null);

  const [tab, setTab]           = useState<ImgTab>("adjust");
  const [brightness, setBrightness] = useState(100);
  const [contrast, setContrast]     = useState(100);
  const [saturation, setSaturation] = useState(100);
  const [blur, setBlur]             = useState(0);
  const [zoom, setZoom]             = useState(1);

  const [tool, setTool]           = useState<DrawTool>("pen");
  const [color, setColor]         = useState("#ff0000");
  const [strokeWidth, setStrokeWidth] = useState(4);
  const [textInput, setTextInput] = useState("");
  const [textPos, setTextPos]     = useState<{x:number;y:number}|null>(null);

  const [cropRect, setCropRect] = useState<{x:number;y:number;w:number;h:number}|null>(null);
  const cropStart = useRef<{x:number;y:number}|null>(null);

  const [hist, setHist] = useState<{list:string[]; idx:number}>({ list: [], idx: -1 });
  const [canvasReady, setCanvasReady] = useState(false);

  const drawing    = useRef(false);
  const hadDrawing = useRef(false);
  const startPos   = useRef<{x:number;y:number}|null>(null);
  const lastPos    = useRef<{x:number;y:number}|null>(null);

  const cssFilter = `brightness(${brightness}%) contrast(${contrast}%) saturate(${saturation}%) blur(${blur}px)`;

  const syncOverlaySize = () => {
    const base = baseCanvasRef.current, overlay = overlayCanvasRef.current;
    if (!base || !overlay) return;
    overlay.width = base.width; overlay.height = base.height;
  };

  /* Load source image once */
  useEffect(() => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      const canvas = baseCanvasRef.current!;
      canvas.width  = img.naturalWidth  || img.width  || 800;
      canvas.height = img.naturalHeight || img.height || 600;
      canvas.getContext("2d")!.drawImage(img, 0, 0, canvas.width, canvas.height);
      syncOverlaySize();
      const url = canvas.toDataURL("image/png");
      setHist({ list: [url], idx: 0 });
      setCanvasReady(true);
    };
    img.onerror = () => toast.error("Couldn't load this image for editing.");
    img.src = src;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src]);

  const pushHistory = () => {
    const base = baseCanvasRef.current!;
    const url = base.toDataURL("image/png");
    setHist(({ list, idx }) => {
      const trimmed = list.slice(0, idx + 1);
      return { list: [...trimmed, url], idx: trimmed.length };
    });
  };

  const loadFromHistory = (idx: number, list: string[]) => {
    const img = new Image();
    img.onload = () => {
      const canvas = baseCanvasRef.current!;
      canvas.width = img.width; canvas.height = img.height;
      canvas.getContext("2d")!.drawImage(img, 0, 0);
      syncOverlaySize();
    };
    img.src = list[idx];
  };

  const undo = () => setHist(({ list, idx }) => {
    if (idx <= 0) return { list, idx };
    loadFromHistory(idx - 1, list);
    return { list, idx: idx - 1 };
  });
  const redo = () => setHist(({ list, idx }) => {
    if (idx >= list.length - 1) return { list, idx };
    loadFromHistory(idx + 1, list);
    return { list, idx: idx + 1 };
  });

  /* ── Transform ── */
  const rotate = (dir: 1 | -1) => {
    const base = baseCanvasRef.current!;
    const tmp = document.createElement("canvas");
    tmp.width = base.height; tmp.height = base.width;
    const tctx = tmp.getContext("2d")!;
    tctx.translate(tmp.width / 2, tmp.height / 2);
    tctx.rotate((Math.PI / 2) * dir);
    tctx.drawImage(base, -base.width / 2, -base.height / 2);
    base.width = tmp.width; base.height = tmp.height;
    base.getContext("2d")!.drawImage(tmp, 0, 0);
    syncOverlaySize();
    pushHistory();
  };
  const flip = (axis: "h" | "v") => {
    const base = baseCanvasRef.current!;
    const tmp = document.createElement("canvas");
    tmp.width = base.width; tmp.height = base.height;
    const tctx = tmp.getContext("2d")!;
    if (axis === "h") { tctx.translate(tmp.width, 0); tctx.scale(-1, 1); }
    else { tctx.translate(0, tmp.height); tctx.scale(1, -1); }
    tctx.drawImage(base, 0, 0);
    const bctx = base.getContext("2d")!;
    bctx.clearRect(0, 0, base.width, base.height);
    bctx.drawImage(tmp, 0, 0);
    pushHistory();
  };

  /* ── Coordinate helpers ── */
  const getCanvasPos = (clientX: number, clientY: number) => {
    const canvas = baseCanvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    return {
      x: (clientX - rect.left) * (canvas.width  / rect.width),
      y: (clientY - rect.top)  * (canvas.height / rect.height),
    };
  };
  const canvasToCss = (x: number, y: number) => {
    const canvas = baseCanvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    return { x: x * (rect.width / canvas.width), y: y * (rect.height / canvas.height) };
  };

  /* ── Crop ── */
  const onCropDown = (e: React.PointerEvent) => {
    const p = getCanvasPos(e.clientX, e.clientY);
    cropStart.current = p;
    setCropRect({ x: p.x, y: p.y, w: 0, h: 0 });
  };
  const onCropMove = (e: React.PointerEvent) => {
    if (!cropStart.current) return;
    const p = getCanvasPos(e.clientX, e.clientY);
    const s = cropStart.current;
    setCropRect({
      x: Math.min(s.x, p.x), y: Math.min(s.y, p.y),
      w: Math.abs(p.x - s.x), h: Math.abs(p.y - s.y),
    });
  };
  const onCropUp = () => { cropStart.current = null; };

  const applyCrop = () => {
    if (!cropRect || cropRect.w < 4 || cropRect.h < 4) { toast.error("Drag to select a crop area first."); return; }
    const base = baseCanvasRef.current!;
    const { x, y, w, h } = cropRect;
    const tmp = document.createElement("canvas");
    tmp.width = w; tmp.height = h;
    tmp.getContext("2d")!.drawImage(base, x, y, w, h, 0, 0, w, h);
    base.width = w; base.height = h;
    base.getContext("2d")!.drawImage(tmp, 0, 0);
    syncOverlaySize();
    setCropRect(null);
    pushHistory();
    setTab("adjust");
  };

  /* ── Draw ── */
  const commitOverlay = () => {
    if (!hadDrawing.current) return;
    const base = baseCanvasRef.current!, overlay = overlayCanvasRef.current!;
    base.getContext("2d")!.drawImage(overlay, 0, 0);
    overlay.getContext("2d")!.clearRect(0, 0, overlay.width, overlay.height);
    hadDrawing.current = false;
    pushHistory();
  };

  const onOverlayDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (tab !== "draw") return;
    const p = getCanvasPos(e.clientX, e.clientY);
    if (tool === "text") { setTextPos(p); return; }
    drawing.current = true; hadDrawing.current = false;
    startPos.current = p; lastPos.current = p;
  };
  const onOverlayMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (tab !== "draw" || !drawing.current) return;
    const overlay = overlayCanvasRef.current!;
    const ctx = overlay.getContext("2d")!;
    const p = getCanvasPos(e.clientX, e.clientY);
    hadDrawing.current = true;

    if (tool === "pen" || tool === "highlighter" || tool === "eraser") {
      ctx.globalCompositeOperation = tool === "eraser" ? "destination-out" : "source-over";
      ctx.strokeStyle = tool === "highlighter" ? color + "55" : color;
      ctx.lineWidth = tool === "highlighter" ? strokeWidth * 5 : tool === "eraser" ? strokeWidth * 6 : strokeWidth;
      ctx.lineCap = "round"; ctx.lineJoin = "round";
      ctx.beginPath();
      ctx.moveTo(lastPos.current!.x, lastPos.current!.y);
      ctx.lineTo(p.x, p.y);
      ctx.stroke();
      lastPos.current = p;
    } else {
      ctx.clearRect(0, 0, overlay.width, overlay.height);
      ctx.globalCompositeOperation = "source-over";
      ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineWidth = strokeWidth;
      const s = startPos.current!;
      if (tool === "rect") {
        ctx.strokeRect(Math.min(s.x, p.x), Math.min(s.y, p.y), Math.abs(p.x - s.x), Math.abs(p.y - s.y));
      } else if (tool === "circle") {
        const rx = Math.abs(p.x - s.x) / 2, ry = Math.abs(p.y - s.y) / 2;
        ctx.beginPath();
        ctx.ellipse((s.x + p.x) / 2, (s.y + p.y) / 2, rx, ry, 0, 0, 2 * Math.PI);
        ctx.stroke();
      } else if (tool === "arrow") {
        drawArrowHead(ctx, s.x, s.y, p.x, p.y, strokeWidth, color);
      }
    }
  };
  const onOverlayUp = () => {
    if (tab !== "draw" || !drawing.current) return;
    drawing.current = false;
    commitOverlay();
  };

  const placeText = () => {
    if (!textPos || !textInput.trim()) return;
    const overlay = overlayCanvasRef.current!;
    const ctx = overlay.getContext("2d")!;
    ctx.font = `${Math.max(16, strokeWidth * 8)}px Arial`;
    ctx.fillStyle = color;
    ctx.textBaseline = "top";
    ctx.fillText(textInput, textPos.x, textPos.y);
    hadDrawing.current = true;
    commitOverlay();
    setTextInput(""); setTextPos(null);
  };

  /* ── Save (bakes CSS filter into final pixels) ── */
  const handleSave = () => {
    const base = baseCanvasRef.current!;
    const tmp = document.createElement("canvas");
    tmp.width = base.width; tmp.height = base.height;
    const tctx = tmp.getContext("2d")!;
    (tctx as any).filter = cssFilter;
    tctx.drawImage(base, 0, 0);
    onSave(tmp.toDataURL("image/png"));
  };

  const tabBtn = (t: ImgTab, label: string) => (
    <button onClick={() => setTab(t)}
      style={{padding:"5px 12px",borderRadius:6,fontSize:12,fontWeight:600,border:"1px solid",cursor:"pointer",
        background: tab===t?"white":"transparent", color: tab===t?"black":"white",
        borderColor: tab===t?"white":"rgba(255,255,255,0.3)"}}>{label}</button>
  );
  const toolBtn = (t: DrawTool, icon: React.ReactNode) => (
    <button onClick={() => setTool(t)}
      style={{width:30,height:30,display:"flex",alignItems:"center",justifyContent:"center",borderRadius:6,border:"1px solid",cursor:"pointer",
        background: tool===t?"white":"transparent", color: tool===t?"black":"white",
        borderColor: tool===t?"white":"rgba(255,255,255,0.3)"}}>{icon}</button>
  );

  const cropCss = cropRect ? { ...canvasToCss(cropRect.x, cropRect.y), ...(() => { const wh = canvasToCss(cropRect.w, cropRect.h); return { w: wh.x, h: wh.y }; })() } : null;

  return (
    <div className="fixed inset-0 z-[200] flex flex-col" style={{ background: "rgba(0,0,0,0.94)" }}>
      {/* Top bar */}
      <div className="flex items-center gap-2 px-4 py-2 border-b border-white/10 flex-wrap shrink-0" style={{ background: "#1a1a1a" }}>
        <span className="text-white font-semibold text-sm mr-2">Edit Image</span>
        {tabBtn("adjust", "Adjust")}
        {tabBtn("transform", "Transform")}
        {tabBtn("crop", "Crop")}
        {tabBtn("draw", "Draw")}
        <div style={{ width: 1, height: 20, background: "rgba(255,255,255,0.2)", margin: "0 4px" }} />
        <button onClick={undo} disabled={hist.idx<=0}
          style={{opacity: hist.idx<=0?0.35:1, color:"white", background:"transparent", border:"none", cursor:"pointer", padding:4}} title="Undo"><Undo className="h-4 w-4"/></button>
        <button onClick={redo} disabled={hist.idx>=hist.list.length-1}
          style={{opacity: hist.idx>=hist.list.length-1?0.35:1, color:"white", background:"transparent", border:"none", cursor:"pointer", padding:4}} title="Redo"><Redo className="h-4 w-4"/></button>
        <div style={{ width: 1, height: 20, background: "rgba(255,255,255,0.2)", margin: "0 4px" }} />
        <button onClick={() => setZoom(z => Math.max(0.25, +(z - 0.25).toFixed(2)))} style={{color:"white",background:"transparent",border:"none",cursor:"pointer",padding:4}} title="Zoom out"><ZoomOut className="h-4 w-4"/></button>
        <span style={{color:"rgba(255,255,255,0.7)",fontSize:12,minWidth:36,textAlign:"center"}}>{Math.round(zoom*100)}%</span>
        <button onClick={() => setZoom(z => Math.min(3, +(z + 0.25).toFixed(2)))} style={{color:"white",background:"transparent",border:"none",cursor:"pointer",padding:4}} title="Zoom in"><ZoomIn className="h-4 w-4"/></button>

        <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
          <input ref={replaceInputRef} type="file" accept="image/*" className="hidden"
            onChange={e => { const f = e.target.files?.[0]; if (f) onReplace(f); e.target.value=""; }} />
          <button onClick={() => replaceInputRef.current?.click()}
            style={{padding:"4px 12px",borderRadius:6,border:"1px solid rgba(255,255,255,0.3)",color:"white",background:"transparent",cursor:"pointer",fontSize:12}}>Replace</button>
          <button onClick={onDelete}
            style={{padding:"4px 12px",borderRadius:6,border:"1px solid #ef4444",color:"#ef4444",background:"transparent",cursor:"pointer",fontSize:12}}>Delete</button>
          <button onClick={onClose}
            style={{padding:"4px 12px",borderRadius:6,border:"1px solid rgba(255,255,255,0.3)",color:"white",background:"transparent",cursor:"pointer",fontSize:12}}>Cancel</button>
          <button onClick={handleSave}
            style={{padding:"4px 14px",borderRadius:6,border:"none",background:"white",color:"black",cursor:"pointer",fontSize:12,fontWeight:600}}>Save</button>
        </div>
      </div>

      {/* Sub-toolbar per tab */}
      <div className="flex items-center gap-3 px-4 py-2 flex-wrap shrink-0" style={{ background: "#111" }}>
        {tab === "adjust" && (
          <>
            <label style={{color:"rgba(255,255,255,0.7)",fontSize:12,display:"flex",alignItems:"center",gap:6}}>Brightness
              <input type="range" min={40} max={160} value={brightness} onChange={e=>setBrightness(Number(e.target.value))} style={{width:100}}/>
            </label>
            <label style={{color:"rgba(255,255,255,0.7)",fontSize:12,display:"flex",alignItems:"center",gap:6}}>Contrast
              <input type="range" min={40} max={160} value={contrast} onChange={e=>setContrast(Number(e.target.value))} style={{width:100}}/>
            </label>
            <label style={{color:"rgba(255,255,255,0.7)",fontSize:12,display:"flex",alignItems:"center",gap:6}}>Saturation
              <input type="range" min={0} max={200} value={saturation} onChange={e=>setSaturation(Number(e.target.value))} style={{width:100}}/>
            </label>
            <label style={{color:"rgba(255,255,255,0.7)",fontSize:12,display:"flex",alignItems:"center",gap:6}}>Blur
              <input type="range" min={0} max={8} value={blur} onChange={e=>setBlur(Number(e.target.value))} style={{width:100}}/>
            </label>
            <button onClick={() => { setBrightness(100); setContrast(100); setSaturation(100); setBlur(0); }}
              style={{color:"white",fontSize:12,background:"transparent",border:"1px solid rgba(255,255,255,0.3)",borderRadius:6,padding:"4px 10px",cursor:"pointer"}}>Reset</button>
          </>
        )}
        {tab === "transform" && (
          <>
            <button onClick={() => rotate(-1)} title="Rotate left" style={{color:"white",background:"transparent",border:"1px solid rgba(255,255,255,0.3)",borderRadius:6,padding:6,cursor:"pointer"}}><RotateCcw className="h-4 w-4"/></button>
            <button onClick={() => rotate(1)} title="Rotate right" style={{color:"white",background:"transparent",border:"1px solid rgba(255,255,255,0.3)",borderRadius:6,padding:6,cursor:"pointer"}}><RotateCw className="h-4 w-4"/></button>
            <button onClick={() => flip("h")} title="Flip horizontal" style={{color:"white",background:"transparent",border:"1px solid rgba(255,255,255,0.3)",borderRadius:6,padding:6,cursor:"pointer"}}><FlipHorizontal className="h-4 w-4"/></button>
            <button onClick={() => flip("v")} title="Flip vertical" style={{color:"white",background:"transparent",border:"1px solid rgba(255,255,255,0.3)",borderRadius:6,padding:6,cursor:"pointer"}}><FlipVertical className="h-4 w-4"/></button>
          </>
        )}
        {tab === "crop" && (
          <>
            <span style={{color:"rgba(255,255,255,0.6)",fontSize:12}}>Drag on the image to select a crop area</span>
            <button onClick={applyCrop} style={{background:"white",color:"black",fontSize:12,fontWeight:600,border:"none",borderRadius:6,padding:"5px 12px",cursor:"pointer"}}>Apply Crop</button>
            <button onClick={() => setCropRect(null)} style={{color:"white",fontSize:12,background:"transparent",border:"1px solid rgba(255,255,255,0.3)",borderRadius:6,padding:"5px 12px",cursor:"pointer"}}>Clear</button>
          </>
        )}
        {tab === "draw" && (
          <>
            {toolBtn("pen", <Pencil className="h-4 w-4"/>)}
            {toolBtn("highlighter", <Highlighter className="h-4 w-4"/>)}
            {toolBtn("eraser", <Eraser className="h-4 w-4"/>)}
            {toolBtn("rect", <Square className="h-4 w-4"/>)}
            {toolBtn("circle", <Circle className="h-4 w-4"/>)}
            {toolBtn("arrow", <ArrowUpRight className="h-4 w-4"/>)}
            {toolBtn("text", <Type className="h-4 w-4"/>)}
            <div style={{ width: 1, height: 20, background: "rgba(255,255,255,0.2)" }} />
            <input type="color" value={color} onChange={e=>setColor(e.target.value)} style={{width:28,height:28,borderRadius:4,cursor:"pointer",border:"none"}}/>
            <label style={{color:"rgba(255,255,255,0.6)",fontSize:12,display:"flex",alignItems:"center",gap:6}}>Size
              <input type="range" min={1} max={20} value={strokeWidth} onChange={e=>setStrokeWidth(Number(e.target.value))} style={{width:80}}/>
            </label>
            {tool === "text" && textPos && (
              <>
                <input autoFocus value={textInput} onChange={e=>setTextInput(e.target.value)}
                  onKeyDown={e=>e.key==="Enter"&&placeText()}
                  placeholder="Type text…"
                  style={{background:"rgba(255,255,255,0.1)",color:"white",border:"1px solid rgba(255,255,255,0.2)",borderRadius:6,padding:"4px 10px",fontSize:13,outline:"none",width:160}}/>
                <button onClick={placeText} style={{background:"white",color:"black",fontSize:12,fontWeight:600,border:"none",borderRadius:6,padding:"4px 10px",cursor:"pointer"}}>Place</button>
              </>
            )}
          </>
        )}
      </div>

      {/* Canvas stage */}
      <div style={{ flex: 1, overflow: "auto", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
        <div style={{ position: "relative", transform: `scale(${zoom})`, transformOrigin: "center center" }}>
          <div style={{ position: "relative", filter: cssFilter }}>
            <canvas ref={baseCanvasRef} style={{ display: "block", maxWidth: "80vw", maxHeight: "70vh", border: "2px solid rgba(255,255,255,0.15)", borderRadius: 4 }} />
            <canvas ref={overlayCanvasRef}
              style={{ position: "absolute", top: 0, left: 0, width: "100%", height: "100%",
                cursor: tab==="draw" ? (tool==="eraser"?"cell":tool==="text"?"text":"crosshair") : "default" }}
              onPointerDown={onOverlayDown} onPointerMove={onOverlayMove} onPointerUp={onOverlayUp} onPointerLeave={onOverlayUp} />
            {tab === "crop" && (
              <div style={{ position: "absolute", inset: 0, cursor: "crosshair" }}
                onPointerDown={onCropDown} onPointerMove={onCropMove} onPointerUp={onCropUp} onPointerLeave={onCropUp}>
                {cropCss && (
                  <div style={{ position: "absolute", left: cropCss.x, top: cropCss.y, width: cropCss.w, height: cropCss.h,
                    border: "2px dashed #fff", background: "rgba(255,255,255,0.15)", pointerEvents: "none" }} />
                )}
              </div>
            )}
          </div>
        </div>
        {!canvasReady && <span style={{ color: "white", fontSize: 13 }}>Loading image…</span>}
      </div>
    </div>
  );
}

/* ─── Insert Table Modal ─── */
function InsertTableModal({ onInsert, onClose }: { onInsert:(r:number,c:number)=>void; onClose:()=>void }) {
  const [rows, setRows] = useState(3);
  const [cols, setCols] = useState(3);
  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-sm">
        <DialogHeader><DialogTitle>Insert Table</DialogTitle></DialogHeader>
        <div className="space-y-3 py-2">
          <div className="flex items-center gap-3">
            <label className="text-sm w-20">Rows:</label>
            <Input type="number" min={1} max={30} value={rows} onChange={e=>setRows(Number(e.target.value))} className="w-24"/>
          </div>
          <div className="flex items-center gap-3">
            <label className="text-sm w-20">Columns:</label>
            <Input type="number" min={1} max={10} value={cols} onChange={e=>setCols(Number(e.target.value))} className="w-24"/>
          </div>
          <div className="border rounded p-2 overflow-auto bg-muted/30">
            <table style={{borderCollapse:"collapse",width:"100%"}}>
              <tbody>{Array.from({length:Math.min(rows,5)}).map((_,r)=>(
                <tr key={r}>{Array.from({length:Math.min(cols,6)}).map((_,c)=>(
                  <td key={c} style={{border:"1px solid #ccc",padding:"3px 8px",
                    background:r===0?"#e5e7eb":"white",fontSize:11,textAlign:"center"}}>
                    {r===0?`H${c+1}`:"·"}
                  </td>
                ))}</tr>
              ))}</tbody>
            </table>
            {rows>5&&<p className="text-xs text-muted-foreground mt-1">+{rows-5} more rows…</p>}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={()=>onInsert(rows,cols)}>Insert Table</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function getMaxFontSizePx(el: HTMLElement): number {
  let max = 0;
  const consider = (e: HTMLElement) => {
    const fs = e.style?.fontSize;
    if (fs) {
      const m = fs.match(/([\d.]+)\s*(px|pt)/);
      if (m) {
        let val = parseFloat(m[1]);
        if (m[2] === "pt") val = val * 1.333;
        if (val > max) max = val;
      }
    }
  };
  consider(el);
  el.querySelectorAll<HTMLElement>("*").forEach(consider);
  return max;
}

/* Word text boxes (e.g. a logo made of 2-3 separately-colored text boxes
   like "S.N" / "E" / "LEVATORS") get flattened by mammoth into that many
   separate <p> paragraphs, one after another — which is why they end up
   stacked vertically instead of side-by-side like in the original Word
   doc. This detects runs of consecutive short, large-font paragraphs
   (the signature of a text-box-based logo/heading) and merges them back
   into a single inline row, preserving each fragment's own font/color. */
function mergeLogoFragments(root: HTMLElement) {
  const paragraphs = Array.from(root.querySelectorAll("p"));
  let i = 0;
  while (i < paragraphs.length) {
    const group: HTMLElement[] = [];
    let j = i;
    while (j < paragraphs.length) {
      const p = paragraphs[j];
      if (!p.isConnected) { j++; continue; }
      const text = p.textContent?.trim() || "";
      const fontSize = getMaxFontSizePx(p);
      const isLogoLike = text.length > 0 && text.length <= 25 && fontSize >= 18;
      const isConsecutive = group.length === 0 ||
        (p.previousElementSibling === group[group.length - 1] &&
         p.parentElement === group[group.length - 1].parentElement);
      if (isLogoLike && isConsecutive) { group.push(p); j++; }
      else break;
    }
    if (group.length >= 2) {
      const wrapper = document.createElement("p");
      wrapper.style.cssText = "display:flex;align-items:baseline;flex-wrap:wrap;margin:.2em 0;";
      group.forEach(p => {
        const span = document.createElement("span");
        span.style.cssText = "display:inline-block;white-space:nowrap;";
        span.innerHTML = p.innerHTML;
        wrapper.appendChild(span);
      });
      group[0].parentElement?.insertBefore(wrapper, group[0]);
      group.forEach(p => p.remove());
    }
    i = j > i ? j : i + 1;
  }
}

/* ════════════════════════════════════════════
   MAIN EDITOR
═══════════════════════════════════════════ */
export default function DocumentEditorPage() {
  const { profile } = useAuth();
  const editorRef  = useRef<HTMLDivElement>(null);
  const wordRef    = useRef<HTMLInputElement>(null);
  const pdfRef     = useRef<HTMLInputElement>(null);
  const imgRef     = useRef<HTMLInputElement>(null);
  const saveTimer  = useRef<NodeJS.Timeout|null>(null);

  const [docs, setDocs]               = useState<Doc[]>([]);
  const [selectedDoc, setSelectedDoc] = useState<Doc|null>(null);
  const [title, setTitle]             = useState("Untitled Document");
  const [saving, setSaving]           = useState(false);
  const [importing, setImporting]     = useState(false);

  const [deleteOpen, setDeleteOpen]     = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Doc|null>(null);

  const [showColorPicker, setShowColorPicker] = useState(false);
  const [showBgPicker, setShowBgPicker]       = useState(false);
  const [activeFormats, setActiveFormats]     = useState<Record<string,boolean>>({});
  const [fontSize, setFontSize]     = useState("14");
  const [fontFamily, setFontFamily] = useState("Arial");
  const [pageZoom, setPageZoom]     = useState(100); // % zoom for the document page, Word-style

  const [showTableModal, setShowTableModal] = useState(false);
  const [editingImgEl, setEditingImgEl]     = useState<HTMLImageElement|null>(null);
  const [editingImgSrc, setEditingImgSrc]   = useState<string|null>(null);

  /* ── Document drawer (replaces old fixed sidebar) ── */
  const [drawerOpen, setDrawerOpen]   = useState(false);
  const [docSearch, setDocSearch]     = useState("");
  const [docSort, setDocSort]         = useState<"recent"|"name">("recent");
  const [renamingId, setRenamingId]   = useState<string|null>(null);
  const [renameValue, setRenameValue] = useState("");
  const dragStartX = useRef<number|null>(null);

  /* ── Load docs ── */
  const loadDocs = useCallback(async () => {
    if (!profile) return;
    const {data} = await supabase.from("user_documents").select("*")
      .eq("user_id", profile.id).order("updated_at", {ascending:false});
    setDocs((data ?? []) as Doc[]);
  }, [profile]);

  useEffect(() => { loadDocs(); }, [loadDocs]);

  const filteredSortedDocs = useMemo(() => {
    let list = docs;
    if (docSearch.trim()) {
      const q = docSearch.trim().toLowerCase();
      list = list.filter(d => d.title.toLowerCase().includes(q));
    }
    list = [...list];
    if (docSort === "name") list.sort((a,b) => a.title.localeCompare(b.title));
    else list.sort((a,b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime());
    return list;
  }, [docs, docSearch, docSort]);

  /* ── Selection persistence ──
     contentEditable loses its Range whenever focus moves to a modal, an
     <Input>, or a toolbar button. We continuously track the last valid
     range inside the editor and restore it before any insert action, so
     "Insert Table" / "Insert Image" / "Insert Link" always land at the
     right cursor position instead of silently failing. */
  const savedRangeRef = useRef<Range | null>(null);

  useEffect(() => {
    const handler = () => {
      const sel = window.getSelection();
      if (!sel || sel.rangeCount === 0) return;
      const range = sel.getRangeAt(0);
      if (editorRef.current && editorRef.current.contains(range.commonAncestorContainer)) {
        savedRangeRef.current = range.cloneRange();
      }
    };
    document.addEventListener("selectionchange", handler);
    return () => document.removeEventListener("selectionchange", handler);
  }, []);

  const restoreSelection = (): Range | null => {
    const editor = editorRef.current;
    if (!editor) return null;
    editor.focus();
    const sel = window.getSelection();
    if (!sel) return null;
    if (savedRangeRef.current && editor.contains(savedRangeRef.current.startContainer)) {
      sel.removeAllRanges();
      sel.addRange(savedRangeRef.current);
      return savedRangeRef.current;
    }
    const range = document.createRange();
    range.selectNodeContents(editor);
    range.collapse(false);
    sel.removeAllRanges();
    sel.addRange(range);
    return range;
  };

  /* ── Image click → open full editor directly (mobile-gallery style) ── */
  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    const onClick = (e: MouseEvent) => {
      const t = e.target as HTMLElement;
      if (t.tagName === "IMG") {
        setEditingImgEl(t as HTMLImageElement);
        setEditingImgSrc((t as HTMLImageElement).src);
      }
    };
    editor.addEventListener("click", onClick);
    return () => editor.removeEventListener("click", onClick);
  }, [selectedDoc]);

  const saveImageEdit = (dataUrl: string) => {
    if (editingImgEl) { editingImgEl.src = dataUrl; triggerSave(); toast.success("Image updated!"); }
    setEditingImgEl(null); setEditingImgSrc(null);
  };
  const deleteImageEdit = () => {
    if (editingImgEl) { editingImgEl.remove(); triggerSave(); toast.success("Image removed"); }
    setEditingImgEl(null); setEditingImgSrc(null);
  };
  const replaceImageEdit = (file: File) => {
    const reader = new FileReader();
    reader.onload = ev => {
      if (editingImgEl) {
        editingImgEl.src = ev.target?.result as string;
        setEditingImgSrc(ev.target?.result as string);
      }
    };
    reader.readAsDataURL(file);
  };

  /* ── Select doc ── */
  const selectDoc = (doc: Doc) => {
    setSelectedDoc(doc); setTitle(doc.title);
    requestAnimationFrame(() => {
      if (editorRef.current) {
        editorRef.current.innerHTML = doc.content || "";
        editorRef.current.focus();
      }
    });
  };

  /* ── New doc ── */
  const createNewDoc = async () => {
    if (!profile) return;
    const {data, error} = await supabase.from("user_documents")
      .insert({user_id:profile.id, title:"Untitled Document", content:""})
      .select("*").single();
    if (error) return toast.error(error.message);
    toast.success("New document created!");
    await loadDocs();
    selectDoc(data as Doc);
  };

  /* ── Duplicate doc ── */
  const duplicateDoc = async (doc: Doc) => {
    if (!profile) return;
    const {data, error} = await supabase.from("user_documents")
      .insert({user_id:profile.id, title:doc.title + " (Copy)", content:doc.content})
      .select("*").single();
    if (error) return toast.error(error.message);
    toast.success("Document duplicated!");
    await loadDocs();
    selectDoc(data as Doc);
  };

  /* ── Rename doc (inline, from drawer) ── */
  const startRename = (doc: Doc) => { setRenamingId(doc.id); setRenameValue(doc.title); };
  const commitRename = async (doc: Doc) => {
    const newTitle = renameValue.trim() || doc.title;
    setRenamingId(null);
    if (newTitle === doc.title) return;
    const {error} = await supabase.from("user_documents").update({title:newTitle}).eq("id", doc.id);
    if (error) return toast.error(error.message);
    setDocs(prev => prev.map(d => d.id===doc.id ? {...d, title:newTitle} : d));
    if (selectedDoc?.id === doc.id) setTitle(newTitle);
  };

  /* ── Auto save ── */
  const autoSave = useCallback(async () => {
    if (!selectedDoc || !profile) return;
    const content = editorRef.current?.innerHTML || "";
    const {error} = await supabase.from("user_documents")
      .update({title, content, updated_at:new Date().toISOString()})
      .eq("id", selectedDoc.id);
    if (!error) setDocs(prev => prev.map(d => d.id===selectedDoc.id ? {...d,title,content} : d));
  }, [selectedDoc, title, profile]);

  const handleSave = async () => { setSaving(true); await autoSave(); setSaving(false); toast.success("Saved!"); };

  const triggerSave = () => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(autoSave, 1500);
    updateFormats();
  };

  /* ── Delete ── */
  const handleDelete = async () => {
    if (!deleteTarget) return;
    await supabase.from("user_documents").delete().eq("id", deleteTarget.id);
    toast.success("Deleted!");
    setDeleteOpen(false); setDeleteTarget(null);
    if (selectedDoc?.id === deleteTarget.id) {
      setSelectedDoc(null);
      if (editorRef.current) editorRef.current.innerHTML = "";
    }
    await loadDocs();
  };

  /* ── Format commands ── */
  const exec = (cmd: string, val?: string) => {
    restoreSelection();
    document.execCommand(cmd, false, val);
    updateFormats();
    triggerSave();
  };

  const updateFormats = () => {
    try {
      setActiveFormats({
        bold:                document.queryCommandState("bold"),
        italic:              document.queryCommandState("italic"),
        underline:           document.queryCommandState("underline"),
        strikeThrough:       document.queryCommandState("strikeThrough"),
        justifyLeft:         document.queryCommandState("justifyLeft"),
        justifyCenter:       document.queryCommandState("justifyCenter"),
        justifyRight:        document.queryCommandState("justifyRight"),
        justifyFull:         document.queryCommandState("justifyFull"),
        insertUnorderedList: document.queryCommandState("insertUnorderedList"),
        insertOrderedList:   document.queryCommandState("insertOrderedList"),
      });
    } catch {}
  };

  const applyBlock = (tag: string) => {
    restoreSelection();
    document.execCommand("formatBlock", false, `<${tag}>`);
    updateFormats(); triggerSave();
  };

  /* ── Insert Table (fixed: restores the saved cursor position, since the
     dialog's own inputs steal the browser's live selection) ── */
  const insertTable = (rows: number, cols: number) => {
    const editor = editorRef.current;
    if (!editor) return;
    const range = restoreSelection();
    if (!range) return;

    let html = `<br><table style="border-collapse:collapse;width:100%;margin:8px 0;table-layout:fixed;">`;
    for (let r = 0; r < rows; r++) {
      html += "<tr>";
      for (let c = 0; c < cols; c++) {
        const isHead = r === 0;
        const style = `border:1.5px solid #9ca3af;padding:6px 10px;min-width:40px;word-break:break-word;vertical-align:top;${isHead?"background:#f3f4f6;font-weight:600;":"background:#ffffff;"}`;
        html += isHead
          ? `<th style="${style}">Header ${c+1}</th>`
          : `<td style="${style}">&nbsp;</td>`;
      }
      html += "</tr>";
    }
    html += "</table><br>";

    const sel = window.getSelection()!;
    const liveRange = sel.rangeCount > 0 ? sel.getRangeAt(0) : range;
    liveRange.deleteContents();
    const frag = liveRange.createContextualFragment(html);
    const lastNode = frag.lastChild;
    liveRange.insertNode(frag);
    if (lastNode) {
      const after = document.createRange();
      after.setStartAfter(lastNode);
      after.collapse(true);
      sel.removeAllRanges();
      sel.addRange(after);
      savedRangeRef.current = after.cloneRange();
    }

    setShowTableModal(false);
    triggerSave();
    toast.success("Table inserted!");
  };

  /* ── Insert link ── */
  const insertLink = () => {
    const u = prompt("Enter URL:");
    if (u) exec("createLink", u);
  };

  /* ── Insert image(s) at cursor ── */
  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    const range = restoreSelection();
    files.forEach(file => {
      const reader = new FileReader();
      reader.onload = ev => {
        const src = ev.target?.result as string;
        const editor = editorRef.current;
        if (!editor || !range) return;
        editor.focus();
        const html = `<img src="${src}" style="max-width:100%;height:auto;display:block;margin:8px 0;cursor:pointer;" />`;
        const sel = window.getSelection();
        if (sel && sel.rangeCount > 0) {
          const liveRange = sel.getRangeAt(0);
          const frag = liveRange.createContextualFragment(html);
          liveRange.insertNode(frag);
          liveRange.collapse(false);
        } else {
          editor.innerHTML += html;
        }
        triggerSave();
      };
      reader.readAsDataURL(file);
    });
    e.target.value = "";
  };

  /* ── Word import (multi-file) ── */
  const handleWordUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    e.target.value = "";

    if (typeof mammoth === "undefined") {
      toast.error("Word converter not loaded — please refresh the page.");
      return;
    }

    setImporting(true);
    for (const file of files) {
      try {
        const buf = await file.arrayBuffer();
        const result = await mammoth.convertToHtml(
          { arrayBuffer: buf },
          { styleMap: [
            "p[style-name='Heading 1'] => h1:fresh",
            "p[style-name='Heading 2'] => h2:fresh",
            "p[style-name='Heading 3'] => h3:fresh",
          ]}
        );

        const parser = new DOMParser();
        const dom = parser.parseFromString(result.value, "text/html");

        // ── Fix Word text-box / floating-shape overlap ──
        // Word's logo/header blocks are often built from absolutely
        // positioned text boxes anchored to a fixed canvas position.
        // mammoth carries some of that positioning over as inline
        // `position:absolute/fixed`, explicit top/left offsets, negative
        // margins, or `text-indent` tricks — all of which are meaningless
        // in a flowing HTML document and make separate lines/letters
        // stack on top of each other. Strip that positioning so every
        // element falls back into normal document flow instead of
        // overlapping.
        dom.querySelectorAll<HTMLElement>("[style]").forEach(el => {
          const s = el.style;
          if (s.position === "absolute" || s.position === "fixed") s.position = "static";
          if (s.top) s.top = "";
          if (s.left) s.left = "";
          if (s.right) s.right = "";
          if (s.bottom) s.bottom = "";
          if (s.marginTop && parseFloat(s.marginTop) < 0) s.marginTop = "0";
          if (s.marginLeft && parseFloat(s.marginLeft) < 0) s.marginLeft = "0";
          if (s.textIndent && parseFloat(s.textIndent) < 0) s.textIndent = "0";
          if (s.transform) s.transform = "";
        });

        mergeLogoFragments(dom.body);

        dom.querySelectorAll("table").forEach(t => {
          (t as HTMLElement).style.cssText = "border-collapse:collapse;width:100%;margin:8px 0;";
        });
        dom.querySelectorAll("td,th").forEach(c => {
          (c as HTMLElement).style.cssText += ";border:1.5px solid #9ca3af;padding:6px 10px;vertical-align:top;word-break:break-word;";
        });
        dom.querySelectorAll("th").forEach(c => {
          (c as HTMLElement).style.background = "#f3f4f6";
          (c as HTMLElement).style.fontWeight  = "600";
        });
        dom.querySelectorAll("img").forEach(img => {
          (img as HTMLElement).style.cssText = "max-width:100%;height:auto;display:block;margin:8px 0;cursor:pointer;";
        });

        const styledHtml = dom.body.innerHTML;
        const newTitle   = file.name.replace(/\.docx?$/i, "");

        const {data, error} = await supabase.from("user_documents")
          .insert({user_id: profile?.id, title: newTitle, content: styledHtml})
          .select("*").single();
        if (error) throw error;

        await loadDocs();
        selectDoc(data as Doc);
        toast.success(`"${newTitle}" imported!`);
      } catch (err: any) {
        toast.error(`Failed: "${file.name}" — ${err?.message || "Unknown error"}`);
      }
    }
    setImporting(false);
  };

  /* ── PDF import ──
     Renders every page through pdf.js's own renderer onto a canvas, then
     drops each page in as a full-width image with a page break after it.
     This is the only way to get a genuine pixel-for-pixel match to the
     source PDF — fonts, tables, borders, colors, multi-column layouts,
     stamps, everything — because it IS the rendered PDF page, not a
     re-interpretation of its text. The trade-off: page content becomes an
     image, not editable text. If you need the text itself to stay
     editable, that requires a separate "extract text" pass with much
     lower layout fidelity — say the word if you want that added as an
     alternate import mode. */
  const handlePdfUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    e.target.value = "";

    if (typeof pdfjsLib === "undefined") {
      toast.error("PDF renderer not loaded — please refresh the page.");
      return;
    }

    setImporting(true);
    for (const file of files) {
      try {
        const buf = await file.arrayBuffer();
        const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
        let pagesHtml = "";
        for (let i = 1; i <= pdf.numPages; i++) {
          const page = await pdf.getPage(i);
          const viewport = page.getViewport({ scale: 2 });
          const canvas = document.createElement("canvas");
          canvas.width = viewport.width;
          canvas.height = viewport.height;
          const ctx = canvas.getContext("2d")!;
          await page.render({ canvasContext: ctx, viewport }).promise;
          const dataUrl = canvas.toDataURL("image/jpeg", 0.92);
          pagesHtml += `<div class="pdf-page" style="page-break-after:always;margin:0 0 16px 0;">` +
            `<img src="${dataUrl}" style="width:100%;display:block;" />` +
          `</div>`;
        }
        const newTitle = file.name.replace(/\.pdf$/i, "");
        const {data, error} = await supabase.from("user_documents")
          .insert({user_id: profile?.id, title: newTitle, content: pagesHtml})
          .select("*").single();
        if (error) throw error;

        await loadDocs();
        selectDoc(data as Doc);
        toast.success(`"${newTitle}" imported (${pdf.numPages} page${pdf.numPages>1?"s":""})`);
      } catch (err: any) {
        toast.error(`Failed: "${file.name}" — ${err?.message || "Unknown error"}`);
      }
    }
    setImporting(false);
  };

  /* ── Export ── */
  const exportCSS = `
    body{font-family:Arial;width:210mm;margin:0 auto;padding:15mm 20mm;line-height:1.6;font-size:14px}
    h1{font-size:2em;font-weight:700;margin:.4em 0}h2{font-size:1.5em;font-weight:700;margin:.4em 0}h3{font-size:1.2em;font-weight:600;margin:.4em 0}
    table{border-collapse:collapse;width:100%;margin:8px 0}td,th{border:1.5px solid #9ca3af;padding:6px 10px;vertical-align:top}
    th{background:#f3f4f6;font-weight:600}
    ul{list-style:disc;padding-left:1.5em}ol{list-style:decimal;padding-left:1.5em}
    img{max-width:100%;height:auto}
    .pdf-page{page-break-after:always;}
    @media print{body{padding:10mm}}
  `;
  const fullHtml = (body: string) =>
    `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>${title}</title><style>${exportCSS}</style></head><body>${body}</body></html>`;
  const dl = (content: string, type: string, name: string) => {
    Object.assign(document.createElement("a"), {
      href: URL.createObjectURL(new Blob([content], {type})), download: name,
    }).click();
  };
  const printDoc = () => {
    const w = window.open("","_blank");
    if (!w) return;
    w.document.write(fullHtml(editorRef.current?.innerHTML || ""));
    w.document.close(); w.print();
  };

  /* ── Toolbar btn style ── */
  const tb = (active: boolean) => cn(
    "h-8 w-8 p-0 rounded flex items-center justify-center transition-colors shrink-0",
    active ? "bg-primary text-primary-foreground" : "hover:bg-muted text-foreground"
  );

  /* ══════════════════════════ RENDER ══════════════════════════ */
  return (
    <>
      {showTableModal && <InsertTableModal onInsert={insertTable} onClose={() => setShowTableModal(false)}/>}
      {editingImgEl && editingImgSrc && (
        <ImageEditorModal
          src={editingImgSrc}
          onSave={saveImageEdit}
          onDelete={deleteImageEdit}
          onReplace={replaceImageEdit}
          onClose={() => { setEditingImgEl(null); setEditingImgSrc(null); }}
        />
      )}

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Document?</AlertDialogTitle>
            <AlertDialogDescription>"{deleteTarget?.title}" will be permanently deleted.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <input ref={wordRef} type="file" accept=".doc,.docx" multiple className="hidden" onChange={handleWordUpload}/>
      <input ref={pdfRef}  type="file" accept=".pdf"       multiple className="hidden" onChange={handlePdfUpload}/>
      <input ref={imgRef}  type="file" accept="image/*"    multiple className="hidden" onChange={handleImageUpload}/>

      {/* ── Drag/click arrow tab — replaces the old Add Document / Upload buttons ── */}
      <div
        onClick={() => setDrawerOpen(o => !o)}
        onPointerDown={(e) => { dragStartX.current = e.clientX; }}
        onPointerMove={(e) => {
          if (dragStartX.current !== null && e.clientX - dragStartX.current > 24) {
            setDrawerOpen(true); dragStartX.current = null;
          }
        }}
        onPointerUp={() => { dragStartX.current = null; }}
        className="fixed left-0 top-1/2 -translate-y-1/2 z-40 flex items-center justify-center w-4 h-16 bg-primary/90 hover:bg-primary rounded-r-lg cursor-grab active:cursor-grabbing shadow-md transition-colors"
        title="Documents"
      >
        <ChevronRight className={cn("h-4 w-4 text-primary-foreground transition-transform", drawerOpen && "rotate-180")}/>
      </div>

      {/* ── Backdrop ── */}
      {drawerOpen && (
        <div className="fixed inset-0 z-30 bg-black/20" onClick={() => setDrawerOpen(false)} />
      )}

      {/* ── Document drawer ── */}
      <div className={cn(
        "fixed left-0 top-0 h-full w-72 bg-card border-r border-border z-40 flex flex-col shadow-2xl transition-transform duration-200",
        drawerOpen ? "translate-x-0" : "-translate-x-full"
      )}>
        <div className="p-3 border-b border-border space-y-2">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold">Documents</h3>
            <button onClick={() => setDrawerOpen(false)} className="p-1 hover:bg-muted rounded"><X className="h-4 w-4"/></button>
          </div>
          <div className="flex gap-1.5">
            <Button size="sm" className="flex-1 gap-1 h-7 text-xs" onClick={() => { createNewDoc(); setDrawerOpen(false); }}>
              <Plus className="h-3.5 w-3.5"/>New
            </Button>
            <Button size="sm" variant="outline" className="flex-1 gap-1 h-7 text-xs" onClick={() => wordRef.current?.click()} disabled={importing}>
              <Upload className="h-3.5 w-3.5"/>Word
            </Button>
            <Button size="sm" variant="outline" className="flex-1 gap-1 h-7 text-xs" onClick={() => pdfRef.current?.click()} disabled={importing}>
              <FileUp className="h-3.5 w-3.5"/>PDF
            </Button>
          </div>
          <div className="relative">
            <Search className="h-3.5 w-3.5 absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground"/>
            <Input value={docSearch} onChange={e=>setDocSearch(e.target.value)} placeholder="Search documents…" className="h-7 text-xs pl-7"/>
          </div>
          <button onClick={() => setDocSort(s => s==="recent"?"name":"recent")}
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
            <ArrowUpDown className="h-3 w-3"/> Sort: {docSort==="recent"?"Recent":"Name"}
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-2 space-y-0.5">
          {filteredSortedDocs.length === 0 && (
            <p className="text-xs text-muted-foreground text-center py-6">
              {docSearch ? "No documents match your search" : "No documents yet"}
            </p>
          )}
          {filteredSortedDocs.map(doc => (
            <div key={doc.id} onClick={() => { selectDoc(doc); setDrawerOpen(false); }}
              className={cn("flex items-center justify-between rounded-lg px-2 py-1.5 cursor-pointer group transition-colors",
                selectedDoc?.id === doc.id ? "bg-primary/10 text-primary" : "hover:bg-muted")}>
              <div className="flex items-center gap-1.5 min-w-0 flex-1">
                <FileText className="h-3.5 w-3.5 shrink-0"/>
                {renamingId === doc.id ? (
                  <Input autoFocus value={renameValue} onClick={e => e.stopPropagation()}
                    onChange={e => setRenameValue(e.target.value)}
                    onBlur={() => commitRename(doc)}
                    onKeyDown={e => { if (e.key==="Enter") commitRename(doc); if (e.key==="Escape") setRenamingId(null); }}
                    className="h-6 text-xs px-1"/>
                ) : (
                  <span className="text-xs truncate">{doc.title}</span>
                )}
              </div>
              <div className="flex items-center opacity-0 group-hover:opacity-100 shrink-0">
                <button onClick={e => { e.stopPropagation(); startRename(doc); }} className="p-1 rounded hover:bg-muted" title="Rename">
                  <Pencil className="h-3 w-3"/>
                </button>
                <button onClick={e => { e.stopPropagation(); duplicateDoc(doc); }} className="p-1 rounded hover:bg-muted" title="Duplicate">
                  <Copy className="h-3 w-3"/>
                </button>
                <button onClick={e => { e.stopPropagation(); setDeleteTarget(doc); setDeleteOpen(true); }} className="p-1 rounded hover:bg-destructive/10" title="Delete">
                  <Trash2 className="h-3 w-3 text-destructive"/>
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="flex h-[calc(100vh-56px)] overflow-hidden bg-background">
        {/* ── Main editor column (now full width — drawer is an overlay) ── */}
        <div className="flex-1 flex flex-col overflow-hidden min-w-0">

          {/* ══ TOOLBAR ══ */}
          <div className="flex items-center gap-1 flex-wrap px-2 py-1.5 border-b border-border bg-card select-none">

            {/* Save */}
            <button onClick={handleSave} disabled={saving || !selectedDoc}
              className={cn(tb(false), "w-auto px-2 gap-1 text-xs")}>
              <Save className="h-3.5 w-3.5"/>
              <span>{saving ? "…" : "Save"}</span>
            </button>

            {/* Export dropdown */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className={cn(tb(false), "w-auto px-2 gap-1 text-xs")} disabled={!selectedDoc}>
                  <Download className="h-3.5 w-3.5"/>
                  <span>Export</span>
                  <ChevronDown className="h-3 w-3"/>
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                <DropdownMenuItem onClick={printDoc}>Save as PDF (Print)</DropdownMenuItem>
                <DropdownMenuItem onClick={() => dl(fullHtml(editorRef.current?.innerHTML||""),"text/html",`${title}.html`)}>Download HTML</DropdownMenuItem>
                <DropdownMenuItem onClick={() => dl(editorRef.current?.innerText||"","text/plain",`${title}.txt`)}>Download TXT</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>

            <div className="w-px h-5 bg-border mx-0.5"/>

            {/* Zoom */}
            <button className={tb(false)} onClick={() => setPageZoom(z => Math.max(50, z - 10))} title="Zoom out"><ZoomOut className="h-4 w-4"/></button>
            <button onClick={() => setPageZoom(100)} title="Reset zoom"
              style={{fontSize:12,minWidth:40,textAlign:"center",background:"transparent",border:"none",cursor:"pointer"}}>{pageZoom}%</button>
            <button className={tb(false)} onClick={() => setPageZoom(z => Math.min(200, z + 10))} title="Zoom in"><ZoomIn className="h-4 w-4"/></button>

            <div className="w-px h-5 bg-border mx-0.5"/>

            {/* Undo / Redo */}
            <button className={tb(false)} onClick={() => exec("undo")} title="Undo"><Undo className="h-4 w-4"/></button>
            <button className={tb(false)} onClick={() => exec("redo")} title="Redo"><Redo className="h-4 w-4"/></button>

            <div className="w-px h-5 bg-border mx-0.5"/>

            {/* Block format */}
            <Select defaultValue="p" onValueChange={applyBlock}>
              <SelectTrigger className="h-7 w-28 text-xs"><SelectValue placeholder="Format"/></SelectTrigger>
              <SelectContent>
                <SelectItem value="p">Paragraph</SelectItem>
                <SelectItem value="h1"><span className="font-bold text-base">Heading 1</span></SelectItem>
                <SelectItem value="h2"><span className="font-bold">Heading 2</span></SelectItem>
                <SelectItem value="h3"><span className="font-semibold">Heading 3</span></SelectItem>
                <SelectItem value="blockquote">Blockquote</SelectItem>
                <SelectItem value="pre">Code</SelectItem>
              </SelectContent>
            </Select>

            {/* Font family */}
            <Select value={fontFamily} onValueChange={v => { setFontFamily(v); exec("fontName", v); }}>
              <SelectTrigger className="h-7 w-28 text-xs"><SelectValue/></SelectTrigger>
              <SelectContent>
                {FONT_FAMILIES.map(f => <SelectItem key={f} value={f} style={{fontFamily:f}}>{f}</SelectItem>)}
              </SelectContent>
            </Select>

            {/* Font size */}
            <Select value={fontSize} onValueChange={v => {
              setFontSize(v);
              restoreSelection();
              const sel = window.getSelection();
              if (sel && sel.rangeCount > 0 && !sel.isCollapsed) {
                const range = sel.getRangeAt(0);
                const span  = document.createElement("span");
                span.style.fontSize = v + "px";
                try { range.surroundContents(span); } catch {}
                triggerSave();
              }
            }}>
              <SelectTrigger className="h-7 w-14 text-xs"><SelectValue/></SelectTrigger>
              <SelectContent>
                {FONT_SIZES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
              </SelectContent>
            </Select>

            <div className="w-px h-5 bg-border mx-0.5"/>

            {/* Bold / Italic / Underline / Strike */}
            <button className={tb(activeFormats.bold)}        onClick={() => exec("bold")}         title="Bold"><Bold className="h-4 w-4"/></button>
            <button className={tb(activeFormats.italic)}      onClick={() => exec("italic")}       title="Italic"><Italic className="h-4 w-4"/></button>
            <button className={tb(activeFormats.underline)}   onClick={() => exec("underline")}    title="Underline"><Underline className="h-4 w-4"/></button>
            <button className={tb(activeFormats.strikeThrough)} onClick={() => exec("strikeThrough")} title="Strikethrough"><Strikethrough className="h-4 w-4"/></button>

            <div className="w-px h-5 bg-border mx-0.5"/>

            {/* Text color */}
            <div className="relative">
              <button className={tb(false)} title="Text Color"
                onClick={() => { setShowColorPicker(p => !p); setShowBgPicker(false); }}>
                <Type className="h-4 w-4"/>
              </button>
              {showColorPicker && (
                <div className="absolute top-9 left-0 z-50 bg-card border border-border rounded-xl shadow-xl p-2 grid grid-cols-8 gap-1 w-44">
                  {COLORS.map(c => (
                    <button key={c} style={{backgroundColor:c}}
                      className="w-4 h-4 rounded border border-border/50 hover:scale-125 transition-transform"
                      onClick={() => { exec("foreColor", c); setShowColorPicker(false); }}/>
                  ))}
                </div>
              )}
            </div>

            {/* Highlight color */}
            <div className="relative">
              <button className={tb(false)} title="Highlight Color"
                onClick={() => { setShowBgPicker(p => !p); setShowColorPicker(false); }}>
                <Palette className="h-4 w-4"/>
              </button>
              {showBgPicker && (
                <div className="absolute top-9 left-0 z-50 bg-card border border-border rounded-xl shadow-xl p-2 grid grid-cols-8 gap-1 w-44">
                  {COLORS.map(c => (
                    <button key={c} style={{backgroundColor:c}}
                      className="w-4 h-4 rounded border border-border/50 hover:scale-125 transition-transform"
                      onClick={() => { exec("hiliteColor", c); setShowBgPicker(false); }}/>
                  ))}
                </div>
              )}
            </div>

            <div className="w-px h-5 bg-border mx-0.5"/>

            {/* Alignment */}
            <button className={tb(activeFormats.justifyLeft)}   onClick={() => exec("justifyLeft")}   title="Align Left"><AlignLeft className="h-4 w-4"/></button>
            <button className={tb(activeFormats.justifyCenter)} onClick={() => exec("justifyCenter")} title="Center"><AlignCenter className="h-4 w-4"/></button>
            <button className={tb(activeFormats.justifyRight)}  onClick={() => exec("justifyRight")}  title="Right"><AlignRight className="h-4 w-4"/></button>
            <button className={tb(activeFormats.justifyFull)}   onClick={() => exec("justifyFull")}   title="Justify"><AlignJustify className="h-4 w-4"/></button>

            <div className="w-px h-5 bg-border mx-0.5"/>

            {/* Lists */}
            <button className={tb(activeFormats.insertUnorderedList)} onClick={() => exec("insertUnorderedList")} title="Bullet List"><List className="h-4 w-4"/></button>
            <button className={tb(activeFormats.insertOrderedList)}   onClick={() => exec("insertOrderedList")}   title="Numbered List"><ListOrdered className="h-4 w-4"/></button>

            <div className="w-px h-5 bg-border mx-0.5"/>

            {/* Table */}
            <button className={tb(false)} onClick={() => { restoreSelection(); setShowTableModal(true); }} title="Insert Table"><Table className="h-4 w-4"/></button>

            {/* Image */}
            <button className={tb(false)} onClick={() => imgRef.current?.click()} title="Insert Image(s)"><ImageIcon className="h-4 w-4"/></button>

            {/* Link */}
            <button className={tb(false)} onClick={insertLink} title="Insert Link"><Link className="h-4 w-4"/></button>
          </div>

          {/* Title bar */}
          {selectedDoc && (
            <div className="flex items-center gap-2 px-4 py-1 border-b border-border bg-card/50">
              <Input value={title} onChange={e => setTitle(e.target.value)} onBlur={handleSave}
                className="text-sm font-medium border-none shadow-none focus-visible:ring-0 px-0 h-7 bg-transparent"
                placeholder="Document title…"/>
            </div>
          )}

          {/* ── Canvas area ── */}
          {selectedDoc ? (
            <div className="flex-1 overflow-y-auto" style={{background:"#e8eaed"}}>
              <style>{`
                #ld-editor{outline:none;min-height:100%;}
                #ld-editor:empty:before{content:"Start typing here…";color:#9ca3af;pointer-events:none;}
                #ld-editor h1{font-size:2em;font-weight:700;margin:.4em 0;}
                #ld-editor h2{font-size:1.5em;font-weight:700;margin:.4em 0;}
                #ld-editor h3{font-size:1.2em;font-weight:600;margin:.4em 0;}
                #ld-editor blockquote{border-left:4px solid #d1d5db;padding:4px 14px;color:#6b7280;margin:6px 0;}
                #ld-editor pre{background:#f3f4f6;padding:12px;border-radius:6px;font-family:monospace;font-size:.9em;overflow-x:auto;}
                #ld-editor ul{list-style:disc !important;padding-left:1.6em !important;margin:4px 0;}
                #ld-editor ol{list-style:decimal !important;padding-left:1.6em !important;margin:4px 0;}
                #ld-editor li{display:list-item !important;margin:2px 0;}
                #ld-editor table{border-collapse:collapse;width:100%;margin:8px 0;}
                #ld-editor td,#ld-editor th{border:1.5px solid #9ca3af;padding:6px 10px;vertical-align:top;min-width:40px;word-break:break-word;}
                #ld-editor th{background:#f3f4f6;font-weight:600;}
                #ld-editor img{max-width:100%;height:auto;cursor:pointer;display:block;margin:8px 0;}
                #ld-editor img:hover{outline:2px solid #6366f1;outline-offset:2px;}
                #ld-editor a{color:#2563eb;text-decoration:underline;}
                #ld-editor p{margin:2px 0;min-height:1.4em;}
                #ld-editor .pdf-page{margin:0 0 16px 0;box-shadow:0 1px 4px rgba(0,0,0,0.15);}
              `}</style>

              {/* Word-style page: fixed width, centered, scales with pageZoom */}
              <div style={{ display:"flex", justifyContent:"center", padding:"32px 16px" }}>
                <div style={{
                  transform: `scale(${pageZoom / 100})`,
                  transformOrigin: "top center",
                  transition: "transform 0.1s ease-out",
                }}>
                  <div style={{
                    background:"#ffffff",
                    width:"816px",        // ~8.5in @ 96dpi, standard page width like Word
                    minHeight:"1056px",   // ~11in @ 96dpi
                    padding:"56px 64px",
                    boxShadow:"0 1px 6px rgba(0,0,0,0.15)",
                    fontFamily: fontFamily,
                    fontSize: fontSize + "px",
                    lineHeight:"1.6",
                    wordBreak:"break-word",
                    boxSizing:"border-box",
                  }}>
                    <div id="ld-editor" ref={editorRef}
                      contentEditable suppressContentEditableWarning
                      onInput={triggerSave} onKeyUp={updateFormats} onMouseUp={updateFormats}
                      style={{minHeight:"900px"}}
                    />
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center text-center p-8" style={{background:"#e8eaed"}}>
              <FileText className="h-16 w-16 text-muted-foreground mb-4 opacity-40"/>
              <h2 className="text-xl font-semibold mb-2">No document selected</h2>
              <p className="text-muted-foreground mb-6 text-sm">Drag the arrow on the left edge to open your documents, or start a new one</p>
              <div className="flex gap-3 flex-wrap justify-center">
                <Button onClick={createNewDoc} className="gap-2"><Plus className="h-4 w-4"/>New Document</Button>
                <Button variant="outline" className="gap-2" onClick={() => wordRef.current?.click()}>
                  <Upload className="h-4 w-4"/>Import Word
                </Button>
                <Button variant="outline" className="gap-2" onClick={() => pdfRef.current?.click()}>
                  <FileUp className="h-4 w-4"/>Import PDF
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
