import React, { useEffect, useRef, useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import {
  Download, Upload, ZoomIn, ZoomOut, Loader2,
  FileText, ChevronLeft, ChevronRight, X, Check
} from "lucide-react";

const PDFJS_CDN = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js";
const PDFJS_WORKER = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
const PDFLIB_CDN = "https://unpkg.com/pdf-lib@1.17.1/dist/pdf-lib.min.js";

async function loadScript(src: string): Promise<void> {
  if (document.querySelector(`script[src="${src}"]`)) return;
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = src; s.onload = () => resolve(); s.onerror = () => reject(new Error(`Failed: ${src}`));
    document.head.appendChild(s);
  });
}
async function getPdfJs(): Promise<any> {
  await loadScript(PDFJS_CDN);
  const lib = (window as any).pdfjsLib;
  lib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER;
  return lib;
}
async function getPdfLib(): Promise<any> {
  await loadScript(PDFLIB_CDN);
  return (window as any).PDFLib;
}

interface TextBlock {
  id: string;
  pageIndex: number;
  originalText: string;
  editedText: string;
  pdfX: number; pdfY: number; pdfW: number; pdfH: number; pdfFontSize: number;
  canvasX: number; canvasY: number; canvasW: number; canvasH: number;
  bold: boolean;
  // The exact pixel snapshot of background BEFORE any text was drawn
  bgSnapshot: ImageData | null;
}

export default function PdfEditorPage() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // Two canvases: base (original PDF render) + working (what user sees)
  const baseCanvasRef = useRef<HTMLCanvasElement>(document.createElement("canvas"));

  const [pdfBytes, setPdfBytes] = useState<ArrayBuffer | null>(null);
  const [pdfDoc, setPdfDoc] = useState<any>(null);
  const [numPages, setNumPages] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [scale, setScale] = useState(1.4);
  const [loading, setLoading] = useState(false);
  const [rendering, setRendering] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [fileName, setFileName] = useState("document");
  const [textBlocks, setTextBlocks] = useState<TextBlock[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");

  // Apply all current edits onto working canvas using base canvas as background
  const applyAllEdits = useCallback((blocks: TextBlock[]) => {
    const canvas = canvasRef.current;
    const base = baseCanvasRef.current;
    if (!canvas || !base) return;
    const ctx = canvas.getContext("2d")!;

    // Start fresh from original PDF render
    ctx.drawImage(base, 0, 0);

    // For each edited block: restore background patch then draw new text
    for (const b of blocks) {
      if (b.editedText === b.originalText) continue;

      // Restore exact background pixels from base canvas
      const baseCtx = base.getContext("2d")!;
      const patch = baseCtx.getImageData(
        Math.floor(b.canvasX - 2), Math.floor(b.canvasY - 2),
        Math.ceil(b.canvasW + 24), Math.ceil(b.canvasH + 6)
      );
      ctx.putImageData(patch, Math.floor(b.canvasX - 2), Math.floor(b.canvasY - 2));

      // Draw new text
      const fs = Math.max(b.canvasH * 0.80, 7);
      ctx.font = `${b.bold ? "bold " : ""}${fs}px Arial`;
      ctx.fillStyle = "#000000";
      ctx.textBaseline = "top";
      ctx.fillText(b.editedText, b.canvasX, b.canvasY + 1);
    }
  }, []);

  const renderPage = useCallback(async (doc: any, pageNum: number, sc: number, prevBlocks?: TextBlock[]) => {
    if (!doc || !canvasRef.current) return;
    setRendering(true);
    try {
      const page = await doc.getPage(pageNum);
      const viewport = page.getViewport({ scale: sc });
      const canvas = canvasRef.current;
      const base = baseCanvasRef.current;
      const ctx = canvas.getContext("2d")!;
      const baseCtx = base.getContext("2d")!;

      canvas.width = viewport.width;
      canvas.height = viewport.height;
      base.width = viewport.width;
      base.height = viewport.height;

      // Render PDF to base canvas (this is the "clean" original)
      await page.render({ canvasContext: baseCtx, viewport }).promise;

      // Copy base to working canvas
      ctx.drawImage(base, 0, 0);

      // Extract text positions
      const textContent = await page.getTextContent();
      const blocks: TextBlock[] = [];

      for (let i = 0; i < textContent.items.length; i++) {
        const item = textContent.items[i] as any;
        if (!item.str?.trim()) continue;
        const tx = item.transform;
        const pdfX = tx[4], pdfY = tx[5];
        const pdfFontSize = Math.abs(tx[3]) || 12;
        const pdfW = item.width || pdfFontSize * item.str.length * 0.55;
        const pdfH = item.height || pdfFontSize * 1.3;

        const [cx1, cy1] = viewport.convertToViewportPoint(pdfX, pdfY);
        const [cx2, cy2] = viewport.convertToViewportPoint(pdfX + pdfW, pdfY - pdfH);
        const canvasX = Math.min(cx1, cx2);
        const canvasY = Math.min(cy1, cy2);
        const canvasW = Math.max(Math.abs(cx2 - cx1), 10);
        const canvasH = Math.max(Math.abs(cy2 - cy1), pdfFontSize * sc * 0.9);

        const id = `${pageNum}-${i}`;
        const prev = prevBlocks?.find(b => b.id === id);

        blocks.push({
          id, pageIndex: pageNum - 1,
          originalText: item.str,
          editedText: prev?.editedText ?? item.str,
          pdfX, pdfY, pdfW, pdfH, pdfFontSize,
          canvasX, canvasY, canvasW, canvasH,
          bold: item.fontName?.toLowerCase().includes("bold") ?? false,
          bgSnapshot: null,
        });
      }

      setTextBlocks(blocks);

      // Apply any existing edits
      const edited = blocks.filter(b => b.editedText !== b.originalText);
      if (edited.length > 0) applyAllEdits(blocks);

    } finally {
      setRendering(false);
    }
  }, [applyAllEdits]);

  useEffect(() => {
    if (pdfDoc) renderPage(pdfDoc, currentPage, scale, textBlocks);
  }, [pdfDoc, currentPage, scale]);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.type !== "application/pdf") { toast.error("PDF file upload karo"); return; }
    e.target.value = "";
    setLoading(true); setEditingId(null); setTextBlocks([]);
    setFileName(file.name.replace(/\.pdf$/i, ""));
    try {
      const bytes = await file.arrayBuffer();
      setPdfBytes(bytes.slice(0));
      const pdfjsLib = await getPdfJs();
      const doc = await pdfjsLib.getDocument({ data: bytes.slice(0) }).promise;
      setPdfDoc(doc); setNumPages(doc.numPages); setCurrentPage(1);
      toast.success("PDF load ho gaya — kisi bhi text pe click karo edit karne ke liye!");
    } catch (err: any) {
      toast.error("PDF load failed: " + err.message);
    } finally { setLoading(false); }
  };

  const handleCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (editingId) { commitEdit(); return; }
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const clickX = (e.clientX - rect.left) * scaleX;
    const clickY = (e.clientY - rect.top) * scaleY;

    const hit = textBlocks.find(b =>
      clickX >= b.canvasX - 4 && clickX <= b.canvasX + b.canvasW + 4 &&
      clickY >= b.canvasY - 2 && clickY <= b.canvasY + b.canvasH + 2
    );

    if (hit) {
      // Restore background patch on working canvas so original text disappears
      const ctx = canvas.getContext("2d")!;
      const baseCtx = baseCanvasRef.current.getContext("2d")!;
      const patch = baseCtx.getImageData(
        Math.floor(hit.canvasX - 2), Math.floor(hit.canvasY - 2),
        Math.ceil(hit.canvasW + 24), Math.ceil(hit.canvasH + 6)
      );
      ctx.putImageData(patch, Math.floor(hit.canvasX - 2), Math.floor(hit.canvasY - 2));

      setEditingId(hit.id);
      setEditValue(hit.editedText);
    }
  };

  const commitEdit = () => {
    if (!editingId) return;
    const updated = textBlocks.map(b => b.id === editingId ? { ...b, editedText: editValue } : b);
    setTextBlocks(updated);
    setEditingId(null);
    applyAllEdits(updated);
  };

  const cancelEdit = () => {
    setEditingId(null);
    applyAllEdits(textBlocks);
  };

  const handleDownload = async () => {
    if (!pdfBytes) return;
    setDownloading(true);
    try {
      const PDFLib = await getPdfLib();
      const { PDFDocument, rgb, StandardFonts } = PDFLib;
      const pdfLibDoc = await PDFDocument.load(pdfBytes);
      const pages = pdfLibDoc.getPages();
      const font = await pdfLibDoc.embedFont(StandardFonts.Helvetica);
      const boldFont = await pdfLibDoc.embedFont(StandardFonts.HelveticaBold);

      for (const block of textBlocks) {
        if (block.editedText === block.originalText) continue;
        const page = pages[block.pageIndex];
        const { height: pageH } = page.getSize();

        // Get background color at that location by sampling from base canvas
        const base = baseCanvasRef.current;
        const baseCtx = base.getContext("2d")!;
        // Sample a few pixels to find background color
        const sampleX = Math.floor(block.canvasX);
        const sampleY = Math.floor(block.canvasY);
        let bgR = 1, bgG = 1, bgB = 1;
        try {
          // Sample pixels above/below the text for background
          const above = baseCtx.getImageData(sampleX, Math.max(0, sampleY - 3), 1, 1);
          bgR = above.data[0] / 255;
          bgG = above.data[1] / 255;
          bgB = above.data[2] / 255;
        } catch (e) { bgR = bgG = bgB = 1; }

        // Cover original text with sampled background color
        page.drawRectangle({
          x: block.pdfX - 1,
          y: block.pdfY - block.pdfH - 1,
          width: block.pdfW + 8,
          height: block.pdfH + 3,
          color: rgb(bgR, bgG, bgB),
          opacity: 1,
        });

        // Draw new text
        page.drawText(block.editedText, {
          x: block.pdfX,
          y: block.pdfY - block.pdfH * 0.15,
          size: Math.max(block.pdfFontSize, 6),
          font: block.bold ? boldFont : font,
          color: rgb(0, 0, 0),
          maxWidth: block.pdfW + 60,
        });
      }

      const bytes = await pdfLibDoc.save();
      const blob = new Blob([bytes], { type: "application/pdf" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a"); a.href = url; a.download = `${fileName}-edited.pdf`; a.click();
      URL.revokeObjectURL(url);
      toast.success("PDF download ho gaya!");
    } catch (err: any) {
      toast.error("Download failed: " + err.message);
    } finally { setDownloading(false); }
  };

  const editedCount = textBlocks.filter(b => b.editedText !== b.originalText).length;
  const editingBlock = textBlocks.find(b => b.id === editingId);

  return (
    <div className="animate-fade-in space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-2xl font-display font-bold flex items-center gap-2">
          <FileText className="h-6 w-6" /> PDF Editor
        </h1>
        <div className="flex gap-2 flex-wrap items-center">
          {pdfDoc && (
            <>
              {editedCount > 0 && (
                <span className="text-xs bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400 px-2 py-1 rounded-full font-medium">
                  {editedCount} edit{editedCount > 1 ? "s" : ""} made
                </span>
              )}
              <Button variant="outline" size="sm" onClick={() => setScale(s => Math.max(0.5, +(s - 0.2).toFixed(1)))}>
                <ZoomOut className="h-4 w-4" />
              </Button>
              <span className="text-sm text-muted-foreground w-12 text-center">{Math.round(scale * 100)}%</span>
              <Button variant="outline" size="sm" onClick={() => setScale(s => Math.min(3, +(s + 0.2).toFixed(1)))}>
                <ZoomIn className="h-4 w-4" />
              </Button>
              <Button size="sm" className="gap-2" onClick={handleDownload} disabled={downloading}>
                {downloading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                Download PDF
              </Button>
            </>
          )}
          <Button variant="outline" size="sm" className="gap-2" onClick={() => fileInputRef.current?.click()} disabled={loading}>
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
            {pdfDoc ? "Change PDF" : "Upload PDF"}
          </Button>
          <input ref={fileInputRef} type="file" accept="application/pdf" className="hidden" onChange={handleFileChange} />
        </div>
      </div>

      {!pdfDoc && !loading && (
        <div
          className="border-2 border-dashed border-border rounded-2xl flex flex-col items-center justify-center py-20 gap-4 cursor-pointer hover:border-primary/50 hover:bg-muted/30 transition-all"
          onClick={() => fileInputRef.current?.click()}
        >
          <div className="h-16 w-16 rounded-2xl bg-muted flex items-center justify-center">
            <FileText className="h-8 w-8 text-muted-foreground" />
          </div>
          <div className="text-center">
            <p className="font-semibold text-lg">PDF upload karo edit karne ke liye</p>
            <p className="text-sm text-muted-foreground mt-1">Kisi bhi text pe click karo — bilkul Word jaisi editing</p>
          </div>
          <Button variant="outline" className="gap-2"><Upload className="h-4 w-4" /> PDF Choose Karo</Button>
        </div>
      )}

      {loading && (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <span className="ml-3 text-muted-foreground">PDF load ho raha hai...</span>
        </div>
      )}

      {pdfDoc && numPages > 1 && (
        <div className="flex items-center justify-center gap-3">
          <Button variant="outline" size="sm" onClick={() => { setEditingId(null); setCurrentPage(p => Math.max(1, p - 1)); }} disabled={currentPage === 1}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="text-sm font-medium">Page {currentPage} of {numPages}</span>
          <Button variant="outline" size="sm" onClick={() => { setEditingId(null); setCurrentPage(p => Math.min(numPages, p + 1)); }} disabled={currentPage === numPages}>
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      )}

      {pdfDoc && !rendering && (
        <p className="text-xs text-muted-foreground text-center">👆 Kisi bhi text pe click karo edit karne ke liye</p>
      )}

      {pdfDoc && (
        <div className="relative overflow-auto rounded-xl border border-border shadow-lg bg-white">
          {rendering && (
            <div className="absolute inset-0 z-10 flex items-center justify-center bg-white/70 rounded-xl">
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
            </div>
          )}
          <div className="relative inline-block">
            <canvas
              ref={canvasRef}
              style={{ maxWidth: "100%", cursor: editingId ? "default" : "text", display: "block" }}
              onClick={handleCanvasClick}
            />
            {/* Floating input */}
            {editingId && editingBlock && canvasRef.current && (() => {
              const canvas = canvasRef.current!;
              const rect = canvas.getBoundingClientRect();
              const dX = rect.width / canvas.width;
              const dY = rect.height / canvas.height;
              const b = editingBlock;
              const left = b.canvasX * dX - 2;
              const top = b.canvasY * dY - 2;
              const width = Math.max(b.canvasW * dX + 24, 80);
              const height = Math.max(b.canvasH * dY + 4, 16);
              const fontSize = Math.max(b.canvasH * 0.80 * dY, 7);
              return (
                <div className="absolute z-20" style={{ left, top }} onClick={e => e.stopPropagation()}>
                  <input
                    autoFocus
                    value={editValue}
                    onChange={e => setEditValue(e.target.value)}
                    onKeyDown={e => { if (e.key === "Enter") commitEdit(); if (e.key === "Escape") cancelEdit(); }}
                    style={{
                      fontSize, height, width,
                      fontWeight: b.bold ? "bold" : "normal",
                      padding: "0 2px", lineHeight: 1,
                      background: "rgba(255,255,255,0.92)",
                      border: "2px solid #3b82f6",
                      borderRadius: 3, outline: "none",
                      boxShadow: "0 2px 8px rgba(59,130,246,0.25)",
                      display: "block", color: "#000",
                    }}
                  />
                  <div className="flex gap-1 mt-1">
                    <button onClick={commitEdit} className="bg-blue-500 text-white text-xs px-2 py-0.5 rounded flex items-center gap-1 hover:bg-blue-600 shadow">
                      <Check className="h-3 w-3" /> Done
                    </button>
                    <button onClick={cancelEdit} className="bg-gray-100 text-gray-600 text-xs px-2 py-0.5 rounded flex items-center gap-1 hover:bg-gray-200 shadow">
                      <X className="h-3 w-3" /> Cancel
                    </button>
                  </div>
                </div>
              );
            })()}
          </div>
        </div>
      )}
    </div>
  );
}
