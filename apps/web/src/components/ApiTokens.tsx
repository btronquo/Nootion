import { useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Copy, KeyRound, Trash2 } from "lucide-react";
import { Link } from "react-router-dom";
import { intlLocale, t, type AgentActivity, type ApiToken } from "@nootion/shared";
import { api } from "../lib/api";
import { useWorkspaces } from "../lib/queries";
import { workspaceName } from "../lib/labels";
import { Button, ErrorText, Field, Select } from "./ui";

const DOCS_URL = "https://github.com/btronquo/Nootion/blob/main/docs/API.md";
const MCP_DOCS_URL = "https://github.com/btronquo/Nootion/blob/main/docs/MCP.md";
const EXPIRY_DAYS = [30, 90, 365] as const;
const day = (iso: string) => new Date(iso).toLocaleDateString(intlLocale(), { dateStyle: "medium" });

/** Personal tokens for the API: made with a name, spaces and an access, shown once, revoked here. */
export function ApiTokens() {
  const qc = useQueryClient();
  const workspaces = useWorkspaces();
  const tokens = useQuery({ queryKey: ["api-tokens"], queryFn: async () => (await api<{ tokens: ApiToken[] }>("/tokens")).tokens });
  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState<string | null>(null);
  const names = new Map((workspaces.data ?? []).map((w) => [w.id, workspaceName(w)]));

  async function revoke(token: ApiToken) {
    if (!confirm(t("tokens.confirmRevoke", { name: token.name }))) return;
    await api(`/tokens/${token.id}`, { method: "DELETE" });
    await qc.invalidateQueries({ queryKey: ["api-tokens"] });
  }

  return (
    <div className="space-y-4" data-api-tokens>
      <p className="text-sm text-neutral-600 dark:text-neutral-400">
        {t("tokens.intro")}{" "}
        <a href={DOCS_URL} target="_blank" rel="noopener noreferrer" className="text-blue-600 underline dark:text-blue-400">
          {t("tokens.docs")}
        </a>
      </p>
      {created && <NewToken token={created} onDone={() => setCreated(null)} />}
      {tokens.data && tokens.data.length > 0 && (
        <ul className="divide-y divide-neutral-200 rounded-lg border border-neutral-200 dark:divide-neutral-800 dark:border-neutral-800">
          {tokens.data.map((tk) => {
            // An app's access is renewed by the app itself: its expiry means nothing to the user.
            const expired = !tk.app && tk.expiresAt && new Date(tk.expiresAt) < new Date();
            return (
              <li key={tk.id} className="flex items-start gap-3 px-3 py-2 text-sm" data-token={tk.id}>
                <KeyRound size={16} className="mt-0.5 shrink-0 text-neutral-400" />
                <div className="min-w-0 flex-1">
                  <div className="font-medium">
                    {tk.name}{" "}
                    {tk.app ? (
                      <span className="ml-1 rounded bg-blue-50 px-1.5 py-0.5 text-xs text-blue-700 dark:bg-blue-950 dark:text-blue-300">{t("tokens.app")}</span>
                    ) : (
                      <code className="ml-1 text-xs text-neutral-500">{tk.prefix}…</code>
                    )}
                  </div>
                  <div className="text-xs text-neutral-500">
                    {tk.readOnly ? t("tokens.readOnly") : t("tokens.readWrite")} · {tk.workspaceIds.map((id) => names.get(id) ?? "?").join(", ")}
                  </div>
                  <div className={`text-xs ${expired ? "text-red-600 dark:text-red-400" : "text-neutral-500"}`}>
                    {tk.lastUsedAt ? t("tokens.lastUsed", { date: day(tk.lastUsedAt) }) : t("tokens.neverUsed")}
                    {tk.expiresAt && !tk.app && ` · ${expired ? t("tokens.expired") : t("tokens.expiresOn", { date: day(tk.expiresAt) })}`}
                  </div>
                </div>
                <Button variant="danger" onClick={() => revoke(tk)} title={t("tokens.revoke")} aria-label={t("tokens.revoke")}>
                  <Trash2 size={14} />
                </Button>
              </li>
            );
          })}
        </ul>
      )}
      {tokens.isSuccess && !tokens.data.length && !creating && <p className="text-sm text-neutral-500">{t("tokens.empty")}</p>}
      {creating ? (
        <CreateToken
          onCancel={() => setCreating(false)}
          onCreated={(token) => {
            setCreating(false);
            setCreated(token);
            void qc.invalidateQueries({ queryKey: ["api-tokens"] });
          }}
        />
      ) : (
        <Button variant="ghost" onClick={() => setCreating(true)} className="border border-neutral-200 dark:border-neutral-700">
          <KeyRound size={14} /> {t("tokens.new")}
        </Button>
      )}
    </div>
  );
}

function CreateToken({ onCancel, onCreated }: { onCancel: () => void; onCreated: (token: string) => void }) {
  const workspaces = useWorkspaces();
  const [name, setName] = useState("");
  const [spaces, setSpaces] = useState<string[]>([]);
  const [readOnly, setReadOnly] = useState(true);
  const [expires, setExpires] = useState<string>("90");
  const [error, setError] = useState<unknown>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!spaces.length) return setError(new Error(t("tokens.pickSpace")));
    setError(null);
    try {
      const res = await api<{ token: string }>("/tokens", {
        method: "POST",
        body: { name, workspaceIds: spaces, readOnly, expiresInDays: expires === "never" ? null : Number(expires) },
      });
      onCreated(res.token);
    } catch (err) {
      setError(err);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3 rounded-lg border border-neutral-200 p-3 dark:border-neutral-800" data-token-form>
      <Field
        label={t("tokens.name")}
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder={t("tokens.namePlaceholder")}
        required
        maxLength={100}
      />
      <fieldset>
        <legend className="mb-1 text-sm font-medium">{t("tokens.spaces")}</legend>
        {(workspaces.data ?? []).map((w) => (
          <label key={w.id} className="flex items-center gap-2 py-0.5 text-sm">
            <input
              type="checkbox"
              className="h-4 w-4 accent-blue-600"
              checked={spaces.includes(w.id)}
              onChange={(e) => setSpaces((s) => (e.target.checked ? [...s, w.id] : s.filter((x) => x !== w.id)))}
            />
            {workspaceName(w)}
          </label>
        ))}
      </fieldset>
      <fieldset>
        <legend className="mb-1 text-sm font-medium">{t("tokens.access")}</legend>
        {[true, false].map((ro) => (
          <label key={String(ro)} className="flex items-center gap-2 py-0.5 text-sm">
            <input type="radio" name="access" className="h-4 w-4 accent-blue-600" checked={readOnly === ro} onChange={() => setReadOnly(ro)} />
            {ro ? t("tokens.readOnly") : t("tokens.readWrite")}
          </label>
        ))}
      </fieldset>
      <label className="block text-sm">
        <span className="mb-1 block font-medium">{t("tokens.expires")}</span>
        <Select value={expires} onChange={(e) => setExpires(e.target.value)}>
          {EXPIRY_DAYS.map((d) => (
            <option key={d} value={d}>
              {t("tokens.days", { count: d })}
            </option>
          ))}
          <option value="never">{t("tokens.never")}</option>
        </Select>
      </label>
      <ErrorText error={error} />
      <div className="flex gap-2">
        <Button type="submit">{t("tokens.create")}</Button>
        <Button type="button" variant="ghost" onClick={onCancel}>
          {t("common.cancel")}
        </Button>
      </div>
    </form>
  );
}

/** The token just made, shown this once. */
function NewToken({ token, onDone }: { token: string; onDone: () => void }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(token);
      setCopied(true);
    } catch {
      // Without clipboard access (http), the token stays selectable.
    }
  }
  return (
    <div className="space-y-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm dark:border-amber-700 dark:bg-amber-950/40" data-new-token>
      <p className="font-medium text-amber-900 dark:text-amber-200">{t("tokens.copyNow")}</p>
      <div className="flex items-center gap-2">
        <input
          readOnly
          value={token}
          onFocus={(e) => e.target.select()}
          className="min-w-0 flex-1 rounded border border-neutral-300 bg-white px-2 py-1 font-mono text-xs dark:border-neutral-700 dark:bg-neutral-900"
        />
        <Button type="button" variant="ghost" onClick={copy}>
          {copied ? <Check size={14} /> : <Copy size={14} />} {copied ? t("tokens.copied") : t("tokens.copy")}
        </Button>
      </div>
      <Button type="button" variant="ghost" onClick={onDone}>
        {t("common.close")}
      </Button>
    </div>
  );
}

/** How to connect an AI agent to Nootion's MCP server. */
export function McpConnect() {
  const url = `${window.location.origin}/mcp`;
  const [copied, setCopied] = useState(false);
  const command = `claude mcp add --transport http nootion ${url} --header "Authorization: Bearer nt_…"`;
  return (
    <div className="space-y-3 text-sm" data-mcp>
      <p className="text-neutral-600 dark:text-neutral-400">
        {t("mcp.intro")}{" "}
        <a href={MCP_DOCS_URL} target="_blank" rel="noopener noreferrer" className="text-blue-600 underline dark:text-blue-400">
          {t("mcp.docs")}
        </a>
      </p>
      <div>
        <span className="mb-1 block font-medium">{t("mcp.address")}</span>
        <div className="flex items-center gap-2">
          <input
            readOnly
            value={url}
            onFocus={(e) => e.target.select()}
            className="min-w-0 flex-1 rounded border border-neutral-300 bg-white px-2 py-1 font-mono text-xs dark:border-neutral-700 dark:bg-neutral-900"
            data-mcp-url
          />
          <Button
            type="button"
            variant="ghost"
            onClick={() =>
              navigator.clipboard?.writeText(url).then(
                () => setCopied(true),
                () => undefined,
              )
            }
          >
            {copied ? <Check size={14} /> : <Copy size={14} />} {copied ? t("tokens.copied") : t("tokens.copy")}
          </Button>
        </div>
      </div>
      <p>{t("mcp.claudeAi")}</p>
      <p className={window.location.protocol === "https:" ? "text-xs text-neutral-500" : "text-xs text-amber-700 dark:text-amber-400"}>
        {window.location.protocol === "https:" ? t("mcp.public") : t("mcp.notHttps")}
      </p>
      <p>{t("mcp.claudeCode")}</p>
      <pre className="rounded bg-neutral-100 px-2 py-1.5 font-mono text-xs break-all whitespace-pre-wrap dark:bg-neutral-800">{command}</pre>
    </div>
  );
}

/** What apps and agents changed with the user's tokens, latest first. */
export function AgentActivityList() {
  const activity = useQuery({ queryKey: ["agent-activity"], queryFn: async () => (await api<{ activity: AgentActivity[] }>("/tokens/activity")).activity });
  const when = (iso: string) => new Date(iso).toLocaleString(intlLocale(), { dateStyle: "medium", timeStyle: "short" });
  return (
    <div data-agent-activity>
      <h3 className="mb-2 text-sm font-medium">{t("activity.title")}</h3>
      {activity.isSuccess && !activity.data.length && <p className="text-sm text-neutral-500">{t("activity.empty")}</p>}
      <ul className="max-h-80 space-y-1 overflow-y-auto text-sm">
        {activity.data?.map((a) => (
          <li key={a.id} className="flex gap-2" data-activity={a.action}>
            <span className="shrink-0 text-xs leading-5 text-neutral-500">{when(a.createdAt)}</span>
            <span className="min-w-0">
              <span className="font-medium">{a.agent}</span> {t(`activity.${a.action}`)}{" "}
              {a.pageId && a.pageTitle !== null ? (
                <Link to={`/page/${a.pageId}`} className="text-blue-600 hover:underline dark:text-blue-400">
                  {a.pageIcon ? `${a.pageIcon} ` : ""}
                  {a.pageTitle || t("common.untitled")}
                </Link>
              ) : (
                <span className="text-neutral-500">{t("activity.gone")}</span>
              )}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
