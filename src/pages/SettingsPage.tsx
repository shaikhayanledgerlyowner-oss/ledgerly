import React, { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Camera, Upload, Trash2, Lock, Eye, EyeOff } from "lucide-react";
import { hashPin, clearPinSession } from "@/components/PinLock";

const countries = [
  { code: "IN", name: "India", currency: "INR" },
  { code: "US", name: "United States", currency: "USD" },
  { code: "GB", name: "United Kingdom", currency: "GBP" },
  { code: "EU", name: "Europe", currency: "EUR" },
  { code: "AE", name: "UAE", currency: "AED" },
];

type BrandingState = {
  business_name: string;
  address: string;
  phone: string;
  email: string;
  gstin: string;
  country_code: string;
  currency_code: string;
  logo_url: string | null;
  signature_url: string | null;
};

function to12HourLabel(hhmm: string) {
  const [hStr, mStr] = (hhmm || "09:00").split(":");
  let h = Number(hStr);
  const m = Number(mStr);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return hhmm;

  const ampm = h >= 12 ? "PM" : "AM";
  h = h % 12;
  if (h === 0) h = 12;

  const mm = String(m).padStart(2, "0");
  return `${h}:${mm} ${ampm}`;
}

export default function SettingsPage() {
  const { profile, isPremium, refreshProfile, refreshCurrency } = useAuth();

  const [displayName, setDisplayName] = useState("");
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);

  const [branding, setBranding] = useState<BrandingState>({
    business_name: "",
    address: "",
    phone: "",
    email: "",
    gstin: "",
    country_code: "IN",
    currency_code: "INR",
    logo_url: null,
    signature_url: null,
  });

  const [reminder, setReminder] = useState({
    time: "09:00",
    enabled: true,
    message: "Your daily entry is pending.",
    email: "",
  });

  const [purchaseStatus, setPurchaseStatus] = useState<string | null>(null);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [uploadingSig, setUploadingSig] = useState(false);
  const [removingLogo, setRemovingLogo] = useState(false);
  const [removingSig, setRemovingSig] = useState(false);

  const initials = useMemo(() => {
    const base =
      (displayName?.trim() ? displayName : "") ||
      (profile?.email ? profile.email : "") ||
      "U";
    return base.slice(0, 2).toUpperCase();
  }, [displayName, profile?.email]);

  const explainStorageError = (msg: string, bucketName: string) => {
    const lower = (msg || "").toLowerCase();
    if (lower.includes("bucket") && (lower.includes("not found") || lower.includes("does not exist"))) {
      toast.error(`Storage bucket "${bucketName}" nahi mila. Supabase → Storage me "${bucketName}" bucket create karo (Public ON).`);
      return true;
    }
    return false;
  };

  const uploadFile = async (bucket: string, file: File, folder: string) => {
    const savePin = async () => {
    if (pinInput.length !== 4 || !/^\d{4}$/.test(pinInput)) {
      toast.error("PIN 4 digits ka hona chahiye"); return;
    }
    if (pinStep === "set") {
      setPinStep("confirm"); setPinConfirm(""); return;
    }
    if (pinStep === "confirm") {
      if (pinInput !== pinConfirm) {
        toast.error("PIN match nahi hua! Dobara try karo.");
        setPinStep("set"); setPinInput(""); setPinConfirm(""); return;
      }
      setPinLoading(true);
      const hash = await hashPin(pinInput);
      const { error } = await supabase.from("profiles").update({ pin_hash: hash } as any).eq("id", profile!.id);
      if (error) toast.error(error.message);
      else { toast.success("PIN set ho gaya! ✅"); setHasPinSet(true); setPinStep("idle"); setPinInput(""); setPinConfirm(""); }
      setPinLoading(false);
    }
  };

  const removePin = async () => {
    setPinLoading(true);
    const { error } = await supabase.from("profiles").update({ pin_hash: null } as any).eq("id", profile!.id);
    if (error) toast.error(error.message);
    else { toast.success("PIN hata diya gaya"); setHasPinSet(false); setPinStep("idle"); clearPinSession(); }
    setPinLoading(false);
  };

  if (!profile) return null;
    const ext = file.name.split(".").pop() || "png";
    const path = `${profile.id}/${folder}_${Date.now()}.${ext}`;
    const { error } = await supabase.storage.from(bucket).upload(path, file, { upsert: true });
    if (error) {
      if (!explainStorageError(error.message, bucket)) toast.error(error.message);
      return null;
    }
    const { data: urlData } = supabase.storage.from(bucket).getPublicUrl(path);
    return urlData.publicUrl || null;
  };

  const getStoragePathFromPublicUrl = (publicUrl: string, bucket: string) => {
    try {
      const marker = `/storage/v1/object/public/${bucket}/`;
      const idx = publicUrl.indexOf(marker);
      if (idx === -1) return null;
      return publicUrl.slice(idx + marker.length);
    } catch { return null; }
  };

  const removeBrandingAsset = async (key: "logo_url" | "signature_url") => {
    if (!profile) return;
    const isLogo = key === "logo_url";
    const currentUrl = branding[key];
    if (!currentUrl) return;
    try {
      isLogo ? setRemovingLogo(true) : setRemovingSig(true);
      const bucket = "branding";
      const path = getStoragePathFromPublicUrl(currentUrl, bucket);
      if (path) await supabase.storage.from(bucket).remove([path]);
      const patch: any = { user_id: profile.id };
      patch[key] = null;
      const { error } = await supabase.from("user_branding").upsert(patch, { onConflict: "user_id" });
      if (error) { toast.error(error.message); return; }
      setBranding((b) => ({ ...b, [key]: null }));
      toast.success(isLogo ? "Logo removed!" : "Signature removed!");
    } finally {
      isLogo ? setRemovingLogo(false) : setRemovingSig(false);
    }
  };

  // ✅ Browser Notifications
  const requestBrowserPermission = async (): Promise<boolean> => {
    if (!("Notification" in window)) {
      toast.error("Aapka browser notifications support nahi karta");
      return false;
    }
    if (Notification.permission === "granted") return true;
    const permission = await Notification.requestPermission();
    if (permission === "granted") {
      toast.success("Notifications allow ho gayi!");
      return true;
    }
    toast.error("Permission denied. Browser settings se allow karo.");
    return false;
  };

  // ---------- Load ----------
  useEffect(() => {
    if (!profile) return;
    setDisplayName((profile as any).display_name || "");
    setAvatarUrl((profile as any).avatar_url || null);

    (async () => {
      const { data: b, error: bErr } = await supabase.from("user_branding").select("*").eq("user_id", profile.id).maybeSingle();
      if (bErr) toast.error(bErr.message);
      else if (b) {
        setBranding({
          business_name: b.business_name || "",
          address: b.address || "",
          phone: b.phone || "",
          email: b.email || "",
          gstin: (b as any).gstin || "",
          country_code: (b as any).country_code || "IN",
          currency_code: (b as any).currency_code || "INR",
          logo_url: (b as any).logo_url || null,
          signature_url: (b as any).signature_url || null,
        });
      }

      const { data: r } = await supabase.from("reminders").select("*").eq("user_id", profile.id).maybeSingle();
      if (r) {
        setReminder({
          time: (r as any).reminder_time || "09:00",
          enabled: (r as any).enabled ?? true,
          message: (r as any).message || "Your daily entry is pending.",
          email: (r as any).email || profile?.email || "",
        });
      } else {
        // Default: profile email pre-fill karo
        setReminder(prev => ({ ...prev, email: profile?.email || "" }));
      }

      const { data: p } = await supabase.from("purchase_requests").select("status").eq("user_id", profile.id).order("created_at", { ascending: false }).limit(1).maybeSingle();
      setPurchaseStatus((p as any)?.status || null);
    })();
  }, [profile]);

  const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !profile) return;
    setUploadingAvatar(true);
    const url = await uploadFile("avatars", file, "avatar");
    if (url) {
      const { error } = await supabase.from("profiles").update({ avatar_url: url } as any).eq("id", profile.id);
      if (error) toast.error(error.message);
      else { setAvatarUrl(url); await refreshProfile(); toast.success("Avatar updated!"); }
    }
    setUploadingAvatar(false);
    e.target.value = "";
  };

  const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !profile) return;
    setUploadingLogo(true);
    const url = await uploadFile("branding", file, "logo");
    if (url) {
      const { error } = await supabase.from("user_branding").upsert({ user_id: profile.id, logo_url: url } as any, { onConflict: "user_id" });
      if (error) toast.error(error.message);
      else { setBranding((b) => ({ ...b, logo_url: url })); toast.success("Logo uploaded!"); }
    }
    setUploadingLogo(false);
    e.target.value = "";
  };

  const handleSignatureUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !profile) return;
    e.target.value = "";

    // ✅ Validate image dimensions — must be between 300x100 and 800x300
    const validationError = await new Promise<string | null>((resolve) => {
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => {
        URL.revokeObjectURL(url);
        const { width, height } = img;
        if (width < 200 || height < 50) {
          resolve(`Image too small (${width}×${height}px). Minimum: 200×50px`);
        } else if (width > 1200 || height > 400) {
          resolve(`Image too large (${width}×${height}px). Maximum: 1200×400px`);
        } else if (width < height * 2) {
          resolve(`Signature must be wider than tall (landscape). Got ${width}×${height}px`);
        } else {
          resolve(null);
        }
      };
      img.onerror = () => { URL.revokeObjectURL(url); resolve("Invalid image file"); };
      img.src = url;
    });

    if (validationError) {
      toast.error(validationError);
      return;
    }

    // ✅ File size max 500KB
    if (file.size > 500 * 1024) {
      toast.error("File too large. Maximum 500KB allowed.");
      return;
    }

    setUploadingSig(true);
    const url = await uploadFile("branding", file, "signature");
    if (url) {
      const { error } = await supabase.from("user_branding").upsert({ user_id: profile.id, signature_url: url } as any, { onConflict: "user_id" });
      if (error) toast.error(error.message);
      else { setBranding((b) => ({ ...b, signature_url: url })); toast.success("Signature uploaded!"); }
    }
    setUploadingSig(false);
    e.target.value = "";
  };

  const saveProfile = async () => {
    if (!profile) return;
    const { error } = await supabase.from("profiles").update({ display_name: displayName } as any).eq("id", profile.id);
    if (error) toast.error(error.message);
    else { await refreshProfile(); toast.success("Profile saved!"); }
  };

  const saveBranding = async () => {
    if (!profile) return;
    const payload = {
      user_id: profile.id,
      business_name: branding.business_name,
      address: branding.address,
      phone: branding.phone,
      email: branding.email,
      gstin: branding.gstin,
      country_code: branding.country_code,
      currency_code: branding.currency_code,
      logo_url: branding.logo_url,
      signature_url: branding.signature_url,
      updated_at: new Date().toISOString(),
    };
    const { error } = await supabase.from("user_branding").upsert(payload as any, { onConflict: "user_id" });
    if (error) toast.error(error.message);
    else { await refreshCurrency(); toast.success("Branding saved!"); }
  };

  const saveReminder = async () => {
    if (!profile) return;

    if (!reminder.email) {
      toast.error("Email address zaroori hai reminder ke liye");
      return;
    }

    const reminderData = {
      reminder_time: reminder.time,
      enabled: reminder.enabled,
      message: reminder.message,
      email: reminder.email,
    };

    const { data: existing } = await supabase.from("reminders").select("id").eq("user_id", profile.id).maybeSingle();

    if ((existing as any)?.id) {
      const { error } = await supabase.from("reminders").update(reminderData as any).eq("user_id", profile.id);
      if (error) { toast.error(error.message); return; }
    } else {
      const { error } = await supabase.from("reminders").insert({ user_id: profile.id, ...reminderData } as any);
      if (error) { toast.error(error.message); return; }
    }

    toast.success(`✅ Reminder save ho gaya! Email jaayegi ${reminder.email} pe ${to12HourLabel(reminder.time)} baje.`);
  };

  const handleCountryChange = (code: string) => {
    const country = countries.find((c) => c.code === code);
    setBranding((prev) => ({
      ...prev,
      country_code: code,
      currency_code: country?.currency || prev.currency_code,
    }));
  };

  const reminderTimeLabel = useMemo(() => to12HourLabel(reminder.time), [reminder.time]);

  return (
    <div className="animate-fade-in space-y-6 max-w-2xl">
      <h1 className="text-2xl font-display font-bold">Settings</h1>

      {/* Your Profile */}
      <Card className="glass-card">
        <CardHeader><CardTitle className="text-lg">Your Profile</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-4">
            <div className="relative group">
              <Avatar className="h-16 w-16">
                <AvatarImage src={avatarUrl || undefined} />
                <AvatarFallback className="bg-primary/10 text-primary text-lg font-semibold">{initials}</AvatarFallback>
              </Avatar>
              <label className="absolute inset-0 flex items-center justify-center rounded-full bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer">
                <Camera className="h-5 w-5 text-white" />
                <input type="file" accept="image/*" className="hidden" onChange={handleAvatarUpload} disabled={uploadingAvatar} />
              </label>
            </div>
            <div>
              <p className="text-sm font-medium">{profile?.email}</p>
              <div className="flex gap-2 mt-1">
                <Badge variant="outline">{(profile as any)?.role}</Badge>
                {isPremium && <Badge className="bg-success text-success-foreground">Premium</Badge>}
              </div>
            </div>
          </div>
          <div className="space-y-2">
            <Label>Display Name</Label>
            <Input value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="Your name" />
          </div>
          {purchaseStatus && (
            <p className="text-sm text-muted-foreground">
              Subscription: <Badge variant={purchaseStatus === "approved" ? "default" : "secondary"}>{purchaseStatus}</Badge>
            </p>
          )}
          <Button onClick={saveProfile}>Save Profile</Button>
        </CardContent>
      </Card>

      {/* Business Branding */}
      <Card className="glass-card">
        <CardHeader><CardTitle className="text-lg">Business Branding</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>Business Name</Label>
            <Input value={branding.business_name} onChange={(e) => setBranding({ ...branding, business_name: e.target.value })} />
          </div>
          <div className="space-y-2">
            <Label>Address</Label>
            <Textarea value={branding.address} onChange={(e) => setBranding({ ...branding, address: e.target.value })} rows={2} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>Phone</Label>
              <Input value={branding.phone} onChange={(e) => setBranding({ ...branding, phone: e.target.value })} />
            </div>
            <div className="space-y-2">
              <Label>Email</Label>
              <Input value={branding.email} onChange={(e) => setBranding({ ...branding, email: e.target.value })} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>GSTIN</Label>
              <Input value={branding.gstin} onChange={(e) => setBranding({ ...branding, gstin: e.target.value })} placeholder="e.g. 27ABCDE1234F1Z5" />
            </div>
            <div className="space-y-2">
              <Label>Country</Label>
              <Select value={branding.country_code} onValueChange={handleCountryChange}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {countries.map((c) => <SelectItem key={c.code} value={c.code}>{c.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>Currency</Label>
              <Input value={branding.currency_code} onChange={(e) => setBranding({ ...branding, currency_code: e.target.value })} />
            </div>
            <div className="space-y-2">
              <Label> </Label>
              <p className="text-xs text-muted-foreground pt-3">Tip: India ke liye INR best.</p>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Business Logo</Label>
              {branding.logo_url ? (
                <div className="space-y-2">
                  <div className="relative w-28 h-28 rounded-lg border border-border overflow-hidden bg-white">
                    <img src={branding.logo_url} alt="Logo" className="w-full h-full object-contain" />
                    <label className="absolute inset-0 flex items-center justify-center bg-black/30 opacity-0 hover:opacity-100 transition-opacity cursor-pointer">
                      <Upload className="h-4 w-4 text-white" />
                      <input type="file" accept="image/*" className="hidden" onChange={handleLogoUpload} disabled={uploadingLogo || removingLogo} />
                    </label>
                  </div>
                  <Button type="button" variant="outline" size="sm" className="gap-2" onClick={() => removeBrandingAsset("logo_url")} disabled={removingLogo || uploadingLogo}>
                    <Trash2 className="h-4 w-4" />{removingLogo ? "Removing..." : "Remove Logo"}
                  </Button>
                </div>
              ) : (
                <label className="flex h-28 w-28 cursor-pointer items-center justify-center rounded-lg border-2 border-dashed border-border hover:border-primary transition-colors">
                  <Upload className="h-5 w-5 text-muted-foreground" />
                  <input type="file" accept="image/*" className="hidden" onChange={handleLogoUpload} disabled={uploadingLogo} />
                </label>
              )}
              <div className="text-xs text-muted-foreground space-y-0.5 mt-1">
                <p>✅ Recommended size: <strong>400×100px</strong> to <strong>800×200px</strong></p>
                <p>📐 Must be landscape (wider than tall)</p>
                <p>📁 Max file size: <strong>500KB</strong> · PNG/JPG</p>
              </div>
            </div>
            <div className="space-y-2">
              <Label>Signature</Label>
              {branding.signature_url ? (
                <div className="space-y-2">
                  <div className="relative w-28 h-28 rounded-lg border border-border overflow-hidden bg-white">
                    <img src={branding.signature_url} alt="Signature" className="w-full h-full object-contain" />
                    <label className="absolute inset-0 flex items-center justify-center bg-black/30 opacity-0 hover:opacity-100 transition-opacity cursor-pointer">
                      <Upload className="h-4 w-4 text-white" />
                      <input type="file" accept="image/*" className="hidden" onChange={handleSignatureUpload} disabled={uploadingSig || removingSig} />
                    </label>
                  </div>
                  <Button type="button" variant="outline" size="sm" className="gap-2" onClick={() => removeBrandingAsset("signature_url")} disabled={removingSig || uploadingSig}>
                    <Trash2 className="h-4 w-4" />{removingSig ? "Removing..." : "Remove Signature"}
                  </Button>
                </div>
              ) : (
                <label className="flex h-28 w-28 cursor-pointer items-center justify-center rounded-lg border-2 border-dashed border-border hover:border-primary transition-colors">
                  <Upload className="h-5 w-5 text-muted-foreground" />
                  <input type="file" accept="image/*" className="hidden" onChange={handleSignatureUpload} disabled={uploadingSig} />
                </label>
              )}
              <div className="text-xs text-muted-foreground space-y-0.5 mt-1">
                <p>✅ Recommended size: <strong>400×100px</strong> to <strong>800×200px</strong></p>
                <p>📐 Must be landscape (wider than tall)</p>
                <p>📁 Max file size: <strong>500KB</strong> · PNG/JPG</p>
              </div>
            </div>
          </div>
          <Button onClick={saveBranding}>Save Branding</Button>
        </CardContent>
      </Card>

      {/* Reminders */}
      <Card className="glass-card">
        <CardHeader><CardTitle className="text-lg">📧 Email Reminders</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <Label>Daily Reminder</Label>
            <Switch checked={reminder.enabled} onCheckedChange={(v) => setReminder({ ...reminder, enabled: v })} />
          </div>

          <div className="space-y-2">
            <Label>Reminder Email</Label>
            <Input
              type="email"
              value={reminder.email}
              onChange={(e) => setReminder({ ...reminder, email: e.target.value })}
              placeholder="aapka@email.com"
            />
            <p className="text-xs text-muted-foreground">Is email pe daily reminder aayega</p>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>Time</Label>
              <span className="text-xs text-muted-foreground font-medium">{reminderTimeLabel}</span>
            </div>
            <Input
              type="time"
              value={reminder.time}
              onChange={(e) => setReminder({ ...reminder, time: e.target.value })}
            />
          </div>

          <div className="space-y-2">
            <Label>Message</Label>
            <Input value={reminder.message} onChange={(e) => setReminder({ ...reminder, message: e.target.value })} placeholder="e.g. Aaj ki entries update karo" />
          </div>

          <Button onClick={saveReminder}>💾 Save Reminder</Button>
        </CardContent>
      </Card>

      {/* PIN Lock Card */}
      <Card className="glass-card">
        <CardHeader><CardTitle className="text-lg flex items-center gap-2"><Lock className="h-5 w-5" /> App PIN Lock</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Har baar app kholne pe Google login ki jagah sirf 4-digit PIN maanga jayega.
          </p>

          {hasPinSet ? (
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-green-600 text-sm font-medium">
                <Lock className="h-4 w-4" /> PIN active hai
              </div>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={() => { setPinStep("set"); setPinInput(""); setPinConfirm(""); }}>
                  PIN Change Karo
                </Button>
                <Button variant="destructive" size="sm" onClick={removePin} disabled={pinLoading}>
                  {pinLoading ? "Hata raha hai..." : "PIN Hatao"}
                </Button>
              </div>
            </div>
          ) : (
            <Button size="sm" className="gap-2" onClick={() => { setPinStep("set"); setPinInput(""); }}>
              <Lock className="h-4 w-4" /> PIN Set Karo
            </Button>
          )}

          {(pinStep === "set" || pinStep === "confirm") && (
            <div className="space-y-3 p-4 rounded-xl border border-border bg-muted/30">
              <p className="text-sm font-medium">
                {pinStep === "set" ? "Naya 4-digit PIN daalo:" : "PIN confirm karo (dobara daalo):"}
              </p>
              <div className="relative w-40">
                <Input
                  type={showPin ? "text" : "password"}
                  maxLength={4}
                  value={pinStep === "set" ? pinInput : pinConfirm}
                  onChange={(e) => {
                    const val = e.target.value.replace(/\D/g, "").slice(0, 4);
                    if (pinStep === "set") setPinInput(val);
                    else setPinConfirm(val);
                  }}
                  placeholder="••••"
                  className="text-center text-2xl tracking-widest pr-8"
                />
                <button
                  type="button"
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground"
                  onClick={() => setShowPin(s => !s)}
                >
                  {showPin ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
              <div className="flex gap-2">
                <Button size="sm" onClick={savePin} disabled={pinLoading}>
                  {pinStep === "set" ? "Aage Bado →" : (pinLoading ? "Save ho raha hai..." : "PIN Save Karo ✅")}
                </Button>
                <Button size="sm" variant="outline" onClick={() => { setPinStep("idle"); setPinInput(""); setPinConfirm(""); }}>
                  Cancel
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
