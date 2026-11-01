import { useCallback, useEffect, useRef, useState } from "react";
import { renderAsync } from "docx-preview";
import JSZip from "jszip";
import { saveAs } from "file-saver";
import { toast } from "sonner";
import {
  Bold, Italic, Underline, Strikethrough, AlignLeft, AlignCenter, AlignRight,
  AlignJustify, List, ListOrdered, Indent, Outdent, Undo2, Redo2, Table2,
  Image as ImageIcon, Upload, Download, Printer, FilePlus2,
  Trash2, ZoomIn, ZoomOut, Type, Highlighter, Superscript, Subscript, Eraser,
  Plus, Minus, RectangleHorizontal, RectangleVertical, Ruler, Rows3, Columns3,
} from "lucide-react";

/* ─── Word package fixes ─────────────────────────────────────────────
   1. Multi-section header/footer inheritance ("same as previous").
   2. Image extensions missing from [Content_Types].xml (only added if used).
   The zip is rebuilt ONLY if something actually changed.
   ─────────────────────────────────────────────────────────────────── */
const WORD_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";

const IMAGE_MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  bmp: "image/bmp",
  tif: "image/tiff",
  tiff: "image/tiff",
  webp: "image/webp",
  svg: "image/svg+xml",
  emf: "image/x-emf",
  wmf: "image/x-wmf",
};

async function ensureImageContentTypes(zip: JSZip): Promise<boolean> {
  const ctFile = zip.file("[Content_Types].xml");
  if (!ctFile) return false;
  let ct = await ctFile.async("string");
  const declared = new Set(
    [...ct.matchAll(/<Default[^>]*Extension="([^"]+)"/gi)].map(m => m[1].toLowerCase())
  );
  const used = new Set<string>();
  zip.forEach(p => {
    if (/^word\/media\//i.test(p)) {
      const ext = p.split(".").pop()?.toLowerCase();
      if (ext) used.add(ext);
    }
  });
  const additions = [...used]
    .filter(ext => IMAGE_MIME[ext] && !declared.has(ext))
    .map(ext => `<Default Extension="${ext}" ContentType="${IMAGE_MIME[ext]}"/>`);
  if (!additions.length) return false;
  ct = ct.replace(/(<Types[^>]*>)/, `$1${additions.join("")}`);
  zip.file("[Content_Types].xml", ct);
  return true;
}

async function normalizeDocxPackage(buf: ArrayBuffer): Promise<ArrayBuffer> {
  try {
    const zip = await JSZip.loadAsync(buf);
    let changed = await ensureImageContentTypes(zip);

    const path = "word/document.xml";
    const file = zip.file(path);
    if (file) {
      let xmlText = await file.async("string");
      if (xmlText.charCodeAt(0) === 0xFEFF) xmlText = xmlText.slice(1);
      const doc = new DOMParser().parseFromString(xmlText, "application/xml");
      if (!doc.getElementsByTagName("parsererror").length) {
        const sectPrs = Array.from(doc.getElementsByTagNameNS(WORD_NS, "sectPr"));
        let lastHeaderRefs: Element[] = [];
        let lastFooterRefs: Element[] = [];
        let headersChanged = false;
        for (const sectPr of sectPrs) {
          const headerRefs = Array.from(sectPr.getElementsByTagNameNS(WORD_NS, "headerReference"));
          const footerRefs = Array.from(sectPr.getElementsByTagNameNS(WORD_NS, "footerReference"));
          if (headerRefs.length > 0) lastHeaderRefs = headerRefs;
          else if (lastHeaderRefs.length > 0) {
            lastHeaderRefs.forEach(n => sectPr.insertBefore(n.cloneNode(true), sectPr.firstChild));
            headersChanged = true;
          }
          if (footerRefs.length > 0) lastFooterRefs = footerRefs;
          else if (lastFooterRefs.length > 0) {
            lastFooterRefs.forEach(n => sectPr.insertBefore(n.cloneNode(true), sectPr.firstChild));
            headersChanged = true;
          }
        }
        if (headersChanged) {
          zip.file(path, new XMLSerializer().serializeToString(doc));
          changed = true;
        }
      }
    }

    if (!changed) return buf;
    return await zip.generateAsync({ type: "arraybuffer" });
  } catch {
    return buf;
  }
}

/* Render ke baad: sections ko relative rakho taaki floating images apne page
   ke andar rahein, aur sirf bina size wali images ko max-width do. */
function fixRenderedImages(root: HTMLElement) {
  root.querySelectorAll<HTMLElement>("section.docx").forEach(s => {
    s.style.position = "relative";
  });
  root.querySelectorAll<HTMLImageElement>("img").forEach(img => {
    img.removeAttribute("loading");
    /* docx-preview "wrapNone" (floating) images live inside a 0x0 wrapper.
       max-width:100% of 0px = 0px  ->  image collapses and disappears.
       So never give max-width to those. */
    const p = img.parentElement;
    const inZeroBox = !!p && p.style.width === "0px";
    if (!inZeroBox && !img.getAttribute("width") && !img.style.width) {
      img.style.maxWidth = "100%";
    }
  });
}

/* ─── Floating image positions ───────────────────────────────────────
   docx-preview draws "wrapNone" anchored images as position:relative with
   left/top = the Word offset, measured from where the image sits in the text
   flow. Word measures from the PAGE (or margin / paragraph). So images that
   are anchored to the page end up shifted by the page margins.
   We read the real anchor info from the document (body + headers + footers +
   footnotes) and correct left/top. "Behind text" images are sent behind the
   text. If anything doesn't match, docx-preview's own placement stays.
   ─────────────────────────────────────────────────────────────────── */
const WP_NS  = "http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing";
const PIC_NS = "http://schemas.openxmlformats.org/drawingml/2006/picture";
const A_NS   = "http://schemas.openxmlformats.org/drawingml/2006/main";
const REL_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const EMU_PER_PX = 9525;

type AnchorInfo = {
  cx: number; cy: number;                       // size in px
  relH: string; relV: string;                   // relativeFrom
  offX: number | null; offY: number | null;     // posOffset in px
  alignH: string | null; alignV: string | null; // <wp:align>
  behind: boolean;                              // "Behind text"
  b64: number;                                  // length of the image's base64 (0 = unknown)
};

function resolveZipPath(target: string): string {
  if (target.startsWith("/")) return target.slice(1);
  const out: string[] = [];
  for (const s of ["word", ...target.split("/")]) {
    if (s === "..") out.pop();
    else if (s && s !== ".") out.push(s);
  }
  return out.join("/");
}

async function readFloatingAnchors(buf: ArrayBuffer): Promise<AnchorInfo[]> {
  try {
    const zip = await JSZip.loadAsync(buf);
    const parts = Object.keys(zip.files)
      .filter(p => /^word\/(document|header\d*|footer\d*|footnotes|endnotes)\.xml$/i.test(p))
      .sort((a, b) => (a === "word/document.xml" ? -1 : b === "word/document.xml" ? 1 : a.localeCompare(b)));

    const b64Cache = new Map<string, number>();
    const b64Len = async (path: string) => {
      if (!b64Cache.has(path)) {
        const f = zip.file(path);
        b64Cache.set(path, f ? 4 * Math.ceil((await f.async("uint8array")).length / 3) : 0);
      }
      return b64Cache.get(path)!;
    };
    const parse = async (path: string) => {
      const f = zip.file(path);
      if (!f) return null;
      let xml = await f.async("string");
      if (xml.charCodeAt(0) === 0xFEFF) xml = xml.slice(1);
      const d = new DOMParser().parseFromString(xml, "application/xml");
      return d.getElementsByTagName("parsererror").length ? null : d;
    };

    const out: AnchorInfo[] = [];
    for (const part of parts) {
      const doc = await parse(part);
      if (!doc) continue;

      // rId -> media path for this part
      const rels = new Map<string, string>();
      const relDoc = await parse(part.replace(/^word\//, "word/_rels/") + ".rels");
      relDoc?.querySelectorAll("Relationship").forEach(r => {
        const id = r.getAttribute("Id"), t = r.getAttribute("Target");
        if (id && t && r.getAttribute("TargetMode") !== "External") rels.set(id, resolveZipPath(t));
      });

      for (const a of Array.from(doc.getElementsByTagNameNS(WP_NS, "anchor"))) {
        const el = (name: string) => a.getElementsByTagNameNS(WP_NS, name)[0] as Element | undefined;
        if (!el("wrapNone")) continue;                                   // only the kind docx-preview draws as relative
        const pic = a.getElementsByTagNameNS(PIC_NS, "pic")[0];
        if (!pic) continue;                                              // only real pictures
        const ext = el("extent");
        if (!ext) continue;

        const axis = (name: "positionH" | "positionV") => {
          const n = el(name);
          const off = n?.getElementsByTagNameNS(WP_NS, "posOffset")[0]?.textContent;
          const al  = n?.getElementsByTagNameNS(WP_NS, "align")[0]?.textContent;
          return {
            rel: n?.getAttribute("relativeFrom") ?? "page",
            off: off != null && off !== "" ? Number(off) / EMU_PER_PX : null,
            align: al ?? null,
          };
        };
        const h = axis("positionH");
        const v = axis("positionV");

        if (a.getAttribute("simplePos") === "1") {           // absolute position on the page
          const sp = el("simplePos");
          h.rel = v.rel = "page";
          h.off = Number(sp?.getAttribute("x") ?? 0) / EMU_PER_PX;
          v.off = Number(sp?.getAttribute("y") ?? 0) / EMU_PER_PX;
          h.align = v.align = null;
        }

        const embed = pic.getElementsByTagNameNS(A_NS, "blip")[0]?.getAttributeNS(REL_NS, "embed");
        const target = embed ? rels.get(embed) : undefined;

        out.push({
          cx: Number(ext.getAttribute("cx")) / EMU_PER_PX,
          cy: Number(ext.getAttribute("cy")) / EMU_PER_PX,
          relH: h.rel, relV: v.rel, offX: h.off, offY: v.off,
          alignH: h.align, alignV: v.align,
          behind: a.getAttribute("behindDoc") === "1" || a.getAttribute("behindDoc") === "true",
          b64: target ? await b64Len(target) : 0,
        });
      }
    }
    return out;
  } catch {
    return [];
  }
}

/* target coordinate (px from the page edge) for one axis, or null = keep in-flow position */
function resolveAxis(
  rel: string, off: number | null, align: string | null,
  size: number, padStart: number, padEnd: number, extent: number,
): number | null {
  let box: [number, number] | null = null;
  if (rel === "page") box = [0, size];
  else if (rel === "margin" || rel === "column") box = [padStart, size - padEnd];
  else if (rel === "topMargin" || rel === "leftMargin" || rel === "insideMargin" || rel === "outsideMargin") box = [0, padStart];
  else if (rel === "bottomMargin" || rel === "rightMargin") box = [size - padEnd, size];
  if (!box) return null;                                   // paragraph / line / character
  const [s, e] = box;
  if (align === "center") return s + (e - s - extent) / 2;
  if (align === "right" || align === "bottom" || align === "outside") return e - extent;
  if (align) return s;
  return s + (off ?? 0);
}

function placeFloatingImages(root: HTMLElement, anchors: AnchorInfo[]) {
  if (!anchors.length) return;

  const items: { wrap: HTMLElement; img: HTMLImageElement; sec: HTMLElement }[] = [];
  root.querySelectorAll<HTMLImageElement>("img").forEach(img => {
    const wrap = img.parentElement;
    const sec  = img.closest<HTMLElement>("section.docx");
    if (wrap && sec && wrap.style.position === "relative" &&
        wrap.style.width === "0px" && wrap.style.height === "0px") {
      items.push({ wrap, img, sec });
    }
  });

  const used = new Set<number>();
  const findAnchor = (w: number, h: number, len: number) => {
    // pass 0: same size AND same image bytes. pass 1: same size only.
    for (let pass = 0; pass < 2; pass++) {
      for (let i = 0; i < anchors.length; i++) {
        if (used.has(i)) continue;
        if (Math.abs(anchors[i].cx - w) > 2 || Math.abs(anchors[i].cy - h) > 2) continue;
        if (pass === 0 && !(len && anchors[i].b64 === len)) continue;
        return i;
      }
    }
    return -1;
  };

  for (const { wrap, img, sec } of items) {
    const w = img.offsetWidth, h = img.offsetHeight;
    const comma = img.src.startsWith("data:") ? img.src.indexOf(",") : -1;
    const len = comma >= 0 ? img.src.length - comma - 1 : 0;
    const j = findAnchor(w, h, len);
    if (j < 0) continue;                                   // no match -> leave as is
    used.add(j);
    const a = anchors[j];

    const oldLeft = wrap.style.left, oldTop = wrap.style.top;
    wrap.style.left = "0px";
    wrap.style.top  = "0px";
    const sr = sec.getBoundingClientRect();
    const k  = sr.width / sec.offsetWidth || 1;            // editor zoom
    const ir = img.getBoundingClientRect();
    // where the image really sits in the flow (small images are baseline-aligned inside the box)
    const sx = (ir.left - sr.left) / k;
    const sy = (ir.top  - sr.top)  / k;

    const cs = getComputedStyle(sec);
    const tx = resolveAxis(a.relH, a.offX, a.alignH, sec.offsetWidth,  parseFloat(cs.paddingLeft) || 0, parseFloat(cs.paddingRight)  || 0, w);
    const ty = resolveAxis(a.relV, a.offY, a.alignV, sec.offsetHeight, parseFloat(cs.paddingTop)  || 0, parseFloat(cs.paddingBottom) || 0, h);

    if (tx === null && oldLeft) wrap.style.left = oldLeft;
    else wrap.style.left = `${(tx ?? sx) - sx}px`;
    if (ty === null && oldTop) wrap.style.top = oldTop;
    else wrap.style.top = `${(ty ?? sy) - sy}px`;

    if (a.behind) {                                        // "Behind text": letterheads, watermarks
      wrap.style.zIndex = "-1";
      sec.style.isolation = "isolate";                     // keeps it above the white page, below the text
    }
  }
}

/* wait until every <img> has loaded (or failed), max a few seconds */
async function imagesReady(root: HTMLElement, timeout = 4000) {
  const imgs = Array.from(root.querySelectorAll<HTMLImageElement>("img"));
  await Promise.all(imgs.map(im => im.complete ? Promise.resolve() : new Promise<void>(res => {
    const done = () => { clearTimeout(t); res(); };
    const t = setTimeout(res, timeout);
    im.addEventListener("load", done, { once: true });
    im.addEventListener("error", done, { once: true });
  })));
}

/* Inline images that are wider than their cell / the page are scaled down
   (aspect ratio kept) so they never break the table or run off the page. */
function fitInlineImages(root: HTMLElement) {
  root.querySelectorAll<HTMLImageElement>("section.docx img").forEach(img => {
    if (img.parentElement?.style.width === "0px") return;        // floating
    const sec = img.closest<HTMLElement>("section.docx");
    if (!sec) return;
    const cell = img.closest<HTMLElement>("td,th");
    let limit = sec.clientWidth;                                  // never wider than the page
    if (cell) {
      const cs = getComputedStyle(cell);
      limit = cell.clientWidth - (parseFloat(cs.paddingLeft) || 0) - (parseFloat(cs.paddingRight) || 0);
    }
    const w = img.offsetWidth, h = img.offsetHeight;
    if (limit > 20 && w > limit + 2 && h > 0) {
      img.style.width  = `${limit}px`;
      img.style.height = `${Math.round(limit * h / w)}px`;
    }
  });
}

/* Formats a browser cannot draw (EMF, WMF, TIFF, missing/linked files):
   no ugly broken-image icon — keep the empty box and report the count. */
function markBrokenImages(root: HTMLElement): number {
  let n = 0;
  root.querySelectorAll<HTMLImageElement>("img").forEach(im => {
    if (im.complete && im.naturalWidth === 0 && !im.src.startsWith("data:image/svg")) {
      n++;
      im.setAttribute("data-broken", "1");
      im.removeAttribute("src");
      im.alt = "";
    }
  });
  return n;
}

const FONTS = [
  "Calibri", "Arial", "Times New Roman", "Georgia", "Verdana",
  "Tahoma", "Courier New", "Cambria", "Garamond", "Trebuchet MS",
];
const SIZES = ["8","9","10","11","12","14","16","18","20","24","28","36","48","72"];
const SIZE_MAP: Record<string, string> = {
  "8":"1","9":"1","10":"2","11":"2","12":"3","14":"4","16":"4",
  "18":"5","20":"5","24":"6","28":"6","36":"7","48":"7","72":"7",
};
const DPI = 96;
const PAPERS: Record<string, { w: number; h: number; label: string }> = {
  A4:     { w: 8.27, h: 11.69, label: "A4  21 x 29.7 cm" },
  Letter: { w: 8.5,  h: 11,    label: 'Letter  8.5" x 11"' },
  Legal:  { w: 8.5,  h: 14,    label: 'Legal  8.5" x 14"' },
  A5:     { w: 5.83, h: 8.27,  label: "A5  14.8 x 21 cm" },
};
const MARGIN_PRESETS: Record<string, [number,number,number,number]> = {
  Normal:   [1, 1, 1, 1],
  Narrow:   [0.5, 0.5, 0.5, 0.5],
  Moderate: [1, 0.75, 1, 0.75],
  Wide:     [1, 2, 1, 2],
};

const BLANK_PAGE_HTML = `<p><br/></p>`;
type Tab = "home" | "insert" | "layout" | "table";

export default function DocumentEditorPage() {
  const editorRef  = useRef<HTMLDivElement | null>(null);
  const canvasRef  = useRef<HTMLDivElement | null>(null);
  const fileRef    = useRef<HTMLInputElement | null>(null);
  const imageRef   = useRef<HTMLInputElement | null>(null);

  const [fileName,      setFileName]      = useState("Untitled document");
  const [zoom,          setZoom]          = useState(100);
  const [font,          setFont]          = useState("Calibri");
  const [size,          setSize]          = useState("11");
  const [loading,       setLoading]       = useState(false);
  const [dirty,         setDirty]         = useState(false);
  const [tab,           setTab]           = useState<Tab>("home");
  const [paper,         setPaper]         = useState<keyof typeof PAPERS>("A4");
  const [landscape,     setLandscape]     = useState(false);
  const [margins,       setMargins]       = useState<[number,number,number,number]>([1,1,1,1]);
  const [keepDocLayout, setKeepDocLayout] = useState(true);
  const [handle,        setHandle]        = useState<{top:number;left:number;width:number;height:number}|null>(null);

  /* picture selection (resize box) + last caret position inside the page */
  const selImgRef  = useRef<HTMLImageElement | null>(null);
  const savedRange = useRef<Range | null>(null);
  const [imgBox, setImgBox] = useState<{top:number;left:number;width:number;height:number}|null>(null);

  const paperW = (landscape ? PAPERS[paper].h : PAPERS[paper].w) * DPI;
  const paperH = (landscape ? PAPERS[paper].w : PAPERS[paper].h) * DPI;

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

  const currentCell  = () => nodeFrom(el => el.tagName==="TD"||el.tagName==="TH") as HTMLTableCellElement|null;
  const currentBlock = () => nodeFrom(el => ["P","DIV","LI","TD","TH","H1","H2","H3","H4"].includes(el.tagName));

  /* ── Import .docx (with fallbacks) ── */
  const importDocx = async (file: File) => {
    if (!/\.docx$/i.test(file.name)) {
      toast.error(/\.doc$/i.test(file.name)
        ? "Purani .doc file support nahi hai. Word mein 'Save As → .docx' karke upload karein"
        : "Please choose a Word file (.docx)");
      return;
    }
    const target = editorRef.current;
    if (!target) return;
    setLoading(true);

    const baseOpts = {
      className: "docx", inWrapper: true, ignoreWidth: false, ignoreHeight: false,
      ignoreFonts: false, breakPages: true, renderHeaders: true, renderFooters: true,
      renderFootnotes: true, renderEndnotes: true, renderChanges: false,
      useBase64URL: true,
    };

    try {
      const rawBuf = await file.arrayBuffer();
      const attempts: { buf: () => Promise<ArrayBuffer> | ArrayBuffer; opts: any; label: string }[] = [
        { buf: () => normalizeDocxPackage(rawBuf), opts: { ...baseOpts, experimental: true }, label: "patched" },
        { buf: () => rawBuf, opts: { ...baseOpts, experimental: true }, label: "original" },
        { buf: () => rawBuf, opts: { ...baseOpts, experimental: false, renderFootnotes: false, renderEndnotes: false }, label: "simple" },
      ];

      let lastErr: unknown = null;
      let ok = false;
      for (const a of attempts) {
        try {
          target.innerHTML = "";
          await renderAsync(await a.buf(), target, target, a.opts);
          ok = true;
          console.info("docx loaded with:", a.label);
          break;
        } catch (e) {
          lastErr = e;
          console.error(`docx attempt "${a.label}" failed:`, e);
        }
      }
      if (!ok) throw lastErr;

      let badImages = 0;
      try {
        fixRenderedImages(target);
        await imagesReady(target);                         // sizes are final only after images load
        fitInlineImages(target);                           // too-wide images -> fit page / cell
        placeFloatingImages(target, await readFloatingAnchors(rawBuf));
        badImages = markBrokenImages(target);              // EMF / WMF etc.
      } catch (e) { console.warn("image fixes:", e); }
      selImgRef.current = null; setImgBox(null);

      setKeepDocLayout(true);
      setFileName(file.name.replace(/\.docx$/i, ""));
      setDirty(false);
      toast.success("Word file loaded");
      if (badImages) toast.warning(`${badImages} image${badImages > 1 ? "s" : ""} in this file use a format the browser cannot show (EMF/WMF/TIFF). Save the picture as PNG/JPG in Word and import again.`, { duration: 8000 });
    } catch (e: any) {
      console.error(e);
      toast.error(`Could not read this Word file: ${e?.message ?? "unknown error"}`);
    } finally {
      setLoading(false);
    }
  };

  /* ── Export / Print ── */
  const docStyles = () =>
    Array.from(editorRef.current?.querySelectorAll("style") ?? []).map(s => s.innerHTML).join("\n");

  const pageCss = () => keepDocLayout ? "" :
    `@page { size: ${paperW/DPI}in ${paperH/DPI}in; margin: ${margins[0]}in ${margins[1]}in ${margins[2]}in ${margins[3]}in; }`;

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
    toast.success("Downloaded — opens in Microsoft Word");
  };

  /* Print / PDF — every Word page (or .page block) prints at its own on-screen
     size, so a 1-page A4 invoice stays 1 page. Paper size comes from the
     document (@page size), NOT the printer default (Letter). */
  const printDoc = async () => {
    const live = editorRef.current;
    if (!live) return;
    const w = window.open("", "_blank", "width=900,height=1000");
    if (!w) { toast.error("Popup blocked — allow popups for this site"); return; }

    const clone = live.cloneNode(true) as HTMLElement;
    clone.removeAttribute("contenteditable");
    clone.querySelectorAll("style").forEach(s => s.remove());   // re-added in <head>, before our overrides

    const sel = "section.docx, .page";
    const liveSheets  = Array.from(live.querySelectorAll<HTMLElement>(sel));
    const cloneSheets = Array.from(clone.querySelectorAll<HTMLElement>(sel));

    const sizes = liveSheets.map(el => {
      const cs = getComputedStyle(el);
      const wpx = parseFloat(cs.width) || el.offsetWidth;
      const hpx = parseFloat(cs.minHeight) || el.offsetHeight;
      return { wpx, hpx, padding: cs.padding };
    });
    const uniq = Array.from(new Set(sizes.map(s => `${s.wpx.toFixed(2)}px ${s.hpx.toFixed(2)}px`)));

    let pageRules: string;
    if (uniq.length <= 1) {
      pageRules = `@page{size:${uniq[0] ?? "210mm 297mm"};margin:0}`;
    } else {                                                    // mixed page sizes -> named pages
      pageRules = uniq.map((u, i) => `@page ps${i}{size:${u};margin:0}.ps${i}{page:ps${i}}`).join("\n");
    }
    cloneSheets.forEach((el, i) => {
      const s = sizes[i];
      if (!s) return;
      if (uniq.length > 1) el.classList.add(`ps${uniq.indexOf(`${s.wpx.toFixed(2)}px ${s.hpx.toFixed(2)}px`)}`);
      el.style.setProperty("width", `${s.wpx}px`, "important");
      // 1px less than the sheet so rounding never pushes an extra blank page
      el.style.setProperty("min-height", `${Math.max(0, s.hpx - 1)}px`, "important");
      el.style.setProperty("padding", s.padding, "important");
    });

    w.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>${fileName}</title>
<style>
${docStyles()}
</style>
<style>
${pageRules}
html,body{margin:0!important;padding:0!important;background:#fff!important}
*{-webkit-print-color-adjust:exact;print-color-adjust:exact}
.docx-wrapper{display:block!important;background:none!important;padding:0!important;margin:0!important}
section.docx,.page{
  box-shadow:none!important;margin:0!important;position:relative!important;
  overflow:visible!important;box-sizing:border-box!important;
  break-after:page;page-break-after:always;
  -webkit-box-decoration-break:clone;box-decoration-break:clone}
section.docx:last-of-type,.page:last-of-type{break-after:auto;page-break-after:auto}
.docx-wrapper img{max-width:none}
img[data-broken]{outline:none!important;background:none!important}
table{border-collapse:collapse}
</style></head><body>${clone.innerHTML}</body></html>`);
    w.document.close();

    // wait until every image is decoded, then print
    await Promise.all(Array.from(w.document.images).map(im =>
      im.complete ? Promise.resolve() :
        new Promise<void>(res => { im.onload = im.onerror = () => res(); })));
    await new Promise(r => setTimeout(r, 200));
    w.focus();
    w.print();
  };

  /* ── Table ops ── */
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
    if (!to.getAttribute("style")) { to.style.border="1px solid #000"; to.style.padding="4px 6px"; }
    to.innerHTML = "&nbsp;";
  };

  const tableOp = (op: "rowAbove"|"rowBelow"|"colLeft"|"colRight"|"row-"|"col-"|"del") => {
    const cell = currentCell();
    if (!cell) { toast.error("Click inside the table first"); return; }
    const row   = cell.parentElement as HTMLTableRowElement;
    const table = row.closest("table") as HTMLTableElement;
    const idx   = cell.cellIndex;
    if (op==="rowAbove"||op==="rowBelow") {
      const nr = row.cloneNode(true) as HTMLTableRowElement;
      Array.from(nr.cells).forEach((c,i) => cloneCellStyle(row.cells[i]??c, c));
      op==="rowAbove" ? row.before(nr) : row.after(nr);
    } else if (op==="row-") {
      if (table.rows.length > 1) row.remove();
    } else if (op==="colLeft"||op==="colRight") {
      const at = op==="colLeft" ? idx : idx+1;
      Array.from(table.rows).forEach(r => {
        const ref = r.cells[Math.min(idx, r.cells.length-1)];
        const c   = r.insertCell(Math.min(at, r.cells.length));
        if (ref) cloneCellStyle(ref, c); else c.innerHTML = "&nbsp;";
      });
    } else if (op==="col-") {
      Array.from(table.rows).forEach(r => { if (r.cells[idx]) r.deleteCell(idx); });
    } else {
      table.remove();
    }
    setDirty(true);
    setTimeout(updateHandles, 0);
  };

  const updateHandles = useCallback(() => {
    const cell   = currentCell();
    const canvas = canvasRef.current;
    if (!cell || !canvas) { setHandle(null); return; }
    const cr = cell.getBoundingClientRect();
    const br = canvas.getBoundingClientRect();
    setHandle({ top: cr.top-br.top+canvas.scrollTop, left: cr.left-br.left+canvas.scrollLeft, width: cr.width, height: cr.height });
  }, []);

  const bumpIndent = (side: "marginLeft"|"marginRight", delta: number) => {
    const b = currentBlock();
    if (!b) { toast.error("Click on text first"); return; }
    b.style[side] = `${Math.max(0, (parseFloat(b.style[side]||"0")||0)+delta)}in`;
    setDirty(true);
  };
  const bumpSpacing = (side: "marginTop"|"marginBottom", delta: number) => {
    const b = currentBlock();
    if (!b) { toast.error("Click on text first"); return; }
    b.style[side] = `${Math.max(0, (parseFloat(b.style[side]||"0")||0)+delta)}pt`;
    setDirty(true);
  };
  const setLineSpacing = (v: string) => {
    const b = currentBlock();
    if (!b) { toast.error("Click on text first"); return; }
    b.style.lineHeight = v; setDirty(true);
  };
  const applyPageSetup = () => { setKeepDocLayout(false); setDirty(true); toast.success("Page layout applied"); };

  /* ── Pictures ───────────────────────────────────────────────────────── */
  const syncImgBox = useCallback(() => {
    const img = selImgRef.current, canvas = canvasRef.current;
    if (!img || !canvas || !img.isConnected) { selImgRef.current = null; setImgBox(null); return; }
    const r = img.getBoundingClientRect(), b = canvas.getBoundingClientRect();
    setImgBox({ top: r.top - b.top + canvas.scrollTop, left: r.left - b.left + canvas.scrollLeft, width: r.width, height: r.height });
  }, []);

  /* usable width (px) where an element sits: table cell, else page text area */
  const availWidth = (el: Element | null): number => {
    const cell = el?.closest<HTMLElement>("td,th");
    const box  = cell ?? el?.closest<HTMLElement>("section.docx, .page");
    if (!box) return paperW - 2 * DPI;
    const cs = getComputedStyle(box);
    return box.clientWidth - (parseFloat(cs.paddingLeft) || 0) - (parseFloat(cs.paddingRight) || 0);
  };

  /* Insert at the caret, at the picture's ORIGINAL size (same aspect ratio).
     Only if it is wider than the page/cell is it scaled down to fit — never distorted. */
  const insertImage = async (file: File) => {
    const ed = editorRef.current;
    if (!ed) return;
    if (!/^image\//.test(file.type) && !/\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(file.name)) {
      toast.error("Please choose an image file (PNG, JPG, GIF, WEBP, SVG)");
      return;
    }
    try {
      const dataUrl = await new Promise<string>((res, rej) => {
        const fr = new FileReader();
        fr.onload = () => res(String(fr.result));
        fr.onerror = () => rej(fr.error);
        fr.readAsDataURL(file);
      });
      const nat = await new Promise<{ w: number; h: number }>((res, rej) => {
        const im = new window.Image();
        im.onload  = () => res({ w: im.naturalWidth || im.width, h: im.naturalHeight || im.height });
        im.onerror = () => rej(new Error("This picture could not be read"));
        im.src = dataUrl;
      });

      // 1) put the caret back where the user was (or at the end of the last page)
      ed.focus();
      const sel = window.getSelection();
      let range = savedRange.current;
      if (!range || !ed.contains(range.startContainer)) {
        range = document.createRange();
        const hosts = ed.querySelectorAll<HTMLElement>("section.docx article, .page");
        const host = hosts[hosts.length - 1] ?? ed;
        const p = document.createElement("p");
        host.appendChild(p);
        range.selectNodeContents(p);
        range.collapse(true);
      }
      sel?.removeAllRanges();
      sel?.addRange(range);

      // 2) insert (execCommand keeps Ctrl+Z working)
      const before = new Set(Array.from(ed.querySelectorAll("img")));
      document.execCommand("insertImage", false, dataUrl);
      let img = Array.from(ed.querySelectorAll<HTMLImageElement>("img")).find(i => !before.has(i)) ?? null;
      if (!img) {
        img = document.createElement("img");
        img.src = dataUrl;
        range.insertNode(img);
      }

      // 3) original size, capped to what fits; both sides set so the ratio is locked
      const avail = availWidth(img.parentElement);
      const natW = nat.w || 300;
      const w = Math.max(1, Math.round(avail > 40 ? Math.min(natW, avail) : natW));
      const h = nat.w && nat.h ? Math.round(w * nat.h / nat.w) : 0;
      img.removeAttribute("width");
      img.removeAttribute("height");
      img.style.cssText = `width:${w}px;${h ? `height:${h}px;` : "height:auto;"}max-width:none;`;

      // 4) caret after the picture, picture selected (resize handle)
      const after = document.createRange();
      after.setStartAfter(img);
      after.collapse(true);
      sel?.removeAllRanges();
      sel?.addRange(after);
      savedRange.current = after.cloneRange();
      selImgRef.current = img;
      syncImgBox();
      setDirty(true);
    } catch (e: any) {
      console.error(e);
      toast.error(e?.message ?? "Could not add the picture");
    }
  };

  const imgOriginalSize = () => {
    const img = selImgRef.current;
    if (!img || !img.naturalWidth) return;
    img.style.maxWidth = "none";
    img.style.width  = `${img.naturalWidth}px`;
    img.style.height = `${img.naturalHeight}px`;
    setDirty(true); syncImgBox();
  };
  const imgFitWidth = () => {
    const img = selImgRef.current;
    if (!img) return;
    const r = img.getBoundingClientRect();
    if (!r.width) return;
    const w = Math.round(availWidth(img.parentElement));
    img.style.maxWidth = "none";
    img.style.width  = `${w}px`;
    img.style.height = `${Math.round(w * r.height / r.width)}px`;
    setDirty(true); syncImgBox();
  };
  const imgDelete = () => {
    const img = selImgRef.current;
    if (!img) return;
    const wrap = img.parentElement;
    if (wrap && wrap.style.width === "0px") wrap.remove(); else img.remove();   // Word floating pictures live in a 0x0 box
    selImgRef.current = null; setImgBox(null); setDirty(true);
  };
  /* drag the corner = resize, aspect ratio always kept */
  const startImgResize = (e: React.MouseEvent) => {
    e.preventDefault(); e.stopPropagation();
    const img = selImgRef.current;
    if (!img) return;
    const k  = zoom / 100;
    const r0 = img.getBoundingClientRect();
    const w0 = r0.width / k, ratio = r0.height / r0.width, x0 = e.clientX;
    const move = (ev: MouseEvent) => {
      const w = Math.max(16, Math.round(w0 + (ev.clientX - x0) / k));
      img.style.maxWidth = "none";
      img.style.width  = `${w}px`;
      img.style.height = `${Math.round(w * ratio)}px`;
      syncImgBox();
    };
    const up = () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
      setDirty(true);
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  };

  const newDocument = () => {
    if (dirty && !window.confirm("Discard unsaved changes?")) return;
    if (editorRef.current) editorRef.current.innerHTML = `<div class="page">${BLANK_PAGE_HTML}</div>`;
    setFileName("Untitled document"); setKeepDocLayout(false); setDirty(false); setHandle(null);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey||e.metaKey)) return;
      if (e.key.toLowerCase()==="s") { e.preventDefault(); exportWord(); }
      if (e.key.toLowerCase()==="p") { e.preventDefault(); printDoc(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  /* remember the last caret position inside the page (the file dialog steals focus) */
  useEffect(() => {
    const onSel = () => {
      const sel = window.getSelection(), ed = editorRef.current;
      if (sel && sel.rangeCount && ed && ed.contains(sel.anchorNode)) savedRange.current = sel.getRangeAt(0).cloneRange();
    };
    document.addEventListener("selectionchange", onSel);
    try { document.execCommand("enableObjectResizing", false, "false"); } catch { /* ignore */ }
    return () => document.removeEventListener("selectionchange", onSel);
  }, []);
  useEffect(() => { syncImgBox(); }, [zoom, syncImgBox]);
  useEffect(() => {
    window.addEventListener("resize", syncImgBox);
    return () => window.removeEventListener("resize", syncImgBox);
  }, [syncImgBox]);

  useEffect(() => {
    if (editorRef.current && !editorRef.current.innerHTML.trim())
      editorRef.current.innerHTML = `<div class="page">${BLANK_PAGE_HTML}</div>`;
  }, []);

  /* ── UI atoms ── */
  const Btn = ({ onClick, title, children, active=false }: any) => (
    <button type="button" title={title} onMouseDown={e=>e.preventDefault()} onClick={onClick}
      className={`h-8 min-w-8 px-2 inline-flex items-center justify-center rounded text-gray-700 hover:bg-gray-200 transition ${active?"bg-gray-200":""}`}>
      {children}
    </button>
  );
  const Sep  = () => <span className="mx-1 h-6 w-px bg-gray-300"/>;
  const Group = ({ label, children }: any) => (
    <div className="flex flex-col items-center px-3 border-r border-gray-200 last:border-0">
      <div className="flex items-center gap-1">{children}</div>
      <span className="text-[10px] text-gray-500 mt-1">{label}</span>
    </div>
  );
  const Stepper = ({ label, value, unit, onDec, onInc }: any) => (
    <div className="flex items-center gap-1 text-xs">
      <span className="text-gray-600 w-12 text-right">{label}</span>
      <button type="button" onMouseDown={e=>e.preventDefault()} onClick={onDec}
        className="h-6 w-6 rounded border border-gray-300 hover:bg-gray-100 inline-flex items-center justify-center"><Minus className="h-3 w-3"/></button>
      <span className="w-12 text-center tabular-nums">{value}{unit}</span>
      <button type="button" onMouseDown={e=>e.preventDefault()} onClick={onInc}
        className="h-6 w-6 rounded border border-gray-300 hover:bg-gray-100 inline-flex items-center justify-center"><Plus className="h-3 w-3"/></button>
    </div>
  );

  const TABS: {id:Tab;label:string}[] = [
    {id:"home",label:"Home"},{id:"insert",label:"Insert"},
    {id:"layout",label:"Layout"},{id:"table",label:"Table"},
  ];

  return (
    <div className="flex flex-col h-[calc(100vh-4rem)] bg-[#f3f3f3]">
      {/* Title bar */}
      <div className="flex items-center gap-3 px-4 py-2 bg-white border-b">
        <input value={fileName} onChange={e=>setFileName(e.target.value)}
          className="text-sm font-medium bg-transparent outline-none border-b border-transparent focus:border-gray-300 px-1"/>
        {dirty && <span className="text-xs text-gray-400">unsaved</span>}
        <div className="ml-auto flex items-center gap-2">
          <button onClick={()=>fileRef.current?.click()}
            className="inline-flex items-center gap-1.5 h-8 px-3 rounded bg-gray-100 hover:bg-gray-200 text-sm">
            <Upload className="h-4 w-4"/> Import Word
          </button>
          <button onClick={exportWord}
            className="inline-flex items-center gap-1.5 h-8 px-3 rounded bg-[#2b579a] text-white hover:bg-[#1e3f70] text-sm">
            <Download className="h-4 w-4"/> Save as Word
          </button>
          <button onClick={printDoc}
            className="inline-flex items-center gap-1.5 h-8 px-3 rounded bg-gray-100 hover:bg-gray-200 text-sm">
            <Printer className="h-4 w-4"/> Print / PDF
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex items-end gap-1 px-3 bg-white border-b">
        {TABS.map(t=>(
          <button key={t.id} onMouseDown={e=>e.preventDefault()} onClick={()=>setTab(t.id)}
            className={`px-4 py-1.5 text-sm rounded-t ${tab===t.id?"text-[#2b579a] font-medium border-b-2 border-[#2b579a]":"text-gray-600 hover:bg-gray-100"}`}>
            {t.label}
          </button>
        ))}
        <div className="ml-auto flex items-center gap-1 py-1">
          <Btn title="Zoom out" onClick={()=>setZoom(z=>Math.max(50,z-10))}><ZoomOut className="h-4 w-4"/></Btn>
          <span className="text-xs w-10 text-center">{zoom}%</span>
          <Btn title="Zoom in" onClick={()=>setZoom(z=>Math.min(200,z+10))}><ZoomIn className="h-4 w-4"/></Btn>
        </div>
      </div>

      {/* Ribbon */}
      <div className="flex flex-wrap items-center gap-1 px-3 py-2 bg-white border-b shadow-sm min-h-[56px]">
        {tab==="home" && <>
          <Btn title="New" onClick={newDocument}><FilePlus2 className="h-4 w-4"/></Btn>
          <Btn title="Undo (Ctrl+Z)" onClick={()=>exec("undo")}><Undo2 className="h-4 w-4"/></Btn>
          <Btn title="Redo (Ctrl+Y)" onClick={()=>exec("redo")}><Redo2 className="h-4 w-4"/></Btn>
          <Sep/>
          <select value={font} onChange={e=>applyFont(e.target.value)}
            className="h-8 rounded border border-gray-300 text-sm px-2 bg-white">
            {FONTS.map(f=><option key={f} value={f} style={{fontFamily:f}}>{f}</option>)}
          </select>
          <select value={size} onChange={e=>applyFontSize(e.target.value)}
            className="h-8 w-16 rounded border border-gray-300 text-sm px-2 bg-white">
            {SIZES.map(s=><option key={s} value={s}>{s}</option>)}
          </select>
          <Sep/>
          <Btn title="Bold (Ctrl+B)" onClick={()=>exec("bold")}><Bold className="h-4 w-4"/></Btn>
          <Btn title="Italic" onClick={()=>exec("italic")}><Italic className="h-4 w-4"/></Btn>
          <Btn title="Underline" onClick={()=>exec("underline")}><Underline className="h-4 w-4"/></Btn>
          <Btn title="Strikethrough" onClick={()=>exec("strikeThrough")}><Strikethrough className="h-4 w-4"/></Btn>
          <Btn title="Superscript" onClick={()=>exec("superscript")}><Superscript className="h-4 w-4"/></Btn>
          <Btn title="Subscript" onClick={()=>exec("subscript")}><Subscript className="h-4 w-4"/></Btn>
          <Sep/>
          <label title="Text colour" className="h-8 px-1 inline-flex items-center rounded hover:bg-gray-200 cursor-pointer">
            <Type className="h-4 w-4"/>
            <input type="color" className="w-5 h-5 ml-1 border-0 bg-transparent p-0 cursor-pointer"
              onChange={e=>exec("foreColor",e.target.value)}/>
          </label>
          <label title="Highlight" className="h-8 px-1 inline-flex items-center rounded hover:bg-gray-200 cursor-pointer">
            <Highlighter className="h-4 w-4"/>
            <input type="color" defaultValue="#ffff00" className="w-5 h-5 ml-1 border-0 bg-transparent p-0 cursor-pointer"
              onChange={e=>exec("hiliteColor",e.target.value)}/>
          </label>
          <Btn title="Clear formatting" onClick={()=>exec("removeFormat")}><Eraser className="h-4 w-4"/></Btn>
          <Sep/>
          <Btn title="Align left"   onClick={()=>exec("justifyLeft")}><AlignLeft    className="h-4 w-4"/></Btn>
          <Btn title="Center"       onClick={()=>exec("justifyCenter")}><AlignCenter  className="h-4 w-4"/></Btn>
          <Btn title="Align right"  onClick={()=>exec("justifyRight")}><AlignRight   className="h-4 w-4"/></Btn>
          <Btn title="Justify"      onClick={()=>exec("justifyFull")}><AlignJustify className="h-4 w-4"/></Btn>
          <Btn title="Bullets"      onClick={()=>exec("insertUnorderedList")}><List        className="h-4 w-4"/></Btn>
          <Btn title="Numbering"    onClick={()=>exec("insertOrderedList")}><ListOrdered  className="h-4 w-4"/></Btn>
          <Btn title="Decrease indent" onClick={()=>exec("outdent")}><Outdent className="h-4 w-4"/></Btn>
          <Btn title="Increase indent" onClick={()=>exec("indent")} ><Indent  className="h-4 w-4"/></Btn>
          <Sep/>
          <Btn title="Insert picture" onClick={()=>imageRef.current?.click()}><ImageIcon className="h-4 w-4"/></Btn>
        </>}

        {tab==="insert" && <>
          <Group label="Table"><Btn title="Insert table" onClick={insertTable}><Table2 className="h-4 w-4"/></Btn></Group>
          <Group label="Picture"><Btn title="Insert image" onClick={()=>imageRef.current?.click()}><ImageIcon className="h-4 w-4"/></Btn></Group>
          <Group label="Page break">
            <Btn title="Page break" onClick={()=>exec("insertHTML",`<div style="page-break-before:always;border-top:1px dashed #bbb;margin:16px 0"></div><p><br/></p>`)}>
              <span className="text-xs px-1">Break</span>
            </Btn>
          </Group>
          <Group label="Line">
            <Btn title="Horizontal line" onClick={()=>exec("insertHorizontalRule")}><Ruler className="h-4 w-4"/></Btn>
          </Group>
        </>}

        {tab==="layout" && <>
          <Group label="Margins">
            <select value={JSON.stringify(margins)}
              onChange={e=>{setMargins(JSON.parse(e.target.value));setKeepDocLayout(false);}}
              className="h-8 rounded border border-gray-300 text-sm px-2 bg-white">
              {Object.entries(MARGIN_PRESETS).map(([k,v])=>(
                <option key={k} value={JSON.stringify(v)}>{k} ({v[0]}")</option>
              ))}
              {!Object.values(MARGIN_PRESETS).some(v=>JSON.stringify(v)===JSON.stringify(margins))&&(
                <option value={JSON.stringify(margins)}>Custom</option>
              )}
            </select>
            <div className="flex flex-col gap-0.5">
              {(["Top","Right","Bottom","Left"] as const).map((lbl,i)=>(
                <label key={lbl} className="flex items-center gap-1 text-[11px]">
                  <span className="w-10 text-gray-600">{lbl}</span>
                  <input type="number" step="0.05" min="0" value={margins[i]}
                    onChange={e=>{const m=[...margins] as [number,number,number,number];m[i]=Number(e.target.value);setMargins(m);setKeepDocLayout(false);}}
                    className="w-14 h-5 rounded border border-gray-300 px-1"/>
                  <span className="text-gray-400">in</span>
                </label>
              ))}
            </div>
          </Group>
          <Group label="Orientation">
            <Btn title="Portrait"  active={!landscape} onClick={()=>{setLandscape(false);setKeepDocLayout(false);}}><RectangleVertical   className="h-4 w-4"/></Btn>
            <Btn title="Landscape" active={landscape}  onClick={()=>{setLandscape(true); setKeepDocLayout(false);}}><RectangleHorizontal className="h-4 w-4"/></Btn>
          </Group>
          <Group label="Size">
            <select value={paper} onChange={e=>{setPaper(e.target.value as keyof typeof PAPERS);setKeepDocLayout(false);}}
              className="h-8 rounded border border-gray-300 text-sm px-2 bg-white">
              {Object.entries(PAPERS).map(([k,v])=><option key={k} value={k}>{v.label}</option>)}
            </select>
          </Group>
          <Group label="Indent">
            <div className="flex flex-col gap-1">
              <Stepper label="Left"  value={0.1} unit='"' onDec={()=>bumpIndent("marginLeft",-0.1)}  onInc={()=>bumpIndent("marginLeft",0.1)}/>
              <Stepper label="Right" value={0.1} unit='"' onDec={()=>bumpIndent("marginRight",-0.1)} onInc={()=>bumpIndent("marginRight",0.1)}/>
            </div>
          </Group>
          <Group label="Spacing">
            <div className="flex flex-col gap-1">
              <Stepper label="Before" value={3} unit="pt" onDec={()=>bumpSpacing("marginTop",-3)}    onInc={()=>bumpSpacing("marginTop",3)}/>
              <Stepper label="After"  value={3} unit="pt" onDec={()=>bumpSpacing("marginBottom",-3)} onInc={()=>bumpSpacing("marginBottom",3)}/>
            </div>
          </Group>
          <Group label="Line spacing">
            <select defaultValue="" onChange={e=>e.target.value&&setLineSpacing(e.target.value)}
              className="h-8 rounded border border-gray-300 text-sm px-2 bg-white">
              <option value="">Choose…</option>
              <option value="1">1.0</option><option value="1.15">1.15</option>
              <option value="1.5">1.5</option><option value="2">2.0</option>
            </select>
          </Group>
          <Group label="Apply">
            <button onClick={applyPageSetup} className="h-8 px-3 rounded bg-[#2b579a] text-white text-sm hover:bg-[#1e3f70]">
              Apply to pages
            </button>
            {!keepDocLayout&&(
              <button onClick={()=>{setKeepDocLayout(true);toast.success("Original Word layout restored");}}
                className="h-8 px-3 rounded bg-gray-100 text-sm hover:bg-gray-200">Original</button>
            )}
          </Group>
        </>}

        {tab==="table" && <>
          <Group label="Insert"><Btn title="New table" onClick={insertTable}><Table2 className="h-4 w-4"/></Btn></Group>
          <Group label="Rows">
            <Btn title="Insert row above" onClick={()=>tableOp("rowAbove")}><span className="text-xs">↑</span><Rows3 className="h-4 w-4"/></Btn>
            <Btn title="Insert row below" onClick={()=>tableOp("rowBelow")}><Rows3 className="h-4 w-4"/><span className="text-xs">↓</span></Btn>
            <Btn title="Delete row"       onClick={()=>tableOp("row-")}><Rows3 className="h-4 w-4 text-red-500"/></Btn>
          </Group>
          <Group label="Columns">
            <Btn title="Insert column left"  onClick={()=>tableOp("colLeft")}><span className="text-xs">←</span><Columns3 className="h-4 w-4"/></Btn>
            <Btn title="Insert column right" onClick={()=>tableOp("colRight")}><Columns3 className="h-4 w-4"/><span className="text-xs">→</span></Btn>
            <Btn title="Delete column"       onClick={()=>tableOp("col-")}><Columns3 className="h-4 w-4 text-red-500"/></Btn>
          </Group>
          <Group label="Table"><Btn title="Delete table" onClick={()=>tableOp("del")}><Trash2 className="h-4 w-4 text-red-500"/></Btn></Group>
        </>}
      </div>

      {/* Canvas */}
      <div ref={canvasRef} className="relative flex-1 overflow-auto py-8" onScroll={()=>{updateHandles();syncImgBox();}}>
        <div style={{transform:`scale(${zoom/100})`,transformOrigin:"top center"}}>
          <div
            ref={editorRef}
            contentEditable
            suppressContentEditableWarning
            spellCheck={false}
            onInput={()=>{setDirty(true);updateHandles();syncImgBox();}}
            onMouseUp={e=>{
              updateHandles();
              const t = e.target as HTMLElement;
              if (t.tagName === "IMG") { selImgRef.current = t as HTMLImageElement; syncImgBox(); }
              else { selImgRef.current = null; setImgBox(null); }
            }}
            onKeyUp={()=>{updateHandles();syncImgBox();}}
            onPaste={e=>{
              const f = Array.from(e.clipboardData?.files ?? []).find(x=>x.type.startsWith("image/"));
              if (f) { e.preventDefault(); insertImage(f); }
            }}
            onDragOver={e=>{ if (Array.from(e.dataTransfer?.types ?? []).includes("Files")) e.preventDefault(); }}
            onDrop={e=>{
              const f = Array.from(e.dataTransfer?.files ?? []).find(x=>x.type.startsWith("image/"));
              if (!f) return;
              e.preventDefault();
              const r = (document as any).caretRangeFromPoint?.(e.clientX, e.clientY) as Range | undefined;
              if (r && editorRef.current?.contains(r.startContainer)) savedRange.current = r;
              insertImage(f);
            }}
            onBlur={()=>setTimeout(()=>setHandle(null),200)}
            className={`doc-surface mx-auto outline-none ${keepDocLayout?"":"custom-layout"}`}
            style={{width:paperW}}
          />
        </div>

        {/* + handles on active cell */}
        {handle&&(
          <>
            <button title="Insert column right" onMouseDown={e=>e.preventDefault()} onClick={()=>tableOp("colRight")}
              className="absolute z-20 h-5 w-5 rounded-full bg-white border border-[#2b579a] text-[#2b579a] shadow flex items-center justify-center hover:bg-[#2b579a] hover:text-white"
              style={{top:handle.top-24,left:handle.left+handle.width-10}}>
              <Plus className="h-3 w-3"/>
            </button>
            <button title="Insert row below" onMouseDown={e=>e.preventDefault()} onClick={()=>tableOp("rowBelow")}
              className="absolute z-20 h-5 w-5 rounded-full bg-white border border-[#2b579a] text-[#2b579a] shadow flex items-center justify-center hover:bg-[#2b579a] hover:text-white"
              style={{top:handle.top+handle.height-10,left:handle.left-24}}>
              <Plus className="h-3 w-3"/>
            </button>
            <button title="Insert row above" onMouseDown={e=>e.preventDefault()} onClick={()=>tableOp("rowAbove")}
              className="absolute z-20 h-5 w-5 rounded-full bg-white border border-gray-400 text-gray-500 shadow flex items-center justify-center hover:bg-gray-700 hover:text-white"
              style={{top:handle.top-10,left:handle.left-24}}>
              <Plus className="h-3 w-3"/>
            </button>
          </>
        )}

        {/* selected picture: resize box + quick actions */}
        {imgBox&&(
          <div className="pointer-events-none absolute z-20" style={{top:imgBox.top,left:imgBox.left,width:imgBox.width,height:imgBox.height}}>
            <div className="absolute inset-0 border-2 border-[#2b579a]"/>
            <div className="pointer-events-auto absolute left-0 top-full mt-2 flex items-center gap-1 rounded border bg-white px-1 py-0.5 text-xs shadow">
              <button type="button" onMouseDown={e=>e.preventDefault()} onClick={imgOriginalSize} className="rounded px-2 py-1 hover:bg-gray-100">Original size</button>
              <button type="button" onMouseDown={e=>e.preventDefault()} onClick={imgFitWidth} className="rounded px-2 py-1 hover:bg-gray-100">Fit width</button>
              <button type="button" title="Delete picture" onMouseDown={e=>e.preventDefault()} onClick={imgDelete} className="rounded px-2 py-1 text-red-600 hover:bg-red-50"><Trash2 className="h-3.5 w-3.5"/></button>
              <span className="px-1 tabular-nums text-gray-500">{Math.round(imgBox.width/(zoom/100))} × {Math.round(imgBox.height/(zoom/100))}</span>
            </div>
            <div onMouseDown={startImgResize} title="Drag to resize (ratio locked)"
              className="pointer-events-auto absolute -bottom-1.5 -right-1.5 h-3 w-3 cursor-nwse-resize rounded-sm border border-white bg-[#2b579a]"/>
          </div>
        )}

        {loading&&<p className="text-center text-sm text-gray-500 mt-4">Opening document…</p>}
      </div>

      <input ref={fileRef}  type="file" accept=".docx,.doc" hidden
        onChange={e=>{const f=e.target.files?.[0];if(f)importDocx(f);e.target.value="";}}/>
      <input ref={imageRef} type="file" accept="image/*" hidden
        onChange={e=>{const f=e.target.files?.[0];if(f)insertImage(f);e.target.value="";}}/>

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
          position: relative;
          overflow: visible;
        }
        .doc-surface .page {
          width: ${paperW}px;
          min-height: ${paperH}px;
          padding: ${margins[0]}in ${margins[1]}in ${margins[2]}in ${margins[3]}in;
        }
        .doc-surface.custom-layout .docx-wrapper > section.docx,
        .doc-surface.custom-layout > section.docx {
          width: ${paperW}px !important;
          min-height: ${paperH}px !important;
          padding: ${margins[0]}in ${margins[1]}in ${margins[2]}in ${margins[3]}in !important;
        }
        .doc-surface table  { border-collapse: collapse; }
        .doc-surface td, .doc-surface th { vertical-align: top; }
        /* Word images keep their own size (floating images sit in a 0x0 box,
           so max-width:100% would shrink them to nothing). Only images you
           insert yourself get max-width:100% (inline style). */
        .doc-surface .docx-wrapper img,
        .doc-surface .docx-wrapper svg { max-width: none; }
        .doc-surface img[data-broken] { outline: 1px dashed #cbd5e1; background: #f8fafc; }
        .doc-surface:focus  { outline: none; }
        .doc-surface td:hover { outline: 1px dashed rgba(43,87,154,.35); }
        /* Header / footer rendered by docx-preview */
        .doc-surface .docx-wrapper section.docx .header,
        .doc-surface .docx-wrapper section.docx .footer {
          display: block !important;
          visibility: visible !important;
          position: relative !important;
        }
        @media print {
          .doc-surface .page, .doc-surface section.docx { box-shadow:none; margin:0; }
        }
      `}</style>
    </div>
  );
}
