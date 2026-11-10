import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check } from "lucide-react";
import { t, type InstanceSettings } from "@nootion/shared";
import { api } from "../lib/api";
import { ErrorText } from "../components/ui";

const key = ["admin", "settings"];

/** Server-wide security choices: what is off by default and administrators may turn on. */
export function SecurityAdmin() {
  const qc = useQueryClient();
  const settings = useQuery({ queryKey: key, queryFn: async () => (await api<{ settings: InstanceSettings }>("/admin/settings")).settings });
  const [error, setError] = useState<unknown>(null);
  const [saved, setSaved] = useState(false);
  const s = settings.data;
  if (!s) return null;

  async function save(patch: Partial<InstanceSettings>) {
    setError(null);
    setSaved(false);
    try {
      const res = await api<{ settings: InstanceSettings }>("/admin/settings", { method: "PUT", body: { ...s, ...patch } });
      qc.setQueryData(key, res.settings);
      await qc.invalidateQueries({ queryKey: ["webhook-policy"] });
      setSaved(true);
    } catch (e) {
      setError(e);
    }
  }

  return (
    <section data-security-admin>
      <h2 className="mb-3 text-lg font-semibold">{t("admin.security")}</h2>
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" className="mt-0.5" checked={s.webhookPrivateNetworks} onChange={(e) => void save({ webhookPrivateNetworks: e.target.checked })} />
        <span>
          <span className="block font-medium">{t("admin.webhookPrivate")}</span>
          <span className="block text-neutral-500">{t("admin.webhookPrivateHelp")}</span>
        </span>
      </label>
      {saved && (
        <p className="mt-2 flex items-center gap-1 text-sm text-green-600">
          <Check size={14} /> {t("admin.securitySaved")}
        </p>
      )}
      <ErrorText error={error} />
    </section>
  );
}
