import React, { useEffect, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Plus, Download, Trash2, FileText, Pencil, Receipt, FileCheck, FileMinus } from "lucide-react";
import { toast } from "sonner";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

type DocType = "invoice" | "quotation" | "bill";

interface InvoiceItem {
  description: string; hsn: string; qty: number; rate: number; amount: number;
}
interface Totals {
  subtotal: number; tax_percent: number; tax_amount: number; total: number; terms: string; note: string;
}
interface InvoiceData {
  id?: string; type: DocType; doc_no: string; customer_name: string;
  customer_address: string; customer_phone: string;
  items: InvoiceItem[]; totals: Totals; currency_code: string; created_at?: string;
}

const DEFAULT_TERMS = `1. Goods/Services once sold/provided will not be taken back.
2. Payment is due within 7 days from the document date.
3. Please verify all details before making payment.
4. This is a computer generated document and does not require signature.
5. Subject to local jurisdiction.`;

const DEFAULT_NOTE = `Dear Sir / Madam,\nThank you for your business. Please find the document details below.`;

function safeFileName(name: string) {
  return (String(name || "document").replace(/[\/\\:*?"<>|]/g, "-").trim() || "document");
}
function docTitle(type: DocType) {
  return type === "invoice" ? "INVOICE" : type === "quotation" ? "QUOTATION" : "BILL";
}
function introText(type: DocType) {
  if (type === "quotation") return "Dear Sir / Madam,\nWe are pleased to submit the following quotation for your consideration.";
  if (type === "bill") return "Dear Sir / Madam,\nThank you. Please find the bill details below.";
  return "Dear Sir / Madam,\nThank you for your business. Please find the invoice details below.";
}
function formatNumber(n: number) {
  return new Intl.NumberFormat("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(n || 0));
}
function moneyPDF(amount: number, currency: string) {
  const num = formatNumber(amount);
  if ((currency || "INR").toUpperCase() === "INR") return `Rs. ${num}`;
  const map: Record<string, string> = { USD: "$", EUR: "€", GBP: "£" };
  return `${map[(currency || "").toUpperCase()] || currency || ""}${num}`;
}
function moneyUI(n: number, code: string) {
  const c = (code || "INR").toUpperCase();
  if (c === "INR") return `₹${formatNumber(n)}`;
  const map: Record<string, string> = { USD: "$", EUR: "€", GBP: "£" };
  return `${map[c] || c}${formatNumber(n)}`;
}
async function urlToDataURL(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, { mode: "cors" });
    const blob = await res.blob();
    return await new Promise((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(String(reader.result));
      reader.readAsDataURL(blob);
    });
  } catch { return null; }
}

const DOC_ICONS: Record<DocType, React.ReactNode> = {
  invoice: <Receipt className="w-4 h-4" />,
  quotation: <FileCheck className="w-4 h-4" />,
  bill: <FileMinus className="w-4 h-4" />,
};
const DOC_COLORS: Record<DocType, string> = {
  invoice: "bg-blue-50 text-blue-700 border-blue-100",
  quotation: "bg-emerald-50 text-emerald-700 border-emerald-100",
  bill: "bg-orange-50 text-orange-700 border-orange-100",
};

const EMPTY_FORM: InvoiceData = {
  type: "invoice", doc_no: "", customer_name: "", customer_address: "", customer_phone: "",
  items: [{ description: "", hsn: "", qty: 1, rate: 0, amount: 0 }],
  totals: { subtotal: 0, tax_percent: 0, tax_amount: 0, total: 0, terms: DEFAULT_TERMS, note: DEFAULT_NOTE },
  currency_code: "INR",
};

export default function InvoicesPage() {
  const { profile, isPremium, hasAccess } = useAuth();
  const [docs, setDocs] = useState<any[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const [showEdit, setShowEdit] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [branding, setBranding] = useState<any>(null);
  const [form, setForm] = useState<InvoiceData>(EMPTY_FORM);

  const refresh = async () => {
    if (!profile) return;
    const { data, error } = await supabase.from("invoices").select("*").eq("user_id", profile.id).order("created_at", { ascending: false });
    if (error) { toast.error(error.message); return; }
    setDocs(data ?? []);
  };

  useEffect(() => {
    if (!profile) return;
    refresh();
    supabase.from("user_branding").select("*").eq("user_id", profile.id).single().then(({ data }) => setBranding(data));
  }, [profile?.id]);

  const recalcTotals = (items: InvoiceItem[], taxPercent: number) => {
    const subtotal = items.reduce((s, i) => s + Number(i.amount || 0), 0);
    const tax_amount = subtotal * (Number(taxPercent || 0) / 100);
    const total = subtotal + tax_amount;
    setForm(prev => ({ ...prev, items, totals: { ...prev.totals, subtotal, tax_percent: Number(taxPercent || 0), tax_amount, total } }));
  };

  const updateItem = (idx: number, field: keyof InvoiceItem, value: string | number) => {
    const items = [...form.items];
    (items[idx] as any)[field] = value;
    if (field === "qty" || field === "rate") {
      items[idx].amount = Number(items[idx].qty || 0) * Number(items[idx].rate || 0);
    }
    recalcTotals(items, form.totals.tax_percent);
  };

  const addItem = () => recalcTotals([...form.items, { description: "", hsn: "", qty: 1, rate: 0, amount: 0 }], form.totals.tax_percent);
  const removeItem = (idx: number) => {
    const items = form.items.filter((_, i) => i !== idx);
    recalcTotals(items.length ? items : [{ description: "", hsn: "", qty: 1, rate: 0, amount: 0 }], form.totals.tax_percent);
  };

  const save = async () => {
    if (!profile) return;
    if (!form.doc_no.trim()) return toast.error("Document No. required");
    if (!form.customer_name.trim()) return toast.error("Customer name required");
    const { error } = await supabase.from("invoices").insert({
      user_id: profile.id, type: form.type, doc_no: form.doc_no.trim(),
      customer_name: form.customer_name.trim(), customer_address: form.customer_address || "",
      customer_phone: form.customer_phone || "", items: form.items as any, totals: form.totals as any,
      currency_code: form.currency_code,
    } as any);
    if (error) return toast.error(error.message);
    toast.success("Document saved!");
    setShowCreate(false); setForm(EMPTY_FORM); refresh();
  };

  const openEdit = (d: any) => {
    setEditingId(d.id);
    setForm({
      type: (d.type || "invoice") as DocType, doc_no: d.doc_no || "",
      customer_name: d.customer_name || "", customer_address: d.customer_address || "",
      customer_phone: d.customer_phone || "",
      items: (d.items as InvoiceItem[]) || [{ description: "", hsn: "", qty: 1, rate: 0, amount: 0 }],
      totals: {
        subtotal: Number(d.totals?.subtotal || 0), tax_percent: Number(d.totals?.tax_percent || 0),
        tax_amount: Number(d.totals?.tax_amount || 0), total: Number(d.totals?.total || 0),
        terms: d.totals?.terms || DEFAULT_TERMS, note: d.totals?.note || DEFAULT_NOTE,
      },
      currency_code: d.currency_code || "INR",
    });
    setShowEdit(true);
  };

  const saveEdit = async () => {
    if (!editingId) return;
    if (!form.doc_no.trim()) return toast.error("Document No. required");
    if (!form.customer_name.trim()) return toast.error("Customer name required");
    const { error } = await supabase.from("invoices").update({
      type: form.type, doc_no: form.doc_no.trim(), customer_name: form.customer_name.trim(),
      customer_address: form.customer_address || "", customer_phone: form.customer_phone || "",
      items: form.items as any, totals: form.totals as any, currency_code: form.currency_code,
    } as any).eq("id", editingId);
    if (error) return toast.error(error.message);
    toast.success("Document updated!"); setShowEdit(false); setEditingId(null); refresh();
  };

  const deleteDoc = async (id: string) => {
    const { error } = await supabase.from("invoices").delete().eq("id", id);
    if (error) return toast.error(error.message);
    setDocs(prev => prev.filter(d => d.id !== id));
    toast.success("Deleted");
  };

  const downloadPDF = async (doc: any) => {
    if (!hasAccess) { toast.error("Upgrade to download documents"); return; }
    try {
      const type: DocType = (doc.type || "invoice") as DocType;
      const title = docTitle(type);
      const items: InvoiceItem[] = (doc.items as any[])?.map(it => ({
        description: String(it.description ?? ""), hsn: String(it.hsn ?? ""),
        qty: Number(it.qty ?? 0), rate: Number(it.rate ?? 0), amount: Number(it.amount ?? 0),
      })) || [];
      const totals: Totals = {
        subtotal: Number(doc.totals?.subtotal ?? 0), tax_percent: Number(doc.totals?.tax_percent ?? 0),
        tax_amount: Number(doc.totals?.tax_amount ?? 0), total: Number(doc.totals?.total ?? 0),
        terms: String(doc.totals?.terms ?? DEFAULT_TERMS), note: String(doc.totals?.note ?? introText(type)),
      };
      const docNo = String(doc.doc_no || "-");
      const createdAt = doc.created_at ? new Date(doc.created_at) : new Date();
      const currency = String(doc.currency_code || "INR").toUpperCase();

      const pdf = new jsPDF({ orientation: "p", unit: "pt", format: "a4" });
      const pageW = pdf.internal.pageSize.getWidth();
      const pageH = pdf.internal.pageSize.getHeight();

      let logoDataUrl: string | null = null;
      const logoUrl = branding?.logo_url || branding?.logo || branding?.business_logo_url || branding?.business_logo;
      if (logoUrl) logoDataUrl = await urlToDataURL(logoUrl);

      // ── Header ──
      // Top color band based on type
      const headerColors: Record<DocType, [number,number,number]> = {
        invoice: [15, 23, 42],
        quotation: [5, 78, 49],
        bill: [124, 45, 18],
      };
      pdf.setFillColor(...headerColors[type]);
      pdf.rect(0, 0, pageW, 90, "F");

      // Left accent
      const accentColors: Record<DocType, [number,number,number]> = {
        invoice: [59, 130, 246],
        quotation: [34, 197, 94],
        bill: [249, 115, 22],
      };
      pdf.setFillColor(...accentColors[type]);
      pdf.rect(0, 0, 6, 90, "F");

      // Logo
      if (logoDataUrl) {
        const isPng = logoDataUrl.startsWith("data:image/png");
        pdf.addImage(logoDataUrl, isPng ? "PNG" : "JPEG" as any, 18, 14, 62, 62);
      }

      const leftX = logoDataUrl ? 96 : 22;
      const bName = String(branding?.business_name || "Your Business");
      pdf.setTextColor(255, 255, 255);
      pdf.setFont("helvetica", "bold"); pdf.setFontSize(20);
      pdf.text(bName, leftX, 38);

      pdf.setFont("helvetica", "normal"); pdf.setFontSize(8.5); pdf.setTextColor(180, 195, 210);
      const bInfo = [
        branding?.address,
        branding?.phone ? `Ph: ${branding.phone}` : "",
        branding?.gstin ? `GSTIN: ${branding.gstin}` : "",
      ].filter(Boolean).join("   |   ");
      if (bInfo) {
        const bInfoLines = pdf.splitTextToSize(bInfo, pageW / 2 - leftX - 10);
        pdf.text(bInfoLines, leftX, 54);
      }

      // Document title (right)
      pdf.setTextColor(255, 255, 255);
      pdf.setFont("helvetica", "bold"); pdf.setFontSize(28);
      pdf.text(title, pageW - 22, 42, { align: "right" });
      pdf.setFont("helvetica", "normal"); pdf.setFontSize(9.5); pdf.setTextColor(180, 195, 210);
      pdf.text(`No: ${docNo}`, pageW - 22, 60, { align: "right" });
      pdf.text(`Date: ${createdAt.toLocaleDateString("en-IN")}`, pageW - 22, 74, { align: "right" });

      let y = 108;

      // ── Intro note ──
      const note = (totals.note?.trim() ? totals.note : introText(type)) || "";
      pdf.setTextColor(71, 85, 105); pdf.setFont("helvetica", "italic"); pdf.setFontSize(9);
      const noteLines = pdf.splitTextToSize(note, pageW - 80);
      pdf.text(noteLines, 40, y); y += noteLines.length * 12 + 10;

      // ── Bill To box ──
      pdf.setFillColor(248, 250, 252); pdf.setDrawColor(226, 232, 240);
      const customerLines = [
        doc.customer_name || "",
        doc.customer_address || "",
        doc.customer_phone ? `Phone: ${doc.customer_phone}` : "",
      ].filter(x => String(x).trim().length > 0);
      const allCLines: string[] = [];
      for (const l of customerLines) { allCLines.push(...pdf.splitTextToSize(String(l), pageW / 2 - 60)); }
      const boxH = 22 + allCLines.length * 12 + 14;
      pdf.roundedRect(40, y, pageW / 2 - 20, boxH, 6, 6, "FD");
      pdf.setFillColor(...accentColors[type]);
      pdf.roundedRect(40, y, pageW / 2 - 20, 4, 2, 2, "F");
      pdf.setTextColor(15, 23, 42); pdf.setFont("helvetica", "bold"); pdf.setFontSize(9);
      pdf.text("BILL TO", 52, y + 16);
      pdf.setFont("helvetica", "normal"); pdf.setFontSize(9.5); pdf.setTextColor(30, 41, 59);
      allCLines.forEach((l, i) => pdf.text(l, 52, y + 28 + i * 12));
      y += boxH + 18;

      // ── Items table ──
      autoTable(pdf, {
        startY: y,
        head: [["No.", "Description", "HSN/SAC", "Qty", "Rate", "Amount"]],
        body: items.map((it, i) => [
          String(i + 1),
          String(it.description || ""),
          String(it.hsn || "—"),
          String(Number(it.qty || 0)),
          moneyPDF(Number(it.rate || 0), currency),
          moneyPDF(Number(it.amount || 0), currency),
        ]),
        styles: { font: "helvetica", fontSize: 9.5, cellPadding: 8, lineColor: [226, 232, 240], lineWidth: 0.5, valign: "middle" },
        headStyles: { fillColor: headerColors[type], textColor: 255, fontStyle: "bold", fontSize: 9.5, halign: "center", cellPadding: 9 },
        alternateRowStyles: { fillColor: [248, 250, 252] },
        columnStyles: {
          0: { cellWidth: 34, halign: "center", fontStyle: "bold" },
          1: { halign: "left" },
          2: { cellWidth: 80, halign: "center" },
          3: { cellWidth: 44, halign: "center" },
          4: { cellWidth: 100, halign: "center" },
          5: { cellWidth: 110, halign: "center", fontStyle: "bold" },
        },
        margin: { left: 40, right: 40 },
      });

      const afterTable = (pdf as any).lastAutoTable.finalY + 16;

      // ── Totals box ──
      const boxW = 230; const boxX = pageW - 40 - boxW;
      const rows = [
        { l: "Subtotal", v: moneyPDF(Number(totals.subtotal || 0), currency) },
        { l: `Tax (${Number(totals.tax_percent || 0).toFixed(0)}%)`, v: moneyPDF(Number(totals.tax_amount || 0), currency) },
      ];
      const totalBoxH = 14 + rows.length * 24 + 36;
      pdf.setFillColor(248, 250, 252); pdf.setDrawColor(226, 232, 240);
      pdf.roundedRect(boxX, afterTable, boxW, totalBoxH, 8, 8, "FD");

      let rowY = afterTable + 18;
      rows.forEach(r => {
        pdf.setFont("helvetica", "normal"); pdf.setFontSize(9); pdf.setTextColor(71, 85, 105);
        pdf.text(r.l, boxX + 14, rowY);
        pdf.text(r.v, boxX + boxW - 14, rowY, { align: "right" });
        rowY += 24;
      });

      // Grand total row
      pdf.setFillColor(...accentColors[type]);
      pdf.roundedRect(boxX, rowY - 2, boxW, 28, 0, 0, "F");
      pdf.roundedRect(boxX, rowY - 2 + 28 - 8, boxW, 8, 0, 0, "F");
      pdf.roundedRect(boxX, rowY - 2, boxW, 28, 8, 8, "F");
      pdf.setFont("helvetica", "bold"); pdf.setFontSize(11); pdf.setTextColor(255, 255, 255);
      pdf.text("Grand Total", boxX + 14, rowY + 14);
      pdf.text(moneyPDF(Number(totals.total || 0), currency), boxX + boxW - 14, rowY + 14, { align: "right" });

      // ── Terms ──
      const termsY = (pdf as any).lastAutoTable.finalY + totalBoxH + 28;
      if (termsY < pageH - 100) {
        pdf.setFont("helvetica", "bold"); pdf.setFontSize(9); pdf.setTextColor(15, 23, 42);
        pdf.text("Terms & Conditions", 40, termsY);
        pdf.setFont("helvetica", "normal"); pdf.setFontSize(8); pdf.setTextColor(71, 85, 105);
        const tLines = pdf.splitTextToSize(String(totals.terms || DEFAULT_TERMS), pageW / 2 - 20);
        pdf.text(tLines, 40, termsY + 14);
      }

      // ── Signature ──
      const sigY = pageH - 80;
      const sigX1 = pageW - 200; const sigX2 = pageW - 40;
      const sigUrl = branding?.signature_url;
      if (sigUrl) {
        const sigDataUrl = await urlToDataURL(sigUrl);
        if (sigDataUrl) {
          const isPng = sigDataUrl.startsWith("data:image/png");
          pdf.addImage(sigDataUrl, isPng ? "PNG" : "JPEG" as any, pageW - 210, sigY - 52, 170, 46);
        }
      }
      pdf.setDrawColor(203, 213, 225); pdf.line(sigX1, sigY, sigX2, sigY);
      pdf.setFont("helvetica", "bold"); pdf.setFontSize(9); pdf.setTextColor(30, 41, 59);
      pdf.text("Authorised Signature", pageW - 40, sigY + 14, { align: "right" });

      // ── Footer ──
      pdf.setFillColor(248, 250, 252);
      pdf.rect(0, pageH - 20, pageW, 20, "F");
      pdf.setFont("helvetica", "normal"); pdf.setFontSize(7); pdf.setTextColor(148, 163, 184);
      pdf.text("Generated by LedgerlyPro · ledgerlypro.in", pageW / 2, pageH - 7, { align: "center" });

      pdf.save(`${safeFileName(title)}-${safeFileName(docNo)}.pdf`);
      toast.success("PDF downloaded!");
    } catch (e: any) {
      toast.error(e?.message || "PDF download failed");
    }
  };

  const renderForm = () => (
    <div className="space-y-6">
      {/* Type / Doc No / Currency */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="space-y-1.5">
          <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Type</Label>
          <Select value={form.type} onValueChange={v => {
            const t = v as DocType;
            setForm(p => ({ ...p, type: t, totals: { ...p.totals, note: introText(t) } }));
          }}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="invoice">Invoice</SelectItem>
              <SelectItem value="quotation">Quotation</SelectItem>
              <SelectItem value="bill">Bill</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Document No.</Label>
          <Input value={form.doc_no} onChange={e => setForm({ ...form, doc_no: e.target.value })} placeholder="INV-001 / QT-001 / BILL-001" />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Currency</Label>
          <Select value={form.currency_code} onValueChange={v => setForm({ ...form, currency_code: v })}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="INR">INR (₹)</SelectItem>
              <SelectItem value="USD">USD ($)</SelectItem>
              <SelectItem value="EUR">EUR (€)</SelectItem>
              <SelectItem value="GBP">GBP (£)</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Customer */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Customer Name</Label>
          <Input value={form.customer_name} onChange={e => setForm({ ...form, customer_name: e.target.value })} />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Phone</Label>
          <Input value={form.customer_phone} onChange={e => setForm({ ...form, customer_phone: e.target.value })} />
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Address</Label>
          <Textarea value={form.customer_address} onChange={e => setForm({ ...form, customer_address: e.target.value })} rows={2} />
        </div>
      </div>

      {/* Intro note */}
      <div className="space-y-1.5">
        <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Intro Note (in PDF)</Label>
        <Textarea value={form.totals.note} onChange={e => setForm({ ...form, totals: { ...form.totals, note: e.target.value } })} rows={2} />
      </div>

      {/* Items */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Items</Label>
          <Button variant="outline" size="sm" onClick={addItem} className="h-7 text-xs gap-1">
            <Plus className="w-3 h-3" /> Add Item
          </Button>
        </div>
        <div className="space-y-2">
          {form.items.map((item, idx) => (
            <div key={idx} className="rounded-xl border bg-muted/20 p-3 space-y-2">
              <div className="grid grid-cols-12 gap-2 items-end">
                <div className="col-span-5">
                  <Label className="text-xs text-muted-foreground">Description</Label>
                  <Input placeholder="Service / Product" value={item.description} onChange={e => updateItem(idx, "description", e.target.value)} className="h-8 text-sm" />
                </div>
                <div className="col-span-2">
                  <Label className="text-xs text-muted-foreground">HSN/SAC</Label>
                  <Input placeholder="9983" value={item.hsn} onChange={e => updateItem(idx, "hsn", e.target.value)} className="h-8 text-sm" />
                </div>
                <div className="col-span-1">
                  <Label className="text-xs text-muted-foreground">Qty</Label>
                  <Input type="number" value={item.qty} onChange={e => updateItem(idx, "qty", Number(e.target.value))} className="h-8 text-sm" />
                </div>
                <div className="col-span-2">
                  <Label className="text-xs text-muted-foreground">Rate</Label>
                  <Input type="number" value={item.rate} onChange={e => updateItem(idx, "rate", Number(e.target.value))} className="h-8 text-sm" />
                </div>
                <div className="col-span-2 text-right">
                  <Label className="text-xs text-muted-foreground">Amount</Label>
                  <div className="h-8 flex items-center justify-end font-bold text-sm text-primary">
                    {moneyUI(Number(item.amount || 0), form.currency_code)}
                  </div>
                </div>
              </div>
              {form.items.length > 1 && (
                <div className="flex justify-end">
                  <Button variant="ghost" size="sm" className="h-6 text-xs text-destructive hover:text-destructive" onClick={() => removeItem(idx)}>
                    Remove
                  </Button>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Totals */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 items-end">
        <div className="space-y-1.5">
          <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Tax %</Label>
          <Input type="number" value={form.totals.tax_percent} onChange={e => recalcTotals(form.items, Number(e.target.value))} placeholder="0" />
        </div>
        <div className="bg-muted/30 rounded-xl p-4 space-y-1 text-right">
          <p className="text-sm text-muted-foreground">Subtotal: <span className="font-medium text-foreground">{moneyUI(form.totals.subtotal, form.currency_code)}</span></p>
          <p className="text-sm text-muted-foreground">Tax ({form.totals.tax_percent}%): <span className="font-medium text-foreground">{moneyUI(form.totals.tax_amount, form.currency_code)}</span></p>
          <p className="text-base font-bold border-t pt-1 mt-1">Grand Total: {moneyUI(form.totals.total, form.currency_code)}</p>
        </div>
      </div>

      {/* Terms */}
      <div className="space-y-1.5">
        <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Terms & Conditions</Label>
        <Textarea value={form.totals.terms} onChange={e => setForm({ ...form, totals: { ...form.totals, terms: e.target.value } })} rows={4} className="text-xs" />
      </div>
    </div>
  );

  return (
    <div className="space-y-6 pb-10">

      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-blue-500/10 flex items-center justify-center">
              <FileText className="w-4 h-4 text-blue-500" />
            </div>
            Documents
          </h1>
          <p className="text-muted-foreground text-sm mt-1">{docs.length} document{docs.length !== 1 ? "s" : ""}</p>
        </div>
        <Dialog open={showCreate} onOpenChange={setShowCreate}>
          <DialogTrigger asChild>
            <Button size="sm" className="gap-2 h-9">
              <Plus className="h-4 w-4" /> New Document
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Create Document</DialogTitle>
            </DialogHeader>
            {renderForm()}
            <Button onClick={save} className="w-full mt-2">Save Document</Button>
          </DialogContent>
        </Dialog>
      </div>

      {/* Edit Dialog */}
      <Dialog open={showEdit} onOpenChange={setShowEdit}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Edit Document</DialogTitle></DialogHeader>
          {renderForm()}
          <Button onClick={saveEdit} className="w-full mt-2">Update Document</Button>
        </DialogContent>
      </Dialog>

      {/* Doc list */}
      <div className="space-y-2">
        {docs.map(d => (
          <div key={d.id} className="bg-card border rounded-2xl p-4 flex items-center justify-between gap-4 hover:shadow-sm transition-all">
            <div className="flex items-center gap-3 min-w-0">
              <div className={`w-9 h-9 rounded-xl border flex items-center justify-center shrink-0 ${DOC_COLORS[d.type as DocType] || "bg-gray-50 text-gray-600 border-gray-100"}`}>
                {DOC_ICONS[d.type as DocType] || <FileText className="w-4 h-4" />}
              </div>
              <div className="min-w-0">
                <p className="font-semibold text-sm truncate">
                  {String(d.type || "").toUpperCase()} · {d.doc_no || "No number"}
                </p>
                <p className="text-xs text-muted-foreground truncate mt-0.5">
                  {d.customer_name || "Customer"}
                  {d.created_at ? ` · ${new Date(d.created_at).toLocaleDateString("en-IN")}` : ""}
                  {d.totals?.total !== undefined ? ` · ${moneyUI(Number(d.totals.total || 0), d.currency_code || "INR")}` : ""}
                </p>
              </div>
            </div>
            <div className="flex gap-1.5 shrink-0">
              <Button variant="outline" size="icon" className="h-8 w-8 rounded-lg" onClick={() => openEdit(d)} title="Edit">
                <Pencil className="h-3.5 w-3.5" />
              </Button>
              <Button variant="outline" size="icon" className={`h-8 w-8 rounded-lg ${!hasAccess ? "opacity-40 cursor-not-allowed" : ""}`}
                onClick={() => downloadPDF(d)} disabled={!hasAccess} title="Download PDF">
                <Download className="h-3.5 w-3.5" />
              </Button>
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="outline" size="icon" className="h-8 w-8 rounded-lg text-destructive hover:text-destructive" title="Delete">
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Delete this document?</AlertDialogTitle>
                    <AlertDialogDescription>This action cannot be undone.</AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction onClick={() => deleteDoc(d.id)}>Delete</AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          </div>
        ))}
        {docs.length === 0 && (
          <div className="flex flex-col items-center justify-center py-16 text-center gap-3">
            <div className="w-16 h-16 rounded-2xl bg-muted/50 flex items-center justify-center">
              <FileText className="w-8 h-8 text-muted-foreground/30" />
            </div>
            <div>
              <p className="font-semibold text-sm">No documents yet</p>
              <p className="text-muted-foreground text-xs mt-1">Create your first invoice, quotation or bill</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
