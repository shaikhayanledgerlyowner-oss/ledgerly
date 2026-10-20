// src/lib/analysesPdf.ts
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { toast } from "sonner";
import {
  computePivot, describePivot, makePdfFormatter, normalizeConfig, totalLabel,
} from "@/lib/pivot";

export interface PdfAnalysis {
  name: string;
  config: any;
  tableName: string;
  rows: Record<string, any>[];
}

const COLORS = ["#3b82f6", "#22c55e", "#f59e0b", "#ef4444", "#a855f7", "#06b6d4", "#f97316", "#ec4899", "#84cc16", "#14b8a6"];
const hex = (h: string): [number, number, number] => [
  parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16),
];

// grouped bar chart (canvas) → image
function drawBars(
  canvas: HTMLCanvasElement,
  labels: string[],
  series: { label: string; values: (number | null)[] }[],
  fmt: (v: number) => string,
) {
  const ctx = canvas.getContext("2d")!;
  const W = canvas.width, H = canvas.height;
  ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, W, H);

  const legendH = series.length > 1 ? 34 : 0;
  const pad = { top: 22 + legendH, right: 24, bottom: 62, left: 120 };
  const cw = W - pad.left - pad.right;
  const ch = H - pad.top - pad.bottom;
  const max = Math.max(...series.flatMap(s => s.values.map(v => Math.max(v ?? 0, 0))), 1);

  [0, 0.25, 0.5, 0.75, 1].forEach(f => {
    const y = pad.top + ch * (1 - f);
    ctx.strokeStyle = f === 0 ? "#d1d5db" : "#f0f0f0";
    ctx.lineWidth = f === 0 ? 2 : 1;
    ctx.beginPath(); ctx.moveTo(pad.left, y); ctx.lineTo(W - pad.right, y); ctx.stroke();
    ctx.fillStyle = "#9ca3af"; ctx.font = "16px Arial"; ctx.textAlign = "right";
    ctx.fillText(fmt(max * f), pad.left - 10, y + 5);
  });

  const gw = cw / Math.max(labels.length, 1);
  const bw = Math.min(54, (gw - 14) / series.length);
  labels.forEach((l, i) => {
    const gx = pad.left + i * gw + (gw - bw * series.length) / 2;
    series.forEach((s, j) => {
      const v = Math.max(s.values[i] ?? 0, 0);
      const bh = (v / max) * ch;
      ctx.fillStyle = COLORS[j % COLORS.length];
      ctx.fillRect(gx + j * bw, pad.top + ch - bh, bw - 2, bh);
    });
    ctx.fillStyle = "#6b7280"; ctx.font = "15px Arial"; ctx.textAlign = "center";
    ctx.fillText(l.length > 14 ? l.slice(0, 13) + "…" : l, pad.left + i * gw + gw / 2, H - pad.bottom + 24);
  });

  if (series.length > 1) {
    let x = pad.left;
    ctx.font = "16px Arial"; ctx.textAlign = "left";
    series.slice(0, 6).forEach((s, j) => {
      ctx.fillStyle = COLORS[j % COLORS.length];
      ctx.fillRect(x, 14, 14, 14);
      ctx.fillStyle = "#374151";
      const t = s.label.length > 26 ? s.label.slice(0, 25) + "…" : s.label;
      ctx.fillText(t, x + 20, 26);
      x += 20 + ctx.measureText(t).width + 26;
    });
  }
}

export function exportAnalysesPDF(list: PdfAnalysis[], cur: string) {
  if (!list.length) { toast.error("Koi analysis nahi mili"); return; }

  const doc = new jsPDF({ orientation: "l", unit: "pt", format: "a4" });
  const pw = doc.internal.pageSize.width;
  const ph = doc.internal.pageSize.height;

  list.forEach((a, idx) => {
    if (idx > 0) doc.addPage();
    const cfg = normalizeConfig(a.config);
    const res = computePivot(a.rows, cfg);
    const fmt = makePdfFormatter(cfg, cur);
    const first = cfg.values[0]?.agg;

    // header band
    doc.setFillColor(15, 23, 42); doc.rect(0, 0, pw, 56, "F");
    doc.setFillColor(59, 130, 246); doc.rect(0, 0, 5, 56, "F");
    doc.setTextColor(255, 255, 255); doc.setFont("helvetica", "bold"); doc.setFontSize(16);
    const title = a.name.length > 70 ? a.name.slice(0, 69) + "…" : a.name;
    doc.text(title, 22, 26);
    doc.setFont("helvetica", "normal"); doc.setFontSize(8.5); doc.setTextColor(148, 163, 184);
    const sub = `Table: ${a.tableName}  |  ${describePivot(cfg)}`;
    doc.text(doc.splitTextToSize(sub, pw - 200)[0], 22, 42);
    doc.setFontSize(8);
    doc.text(`Generated: ${new Date().toLocaleString("en-IN")}`, pw - 24, 26, { align: "right" });
    doc.text(`Analysis ${idx + 1} of ${list.length}`, pw - 24, 42, { align: "right" });

    let y = 74;

    if (!res.rows.length) {
      doc.setTextColor(100, 116, 139); doc.setFontSize(11);
      doc.text("Is analysis ke liye table me data nahi mila.", 24, y + 10);
      return;
    }

    // summary
    doc.setFont("helvetica", "bold"); doc.setFontSize(10); doc.setTextColor(15, 23, 42);
    if (res.hasTotal) {
      doc.text(`${totalLabel(first!)}: ${fmt(res.grandTotal, first)}`, 24, y);
    } else {
      doc.text(
        res.series.slice(0, 4).map(s => `${s.label}: ${fmt(res.grand[s.key], s.agg)}`).join("     "),
        24, y,
      );
    }
    y += 10;

    // chart
    const MAX_BARS = 20;
    const shown = res.rows.slice(0, MAX_BARS);
    const canvas = document.createElement("canvas");
    canvas.width = 1100; canvas.height = 320;
    drawBars(
      canvas,
      shown.map(r => r.label),
      res.series.map(s => ({ label: s.label, values: shown.map(r => r.values[s.key]) })),
      v => fmt(v, first),
    );
    const cw = pw - 48;
    const chH = (cw * canvas.height) / canvas.width;
    doc.addImage(canvas.toDataURL("image/png"), "PNG", 24, y, cw, chH);
    y += chH + 6;
    if (res.rows.length > MAX_BARS) {
      doc.setFont("helvetica", "italic"); doc.setFontSize(8); doc.setTextColor(100, 116, 139);
      doc.text(`Chart me pehli ${MAX_BARS} rows dikhayi gayi hain — poora data neeche table me hai.`, 24, y + 8);
      y += 14;
    }

    // table
    const head = [[
      cfg.rowCols.join(" > "),
      ...res.series.map(s => s.label),
      ...(res.hasTotal ? [totalLabel(first!)] : []),
    ]];
    const body = res.rows.map(r => [
      r.label,
      ...res.series.map(s => fmt(r.values[s.key], s.agg)),
      ...(res.hasTotal ? [fmt(r.total, first)] : []),
    ]);
    const foot = [[
      cfg.values.length === 1 ? totalLabel(first!) : "Total",
      ...res.series.map(s => fmt(res.grand[s.key], s.agg)),
      ...(res.hasTotal ? [fmt(res.grandTotal, first)] : []),
    ]];

    autoTable(doc, {
      startY: y + 4,
      head, body, foot,
      showFoot: "lastPage",
      styles: { font: "helvetica", fontSize: 8.5, cellPadding: 5, lineColor: [226, 232, 240], lineWidth: 0.5 },
      headStyles: { fillColor: [15, 23, 42], textColor: 255, fontStyle: "bold" },
      footStyles: { fillColor: hex("#3b82f6"), textColor: 255, fontStyle: "bold" },
      alternateRowStyles: { fillColor: [248, 250, 252] },
      columnStyles: { 0: { fontStyle: "bold", textColor: [15, 23, 42] } },
      didParseCell: (d: any) => { if (d.column.index > 0) d.cell.styles.halign = "right"; },
      margin: { left: 24, right: 24, bottom: 30 },
    });
  });

  // footer on every page
  const pages = doc.getNumberOfPages();
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p);
    doc.setFillColor(248, 250, 252); doc.rect(0, ph - 22, pw, 22, "F");
    doc.setFont("helvetica", "normal"); doc.setFontSize(7); doc.setTextColor(148, 163, 184);
    doc.text("Generated by LedgerlyPro · ledgerlypro.in", pw / 2, ph - 8, { align: "center" });
  }

  doc.save(`Analytics-${new Date().toISOString().slice(0, 10)}.pdf`);
  toast.success("Analytics PDF downloaded!");
}
