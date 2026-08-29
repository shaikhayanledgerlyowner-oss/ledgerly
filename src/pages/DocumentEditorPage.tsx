
Action: view_file({"path":"/app/frontend/src/pages/DocumentEditorPage.tsx"})
Observation: [Showing lines 1-815 of 815 total] /app/frontend/src/pages/DocumentEditorPage.tsx:
1|import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
2|import { useAuth } from "@/contexts/AuthContext";
3|import { supabase } from "@/integrations/supabase/client";
4|import { toast } from "sonner";
5|import { Input } from "@/components/ui/input";
6|import {
7|  FileText, Plus, Search, ArrowUpDown, Pencil, Copy, Trash2, X,
8|  ChevronRight, Upload, FileUp,
9|} from "lucide-react";
10|import { cn } from "@/lib/utils";
11|
12|declare const mammoth: any;
13|declare const pdfjsLib: any;
14|
15|interface Doc {
16|  id: string;
17|  title: string;
18|  content: string;
19|  updated_at: string;
20|}
21|
22|const FONTS = ["Aptos","Arial","Calibri","Cambria","Courier New","Georgia","Helvetica","Segoe UI","Times New Roman","Trebuchet MS","Verdana"];
23|const SIZES = [8,9,10,11,12,14,16,18,20,24,28,32,36,48,72];
24|const COLORS = ["#000000","#404040","#7f7f7f","#bfbfbf","#ffffff","#c00000","#ff0000","#ffc000","#ffff00","#92d050","#00b050","#00b0f0","#0070c0","#002060","#7030a0"];
25|const HIGHLIGHTS = ["#ffff00","#00ff00","#00ffff","#ff00ff","#ff9999","#c0c0c0","transparent"];
26|
27|const TABS = ["File","Home","Insert","Layout","Review","View"] as const;
28|type Tab = typeof TABS[number];
29|
30|const PAGE_W_PX = 816;   // 8.5in @ 96dpi
31|const PAGE_H_PX = 1056;  // 11in  @ 96dpi
32|const PAGE_PAD_PX = 96;  // 1in margins
33|
34|/* ═════════ small UI atoms — dark, Word-ribbon styled ═════════ */
35|function RBtn({ children, title, onClick, active, disabled, wide }: {
36|  children: React.ReactNode; title: string; onClick: () => void;
37|  active?: boolean; disabled?: boolean; wide?: boolean;
38|}) {
39|  return (
40|    <button type="button" title={title} aria-pressed={active} disabled={disabled}
41|      onMouseDown={e => e.preventDefault()}
42|      onClick={onClick}
43|      className={cn(
44|        "flex h-8 items-center justify-center gap-1 rounded text-sm transition-colors disabled:opacity-40 border",
45|        wide ? "px-2" : "w-8",
46|        active ? "border-white/30 bg-white/15 text-white" : "border-transparent text-white/70 hover:border-white/20 hover:bg-white/10 hover:text-white"
47|      )}>
48|      {children}
49|    </button>
50|  );
51|}
52|
53|function RGroup({ label, children }: { label: string; children: React.ReactNode }) {
54|  return (
55|    <div className="flex shrink-0 flex-col items-center gap-1 border-r border-white/10 px-2 py-1 last:border-r-0">
56|      <div className="flex flex-wrap items-center gap-0.5">{children}</div>
57|      <span className="text-[10px] uppercase tracking-wide text-white/40">{label}</span>
58|    </div>
59|  );
60|}
61|
62|function RPopover({ title, label, children }: {
63|  title: string; label: React.ReactNode; children: (close: () => void) => React.ReactNode;
64|}) {
65|  const [open, setOpen] = useState(false);
66|  const ref = useRef<HTMLDivElement>(null);
67|  useEffect(() => {
68|    if (!open) return;
69|    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
70|    document.addEventListener("mousedown", h);
71|    return () => document.removeEventListener("mousedown", h);
72|  }, [open]);
73|  return (
74|    <div ref={ref} className="relative">
75|      <RBtn title={title} wide onClick={() => setOpen(o => !o)} active={open}>
76|        {label}<span className="text-[9px] leading-none">▾</span>
77|      </RBtn>
78|      {open && (
79|        <div className="absolute left-0 top-9 z-50 min-w-40 rounded-md border border-white/10 bg-[#252525] p-2 shadow-xl">
80|          {children(() => setOpen(false))}
81|        </div>
82|      )}
83|    </div>
84|  );
85|}
86|
87|/* ═════════ Insert Table modal ═════════ */
88|function InsertTableModal({ onInsert, onClose }: { onInsert: (r: number, c: number) => void; onClose: () => void }) {
89|  const [rows, setRows] = useState(3);
90|  const [cols, setCols] = useState(3);
91|  return (
92|    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60" onClick={onClose}>
93|      <div className="w-80 rounded-lg border border-white/10 bg-[#252525] p-4 text-white" onClick={e => e.stopPropagation()}>
94|        <h3 className="mb-3 text-sm font-semibold">Insert Table</h3>
95|        <div className="space-y-3">
96|          <div className="flex items-center gap-3">
97|            <label className="w-20 text-sm text-white/70">Rows:</label>
98|            <Input type="number" min={1} max={30} value={rows} onChange={e => setRows(Number(e.target.value))} className="w-24 bg-white/5 text-white" />
99|          </div>
100|          <div className="flex items-center gap-3">
101|            <label className="w-20 text-sm text-white/70">Columns:</label>
102|            <Input type="number" min={1} max={10} value={cols} onChange={e => setCols(Number(e.target.value))} className="w-24 bg-white/5 text-white" />
103|          </div>
104|        </div>
105|        <div className="mt-4 flex justify-end gap-2">
106|          <button onClick={onClose} className="rounded border border-white/20 px-3 py-1.5 text-sm hover:bg-white/10">Cancel</button>
107|          <button onClick={() => onInsert(rows, cols)} className="rounded bg-blue-600 px-3 py-1.5 text-sm font-medium hover:bg-blue-500">Insert</button>
108|        </div>
109|      </div>
110|    </div>
111|  );
112|}
113|
114|/* ═════════ Word text-box fragment merge + positioning strip (docx import fidelity) ═════════ */
115|function getMaxFontSizePx(el: HTMLElement): number {
116|  let max = 0;
117|  const consider = (e: HTMLElement) => {
118|    const fs = e.style?.fontSize;
119|    if (fs) {
120|      const m = fs.match(/([\d.]+)\s*(px|pt)/);
121|      if (m) { let v = parseFloat(m[1]); if (m[2] === "pt") v *= 1.333; if (v > max) max = v; }
122|    }
123|  };
124|  consider(el);
125|  el.querySelectorAll<HTMLElement>("*").forEach(consider);
126|  return max;
127|}
128|
129|function mergeLogoFragments(root: HTMLElement) {
130|  const paragraphs = Array.from(root.querySelectorAll("p"));
131|  let i = 0;
132|  while (i < paragraphs.length) {
133|    const group: HTMLElement[] = [];
134|    let j = i;
135|    while (j < paragraphs.length) {
136|      const p = paragraphs[j];
137|      if (!p.isConnected) { j++; continue; }
138|      const text = p.textContent?.trim() || "";
139|      const fontSize = getMaxFontSizePx(p);
140|      const isLogoLike = text.length > 0 && text.length <= 25 && fontSize >= 18;
141|      const isConsecutive = group.length === 0 ||
142|        (p.previousElementSibling === group[group.length - 1] && p.parentElement === group[group.length - 1].parentElement);
143|      if (isLogoLike && isConsecutive) { group.push(p); j++; } else break;
144|    }
145|    if (group.length >= 2) {
146|      const wrapper = document.createElement("p");
147|      wrapper.style.cssText = "display:flex;align-items:baseline;flex-wrap:wrap;margin:.2em 0;";
148|      group.forEach(p => {
149|        const span = document.createElement("span");
150|        span.style.cssText = "display:inline-block;white-space:nowrap;";
151|        span.innerHTML = p.innerHTML;
152|        wrapper.appendChild(span);
153|      });
154|      group[0].parentElement?.insertBefore(wrapper, group[0]);
155|      group.forEach(p => p.remove());
156|    }
157|    i = j > i ? j : i + 1;
158|  }
159|}
160|
161|function cleanImportedDom(dom: Document) {
162|  dom.querySelectorAll<HTMLElement>("[style]").forEach(el => {
163|    const s = el.style;
164|    if (s.position === "absolute" || s.position === "fixed") s.position = "static";
165|    if (s.top) s.top = "";
166|    if (s.left) s.left = "";
167|    if (s.right) s.right = "";
168|    if (s.bottom) s.bottom = "";
169|    if (s.marginTop && parseFloat(s.marginTop) < 0) s.marginTop = "0";
170|    if (s.marginLeft && parseFloat(s.marginLeft) < 0) s.marginLeft = "0";
171|    if (s.textIndent && parseFloat(s.textIndent) < 0) s.textIndent = "0";
172|    if (s.transform) s.transform = "";
173|  });
174|  mergeLogoFragments(dom.body);
175|  dom.querySelectorAll("table").forEach(t => { (t as HTMLElement).style.cssText = "border-collapse:collapse;width:100%;margin:8px 0;"; });
176|  dom.querySelectorAll("td,th").forEach(c => { (c as HTMLElement).style.cssText += ";border:1.5px solid #9ca3af;padding:6px 10px;vertical-align:top;word-break:break-word;"; });
177|  dom.querySelectorAll("th").forEach(c => { (c as HTMLElement).style.background = "#f3f4f6"; (c as HTMLElement).style.fontWeight = "600"; });
178|  dom.querySelectorAll("img").forEach(img => { (img as HTMLElement).style.cssText = "max-width:100%;height:auto;display:block;margin:8px 0;cursor:pointer;"; });
179|}
180|
181|/* ═════════ Pagination display ═════════
182|   contentEditable cannot natively "flow" content across separate
183|   fixed-size page boxes the way Word's own layout engine does — any
184|   attempt to physically split one editable surface into N boxes on
185|   every keystroke constantly scrambles the cursor/selection mid-typing,
186|   which is worse than not paginating at all. Instead we keep ONE
187|   continuous, reliable editable surface (so typing/formatting/selection
188|   always behaves correctly), and compute + display how many Word-page
189|   equivalents (816×1056px, 1in margins) the current content would
190|   occupy — this is measured from the same `.ld-editor` node's actual
191|   rendered height, so it tracks length accurately as you type. */
192|function usePageCount(editorRef: React.RefObject<HTMLDivElement>, contentVersion: number) {
193|  const [pageCount, setPageCount] = useState(1);
194|  useEffect(() => {
195|    const el = editorRef.current;
196|    if (!el) return;
197|    const usableH = PAGE_H_PX - PAGE_PAD_PX * 2;
198|    const total = el.scrollHeight;
199|    setPageCount(Math.max(1, Math.ceil(total / usableH)));
200|  }, [contentVersion, editorRef]);
201|  return pageCount;
202|}
203|
204|/* ════════════════════════════════════════════
205|   MAIN EDITOR
206|═══════════════════════════════════════════ */
207|export default function DocumentEditorPage() {
208|  const { profile } = useAuth();
209|  const editorRef = useRef<HTMLDivElement>(null);
210|  const wordRef = useRef<HTMLInputElement>(null);
211|  const pdfRef = useRef<HTMLInputElement>(null);
212|  const imgRef = useRef<HTMLInputElement>(null);
213|  const saveTimer = useRef<NodeJS.Timeout | null>(null);
214|
215|  const [docs, setDocs] = useState<Doc[]>([]);
216|  const [selectedDoc, setSelectedDoc] = useState<Doc | null>(null);
217|  const [title, setTitle] = useState("Untitled document");
218|  const [saving, setSaving] = useState(false);
219|  const [importing, setImporting] = useState(false);
220|  const [contentVersion, setContentVersion] = useState(0);
221|
222|  const [deleteOpen, setDeleteOpen] = useState(false);
223|  const [deleteTarget, setDeleteTarget] = useState<Doc | null>(null);
224|
225|  const [tab, setTab] = useState<Tab>("Home");
226|  const [zoom, setZoom] = useState(100);
227|  const [showTableModal, setShowTableModal] = useState(false);
228|  const [fmt, setFmt] = useState<Record<string, boolean>>({});
229|  const [font, setFont] = useState("Aptos");
230|  const [size, setSize] = useState(12);
231|  const [stats, setStats] = useState({ words: 0, chars: 0 });
232|
233|  const [drawerOpen, setDrawerOpen] = useState(false);
234|  const [docSearch, setDocSearch] = useState("");
235|  const [docSort, setDocSort] = useState<"recent" | "name">("recent");
236|  const [renamingId, setRenamingId] = useState<string | null>(null);
237|  const [renameValue, setRenameValue] = useState("");
238|  const dragStartX = useRef<number | null>(null);
239|
240|  const pageCount = usePageCount(editorRef, contentVersion);
241|
242|  /* ── Load docs ── */
243|  const loadDocs = useCallback(async () => {
244|    if (!profile) return;
245|    const { data } = await supabase.from("user_documents").select("*").eq("user_id", profile.id).order("updated_at", { ascending: false });
246|    setDocs((data ?? []) as Doc[]);
247|  }, [profile]);
248|  useEffect(() => { loadDocs(); }, [loadDocs]);
249|
250|  const filteredSortedDocs = useMemo(() => {
251|    let list = docs;
252|    if (docSearch.trim()) { const q = docSearch.trim().toLowerCase(); list = list.filter(d => d.title.toLowerCase().includes(q)); }
253|    list = [...list];
254|    if (docSort === "name") list.sort((a, b) => a.title.localeCompare(b.title));
255|    else list.sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime());
256|    return list;
257|  }, [docs, docSearch, docSort]);
258|
259|  /* ── Selection persistence ── */
260|  const savedRangeRef = useRef<Range | null>(null);
261|  useEffect(() => {
262|    const handler = () => {
263|      const sel = window.getSelection();
264|      if (!sel || sel.rangeCount === 0) return;
265|      const range = sel.getRangeAt(0);
266|      if (editorRef.current && editorRef.current.contains(range.commonAncestorContainer)) {
267|        savedRangeRef.current = range.cloneRange();
268|      }
269|    };
270|    document.addEventListener("selectionchange", handler);
271|    return () => document.removeEventListener("selectionchange", handler);
272|  }, []);
273|  const restoreSelection = (): Range | null => {
274|    const editor = editorRef.current;
275|    if (!editor) return null;
276|    editor.focus();
277|    const sel = window.getSelection();
278|    if (!sel) return null;
279|    if (savedRangeRef.current && editor.contains(savedRangeRef.current.startContainer)) {
280|      sel.removeAllRanges(); sel.addRange(savedRangeRef.current); return savedRangeRef.current;
281|    }
282|    const range = document.createRange();
283|    range.selectNodeContents(editor); range.collapse(false);
284|    sel.removeAllRanges(); sel.addRange(range);
285|    return range;
286|  };
287|
288|  const updateStats = useCallback(() => {
289|    const el = editorRef.current;
290|    if (!el) return;
291|    const text = el.innerText.replace(/\u00a0/g, " ");
292|    const words = text.trim() ? text.trim().split(/\s+/).length : 0;
293|    setStats({ words, chars: text.replace(/\n/g, "").length });
294|  }, []);
295|
296|  const syncFormatState = useCallback(() => {
297|    const q = (c: string) => { try { return document.queryCommandState(c); } catch { return false; } };
298|    setFmt({
299|      bold: q("bold"), italic: q("italic"), underline: q("underline"), strikeThrough: q("strikeThrough"),
300|      insertUnorderedList: q("insertUnorderedList"), insertOrderedList: q("insertOrderedList"),
301|      justifyLeft: q("justifyLeft"), justifyCenter: q("justifyCenter"), justifyRight: q("justifyRight"), justifyFull: q("justifyFull"),
302|    });
303|  }, []);
304|
305|  /* ── Select / new / duplicate / rename doc ── */
306|  const selectDoc = (doc: Doc) => {
307|    setSelectedDoc(doc); setTitle(doc.title);
308|    requestAnimationFrame(() => {
309|      if (editorRef.current) { editorRef.current.innerHTML = doc.content || ""; editorRef.current.focus(); }
310|      updateStats(); setContentVersion(v => v + 1);
311|    });
312|  };
313|  const createNewDoc = async () => {
314|    if (!profile) return;
315|    const { data, error } = await supabase.from("user_documents").insert({ user_id: profile.id, title: "Untitled document", content: "<h1>Untitled document</h1><p><br></p>" }).select("*").single();
316|    if (error) return toast.error(error.message);
317|    toast.success("New document created!"); await loadDocs(); selectDoc(data as Doc);
318|  };
319|  const duplicateDoc = async (doc: Doc) => {
320|    if (!profile) return;
321|    const { data, error } = await supabase.from("user_documents").insert({ user_id: profile.id, title: doc.title + " (Copy)", content: doc.content }).select("*").single();
322|    if (error) return toast.error(error.message);
323|    toast.success("Document duplicated!"); await loadDocs(); selectDoc(data as Doc);
324|  };
325|  const startRename = (doc: Doc) => { setRenamingId(doc.id); setRenameValue(doc.title); };
326|  const commitRename = async (doc: Doc) => {
327|    const newTitle = renameValue.trim() || doc.title;
328|    setRenamingId(null);
329|    if (newTitle === doc.title) return;
330|    const { error } = await supabase.from("user_documents").update({ title: newTitle }).eq("id", doc.id);
331|    if (error) return toast.error(error.message);
332|    setDocs(prev => prev.map(d => d.id === doc.id ? { ...d, title: newTitle } : d));
333|    if (selectedDoc?.id === doc.id) setTitle(newTitle);
334|  };
335|
336|  /* ── Save ── */
337|  const autoSave = useCallback(async () => {
338|    if (!selectedDoc || !profile) return;
339|    const content = editorRef.current?.innerHTML || "";
340|    const { error } = await supabase.from("user_documents").update({ title, content, updated_at: new Date().toISOString() }).eq("id", selectedDoc.id);
341|    if (!error) setDocs(prev => prev.map(d => d.id === selectedDoc.id ? { ...d, title, content } : d));
342|  }, [selectedDoc, title, profile]);
343|  const handleSaveNow = async () => { setSaving(true); await autoSave(); setSaving(false); toast.success("Saved!"); };
344|  const triggerSave = () => {
345|    if (saveTimer.current) clearTimeout(saveTimer.current);
346|    saveTimer.current = setTimeout(autoSave, 1200);
347|    updateStats(); setContentVersion(v => v + 1);
348|  };
349|
350|  const handleDelete = async () => {
351|    if (!deleteTarget) return;
352|    await supabase.from("user_documents").delete().eq("id", deleteTarget.id);
353|    toast.success("Deleted!"); setDeleteOpen(false); setDeleteTarget(null);
354|    if (selectedDoc?.id === deleteTarget.id) { setSelectedDoc(null); if (editorRef.current) editorRef.current.innerHTML = ""; }
355|    await loadDocs();
356|  };
357|
358|  /* ── Format commands ── */
359|  const exec = (cmd: string, val?: string) => { restoreSelection(); document.execCommand(cmd, false, val); syncFormatState(); triggerSave(); };
360|  const insertHTML = (html: string) => { restoreSelection(); document.execCommand("insertHTML", false, html); triggerSave(); };
361|  const applyBlock = (tag: string) => { restoreSelection(); document.execCommand("formatBlock", false, `<${tag}>`); syncFormatState(); triggerSave(); };
362|  const applyStyleToSelection = (apply: (span: HTMLElement) => void) => {
363|    const editor = editorRef.current; if (!editor) return;
364|    restoreSelection();
365|    const sel = window.getSelection(); if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return;
366|    const range = sel.getRangeAt(0);
367|    const span = document.createElement("span"); apply(span);
368|    try {
369|      span.appendChild(range.extractContents()); range.insertNode(span);
370|      sel.removeAllRanges(); const r = document.createRange(); r.selectNodeContents(span); sel.addRange(r);
371|    } catch {}
372|    triggerSave();
373|  };
374|
375|  const insertTable = (rows: number, cols: number) => {
376|    const th = Array.from({ length: cols }, (_, i) => `<th style="border:1.5px solid #9ca3af;padding:6px 10px;background:#f3f4f6;font-weight:600;">Header ${i + 1}</th>`).join("");
377|    const body = Array.from({ length: Math.max(0, rows - 1) }, () => `<tr>${Array.from({ length: cols }, () => `<td style="border:1.5px solid #9ca3af;padding:6px 10px;">&nbsp;</td>`).join("")}</tr>`).join("");
378|    insertHTML(`<table style="border-collapse:collapse;width:100%;margin:8px 0;"><tbody><tr>${th}</tr>${body}</tbody></table><p><br></p>`);
379|    setShowTableModal(false);
380|    toast.success("Table inserted!");
381|  };
382|
383|  const insertLink = () => {
384|    const url = window.prompt("Link URL", "https://"); if (!url) return;
385|    const sel = window.getSelection();
386|    if (sel && sel.toString()) exec("createLink", url);
387|    else insertHTML(`<a href="${url}">${url}</a>`);
388|  };
389|
390|  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
391|    const files = Array.from(e.target.files || []); if (!files.length) return;
392|    restoreSelection();
393|    files.forEach(file => {
394|      const reader = new FileReader();
395|      reader.onload = ev => { insertHTML(`<img src="${ev.target?.result}" style="max-width:100%;height:auto;display:block;margin:8px 0;" />`); };
396|      reader.readAsDataURL(file);
397|    });
398|    e.target.value = "";
399|  };
400|
401|  /* ── Table row/column "+" ── */
402|  const findTableAt = (node: Node | null): HTMLTableElement | null => {
403|    let el: Node | null = node;
404|    while (el) { if (el instanceof HTMLTableElement) return el; el = el.parentNode; }
405|    return null;
406|  };
407|  const [activeTable, setActiveTable] = useState<HTMLTableElement | null>(null);
408|  const updateActiveTable = () => {
409|    const sel = window.getSelection();
410|    if (!sel || sel.rangeCount === 0) { setActiveTable(null); return; }
411|    setActiveTable(findTableAt(sel.getRangeAt(0).startContainer));
412|  };
413|  const addTableRow = (table: HTMLTableElement) => {
414|    const rows = Array.from(table.rows); if (!rows.length) return;
415|    const lastRow = rows[rows.length - 1];
416|    const newRow = document.createElement("tr");
417|    Array.from(lastRow.cells).forEach(cell => {
418|      const isTh = cell.tagName === "TH";
419|      const newCell = document.createElement(isTh ? "th" : "td");
420|      newCell.setAttribute("style", cell.getAttribute("style") || "");
421|      if (isTh) { newCell.style.background = "#ffffff"; newCell.style.fontWeight = "normal"; }
422|      newCell.innerHTML = "&nbsp;"; newRow.appendChild(newCell);
423|    });
424|    lastRow.after(newRow); triggerSave();
425|  };
426|  const addTableColumn = (table: HTMLTableElement) => {
427|    Array.from(table.rows).forEach(row => {
428|      const lastCell = row.cells[row.cells.length - 1]; if (!lastCell) return;
429|      const isTh = lastCell.tagName === "TH";
430|      const newCell = document.createElement(isTh ? "th" : "td");
431|      newCell.setAttribute("style", lastCell.getAttribute("style") || "");
432|      newCell.innerHTML = "&nbsp;"; lastCell.after(newCell);
433|    });
434|    triggerSave();
435|  };
436|
437|  /* ── Word import — proper mammoth-based conversion, NOT raw text.
438|     The garbage "PK□□□□..." text happens when a .docx (which is actually
439|     a zip archive — "PK" is the zip file signature) gets read as plain
440|     text instead of being unzipped and converted by mammoth. This always
441|     routes through mammoth.convertToHtml, which properly unzips the
442|     .docx and extracts real formatted HTML — never raw bytes. ── */
443|  const handleWordUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
444|    const files = Array.from(e.target.files || []); if (!files.length) return;
445|    e.target.value = "";
446|    if (typeof mammoth === "undefined") { toast.error("Word converter not loaded — please refresh the page."); return; }
447|
448|    setImporting(true);
449|    for (const file of files) {
450|      try {
451|        const buf = await file.arrayBuffer();
452|        const result = await mammoth.convertToHtml({ arrayBuffer: buf }, {
453|          styleMap: ["p[style-name='Heading 1'] => h1:fresh", "p[style-name='Heading 2'] => h2:fresh", "p[style-name='Heading 3'] => h3:fresh"],
454|        });
455|        const dom = new DOMParser().parseFromString(result.value, "text/html");
456|        cleanImportedDom(dom);
457|
458|        const imgCount = dom.querySelectorAll("img").length;
459|        const textLen = (dom.body.textContent || "").trim().length;
460|        if (imgCount >= 5 && textLen < 2000) {
461|          toast("This document looks like it has a logo/letterhead built from positioned images — for a pixel-perfect match, export it as PDF from Word and use \"Import PDF\" instead.", { duration: 7000 });
462|        }
463|
464|        const styledHtml = dom.body.innerHTML;
465|        const newTitle = file.name.replace(/\.docx?$/i, "");
466|        const { data, error } = await supabase.from("user_documents").insert({ user_id: profile?.id, title: newTitle, content: styledHtml }).select("*").single();
467|        if (error) throw error;
468|        await loadDocs(); selectDoc(data as Doc);
469|        toast.success(`"${newTitle}" imported!`);
470|      } catch (err: any) {
471|        toast.error(`Failed: "${file.name}" — ${err?.message || "Unknown error"}`);
472|      }
473|    }
474|    setImporting(false);
475|  };
476|
477|  /* ── PDF import — renders real pixels via pdf.js, pixel-perfect but
478|     not text-editable (no HTML tool can guarantee both at once for
479|     documents with floating/positioned graphics — see prior chat). ── */
480|  const handlePdfUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
481|    const files = Array.from(e.target.files || []); if (!files.length) return;
482|    e.target.value = "";
483|    if (typeof pdfjsLib === "undefined") { toast.error("PDF renderer not loaded — please refresh the page."); return; }
484|
485|    setImporting(true);
486|    for (const file of files) {
487|      try {
488|        const buf = await file.arrayBuffer();
489|        const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
490|        let pagesHtml = "";
491|        for (let i = 1; i <= pdf.numPages; i++) {
492|          const page = await pdf.getPage(i);
493|          const viewport = page.getViewport({ scale: 2 });
494|          const canvas = document.createElement("canvas");
495|          canvas.width = viewport.width; canvas.height = viewport.height;
496|          const ctx = canvas.getContext("2d")!;
497|          await page.render({ canvasContext: ctx, viewport }).promise;
498|          const dataUrl = canvas.toDataURL("image/jpeg", 0.92);
499|          pagesHtml += `<div class="pdf-page" style="page-break-after:always;margin:0 0 16px 0;"><img src="${dataUrl}" style="width:100%;display:block;" /></div>`;
500|        }
501|        const newTitle = file.name.replace(/\.pdf$/i, "");
502|        const { data, error } = await supabase.from("user_documents").insert({ user_id: profile?.id, title: newTitle, content: pagesHtml }).select("*").single();
503|        if (error) throw error;
504|        await loadDocs(); selectDoc(data as Doc);
505|        toast.success(`"${newTitle}" imported (${pdf.numPages} page${pdf.numPages > 1 ? "s" : ""})`);
506|      } catch (err: any) {
507|        toast.error(`Failed: "${file.name}" — ${err?.message || "Unknown error"}`);
508|      }
509|    }
510|    setImporting(false);
511|  };
512|
513|  /* ── Export ── */
514|  const exportCSS = `body{font-family:${font};width:210mm;margin:0 auto;padding:25.4mm;line-height:1.5;font-size:${size}pt}
515|    h1{font-size:2em;font-weight:700;margin:.6em 0 .3em}h2{font-size:1.5em;font-weight:700;margin:.6em 0 .3em}h3{font-size:1.2em;font-weight:600;margin:.6em 0 .3em}
516|    p{margin:0 0 8pt 0}table{border-collapse:collapse;width:100%;margin:8px 0}td,th{border:1.5px solid #9ca3af;padding:6px 10px;vertical-align:top}
517|    th{background:#f3f4f6;font-weight:600}ul{list-style:disc;padding-left:1.5em}ol{list-style:decimal;padding-left:1.5em}img{max-width:100%;height:auto}
518|    .pdf-page{page-break-after:always}@media print{body{padding:10mm}}`;
519|  const fullHtml = (body: string) => `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>${title}</title><style>${exportCSS}</style></head><body>${body}</body></html>`;
520|  const dl = (content: string, type: string, name: string) => {
521|    Object.assign(document.createElement("a"), { href: URL.createObjectURL(new Blob([content], { type })), download: name }).click();
522|  };
523|  const printDoc = () => {
524|    const w = window.open("", "_blank"); if (!w) return;
525|    w.document.write(fullHtml(editorRef.current?.innerHTML || "")); w.document.close(); w.print();
526|  };
527|
528|  const preserveSelection = (e: React.MouseEvent) => e.preventDefault();
529|
530|  /* ── Ribbon content per tab ── */
531|  const ribbon = () => {
532|    switch (tab) {
533|      case "File":
534|        return (
535|          <>
536|            <RGroup label="Document">
537|              <RBtn title="New document" wide onClick={createNewDoc}>New</RBtn>
538|              <RBtn title="Import Word" wide onClick={() => wordRef.current?.click()}>Import Word</RBtn>
539|              <RBtn title="Import PDF" wide onClick={() => pdfRef.current?.click()}>Import PDF</RBtn>
540|              <RBtn title="Save now" wide onClick={handleSaveNow}>{saving ? "Saving…" : "Save"}</RBtn>
541|            </RGroup>
542|            <RGroup label="Export">
543|              <RBtn title="Download HTML" wide onClick={() => dl(fullHtml(editorRef.current?.innerHTML || ""), "text/html", `${title}.html`)}>HTML</RBtn>
544|              <RBtn title="Print / Save as PDF" wide onClick={printDoc}>Print / PDF</RBtn>
545|              <RBtn title="Download TXT" wide onClick={() => dl(editorRef.current?.innerText || "", "text/plain", `${title}.txt`)}>TXT</RBtn>
546|            </RGroup>
547|            <RGroup label="Info">
548|              <span className="px-2 text-xs text-white/50">{stats.words} words · {stats.chars} characters · {pageCount} page{pageCount > 1 ? "s" : ""}</span>
549|            </RGroup>
550|          </>
551|        );
552|      case "Home":
553|        return (
554|          <>
555|            <RGroup label="Undo">
556|              <RBtn title="Undo" onClick={() => exec("undo")}>↶</RBtn>
557|              <RBtn title="Redo" onClick={() => exec("redo")}>↷</RBtn>
558|            </RGroup>
559|            <RGroup label="Font">
560|              <select value={font} onMouseDown={preserveSelection} onChange={e => { setFont(e.target.value); exec("fontName", e.target.value); }} className="h-8 rounded border border-white/15 bg-white/5 px-1 text-xs text-white">
561|                {FONTS.map(f => <option key={f} value={f} className="bg-[#252525]">{f}</option>)}
562|              </select>
563|              <select value={size} onMouseDown={preserveSelection} onChange={e => { const px = Number(e.target.value); setSize(px); applyStyleToSelection(s => s.style.fontSize = `${px}pt`); }} className="h-8 w-14 rounded border border-white/15 bg-white/5 px-1 text-xs text-white">
564|                {SIZES.map(s => <option key={s} value={s} className="bg-[#252525]">{s}</option>)}
565|              </select>
566|              <RBtn title="Bold" active={fmt.bold} onClick={() => exec("bold")}><b>B</b></RBtn>
567|              <RBtn title="Italic" active={fmt.italic} onClick={() => exec("italic")}><i>I</i></RBtn>
568|              <RBtn title="Underline" active={fmt.underline} onClick={() => exec("underline")}><u>U</u></RBtn>
569|              <RBtn title="Strikethrough" active={fmt.strikeThrough} onClick={() => exec("strikeThrough")}><s>S</s></RBtn>
570|              <RPopover title="Text color" label={<span className="text-red-500">A</span>}>
571|                {close => (<div className="grid grid-cols-5 gap-1">{COLORS.map(c => (
572|                  <button key={c} onMouseDown={preserveSelection} onClick={() => { exec("foreColor", c); close(); }} className="h-6 w-6 rounded border border-white/20" style={{ background: c }} />
573|                ))}</div>)}
574|              </RPopover>
575|              <RPopover title="Highlight" label={<span className="rounded bg-yellow-300/80 px-1 text-black">H</span>}>
576|                {close => (<div className="grid grid-cols-4 gap-1">{HIGHLIGHTS.map(c => (
577|                  <button key={c} onMouseDown={preserveSelection} onClick={() => { exec("hiliteColor", c); close(); }} className="h-6 w-6 rounded border border-white/20" style={{ background: c === "transparent" ? "#fff" : c }} />
578|                ))}</div>)}
579|              </RPopover>
580|              <RBtn title="Clear formatting" onClick={() => exec("removeFormat")}>⌫A</RBtn>
581|            </RGroup>
582|            <RGroup label="Paragraph">
583|              <RBtn title="Bullet list" active={fmt.insertUnorderedList} onClick={() => exec("insertUnorderedList")}>•</RBtn>
584|              <RBtn title="Numbered list" active={fmt.insertOrderedList} onClick={() => exec("insertOrderedList")}>1.</RBtn>
585|              <RBtn title="Align left" active={fmt.justifyLeft} onClick={() => exec("justifyLeft")}>≡</RBtn>
586|              <RBtn title="Align center" active={fmt.justifyCenter} onClick={() => exec("justifyCenter")}>⋮≡</RBtn>
587|              <RBtn title="Align right" active={fmt.justifyRight} onClick={() => exec("justifyRight")}>≡⋮</RBtn>
588|              <RBtn title="Justify" active={fmt.justifyFull} onClick={() => exec("justifyFull")}>▤</RBtn>
589|            </RGroup>
590|            <RGroup label="Styles">
591|              {[["Normal", "p"], ["H1", "h1"], ["H2", "h2"], ["H3", "h3"]].map(([label, block]) => (
592|                <RBtn key={block} title={`${label} style`} wide onClick={() => applyBlock(block)}>{label}</RBtn>
593|              ))}
594|            </RGroup>
595|          </>
596|        );
597|      case "Insert":
598|        return (
599|          <>
600|            <RGroup label="Tables">
601|              <RBtn title="Insert table" wide onClick={() => { restoreSelection(); setShowTableModal(true); }}>Table</RBtn>
602|              {activeTable && (
603|                <>
604|                  <RBtn title="Add row" wide onClick={() => addTableRow(activeTable)}>+ Row</RBtn>
605|                  <RBtn title="Add column" wide onClick={() => addTableColumn(activeTable)}>+ Column</RBtn>
606|                </>
607|              )}
608|            </RGroup>
609|            <RGroup label="Illustrations">
610|              <RBtn title="Insert image" wide onClick={() => imgRef.current?.click()}>Picture</RBtn>
611|            </RGroup>
612|            <RGroup label="Links">
613|              <RBtn title="Insert link" wide onClick={insertLink}>Link</RBtn>
614|              <RBtn title="Remove link" wide onClick={() => exec("unlink")}>Unlink</RBtn>
615|            </RGroup>
616|            <RGroup label="Text">
617|              <RBtn title="Page break" wide onClick={() => insertHTML('<div style="page-break-after:always;"></div>')}>Page break</RBtn>
618|            </RGroup>
619|          </>
620|        );
621|      case "Layout":
622|        return (
623|          <RGroup label="Zoom">
624|            <RBtn title="Zoom out" onClick={() => setZoom(z => Math.max(50, z - 10))}>−</RBtn>
625|            <span className="w-12 text-center text-xs text-white/60">{zoom}%</span>
626|            <RBtn title="Zoom in" onClick={() => setZoom(z => Math.min(200, z + 10))}>+</RBtn>
627|            <RBtn title="Reset zoom" wide onClick={() => setZoom(100)}>100%</RBtn>
628|          </RGroup>
629|        );
630|      case "Review":
631|        return (
632|          <RGroup label="Info">
633|            <span className="px-2 text-xs text-white/50">{stats.words} words · {pageCount} page{pageCount > 1 ? "s" : ""}</span>
634|          </RGroup>
635|        );
636|      case "View":
637|        return (
638|          <RGroup label="Zoom">
639|            <RBtn title="Zoom out" onClick={() => setZoom(z => Math.max(50, z - 10))}>−</RBtn>
640|            <span className="w-12 text-center text-xs text-white/60">{zoom}%</span>
641|            <RBtn title="Zoom in" onClick={() => setZoom(z => Math.min(200, z + 10))}>+</RBtn>
642|          </RGroup>
643|        );
644|    }
645|  };
646|
647|  return (
648|    <div className="flex h-[calc(100vh-56px)] overflow-hidden bg-[#1e1e1e] text-white">
649|      {showTableModal && <InsertTableModal onInsert={insertTable} onClose={() => setShowTableModal(false)} />}
650|
651|      {deleteOpen && (
652|        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60" onClick={() => setDeleteOpen(false)}>
653|          <div className="w-80 rounded-lg border border-white/10 bg-[#252525] p-4 text-white" onClick={e => e.stopPropagation()}>
654|            <h3 className="mb-2 text-sm font-semibold">Delete Document?</h3>
655|            <p className="mb-4 text-xs text-white/60">"{deleteTarget?.title}" will be permanently deleted.</p>
656|            <div className="flex justify-end gap-2">
657|              <button onClick={() => setDeleteOpen(false)} className="rounded border border-white/20 px-3 py-1.5 text-sm hover:bg-white/10">Cancel</button>
658|              <button onClick={handleDelete} className="rounded bg-red-600 px-3 py-1.5 text-sm font-medium hover:bg-red-500">Delete</button>
659|            </div>
660|          </div>
661|        </div>
662|      )}
663|
664|      <input ref={wordRef} type="file" accept=".doc,.docx" multiple className="hidden" onChange={handleWordUpload} />
665|      <input ref={pdfRef} type="file" accept=".pdf" multiple className="hidden" onChange={handlePdfUpload} />
666|      <input ref={imgRef} type="file" accept="image/*" multiple className="hidden" onChange={handleImageUpload} />
667|
668|      {/* Drawer tab */}
669|      <div onClick={() => setDrawerOpen(o => !o)}
670|        onPointerDown={e => { dragStartX.current = e.clientX; }}
671|        onPointerMove={e => { if (dragStartX.current !== null && e.clientX - dragStartX.current > 24) { setDrawerOpen(true); dragStartX.current = null; } }}
672|        onPointerUp={() => { dragStartX.current = null; }}
673|        className="fixed left-0 top-1/2 z-40 flex h-16 w-4 -translate-y-1/2 cursor-grab items-center justify-center rounded-r-lg bg-blue-600/90 shadow-md transition-colors hover:bg-blue-600 active:cursor-grabbing"
674|        title="Documents">
675|        <ChevronRight className={cn("h-4 w-4 text-white transition-transform", drawerOpen && "rotate-180")} />
676|      </div>
677|      {drawerOpen && <div className="fixed inset-0 z-30 bg-black/40" onClick={() => setDrawerOpen(false)} />}
678|      <div className={cn("fixed left-0 top-0 z-40 flex h-full w-72 flex-col border-r border-white/10 bg-[#232323] text-white shadow-2xl transition-transform duration-200", drawerOpen ? "translate-x-0" : "-translate-x-full")}>
679|        <div className="space-y-2 border-b border-white/10 p-3">
680|          <div className="flex items-center justify-between">
681|            <h3 className="text-sm font-semibold">Documents</h3>
682|            <button onClick={() => setDrawerOpen(false)} className="rounded p-1 hover:bg-white/10"><X className="h-4 w-4" /></button>
683|          </div>
684|          <div className="flex gap-1.5">
685|            <button onClick={() => { createNewDoc(); setDrawerOpen(false); }} className="flex h-7 flex-1 items-center justify-center gap-1 rounded bg-blue-600 text-xs hover:bg-blue-500"><Plus className="h-3.5 w-3.5" />New</button>
686|            <button onClick={() => wordRef.current?.click()} disabled={importing} className="flex h-7 flex-1 items-center justify-center gap-1 rounded border border-white/15 text-xs hover:bg-white/10"><Upload className="h-3.5 w-3.5" />Word</button>
687|            <button onClick={() => pdfRef.current?.click()} disabled={importing} className="flex h-7 flex-1 items-center justify-center gap-1 rounded border border-white/15 text-xs hover:bg-white/10"><FileUp className="h-3.5 w-3.5" />PDF</button>
688|          </div>
689|          <div className="relative">
690|            <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-white/40" />
691|            <Input value={docSearch} onChange={e => setDocSearch(e.target.value)} placeholder="Search documents…" className="h-7 border-white/15 bg-white/5 pl-7 text-xs text-white placeholder:text-white/40" />
692|          </div>
693|          <button onClick={() => setDocSort(s => s === "recent" ? "name" : "recent")} className="flex items-center gap-1 text-xs text-white/50 hover:text-white">
694|            <ArrowUpDown className="h-3 w-3" /> Sort: {docSort === "recent" ? "Recent" : "Name"}
695|          </button>
696|        </div>
697|        <div className="flex-1 space-y-0.5 overflow-y-auto p-2">
698|          {filteredSortedDocs.length === 0 && <p className="py-6 text-center text-xs text-white/40">{docSearch ? "No documents match your search" : "No documents yet"}</p>}
699|          {filteredSortedDocs.map(doc => (
700|            <div key={doc.id} onClick={() => { selectDoc(doc); setDrawerOpen(false); }}
701|              className={cn("group flex cursor-pointer items-center justify-between rounded-lg px-2 py-1.5 transition-colors", selectedDoc?.id === doc.id ? "bg-blue-600/20 text-blue-300" : "hover:bg-white/5")}>
702|              <div className="flex min-w-0 flex-1 items-center gap-1.5">
703|                <FileText className="h-3.5 w-3.5 shrink-0" />
704|                {renamingId === doc.id ? (
705|                  <Input autoFocus value={renameValue} onClick={e => e.stopPropagation()} onChange={e => setRenameValue(e.target.value)}
706|                    onBlur={() => commitRename(doc)} onKeyDown={e => { if (e.key === "Enter") commitRename(doc); if (e.key === "Escape") setRenamingId(null); }}
707|                    className="h-6 border-white/15 bg-white/5 px-1 text-xs text-white" />
708|                ) : <span className="truncate text-xs">{doc.title}</span>}
709|              </div>
710|              <div className="flex shrink-0 items-center opacity-0 group-hover:opacity-100">
711|                <button onClick={e => { e.stopPropagation(); startRename(doc); }} className="rounded p-1 hover:bg-white/10" title="Rename"><Pencil className="h-3 w-3" /></button>
712|                <button onClick={e => { e.stopPropagation(); duplicateDoc(doc); }} className="rounded p-1 hover:bg-white/10" title="Duplicate"><Copy className="h-3 w-3" /></button>
713|                <button onClick={e => { e.stopPropagation(); setDeleteTarget(doc); setDeleteOpen(true); }} className="rounded p-1 hover:bg-red-500/20" title="Delete"><Trash2 className="h-3 w-3 text-red-400" /></button>
714|              </div>
715|            </div>
716|          ))}
717|        </div>
718|      </div>
719|
720|      {/* Main column */}
721|      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
722|        {/* Title bar */}
723|        <div className="flex items-center gap-3 border-b border-white/10 bg-[#232323] px-4 py-2">
724|          <span className="rounded bg-blue-600 px-2 py-0.5 text-xs font-bold">W</span>
725|          {selectedDoc ? (
726|            <Input value={title} onChange={e => setTitle(e.target.value)} onBlur={handleSaveNow}
727|              className="h-7 min-w-0 flex-1 border-transparent bg-transparent px-2 text-sm font-medium text-white focus-visible:ring-0" placeholder="Document title…" />
728|          ) : <span className="flex-1 text-sm text-white/50">No document open</span>}
729|          <span className="hidden text-xs text-white/40 sm:inline">{saving ? "Saving…" : "Autosaved"}</span>
730|        </div>
731|
732|        {/* Tabs */}
733|        <div className="flex gap-1 border-b border-white/10 bg-[#232323] px-3">
734|          {TABS.map(t => (
735|            <button key={t} onClick={() => setTab(t)} className={cn("px-3 py-2 text-sm transition-colors", tab === t ? "border-b-2 border-blue-500 font-medium text-white" : "text-white/50 hover:text-white")}>
736|              {t}
737|            </button>
738|          ))}
739|        </div>
740|
741|        {/* Ribbon */}
742|        <div className="sticky top-0 z-30 flex items-stretch gap-1 overflow-x-auto border-b border-white/10 bg-[#2b2b2b] px-2 py-1">
743|          {ribbon()}
744|        </div>
745|
746|        {/* Page area */}
747|        {selectedDoc ? (
748|          <div className="flex-1 overflow-y-auto bg-[#0f0f0f] py-8">
749|            <style>{`
750|              .ld-editor{outline:none;line-height:1.5;color:#111;}
751|              .ld-editor:empty:before{content:"Start typing here…";color:#9ca3af;pointer-events:none;}
752|              .ld-editor h1{font-size:2em;font-weight:700;margin:.6em 0 .3em;}
753|              .ld-editor h2{font-size:1.5em;font-weight:700;margin:.6em 0 .3em;}
754|              .ld-editor h3{font-size:1.2em;font-weight:600;margin:.6em 0 .3em;}
755|              .ld-editor ul{list-style:disc !important;padding-left:1.6em !important;margin:4px 0;}
756|              .ld-editor ol{list-style:decimal !important;padding-left:1.6em !important;margin:4px 0;}
757|              .ld-editor li{display:list-item !important;margin:2px 0;}
758|              .ld-editor table{border-collapse:collapse;width:100%;margin:8px 0;}
759|              .ld-editor td,.ld-editor th{border:1.5px solid #9ca3af;padding:6px 10px;vertical-align:top;min-width:40px;word-break:break-word;}
760|              .ld-editor th{background:#f3f4f6;font-weight:600;}
761|              .ld-editor img{max-width:100%;height:auto;display:block;margin:8px 0;}
762|              .ld-editor a{color:#2563eb;text-decoration:underline;}
763|              .ld-editor p{margin:0 0 8pt 0;min-height:1.4em;}
764|            `}</style>
765|
766|            <div style={{ display: "flex", justifyContent: "center", transform: `scale(${zoom / 100})`, transformOrigin: "top center" }}>
767|              <div style={{
768|                background: "#ffffff", width: PAGE_W_PX, minHeight: PAGE_H_PX, padding: PAGE_PAD_PX,
769|                boxShadow: "0 1px 6px rgba(0,0,0,0.4)", fontFamily: font, fontSize: size + "pt", boxSizing: "border-box",
770|              }}>
771|                <div
772|                  ref={editorRef}
773|                  contentEditable suppressContentEditableWarning
774|                  className="ld-editor"
775|                  onInput={triggerSave}
776|                  onKeyUp={() => { syncFormatState(); updateActiveTable(); }}
777|                  onMouseUp={() => { syncFormatState(); updateActiveTable(); }}
778|                  onClick={updateActiveTable}
779|                />
780|              </div>
781|            </div>
782|
783|            {pageCount > 1 && (
784|              <div className="mx-auto mt-4 flex justify-center gap-2" style={{ width: PAGE_W_PX * (zoom / 100) }}>
785|                {Array.from({ length: pageCount }, (_, i) => (
786|                  <div key={i} className="rounded border border-white/10 bg-white/5 px-2 py-1 text-[10px] text-white/40">Page {i + 1} of {pageCount}</div>
787|                ))}
788|              </div>
789|            )}
790|          </div>
791|        ) : (
792|          <div className="flex flex-1 flex-col items-center justify-center bg-[#0f0f0f] p-8 text-center">
793|            <FileText className="mb-4 h-16 w-16 text-white/20" />
794|            <h2 className="mb-2 text-xl font-semibold text-white">No document selected</h2>
795|            <p className="mb-6 text-sm text-white/50">Drag the arrow on the left edge to open your documents, or start a new one</p>
796|            <div className="flex flex-wrap justify-center gap-3">
797|              <button onClick={createNewDoc} className="flex items-center gap-2 rounded bg-blue-600 px-4 py-2 text-sm font-medium hover:bg-blue-500"><Plus className="h-4 w-4" />New Document</button>
798|              <button onClick={() => wordRef.current?.click()} className="flex items-center gap-2 rounded border border-white/15 px-4 py-2 text-sm hover:bg-white/10"><Upload className="h-4 w-4" />Import Word</button>
799|              <button onClick={() => pdfRef.current?.click()} className="flex items-center gap-2 rounded border border-white/15 px-4 py-2 text-sm hover:bg-white/10"><FileUp className="h-4 w-4" />Import PDF</button>
800|            </div>
801|          </div>
802|        )}
803|
804|        {/* Status bar */}
805|        <div className="sticky bottom-0 flex flex-wrap items-center gap-4 border-t border-white/10 bg-[#232323] px-4 py-1.5 text-xs text-white/50">
806|          <span>{stats.words} words</span>
807|          <span>{stats.chars} characters</span>
808|          <span>{pageCount} page{pageCount > 1 ? "s" : ""}</span>
809|          <span className="ml-auto">{zoom}%</span>
810|        </div>
811|      </div>
812|    </div>
813|  );
814|}
815|
[End of file]
