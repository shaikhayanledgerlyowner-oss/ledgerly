import React, { useEffect, useRef, useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import {
  Download, Upload, X, ZoomIn, ZoomOut, Loader2,
  FileText, ChevronLeft, ChevronRight, Check
} from "lucide-react";

// ─── CDN Loaders ────────────────────────────────────────────────
const PDFJS_CDN = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js";
const PDFJS_WORKER = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
const PDFLIB_CDN = "https://unpkg.com/pdf-lib@1.17.1/dist/pdf-lib.min.js";

async function loadScript(src: string): Promise<void> {
  if (document.querySelector(`script[src="${src}"]`)) return;
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = src;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error(`Failed to load ${src}`));
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

// ─── Types ───────────────────────────────────────────────────────
interface TextBlock {
  id: string;
  pageIndex: number;
  originalText: string;
  editedText: string;
  x: number; // pdf coords
  y: number;
  width: number;
  height: number;
  fontSize: number;
  fontName: string;
  // canvas coords (computed per render)
  canvasX: number;
  canvasY: number;
  canvasW: number;
  canvasH: number;
  color: [number, number, number];
}

// ─── Main Component ──────────────────────────────────────────────
export default function PdfEditorPage() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);

  const [pdfBytes, setPdfBytes] = useState<ArrayBuffer | null>(null);
  const [pdfDoc, setPdfDoc] = useState<any>(null); // pdfjsLib doc
  const [numPages, setNumPages] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [scale, setScale] = useState(1.4);
  const [loading, setLoading] = useState(false);
  const [rendering, setRendering] = useState(false);
  const [downloading, setDownloading] = useState(false);

  const [textBlocks, setTextBlocks] = useState<TextBlock[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [fileName, setFileName] = useState("document");

  // Render current page to canvas + extract text blocks
  const renderPage = useCallback(async (doc: any, pageNum: number, sc: number) => {
    if (!doc || !canvasRef.current) return;
    setRendering(true);
    try {
      const page = await doc.getPage(pageNum);
      const viewport = page.getViewport({ scale: sc });

      const canvas = canvasRef.current;
      const ctx = canvas.getContext("2d")!;
      canvas.width = viewport.width;
      canvas.height = viewport.height;

      await page.render({ canvasContext: ctx, viewport }).promise;

      // Extract text items
      const textContent = await page.getTextContent();
      const blocks: TextBlock[] = [];

      for (const item of textContent.items as any[]) {
        if (!item.str?.trim()) continue;

        const tx = item.transform;
        // transform: [scaleX, skewX, skewY, scaleY, translateX, translateY]
        const pdfX = tx[4];
        const pdfY = tx[5];
        const pdfFontSize = Math.abs(tx[3]) || Math.abs(tx[0]) || 12;
        const pdfW = item.width || pdfFontSize * item.str.length * 0.6;
        const pdfH = item.height || pdfFontSize * 1.2;

        // Convert PDF coords to canvas coords
        const canvasPt = viewport.convertToViewportPoint(pdfX, pdfY);
        const canvasPt2 = viewport.convertToViewportPoint(pdfX + pdfW, pdfY - pdfH);

        const canvasX = Math.min(canvasPt[0], canvasPt2[0]);
        const canvasY = Math.min(canvasPt[1], canvasPt2[1]);
        const canvasW = Math.abs(canvasPt2[0] - canvasPt[0]);
        const canvasH = Math.abs(canvasPt2[1] - canvasPt[1]);

        blocks.push({
          id: `${pageNum}-${blocks.length}`,
          pageIndex: pageNum - 1,
          originalText: item.str,
          editedText: item.str,
          x: pdfX,
          y: pdfY,
          width: pdfW,
          height: pdfH,
          fontSize: pdfFontSize,
          fontName: item.fontName || "Helvetica",
          canvasX, canvasY, canvasW: Math.max(canvasW, 20), canvasH: Math.max(canvasH, pdfFontSize * sc * 1.2),
          color: [0, 0, 0],
        });
      }

      setTextBlocks(blocks);
    } finally {
      setRendering(false);
    }
  }, []);

  // Re-render when page or scale changes
  useEffect(() => {
    if (pdfDoc) renderPage(pdfDoc, currentPage, scale);
  }, [pdfDoc, currentPage, scale]);

  // Load PDF file
  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.type !== "application/pdf") { toast.error("Please upload a PDF file"); return; }
    e.target.value = "";
    setLoading(true);
    setEditingId(null);
    setTextBlocks([]);
    setFileName(file.name.replace(/\.pdf$/i, ""));
    try {
      const bytes = await file.arrayBuffer();
      setPdfBytes(bytes);
      const pdfjsLib = await getPdfJs();
      const doc = await pdfjsLib.getDocument({ data: bytes.slice(0) }).promise;
      setPdfDoc(doc);
      setNumPages(doc.numPages);
      setCurrentPage(1);
      toast.success(`PDF loaded — ${doc.numPages} page(s). Click any text to edit!`);
    } catch (err: any) {
      toast.error("Failed to load PDF: " + err.message);
    } finally {
      setLoading(false);
    }
  };

  // Click on overlay → find which text block was clicked
  const handleOverlayClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (editingId) return; // already editing
    const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const clickY = e.clientY - rect.top;

    // Find block under click
    const hit = textBlocks.find((b) =>
      clickX >= b.canvasX - 4 &&
      clickX <= b.canvasX + b.canvasW + 4 &&
      clickY >= b.canvasY - 4 &&
      clickY <= b.canvasY + b.canvasH + 4
    );

    if (hit) {
      setEditingId(hit.id);
      setEditValue(hit.editedText);
    }
  };

  const commitEdit = () => {
    if (!editingId) return;
    setTextBlocks((prev) =>
      prev.map((b) => b.id === editingId ? { ...b, editedText: editValue } : b)
    );
    setEditingId(null);
  };

  const cancelEdit = () => {
    setEditingId(null);
  };

  // Download: rebuild PDF with edited text using pdf-lib
  const handleDownload = async () => {
    if (!pdfBytes) return;
    setDownloading(true);
    try {
      const PDFLib = await getPdfLib();
      const { PDFDocument, rgb, StandardFonts } = PDFLib;

      const pdfLibDoc = await PDFDocument.load(pdfBytes);
      const pages = pdfLibDoc.getPages();

      // Embed fonts
      const helvetica = await pdfLibDoc.embedFont(StandardFonts.Helvetica);
      const helveticaBold = await pdfLibDoc.embedFont(StandardFonts.HelveticaBold);

      // For each edited block, draw white rect over original then draw new text
      for (const block of textBlocks) {
        if (block.editedText === block.originalText) continue;
        const page = pages[block.pageIndex];
        const { height: pageH } = page.getSize();

        // White out original
        page.drawRectangle({
          x: block.x - 1,
          y: block.y - block.height - 2,
          width: block.width + 10,
          height: block.height + 4,
          color: rgb(1, 1, 1),
          opacity: 1,
        });

        // Draw new text
        const fontSize = Math.max(block.fontSize, 6);
        page.drawText(block.editedText, {
          x: block.x,
          y: block.y - block.height * 0.15,
          size: fontSize,
          font: helvetica,
          color: rgb(block.color[0], block.color[1], block.color[2]),
          maxWidth: block.width + 50,
        });
      }

      const bytes = await pdfLibDoc.save();
      const blob = new Blob([bytes], { type: "application/pdf" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${fileName}-edited.pdf`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success("PDF downloaded!");
    } catch (err: any) {
      toast.error("Download failed: " + err.message);
    } finally {
      setDownloading(false);
    }
  };

  const editedCount = textBlocks.filter((b) => b.editedText !== b.originalText).length;

  return (
    <div className="animate-fade-in space-y-4">
      {/* Header */}
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
              <Button variant="outline" size="sm" onClick={() => setScale((s) => Math.max(0.5, s - 0.2))}>
                <ZoomOut className="h-4 w-4" />
              </Button>
              <span className="text-sm text-muted-foreground min-w-[3rem] text-center">{Math.round(scale * 100)}%</span>
              <Button variant="outline" size="sm" onClick={() => setScale((s) => Math.min(3, s + 0.2))}>
                <ZoomIn className="h-4 w-4" />
              </Button>
              <Button
                size="sm"
                className="gap-2"
                onClick={handleDownload}
                disabled={downloading}
              >
                {downloading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                Download PDF
              </Button>
            </>
          )}
          <Button
            variant="outline"
            size="sm"
            className="gap-2"
            onClick={() => fileInputRef.current?.click()}
            disabled={loading}
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
            {pdfDoc ? "Change PDF" : "Upload PDF"}
          </Button>
          <input ref={fileInputRef} type="file" accept="application/pdf" className="hidden" onChange={handleFileChange} />
        </div>
      </div>

      {/* Empty state */}
      {!pdfDoc && !loading && (
        <div
          className="border-2 border-dashed border-border rounded-2xl flex flex-col items-center justify-center py-20 gap-4 cursor-pointer hover:border-primary/50 hover:bg-muted/30 transition-all"
          onClick={() => fileInputRef.current?.click()}
        >
          <div className="h-16 w-16 rounded-2xl bg-muted flex items-center justify-center">
            <FileText className="h-8 w-8 text-muted-foreground" />
          </div>
          <div className="text-center">
            <p className="font-semibold text-lg">Upload a PDF to edit</p>
            <p className="text-sm text-muted-foreground mt-1">Click any text in the PDF to edit it — just like Word</p>
          </div>
          <Button variant="outline" className="gap-2">
            <Upload className="h-4 w-4" /> Choose PDF
          </Button>
        </div>
      )}

      {loading && (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <span className="ml-3 text-muted-foreground">Loading PDF...</span>
        </div>
      )}

      {/* PDF Canvas + Overlay */}
      {pdfDoc && (
        <>
          {/* Page navigation */}
          {numPages > 1 && (
            <div className="flex items-center justify-center gap-3">
              <Button variant="outline" size="sm" onClick={() => setCurrentPage((p) => Math.max(1, p - 1))} disabled={currentPage === 1}>
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <span className="text-sm font-medium">Page {currentPage} of {numPages}</span>
              <Button variant="outline" size="sm" onClick={() => setCurrentPage((p) => Math.min(numPages, p + 1))} disabled={currentPage === numPages}>
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          )}

          <p className="text-xs text-muted-foreground text-center">
            👆 Click on any text to edit it
          </p>

          {/* Canvas wrapper */}
          <div className="overflow-auto rounded-xl border border-border shadow-lg bg-white">
            <div className="relative inline-block">
              {/* PDF Canvas */}
              <canvas ref={canvasRef} className="block" />

              {/* Transparent overlay for click detection */}
              {!rendering && (
                <div
                  ref={overlayRef}
                  className="absolute inset-0"
                  style={{ cursor: "text" }}
                  onClick={handleOverlayClick}
                >
                  {/* Hover highlights for each text block */}
                  {textBlocks.map((block) => (
                    <div
                      key={block.id}
                      className="absolute group"
                      style={{
                        left: block.canvasX - 2,
                        top: block.canvasY - 2,
                        width: block.canvasW + 4,
                        height: block.canvasH + 4,
                      }}
                    >
                      {/* Highlight on hover */}
                      <div
                        className={`absolute inset-0 rounded transition-all duration-100 ${
                          block.editedText !== block.originalText
                            ? "bg-green-400/20 ring-1 ring-green-400/50"
                            : "hover:bg-blue-400/15 hover:ring-1 hover:ring-blue-400/40"
                        }`}
                      />
                    </div>
                  ))}

                  {/* Inline editor for active block */}
                  {editingId && (() => {
                    const block = textBlocks.find((b) => b.id === editingId);
                    if (!block) return null;
                    const inputFontSize = Math.max(block.fontSize * scale, 8);
                    return (
                      <div
                        className="absolute z-50"
                        style={{
                          left: block.canvasX - 4,
                          top: block.canvasY - 4,
                          minWidth: Math.max(block.canvasW + 8, 60),
                        }}
                        onClick={(e) => e.stopPropagation()}
                      >
                        <input
                          autoFocus
                          value={editValue}
                          onChange={(e) => setEditValue(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") commitEdit();
                            if (e.key === "Escape") cancelEdit();
                          }}
                          className="block w-full bg-white border-2 border-blue-500 rounded px-1 outline-none shadow-lg"
                          style={{
                            fontSize: inputFontSize,
                            lineHeight: 1.2,
                            fontFamily: "inherit",
                            minWidth: 60,
                            padding: "1px 4px",
                          }}
                        />
                        <div className="flex gap-1 mt-1">
                          <button
                            onClick={commitEdit}
                            className="bg-blue-500 text-white text-xs px-2 py-0.5 rounded flex items-center gap-1 hover:bg-blue-600"
                          >
                            <Check className="h-3 w-3" /> Done
                          </button>
                          <button
                            onClick={cancelEdit}
                            className="bg-gray-200 text-gray-700 text-xs px-2 py-0.5 rounded flex items-center gap-1 hover:bg-gray-300"
                          >
                            <X className="h-3 w-3" /> Cancel
                          </button>
                        </div>
                      </div>
                    );
                  })()}
                </div>
              )}

              {rendering && (
                <div className="absolute inset-0 flex items-center justify-center bg-white/60">
                  <Loader2 className="h-6 w-6 animate-spin text-primary" />
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}