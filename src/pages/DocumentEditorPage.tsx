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
  Upload, Pencil, ZoomIn, ZoomOut, X
} from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

/* ─── mammoth is loaded via CDN in index.html ─── */
declare const mammoth: any;

interface Doc {
  id: string;
  title: string;
  content: string;
  updated_at: string;
}

const FONT_SIZES = ["8","10","12","14","16","18","20","24","28","32","36","48","64","72"];
const FONT_FAMILIES = ["Arial","Times New Roman","Courier New","Georgia","Verdana","Trebuchet MS","Comic Sans MS","Impact"];
const COLORS = [
  "#000000","#434343","#666666","#999999","#b7b7b7","#cccccc","#d9d9d9","#ffffff",
  "#ff0000","#ff4500","#ff9900","#ffff00","#00ff00","#00ffff","#0000ff","#9900ff",
  "#ff00ff","#ff69b4","#8b0000","#006400","#00008b","#4b0082","#ff6347","#ffa500",
];

/* ── Image Annotation Modal ── */
function ImageAnnotateModal({
  src, onSave, onClose,
}: {
  src: string;
  onSave: (dataUrl: string) => void;
  onClose: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [drawing, setDrawing] = useState(false);
  const [tool, setTool] = useState<"pen"|"text"|"eraser">("pen");
  const [color, setColor] = useState("#ff0000");
  const [lineWidth, setLineWidth] = useState(3);
  const [textInput, setTextInput] = useState("");
  const [textPos, setTextPos] = useState<{x:number;y:number}|null>(null);
  const lastPos = useRef<{x:number;y:number}|null>(null);
  const imgRef = useRef<HTMLImageElement|null>(null);

  useEffect(() => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      imgRef.current = img;
      const canvas = canvasRef.current;
      if (!canvas) return;
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext("2d")!;
      ctx.drawImage(img, 0, 0);
    };
    img.src = src;
  }, [src]);

  const getPos = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY,
    };
  };

  const onMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const pos = getPos(e);
    if (tool === "text") {
      setTextPos(pos);
      return;
    }
    setDrawing(true);
    lastPos.current = pos;
  };

  const onMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!drawing || tool === "text") return;
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext("2d")!;
    const pos = getPos(e);
    ctx.beginPath();
    ctx.moveTo(lastPos.current!.x, lastPos.current!.y);
    ctx.lineTo(pos.x, pos.y);
    ctx.strokeStyle = tool === "eraser" ? "#ffffff" : color;
    ctx.lineWidth = tool === "eraser" ? lineWidth * 5 : lineWidth;
    ctx.lineCap = "round";
    ctx.stroke();
    lastPos.current = pos;
  };

  const onMouseUp = () => setDrawing(false);

  const placeText = () => {
    if (!textPos || !textInput.trim()) return;
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext("2d")!;
    ctx.font = `${lineWidth * 8 + 10}px Arial`;
    ctx.fillStyle = color;
    ctx.fillText(textInput, textPos.x, textPos.y);
    setTextInput("");
    setTextPos(null);
  };

  const handleSave = () => {
    const canvas = canvasRef.current!;
    onSave(canvas.toDataURL("image/png"));
  };

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-4xl w-full">
        <DialogHeader>
          <DialogTitle>Annotate Image</DialogTitle>
        </DialogHeader>
        <div className="flex gap-2 flex-wrap items-center border-b pb-2 mb-2">
          {/* Tool buttons */}
          {(["pen","text","eraser"] as const).map(t => (
            <button key={t} onClick={() => setTool(t)}
              className={cn("px-3 py-1 rounded text-sm font-medium border transition-colors",
                tool === t ? "bg-primary text-primary-foreground border-primary" : "border-border hover:bg-muted"
              )}>
              {t === "pen" ? "✏️ Pen" : t === "text" ? "T Text" : "⌫ Eraser"}
            </button>
          ))}
          <div className="w-px h-6 bg-border" />
          <label className="text-xs text-muted-foreground">Color:</label>
          <input type="color" value={color} onChange={e => setColor(e.target.value)}
            className="w-8 h-8 rounded cursor-pointer border border-border" />
          <label className="text-xs text-muted-foreground">Size:</label>
          <input type="range" min={1} max={10} value={lineWidth}
            onChange={e => setLineWidth(Number(e.target.value))} className="w-20" />
        </div>
        {/* Text input for text tool */}
        {tool === "text" && (
          <div className="flex gap-2 mb-2 items-center">
            <Input placeholder="Type text, then click on image..."
              value={textInput} onChange={e => setTextInput(e.target.value)}
              onKeyDown={e => e.key === "Enter" && placeText()}
              className="flex-1 text-sm" />
            <Button size="sm" onClick={placeText}>Place</Button>
          </div>
        )}
        <div className="overflow-auto max-h-[55vh] border rounded">
          <canvas ref={canvasRef}
            style={{ cursor: tool === "eraser" ? "cell" : tool === "text" ? "text" : "crosshair",
              maxWidth: "100%", display: "block" }}
            onMouseDown={onMouseDown}
            onMouseMove={onMouseMove}
            onMouseUp={onMouseUp}
            onMouseLeave={onMouseUp}
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSave}>Save Annotation</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ── Insert Table Modal ── */
function InsertTableModal({
  onInsert, onClose,
}: {
  onInsert: (rows: number, cols: number) => void;
  onClose: () => void;
}) {
  const [rows, setRows] = useState(3);
  const [cols, setCols] = useState(3);
  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-xs">
        <DialogHeader><DialogTitle>Insert Table</DialogTitle></DialogHeader>
        <div className="space-y-4 py-2">
          <div className="flex items-center gap-3">
            <label className="text-sm w-16">Rows:</label>
            <Input type="number" min={1} max={20} value={rows}
              onChange={e => setRows(Number(e.target.value))} className="w-24" />
          </div>
          <div className="flex items-center gap-3">
            <label className="text-sm w-16">Columns:</label>
            <Input type="number" min={1} max={10} value={cols}
              onChange={e => setCols(Number(e.target.value))} className="w-24" />
          </div>
          {/* Visual preview */}
          <div className="border rounded p-2 overflow-auto">
            <table style={{ borderCollapse: "collapse", width: "100%" }}>
              <tbody>
                {Array.from({ length: Math.min(rows, 5) }).map((_, r) => (
                  <tr key={r}>
                    {Array.from({ length: Math.min(cols, 6) }).map((_, c) => (
                      <td key={c} style={{ border: "1px solid #ccc", padding: "4px 8px",
                        background: r === 0 ? "#f0f0f0" : "white", fontSize: 11 }}>
                        {r === 0 ? `H${c+1}` : "·"}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
            {rows > 5 && <p className="text-xs text-muted-foreground mt-1">+{rows - 5} more rows...</p>}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={() => onInsert(rows, cols)}>Insert Table</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ── Image Resize Modal ── */
function ImageResizeModal({
  imgEl, onClose,
}: {
  imgEl: HTMLImageElement;
  onClose: () => void;
}) {
  const [width, setWidth] = useState(imgEl.width || 300);
  const [height, setHeight] = useState(imgEl.height || 200);
  const [locked, setLocked] = useState(true);
  const origRatio = (imgEl.naturalWidth || imgEl.width) / (imgEl.naturalHeight || imgEl.height);

  const applyResize = () => {
    imgEl.style.width = width + "px";
    imgEl.style.height = height + "px";
    imgEl.width = width;
    imgEl.height = height;
    onClose();
  };

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-xs">
        <DialogHeader><DialogTitle>Resize Image</DialogTitle></DialogHeader>
        <div className="space-y-3 py-2">
          <div className="flex items-center gap-3">
            <label className="text-sm w-16">Width (px):</label>
            <Input type="number" min={10} value={width} onChange={e => {
              const w = Number(e.target.value);
              setWidth(w);
              if (locked) setHeight(Math.round(w / origRatio));
            }} className="w-24" />
          </div>
          <div className="flex items-center gap-3">
            <label className="text-sm w-16">Height (px):</label>
            <Input type="number" min={10} value={height} onChange={e => {
              const h = Number(e.target.value);
              setHeight(h);
              if (locked) setWidth(Math.round(h * origRatio));
            }} className="w-24" />
          </div>
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input type="checkbox" checked={locked} onChange={e => setLocked(e.target.checked)} />
            Lock aspect ratio
          </label>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={applyResize}>Apply</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ════════════════════════════════════════════
   MAIN COMPONENT
═══════════════════════════════════════════ */
export default function DocumentEditorPage() {
  const { profile } = useAuth();
  const editorRef = useRef<HTMLDivElement>(null);

  const [docs, setDocs] = useState<Doc[]>([]);
  const [selectedDoc, setSelectedDoc] = useState<Doc | null>(null);
  const [title, setTitle] = useState("Untitled Document");
  const [saving, setSaving] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Doc | null>(null);

  const [showColorPicker, setShowColorPicker] = useState(false);
  const [showBgColorPicker, setShowBgColorPicker] = useState(false);
  const [activeFormats, setActiveFormats] = useState<Record<string, boolean>>({});
  const [fontSize, setFontSize] = useState("14");
  const [fontFamily, setFontFamily] = useState("Arial");

  const [showTableModal, setShowTableModal] = useState(false);
  const [annotateImg, setAnnotateImg] = useState<string | null>(null);
  const [annotateImgEl, setAnnotateImgEl] = useState<HTMLImageElement | null>(null);
  const [resizeImgEl, setResizeImgEl] = useState<HTMLImageElement | null>(null);

  const saveTimeout = useRef<NodeJS.Timeout | null>(null);
  const wordUploadRef = useRef<HTMLInputElement>(null);
  const imgUploadRef = useRef<HTMLInputElement>(null);

  /* ── Load docs ── */
  const loadDocs = async () => {
    if (!profile) return;
    const { data } = await supabase
      .from("user_documents").select("*")
      .eq("user_id", profile.id).order("updated_at", { ascending: false });
    setDocs((data ?? []) as Doc[]);
  };

  useEffect(() => { loadDocs(); }, [profile]);

  /* ── Make images in editor clickable for context menu ── */
  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    const handleClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === "IMG") {
        e.preventDefault();
        showImageMenu(target as HTMLImageElement, e.clientX, e.clientY);
      }
    };
    editor.addEventListener("click", handleClick);
    return () => editor.removeEventListener("click", handleClick);
  }, [selectedDoc]);

  /* ── Image context menu ── */
  const showImageMenu = (img: HTMLImageElement, x: number, y: number) => {
    // Remove existing menu
    document.getElementById("img-ctx-menu")?.remove();
    const menu = document.createElement("div");
    menu.id = "img-ctx-menu";
    menu.style.cssText = `position:fixed;top:${y}px;left:${x}px;z-index:9999;
      background:white;border:1px solid #ddd;border-radius:8px;
      box-shadow:0 4px 16px rgba(0,0,0,0.15);padding:4px;min-width:160px;`;

    const items = [
      { label: "✏️ Annotate / Draw", action: () => { setAnnotateImgEl(img); setAnnotateImg(img.src); } },
      { label: "↔️ Resize Image", action: () => setResizeImgEl(img) },
      { label: "🗑️ Delete Image", action: () => img.remove() },
    ];

    items.forEach(({ label, action }) => {
      const btn = document.createElement("button");
      btn.textContent = label;
      btn.style.cssText = `display:block;width:100%;text-align:left;padding:8px 12px;
        font-size:13px;border:none;background:none;cursor:pointer;border-radius:6px;`;
      btn.onmouseenter = () => btn.style.background = "#f0f0f0";
      btn.onmouseleave = () => btn.style.background = "none";
      btn.onclick = () => { action(); menu.remove(); };
      menu.appendChild(btn);
    });

    document.body.appendChild(menu);
    const close = (e: MouseEvent) => {
      if (!menu.contains(e.target as Node)) { menu.remove(); document.removeEventListener("mousedown", close); }
    };
    setTimeout(() => document.addEventListener("mousedown", close), 100);
  };

  /* ── Select doc ── */
  const selectDoc = (doc: Doc) => {
    setSelectedDoc(doc);
    setTitle(doc.title);
    if (editorRef.current) editorRef.current.innerHTML = doc.content || "";
  };

  /* ── New doc ── */
  const createNewDoc = async () => {
    if (!profile) return;
    const { data, error } = await supabase.from("user_documents")
      .insert({ user_id: profile.id, title: "Untitled Document", content: "" })
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
    const { error } = await supabase.from("user_documents")
      .update({ title, content, updated_at: new Date().toISOString() })
      .eq("id", selectedDoc.id);
    if (!error) setDocs(prev => prev.map(d => d.id === selectedDoc.id ? { ...d, title, content } : d));
  }, [selectedDoc, title, profile]);

  const handleSave = async () => {
    if (!selectedDoc) return;
    setSaving(true);
    await autoSave();
    setSaving(false);
    toast.success("Document saved!");
  };

  const handleContentChange = () => {
    if (saveTimeout.current) clearTimeout(saveTimeout.current);
    saveTimeout.current = setTimeout(autoSave, 2000);
    updateActiveFormats();
  };

  /* ── Delete ── */
  const handleDelete = async () => {
    if (!deleteTarget) return;
    const { error } = await supabase.from("user_documents").delete().eq("id", deleteTarget.id);
    if (error) return toast.error(error.message);
    toast.success("Document deleted!");
    setDeleteDialogOpen(false);
    setDeleteTarget(null);
    if (selectedDoc?.id === deleteTarget.id) {
      setSelectedDoc(null);
      if (editorRef.current) editorRef.current.innerHTML = "";
    }
    await loadDocs();
  };

  /* ── Format commands ── */
  const exec = (command: string, value?: string) => {
    editorRef.current?.focus();
    document.execCommand(command, false, value);
    updateActiveFormats();
  };

  const updateActiveFormats = () => {
    setActiveFormats({
      bold: document.queryCommandState("bold"),
      italic: document.queryCommandState("italic"),
      underline: document.queryCommandState("underline"),
      strikeThrough: document.queryCommandState("strikeThrough"),
      justifyLeft: document.queryCommandState("justifyLeft"),
      justifyCenter: document.queryCommandState("justifyCenter"),
      justifyRight: document.queryCommandState("justifyRight"),
      justifyFull: document.queryCommandState("justifyFull"),
      insertUnorderedList: document.queryCommandState("insertUnorderedList"),
      insertOrderedList: document.queryCommandState("insertOrderedList"),
    });
  };

  /* ── Apply heading / paragraph format ── */
  const applyBlockFormat = (tag: string) => {
    editorRef.current?.focus();
    document.execCommand("formatBlock", false, tag);
    updateActiveFormats();
  };

  /* ── Insert Table ── */
  const insertTable = (rows: number, cols: number) => {
    editorRef.current?.focus();
    let html = `<table style="border-collapse:collapse;width:100%;margin:8px 0;">`;
    for (let r = 0; r < rows; r++) {
      html += "<tr>";
      for (let c = 0; c < cols; c++) {
        const cellStyle = `border:1px solid #ccc;padding:6px 10px;min-width:60px;
          ${r === 0 ? "background:#f3f4f6;font-weight:600;" : ""}`;
        html += r === 0
          ? `<th style="${cellStyle}" contenteditable="true">Header ${c + 1}</th>`
          : `<td style="${cellStyle}" contenteditable="true">&nbsp;</td>`;
      }
      html += "</tr>";
    }
    html += "</table><p><br></p>";
    document.execCommand("insertHTML", false, html);
    setShowTableModal(false);
    handleContentChange();
  };

  /* ── Insert link ── */
  const insertLink = () => {
    const url = prompt("Enter URL:");
    if (url) exec("createLink", url);
  };

  /* ── Insert image from file ── */
  const insertImage = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const src = ev.target?.result as string;
      const imgHtml = `<img src="${src}" style="max-width:100%;cursor:pointer;" />`;
      editorRef.current?.focus();
      document.execCommand("insertHTML", false, imgHtml);
      handleContentChange();
    };
    reader.readAsDataURL(file);
    e.target.value = "";
  };

  /* ── Word (.docx) upload ── */
  const handleWordUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";

    if (typeof mammoth === "undefined") {
      toast.error("Word converter not loaded. Please refresh the page.");
      return;
    }

    try {
      const arrayBuffer = await file.arrayBuffer();
      const result = await mammoth.convertToHtml({ arrayBuffer });
      if (!editorRef.current) return;

      // Style the converted HTML tables
      const styled = result.value
        .replace(/<table/g, '<table style="border-collapse:collapse;width:100%;margin:8px 0;"')
        .replace(/<td/g, '<td style="border:1px solid #ccc;padding:6px 10px;"')
        .replace(/<th/g, '<th style="border:1px solid #ccc;padding:6px 10px;background:#f3f4f6;font-weight:600;"');

      editorRef.current.innerHTML = styled;
      setTitle(file.name.replace(/\.docx?$/i, ""));
      handleContentChange();

      if (result.messages.length > 0) {
        toast.info("Word file imported. Some complex formatting may have changed.");
      } else {
        toast.success("Word file imported successfully!");
      }
    } catch {
      toast.error("Could not read Word file. Make sure it is a valid .docx file.");
    }
  };

  /* ── Annotation save ── */
  const handleAnnotationSave = (dataUrl: string) => {
    if (!annotateImgEl) return;
    annotateImgEl.src = dataUrl;
    setAnnotateImg(null);
    setAnnotateImgEl(null);
    handleContentChange();
    toast.success("Annotation saved!");
  };

  /* ── Download helpers ── */
  const downloadHTML = () => {
    if (!editorRef.current) return;
    const content = editorRef.current.innerHTML;
    const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>${title}</title>
      <style>body{font-family:Arial;max-width:800px;margin:40px auto;padding:0 20px;line-height:1.6}
      table{border-collapse:collapse;width:100%}td,th{border:1px solid #ccc;padding:6px 10px}</style>
      </head><body>${content}</body></html>`;
    const a = Object.assign(document.createElement("a"), {
      href: URL.createObjectURL(new Blob([html], { type: "text/html" })),
      download: `${title}.html`,
    });
    a.click();
  };

  const downloadTXT = () => {
    if (!editorRef.current) return;
    const a = Object.assign(document.createElement("a"), {
      href: URL.createObjectURL(new Blob([editorRef.current.innerText], { type: "text/plain" })),
      download: `${title}.txt`,
    });
    a.click();
  };

  const printDoc = () => {
    if (!editorRef.current) return;
    const win = window.open("", "_blank");
    if (!win) return;
    win.document.write(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>${title}</title>
      <style>body{font-family:Arial;max-width:800px;margin:40px auto;padding:0 20px;line-height:1.6}
      table{border-collapse:collapse;width:100%}td,th{border:1px solid #ccc;padding:6px 10px}
      @media print{body{margin:0}}</style></head><body>${editorRef.current.innerHTML}</body></html>`);
    win.document.close();
    win.print();
  };

  const toolbarBtn = (active: boolean) =>
    cn("h-8 w-8 p-0 rounded flex items-center justify-center transition-colors",
      active ? "bg-primary text-primary-foreground" : "hover:bg-muted text-foreground");

  /* ════════════════════ RENDER ════════════════════ */
  return (
    <>
      {/* ── Modals ── */}
      {showTableModal && (
        <InsertTableModal
          onInsert={insertTable}
          onClose={() => setShowTableModal(false)}
        />
      )}
      {annotateImg && annotateImgEl && (
        <ImageAnnotateModal
          src={annotateImg}
          onSave={handleAnnotationSave}
          onClose={() => { setAnnotateImg(null); setAnnotateImgEl(null); }}
        />
      )}
      {resizeImgEl && (
        <ImageResizeModal
          imgEl={resizeImgEl}
          onClose={() => setResizeImgEl(null)}
        />
      )}

      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Document?</AlertDialogTitle>
            <AlertDialogDescription>
              "{deleteTarget?.title}" will be permanently deleted.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Hidden file inputs */}
      <input ref={wordUploadRef} type="file" accept=".doc,.docx" className="hidden" onChange={handleWordUpload} />
      <input ref={imgUploadRef} type="file" accept="image/*" className="hidden" onChange={insertImage} />

      <div className="flex h-[calc(100vh-56px)] overflow-hidden">
        {/* ── Sidebar ── */}
        <div className="w-64 border-r border-border bg-card flex flex-col shrink-0">
          <div className="p-3 border-b border-border space-y-2">
            <Button onClick={createNewDoc} className="w-full gap-2" size="sm">
              <Plus className="h-4 w-4" /> New Document
            </Button>
            <Button
              variant="outline" size="sm" className="w-full gap-2"
              onClick={() => wordUploadRef.current?.click()}
            >
              <Upload className="h-4 w-4" /> Import Word File
            </Button>
          </div>
          <div className="flex-1 overflow-y-auto p-2 space-y-1">
            {docs.length === 0 && (
              <p className="text-xs text-muted-foreground text-center pt-4">No documents yet</p>
            )}
            {docs.map((doc) => (
              <div key={doc.id} onClick={() => selectDoc(doc)}
                className={cn(
                  "flex items-center justify-between rounded-lg px-3 py-2 cursor-pointer group transition-colors",
                  selectedDoc?.id === doc.id ? "bg-primary/10 text-primary" : "hover:bg-muted"
                )}>
                <div className="flex items-center gap-2 min-w-0">
                  <FileText className="h-4 w-4 shrink-0" />
                  <span className="text-sm truncate">{doc.title}</span>
                </div>
                <button onClick={(e) => { e.stopPropagation(); setDeleteTarget(doc); setDeleteDialogOpen(true); }}
                  className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-destructive/10">
                  <Trash2 className="h-3 w-3 text-destructive" />
                </button>
              </div>
            ))}
          </div>
        </div>

        {/* ── Editor Area ── */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {selectedDoc ? (
            <>
              {/* Title Bar */}
              <div className="flex items-center gap-3 px-4 py-2 border-b border-border bg-card">
                <Input value={title} onChange={(e) => setTitle(e.target.value)}
                  onBlur={handleSave}
                  className="text-base font-medium border-none shadow-none focus-visible:ring-0 px-0 h-8"
                  placeholder="Document title..." />
                <div className="flex items-center gap-2 shrink-0">
                  <Button size="sm" variant="outline" onClick={handleSave} disabled={saving} className="gap-2">
                    <Save className="h-4 w-4" />
                    {saving ? "Saving..." : "Save"}
                  </Button>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button size="sm" variant="outline" className="gap-2">
                        <Download className="h-4 w-4" /> Export <ChevronDown className="h-3 w-3" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent>
                      <DropdownMenuItem onClick={printDoc}>Save as PDF (Print)</DropdownMenuItem>
                      <DropdownMenuItem onClick={downloadHTML}>Download as HTML</DropdownMenuItem>
                      <DropdownMenuItem onClick={downloadTXT}>Download as TXT</DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </div>

              {/* ── Toolbar ── */}
              <div className="flex items-center gap-1 flex-wrap px-3 py-2 border-b border-border bg-card">

                {/* Undo / Redo */}
                <button className={toolbarBtn(false)} onClick={() => exec("undo")} title="Undo"><Undo className="h-4 w-4" /></button>
                <button className={toolbarBtn(false)} onClick={() => exec("redo")} title="Redo"><Redo className="h-4 w-4" /></button>
                <div className="w-px h-6 bg-border mx-1" />

                {/* Block format (Headings + Paragraph) */}
                <Select defaultValue="p" onValueChange={applyBlockFormat}>
                  <SelectTrigger className="h-8 w-32 text-xs">
                    <SelectValue placeholder="Format" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="p">Paragraph</SelectItem>
                    <SelectItem value="h1"><span className="font-bold text-base">Heading 1</span></SelectItem>
                    <SelectItem value="h2"><span className="font-bold">Heading 2</span></SelectItem>
                    <SelectItem value="h3"><span className="font-semibold">Heading 3</span></SelectItem>
                    <SelectItem value="blockquote">Blockquote</SelectItem>
                    <SelectItem value="pre">Code Block</SelectItem>
                  </SelectContent>
                </Select>

                {/* Font Family */}
                <Select value={fontFamily} onValueChange={(v) => { setFontFamily(v); exec("fontName", v); }}>
                  <SelectTrigger className="h-8 w-32 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {FONT_FAMILIES.map(f => (
                      <SelectItem key={f} value={f} style={{ fontFamily: f }}>{f}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                {/* Font Size */}
                <Select value={fontSize} onValueChange={(v) => {
                  setFontSize(v);
                  const sel = window.getSelection();
                  if (sel && sel.rangeCount > 0 && !sel.isCollapsed) {
                    const range = sel.getRangeAt(0);
                    const span = document.createElement("span");
                    span.style.fontSize = v + "px";
                    try { range.surroundContents(span); } catch {}
                  }
                }}>
                  <SelectTrigger className="h-8 w-16 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {FONT_SIZES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                  </SelectContent>
                </Select>

                <div className="w-px h-6 bg-border mx-1" />

                {/* Bold / Italic / Underline / Strike */}
                <button className={toolbarBtn(activeFormats.bold)} onClick={() => exec("bold")} title="Bold"><Bold className="h-4 w-4" /></button>
                <button className={toolbarBtn(activeFormats.italic)} onClick={() => exec("italic")} title="Italic"><Italic className="h-4 w-4" /></button>
                <button className={toolbarBtn(activeFormats.underline)} onClick={() => exec("underline")} title="Underline"><Underline className="h-4 w-4" /></button>
                <button className={toolbarBtn(activeFormats.strikeThrough)} onClick={() => exec("strikeThrough")} title="Strikethrough"><Strikethrough className="h-4 w-4" /></button>

                <div className="w-px h-6 bg-border mx-1" />

                {/* Text Color */}
                <div className="relative">
                  <button className={toolbarBtn(false)}
                    onClick={() => { setShowColorPicker(!showColorPicker); setShowBgColorPicker(false); }}
                    title="Text Color">
                    <Type className="h-4 w-4" />
                  </button>
                  {showColorPicker && (
                    <div className="absolute top-9 left-0 z-50 bg-card border border-border rounded-lg shadow-lg p-2 grid grid-cols-8 gap-1 w-48">
                      {COLORS.map(c => (
                        <button key={c} style={{ backgroundColor: c }}
                          className="w-5 h-5 rounded border border-border hover:scale-110 transition-transform"
                          onClick={() => { exec("foreColor", c); setShowColorPicker(false); }} />
                      ))}
                    </div>
                  )}
                </div>

                {/* Highlight Color */}
                <div className="relative">
                  <button className={toolbarBtn(false)}
                    onClick={() => { setShowBgColorPicker(!showBgColorPicker); setShowColorPicker(false); }}
                    title="Highlight Color">
                    <Palette className="h-4 w-4" />
                  </button>
                  {showBgColorPicker && (
                    <div className="absolute top-9 left-0 z-50 bg-card border border-border rounded-lg shadow-lg p-2 grid grid-cols-8 gap-1 w-48">
                      {COLORS.map(c => (
                        <button key={c} style={{ backgroundColor: c }}
                          className="w-5 h-5 rounded border border-border hover:scale-110 transition-transform"
                          onClick={() => { exec("hiliteColor", c); setShowBgColorPicker(false); }} />
                      ))}
                    </div>
                  )}
                </div>

                <div className="w-px h-6 bg-border mx-1" />

                {/* Alignment */}
                <button className={toolbarBtn(activeFormats.justifyLeft)} onClick={() => exec("justifyLeft")} title="Align Left"><AlignLeft className="h-4 w-4" /></button>
                <button className={toolbarBtn(activeFormats.justifyCenter)} onClick={() => exec("justifyCenter")} title="Center"><AlignCenter className="h-4 w-4" /></button>
                <button className={toolbarBtn(activeFormats.justifyRight)} onClick={() => exec("justifyRight")} title="Align Right"><AlignRight className="h-4 w-4" /></button>
                <button className={toolbarBtn(activeFormats.justifyFull)} onClick={() => exec("justifyFull")} title="Justify"><AlignJustify className="h-4 w-4" /></button>

                <div className="w-px h-6 bg-border mx-1" />

                {/* Lists */}
                <button className={toolbarBtn(activeFormats.insertUnorderedList)} onClick={() => exec("insertUnorderedList")} title="Bullet List"><List className="h-4 w-4" /></button>
                <button className={toolbarBtn(activeFormats.insertOrderedList)} onClick={() => exec("insertOrderedList")} title="Numbered List"><ListOrdered className="h-4 w-4" /></button>

                <div className="w-px h-6 bg-border mx-1" />

                {/* Insert Table */}
                <button className={toolbarBtn(false)} onClick={() => setShowTableModal(true)} title="Insert Table">
                  <Table className="h-4 w-4" />
                </button>

                {/* Insert Image */}
                <button className={toolbarBtn(false)} onClick={() => imgUploadRef.current?.click()} title="Insert Image">
                  <ImageIcon className="h-4 w-4" />
                </button>

                {/* Insert Link */}
                <button className={toolbarBtn(false)} onClick={insertLink} title="Insert Link">
                  <Link className="h-4 w-4" />
                </button>
              </div>

              {/* ── Editor Canvas ── */}
              <div className="flex-1 overflow-y-auto bg-gray-100 dark:bg-gray-900 p-6">
                <style>{`
                  #doc-editor h1 { font-size: 2em; font-weight: 700; margin: 0.5em 0; }
                  #doc-editor h2 { font-size: 1.5em; font-weight: 700; margin: 0.5em 0; }
                  #doc-editor h3 { font-size: 1.2em; font-weight: 600; margin: 0.5em 0; }
                  #doc-editor blockquote { border-left: 4px solid #ccc; margin: 8px 0; padding: 4px 12px; color: #555; }
                  #doc-editor pre { background: #f3f4f6; padding: 12px; border-radius: 6px; font-family: monospace; }
                  #doc-editor ul { list-style: disc; padding-left: 24px; margin: 4px 0; }
                  #doc-editor ol { list-style: decimal; padding-left: 24px; margin: 4px 0; }
                  #doc-editor li { margin: 2px 0; }
                  #doc-editor table { border-collapse: collapse; width: 100%; margin: 8px 0; }
                  #doc-editor td, #doc-editor th { border: 1px solid #ccc; padding: 6px 10px; min-width: 60px; }
                  #doc-editor th { background: #f3f4f6; font-weight: 600; }
                  #doc-editor img { cursor: pointer; }
                  #doc-editor img:hover { outline: 2px solid #6366f1; }
                  #doc-editor a { color: #2563eb; text-decoration: underline; }
                  #doc-editor [data-placeholder]:empty:before {
                    content: attr(data-placeholder);
                    color: #aaa; pointer-events: none;
                  }
                `}</style>
                <div className="mx-auto bg-white dark:bg-gray-800 shadow-md"
                  style={{ width: "210mm", minHeight: "297mm", padding: "20mm",
                    fontFamily, fontSize: fontSize + "px" }}>
                  <div id="doc-editor" ref={editorRef}
                    contentEditable suppressContentEditableWarning
                    onInput={handleContentChange}
                    onKeyUp={updateActiveFormats}
                    onMouseUp={updateActiveFormats}
                    className="outline-none min-h-full"
                    style={{ lineHeight: "1.6", wordBreak: "break-word" }}
                    data-placeholder="Start typing here..." />
                </div>
              </div>
            </>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center text-center p-8">
              <FileText className="h-16 w-16 text-muted-foreground mb-4" />
              <h2 className="text-xl font-semibold mb-2">No document selected</h2>
              <p className="text-muted-foreground mb-6">Select a document from the sidebar or create a new one</p>
              <div className="flex gap-3">
                <Button onClick={createNewDoc} className="gap-2">
                  <Plus className="h-4 w-4" /> New Document
                </Button>
                <Button variant="outline" className="gap-2" onClick={() => wordUploadRef.current?.click()}>
                  <Upload className="h-4 w-4" /> Import Word File
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
