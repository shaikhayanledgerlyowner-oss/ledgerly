import React, { useEffect, useRef, useState, useCallback } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Bold, Italic, Underline, Strikethrough,
  AlignLeft, AlignCenter, AlignRight, AlignJustify,
  List, ListOrdered, Undo, Redo, Save, FileText,
  Plus, Trash2, Type, Palette, Link,
  ChevronDown, Download
} from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";

interface Doc {
  id: string;
  title: string;
  content: string;
  updated_at: string;
}

const FONT_SIZES = ["8", "10", "12", "14", "16", "18", "20", "24", "28", "32", "36", "48", "64", "72"];
const FONT_FAMILIES = [
  "Arial", "Times New Roman", "Courier New", "Georgia",
  "Verdana", "Trebuchet MS", "Comic Sans MS", "Impact"
];
const COLORS = [
  "#000000", "#434343", "#666666", "#999999", "#b7b7b7", "#cccccc", "#d9d9d9", "#ffffff",
  "#ff0000", "#ff4500", "#ff9900", "#ffff00", "#00ff00", "#00ffff", "#0000ff", "#9900ff",
  "#ff00ff", "#ff69b4", "#8b0000", "#006400", "#00008b", "#4b0082", "#ff6347", "#ffa500",
];

export default function DocumentEditorPage() {
  const { profile } = useAuth();
  const editorRef = useRef<HTMLDivElement>(null);

  const [docs, setDocs] = useState<Doc[]>([]);
  const [selectedDoc, setSelectedDoc] = useState<Doc | null>(null);
  const [title, setTitle] = useState("Untitled Document");
  const [saving, setSaving] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Doc | null>(null);

  const [showColorPicker, setShowColorPicker] = useState(false);
  const [showBgColorPicker, setShowBgColorPicker] = useState(false);
  const [activeFormats, setActiveFormats] = useState<Record<string, boolean>>({});
  const [fontSize, setFontSize] = useState("14");
  const [fontFamily, setFontFamily] = useState("Arial");

  const saveTimeout = useRef<NodeJS.Timeout | null>(null);

  // Load documents
  const loadDocs = async () => {
    if (!profile) return;
    const { data } = await supabase
      .from("user_documents")
      .select("*")
      .eq("user_id", profile.id)
      .order("updated_at", { ascending: false });
    setDocs((data ?? []) as Doc[]);
  };

  useEffect(() => {
    loadDocs();
  }, [profile]);

  // Select doc
  const selectDoc = (doc: Doc) => {
    setSelectedDoc(doc);
    setTitle(doc.title);
    if (editorRef.current) {
      editorRef.current.innerHTML = doc.content || "";
    }
  };

  // New document
  const createNewDoc = async () => {
    if (!profile) return;
    const { data, error } = await supabase
      .from("user_documents")
      .insert({ user_id: profile.id, title: "Untitled Document", content: "" })
      .select("*")
      .single();
    if (error) return toast.error(error.message);
    toast.success("New document created!");
    await loadDocs();
    selectDoc(data as Doc);
  };

  // Auto save
  const autoSave = useCallback(async () => {
    if (!selectedDoc || !profile) return;
    const content = editorRef.current?.innerHTML || "";
    const { error } = await supabase
      .from("user_documents")
      .update({ title, content, updated_at: new Date().toISOString() })
      .eq("id", selectedDoc.id);
    if (!error) {
      setDocs(prev => prev.map(d => d.id === selectedDoc.id ? { ...d, title, content } : d));
    }
  }, [selectedDoc, title, profile]);

  // Manual save
  const handleSave = async () => {
    if (!selectedDoc) return;
    setSaving(true);
    await autoSave();
    setSaving(false);
    toast.success("Document saved!");
  };

  // Trigger auto save on content change
  const handleContentChange = () => {
    if (saveTimeout.current) clearTimeout(saveTimeout.current);
    saveTimeout.current = setTimeout(() => {
      autoSave();
    }, 2000);
    updateActiveFormats();
  };

  // Delete doc
  const handleDelete = async () => {
    if (!deleteTarget) return;
    const { error } = await supabase.from("user_documents").delete().eq("id", deleteTarget.id);
    if (error) return toast.error(error.message);
    toast.success("Document deleted!");
    setDeleteDialogOpen(false);
    setDeleteTarget(null);
    if (selectedDoc?.id === deleteTarget.id) {
      setSelectedDoc(null);
      if (editorRef.current) editorRef.current.innerHTML = "";
    }
    await loadDocs();
  };

  // Format commands
  const exec = (command: string, value?: string) => {
    editorRef.current?.focus();
    document.execCommand(command, false, value);
    updateActiveFormats();
  };

  const updateActiveFormats = () => {
    setActiveFormats({
      bold: document.queryCommandState("bold"),
      italic: document.queryCommandState("italic"),
      underline: document.queryCommandState("underline"),
      strikeThrough: document.queryCommandState("strikeThrough"),
      justifyLeft: document.queryCommandState("justifyLeft"),
      justifyCenter: document.queryCommandState("justifyCenter"),
      justifyRight: document.queryCommandState("justifyRight"),
      justifyFull: document.queryCommandState("justifyFull"),
      insertUnorderedList: document.queryCommandState("insertUnorderedList"),
      insertOrderedList: document.queryCommandState("insertOrderedList"),
    });
  };

  // Insert link
  const insertLink = () => {
    const url = prompt("Enter URL:");
    if (url) exec("createLink", url);
  };

  // Insert image
  const insertImage = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      exec("insertImage", ev.target?.result as string);
    };
    reader.readAsDataURL(file);
    e.target.value = "";
  };

  // Download as HTML
  const downloadHTML = () => {
    if (!editorRef.current) return;
    const content = editorRef.current.innerHTML;
    const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>${title}</title><style>body{font-family:Arial;max-width:800px;margin:40px auto;padding:0 20px;line-height:1.6}</style></head><body>${content}</body></html>`;
    const blob = new Blob([html], { type: "text/html" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${title}.html`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Download as TXT
  const downloadTXT = () => {
    if (!editorRef.current) return;
    const text = editorRef.current.innerText;
    const blob = new Blob([text], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${title}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Print / Save as PDF
  const printDoc = () => {
    if (!editorRef.current) return;
    const content = editorRef.current.innerHTML;
    const win = window.open("", "_blank");
    if (!win) return;
    win.document.write(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>${title}</title><style>body{font-family:Arial;max-width:800px;margin:40px auto;padding:0 20px;line-height:1.6}@media print{body{margin:0}}</style></head><body>${content}</body></html>`);
    win.document.close();
    win.print();
  };

  const toolbarBtn = (active: boolean) =>
    cn(
      "h-8 w-8 p-0 rounded flex items-center justify-center transition-colors",
      active
        ? "bg-primary text-primary-foreground"
        : "hover:bg-muted text-foreground"
    );

  return (
    <>
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Document?</AlertDialogTitle>
            <AlertDialogDescription>
              "{deleteTarget?.title}" permanently delete ho jaayega.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <div className="flex h-[calc(100vh-56px)] overflow-hidden">
        {/* Sidebar */}
        <div className="w-64 border-r border-border bg-card flex flex-col shrink-0">
          <div className="p-3 border-b border-border">
            <Button onClick={createNewDoc} className="w-full gap-2" size="sm">
              <Plus className="h-4 w-4" /> New Document
            </Button>
          </div>
          <div className="flex-1 overflow-y-auto p-2 space-y-1">
            {docs.length === 0 && (
              <p className="text-xs text-muted-foreground text-center pt-4">
                No documents yet
              </p>
            )}
            {docs.map((doc) => (
              <div
                key={doc.id}
                onClick={() => selectDoc(doc)}
                className={cn(
                  "flex items-center justify-between rounded-lg px-3 py-2 cursor-pointer group transition-colors",
                  selectedDoc?.id === doc.id
                    ? "bg-primary/10 text-primary"
                    : "hover:bg-muted"
                )}
              >
                <div className="flex items-center gap-2 min-w-0">
                  <FileText className="h-4 w-4 shrink-0" />
                  <span className="text-sm truncate">{doc.title}</span>
                </div>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setDeleteTarget(doc);
                    setDeleteDialogOpen(true);
                  }}
                  className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-destructive/10"
                >
                  <Trash2 className="h-3 w-3 text-destructive" />
                </button>
              </div>
            ))}
          </div>
        </div>

        {/* Editor Area */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {selectedDoc ? (
            <>
              {/* Title Bar */}
              <div className="flex items-center gap-3 px-4 py-2 border-b border-border bg-card">
                <Input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  onBlur={handleSave}
                  className="text-base font-medium border-none shadow-none focus-visible:ring-0 px-0 h-8"
                  placeholder="Document title..."
                />
                <div className="flex items-center gap-2 shrink-0">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={handleSave}
                    disabled={saving}
                    className="gap-2"
                  >
                    <Save className="h-4 w-4" />
                    {saving ? "Saving..." : "Save"}
                  </Button>

                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button size="sm" variant="outline" className="gap-2">
                        <Download className="h-4 w-4" />
                        Export
                        <ChevronDown className="h-3 w-3" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent>
                      <DropdownMenuItem onClick={printDoc}>
                        Save as PDF (Print)
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={downloadHTML}>
                        Download as HTML
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={downloadTXT}>
                        Download as TXT
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </div>

              {/* Toolbar */}
              <div className="flex items-center gap-1 flex-wrap px-3 py-2 border-b border-border bg-card">

                {/* Undo/Redo */}
                <button className={toolbarBtn(false)} onClick={() => exec("undo")} title="Undo">
                  <Undo className="h-4 w-4" />
                </button>
                <button className={toolbarBtn(false)} onClick={() => exec("redo")} title="Redo">
                  <Redo className="h-4 w-4" />
                </button>

                <div className="w-px h-6 bg-border mx-1" />

                {/* Font Family */}
                <Select value={fontFamily} onValueChange={(v) => { setFontFamily(v); exec("fontName", v); }}>
                  <SelectTrigger className="h-8 w-36 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {FONT_FAMILIES.map(f => (
                      <SelectItem key={f} value={f} style={{ fontFamily: f }}>{f}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                {/* Font Size */}
                <Select value={fontSize} onValueChange={(v) => { setFontSize(v); exec("fontSize", "3"); if (editorRef.current) { const sel = window.getSelection(); if (sel && sel.rangeCount > 0) { const range = sel.getRangeAt(0); const span = document.createElement("span"); span.style.fontSize = v + "px"; try { range.surroundContents(span); } catch {} } } }}>
                  <SelectTrigger className="h-8 w-16 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {FONT_SIZES.map(s => (
                      <SelectItem key={s} value={s}>{s}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                <div className="w-px h-6 bg-border mx-1" />

                {/* Bold Italic Underline Strike */}
                <button className={toolbarBtn(activeFormats.bold)} onClick={() => exec("bold")} title="Bold">
                  <Bold className="h-4 w-4" />
                </button>
                <button className={toolbarBtn(activeFormats.italic)} onClick={() => exec("italic")} title="Italic">
                  <Italic className="h-4 w-4" />
                </button>
                <button className={toolbarBtn(activeFormats.underline)} onClick={() => exec("underline")} title="Underline">
                  <Underline className="h-4 w-4" />
                </button>
                <button className={toolbarBtn(activeFormats.strikeThrough)} onClick={() => exec("strikeThrough")} title="Strikethrough">
                  <Strikethrough className="h-4 w-4" />
                </button>

                <div className="w-px h-6 bg-border mx-1" />

                {/* Text Color */}
                <div className="relative">
                  <button
                    className={toolbarBtn(false)}
                    onClick={() => { setShowColorPicker(!showColorPicker); setShowBgColorPicker(false); }}
                    title="Text Color"
                  >
                    <Type className="h-4 w-4" />
                  </button>
                  {showColorPicker && (
                    <div className="absolute top-9 left-0 z-50 bg-card border border-border rounded-lg shadow-lg p-2 grid grid-cols-8 gap-1 w-48">
                      {COLORS.map(c => (
                        <button
                          key={c}
                          style={{ backgroundColor: c }}
                          className="w-5 h-5 rounded border border-border hover:scale-110 transition-transform"
                          onClick={() => { exec("foreColor", c); setShowColorPicker(false); }}
                        />
                      ))}
                    </div>
                  )}
                </div>

                {/* Background Color */}
                <div className="relative">
                  <button
                    className={toolbarBtn(false)}
                    onClick={() => { setShowBgColorPicker(!showBgColorPicker); setShowColorPicker(false); }}
                    title="Highlight Color"
                  >
                    <Palette className="h-4 w-4" />
                  </button>
                  {showBgColorPicker && (
                    <div className="absolute top-9 left-0 z-50 bg-card border border-border rounded-lg shadow-lg p-2 grid grid-cols-8 gap-1 w-48">
                      {COLORS.map(c => (
                        <button
                          key={c}
                          style={{ backgroundColor: c }}
                          className="w-5 h-5 rounded border border-border hover:scale-110 transition-transform"
                          onClick={() => { exec("hiliteColor", c); setShowBgColorPicker(false); }}
                        />
                      ))}
                    </div>
                  )}
                </div>

                <div className="w-px h-6 bg-border mx-1" />

                {/* Alignment */}
                <button className={toolbarBtn(activeFormats.justifyLeft)} onClick={() => exec("justifyLeft")} title="Align Left">
                  <AlignLeft className="h-4 w-4" />
                </button>
                <button className={toolbarBtn(activeFormats.justifyCenter)} onClick={() => exec("justifyCenter")} title="Align Center">
                  <AlignCenter className="h-4 w-4" />
                </button>
                <button className={toolbarBtn(activeFormats.justifyRight)} onClick={() => exec("justifyRight")} title="Align Right">
                  <AlignRight className="h-4 w-4" />
                </button>
                <button className={toolbarBtn(activeFormats.justifyFull)} onClick={() => exec("justifyFull")} title="Justify">
                  <AlignJustify className="h-4 w-4" />
                </button>

                <div className="w-px h-6 bg-border mx-1" />

                {/* Lists */}
                <button className={toolbarBtn(activeFormats.insertUnorderedList)} onClick={() => exec("insertUnorderedList")} title="Bullet List">
                  <List className="h-4 w-4" />
                </button>
                <button className={toolbarBtn(activeFormats.insertOrderedList)} onClick={() => exec("insertOrderedList")} title="Numbered List">
                  <ListOrdered className="h-4 w-4" />
                </button>

                <div className="w-px h-6 bg-border mx-1" />

                {/* Link */}
                <button className={toolbarBtn(false)} onClick={insertLink} title="Insert Link">
                  <Link className="h-4 w-4" />
                </button>

                {/* Image Upload */}
                <label className={toolbarBtn(false)} title="Insert Image" style={{ cursor: "pointer" }}>
                  <span className="text-xs font-bold">IMG</span>
                  <input type="file" accept="image/*" className="hidden" onChange={insertImage} />
                </label>

              </div>

              {/* Editor Canvas */}
              <div className="flex-1 overflow-y-auto bg-gray-100 dark:bg-gray-900 p-6">
                <div
                  className="mx-auto bg-white dark:bg-gray-800 shadow-md min-h-[1000px]"
                  style={{
                    width: "210mm",
                    minHeight: "297mm",
                    padding: "20mm",
                    fontFamily: fontFamily,
                    fontSize: fontSize + "px",
                  }}
                >
                  <div
                    ref={editorRef}
                    contentEditable
                    suppressContentEditableWarning
                    onInput={handleContentChange}
                    onKeyUp={updateActiveFormats}
                    onMouseUp={updateActiveFormats}
                    className="outline-none min-h-full"
                    style={{
                      lineHeight: "1.6",
                      wordBreak: "break-word",
                    }}
                    data-placeholder="Yahan type karo..."
                  />
                </div>
              </div>
            </>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center text-center p-8">
              <FileText className="h-16 w-16 text-muted-foreground mb-4" />
              <h2 className="text-xl font-semibold mb-2">Koi document select nahi hai</h2>
              <p className="text-muted-foreground mb-4">Left sidebar se document select karo ya naya banao</p>
              <Button onClick={createNewDoc} className="gap-2">
                <Plus className="h-4 w-4" /> New Document
              </Button>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
