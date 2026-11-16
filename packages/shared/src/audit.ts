import { z } from "zod";
import { t, type MessageKey } from "./i18n/index.js";

/**
 * What the activity log records, by family. The families are the log's filter; each action has a label in the
 * translations ("audit.action.<action>").
 */
export const AUDIT_CATEGORIES = {
  auth: ["auth.login", "auth.login_failed", "auth.logout"],
  account: [
    "account.created",
    "account.password_changed",
    "account.password_reset",
    "account.email_changed",
    "account.two_factor_enabled",
    "account.two_factor_disabled",
    "account.deleted",
    "account.token_created",
    "account.token_revoked",
  ],
  users: ["user.invited", "user.invitation_revoked", "user.role_changed", "user.disabled", "user.enabled", "user.two_factor_reset"],
  sharing: [
    "page.shared",
    "page.unshared",
    "page.guest_invited",
    "page.public_link_created",
    "page.public_link_changed",
    "page.public_link_removed",
    "form.public_link_created",
    "form.public_link_changed",
    "form.public_link_removed",
    "workspace.member_set",
    "workspace.member_removed",
  ],
  content: ["page.trashed", "page.restored", "page.deleted", "workspace.created", "workspace.emptied", "workspace.deleted"],
  export: ["export.page", "export.workspace", "export.backup", "backup.run"],
  settings: ["settings.changed", "sso.scim_token_created", "sso.scim_token_removed"],
} as const;

export type AuditCategory = keyof typeof AUDIT_CATEGORIES;
export type AuditAction = (typeof AUDIT_CATEGORIES)[AuditCategory][number];
export const AUDIT_ACTIONS = Object.values(AUDIT_CATEGORIES).flat() as AuditAction[];

export function auditCategoryOf(action: string): AuditCategory | null {
  for (const [category, actions] of Object.entries(AUDIT_CATEGORIES)) if ((actions as readonly string[]).includes(action)) return category as AuditCategory;
  return null;
}

/** One line of the log. */
export interface AuditEvent {
  id: string;
  createdAt: string;
  actor: { id: string | null; name: string | null; email: string | null } | null;
  action: string;
  target: { type: string; id: string | null; label: string | null } | null;
  details: Record<string, unknown> | null;
  ip: string | null;
}

/** The log's filters, as query parameters; `before` is the cursor for the next page. */
export const auditQueryInput = z.object({
  category: z.enum(Object.keys(AUDIT_CATEGORIES) as [AuditCategory, ...AuditCategory[]]).optional(),
  action: z.string().max(64).optional(),
  actorId: z.string().max(64).optional(),
  q: z.string().trim().max(200).optional(),
  from: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  to: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  before: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
export type AuditQuery = z.infer<typeof auditQueryInput>;

/** How long the log keeps its lines, in days; 0 keeps them for ever. */
export const AUDIT_RETENTION_CHOICES = [30, 90, 180, 365, 730, 0] as const;

/** The action's label in the current language; the code itself for an action this version doesn't know. */
export function auditActionLabel(action: string): string {
  return (AUDIT_ACTIONS as string[]).includes(action) ? t(`audit.action.${action}` as MessageKey) : action;
}
