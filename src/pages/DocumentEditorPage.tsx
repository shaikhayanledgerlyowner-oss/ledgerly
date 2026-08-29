import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import {
  FileText, Plus, Search, ArrowUpDown, Pencil, Copy, Trash2, X,
  ChevronRight, Upload, FileUp,
} from "lucide-react";
import { cn } from "@/lib/utils";

declare const mammoth: any;
declare const pdfjsLib: any;

interface Doc {
  id: string;
  title: string;
  content: string;
  updated_at: string;
}

const FONTS = ["Aptos","Arial","Calibri","Cambria","Courier New","Georgia","Helvetica","Segoe UI","Times New Roman","Trebuchet MS","Verdana"];
const SIZES = [8,9,10,11,12,14,16,18,20,24,28,32,36,48,72];
const COLORS = ["#000000","#404040","#7f7f7f","#bfbfbf","#ffffff","#c00000","#ff0000","#ffc000","#ffff00","#92d050","#00b050","#00b0f0","#0070c0","#002060","#7030a0"];
const HIGHLIGHTS = ["#ffff00","#00ff00","#00ffff","#ff00ff","#ff9999","#c0c0c0","transparent"];

const TABS = ["File","Home","Insert","Layout","Review","View"] as const;
type Tab = typeof TABS[number];

const PAGE_W_PX = 816;   // 8.5in @ 96dpi
const PAGE_H_PX = 1056;  // 11in  @ 96dpi
const PAGE_PAD_PX = 96;  // 1in margins

/* ═════════ small UI atoms — dark, Word-ribbon styled ═════════ */
function RBtn({ children, title, onClick, active, disabled, wide }: {
  children: React.ReactNode; title: string; onClick: () => void;
  active?: boolean; disabled?: boolean; wide?: boolean;
}) {
  return (
    <button type="button" title={title} aria-pressed={active} disabled={disabled}
      onMouseDown={e => e.preventDefault()}
      onClick={onClick}
      className={cn(
        "flex h-8 items-center justify-center gap-1 rounded text-sm transition-colors disabled:opacity-40 border",
        wide ? "px-2" : "w-8",
        active ? "border-white/30 bg-white/15 text-white" : "border-transparent text-white/70 hover:border-white/20 hover:bg-white/10 hover:text-white"
      )}>
      {children}
    </button>
  );
}

function RGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex shrink-0 flex-col items-center gap-1 border-r border-white/10 px-2 py-1 last:border-r-0">
      <div className="flex flex-wrap items-center gap-0.5">{children}</div>
      <span className="text-[10px] uppercase tracking-wide text-white/40">{label}</span>
    </div>
  );
}

function RPopover({ title, label, children }: {
  title: string; label: React.ReactNode; children: (close: () => void) => React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [open]);
  return (
    <div ref={ref} className="relative">
      <RBtn title={title} wide onClick={() => setOpen(o => !o)} active={open}>
        {label}<span className="text-[9px] leading-none">▾</span>
      </RBtn>
      {open && (
        <div className="absolute left-0 top-9 z-50 min-w-40 rounded-md border border-white/10 bg-[#252525] p-2 shadow-xl">
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}

/* ═════════ Insert Table modal ═════════ */
function InsertTableModal({ onInsert, onClose }: { onInsert: (r: number, c: number) => void; onClose: () => void }) {
  const [rows, setRows] = useState(3);
  const [cols, setCols] = useState(3);
  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60" onClick={onClose}>
      <div className="w-80 rounded-lg border border-white/10 bg-[#252525] p-4 text-white" onClick={e => e.stopPropagation()}>
        <h3 className="mb-3 text-sm font-semibold">Insert Table</h3>
        <div className="space-y-3">
          <div className="flex items-center gap-3">
            <label className="w-20 text-sm text-white/70">Rows:</label>
            <Input type="number" min={1} max={30} value={rows} onChange={e => setRows(Number(e.target.value))} className="w-24 bg-white/5 text-white" />
          </div>
          <div className="flex items-center gap-3">
            <label className="w-20 text-sm text-white/70">Columns:</label>
            <Input type="number" min={1} max={10} value={cols} onChange={e => setCols(Number(e.target.value))} className="w-24 bg-white/5 text-white" />
          </div>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <button onClick={onClose} className="rounded border border-white/20 px-3 py-1.5 text-sm hover:bg-white/10">Cancel</button>
          <button onClick={() => onInsert(rows, cols)} className="rounded bg-blue-600 px-3 py-1.5 text-sm font-medium hover:bg-blue-500">Insert</button>
        </div>
      </div>
    </div>
  );
}

/* ═════════ Word text-box fragment merge + positioning strip (docx import fidelity) ═════════ */
function getMaxFontSizePx(el: HTMLElement): number {
  let max = 0;
  const consider = (e: HTMLElement) => {
    const fs = e.style?.fontSize;
    if (fs) {
      const m = fs.match(/([\d.]+)\s*(px|pt)/);
      if (m) { let v = parseFloat(m[1]); if (m[2] === "pt") v *= 1.333; if (v > max) max = v; }
    }
  };
  consider(el);
  el.querySelectorAll<HTMLElement>("*").forEach(consider);
  return max;
}

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
        (p.previousElementSibling === group[group.length - 1] && p.parentElement === group[group.length - 1].parentElement);
      if (isLogoLike && isConsecutive) { group.push(p); j++; } else break;
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

function cleanImportedDom(dom: Document) {
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
  dom.querySelectorAll("table").forEach(t => { (t as HTMLElement).style.cssText = "border-collapse:collapse;width:100%;margin:8px 0;"; });
  dom.querySelectorAll("td,th").forEach(c => { (c as HTMLElement).style.cssText += ";border:1.5px solid #9ca3af;padding:6px 10px;vertical-align:top;word-break:break-word;"; });
  dom.querySelectorAll("th").forEach(c => { (c as HTMLElement).style.background = "#f3f4f6"; (c as HTMLElement).style.fontWeight = "600"; });
  dom.querySelectorAll("img").forEach(img => { (img as HTMLElement).style.cssText = "max-width:100%;height:auto;display:block;margin:8px 0;cursor:pointer;"; });
}

/* ═════════ Pagination display ═════════
   contentEditable cannot natively "flow" content across separate
   fixed-size page boxes the way Word's own layout engine does — any
   attempt to physically split one editable surface into N boxes on
   every keystroke constantly scrambles the cursor/selection mid-typing,
   which is worse than not paginating at all. Instead we keep ONE
   continuous, reliable editable surface (so typing/formatting/selection
   always behaves correctly), and compute + display how many Word-page
   equivalents (816×1056px, 1in margins) the current content would
   occupy — this is measured from the same `.ld-editor` node's actual
   rendered height, so it tracks length accurately as you type. */
function usePageCount(editorRef: React.RefObject<HTMLDivElement>, contentVersion: number) {
  const [pageCount, setPageCount] = useState(1);
  useEffect(() => {
    const el = editorRef.current;
    if (!el) return;
    const usableH = PAGE_H_PX - PAGE_PAD_PX * 2;
    const total = el.scrollHeight;
    setPageCount(Math.max(1, Math.ceil(total / usableH)));
  }, [contentVersion, editorRef]);
  return pageCount;
}

/* ════════════════════════════════════════════
   MAIN EDITOR
═══════════════════════════════════════════ */
export default function DocumentEditorPage() {
  const { profile } = useAuth();
  const editorRef = useRef<HTMLDivElement>(null);
  const wordRef = useRef<HTMLInputElement>(null);
  const pdfRef = useRef<HTMLInputElement>(null);
  const imgRef = useRef<HTMLInputElement>(null);
  const saveTimer = useRef<NodeJS.Timeout | null>(null);

  const [docs, setDocs] = useState<Doc[]>([]);
  const [selectedDoc, setSelectedDoc] = useState<Doc | null>(null);
  const [title, setTitle] = useState("Untitled document");
  const [saving, setSaving] = useState(false);
  const [importing, setImporting] = useState(false);
  const [contentVersion, setContentVersion] = useState(0);

  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Doc | null>(null);

  const [tab, setTab] = useState<Tab>("Home");
  const [zoom, setZoom] = useState(100);
  const [showTableModal, setShowTableModal] = useState(false);
  const [fmt, setFmt] = useState<Record<string, boolean>>({});
  const [font, setFont] = useState("Aptos");
  const [size, setSize] = useState(12);
  const [stats, setStats] = useState({ words: 0, chars: 0 });

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [docSearch, setDocSearch] = useState("");
  const [docSort, setDocSort] = useState<"recent" | "name">("recent");
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const dragStartX = useRef<number | null>(null);

  const pageCount = usePageCount(editorRef, contentVersion);

  /* ── Load docs ── */
  const loadDocs = useCallback(async () => {
    if (!profile) return;
    const { data } = await supabase.from("user_documents").select("*").eq("user_id", profile.id).order("updated_at", { ascending: false });
    setDocs((data ?? []) as Doc[]);
  }, [profile]);
  useEffect(() => { loadDocs(); }, [loadDocs]);

  const filteredSortedDocs = useMemo(() => {
    let list = docs;
    if (docSearch.trim()) { const q = docSearch.trim().toLowerCase(); list = list.filter(d => d.title.toLowerCase().includes(q)); }
    list = [...list];
    if (docSort === "name") list.sort((a, b) => a.title.localeCompare(b.title));
    else list.sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime());
    return list;
  }, [docs, docSearch, docSort]);

  /* ── Selection persistence ── */
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
      sel.removeAllRanges(); sel.addRange(savedRangeRef.current); return savedRangeRef.current;
    }
    const range = document.createRange();
    range.selectNodeContents(editor); range.collapse(false);
    sel.removeAllRanges(); sel.addRange(range);
    return range;
  };

  const updateStats = useCallback(() => {
    const el = editorRef.current;
    if (!el) return;
    const text = el.innerText.replace(/\u00a0/g, " ");
    const words = text.trim() ? text.trim().split(/\s+/).length : 0;
    setStats({ words, chars: text.replace(/\n/g, "").length });
  }, []);

  const syncFormatState = useCallback(() => {
    const q = (c: string) => { try { return document.queryCommandState(c); } catch { return false; } };
    setFmt({
      bold: q("bold"), italic: q("italic"), underline: q("underline"), strikeThrough: q("strikeThrough"),
      insertUnorderedList: q("insertUnorderedList"), insertOrderedList: q("insertOrderedList"),
      justifyLeft: q("justifyLeft"), justifyCenter: q("justifyCenter"), justifyRight: q("justifyRight"), justifyFull: q("justifyFull"),
    });
  }, []);

  /* ── Select / new / duplicate / rename doc ── */
  const selectDoc = (doc: Doc) => {
    setSelectedDoc(doc); setTitle(doc.title);
    requestAnimationFrame(() => {
      if (editorRef.current) { editorRef.current.innerHTML = doc.content || ""; editorRef.current.focus(); }
      updateStats(); setContentVersion(v => v + 1);
    });
  };
  const createNewDoc = async () => {
    if (!profile) return;
    const { data, error } = await supabase.from("user_documents").insert({ user_id: profile.id, title: "Untitled document", content: "<h1>Untitled document</h1><p><br></p>" }).select("*").single();
    if (error) return toast.error(error.message);
    toast.success("New document created!"); await loadDocs(); selectDoc(data as Doc);
  };
  const duplicateDoc = async (doc: Doc) => {
    if (!profile) return;
    const { data, error } = await supabase.from("user_documents").insert({ user_id: profile.id, title: doc.title + " (Copy)", content: doc.content }).select("*").single();
    if (error) return toast.error(error.message);
    toast.success("Document duplicated!"); await loadDocs(); selectDoc(data as Doc);
  };
  const startRename = (doc: Doc) => { setRenamingId(doc.id); setRenameValue(doc.title); };
  const commitRename = async (doc: Doc) => {
    const newTitle = renameValue.trim() || doc.title;
    setRenamingId(null);
    if (newTitle === doc.title) return;
    const { error } = await supabase.from("user_documents").update({ title: newTitle }).eq("id", doc.id);
    if (error) return toast.error(error.message);
    setDocs(prev => prev.map(d => d.id === doc.id ? { ...d, title: newTitle } : d));
    if (selectedDoc?.id === doc.id) setTitle(newTitle);
  };

  /* ── Save ── */
  const autoSave = useCallback(async () => {
    if (!selectedDoc || !profile) return;
    const content = editorRef.current?.innerHTML || "";
    const { error } = await supabase.from("user_documents").update({ title, content, updated_at: new Date().toISOString() }).eq("id", selectedDoc.id);
    if (!error) setDocs(prev => prev.map(d => d.id === selectedDoc.id ? { ...d, title, content } : d));
  }, [selectedDoc, title, profile]);
  const handleSaveNow = async () => { setSaving(true); await autoSave(); setSaving(false); toast.success("Saved!"); };
  const triggerSave = () => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(autoSave, 1200);
    updateStats(); setContentVersion(v => v + 1);
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    await supabase.from("user_documents").delete().eq("id", deleteTarget.id);
    toast.success("Deleted!"); setDeleteOpen(false); setDeleteTarget(null);
    if (selectedDoc?.id === deleteTarget.id) { setSelectedDoc(null); if (editorRef.current) editorRef.current.innerHTML = ""; }
    await loadDocs();
  };

  /* ── Format commands ── */
  const exec = (cmd: string, val?: string) => { restoreSelection(); document.execCommand(cmd, false, val); syncFormatState(); triggerSave(); };
  const insertHTML = (html: string) => { restoreSelection(); document.execCommand("insertHTML", false, html); triggerSave(); };
  const applyBlock = (tag: string) => { restoreSelection(); document.execCommand("formatBlock", false, `<${tag}>`); syncFormatState(); triggerSave(); };
  const applyStyleToSelection = (apply: (span: HTMLElement) => void) => {
    const editor = editorRef.current; if (!editor) return;
    restoreSelection();
    const sel = window.getSelection(); if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return;
    const range = sel.getRangeAt(0);
    const span = document.createElement("span"); apply(span);
    try {
      span.appendChild(range.extractContents()); range.insertNode(span);
      sel.removeAllRanges(); const r = document.createRange(); r.selectNodeContents(span); sel.addRange(r);
    } catch {}
    triggerSave();
  };

  const insertTable = (rows: number, cols: number) => {
    const th = Array.from({ length: cols }, (_, i) => `<th style="border:1.5px solid #9ca3af;padding:6px 10px;background:#f3f4f6;font-weight:600;">Header ${i + 1}</th>`).join("");
    const body = Array.from({ length: Math.max(0, rows - 1) }, () => `<tr>${Array.from({ length: cols }, () => `<td style="border:1.5px solid #9ca3af;padding:6px 10px;">&nbsp;</td>`).join("")}</tr>`).join("");
    insertHTML(`<table style="border-collapse:collapse;width:100%;margin:8px 0;"><tbody><tr>${th}</tr>${body}</tbody></table><p><br></p>`);
    setShowTableModal(false);
    toast.success("Table inserted!");
  };

  const insertLink = () => {
    const url = window.prompt("Link URL", "https://"); if (!url) return;
    const sel = window.getSelection();
    if (sel && sel.toString()) exec("createLink", url);
    else insertHTML(`<a href="${url}">${url}</a>`);
  };

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []); if (!files.length) return;
    restoreSelection();
    files.forEach(file => {
      const reader = new FileReader();
      reader.onload = ev => { insertHTML(`<img src="${ev.target?.result}" style="max-width:100%;height:auto;display:block;margin:8px 0;" />`); };
      reader.readAsDataURL(file);
    });
    e.target.value = "";
  };

  /* ── Table row/column "+" ── */
  const findTableAt = (node: Node | null): HTMLTableElement | null => {
    let el: Node | null = node;
    while (el) { if (el instanceof HTMLTableElement) return el; el = el.parentNode; }
    return null;
  };
  const [activeTable, setActiveTable] = useState<HTMLTableElement | null>(null);
  const updateActiveTable = () => {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) { setActiveTable(null); return; }
    setActiveTable(findTableAt(sel.getRangeAt(0).startContainer));
  };
  const addTableRow = (table: HTMLTableElement) => {
    const rows = Array.from(table.rows); if (!rows.length) return;
    const lastRow = rows[rows.length - 1];
    const newRow = document.createElement("tr");
    Array.from(lastRow.cells).forEach(cell => {
      const isTh = cell.tagName === "TH";
      const newCell = document.createElement(isTh ? "th" : "td");
      newCell.setAttribute("style", cell.getAttribute("style") || "");
      if (isTh) { newCell.style.background = "#ffffff"; newCell.style.fontWeight = "normal"; }
      newCell.innerHTML = "&nbsp;"; newRow.appendChild(newCell);
    });
    lastRow.after(newRow); triggerSave();
  };
  const addTableColumn = (table: HTMLTableElement) => {
    Array.from(table.rows).forEach(row => {
      const lastCell = row.cells[row.cells.length - 1]; if (!lastCell) return;
      const isTh = lastCell.tagName === "TH";
      const newCell = document.createElement(isTh ? "th" : "td");
      newCell.setAttribute("style", lastCell.getAttribute("style") || "");
      newCell.innerHTML = "&nbsp;"; lastCell.after(newCell);
    });
    triggerSave();
  };

  /* ── Word import — proper mammoth-based conversion, NOT raw text.
     The garbage "PK□□□□..." text happens when a .docx (which is actually
     a zip archive — "PK" is the zip file signature) gets read as plain
     text instead of being unzipped and converted by mammoth. This always
     routes through mammoth.convertToHtml, which properly unzips the
     .docx and extracts real formatted HTML — never raw bytes. ── */
  const handleWordUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []); if (!files.length) return;
    e.target.value = "";
    if (typeof mammoth === "undefined") { toast.error("Word converter not loaded — please refresh the page."); return; }

    setImporting(true);
    for (const file of files) {
      try {
        const buf = await file.arrayBuffer();
        const result = await mammoth.convertToHtml({ arrayBuffer: buf }, {
          styleMap: ["p[style-name='Heading 1'] => h1:fresh", "p[style-name='Heading 2'] => h2:fresh", "p[style-name='Heading 3'] => h3:fresh"],
        });
        const dom = new DOMParser().parseFromString(result.value, "text/html");
        cleanImportedDom(dom);

        const imgCount = dom.querySelectorAll("img").length;
        const textLen = (dom.body.textContent || "").trim().length;
        if (imgCount >= 5 && textLen < 2000) {
          toast("This document looks like it has a logo/letterhead built from positioned images — for a pixel-perfect match, export it as PDF from Word and use \"Import PDF\" instead.", { duration: 7000 });
        }

        const styledHtml = dom.body.innerHTML;
        const newTitle = file.name.replace(/\.docx?$/i, "");
        const { data, error } = await supabase.from("user_documents").insert({ user_id: profile?.id, title: newTitle, content: styledHtml }).select("*").single();
        if (error) throw error;
        await loadDocs(); selectDoc(data as Doc);
        toast.success(`"${newTitle}" imported!`);
      } catch (err: any) {
        toast.error(`Failed: "${file.name}" — ${err?.message || "Unknown error"}`);
      }
    }
    setImporting(false);
  };

  /* ── PDF import — renders real pixels via pdf.js, pixel-perfect but
     not text-editable (no HTML tool can guarantee both at once for
     documents with floating/positioned graphics — see prior chat). ── */
  const handlePdfUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []); if (!files.length) return;
    e.target.value = "";
    if (typeof pdfjsLib === "undefined") { toast.error("PDF renderer not loaded — please refresh the page."); return; }

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
          canvas.width = viewport.width; canvas.height = viewport.height;
          const ctx = canvas.getContext("2d")!;
          await page.render({ canvasContext: ctx, viewport }).promise;
          const dataUrl = canvas.toDataURL("image/jpeg", 0.92);
          pagesHtml += `<div class="pdf-page" style="page-break-after:always;margin:0 0 16px 0;"><img src="${dataUrl}" style="width:100%;display:block;" /></div>`;
        }
        const newTitle = file.name.replace(/\.pdf$/i, "");
        const { data, error } = await supabase.from("user_documents").insert({ user_id: profile?.id, title: newTitle, content: pagesHtml }).select("*").single();
        if (error) throw error;
        await loadDocs(); selectDoc(data as Doc);
        toast.success(`"${newTitle}" imported (${pdf.numPages} page${pdf.numPages > 1 ? "s" : ""})`);
      } catch (err: any) {
        toast.error(`Failed: "${file.name}" — ${err?.message || "Unknown error"}`);
      }
    }
    setImporting(false);
  };

  /* ── Export ── */
  const exportCSS = `body{font-family:${font};width:210mm;margin:0 auto;padding:25.4mm;line-height:1.5;font-size:${size}pt}
    h1{font-size:2em;font-weight:700;margin:.6em 0 .3em}h2{font-size:1.5em;font-weight:700;margin:.6em 0 .3em}h3{font-size:1.2em;font-weight:600;margin:.6em 0 .3em}
    p{margin:0 0 8pt 0}table{border-collapse:collapse;width:100%;margin:8px 0}td,th{border:1.5px solid #9ca3af;padding:6px 10px;vertical-align:top}
    th{background:#f3f4f6;font-weight:600}ul{list-style:disc;padding-left:1.5em}ol{list-style:decimal;padding-left:1.5em}img{max-width:100%;height:auto}
    .pdf-page{page-break-after:always}@media print{body{padding:10mm}}`;
  const fullHtml = (body: string) => `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>${title}</title><style>${exportCSS}</style></head><body>${body}</body></html>`;
  const dl = (content: string, type: string, name: string) => {
    Object.assign(document.createElement("a"), { href: URL.createObjectURL(new Blob([content], { type })), download: name }).click();
  };
  const printDoc = () => {
    const w = window.open("", "_blank"); if (!w) return;
    w.document.write(fullHtml(editorRef.current?.innerHTML || "")); w.document.close(); w.print();
  };

  const preserveSelection = (e: React.MouseEvent) => e.preventDefault();

  /* ── Ribbon content per tab ── */
  const ribbon = () => {
    switch (tab) {
      case "File":
        return (
          <>
            <RGroup label="Document">
              <RBtn title="New document" wide onClick={createNewDoc}>New</RBtn>
              <RBtn title="Import Word" wide onClick={() => wordRef.current?.click()}>Import Word</RBtn>
              <RBtn title="Import PDF" wide onClick={() => pdfRef.current?.click()}>Import PDF</RBtn>
              <RBtn title="Save now" wide onClick={handleSaveNow}>{saving ? "Saving…" : "Save"}</RBtn>
            </RGroup>
            <RGroup label="Export">
              <RBtn title="Download HTML" wide onClick={() => dl(fullHtml(editorRef.current?.innerHTML || ""), "text/html", `${title}.html`)}>HTML</RBtn>
              <RBtn title="Print / Save as PDF" wide onClick={printDoc}>Print / PDF</RBtn>
              <RBtn title="Download TXT" wide onClick={() => dl(editorRef.current?.innerText || "", "text/plain", `${title}.txt`)}>TXT</RBtn>
            </RGroup>
            <RGroup label="Info">
              <span className="px-2 text-xs text-white/50">{stats.words} words · {stats.chars} characters · {pageCount} page{pageCount > 1 ? "s" : ""}</span>
            </RGroup>
          </>
        );
      case "Home":
        return (
          <>
            <RGroup label="Undo">
              <RBtn title="Undo" onClick={() => exec("undo")}>↶</RBtn>
              <RBtn title="Redo" onClick={() => exec("redo")}>↷</RBtn>
            </RGroup>
            <RGroup label="Font">
              <select value={font} onMouseDown={preserveSelection} onChange={e => { setFont(e.target.value); exec("fontName", e.target.value); }} className="h-8 rounded border border-white/15 bg-white/5 px-1 text-xs text-white">
                {FONTS.map(f => <option key={f} value={f} className="bg-[#252525]">{f}</option>)}
              </select>
              <select value={size} onMouseDown={preserveSelection} onChange={e => { const px = Number(e.target.value); setSize(px); applyStyleToSelection(s => s.style.fontSize = `${px}pt`); }} className="h-8 w-14 rounded border border-white/15 bg-white/5 px-1 text-xs text-white">
                {SIZES.map(s => <option key={s} value={s} className="bg-[#252525]">{s}</option>)}
              </select>
              <RBtn title="Bold" active={fmt.bold} onClick={() => exec("bold")}><b>B</b></RBtn>
              <RBtn title="Italic" active={fmt.italic} onClick={() => exec("italic")}><i>I</i></RBtn>
              <RBtn title="Underline" active={fmt.underline} onClick={() => exec("underline")}><u>U</u></RBtn>
              <RBtn title="Strikethrough" active={fmt.strikeThrough} onClick={() => exec("strikeThrough")}><s>S</s></RBtn>
              <RPopover title="Text color" label={<span className="text-red-500">A</span>}>
                {close => (<div className="grid grid-cols-5 gap-1">{COLORS.map(c => (
                  <button key={c} onMouseDown={preserveSelection} onClick={() => { exec("foreColor", c); close(); }} className="h-6 w-6 rounded border border-white/20" style={{ background: c }} />
                ))}</div>)}
              </RPopover>
              <RPopover title="Highlight" label={<span className="rounded bg-yellow-300/80 px-1 text-black">H</span>}>
                {close => (<div className="grid grid-cols-4 gap-1">{HIGHLIGHTS.map(c => (
                  <button key={c} onMouseDown={preserveSelection} onClick={() => { exec("hiliteColor", c); close(); }} className="h-6 w-6 rounded border border-white/20" style={{ background: c === "transparent" ? "#fff" : c }} />
                ))}</div>)}
              </RPopover>
              <RBtn title="Clear formatting" onClick={() => exec("removeFormat")}>⌫A</RBtn>
            </RGroup>
            <RGroup label="Paragraph">
              <RBtn title="Bullet list" active={fmt.insertUnorderedList} onClick={() => exec("insertUnorderedList")}>•</RBtn>
              <RBtn title="Numbered list" active={fmt.insertOrderedList} onClick={() => exec("insertOrderedList")}>1.</RBtn>
              <RBtn title="Align left" active={fmt.justifyLeft} onClick={() => exec("justifyLeft")}>≡</RBtn>
              <RBtn title="Align center" active={fmt.justifyCenter} onClick={() => exec("justifyCenter")}>⋮≡</RBtn>
              <RBtn title="Align right" active={fmt.justifyRight} onClick={() => exec("justifyRight")}>≡⋮</RBtn>
              <RBtn title="Justify" active={fmt.justifyFull} onClick={() => exec("justifyFull")}>▤</RBtn>
            </RGroup>
            <RGroup label="Styles">
              {[["Normal", "p"], ["H1", "h1"], ["H2", "h2"], ["H3", "h3"]].map(([label, block]) => (
                <RBtn key={block} title={`${label} style`} wide onClick={() => applyBlock(block)}>{label}</RBtn>
              ))}
            </RGroup>
          </>
        );
      case "Insert":
        return (
          <>
            <RGroup label="Tables">
              <RBtn title="Insert table" wide onClick={() => { restoreSelection(); setShowTableModal(true); }}>Table</RBtn>
              {activeTable && (
                <>
                  <RBtn title="Add row" wide onClick={() => addTableRow(activeTable)}>+ Row</RBtn>
                  <RBtn title="Add column" wide onClick={() => addTableColumn(activeTable)}>+ Column</RBtn>
                </>
              )}
            </RGroup>
            <RGroup label="Illustrations">
              <RBtn title="Insert image" wide onClick={() => imgRef.current?.click()}>Picture</RBtn>
            </RGroup>
            <RGroup label="Links">
              <RBtn title="Insert link" wide onClick={insertLink}>Link</RBtn>
              <RBtn title="Remove link" wide onClick={() => exec("unlink")}>Unlink</RBtn>
            </RGroup>
            <RGroup label="Text">
              <RBtn title="Page break" wide onClick={() => insertHTML('<div style="page-break-after:always;"></div>')}>Page break</RBtn>
            </RGroup>
          </>
        );
      case "Layout":
        return (
          <RGroup label="Zoom">
            <RBtn title="Zoom out" onClick={() => setZoom(z => Math.max(50, z - 10))}>−</RBtn>
            <span className="w-12 text-center text-xs text-white/60">{zoom}%</span>
            <RBtn title="Zoom in" onClick={() => setZoom(z => Math.min(200, z + 10))}>+</RBtn>
            <RBtn title="Reset zoom" wide onClick={() => setZoom(100)}>100%</RBtn>
          </RGroup>
        );
      case "Review":
        return (
          <RGroup label="Info">
            <span className="px-2 text-xs text-white/50">{stats.words} words · {pageCount} page{pageCount > 1 ? "s" : ""}</span>
          </RGroup>
        );
      case "View":
        return (
          <RGroup label="Zoom">
            <RBtn title="Zoom out" onClick={() => setZoom(z => Math.max(50, z - 10))}>−</RBtn>
            <span className="w-12 text-center text-xs text-white/60">{zoom}%</span>
            <RBtn title="Zoom in" onClick={() => setZoom(z => Math.min(200, z + 10))}>+</RBtn>
          </RGroup>
        );
    }
  };

  return (
    <div className="flex h-[calc(100vh-56px)] overflow-hidden bg-[#1e1e1e] text-white">
      {showTableModal && <InsertTableModal onInsert={insertTable} onClose={() => setShowTableModal(false)} />}

      {deleteOpen && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60" onClick={() => setDeleteOpen(false)}>
          <div className="w-80 rounded-lg border border-white/10 bg-[#252525] p-4 text-white" onClick={e => e.stopPropagation()}>
            <h3 className="mb-2 text-sm font-semibold">Delete Document?</h3>
            <p className="mb-4 text-xs text-white/60">"{deleteTarget?.title}" will be permanently deleted.</p>
            <div className="flex justify-end gap-2">
              <button onClick={() => setDeleteOpen(false)} className="rounded border border-white/20 px-3 py-1.5 text-sm hover:bg-white/10">Cancel</button>
              <button onClick={handleDelete} className="rounded bg-red-600 px-3 py-1.5 text-sm font-medium hover:bg-red-500">Delete</button>
            </div>
          </div>
        </div>
      )}

      <input ref={wordRef} type="file" accept=".doc,.docx" multiple className="hidden" onChange={handleWordUpload} />
      <input ref={pdfRef} type="file" accept=".pdf" multiple className="hidden" onChange={handlePdfUpload} />
      <input ref={imgRef} type="file" accept="image/*" multiple className="hidden" onChange={handleImageUpload} />

      {/* Drawer tab */}
      <div onClick={() => setDrawerOpen(o => !o)}
        onPointerDown={e => { dragStartX.current = e.clientX; }}
        onPointerMove={e => { if (dragStartX.current !== null && e.clientX - dragStartX.current > 24) { setDrawerOpen(true); dragStartX.current = null; } }}
        onPointerUp={() => { dragStartX.current = null; }}
        className="fixed left-0 top-1/2 z-40 flex h-16 w-4 -translate-y-1/2 cursor-grab items-center justify-center rounded-r-lg bg-blue-600/90 shadow-md transition-colors hover:bg-blue-600 active:cursor-grabbing"
        title="Documents">
        <ChevronRight className={cn("h-4 w-4 text-white transition-transform", drawerOpen && "rotate-180")} />
      </div>
      {drawerOpen && <div className="fixed inset-0 z-30 bg-black/40" onClick={() => setDrawerOpen(false)} />}
      <div className={cn("fixed left-0 top-0 z-40 flex h-full w-72 flex-col border-r border-white/10 bg-[#232323] text-white shadow-2xl transition-transform duration-200", drawerOpen ? "translate-x-0" : "-translate-x-full")}>
        <div className="space-y-2 border-b border-white/10 p-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold">Documents</h3>
            <button onClick={() => setDrawerOpen(false)} className="rounded p-1 hover:bg-white/10"><X className="h-4 w-4" /></button>
          </div>
          <div className="flex gap-1.5">
            <button onClick={() => { createNewDoc(); setDrawerOpen(false); }} className="flex h-7 flex-1 items-center justify-center gap-1 rounded bg-blue-600 text-xs hover:bg-blue-500"><Plus className="h-3.5 w-3.5" />New</button>
            <button onClick={() => wordRef.current?.click()} disabled={importing} className="flex h-7 flex-1 items-center justify-center gap-1 rounded border border-white/15 text-xs hover:bg-white/10"><Upload className="h-3.5 w-3.5" />Word</button>
            <button onClick={() => pdfRef.current?.click()} disabled={importing} className="flex h-7 flex-1 items-center justify-center gap-1 rounded border border-white/15 text-xs hover:bg-white/10"><FileUp className="h-3.5 w-3.5" />PDF</button>
          </div>
          <div className="relative">
            <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-white/40" />
            <Input value={docSearch} onChange={e => setDocSearch(e.target.value)} placeholder="Search documents…" className="h-7 border-white/15 bg-white/5 pl-7 text-xs text-white placeholder:text-white/40" />
          </div>
          <button onClick={() => setDocSort(s => s === "recent" ? "name" : "recent")} className="flex items-center gap-1 text-xs text-white/50 hover:text-white">
            <ArrowUpDown className="h-3 w-3" /> Sort: {docSort === "recent" ? "Recent" : "Name"}
          </button>
        </div>
        <div className="flex-1 space-y-0.5 overflow-y-auto p-2">
          {filteredSortedDocs.length === 0 && <p className="py-6 text-center text-xs text-white/40">{docSearch ? "No documents match your search" : "No documents yet"}</p>}
          {filteredSortedDocs.map(doc => (
            <div key={doc.id} onClick={() => { selectDoc(doc); setDrawerOpen(false); }}
              className={cn("group flex cursor-pointer items-center justify-between rounded-lg px-2 py-1.5 transition-colors", selectedDoc?.id === doc.id ? "bg-blue-600/20 text-blue-300" : "hover:bg-white/5")}>
              <div className="flex min-w-0 flex-1 items-center gap-1.5">
                <FileText className="h-3.5 w-3.5 shrink-0" />
                {renamingId === doc.id ? (
                  <Input autoFocus value={renameValue} onClick={e => e.stopPropagation()} onChange={e => setRenameValue(e.target.value)}
                    onBlur={() => commitRename(doc)} onKeyDown={e => { if (e.key === "Enter") commitRename(doc); if (e.key === "Escape") setRenamingId(null); }}
                    className="h-6 border-white/15 bg-white/5 px-1 text-xs text-white" />
                ) : <span className="truncate text-xs">{doc.title}</span>}
              </div>
              <div className="flex shrink-0 items-center opacity-0 group-hover:opacity-100">
                <button onClick={e => { e.stopPropagation(); startRename(doc); }} className="rounded p-1 hover:bg-white/10" title="Rename"><Pencil className="h-3 w-3" /></button>
                <button onClick={e => { e.stopPropagation(); duplicateDoc(doc); }} className="rounded p-1 hover:bg-white/10" title="Duplicate"><Copy className="h-3 w-3" /></button>
                <button onClick={e => { e.stopPropagation(); setDeleteTarget(doc); setDeleteOpen(true); }} className="rounded p-1 hover:bg-red-500/20" title="Delete"><Trash2 className="h-3 w-3 text-red-400" /></button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Main column */}
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        {/* Title bar */}
        <div className="flex items-center gap-3 border-b border-white/10 bg-[#232323] px-4 py-2">
          <span className="rounded bg-blue-600 px-2 py-0.5 text-xs font-bold">W</span>
          {selectedDoc ? (
            <Input value={title} onChange={e => setTitle(e.target.value)} onBlur={handleSaveNow}
              className="h-7 min-w-0 flex-1 border-transparent bg-transparent px-2 text-sm font-medium text-white focus-visible:ring-0" placeholder="Document title…" />
          ) : <span className="flex-1 text-sm text-white/50">No document open</span>}
          <span className="hidden text-xs text-white/40 sm:inline">{saving ? "Saving…" : "Autosaved"}</span>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 border-b border-white/10 bg-[#232323] px-3">
          {TABS.map(t => (
            <button key={t} onClick={() => setTab(t)} className={cn("px-3 py-2 text-sm transition-colors", tab === t ? "border-b-2 border-blue-500 font-medium text-white" : "text-white/50 hover:text-white")}>
              {t}
            </button>
          ))}
        </div>

        {/* Ribbon */}
        <div className="sticky top-0 z-30 flex items-stretch gap-1 overflow-x-auto border-b border-white/10 bg-[#2b2b2b] px-2 py-1">
          {ribbon()}
        </div>

        {/* Page area */}
        {selectedDoc ? (
          <div className="flex-1 overflow-y-auto bg-[#0f0f0f] py-8">
            <style>{`
              .ld-editor{outline:none;line-height:1.5;color:#111;}
              .ld-editor:empty:before{content:"Start typing here…";color:#9ca3af;pointer-events:none;}
              .ld-editor h1{font-size:2em;font-weight:700;margin:.6em 0 .3em;}
              .ld-editor h2{font-size:1.5em;font-weight:700;margin:.6em 0 .3em;}
              .ld-editor h3{font-size:1.2em;font-weight:600;margin:.6em 0 .3em;}
              .ld-editor ul{list-style:disc !important;padding-left:1.6em !important;margin:4px 0;}
              .ld-editor ol{list-style:decimal !important;padding-left:1.6em !important;margin:4px 0;}
              .ld-editor li{display:list-item !important;margin:2px 0;}
              .ld-editor table{border-collapse:collapse;width:100%;margin:8px 0;}
              .ld-editor td,.ld-editor th{border:1.5px solid #9ca3af;padding:6px 10px;vertical-align:top;min-width:40px;word-break:break-word;}
              .ld-editor th{background:#f3f4f6;font-weight:600;}
              .ld-editor img{max-width:100%;height:auto;display:block;margin:8px 0;}
              .ld-editor a{color:#2563eb;text-decoration:underline;}
              .ld-editor p{margin:0 0 8pt 0;min-height:1.4em;}
            `}</style>

            <div style={{ display: "flex", justifyContent: "center", transform: `scale(${zoom / 100})`, transformOrigin: "top center" }}>
              <div style={{
                background: "#ffffff", width: PAGE_W_PX, minHeight: PAGE_H_PX, padding: PAGE_PAD_PX,
                boxShadow: "0 1px 6px rgba(0,0,0,0.4)", fontFamily: font, fontSize: size + "pt", boxSizing: "border-box",
              }}>
                <div
                  ref={editorRef}
                  contentEditable suppressContentEditableWarning
                  className="ld-editor"
                  onInput={triggerSave}
                  onKeyUp={() => { syncFormatState(); updateActiveTable(); }}
                  onMouseUp={() => { syncFormatState(); updateActiveTable(); }}
                  onClick={updateActiveTable}
                />
              </div>
            </div>

            {pageCount > 1 && (
              <div className="mx-auto mt-4 flex justify-center gap-2" style={{ width: PAGE_W_PX * (zoom / 100) }}>
                {Array.from({ length: pageCount }, (_, i) => (
                  <div key={i} className="rounded border border-white/10 bg-white/5 px-2 py-1 text-[10px] text-white/40">Page {i + 1} of {pageCount}</div>
                ))}
              </div>
            )}
          </div>
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center bg-[#0f0f0f] p-8 text-center">
            <FileText className="mb-4 h-16 w-16 text-white/20" />
            <h2 className="mb-2 text-xl font-semibold text-white">No document selected</h2>
            <p className="mb-6 text-sm text-white/50">Drag the arrow on the left edge to open your documents, or start a new one</p>
            <div className="flex flex-wrap justify-center gap-3">
              <button onClick={createNewDoc} className="flex items-center gap-2 rounded bg-blue-600 px-4 py-2 text-sm font-medium hover:bg-blue-500"><Plus className="h-4 w-4" />New Document</button>
              <button onClick={() => wordRef.current?.click()} className="flex items-center gap-2 rounded border border-white/15 px-4 py-2 text-sm hover:bg-white/10"><Upload className="h-4 w-4" />Import Word</button>
              <button onClick={() => pdfRef.current?.click()} className="flex items-center gap-2 rounded border border-white/15 px-4 py-2 text-sm hover:bg-white/10"><FileUp className="h-4 w-4" />Import PDF</button>
            </div>
          </div>
        )}

        {/* Status bar */}
        <div className="sticky bottom-0 flex flex-wrap items-center gap-4 border-t border-white/10 bg-[#232323] px-4 py-1.5 text-xs text-white/50">
          <span>{stats.words} words</span>
          <span>{stats.chars} characters</span>
          <span>{pageCount} page{pageCount > 1 ? "s" : ""}</span>
          <span className="ml-auto">{zoom}%</span>
        </div>
      </div>
    </div>
  );
}
