import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Download, KeyRound, LogIn, Search, Settings, Share2, Trash2, UserCog, type LucideIcon } from "lucide-react";
import {
  AUDIT_CATEGORIES,
  AUDIT_RETENTION_CHOICES,
  auditActionLabel,
  auditCategoryOf,
  dateTimeFormat,
  t,
  type AuditCategory,
  type AuditEvent,
  type InstanceSettings,
  type MessageKey,
  type PageRole,
  type WorkspaceRole,
} from "@nootion/shared";
import { api } from "../lib/api";
import { pageRoleLabel, workspaceRoleLabel } from "../lib/labels";
import { Button, ErrorText, Select } from "../components/ui";

const settingsKey = ["admin", "settings"];

const ICONS: Record<AuditCategory, LucideIcon> = {
  auth: LogIn,
  account: KeyRound,
  users: UserCog,
  sharing: Share2,
  content: Trash2,
  export: Download,
  settings: Settings,
};

interface Filters {
  category: AuditCategory | "";
  actorId: string;
  q: string;
  from: string;
  to: string;
}
const NO_FILTERS: Filters = { category: "", actorId: "", q: "", from: "", to: "" };

/** The filters as query parameters (the browser's time zone too, so that days are the reader's). */
function queryOf(f: Filters, extra: Record<string, string> = {}) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(f)) if (v) p.set(k, v);
  p.set("tz", String(new Date().getTimezoneOffset()));
  for (const [k, v] of Object.entries(extra)) p.set(k, v);
  return p.toString();
}

/** A role of any kind (page, space, account), in words. */
function roleLabel(role: unknown): string {
  const r = String(role);
  if (["full", "editor", "commenter", "viewer"].includes(r)) return pageRoleLabel(r as PageRole);
  if (r === "owner") return workspaceRoleLabel(r as WorkspaceRole);
  if (r === "admin") return t("admin.admin");
  if (r === "member") return t("admin.member");
  if (r === "guest") return t("guest.badge");
  return r;
}

/** A coded value ("password", "sso"…) in words, when there is a translation for it. */
function said(prefix: "method" | "via" | "reason", value: unknown): string {
  const key = `audit.${prefix}.${String(value)}` as MessageKey;
  const text = t(key);
  return text === key || !text ? String(value) : text;
}

const day = (iso: string) => dateTimeFormat({ dateStyle: "medium" }).format(new Date(iso));

/** The small facts of a line, in words: roles, the person shared with, the settings changed… */
export function auditDetails(e: AuditEvent): string[] {
  const d = e.details ?? {};
  const out: string[] = [];
  if (d.method) out.push(said("method", d.method));
  if (d.via) out.push(said("via", d.via));
  if (d.reason) out.push(said("reason", d.reason));
  if (e.action === "auth.login_failed" && d.email) out.push(t("audit.detail.email", { value: String(d.email) }));
  if (d.with) out.push(t("audit.detail.with", { value: String(d.with) }));
  if (d.member) out.push(t("audit.detail.member", { value: String(d.member) }));
  if (d.group) out.push(t("audit.detail.group", { value: String(d.group) }));
  if (e.action.startsWith("account.passkey_") && d.name) out.push(t("audit.detail.name", { value: String(d.name) }));
  if (e.action === "group.renamed" && d.from) out.push(t("audit.detail.renamedFrom", { value: String(d.from) }));
  if (e.action === "account.email_changed") out.push(t("audit.detail.emailChange", { from: String(d.from), to: String(d.to) }));
  else if (e.action === "group.renamed") {
    // Its old name is said above.
  } else if (d.from && d.to) out.push(t("audit.detail.roleChange", { from: roleLabel(d.from), to: roleLabel(d.to) }));
  else if (d.role && e.action !== "account.created") out.push(t("audit.detail.role", { value: roleLabel(d.role) }));
  else if (d.from && d.role) out.push(t("audit.detail.roleChange", { from: roleLabel(d.from), to: roleLabel(d.role) }));
  if (e.action === "page.guest_invited" && d.email) out.push(t("audit.detail.email", { value: String(d.email) }));
  if (Array.isArray(d.keys) && d.keys.length) out.push(t("audit.detail.keys", { value: d.keys.join(", ") }));
  if (d.removed) out.push(t("audit.detail.removed"));
  if (typeof d.pages === "number" && d.pages > 1) out.push(t("audit.detail.pages", { count: d.pages }));
  if (d.password) out.push(t("audit.detail.password"));
  if (typeof d.expiresAt === "string") out.push(t("audit.detail.expiresAt", { value: day(d.expiresAt) }));
  if (d.readOnly) out.push(t("audit.detail.readOnly"));
  if (d.left) out.push(t("audit.detail.left"));
  if (d.token) out.push(t("audit.detail.token", { value: String(d.token) }));
  return out;
}

/** What the line is about: a page (a link while it exists), a person, a space, a part of the settings. */
function Target({ e }: { e: AuditEvent }) {
  const target = e.target;
  if (!target) return null;
  if (target.type === "settings") {
    const [section, id] = (target.label ?? "").split(":");
    const key = `audit.section.${section}` as MessageKey;
    const text = t(key, { id: id ?? "" });
    return <span>{text === key ? target.label : text}</span>;
  }
  const label = target.label || (target.type === "page" || target.type === "form" ? t("common.untitled") : "—");
  const linkable = (target.type === "page" || target.type === "form") && target.id && e.action !== "page.deleted";
  return linkable ? (
    <Link
      to={`/page/${target.id}`}
      className="underline decoration-neutral-300 underline-offset-2 hover:text-neutral-900 dark:decoration-neutral-600 dark:hover:text-neutral-100"
    >
      {label}
    </Link>
  ) : (
    <span>{label}</span>
  );
}

function Actor({ e }: { e: AuditEvent }) {
  if (e.actor)
    return (
      <span className="font-medium text-neutral-800 dark:text-neutral-200" title={e.actor.email ?? undefined}>
        {e.actor.name || e.actor.email}
      </span>
    );
  return <span className="italic">{e.details?.via === "scim" ? t("audit.directory") : t("audit.noActor")}</span>;
}

function Line({ e }: { e: AuditEvent }) {
  const category = auditCategoryOf(e.action);
  const Icon = category ? ICONS[category] : Settings;
  const failed = e.action === "auth.login_failed";
  const details = auditDetails(e);
  const when = new Date(e.createdAt);
  return (
    <li className="flex gap-3 px-3 py-2.5" data-audit-event={e.action}>
      <Icon size={16} className={`mt-0.5 shrink-0 ${failed ? "text-red-500" : "text-neutral-400"}`} aria-hidden />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3">
          <span className={`font-medium ${failed ? "text-red-600 dark:text-red-400" : ""}`}>{auditActionLabel(e.action)}</span>
          <time dateTime={e.createdAt} className="text-xs text-neutral-500 tabular-nums" title={when.toISOString()}>
            {dateTimeFormat({ dateStyle: "short", timeStyle: "medium" }).format(when)}
          </time>
        </div>
        <div className="text-neutral-600 dark:text-neutral-400">
          <Actor e={e} />
          {e.target && (
            <>
              {" · "}
              <Target e={e} />
            </>
          )}
        </div>
        {(details.length > 0 || e.ip) && (
          <div className="mt-0.5 text-xs break-words text-neutral-500">{[...details, ...(e.ip ? [t("audit.address", { ip: e.ip })] : [])].join(" · ")}</div>
        )}
      </div>
    </li>
  );
}

function FilterLabel({ label, children, className = "" }: { label: string; children: ReactNode; className?: string }) {
  return (
    <label className={`flex flex-col gap-1 text-xs text-neutral-500 ${className}`}>
      <span>{label}</span>
      {children}
    </label>
  );
}

/**
 * The activity log, for administrators: who signed in, shared, published, exported, deleted, changed a role or a
 * setting. Filters, a CSV of what they show, and how long lines are kept.
 */
export function AuditLogAdmin() {
  const qc = useQueryClient();
  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
  const [words, setWords] = useState("");
  const [error, setError] = useState<unknown>(null);
  // Typing in the search box waits for a pause before asking the server.
  useEffect(() => {
    const id = setTimeout(() => setFilters((f) => (f.q === words.trim() ? f : { ...f, q: words.trim() })), 300);
    return () => clearTimeout(id);
  }, [words]);

  const settings = useQuery({ queryKey: settingsKey, queryFn: async () => (await api<{ settings: InstanceSettings }>("/admin/settings")).settings });
  const actors = useQuery({
    queryKey: ["admin", "audit", "actors"],
    queryFn: async () => (await api<{ actors: { id: string; name: string; email: string }[] }>("/admin/audit/actors")).actors,
  });
  const log = useInfiniteQuery({
    queryKey: ["admin", "audit", filters],
    initialPageParam: "",
    queryFn: async ({ pageParam }) =>
      api<{ events: AuditEvent[]; next: string | null }>(`/admin/audit?${queryOf(filters, pageParam ? { before: pageParam } : {})}`),
    getNextPageParam: (last) => last.next ?? undefined,
  });
  const events = useMemo(() => log.data?.pages.flatMap((p) => p.events) ?? [], [log.data]);
  const filtered = Object.values(filters).some(Boolean);

  async function setRetention(days: number) {
    setError(null);
    try {
      const res = await api<{ settings: InstanceSettings }>("/admin/settings", { method: "PUT", body: { auditRetentionDays: days } });
      qc.setQueryData(settingsKey, res.settings);
    } catch (e) {
      setError(e);
    }
  }

  const set = (patch: Partial<Filters>) => setFilters((f) => ({ ...f, ...patch }));

  return (
    <section data-audit-admin>
      <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold">{t("audit.title")}</h2>
        <a
          href={`/api/admin/audit/export?${queryOf(filters, { sep: navigator.language.startsWith("fr") ? "semicolon" : "comma" })}`}
          download
          className="inline-flex items-center gap-1.5 rounded-md border border-neutral-300 px-2.5 py-1.5 text-sm hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800"
          data-audit-export
        >
          <Download size={14} /> {t("audit.export")}
        </a>
      </div>
      <p className="mb-3 text-sm text-neutral-500">{t("audit.help")}</p>

      {settings.data && (
        <div className="mb-4 flex flex-wrap items-center gap-2 text-sm">
          <span className="font-medium">{t("audit.retention")}</span>
          <Select value={settings.data.auditRetentionDays} onChange={(e) => void setRetention(Number(e.target.value))} data-audit-retention>
            {(AUDIT_RETENTION_CHOICES as readonly number[]).includes(settings.data.auditRetentionDays) ? null : (
              <option value={settings.data.auditRetentionDays}>{settings.data.auditRetentionDays}</option>
            )}
            {AUDIT_RETENTION_CHOICES.map((d) => (
              <option key={d} value={d}>
                {t(`audit.retention.${d}` as MessageKey)}
              </option>
            ))}
          </Select>
          <span className="text-neutral-500">{settings.data.auditRetentionDays ? t("audit.retentionHelp") : ""}</span>
        </div>
      )}
      <ErrorText error={error ?? log.error} />

      <div className="mb-3 grid grid-cols-2 gap-2 md:grid-cols-[minmax(0,1.4fr)_minmax(0,1.2fr)_auto_auto]">
        <FilterLabel label={t("search.title")} className="col-span-2 md:col-span-4">
          <span className="relative">
            <Search size={14} className="pointer-events-none absolute top-1/2 left-2 -translate-y-1/2 text-neutral-400" />
            <input
              type="search"
              value={words}
              onChange={(e) => setWords(e.target.value)}
              placeholder={t("audit.search")}
              className="w-full rounded-md border border-neutral-300 bg-transparent py-1.5 pr-2 pl-7 text-sm text-neutral-900 dark:border-neutral-700 dark:text-neutral-100"
              data-audit-search
            />
          </span>
        </FilterLabel>
        <FilterLabel label={t("audit.csv.action")}>
          <Select
            value={filters.category}
            onChange={(e) => set({ category: e.target.value as AuditCategory | "" })}
            className="w-full text-neutral-900 dark:text-neutral-100"
            data-audit-category
          >
            <option value="">{t("audit.allActions")}</option>
            {(Object.keys(AUDIT_CATEGORIES) as AuditCategory[]).map((c) => (
              <option key={c} value={c}>
                {t(`audit.category.${c}` as MessageKey)}
              </option>
            ))}
          </Select>
        </FilterLabel>
        <FilterLabel label={t("audit.csv.person")}>
          <Select
            value={filters.actorId}
            onChange={(e) => set({ actorId: e.target.value })}
            className="w-full text-neutral-900 dark:text-neutral-100"
            data-audit-actor
          >
            <option value="">{t("audit.everyone")}</option>
            {actors.data?.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name || a.email}
              </option>
            ))}
          </Select>
        </FilterLabel>
        <FilterLabel label={t("audit.from")}>
          <input
            type="date"
            value={filters.from}
            max={filters.to || undefined}
            onChange={(e) => set({ from: e.target.value })}
            className="rounded-md border border-neutral-300 bg-transparent px-2 py-1 text-sm text-neutral-900 dark:border-neutral-700 dark:text-neutral-100 dark:[color-scheme:dark]"
            data-audit-from
          />
        </FilterLabel>
        <FilterLabel label={t("audit.to")}>
          <input
            type="date"
            value={filters.to}
            min={filters.from || undefined}
            onChange={(e) => set({ to: e.target.value })}
            className="rounded-md border border-neutral-300 bg-transparent px-2 py-1 text-sm text-neutral-900 dark:border-neutral-700 dark:text-neutral-100 dark:[color-scheme:dark]"
            data-audit-to
          />
        </FilterLabel>
      </div>
      {filtered && (
        <button
          type="button"
          className="mb-2 text-sm text-neutral-500 underline underline-offset-2 hover:text-neutral-800 dark:hover:text-neutral-200"
          onClick={() => {
            setWords("");
            setFilters(NO_FILTERS);
          }}
        >
          {t("audit.reset")}
        </button>
      )}

      {log.isSuccess && !events.length && <p className="py-4 text-sm text-neutral-500">{t("audit.empty")}</p>}
      {events.length > 0 && (
        <ul
          className="divide-y divide-neutral-200 rounded-lg border border-neutral-200 text-sm dark:divide-neutral-800 dark:border-neutral-800"
          data-audit-list
        >
          {events.map((e) => (
            <Line key={e.id} e={e} />
          ))}
        </ul>
      )}
      {log.hasNextPage && (
        <div className="mt-3 text-center">
          <Button variant="ghost" onClick={() => void log.fetchNextPage()} disabled={log.isFetchingNextPage} data-audit-more>
            {t("audit.more")}
          </Button>
        </div>
      )}
    </section>
  );
}
