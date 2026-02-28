import React, { useEffect, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

import { Plus, Download, Trash2, FileText, Pencil } from "lucide-react";
import { toast } from "sonner";

// ✅ PDF
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

type DocType = "invoice" | "quotation" | "bill";

interface InvoiceItem {
  description: string;
  hsn: string; // ✅ HSN/SAC
  qty: number;
  rate: number;
  amount: number;
}

interface Totals {
  subtotal: number;
  tax_percent: number;
  tax_amount: number;
  total: number;
  terms: string;
  note: string;
}

interface InvoiceData {
  id?: string;
  type: DocType;
  doc_no: string;

  customer_name: string;
  customer_address: string;
  customer_phone: string;

  items: InvoiceItem[];
  totals: Totals;

  currency_code: string;
  created_at?: string;
}

const DEFAULT_TERMS = `1. Goods/Services once sold/provided will not be taken back.
2. Payment is due within 7 days from the document date.
3. Please verify all details before making payment.
4. This is a computer generated document and does not require signature.
5. Subject to local jurisdiction.`;

const DEFAULT_NOTE = `Dear Sir / Madam,
Thank you for your business. Please find the document details below.`;

function safeFileName(name: string) {
  return (
    String(name || "document")
      .replace(/[\/\\:*?"<>|]/g, "-")
      .trim() || "document"
  );
}

function docTitle(type: DocType) {
  if (type === "invoice") return "INVOICE";
  if (type === "quotation") return "QUOTATION";
  return "BILL";
}

function introText(type: DocType) {
  if (type === "quotation") {
    return "Dear Sir / Madam,\nWe are pleased to submit the following quotation for your consideration.";
  }
  if (type === "bill") {
    return "Dear Sir / Madam,\nThank you. Please find the bill details below.";
  }
  return "Dear Sir / Madam,\nThank you for your business. Please find the invoice details below.";
}

function formatNumber(n: number, locale = "en-IN") {
  const v = Number(n || 0);
  return new Intl.NumberFormat(locale, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(v);
}

// ✅ For PDF: INR => "Rs." (jsPDF default font doesn't support ₹)
function moneyPDF(amount: number, currency: string) {
  const num = formatNumber(amount);
  if ((currency || "INR").toUpperCase() === "INR") return `Rs. ${num}`;
  const map: Record<string, string> = { USD: "$", EUR: "€", GBP: "£" };
  const sym = map[(currency || "").toUpperCase()] || currency || "";
  return `${sym}${num}`;
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
  } catch {
    return null;
  }
}

export default function InvoicesPage() {
  const { profile, isPremium } = useAuth();
  const [docs, setDocs] = useState<any[]>([]);
  const [showCreate, setShowCreate] = useState(false);

  // ✅ Edit state
  const [showEdit, setShowEdit] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const [branding, setBranding] = useState<any>(null);

  const [form, setForm] = useState<InvoiceData>({
    type: "invoice",
    doc_no: "",
    customer_name: "",
    customer_address: "",
    customer_phone: "",
    items: [{ description: "", hsn: "", qty: 1, rate: 0, amount: 0 }],
    totals: {
      subtotal: 0,
      tax_percent: 0,
      tax_amount: 0,
      total: 0,
      terms: DEFAULT_TERMS,
      note: DEFAULT_NOTE,
    },
    currency_code: "INR",
  });

  const refresh = async () => {
    if (!profile) return;
    const { data, error } = await supabase
      .from("invoices")
      .select("*")
      .eq("user_id", profile.id)
      .order("created_at", { ascending: false });

    if (error) {
      toast.error(error.message);
      return;
    }
    setDocs(data ?? []);
  };

  useEffect(() => {
    if (!profile) return;
    refresh();

    supabase
      .from("user_branding")
      .select("*")
      .eq("user_id", profile.id)
      .single()
      .then(({ data }) => setBranding(data));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.id]);

  const recalcTotals = (items: InvoiceItem[], taxPercent: number) => {
    const subtotal = items.reduce((s, i) => s + Number(i.amount || 0), 0);
    const tax_amount = subtotal * (Number(taxPercent || 0) / 100);
    const total = subtotal + tax_amount;

    setForm((prev) => ({
      ...prev,
      items,
      totals: {
        ...prev.totals,
        subtotal,
        tax_percent: Number(taxPercent || 0),
        tax_amount,
        total,
      },
    }));
  };

  const updateItem = (
    idx: number,
    field: keyof InvoiceItem,
    value: string | number
  ) => {
    const items = [...form.items];
    (items[idx] as any)[field] = value;

    if (field === "qty" || field === "rate") {
      const q = Number(items[idx].qty || 0);
      const r = Number(items[idx].rate || 0);
      items[idx].amount = q * r;
    }
    recalcTotals(items, form.totals.tax_percent);
  };

  const addItem = () => {
    const items = [
      ...form.items,
      { description: "", hsn: "", qty: 1, rate: 0, amount: 0 },
    ];
    recalcTotals(items, form.totals.tax_percent);
  };

  const removeItem = (idx: number) => {
    const items = form.items.filter((_, i) => i !== idx);
    recalcTotals(
      items.length
        ? items
        : [{ description: "", hsn: "", qty: 1, rate: 0, amount: 0 }],
      form.totals.tax_percent
    );
  };

  const save = async () => {
    if (!profile) return;

    if (!form.doc_no.trim()) return toast.error("Document No. required");
    if (!form.customer_name.trim()) return toast.error("Customer name required");

    const payload = {
      user_id: profile.id,
      type: form.type,
      doc_no: form.doc_no.trim(),
      customer_name: form.customer_name.trim(),
      customer_address: form.customer_address || "",
      customer_phone: form.customer_phone || "",
      items: form.items as any,
      totals: form.totals as any,
      currency_code: form.currency_code,
    };

    const { error } = await supabase.from("invoices").insert(payload as any);
    if (error) return toast.error(error.message);

    toast.success("Document saved!");
    setShowCreate(false);
    setForm({
      type: "invoice",
      doc_no: "",
      customer_name: "",
      customer_address: "",
      customer_phone: "",
      items: [{ description: "", hsn: "", qty: 1, rate: 0, amount: 0 }],
      totals: {
        subtotal: 0,
        tax_percent: 0,
        tax_amount: 0,
        total: 0,
        terms: DEFAULT_TERMS,
        note: DEFAULT_NOTE,
      },
      currency_code: "INR",
    });
    refresh();
  };

  // ✅ Open edit dialog with existing doc data
  const openEdit = (d: any) => {
    setEditingId(d.id);
    setForm({
      type: (d.type || "invoice") as DocType,
      doc_no: d.doc_no || "",
      customer_name: d.customer_name || "",
      customer_address: d.customer_address || "",
      customer_phone: d.customer_phone || "",
      items: (d.items as InvoiceItem[]) || [{ description: "", hsn: "", qty: 1, rate: 0, amount: 0 }],
      totals: {
        subtotal: Number(d.totals?.subtotal || 0),
        tax_percent: Number(d.totals?.tax_percent || 0),
        tax_amount: Number(d.totals?.tax_amount || 0),
        total: Number(d.totals?.total || 0),
        terms: d.totals?.terms || DEFAULT_TERMS,
        note: d.totals?.note || DEFAULT_NOTE,
      },
      currency_code: d.currency_code || "INR",
    });
    setShowEdit(true);
  };

  // ✅ Save edited doc
  const saveEdit = async () => {
    if (!editingId) return;

    if (!form.doc_no.trim()) return toast.error("Document No. required");
    if (!form.customer_name.trim()) return toast.error("Customer name required");

    const payload = {
      type: form.type,
      doc_no: form.doc_no.trim(),
      customer_name: form.customer_name.trim(),
      customer_address: form.customer_address || "",
      customer_phone: form.customer_phone || "",
      items: form.items as any,
      totals: form.totals as any,
      currency_code: form.currency_code,
    };

    const { error } = await supabase
      .from("invoices")
      .update(payload as any)
      .eq("id", editingId);

    if (error) return toast.error(error.message);

    toast.success("Document updated!");
    setShowEdit(false);
    setEditingId(null);
    refresh();
  };

  const deleteDoc = async (id: string) => {
    const { error } = await supabase.from("invoices").delete().eq("id", id);
    if (error) return toast.error(error.message);
    setDocs((prev) => prev.filter((d) => d.id !== id));
    toast.success("Deleted");
  };

  // ✅ FIXED PDF: ADDRESS WRAP + amount formatting + no payment details + authorised signature
  const downloadPDF = async (doc: any) => {
    try {
      const type: DocType = (doc.type || "invoice") as DocType;
      const title = docTitle(type);

      const items: InvoiceItem[] =
        (doc.items as any[])?.map((it) => ({
          description: String(it.description ?? ""),
          hsn: String(it.hsn ?? ""),
          qty: Number(it.qty ?? 0),
          rate: Number(it.rate ?? 0),
          amount: Number(it.amount ?? 0),
        })) || [];

      const totals: Totals = {
        subtotal: Number(doc.totals?.subtotal ?? 0),
        tax_percent: Number(doc.totals?.tax_percent ?? 0),
        tax_amount: Number(doc.totals?.tax_amount ?? 0),
        total: Number(doc.totals?.total ?? 0),
        terms: String(doc.totals?.terms ?? DEFAULT_TERMS),
        note: String(doc.totals?.note ?? introText(type)),
      };

      const docNo = String(doc.doc_no || "-");
      const createdAt = doc.created_at ? new Date(doc.created_at) : new Date();
      const currency = String(doc.currency_code || "INR").toUpperCase();

      const pdf = new jsPDF({ orientation: "p", unit: "pt", format: "a4" });
      const pageW = pdf.internal.pageSize.getWidth();
      const pageH = pdf.internal.pageSize.getHeight();

      // --- logo data (if any) ---
      let logoAdded = false;
      const logoUrl =
        branding?.logo_url ||
        branding?.logo ||
        branding?.business_logo_url ||
        branding?.business_logo;

      let logoDataUrl: string | null = null;
      if (logoUrl) logoDataUrl = await urlToDataURL(logoUrl);

      // --- HEADER WRAP FIX ---
      const rightBlockW = 210;
      const leftMargin = 40;
      const rightMargin = 40;

      const leftX = logoDataUrl ? 110 : 40;
      const leftMaxW = pageW - rightMargin - rightBlockW - 20 - leftX;

      pdf.setFont("helvetica", "bold");
      pdf.setFontSize(14);
      const bName = String(branding?.business_name || "Your Business");
      const bNameLines = pdf.splitTextToSize(bName, leftMaxW);

      pdf.setFont("helvetica", "normal");
      pdf.setFontSize(10);
      const businessRawLines = [
        branding?.address ? String(branding.address) : "",
        branding?.phone ? `Phone: ${branding.phone}` : "",
        branding?.email ? `Email: ${branding.email}` : "",
        branding?.gstin ? `GSTIN: ${branding.gstin}` : "",
      ].filter(Boolean);

      const businessLinesWrapped: string[] = [];
      for (const line of businessRawLines) {
        const lines = pdf.splitTextToSize(String(line), leftMaxW);
        businessLinesWrapped.push(...lines);
      }

      const headerLineH = 14;
      const headerNeededH =
        22 +
        bNameLines.length * headerLineH +
        businessLinesWrapped.length * headerLineH +
        14;

      const headerH = Math.max(92, headerNeededH);

      pdf.setFillColor(241, 245, 249);
      pdf.rect(0, 0, pageW, headerH, "F");

      if (logoDataUrl) {
        const isPng = logoDataUrl.startsWith("data:image/png");
        const fmt = isPng ? "PNG" : "JPEG";
        pdf.addImage(logoDataUrl, fmt as any, 40, 22, 56, 56);
        logoAdded = true;
      }

      pdf.setTextColor(15, 23, 42);
      pdf.setFont("helvetica", "bold");
      pdf.setFontSize(14);

      let curY = 38;
      pdf.text(bNameLines as any, leftX, curY);
      curY += bNameLines.length * headerLineH;

      pdf.setFont("helvetica", "normal");
      pdf.setFontSize(10);
      pdf.setTextColor(30, 41, 59);

      curY += 4;

      for (const line of businessLinesWrapped) {
        pdf.text(line, leftX, curY);
        curY += headerLineH;
        if (curY > headerH - 10) break;
      }

      pdf.setTextColor(15, 23, 42);
      pdf.setFont("helvetica", "bold");
      pdf.setFontSize(20);
      pdf.text(title, pageW - 40, 40, { align: "right" });

      pdf.setFont("helvetica", "normal");
      pdf.setFontSize(10);
      pdf.text(`No: ${docNo}`, pageW - 40, 58, { align: "right" });
      pdf.text(`Date: ${createdAt.toLocaleDateString()}`, pageW - 40, 72, {
        align: "right",
      });

      const noteTopY = headerH + 28;

      pdf.setTextColor(30, 41, 59);
      pdf.setFont("helvetica", "normal");
      pdf.setFontSize(10);

      const note = (totals.note?.trim() ? totals.note : introText(type)) || "";
      const noteLines = pdf.splitTextToSize(note, pageW - 80);
      pdf.text(noteLines, 40, noteTopY);

      const customerTop = noteTopY + noteLines.length * 12 + 14;

      pdf.setTextColor(15, 23, 42);
      pdf.setFont("helvetica", "bold");
      pdf.setFontSize(11);
      pdf.text("Bill To", 40, customerTop);

      pdf.setFont("helvetica", "normal");
      pdf.setFontSize(10);

      const customerLines = [
        String(doc.customer_name || ""),
        String(doc.customer_address || ""),
        doc.customer_phone ? `Phone: ${doc.customer_phone}` : "",
      ].filter((x) => String(x).trim().length > 0);

      const cl: string[] = [];
      for (const line of customerLines) {
        const lines = pdf.splitTextToSize(String(line), pageW - 80);
        cl.push(...lines);
      }
      pdf.text(cl, 40, customerTop + 16);

      const tableStartY = customerTop + 16 + cl.length * 12 + 18;

      autoTable(pdf, {
        startY: tableStartY,
        head: [["Sr", "Description", "HSN/SAC", "Qty", "Rate", "Amount"]],
        body: items.map((it, i) => [
          String(i + 1),
          String(it.description || ""),
          String(it.hsn || "-"),
          String(Number(it.qty || 0)),
          moneyPDF(Number(it.rate || 0), currency),
          moneyPDF(Number(it.amount || 0), currency),
        ]),
        styles: {
          font: "helvetica",
          fontSize: 9,
          cellPadding: 6,
          overflow: "linebreak",
        },
        headStyles: { fillColor: [30, 41, 59], textColor: 255 },
        columnStyles: {
          0: { cellWidth: 34, halign: "center" },
          2: { cellWidth: 70, halign: "center" },
          3: { cellWidth: 46, halign: "center" },
          4: { cellWidth: 90, halign: "right" },
          5: { cellWidth: 100, halign: "right" },
        },
        margin: { left: 40, right: 40 },
      });

      // @ts-ignore
      const afterTableY = (pdf as any).lastAutoTable.finalY + 18;

      const boxW = 250;
      const boxX = pageW - 40 - boxW;
      const boxY = afterTableY;
      const rowH = 16;

      pdf.setDrawColor(226, 232, 240);
      pdf.setFillColor(248, 250, 252);
      pdf.roundedRect(boxX, boxY, boxW, 90, 10, 10, "FD");

      pdf.setTextColor(15, 23, 42);
      pdf.setFont("helvetica", "normal");
      pdf.setFontSize(10);

      pdf.text("Subtotal", boxX + 12, boxY + 24);
      pdf.text(moneyPDF(Number(totals.subtotal || 0), currency), boxX + boxW - 12, boxY + 24, {
        align: "right",
      });

      pdf.text(`Tax (${Number(totals.tax_percent || 0).toFixed(0)}%)`, boxX + 12, boxY + 24 + rowH);
      pdf.text(moneyPDF(Number(totals.tax_amount || 0), currency), boxX + boxW - 12, boxY + 24 + rowH, {
        align: "right",
      });

      pdf.setFont("helvetica", "bold");
      pdf.text("Grand Total", boxX + 12, boxY + 24 + rowH * 2 + 8);
      pdf.text(moneyPDF(Number(totals.total || 0), currency), boxX + boxW - 12, boxY + 24 + rowH * 2 + 8, {
        align: "right",
      });

      const termsTitleY = pageH - 160;
      pdf.setFont("helvetica", "bold");
      pdf.setFontSize(11);
      pdf.setTextColor(15, 23, 42);
      pdf.text("Terms & Conditions", 40, termsTitleY);

      pdf.setFont("helvetica", "normal");
      pdf.setFontSize(9);
      pdf.setTextColor(51, 65, 85);
      const termsLines = pdf.splitTextToSize(
        String(totals.terms || DEFAULT_TERMS),
        pageW - 320
      );
      pdf.text(termsLines, 40, termsTitleY + 14);

      const sigX1 = pageW - 240;
      const sigX2 = pageW - 40;
      const sigY = pageH - 120;

      pdf.setDrawColor(148, 163, 184);
      pdf.line(sigX1, sigY, sigX2, sigY);

      pdf.setFont("helvetica", "bold");
      pdf.setFontSize(10);
      pdf.setTextColor(30, 41, 59);
      pdf.text("Authorised Signature", pageW - 40, sigY + 16, { align: "right" });

      if (!isPremium) {
        pdf.setTextColor(148, 163, 184);
        pdf.setFont("helvetica", "normal");
        pdf.setFontSize(9);
        pdf.text("Generated by Ledgerly", pageW - 40, pageH - 18, {
          align: "right",
        });
      }

      pdf.save(`${safeFileName(title)}-${safeFileName(docNo)}.pdf`);
      toast.success("PDF downloaded");
    } catch (e: any) {
      toast.error(e?.message || "PDF download failed");
    }
  };

  const moneyUI = (n: number, code: string) => {
    const c = (code || "INR").toUpperCase();
    if (c === "INR") return `₹${formatNumber(n)}`;
    const map: Record<string, string> = { USD: "$", EUR: "€", GBP: "£" };
    return `${map[c] || c}${formatNumber(n)}`;
  };

  // ✅ Reusable form JSX (used in both Create and Edit dialogs)
  const renderForm = () => (
    <div className="space-y-5">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="space-y-2">
          <Label>Type</Label>
          <Select
            value={form.type}
            onValueChange={(v) => {
              const t = v as DocType;
              setForm((p) => ({
                ...p,
                type: t,
                totals: { ...p.totals, note: introText(t) },
              }));
            }}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="invoice">Invoice</SelectItem>
              <SelectItem value="quotation">Quotation</SelectItem>
              <SelectItem value="bill">Bill</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label>Document No. (Serial No.)</Label>
          <Input
            value={form.doc_no}
            onChange={(e) => setForm({ ...form, doc_no: e.target.value })}
            placeholder="INV-001 / QT-001 / BILL-001"
          />
        </div>

        <div className="space-y-2">
          <Label>Currency</Label>
          <Select
            value={form.currency_code}
            onValueChange={(v) => setForm({ ...form, currency_code: v })}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="INR">INR (₹)</SelectItem>
              <SelectItem value="USD">USD ($)</SelectItem>
              <SelectItem value="EUR">EUR (€)</SelectItem>
              <SelectItem value="GBP">GBP (£)</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="space-y-2">
          <Label>Customer Name</Label>
          <Input
            value={form.customer_name}
            onChange={(e) =>
              setForm({ ...form, customer_name: e.target.value })
            }
          />
        </div>
        <div className="space-y-2">
          <Label>Customer Phone</Label>
          <Input
            value={form.customer_phone}
            onChange={(e) =>
              setForm({ ...form, customer_phone: e.target.value })
            }
          />
        </div>
        <div className="space-y-2 sm:col-span-2">
          <Label>Customer Address</Label>
          <Textarea
            value={form.customer_address}
            onChange={(e) =>
              setForm({ ...form, customer_address: e.target.value })
            }
            rows={2}
          />
        </div>
      </div>

      <div className="space-y-2">
        <Label>Intro Note (appears in PDF)</Label>
        <Textarea
          value={form.totals.note}
          onChange={(e) =>
            setForm({
              ...form,
              totals: { ...form.totals, note: e.target.value },
            })
          }
          rows={3}
        />
      </div>

      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <Label>Items (with HSN/SAC)</Label>
          <Button variant="outline" size="sm" onClick={addItem}>
            + Add Item
          </Button>
        </div>

        {form.items.map((item, idx) => (
          <div
            key={idx}
            className="rounded-lg border border-border p-3 space-y-3"
          >
            <div className="grid grid-cols-1 sm:grid-cols-12 gap-2 items-end">
              <div className="sm:col-span-5">
                <Label className="text-xs">Description</Label>
                <Input
                  placeholder="e.g. Service / Product"
                  value={item.description}
                  onChange={(e) =>
                    updateItem(idx, "description", e.target.value)
                  }
                />
              </div>
              <div className="sm:col-span-2">
                <Label className="text-xs">HSN/SAC</Label>
                <Input
                  placeholder="e.g. 9983"
                  value={item.hsn}
                  onChange={(e) => updateItem(idx, "hsn", e.target.value)}
                />
              </div>
              <div className="sm:col-span-1">
                <Label className="text-xs">Qty</Label>
                <Input
                  type="number"
                  value={item.qty}
                  onChange={(e) =>
                    updateItem(idx, "qty", Number(e.target.value))
                  }
                />
              </div>
              <div className="sm:col-span-2">
                <Label className="text-xs">Rate</Label>
                <Input
                  type="number"
                  value={item.rate}
                  onChange={(e) =>
                    updateItem(idx, "rate", Number(e.target.value))
                  }
                />
              </div>
              <div className="sm:col-span-2 text-right">
                <Label className="text-xs">Amount</Label>
                <div className="h-10 flex items-center justify-end font-semibold">
                  {moneyUI(Number(item.amount || 0), form.currency_code)}
                </div>
              </div>
            </div>

            <div className="flex justify-end">
              <Button
                variant="ghost"
                size="sm"
                className="text-destructive"
                onClick={() => removeItem(idx)}
                disabled={form.items.length === 1}
              >
                Remove
              </Button>
            </div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 items-end">
        <div className="space-y-2">
          <Label>Tax % (optional)</Label>
          <Input
            type="number"
            value={form.totals.tax_percent}
            onChange={(e) =>
              recalcTotals(form.items, Number(e.target.value))
            }
            placeholder="0"
          />
        </div>

        <div className="sm:col-span-2 text-right space-y-1">
          <p className="text-sm text-muted-foreground">
            Subtotal: {moneyUI(form.totals.subtotal, form.currency_code)}
          </p>
          <p className="text-sm text-muted-foreground">
            Tax: {moneyUI(form.totals.tax_amount, form.currency_code)}
          </p>
          <p className="text-lg font-bold">
            Grand Total: {moneyUI(form.totals.total, form.currency_code)}
          </p>
        </div>
      </div>

      <div className="space-y-2">
        <Label>Terms & Conditions (appears in PDF)</Label>
        <Textarea
          value={form.totals.terms}
          onChange={(e) =>
            setForm({
              ...form,
              totals: { ...form.totals, terms: e.target.value },
            })
          }
          rows={5}
        />
      </div>
    </div>
  );

  return (
    <div className="animate-fade-in space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-2xl font-display font-bold flex items-center gap-2">
          <FileText className="h-6 w-6" /> Documents
        </h1>

        <Dialog open={showCreate} onOpenChange={setShowCreate}>
          <DialogTrigger asChild>
            <Button size="sm" className="gap-2">
              <Plus className="h-4 w-4" /> New Document
            </Button>
          </DialogTrigger>

          <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Create Document</DialogTitle>
            </DialogHeader>

            {renderForm()}

            <Button onClick={save} className="w-full mt-4">
              Save Document
            </Button>
          </DialogContent>
        </Dialog>
      </div>

      {/* ✅ Edit Dialog */}
      <Dialog open={showEdit} onOpenChange={setShowEdit}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Edit Document</DialogTitle>
          </DialogHeader>

          {renderForm()}

          <Button onClick={saveEdit} className="w-full mt-4">
            Update Document
          </Button>
        </DialogContent>
      </Dialog>

      <div className="grid gap-3">
        {docs.map((d) => (
          <Card key={d.id} className="glass-card">
            <CardContent className="flex items-center justify-between py-4 gap-3">
              <div className="min-w-0">
                <p className="font-medium truncate">
                  {String(d.type || "").toUpperCase()} — {d.doc_no || "No number"}
                </p>
                <p className="text-sm text-muted-foreground truncate">
                  {d.customer_name || "Customer"} ·{" "}
                  {d.created_at ? new Date(d.created_at).toLocaleDateString() : ""}
                  {d.totals?.total !== undefined
                    ? ` · Total: ${moneyUI(
                        Number(d.totals.total || 0),
                        d.currency_code || "INR"
                      )}`
                    : ""}
                </p>
              </div>

              <div className="flex gap-2 shrink-0">
                {/* ✅ Edit button */}
                <Button
                  variant="outline"
                  size="icon"
                  onClick={() => openEdit(d)}
                  title="Edit Document"
                >
                  <Pencil className="h-4 w-4" />
                </Button>

                <Button
                  variant="outline"
                  size="icon"
                  onClick={() => downloadPDF(d)}
                  title="Download PDF"
                >
                  <Download className="h-4 w-4" />
                </Button>

                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button
                      variant="outline"
                      size="icon"
                      className="text-destructive"
                      title="Delete"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Delete this document?</AlertDialogTitle>
                      <AlertDialogDescription>
                        This action cannot be undone.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction onClick={() => deleteDoc(d.id)}>
                        Delete
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </div>
            </CardContent>
          </Card>
        ))}

        {docs.length === 0 && (
          <p className="text-muted-foreground text-sm">No documents yet.</p>
        )}
      </div>
    </div>
  );
}
