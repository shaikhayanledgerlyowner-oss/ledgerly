import React, { useEffect, useRef, useState, useCallback } from "react";
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
  Upload, FilePlus, ChevronLeft, ChevronRight
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

/* ─── Image Annotate — full screen overlay ─── */
function ImageAnnotateModal({ src, onSave, onClose }: {
  src: string; onSave: (d: string) => void; onClose: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [drawing, setDrawing] = useState(false);
  const [tool, setTool] = useState<"pen"|"text"|"eraser">("pen");
  const [color, setColor] = useState("#ff0000");
  const [lineWidth, setLineWidth] = useState(3);
  const [textInput, setTextInput] = useState("");
  const [textPos, setTextPos] = useState<{x:number;y:number}|null>(null);
  const lastPos = useRef<{x:number;y:number}|null>(null);

  useEffect(() => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      const canvas = canvasRef.current!;
      canvas.width  = img.naturalWidth  || img.width  || 800;
      canvas.height = img.naturalHeight || img.height || 600;
      canvas.getContext("2d")!.drawImage(img, 0, 0, canvas.width, canvas.height);
    };
    img.src = src;
  }, [src]);

  const getPos = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const c = canvasRef.current!;
    const r = c.getBoundingClientRect();
    return {
      x: (e.clientX - r.left) * (c.width  / r.width),
      y: (e.clientY - r.top)  * (c.height / r.height),
    };
  };

  const onDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (tool === "text") { setTextPos(getPos(e)); return; }
    setDrawing(true); lastPos.current = getPos(e);
  };
  const onMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!drawing || tool === "text") return;
    const c = canvasRef.current!; const ctx = c.getContext("2d")!;
    const p = getPos(e);
    ctx.beginPath(); ctx.moveTo(lastPos.current!.x, lastPos.current!.y); ctx.lineTo(p.x, p.y);
    ctx.strokeStyle = tool === "eraser" ? "#ffffff" : color;
    ctx.lineWidth   = tool === "eraser" ? lineWidth * 8 : lineWidth * (c.width / c.getBoundingClientRect().width);
    ctx.lineCap = "round"; ctx.stroke();
    lastPos.current = p;
  };
  const onUp = () => setDrawing(false);

  const placeText = () => {
    if (!textPos || !textInput.trim()) return;
    const ctx = canvasRef.current!.getContext("2d")!;
    ctx.font = `${lineWidth * 10 + 14}px Arial`; ctx.fillStyle = color;
    ctx.fillText(textInput, textPos.x, textPos.y);
    setTextInput(""); setTextPos(null);
  };

  return (
    <div className="fixed inset-0 z-[200] flex flex-col" style={{background:"rgba(0,0,0,0.92)"}}>
      {/* Toolbar */}
      <div className="flex items-center gap-2 px-4 py-2 border-b border-white/10 flex-wrap shrink-0" style={{background:"#1a1a1a"}}>
        <span className="text-white font-semibold text-sm mr-2">Annotate Image</span>
        {(["pen","text","eraser"] as const).map(t => (
          <button key={t} onClick={() => setTool(t)}
            style={{padding:"3px 12px",borderRadius:6,fontSize:12,fontWeight:500,border:"1px solid",cursor:"pointer",
              background: tool===t?"white":"transparent",
              color: tool===t?"black":"white",
              borderColor: tool===t?"white":"rgba(255,255,255,0.3)"}}>
            {t==="pen"?"✏️ Pen":t==="text"?"T Text":"⌫ Eraser"}
          </button>
        ))}
        <div style={{width:1,height:20,background:"rgba(255,255,255,0.2)",margin:"0 4px"}}/>
        <label style={{color:"rgba(255,255,255,0.6)",fontSize:12}}>Color:</label>
        <input type="color" value={color} onChange={e=>setColor(e.target.value)}
          style={{width:28,height:28,borderRadius:4,cursor:"pointer",border:"none"}}/>
        <label style={{color:"rgba(255,255,255,0.6)",fontSize:12}}>Size:</label>
        <input type="range" min={1} max={15} value={lineWidth} onChange={e=>setLineWidth(Number(e.target.value))} style={{width:80}}/>
        <span style={{color:"rgba(255,255,255,0.6)",fontSize:12}}>{lineWidth}</span>
        <div style={{marginLeft:"auto",display:"flex",gap:8}}>
          <button onClick={onClose}
            style={{padding:"4px 12px",borderRadius:6,border:"1px solid rgba(255,255,255,0.3)",
              color:"white",background:"transparent",cursor:"pointer",fontSize:12}}>Cancel</button>
          <button onClick={() => onSave(canvasRef.current!.toDataURL("image/png"))}
            style={{padding:"4px 14px",borderRadius:6,border:"none",
              background:"white",color:"black",cursor:"pointer",fontSize:12,fontWeight:600}}>Save Annotation</button>
        </div>
      </div>
      {/* Text input row */}
      {tool === "text" && (
        <div style={{display:"flex",gap:8,padding:"6px 16px",background:"#111",alignItems:"center"}}>
          <input autoFocus value={textInput} onChange={e=>setTextInput(e.target.value)}
            onKeyDown={e=>e.key==="Enter"&&placeText()}
            placeholder="Type text, then click on image…"
            style={{flex:1,background:"rgba(255,255,255,0.1)",color:"white",
              border:"1px solid rgba(255,255,255,0.2)",borderRadius:6,padding:"4px 10px",fontSize:13,outline:"none"}}/>
          <button onClick={placeText}
            style={{padding:"4px 12px",borderRadius:6,background:"white",border:"none",cursor:"pointer",fontSize:12,fontWeight:600}}>Place</button>
        </div>
      )}
      {/* Canvas fills remaining */}
      <div style={{flex:1,overflow:"auto",display:"flex",alignItems:"center",justifyContent:"center",padding:16}}>
        <canvas ref={canvasRef}
          style={{maxWidth:"100%",maxHeight:"100%",border:"2px solid rgba(255,255,255,0.15)",borderRadius:4,
            cursor: tool==="eraser"?"cell":tool==="text"?"text":"crosshair"}}
          onMouseDown={onDown} onMouseMove={onMove} onMouseUp={onUp} onMouseLeave={onUp}/>
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

/* ════════════════════════════════════════════
   MAIN EDITOR
═══════════════════════════════════════════ */
export default function DocumentEditorPage() {
  const { profile } = useAuth();
  const editorRef  = useRef<HTMLDivElement>(null);
  const wordRef    = useRef<HTMLInputElement>(null);
  const imgRef     = useRef<HTMLInputElement>(null);
  const saveTimer  = useRef<NodeJS.Timeout|null>(null);

  const [docs, setDocs]               = useState<Doc[]>([]);
  const [selectedDoc, setSelectedDoc] = useState<Doc|null>(null);
  const [title, setTitle]             = useState("Untitled Document");
  const [saving, setSaving]           = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [importing, setImporting]     = useState(false);

  const [deleteOpen, setDeleteOpen]     = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Doc|null>(null);

  const [showColorPicker, setShowColorPicker] = useState(false);
  const [showBgPicker, setShowBgPicker]       = useState(false);
  const [activeFormats, setActiveFormats]     = useState<Record<string,boolean>>({});
  const [fontSize, setFontSize]     = useState("14");
  const [fontFamily, setFontFamily] = useState("Arial");

  const [showTableModal, setShowTableModal] = useState(false);
  const [annotateImg, setAnnotateImg]       = useState<string|null>(null);
  const [annotateImgEl, setAnnotateImgEl]   = useState<HTMLImageElement|null>(null);

  /* ── Load docs ── */
  const loadDocs = useCallback(async () => {
    if (!profile) return;
    const {data} = await supabase.from("user_documents").select("*")
      .eq("user_id", profile.id).order("updated_at", {ascending:false});
    setDocs((data ?? []) as Doc[]);
  }, [profile]);

  useEffect(() => { loadDocs(); }, [loadDocs]);

  /* ── Image click → context menu ── */
  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    const onClick = (e: MouseEvent) => {
      const t = e.target as HTMLElement;
      if (t.tagName === "IMG") showImgMenu(t as HTMLImageElement, e.clientX, e.clientY);
    };
    editor.addEventListener("click", onClick);
    return () => editor.removeEventListener("click", onClick);
  }, [selectedDoc]);

  const showImgMenu = (img: HTMLImageElement, x: number, y: number) => {
    document.getElementById("_img_ctx")?.remove();
    const menu = document.createElement("div");
    menu.id = "_img_ctx";
    Object.assign(menu.style, {
      position:"fixed", top:`${y}px`, left:`${x}px`, zIndex:"9999",
      background:"white", border:"1px solid #e5e7eb", borderRadius:"10px",
      boxShadow:"0 8px 24px rgba(0,0,0,0.15)", padding:"4px", minWidth:"170px",
    });
    const items = [
      { label:"✏️  Draw / Annotate", fn:() => { setAnnotateImgEl(img); setAnnotateImg(img.src); } },
      { label:"↔️  Resize Image",    fn:() => resizeImg(img) },
      { label:"🗑️  Delete Image",    fn:() => { img.remove(); triggerSave(); } },
    ];
    items.forEach(({label,fn}) => {
      const b = document.createElement("button");
      b.textContent = label;
      Object.assign(b.style, {display:"block",width:"100%",textAlign:"left",
        padding:"8px 14px",fontSize:"13px",border:"none",background:"none",cursor:"pointer",borderRadius:"7px"});
      b.onmouseenter = () => { b.style.background="#f3f4f6"; };
      b.onmouseleave = () => { b.style.background="none"; };
      b.onclick = () => { fn(); menu.remove(); };
      menu.appendChild(b);
    });
    document.body.appendChild(menu);
    const close = (e: MouseEvent) => {
      if (!menu.contains(e.target as Node)) { menu.remove(); document.removeEventListener("mousedown", close); }
    };
    setTimeout(() => document.addEventListener("mousedown", close), 100);
  };

  const resizeImg = (img: HTMLImageElement) => {
    const w = prompt("Enter width in px:", String(img.width || img.naturalWidth || 300));
    if (!w) return;
    const ratio = (img.naturalHeight || img.height) / (img.naturalWidth || img.width || 300);
    img.style.width  = w + "px";
    img.style.height = Math.round(Number(w) * ratio) + "px";
    triggerSave();
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
    editorRef.current?.focus();
    document.execCommand(cmd, false, val);
    updateFormats();
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
    editorRef.current?.focus();
    document.execCommand("formatBlock", false, `<${tag}>`);
    updateFormats(); triggerSave();
  };

  /* ── Insert Table ── */
  const insertTable = (rows: number, cols: number) => {
    const editor = editorRef.current;
    if (!editor) return;
    editor.focus();

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

    // insert at cursor
    const sel = window.getSelection();
    if (sel && sel.rangeCount > 0) {
      const range = sel.getRangeAt(0);
      range.deleteContents();
      const frag = range.createContextualFragment(html);
      range.insertNode(frag);
      range.collapse(false);
      sel.removeAllRanges();
      sel.addRange(range);
    } else {
      editor.innerHTML += html;
    }

    setShowTableModal(false);
    triggerSave();
    toast.success("Table inserted!");
  };

  /* ── Insert link ── */
  const insertLink = () => { const u = prompt("Enter URL:"); if (u) exec("createLink", u); };

  /* ── Insert image(s) ── */
  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    files.forEach(file => {
      const reader = new FileReader();
      reader.onload = ev => {
        const src = ev.target?.result as string;
        const editor = editorRef.current;
        if (!editor) return;
        editor.focus();
        const html = `<img src="${src}" style="max-width:100%;height:auto;display:block;margin:8px 0;cursor:pointer;" />`;
        const sel = window.getSelection();
        if (sel && sel.rangeCount > 0) {
          const range = sel.getRangeAt(0);
          const frag = range.createContextualFragment(html);
          range.insertNode(frag);
          range.collapse(false);
        } else {
          editor.innerHTML += html;
        }
        triggerSave();
      };
      reader.readAsDataURL(file);
    });
    e.target.value = "";
  };

  /* ── Word import (multi-file, fast) ── */
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

        // Fix tables + images in imported HTML
        const parser = new DOMParser();
        const dom = parser.parseFromString(result.value, "text/html");
        dom.querySelectorAll("table").forEach(t => {
          t.style.cssText = "border-collapse:collapse;width:100%;margin:8px 0;";
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

  /* ── Annotation save ── */
  const saveAnnotation = (dataUrl: string) => {
    if (annotateImgEl) { annotateImgEl.src = dataUrl; triggerSave(); toast.success("Annotation saved!"); }
    setAnnotateImg(null); setAnnotateImgEl(null);
  };

  /* ── Export ── */
  const exportCSS = `
    body{font-family:Arial;width:210mm;margin:0 auto;padding:15mm 20mm;line-height:1.6;font-size:14px}
    h1{font-size:2em;font-weight:700;margin:.4em 0}h2{font-size:1.5em;font-weight:700;margin:.4em 0}h3{font-size:1.2em;font-weight:600;margin:.4em 0}
    table{border-collapse:collapse;width:100%;margin:8px 0}td,th{border:1.5px solid #9ca3af;padding:6px 10px;vertical-align:top}
    th{background:#f3f4f6;font-weight:600}
    ul{list-style:disc;padding-left:1.5em}ol{list-style:decimal;padding-left:1.5em}
    img{max-width:100%;height:auto}@media print{body{padding:10mm}}
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
      {annotateImg && annotateImgEl && (
        <ImageAnnotateModal src={annotateImg} onSave={saveAnnotation}
          onClose={() => { setAnnotateImg(null); setAnnotateImgEl(null); }}/>
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
      <input ref={imgRef}  type="file" accept="image/*"    multiple className="hidden" onChange={handleImageUpload}/>

      <div className="flex h-[calc(100vh-56px)] overflow-hidden bg-background">

        {/* ── Sidebar ── */}
        <div className={cn("flex flex-col border-r border-border bg-card transition-all duration-200 shrink-0 overflow-hidden",
          sidebarOpen ? "w-52" : "w-0")}>
          <div className="flex-1 overflow-y-auto p-2 space-y-0.5 pt-2">
            {docs.length === 0 && (
              <p className="text-xs text-muted-foreground text-center py-6">No documents yet</p>
            )}
            {docs.map(doc => (
              <div key={doc.id} onClick={() => selectDoc(doc)}
                className={cn("flex items-center justify-between rounded-lg px-2 py-1.5 cursor-pointer group transition-colors",
                  selectedDoc?.id === doc.id ? "bg-primary/10 text-primary" : "hover:bg-muted")}>
                <div className="flex items-center gap-1.5 min-w-0">
                  <FileText className="h-3.5 w-3.5 shrink-0"/>
                  <span className="text-xs truncate">{doc.title}</span>
                </div>
                <button onClick={e => { e.stopPropagation(); setDeleteTarget(doc); setDeleteOpen(true); }}
                  className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-destructive/10">
                  <Trash2 className="h-3 w-3 text-destructive"/>
                </button>
              </div>
            ))}
          </div>
        </div>

        {/* ── Main editor column ── */}
        <div className="flex-1 flex flex-col overflow-hidden min-w-0">

          {/* ══ TOOLBAR ══ */}
          <div className="flex items-center gap-1 flex-wrap px-2 py-1.5 border-b border-border bg-card select-none">

            {/* Sidebar toggle */}
            <button onClick={() => setSidebarOpen(o => !o)} className={tb(false)} title="Toggle sidebar">
              {sidebarOpen ? <ChevronLeft className="h-4 w-4"/> : <ChevronRight className="h-4 w-4"/>}
            </button>

            {/* New doc */}
            <button onClick={createNewDoc} className={tb(false)} title="New Document">
              <FilePlus className="h-4 w-4"/>
            </button>

            {/* Import Word */}
            <button onClick={() => wordRef.current?.click()} disabled={importing}
              className={cn(tb(false), "w-auto px-2 gap-1 text-xs font-medium")} title="Import Word (.docx)">
              <Upload className="h-3.5 w-3.5 shrink-0"/>
              <span>{importing ? "Importing…" : "Import"}</span>
            </button>

            <div className="w-px h-5 bg-border mx-0.5"/>

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
              editorRef.current?.focus();
              const sel = window.getSelection();
              if (sel && sel.rangeCount > 0 && !sel.isCollapsed) {
                const range = sel.getRangeAt(0);
                const span  = document.createElement("span");
                span.style.fontSize = v + "px";
                try { range.surroundContents(span); } catch {}
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
            <button className={tb(false)} onClick={() => setShowTableModal(true)} title="Insert Table"><Table className="h-4 w-4"/></button>

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
              `}</style>

              {/* Full-width white page — no narrow A4 box */}
              <div style={{
                background:"#ffffff",
                minHeight:"100%",
                padding:"24px 48px",
                fontFamily: fontFamily,
                fontSize: fontSize + "px",
                lineHeight:"1.6",
                wordBreak:"break-word",
                boxSizing:"border-box",
              }}>
                <div id="ld-editor" ref={editorRef}
                  contentEditable suppressContentEditableWarning
                  onInput={triggerSave} onKeyUp={updateFormats} onMouseUp={updateFormats}
                  style={{minHeight:"80vh"}}
                />
              </div>
            </div>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center text-center p-8" style={{background:"#e8eaed"}}>
              <FileText className="h-16 w-16 text-muted-foreground mb-4 opacity-40"/>
              <h2 className="text-xl font-semibold mb-2">No document selected</h2>
              <p className="text-muted-foreground mb-6 text-sm">Select a document from the sidebar or create a new one</p>
              <div className="flex gap-3 flex-wrap justify-center">
                <Button onClick={createNewDoc} className="gap-2"><Plus className="h-4 w-4"/>New Document</Button>
                <Button variant="outline" className="gap-2" onClick={() => wordRef.current?.click()}>
                  <Upload className="h-4 w-4"/>Import Word File
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
