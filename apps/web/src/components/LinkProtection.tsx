import { useState } from "react";
import { CalendarClock, KeyRound } from "lucide-react";
import { currentLocale, PUBLIC_LINK_PASSWORD_MIN, t, type PublicLinkProtectionInput } from "@nootion/shared";
import { Button, ErrorText, Select } from "./ui";

const DAY = 86_400_000;

interface Protection {
  hasPassword: boolean;
  expiresAt: string | null;
  expired: boolean;
}

const formatEnd = (iso: string) => new Date(iso).toLocaleString(currentLocale(), { dateStyle: "long", timeStyle: "short" });

/** The end of a day picked in a date field, in the visitor's own time zone. */
const endOfDay = (date: string) => new Date(`${date}T23:59:59`).toISOString();

const inputClass =
  "min-w-0 flex-1 rounded-md border border-neutral-300 bg-white px-2 py-1.5 text-sm outline-none focus:border-neutral-500 dark:border-neutral-700 dark:bg-neutral-800";

/**
 * Password and end date of a public link or a public form, under its address. Each change is saved at once; the
 * password is never shown again, only whether there is one.
 */
export function LinkProtection({ value, onChange }: { value: Protection; onChange: (input: PublicLinkProtectionInput) => Promise<unknown> }) {
  const [editingPassword, setEditingPassword] = useState(false);
  const [password, setPassword] = useState("");
  const [pickDate, setPickDate] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  const save = async (input: PublicLinkProtectionInput) => {
    setBusy(true);
    setError(null);
    try {
      await onChange(input);
      return true;
    } catch (err) {
      setError(err);
      return false;
    } finally {
      setBusy(false);
    }
  };

  const askPassword = value.hasPassword || editingPassword;
  const choice = pickDate ? "date" : value.expiresAt ? "keep" : "never";

  return (
    <div className="space-y-2 text-sm text-neutral-600 dark:text-neutral-400" data-link-protection>
      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={askPassword}
          disabled={busy}
          onChange={(e) => {
            if (e.target.checked) setEditingPassword(true);
            else {
              setEditingPassword(false);
              setPassword("");
              if (value.hasPassword) void save({ password: null });
            }
          }}
        />
        <KeyRound size={14} /> {t("share.askPassword")}
      </label>
      {askPassword && (
        <div className="ml-6 space-y-1">
          {value.hasPassword && !editingPassword ? (
            <div className="flex items-center gap-2">
              <span>{t("share.passwordSet")}</span>
              <Button type="button" variant="ghost" className="px-2 py-1" onClick={() => setEditingPassword(true)}>
                {t("share.changePassword")}
              </Button>
            </div>
          ) : (
            <form
              className="flex items-center gap-2"
              onSubmit={async (e) => {
                e.preventDefault();
                if (await save({ password })) {
                  setPassword("");
                  setEditingPassword(false);
                }
              }}
            >
              <input
                type="password"
                autoComplete="new-password"
                className={inputClass}
                placeholder={t("share.newPassword")}
                aria-label={t("share.newPassword")}
                value={password}
                minLength={PUBLIC_LINK_PASSWORD_MIN}
                onChange={(e) => setPassword(e.target.value)}
                autoFocus
              />
              <Button type="submit" className="px-3 py-1.5" disabled={busy || password.length < PUBLIC_LINK_PASSWORD_MIN}>
                {t("share.savePassword")}
              </Button>
            </form>
          )}
          <p className="text-xs text-neutral-500">{t("share.passwordHelp", { min: PUBLIC_LINK_PASSWORD_MIN })}</p>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <CalendarClock size={14} className="ml-0.5" />
        <span>{t("share.expiry")}</span>
        <Select
          value={choice}
          disabled={busy}
          aria-label={t("share.expiry")}
          onChange={(e) => {
            const v = e.target.value;
            setPickDate(v === "date");
            if (v === "never") void save({ expiresAt: null });
            else if (v !== "date" && v !== "keep") void save({ expiresAt: new Date(Date.now() + Number(v) * DAY).toISOString() });
          }}
        >
          <option value="never">{t("share.expiryNever")}</option>
          {value.expiresAt && <option value="keep">{formatEnd(value.expiresAt)}</option>}
          <option value="1">{t("share.after1Day")}</option>
          <option value="7">{t("share.after7Days")}</option>
          <option value="30">{t("share.after30Days")}</option>
          <option value="date">{t("share.expiryOnDate")}</option>
        </Select>
        {pickDate && (
          <input
            type="date"
            className={`${inputClass} max-w-[11rem] flex-none`}
            aria-label={t("share.expiryDate")}
            min={new Date().toISOString().slice(0, 10)}
            onChange={async (e) => {
              if (e.target.value && (await save({ expiresAt: endOfDay(e.target.value) }))) setPickDate(false);
            }}
          />
        )}
      </div>
      {value.expiresAt && !pickDate && (
        <div
          className={`ml-6 flex flex-wrap items-center gap-2 text-xs ${value.expired ? "text-amber-700 dark:text-amber-400" : "text-neutral-500"}`}
          data-link-expiry
        >
          {value.expired ? t("share.expiredOn", { date: formatEnd(value.expiresAt) }) : t("share.expiresOn", { date: formatEnd(value.expiresAt) })}
          {value.expired && (
            <Button
              type="button"
              variant="ghost"
              className="px-2 py-1 text-xs"
              disabled={busy}
              onClick={() => void save({ expiresAt: new Date(Date.now() + 7 * DAY).toISOString() })}
            >
              {t("share.extend")}
            </Button>
          )}
        </div>
      )}
      <ErrorText error={error} />
    </div>
  );
}
