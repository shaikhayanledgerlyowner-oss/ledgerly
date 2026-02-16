import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { Navigate } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { CreditCard, Save, Loader2 } from "lucide-react";

type SettingsRow = {
  id: string;
  owner_id: string;
  receiver_name: string | null;
  upi_id: string | null;
  is_enabled: boolean | null;
  updated_at?: string | null;
};

export default function PaymentSettingsPage() {
  const { isOwner, profile } = useAuth();

  // ✅ only UPI for now
  const [settings, setSettings] = useState({
    receiver_name: "",
    upi_id: "",
    is_enabled: false,
  });

  const [settingsId, setSettingsId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // ✅ track if user changed something (so we can autosave safely)
  const [dirty, setDirty] = useState(false);

  const canSave = useMemo(() => {
    // if enabled, require both fields
    if (!settings.is_enabled) return true;
    return settings.receiver_name.trim().length > 0 && settings.upi_id.trim().length > 0;
  }, [settings]);

  const normalizeUpi = (v: string) => v.trim();

  const load = async () => {
    if (!profile || !isOwner) return;

    setLoading(true);
    const { data, error } = await supabase
      .from("owner_payment_settings")
      .select("id, owner_id, receiver_name, upi_id, is_enabled, updated_at")
      .eq("owner_id", profile.id)
      .maybeSingle();

    if (error) {
      toast.error(error.message);
      setLoading(false);
      return;
    }

    if (data) {
      const row = data as unknown as SettingsRow;
      setSettings({
        receiver_name: row.receiver_name ?? "",
        upi_id: row.upi_id ?? "",
        is_enabled: row.is_enabled ?? false,
      });
      setSettingsId(row.id);
    } else {
      // no row yet -> keep defaults but remember none exists
      setSettingsId(null);
      setSettings({ receiver_name: "", upi_id: "", is_enabled: false });
    }

    setDirty(false);
    setLoading(false);
  };

  useEffect(() => {
    if (!profile || !isOwner) return;
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.id, isOwner]);

  if (!isOwner) return <Navigate to="/dashboard" replace />;

  const upsertAndKeep = async (payload: {
    receiver_name: string;
    upi_id: string;
    is_enabled: boolean;
  }) => {
    if (!profile) return;

    // ✅ IMPORTANT: use UPSERT with owner_id unique, so it never "disappears"
    // This needs a UNIQUE constraint on owner_payment_settings.owner_id
    // (SQL at bottom)
    const { data, error } = await supabase
      .from("owner_payment_settings")
      .upsert(
        {
          owner_id: profile.id,
          receiver_name: payload.receiver_name,
          upi_id: payload.upi_id,
          is_enabled: payload.is_enabled,
          updated_at: new Date().toISOString(),
        } as any,
        { onConflict: "owner_id" }
      )
      .select("id")
      .single();

    if (error) {
      throw error;
    }

    if (data?.id) setSettingsId(data.id);
  };

  const validateIfEnabled = () => {
    if (!settings.is_enabled) return true;

    if (!settings.receiver_name.trim()) {
      toast.error("Receiver name required when payments are enabled");
      return false;
    }

    if (!normalizeUpi(settings.upi_id)) {
      toast.error("UPI ID required when payments are enabled");
      return false;
    }

    // basic UPI format check (light)
    if (!/^[\w.\-]{2,}@[A-Za-z]{2,}$/.test(normalizeUpi(settings.upi_id))) {
      toast.error("UPI ID format looks wrong (example: name@upi)");
      return false;
    }

    return true;
  };

  const save = async (opts?: { silent?: boolean }) => {
    if (!profile) return;

    // ✅ do not save invalid enabled config
    if (!validateIfEnabled()) return;

    setSaving(true);
    try {
      const payload = {
        receiver_name: settings.receiver_name.trim(),
        upi_id: normalizeUpi(settings.upi_id),
        is_enabled: settings.is_enabled,
      };

      await upsertAndKeep(payload);
      setDirty(false);

      if (!opts?.silent) toast.success("Payment settings saved!");
    } catch (e: any) {
      toast.error(e?.message || "Failed to save payment settings");
    } finally {
      setSaving(false);
    }
  };

  // ✅ AUTO-SAVE:
  // - when toggling enable/disable
  // - when leaving page (best-effort)
  useEffect(() => {
    // only autosave after initial load
    if (loading) return;
    if (!dirty) return;

    // small debounce
    const t = setTimeout(() => {
      // silent autosave
      save({ silent: true });
    }, 700);

    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.receiver_name, settings.upi_id]);

  useEffect(() => {
    if (loading) return;
    if (!dirty) return;

    const onBeforeUnload = () => {
      // best-effort, not guaranteed in all browsers
      save({ silent: true });
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dirty, loading]);

  const setField = (patch: Partial<typeof settings>) => {
    setSettings(prev => ({ ...prev, ...patch }));
    setDirty(true);
  };

  const onToggleEnabled = async (v: boolean) => {
    // update UI instantly
    setSettings(prev => ({ ...prev, is_enabled: v }));
    setDirty(true);

    // if turning ON, require fields first (don’t allow ON -> then reset)
    if (v) {
      const ok =
        settings.receiver_name.trim().length > 0 &&
        normalizeUpi(settings.upi_id).length > 0;
      if (!ok) {
        toast.error("Fill Receiver Name + UPI ID first, then enable payments");
        setSettings(prev => ({ ...prev, is_enabled: false }));
        return;
      }
    }

    // autosave immediately for toggle
    await save({ silent: true });
  };

  return (
    <div className="animate-fade-in space-y-6 max-w-2xl">
      <h1 className="text-2xl font-display font-bold flex items-center gap-2">
        <CreditCard className="h-6 w-6" /> Payment Settings
      </h1>

      <Card className="glass-card">
        <CardHeader>
          <CardTitle className="text-lg">UPI Receiver Configuration</CardTitle>
        </CardHeader>

        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Payments will stay saved even if you open other pages. (UPI only for now)
          </p>

          {loading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground py-6">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading settings...
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between rounded-lg border border-border p-4">
                <div>
                  <p className="text-sm font-medium">Payments Enabled</p>
                  <p className="text-xs text-muted-foreground">
                    Customers can submit payment requests when enabled
                  </p>
                </div>
                <Switch checked={settings.is_enabled} onCheckedChange={onToggleEnabled} />
              </div>

              <div className="space-y-2">
                <Label>Receiver Name</Label>
                <Input
                  value={settings.receiver_name}
                  onChange={e => setField({ receiver_name: e.target.value })}
                  placeholder="e.g. Authorized Payment Partner"
                />
              </div>

              <div className="space-y-2">
                <Label>UPI ID</Label>
                <Input
                  value={settings.upi_id}
                  onChange={e => setField({ upi_id: e.target.value })}
                  placeholder="yourname@upi"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                />
              </div>

              {/* status helper */}
              {settings.is_enabled && !canSave && (
                <div className="rounded-lg border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm">
                  Fill <b>Receiver Name</b> and <b>UPI ID</b> to keep payments enabled.
                </div>
              )}

              <div className="flex items-center gap-2">
                <Button onClick={() => save()} disabled={saving || !canSave} className="gap-2">
                  {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                  Save Settings
                </Button>

                {dirty && !saving && (
                  <span className="text-xs text-muted-foreground">Unsaved changes</span>
                )}

                {!dirty && !!settingsId && (
                  <span className="text-xs text-muted-foreground">Saved</span>
                )}
              </div>

              {/* Optional: show record id for debugging */}
              {/* <div className="text-xs text-muted-foreground">ID: {settingsId ?? "none"}</div> */}
            </>
          )}
        </CardContent>
      </Card>

      {/* ✅ IMPORTANT SQL NOTE (run once in Supabase SQL editor) */}
      <Card className="glass-card">
        <CardHeader>
          <CardTitle className="text-base">One-time Supabase Fix</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <p>
            If your settings still “disappear”, your table is missing a <b>unique constraint</b> on owner_id.
            Add it once in Supabase SQL Editor:
          </p>
          <pre className="text-xs overflow-x-auto rounded-lg border border-border bg-muted/30 p-3">
{`-- 1) make sure owner_id is unique (required for upsert onConflict:"owner_id")
alter table public.owner_payment_settings
add constraint owner_payment_settings_owner_id_key unique (owner_id);`}
          </pre>
          <p className="text-xs">
            Run this only once. If it says "already exists", that’s fine.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}