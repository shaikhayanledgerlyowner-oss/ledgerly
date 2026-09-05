import { useCallback, useEffect, useRef, useState } from "react";
import { renderAsync } from "docx-preview";
import { saveAs } from "file-saver";
import { toast } from "sonner";
import {
  Bold, Italic, Underline, Strikethrough, AlignLeft, AlignCenter, AlignRight,
  AlignJustify, List, ListOrdered, Indent, Outdent, Undo2, Redo2, Table2,
  Image as ImageIcon, Upload, Download, Printer, FilePlus2, Rows3, Columns3,
  Trash2, ZoomIn, ZoomOut, Type, Highlighter, Superscript, Subscript, Eraser,
} from "lucide-react";

/* ------------------------------------------------------------------ */
/*  Word-like Document Editor                                          */
/*  - Imports .docx with full fidelity (docx-preview) and lets you     */
/*    edit it directly on the page (tables, images, styles preserved)  */
/*  - Multi-page documents supported                                   */
/*  - Exports back to Word (.doc, opens in MS Word/Google Docs)        */
/*  - Print / Save as PDF via browser print dialog                     */
/* ------------------------------------------------------------------ */

const FONTS = [
  "Calibri", "Arial", "Times New Roman", "Georgia", "Verdana",
  "Tahoma", "Courier New", "Cambria", "Garamond", "Trebuchet MS",
];
const SIZES = ["8", "9", "10", "11", "12", "14", "16", "18", "20", "24", "28", "36", "48", "72"];
// execCommand fontSize only accepts 1-7, so we post-process with inline styles.
const SIZE_MAP: Record<string, string> = {
  "8": "1", "9": "1", "10": "2", "11": "2", "12": "3", "14": "4", "16": "4",
  "18": "5", "20": "5", "24": "6", "28": "6", "36": "7", "48": "7", "72": "7",
};

const A4_WIDTH_PX = 794;   // 210mm @96dpi
const A4_HEIGHT_PX = 1123; // 297mm @96dpi

const BLANK_PAGE_HTML = `<p><br/></p>`;

export default function DocumentEditorPage() {
  const editorRef = useRef<HTMLDivElement | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const imageRef = useRef<HTMLInputElement | null>(null);
  const [fileName, setFileName] = useState("Untitled document");
  const [zoom, setZoom] = useState(100);
  const [font, setFont] = useState("Calibri");
  const [size, setSize] = useState("11");
  const [loading, setLoading] = useState(false);
  const [dirty, setDirty] = useState(false);

  /* ---------------- editor helpers ---------------- */

  const focusEditor = () => editorRef.current?.focus();

  const exec = useCallback((cmd: string, value?: string) => {
    focusEditor();
    document.execCommand(cmd, false, value);
    setDirty(true);
  }, []);

  const applyFontSize = useCallback((pt: string) => {
    setSize(pt);
    focusEditor();
    document.execCommand("fontSize", false, SIZE_MAP[pt] ?? "3");
    // Replace the <font size="x"> wrappers with real pt sizes
    editorRef.current?.querySelectorAll("font[size]").forEach((el) => {
      const span = document.createElement("span");
      span.style.fontSize = `${pt}pt`;
      span.innerHTML = (el as HTMLElement).innerHTML;
      el.replaceWith(span);
    });
    setDirty(true);
  }, []);

  const applyFont = useCallback((f: string) => {
    setFont(f);
    exec("fontName", f);
  }, [exec]);

  /* ---------------- import .docx ---------------- */

  const importDocx = async (file: File) => {
    if (!/\.docx?$/i.test(file.name)) {
      toast.error("Please choose a Word file (.docx)");
      return;
    }
    if (!editorRef.current) return;
    setLoading(true);
    try {
      const buffer = await file.arrayBuffer();
      const holder = document.createElement("div");
      await renderAsync(buffer, holder, undefined, {
        className: "docx",
        inWrapper: true,
        ignoreWidth: false,
        ignoreHeight: true,      // let pages grow so nothing is cut off
        ignoreFonts: false,
        breakPages: true,        // keep real page breaks (multi-page files)
        renderHeaders: true,
        renderFooters: true,
        renderFootnotes: true,
        renderEndnotes: true,
        useBase64URL: true,      // keeps images alive after edit/export
      });
      editorRef.current.innerHTML = holder.innerHTML;
      setFileName(file.name.replace(/\.docx?$/i, ""));
      setDirty(false);
      toast.success("Word file loaded — you can edit it like in Word");
    } catch (e) {
      console.error(e);
      toast.error("Could not read this Word file");
    } finally {
      setLoading(false);
    }
  };

  /* ---------------- export ---------------- */

  const collectStyles = () =>
    Array.from(document.querySelectorAll("style"))
      .map((s) => s.innerHTML)
      .join("\n");

  const exportWord = () => {
    if (!editorRef.current) return;
    const html = `<!DOCTYPE html>
<html xmlns:o="urn:schemas-microsoft-com:office:office"
      xmlns:w="urn:schemas-microsoft-com:office:word"
      xmlns="http://www.w3.org/TR/REC-html40">
<head><meta charset="utf-8"><title>${fileName}</title>
<style>
@page { size: A4; margin: 2cm; }
body { font-family: Calibri, sans-serif; font-size: 11pt; }
table { border-collapse: collapse; }
td, th { border: 1px solid #000; padding: 4px 6px; vertical-align: top; }
${collectStyles()}
</style></head>
<body>${editorRef.current.innerHTML}</body></html>`;
    saveAs(new Blob(["\ufeff", html], { type: "application/msword" }), `${fileName}.doc`);
    toast.success("Downloaded — opens directly in Microsoft Word");
  };

  const printDoc = () => {
    if (!editorRef.current) return;
    const w = window.open("", "_blank", "width=900,height=1000");
    if (!w) return;
    w.document.write(`<html><head><title>${fileName}</title>
<style>@page{size:A4;margin:0}body{margin:0}
${collectStyles()}
.page{padding:2cm;box-sizing:border-box}
table{border-collapse:collapse}td,th{border:1px solid #000;padding:4px 6px}
</style></head><body>${editorRef.current.innerHTML}</body></html>`);
    w.document.close();
    w.focus();
    setTimeout(() => w.print(), 400);
  };

  /* ---------------- insert helpers ---------------- */

  const insertTable = () => {
    const rows = Number(window.prompt("Rows?", "3") || 0);
    const cols = Number(window.prompt("Columns?", "3") || 0);
    if (!rows || !cols) return;
    let html = `<table style="border-collapse:collapse;width:100%;margin:8px 0">`;
    for (let r = 0; r < rows; r++) {
      html += "<tr>";
      for (let c = 0; c < cols; c++)
        html += `<td style="border:1px solid #000;padding:4px 6px;min-width:40px">&nbsp;</td>`;
      html += "</tr>";
    }
    html += "</table><p><br/></p>";
    exec("insertHTML", html);
  };

  const currentCell = (): HTMLTableCellElement | null => {
    const sel = window.getSelection();
    if (!sel || !sel.anchorNode) return null;
    let n: Node | null = sel.anchorNode;
    while (n && n !== editorRef.current) {
      if ((n as HTMLElement).tagName === "TD" || (n as HTMLElement).tagName === "TH")
        return n as HTMLTableCellElement;
      n = n.parentNode;
    }
    return null;
  };

  const tableOp = (op: "row+" | "row-" | "col+" | "col-" | "del") => {
    const cell = currentCell();
    if (!cell) { toast.error("Click inside a table cell first"); return; }
    const row = cell.parentElement as HTMLTableRowElement;
    const table = row.closest("table") as HTMLTableElement;
    const idx = cell.cellIndex;
    if (op === "row+") {
      const nr = row.cloneNode(true) as HTMLTableRowElement;
      Array.from(nr.cells).forEach((c) => (c.innerHTML = "&nbsp;"));
      row.after(nr);
    } else if (op === "row-") {
      if (table.rows.length > 1) row.remove();
    } else if (op === "col+") {
      Array.from(table.rows).forEach((r) => {
        const c = r.insertCell(Math.min(idx + 1, r.cells.length));
        c.style.border = "1px solid #000";
        c.style.padding = "4px 6px";
        c.innerHTML = "&nbsp;";
      });
    } else if (op === "col-") {
      Array.from(table.rows).forEach((r) => { if (r.cells[idx]) r.deleteCell(idx); });
    } else {
      table.remove();
    }
    setDirty(true);
  };

  const insertImage = async (file: File) => {
    const dataUrl = await new Promise<string>((res) => {
      const fr = new FileReader();
      fr.onload = () => res(String(fr.result));
      fr.readAsDataURL(file);
    });
    exec("insertHTML", `<img src="${dataUrl}" style="max-width:100%" />`);
  };

  const newDocument = () => {
    if (dirty && !window.confirm("Discard unsaved changes?")) return;
    if (editorRef.current) editorRef.current.innerHTML = `<div class="page">${BLANK_PAGE_HTML}</div>`;
    setFileName("Untitled document");
    setDirty(false);
  };

  /* ---------------- shortcuts ---------------- */

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      const k = e.key.toLowerCase();
      if (k === "s") { e.preventDefault(); exportWord(); }
      if (k === "p") { e.preventDefault(); printDoc(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  useEffect(() => {
    if (editorRef.current && !editorRef.current.innerHTML.trim())
      editorRef.current.innerHTML = `<div class="page">${BLANK_PAGE_HTML}</div>`;
  }, []);

  /* ---------------- UI ---------------- */

  const Btn = ({ onClick, title, children, active = false }: any) => (
    <button
      type="button"
      title={title}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className={`h-8 min-w-8 px-2 inline-flex items-center justify-center rounded text-gray-700 hover:bg-gray-200 transition ${
        active ? "bg-gray-200" : ""
      }`}
    >
      {children}
    </button>
  );

  const Sep = () => <span className="mx-1 h-6 w-px bg-gray-300" />;

  return (
    <div className="flex flex-col h-[calc(100vh-4rem)] bg-[#f3f3f3]">
      {/* Title bar */}
      <div className="flex items-center gap-3 px-4 py-2 bg-white border-b">
        <input
          value={fileName}
          onChange={(e) => setFileName(e.target.value)}
          className="text-sm font-medium bg-transparent outline-none border-b border-transparent focus:border-gray-300 px-1"
        />
        {dirty && <span className="text-xs text-gray-400">unsaved</span>}
        <div className="ml-auto flex items-center gap-2">
          <button onClick={() => fileRef.current?.click()}
            className="inline-flex items-center gap-1.5 h-8 px-3 rounded bg-gray-100 hover:bg-gray-200 text-sm">
            <Upload className="h-4 w-4" /> Import Word
          </button>
          <button onClick={exportWord}
            className="inline-flex items-center gap-1.5 h-8 px-3 rounded bg-[#2b579a] text-white hover:bg-[#1e3f70] text-sm">
            <Download className="h-4 w-4" /> Save as Word
          </button>
          <button onClick={printDoc}
            className="inline-flex items-center gap-1.5 h-8 px-3 rounded bg-gray-100 hover:bg-gray-200 text-sm">
            <Printer className="h-4 w-4" /> Print / PDF
          </button>
        </div>
      </div>

      {/* Ribbon */}
      <div className="flex flex-wrap items-center gap-1 px-3 py-2 bg-white border-b shadow-sm">
        <Btn title="New" onClick={newDocument}><FilePlus2 className="h-4 w-4" /></Btn>
        <Btn title="Undo (Ctrl+Z)" onClick={() => exec("undo")}><Undo2 className="h-4 w-4" /></Btn>
        <Btn title="Redo (Ctrl+Y)" onClick={() => exec("redo")}><Redo2 className="h-4 w-4" /></Btn>
        <Sep />
        <select value={font} onChange={(e) => applyFont(e.target.value)}
          className="h-8 rounded border border-gray-300 text-sm px-2 bg-white">
          {FONTS.map((f) => <option key={f} value={f} style={{ fontFamily: f }}>{f}</option>)}
        </select>
        <select value={size} onChange={(e) => applyFontSize(e.target.value)}
          className="h-8 w-16 rounded border border-gray-300 text-sm px-2 bg-white">
          {SIZES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <Sep />
        <Btn title="Bold (Ctrl+B)" onClick={() => exec("bold")}><Bold className="h-4 w-4" /></Btn>
        <Btn title="Italic" onClick={() => exec("italic")}><Italic className="h-4 w-4" /></Btn>
        <Btn title="Underline" onClick={() => exec("underline")}><Underline className="h-4 w-4" /></Btn>
        <Btn title="Strikethrough" onClick={() => exec("strikeThrough")}><Strikethrough className="h-4 w-4" /></Btn>
        <Btn title="Superscript" onClick={() => exec("superscript")}><Superscript className="h-4 w-4" /></Btn>
        <Btn title="Subscript" onClick={() => exec("subscript")}><Subscript className="h-4 w-4" /></Btn>
        <Sep />
        <label title="Text colour" className="h-8 px-1 inline-flex items-center rounded hover:bg-gray-200 cursor-pointer">
          <Type className="h-4 w-4" />
          <input type="color" className="w-5 h-5 ml-1 border-0 bg-transparent p-0 cursor-pointer"
            onChange={(e) => exec("foreColor", e.target.value)} />
        </label>
        <label title="Highlight" className="h-8 px-1 inline-flex items-center rounded hover:bg-gray-200 cursor-pointer">
          <Highlighter className="h-4 w-4" />
          <input type="color" defaultValue="#ffff00" className="w-5 h-5 ml-1 border-0 bg-transparent p-0 cursor-pointer"
            onChange={(e) => exec("hiliteColor", e.target.value)} />
        </label>
        <Btn title="Clear formatting" onClick={() => exec("removeFormat")}><Eraser className="h-4 w-4" /></Btn>
        <Sep />
        <Btn title="Align left" onClick={() => exec("justifyLeft")}><AlignLeft className="h-4 w-4" /></Btn>
        <Btn title="Center" onClick={() => exec("justifyCenter")}><AlignCenter className="h-4 w-4" /></Btn>
        <Btn title="Align right" onClick={() => exec("justifyRight")}><AlignRight className="h-4 w-4" /></Btn>
        <Btn title="Justify" onClick={() => exec("justifyFull")}><AlignJustify className="h-4 w-4" /></Btn>
        <Btn title="Bullets" onClick={() => exec("insertUnorderedList")}><List className="h-4 w-4" /></Btn>
        <Btn title="Numbering" onClick={() => exec("insertOrderedList")}><ListOrdered className="h-4 w-4" /></Btn>
        <Btn title="Decrease indent" onClick={() => exec("outdent")}><Outdent className="h-4 w-4" /></Btn>
        <Btn title="Increase indent" onClick={() => exec("indent")}><Indent className="h-4 w-4" /></Btn>
        <Sep />
        <Btn title="Insert table" onClick={insertTable}><Table2 className="h-4 w-4" /></Btn>
        <Btn title="Add row" onClick={() => tableOp("row+")}><Rows3 className="h-4 w-4" /></Btn>
        <Btn title="Add column" onClick={() => tableOp("col+")}><Columns3 className="h-4 w-4" /></Btn>
        <Btn title="Delete row" onClick={() => tableOp("row-")}><Rows3 className="h-4 w-4 text-red-500" /></Btn>
        <Btn title="Delete column" onClick={() => tableOp("col-")}><Columns3 className="h-4 w-4 text-red-500" /></Btn>
        <Btn title="Delete table" onClick={() => tableOp("del")}><Trash2 className="h-4 w-4 text-red-500" /></Btn>
        <Sep />
        <Btn title="Insert image" onClick={() => imageRef.current?.click()}><ImageIcon className="h-4 w-4" /></Btn>
        <Btn title="Page break" onClick={() => exec("insertHTML",
          `<div style="page-break-before:always;border-top:1px dashed #bbb;margin:16px 0"></div><p><br/></p>`)}>
          <span className="text-xs px-1">Break</span>
        </Btn>
        <Sep />
        <Btn title="Zoom out" onClick={() => setZoom((z) => Math.max(50, z - 10))}><ZoomOut className="h-4 w-4" /></Btn>
        <span className="text-xs w-10 text-center">{zoom}%</span>
        <Btn title="Zoom in" onClick={() => setZoom((z) => Math.min(200, z + 10))}><ZoomIn className="h-4 w-4" /></Btn>
      </div>

      {/* Canvas */}
      <div className="flex-1 overflow-auto py-8">
        <div style={{ transform: `scale(${zoom / 100})`, transformOrigin: "top center" }}>
          <div
            ref={editorRef}
            contentEditable
            suppressContentEditableWarning
            spellCheck={false}
            onInput={() => setDirty(true)}
            className="doc-surface mx-auto outline-none"
            style={{ width: A4_WIDTH_PX, minHeight: A4_HEIGHT_PX }}
          />
        </div>
        {loading && <p className="text-center text-sm text-gray-500 mt-4">Opening document…</p>}
      </div>

      <input ref={fileRef} type="file" accept=".docx,.doc" hidden
        onChange={(e) => { const f = e.target.files?.[0]; if (f) importDocx(f); e.target.value = ""; }} />
      <input ref={imageRef} type="file" accept="image/*" hidden
        onChange={(e) => { const f = e.target.files?.[0]; if (f) insertImage(f); e.target.value = ""; }} />

      {/* Word-like page styling */}
      <style>{`
        .doc-surface { background: transparent; }
        .doc-surface .docx-wrapper { background: transparent !important; padding: 0 !important; }
        .doc-surface .docx-wrapper > section.docx,
        .doc-surface .page,
        .doc-surface > section {
          background: #fff;
          box-shadow: 0 1px 6px rgba(0,0,0,.18);
          margin: 0 auto 24px auto;
          padding: 2cm;
          box-sizing: border-box;
          width: ${A4_WIDTH_PX}px;
          min-height: ${A4_HEIGHT_PX}px;
        }
        .doc-surface table { border-collapse: collapse; }
        .doc-surface td, .doc-surface th { vertical-align: top; }
        .doc-surface img { max-width: 100%; height: auto; }
        .doc-surface:focus { outline: none; }
        @media print { .doc-surface .page, .doc-surface > section { box-shadow: none; margin: 0; } }
      `}</style>
    </div>
  );
}
