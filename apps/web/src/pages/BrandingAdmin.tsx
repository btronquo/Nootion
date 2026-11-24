import { useEffect, useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, ImageUp } from "lucide-react";
import { APP_NAME_MAX, DEFAULT_APP_NAME, LOGO_MAX_BYTES, t, type Branding, type InstanceSettings } from "@nootion/shared";
import { api, ApiError } from "../lib/api";
import { BrandLogo, useBranding, useSetBranding } from "../lib/branding";
import { pickFiles } from "../editor/upload";
import { Button, ErrorText } from "../components/ui";

const settingsKey = ["admin", "settings"];
const input =
  "w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm outline-none focus:border-blue-500 dark:border-neutral-700 dark:bg-neutral-900";

/** The instance's own name and logo, in place of Nootion's. */
export function BrandingAdmin() {
  const qc = useQueryClient();
  const branding = useBranding();
  const setBranding = useSetBranding();
  const settings = useQuery({ queryKey: settingsKey, queryFn: async () => (await api<{ settings: InstanceSettings }>("/admin/settings")).settings });
  const [name, setName] = useState("");
  const [error, setError] = useState<unknown>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const savedName = settings.data?.appName;
  useEffect(() => {
    if (savedName !== undefined) setName(savedName);
  }, [savedName]);

  async function saveName(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSaved(false);
    try {
      const res = await api<{ settings: InstanceSettings }>("/admin/settings", { method: "PUT", body: { appName: name } });
      qc.setQueryData(settingsKey, res.settings);
      setBranding({ ...branding, name: res.settings.appName || DEFAULT_APP_NAME, customName: !!res.settings.appName });
      setSaved(true);
    } catch (err) {
      setError(err);
    }
  }

  async function upload() {
    const [file] = await pickFiles("image/png,image/jpeg,image/webp,image/gif,image/svg+xml,.svg");
    if (!file) return;
    setError(null);
    setSaved(false);
    if (file.size > LOGO_MAX_BYTES) return setError(new Error(t("error.logoTooLarge")));
    setBusy(true);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("/api/admin/branding/logo", { method: "POST", body: form, credentials: "same-origin" });
      const data = await res.json();
      if (!res.ok) throw new ApiError(res.status, data.error, data.message);
      setBranding(data.branding as Branding);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  async function removeLogo() {
    setError(null);
    try {
      setBranding((await api<{ branding: Branding }>("/admin/branding/logo", { method: "DELETE" })).branding);
    } catch (err) {
      setError(err);
    }
  }

  return (
    <section data-branding-admin>
      <h2 className="mb-1 text-lg font-semibold">{t("branding.title")}</h2>
      <p className="mb-4 text-sm text-neutral-500">{t("branding.intro")}</p>
      <div className="grid gap-6 md:grid-cols-[minmax(0,1fr)_16rem]">
        <div className="space-y-5">
          <form onSubmit={saveName}>
            <label className="block text-sm">
              <span className="mb-1 block font-medium">{t("branding.name")}</span>
              <div className="flex gap-2">
                <input
                  className={input}
                  value={name}
                  maxLength={APP_NAME_MAX}
                  placeholder={DEFAULT_APP_NAME}
                  onChange={(e) => {
                    setName(e.target.value);
                    setSaved(false);
                  }}
                  data-branding-name
                />
                <Button type="submit" disabled={settings.isLoading || name.trim() === (savedName ?? "")}>
                  {t("branding.save")}
                </Button>
              </div>
              <span className="mt-1 block text-neutral-500">{t("branding.nameHelp")}</span>
            </label>
          </form>
          <div className="text-sm">
            <span className="mb-1 block font-medium">{t("branding.logo")}</span>
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex h-14 w-14 items-center justify-center rounded-lg border border-neutral-200 bg-white p-1.5 dark:border-neutral-700 dark:bg-neutral-800">
                <BrandLogo className="h-full w-full" />
              </div>
              <Button variant="ghost" onClick={upload} disabled={busy} data-branding-upload>
                <ImageUp size={16} /> {busy ? t("common.uploading") : t("branding.upload")}
              </Button>
              {branding.logoUrl && (
                <Button variant="danger" onClick={removeLogo}>
                  {t("branding.removeLogo")}
                </Button>
              )}
            </div>
            <span className="mt-1 block text-neutral-500">{t("branding.logoHelp")}</span>
          </div>
          {saved && (
            <p className="flex items-center gap-1 text-sm text-green-600">
              <Check size={14} /> {t("branding.saved")}
            </p>
          )}
          <ErrorText error={error} />
        </div>
        {/* What people see: the top of the sidebar and the sign-in card. */}
        <div aria-label={t("branding.preview")}>
          <span className="mb-1 block text-sm font-medium">{t("branding.preview")}</span>
          <div className="overflow-hidden rounded-lg border border-neutral-200 dark:border-neutral-800" data-branding-preview>
            <div className="flex items-center gap-2 bg-neutral-50 px-3 py-2.5 dark:bg-neutral-950">
              <BrandLogo className="h-6 w-6 shrink-0 rounded" />
              <span className="truncate text-[15px] font-bold tracking-tight">{name.trim() || DEFAULT_APP_NAME}</span>
            </div>
            <div className="flex flex-col items-center gap-2 border-t border-neutral-200 px-3 py-5 dark:border-neutral-800">
              <BrandLogo className="h-10 w-10" />
              <span className="text-sm font-semibold">{name.trim() || DEFAULT_APP_NAME}</span>
              <span className="h-2 w-32 rounded bg-neutral-200 dark:bg-neutral-800" />
              <span className="h-2 w-24 rounded bg-neutral-200 dark:bg-neutral-800" />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
