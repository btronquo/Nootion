import { useState } from "react";
import { t, type UserDirectoryEntry } from "@nootion/shared";
import { api } from "../lib/api";
import { Button, Select } from "./ui";

const BY_EMAIL = "__email__";
const input =
  "min-w-0 flex-1 rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-sm outline-none focus:border-blue-500 dark:border-neutral-700 dark:bg-neutral-900";

/**
 * Picks someone to share with: one of the people the user already works with, or anyone else with an account,
 * found by their exact e-mail address (the directory doesn't list every account of the server).
 */
export function PersonChooser({
  candidates,
  value,
  onChange,
  placeholder,
  excluded,
}: {
  candidates: UserDirectoryEntry[];
  value: string;
  onChange: (userId: string) => void;
  placeholder: string;
  /** People who can't be picked (already there). */
  excluded?: Set<string>;
}) {
  const [found, setFound] = useState<UserDirectoryEntry[]>([]);
  const [typing, setTyping] = useState(false);
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const options = [...candidates, ...found.filter((f) => !candidates.some((c) => c.id === f.id))].filter((u) => !excluded?.has(u.id));

  async function find() {
    if (!email.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      const { user } = await api<{ user: UserDirectoryEntry }>(`/users/lookup?email=${encodeURIComponent(email.trim())}`);
      if (excluded?.has(user.id)) throw new Error(t("error.unknownEmail"));
      setFound((list) => [...list.filter((u) => u.id !== user.id), user]);
      onChange(user.id);
      setTyping(false);
      setEmail("");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  if (typing) {
    return (
      <div className="min-w-0 flex-1">
        <div className="flex gap-2">
          <input
            autoFocus
            type="email"
            className={input}
            value={email}
            placeholder={t("share.byEmailPlaceholder")}
            aria-label={t("share.byEmailPlaceholder")}
            onChange={(e) => setEmail(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void find();
              } else if (e.key === "Escape") {
                e.stopPropagation();
                setTyping(false);
              }
            }}
          />
          <Button type="button" variant="ghost" disabled={!email.trim() || busy} onClick={() => void find()}>
            {t("share.byEmailFind")}
          </Button>
        </div>
        {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
      </div>
    );
  }
  return (
    <Select
      className="min-w-0 flex-1"
      value={value}
      aria-label={t("workspace.person")}
      onChange={(e) => {
        if (e.target.value === BY_EMAIL) {
          onChange("");
          setTyping(true);
        } else onChange(e.target.value);
      }}
    >
      <option value="">{placeholder}</option>
      {options.map((u) => (
        <option key={u.id} value={u.id}>
          {u.name} ({u.email})
        </option>
      ))}
      <option value={BY_EMAIL}>{t("share.byEmail")}</option>
    </Select>
  );
}
