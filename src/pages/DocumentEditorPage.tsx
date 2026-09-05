import { useCallback, useEffect, useRef, useState } from "react";
import { renderAsync } from "docx-preview";
import { saveAs } from "file-saver";
import { toast } from "sonner";
import {
  Bold, Italic, Underline, Strikethrough, AlignLeft, AlignCenter, AlignRight,
  AlignJustify, List, ListOrdered, Indent, Outdent, Undo2, Redo2, Table2,
  Image as ImageIcon, Upload, Download, Printer, FilePlus2,
  Trash2, ZoomIn, ZoomOut, Type, Highlighter, Superscript, Subscript, Eraser,
  Plus, Minus, RectangleHorizontal, RectangleVertical, Ruler, Rows3, Columns3,
} from "lucide-react";

/* ------------------------------------------------------------------ */
/*  Word-like Document Editor  (v2)                                    */
/*  - .docx import with images / logos / headers preserved             */
/*  - Word-style tabs: Home | Insert | Layout | Table                  */
/*  - Hover "+" handles on tables to insert row / column               */
/*  - Layout tab: margins, orientation, paper size, indent, spacing    */
/* ------------------------------------------------------------------ */

const FONTS = [
  "Calibri", "Arial", "Times New Roman", "Georgia", "Verdana",
  "Tahoma", "Courier New", "Cambria", "Garamond", "Trebuchet MS",
];
const SIZES = ["8", "9", "10", "11", "12", "14", "16", "18", "20", "24", "28", "36", "48", "72"];
const SIZE_MAP: Record<string, string> = {
  "8": "1", "9": "1", "10": "2", "11": "2", "12": "3", "14": "4", "16": "4",
  "18": "5", "20": "5", "24": "6", "28": "6", "36": "7", "48": "7", "72": "7",
};

const DPI = 96;
const PAPERS: Record<string, { w: number; h: number; label: string }> = {
  A4: { w: 8.27, h: 11.69, label: "A4  21 x 29.7 cm" },
  Letter: { w: 8.5, h: 11, label: 'Letter  8.5" x 11"' },
  Legal: { w: 8.5, h: 14, label: 'Legal  8.5" x 14"' },
  A5: { w: 5.83, h: 8.27, label: "A5  14.8 x 21 cm" },
};
const MARGIN_PRESETS: Record<string, [number, number, number, number]> = {
  Normal: [1, 1, 1, 1],
  Narrow: [0.5, 0.5, 0.5, 0.5],
  Moderate: [1, 0.75, 1, 0.75],
  Wide: [1, 2, 1, 2],
};

const BLANK_PAGE_HTML = `<p><br/></p>`;
type Tab = "home" | "insert" | "layout" | "table";

export default function DocumentEditorPage() {
  const editorRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const imageRef = useRef<HTMLInputElement | null>(null);

  const [fileName, setFileName] = useState("Untitled document");
  const [zoom, setZoom] = useState(100);
  const [font, setFont] = useState("Calibri");
  const [size, setSize] = useState("11");
  const [loading, setLoading] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [tab, setTab] = useState<Tab>("home");

  // page setup (inches)
  const [paper, setPaper] = useState<keyof typeof PAPERS>("A4");
  const [landscape, setLandscape] = useState(false);
  const [margins, setMargins] = useState<[number, number, number, number]>([1, 1, 1, 1]);
  const [keepDocLayout, setKeepDocLayout] = useState(true); // respect original Word page setup

  // table handles
  const [handle, setHandle] = useState<{
    top: number; left: number; width: number; height: number;
  } | null>(null);

  const paperW = (landscape ? PAPERS[paper].h : PAPERS[paper].w) * DPI;
  const paperH = (landscape ? PAPERS[paper].w : PAPERS[paper].h) * DPI;

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
    editorRef.current?.querySelectorAll("font[size]").forEach((el) => {
      const span = document.createElement("span");
      span.style.fontSize = `${pt}pt`;
      span.innerHTML = (el as HTMLElement).innerHTML;
      el.replaceWith(span);
    });
    setDirty(true);
  }, []);

  const applyFont = useCallback((f: string) => { setFont(f); exec("fontName", f); }, [exec]);

  /* ---------------- current block / cell ---------------- */

  const nodeFrom = (test: (el: HTMLElement) => boolean): HTMLElement | null => {
    const sel = window.getSelection();
    if (!sel || !sel.anchorNode) return null;
    let n: Node | null = sel.anchorNode;
    while (n && n !== editorRef.current) {
      if (n.nodeType === 1 && test(n as HTMLElement)) return n as HTMLElement;
      n = n.parentNode;
    }
    return null;
  };

  const currentCell = () =>
    nodeFrom((el) => el.tagName === "TD" || el.tagName === "TH") as HTMLTableCellElement | null;

  const currentBlock = () =>
    nodeFrom((el) => ["P", "DIV", "LI", "TD", "TH", "H1", "H2", "H3", "H4"].includes(el.tagName));

  /* ---------------- import .docx ---------------- */

  const importDocx = async (file: File) => {
    if (!/\.docx?$/i.test(file.name)) {
      toast.error("Please choose a Word file (.docx)");
      return;
    }
    const target = editorRef.current;
    if (!target) return;
    setLoading(true);
    try {
      const buffer = await file.arrayBuffer();
      target.innerHTML = "";
      // Render straight into the editable surface so images, logos, headers,
      // footers and the generated <style> blocks all stay intact.
      await renderAsync(buffer, target, target, {
        className: "docx",
        inWrapper: true,
        ignoreWidth: false,
        ignoreHeight: false,
        ignoreFonts: false,
        breakPages: true,
        renderHeaders: true,
        renderFooters: true,
        renderFootnotes: true,
        renderEndnotes: true,
        renderChanges: false,
        useBase64URL: true,   // embeds images as data URLs -> survive editing & export
        experimental: true,   // better tab-stop / layout emulation
      });
      // Make every rendered image safe for export and visible even if sized 0
      target.querySelectorAll("img").forEach((img) => {
        img.removeAttribute("loading");
        if (!img.getAttribute("width") && !img.style.width) img.style.maxWidth = "100%";
      });
      setKeepDocLayout(true);
      setFileName(file.name.replace(/\.docx?$/i, ""));
      setDirty(false);
      toast.success("Word file loaded — edit it just like in Word");
    } catch (e) {
      console.error(e);
      toast.error("Could not read this Word file");
    } finally {
      setLoading(false);
    }
  };

  /* ---------------- export / print ---------------- */

  const docStyles = () =>
    Array.from(editorRef.current?.querySelectorAll("style") ?? [])
      .map((s) => s.innerHTML)
      .join("\n");

  const pageCss = () =>
    keepDocLayout
      ? ""
      : `@page { size: ${paperW / DPI}in ${paperH / DPI}in; margin: ${margins[0]}in ${margins[1]}in ${margins[2]}in ${margins[3]}in; }`;

  const exportWord = () => {
    if (!editorRef.current) return;
    const html = `<!DOCTYPE html>
<html xmlns:o="urn:schemas-microsoft-com:office:office"
      xmlns:w="urn:schemas-microsoft-com:office:word"
      xmlns="http://www.w3.org/TR/REC-html40">
<head><meta charset="utf-8"><title>${fileName}</title>
<style>
${pageCss() || "@page { size: A4; margin: 1in; }"}
body { font-family: Calibri, sans-serif; font-size: 11pt; }
table { border-collapse: collapse; }
${docStyles()}
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
<style>@page{margin:0}body{margin:0;background:#fff}
${pageCss()}
${docStyles()}
section.docx,.page{box-shadow:none!important;margin:0 auto!important}
table{border-collapse:collapse}
</style></head><body>${editorRef.current.innerHTML}</body></html>`);
    w.document.close();
    w.focus();
    setTimeout(() => w.print(), 500);
  };

  /* ---------------- insert / table ops ---------------- */

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

  const cloneCellStyle = (from: HTMLTableCellElement, to: HTMLTableCellElement) => {
    to.setAttribute("style", from.getAttribute("style") || "");
    if (!to.getAttribute("style")) {
      to.style.border = "1px solid #000";
      to.style.padding = "4px 6px";
    }
    to.innerHTML = "&nbsp;";
  };

  const tableOp = (op: "rowAbove" | "rowBelow" | "colLeft" | "colRight" | "row-" | "col-" | "del") => {
    const cell = currentCell();
    if (!cell) { toast.error("Pehle table ke andar click kijiye"); return; }
    const row = cell.parentElement as HTMLTableRowElement;
    const table = row.closest("table") as HTMLTableElement;
    const idx = cell.cellIndex;

    if (op === "rowAbove" || op === "rowBelow") {
      const nr = row.cloneNode(true) as HTMLTableRowElement;
      Array.from(nr.cells).forEach((c, i) => cloneCellStyle(row.cells[i] ?? c, c));
      op === "rowAbove" ? row.before(nr) : row.after(nr);
    } else if (op === "row-") {
      if (table.rows.length > 1) row.remove();
    } else if (op === "colLeft" || op === "colRight") {
      const at = op === "colLeft" ? idx : idx + 1;
      Array.from(table.rows).forEach((r) => {
        const ref = r.cells[Math.min(idx, r.cells.length - 1)];
        const c = r.insertCell(Math.min(at, r.cells.length));
        if (ref) cloneCellStyle(ref, c); else c.innerHTML = "&nbsp;";
      });
    } else if (op === "col-") {
      Array.from(table.rows).forEach((r) => { if (r.cells[idx]) r.deleteCell(idx); });
    } else {
      table.remove();
    }
    setDirty(true);
    setTimeout(updateHandles, 0);
  };

  /* ---------------- floating + handles ---------------- */

  const updateHandles = useCallback(() => {
    const cell = currentCell();
    const canvas = canvasRef.current;
    if (!cell || !canvas) { setHandle(null); return; }
    const cr = cell.getBoundingClientRect();
    const br = canvas.getBoundingClientRect();
    setHandle({
      top: cr.top - br.top + canvas.scrollTop,
      left: cr.left - br.left + canvas.scrollLeft,
      width: cr.width,
      height: cr.height,
    });
  }, []);

  /* ---------------- layout tab actions ---------------- */

  const bumpIndent = (side: "marginLeft" | "marginRight", delta: number) => {
    const b = currentBlock();
    if (!b) { toast.error("Pehle text par click kijiye"); return; }
    const cur = parseFloat(b.style[side] || "0") || 0;
    b.style[side] = `${Math.max(0, cur + delta)}in`;
    setDirty(true);
  };

  const bumpSpacing = (side: "marginTop" | "marginBottom", delta: number) => {
    const b = currentBlock();
    if (!b) { toast.error("Pehle text par click kijiye"); return; }
    const cur = parseFloat(b.style[side] || "0") || 0;
    b.style[side] = `${Math.max(0, cur + delta)}pt`;
    setDirty(true);
  };

  const setLineSpacing = (v: string) => {
    const b = currentBlock();
    if (!b) { toast.error("Pehle text par click kijiye"); return; }
    b.style.lineHeight = v;
    setDirty(true);
  };

  const applyPageSetup = () => {
    setKeepDocLayout(false);
    setDirty(true);
    toast.success("Page layout applied");
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
    setKeepDocLayout(false);
    setDirty(false);
    setHandle(null);
  };

  /* ---------------- effects ---------------- */

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

  /* ---------------- small UI atoms ---------------- */

  const Btn = ({ onClick, title, children, active = false }: any) => (
    <button type="button" title={title} onMouseDown={(e) => e.preventDefault()} onClick={onClick}
      className={`h-8 min-w-8 px-2 inline-flex items-center justify-center rounded text-gray-700 hover:bg-gray-200 transition ${active ? "bg-gray-200" : ""}`}>
      {children}
    </button>
  );
  const Sep = () => <span className="mx-1 h-6 w-px bg-gray-300" />;
  const Group = ({ label, children }: any) => (
    <div className="flex flex-col items-center px-3 border-r border-gray-200 last:border-0">
      <div className="flex items-center gap-1">{children}</div>
      <span className="text-[10px] text-gray-500 mt-1">{label}</span>
    </div>
  );
  const Stepper = ({ label, value, unit, onDec, onInc }: any) => (
    <div className="flex items-center gap-1 text-xs">
      <span className="text-gray-600 w-12 text-right">{label}</span>
      <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={onDec}
        className="h-6 w-6 rounded border border-gray-300 hover:bg-gray-100 inline-flex items-center justify-center"><Minus className="h-3 w-3" /></button>
      <span className="w-12 text-center tabular-nums">{value}{unit}</span>
      <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={onInc}
        className="h-6 w-6 rounded border border-gray-300 hover:bg-gray-100 inline-flex items-center justify-center"><Plus className="h-3 w-3" /></button>
    </div>
  );

  const TABS: { id: Tab; label: string }[] = [
    { id: "home", label: "Home" },
    { id: "insert", label: "Insert" },
    { id: "layout", label: "Layout" },
    { id: "table", label: "Table" },
  ];

  return (
    <div className="flex flex-col h-[calc(100vh-4rem)] bg-[#f3f3f3]">
      {/* Title bar */}
      <div className="flex items-center gap-3 px-4 py-2 bg-white border-b">
        <input value={fileName} onChange={(e) => setFileName(e.target.value)}
          className="text-sm font-medium bg-transparent outline-none border-b border-transparent focus:border-gray-300 px-1" />
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

      {/* Tabs */}
      <div className="flex items-end gap-1 px-3 bg-white border-b">
        {TABS.map((t) => (
          <button key={t.id} onMouseDown={(e) => e.preventDefault()} onClick={() => setTab(t.id)}
            className={`px-4 py-1.5 text-sm rounded-t ${tab === t.id
              ? "text-[#2b579a] font-medium border-b-2 border-[#2b579a]"
              : "text-gray-600 hover:bg-gray-100"}`}>
            {t.label}
          </button>
        ))}
        <div className="ml-auto flex items-center gap-1 py-1">
          <Btn title="Zoom out" onClick={() => setZoom((z) => Math.max(50, z - 10))}><ZoomOut className="h-4 w-4" /></Btn>
          <span className="text-xs w-10 text-center">{zoom}%</span>
          <Btn title="Zoom in" onClick={() => setZoom((z) => Math.min(200, z + 10))}><ZoomIn className="h-4 w-4" /></Btn>
        </div>
      </div>

      {/* Ribbon */}
      <div className="flex flex-wrap items-center gap-1 px-3 py-2 bg-white border-b shadow-sm min-h-[56px]">
        {tab === "home" && (
          <>
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
          </>
        )}

        {tab === "insert" && (
          <>
            <Group label="Table"><Btn title="Insert table" onClick={insertTable}><Table2 className="h-4 w-4" /></Btn></Group>
            <Group label="Picture"><Btn title="Insert image" onClick={() => imageRef.current?.click()}><ImageIcon className="h-4 w-4" /></Btn></Group>
            <Group label="Page break">
              <Btn title="Page break" onClick={() => exec("insertHTML",
                `<div style="page-break-before:always;border-top:1px dashed #bbb;margin:16px 0"></div><p><br/></p>`)}>
                <span className="text-xs px-1">Break</span>
              </Btn>
            </Group>
            <Group label="Line">
              <Btn title="Horizontal line" onClick={() => exec("insertHorizontalRule")}><Ruler className="h-4 w-4" /></Btn>
            </Group>
          </>
        )}

        {tab === "layout" && (
          <>
            <Group label="Margins">
              <select value={JSON.stringify(margins)}
                onChange={(e) => { setMargins(JSON.parse(e.target.value)); setKeepDocLayout(false); }}
                className="h-8 rounded border border-gray-300 text-sm px-2 bg-white">
                {Object.entries(MARGIN_PRESETS).map(([k, v]) => (
                  <option key={k} value={JSON.stringify(v)}>{k} ({v[0]}")</option>
                ))}
                {!Object.values(MARGIN_PRESETS).some((v) => JSON.stringify(v) === JSON.stringify(margins)) && (
                  <option value={JSON.stringify(margins)}>Custom</option>
                )}
              </select>
              <div className="flex flex-col gap-0.5">
                {(["Top", "Right", "Bottom", "Left"] as const).map((lbl, i) => (
                  <label key={lbl} className="flex items-center gap-1 text-[11px]">
                    <span className="w-10 text-gray-600">{lbl}</span>
                    <input type="number" step="0.05" min="0" value={margins[i]}
                      onChange={(e) => {
                        const m = [...margins] as [number, number, number, number];
                        m[i] = Number(e.target.value); setMargins(m); setKeepDocLayout(false);
                      }}
                      className="w-14 h-5 rounded border border-gray-300 px-1" />
                    <span className="text-gray-400">in</span>
                  </label>
                ))}
              </div>
            </Group>

            <Group label="Orientation">
              <Btn title="Portrait" active={!landscape} onClick={() => { setLandscape(false); setKeepDocLayout(false); }}>
                <RectangleVertical className="h-4 w-4" />
              </Btn>
              <Btn title="Landscape" active={landscape} onClick={() => { setLandscape(true); setKeepDocLayout(false); }}>
                <RectangleHorizontal className="h-4 w-4" />
              </Btn>
            </Group>

            <Group label="Size">
              <select value={paper}
                onChange={(e) => { setPaper(e.target.value as keyof typeof PAPERS); setKeepDocLayout(false); }}
                className="h-8 rounded border border-gray-300 text-sm px-2 bg-white">
                {Object.entries(PAPERS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
              </select>
            </Group>

            <Group label="Indent">
              <div className="flex flex-col gap-1">
                <Stepper label="Left" value={0.1} unit='"'
                  onDec={() => bumpIndent("marginLeft", -0.1)} onInc={() => bumpIndent("marginLeft", 0.1)} />
                <Stepper label="Right" value={0.1} unit='"'
                  onDec={() => bumpIndent("marginRight", -0.1)} onInc={() => bumpIndent("marginRight", 0.1)} />
              </div>
            </Group>

            <Group label="Spacing">
              <div className="flex flex-col gap-1">
                <Stepper label="Before" value={3} unit="pt"
                  onDec={() => bumpSpacing("marginTop", -3)} onInc={() => bumpSpacing("marginTop", 3)} />
                <Stepper label="After" value={3} unit="pt"
                  onDec={() => bumpSpacing("marginBottom", -3)} onInc={() => bumpSpacing("marginBottom", 3)} />
              </div>
            </Group>

            <Group label="Line spacing">
              <select defaultValue="" onChange={(e) => e.target.value && setLineSpacing(e.target.value)}
                className="h-8 rounded border border-gray-300 text-sm px-2 bg-white">
                <option value="">Choose…</option>
                <option value="1">1.0</option>
                <option value="1.15">1.15</option>
                <option value="1.5">1.5</option>
                <option value="2">2.0</option>
              </select>
            </Group>

            <Group label="Apply">
              <button onClick={applyPageSetup}
                className="h-8 px-3 rounded bg-[#2b579a] text-white text-sm hover:bg-[#1e3f70]">
                Apply to pages
              </button>
              {!keepDocLayout && (
                <button onClick={() => { setKeepDocLayout(true); toast.success("Original Word layout restored"); }}
                  className="h-8 px-3 rounded bg-gray-100 text-sm hover:bg-gray-200">Original</button>
              )}
            </Group>
          </>
        )}

        {tab === "table" && (
          <>
            <Group label="Insert"><Btn title="New table" onClick={insertTable}><Table2 className="h-4 w-4" /></Btn></Group>
            <Group label="Rows">
              <Btn title="Insert row above" onClick={() => tableOp("rowAbove")}>
                <span className="text-xs">↑</span><Rows3 className="h-4 w-4" />
              </Btn>
              <Btn title="Insert row below" onClick={() => tableOp("rowBelow")}>
                <Rows3 className="h-4 w-4" /><span className="text-xs">↓</span>
              </Btn>
              <Btn title="Delete row" onClick={() => tableOp("row-")}><Rows3 className="h-4 w-4 text-red-500" /></Btn>
            </Group>
            <Group label="Columns">
              <Btn title="Insert column left" onClick={() => tableOp("colLeft")}>
                <span className="text-xs">←</span><Columns3 className="h-4 w-4" />
              </Btn>
              <Btn title="Insert column right" onClick={() => tableOp("colRight")}>
                <Columns3 className="h-4 w-4" /><span className="text-xs">→</span>
              </Btn>
              <Btn title="Delete column" onClick={() => tableOp("col-")}><Columns3 className="h-4 w-4 text-red-500" /></Btn>
            </Group>
            <Group label="Table"><Btn title="Delete table" onClick={() => tableOp("del")}><Trash2 className="h-4 w-4 text-red-500" /></Btn></Group>
          </>
        )}
      </div>

      {/* Canvas */}
      <div ref={canvasRef} className="relative flex-1 overflow-auto py-8" onScroll={updateHandles}>
        <div style={{ transform: `scale(${zoom / 100})`, transformOrigin: "top center" }}>
          <div
            ref={editorRef}
            contentEditable
            suppressContentEditableWarning
            spellCheck={false}
            onInput={() => { setDirty(true); updateHandles(); }}
            onMouseUp={updateHandles}
            onKeyUp={updateHandles}
            onBlur={() => setTimeout(() => setHandle(null), 200)}
            className={`doc-surface mx-auto outline-none ${keepDocLayout ? "" : "custom-layout"}`}
            style={{ width: paperW }}
          />
        </div>

        {/* Word-style + handles around the active cell */}
        {handle && (
          <>
            <button title="Insert column right"
              onMouseDown={(e) => e.preventDefault()} onClick={() => tableOp("colRight")}
              className="absolute z-20 h-5 w-5 rounded-full bg-white border border-[#2b579a] text-[#2b579a] shadow flex items-center justify-center hover:bg-[#2b579a] hover:text-white"
              style={{ top: handle.top - 24, left: handle.left + handle.width - 10 }}>
              <Plus className="h-3 w-3" />
            </button>
            <button title="Insert row below"
              onMouseDown={(e) => e.preventDefault()} onClick={() => tableOp("rowBelow")}
              className="absolute z-20 h-5 w-5 rounded-full bg-white border border-[#2b579a] text-[#2b579a] shadow flex items-center justify-center hover:bg-[#2b579a] hover:text-white"
              style={{ top: handle.top + handle.height - 10, left: handle.left - 24 }}>
              <Plus className="h-3 w-3" />
            </button>
            <button title="Insert row above"
              onMouseDown={(e) => e.preventDefault()} onClick={() => tableOp("rowAbove")}
              className="absolute z-20 h-5 w-5 rounded-full bg-white border border-gray-400 text-gray-500 shadow flex items-center justify-center hover:bg-gray-700 hover:text-white"
              style={{ top: handle.top - 10, left: handle.left - 24 }}>
              <Plus className="h-3 w-3" />
            </button>
          </>
        )}

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
        .doc-surface > section.docx,
        .doc-surface .page {
          background: #fff;
          box-shadow: 0 1px 6px rgba(0,0,0,.18);
          margin: 0 auto 24px auto;
          box-sizing: border-box;
        }
        /* blank / new documents */
        .doc-surface .page {
          width: ${paperW}px;
          min-height: ${paperH}px;
          padding: ${margins[0]}in ${margins[1]}in ${margins[2]}in ${margins[3]}in;
        }
        /* only override Word's own page setup when the user chose a layout */
        .doc-surface.custom-layout .docx-wrapper > section.docx,
        .doc-surface.custom-layout > section.docx {
          width: ${paperW}px !important;
          min-height: ${paperH}px !important;
          padding: ${margins[0]}in ${margins[1]}in ${margins[2]}in ${margins[3]}in !important;
        }
        .doc-surface table { border-collapse: collapse; }
        .doc-surface td, .doc-surface th { vertical-align: top; }
        .doc-surface img { max-width: 100%; height: auto; }
        .doc-surface svg, .doc-surface v\\:shape, .doc-surface v\\:imagedata { max-width: 100%; }
        .doc-surface:focus { outline: none; }
        .doc-surface td:hover { outline: 1px dashed rgba(43,87,154,.35); }
        @media print { .doc-surface .page, .doc-surface section.docx { box-shadow: none; margin: 0; } }
      `}</style>
    </div>
  );
}
