import { z } from "zod";
import type { WorkspaceRole } from "./workspaces.js";

/**
 * Access level on a page, from lowest to highest.
 * full: edit, share, publish and delete. editor: edit content and create subpages.
 */
export const PAGE_ROLES = ["viewer", "commenter", "editor", "full"] as const;
export type PageRole = (typeof PAGE_ROLES)[number];

export function roleRank(role: PageRole | null | undefined): number {
  return role ? PAGE_ROLES.indexOf(role) + 1 : 0;
}

export function atLeast(role: PageRole | null | undefined, min: PageRole): boolean {
  return roleRank(role) >= roleRank(min);
}

export function maxRole(a: PageRole | null, b: PageRole | null): PageRole | null {
  return roleRank(a) >= roleRank(b) ? a : b;
}

/** Page access granted by membership of the page's workspace. */
export const WORKSPACE_ROLE_TO_PAGE_ROLE: Record<WorkspaceRole, PageRole> = {
  owner: "full",
  editor: "full",
  commenter: "commenter",
  viewer: "viewer",
};

export const PAGE_KINDS = ["page", "database", "row"] as const;
export type PageKind = (typeof PAGE_KINDS)[number];

export interface PageSummary {
  id: string;
  kind: PageKind;
  workspaceId: string;
  parentId: string | null;
  title: string;
  icon: string | null;
  position: number;
}

export interface PageDetail extends PageSummary {
  role: PageRole;
  /** Ancestors the user can see, from the root down to the parent. */
  breadcrumb: { id: string; title: string; icon: string | null }[];
  /** Content uses the whole window width instead of a centered column. */
  fullWidth: boolean;
  cover: string | null;
  coverPosition: number;
  createdAt: string;
  updatedAt: string;
  /** The reader's own home page. */
  home: boolean;
  /** A page template, or (for a row) a row template of its database. */
  template: boolean;
}

/** A page the user opened lately, for "Recently visited". */
export interface RecentPage extends PageSummary {
  cover: string | null;
  coverPosition: number;
  visitedAt: string;
}

export interface PageShare {
  userId: string;
  name: string;
  email: string;
  role: PageRole;
  /** Set when the share comes from an ancestor page. */
  inheritedFrom: { id: string; title: string } | null;
}

export interface PublicLinkInfo {
  token: string;
  includeSubpages: boolean;
  url: string;
}

export interface TrashedPage {
  id: string;
  title: string;
  icon: string | null;
  deletedAt: string;
}

export const titleSchema = z.string().max(500);
export const iconSchema = z.string().max(64).nullable();

/** Built-in cover gradients, stored as "gradient:<name>". */
export const COVER_GRADIENTS = ["sunset", "ocean", "forest", "dusk", "peach", "slate"] as const;

/** A page cover: an attachment of the page, an https image link, or "gradient:<name>". */
export const coverSchema = z
  .string()
  .max(2048)
  .refine(
    (v) =>
      /^\/api\/attachments\/[0-9a-f-]{36}$/.test(v) ||
      /^https?:\/\/\S+$/.test(v) ||
      (v.startsWith("gradient:") && (COVER_GRADIENTS as readonly string[]).includes(v.slice(9))),
  )
  .nullable();

export const createPageInput = z.object({
  workspaceId: z.string().min(1),
  parentId: z.string().min(1).nullable().default(null),
  title: titleSchema.default(""),
  icon: iconSchema.optional(),
  /** Adds a link to the new page at the end of its parent (the default). False when the caller places the link itself. */
  linkInParent: z.boolean().default(true),
});
export type CreatePageInput = z.infer<typeof createPageInput>;

export const updatePageInput = z.object({
  title: titleSchema.optional(),
  icon: iconSchema.optional(),
  fullWidth: z.boolean().optional(),
  cover: coverSchema.optional(),
  coverPosition: z.number().int().min(0).max(100).optional(),
  /** Pages only: offered as a template when starting an empty page. */
  template: z.boolean().optional(),
});

export const movePageInput = z.object({
  parentId: z.string().min(1).nullable(),
  /** Index among the new siblings; appended at the end when omitted. */
  index: z.number().int().min(0).optional(),
});

export const sharePageInput = z.object({ userId: z.string().min(1), role: z.enum(PAGE_ROLES) });

export const publicLinkInput = z.object({ includeSubpages: z.boolean().default(true) });

/** A page found by the search. */
export interface SearchResult {
  id: string;
  title: string;
  icon: string | null;
  kind: "page" | "database" | "row";
  /** Titles of the parent pages the user can see, from the top. */
  path: string[];
  /** Extract of the content; matched words are between \u0001 and \u0002. */
  snippet: string;
  /** Set when the match is in a file attached to the page (its name or its text). */
  file?: { id: string; name: string };
}

/** New order of the user's favorites: every favorite page id, in order. */
export const reorderFavoritesInput = z.object({ pageIds: z.array(z.string().min(1)).max(1000) });

/** A version in a page's history. */
export interface PageVersion {
  id: string;
  createdAt: string;
  title: string;
  /** People who edited the page since the version before. */
  authors: { id: string; name: string }[];
  /** Set when this version came from restoring an older one: when that one was made. */
  restoredFrom: string | null;
  /** Set when an app or AI agent wrote this version through the API: its token's name. */
  agent: string | null;
}

/** A page that links to or mentions another one. */
export interface Backlink extends PageSummary {
  /** Text around the link, to see what it says. */
  excerpt: string;
}

/** A page icon can be an emoji, or an image uploaded by someone ("icon:<id>"). */
export const CUSTOM_ICON_PREFIX = "icon:";
export const ICON_MAX_BYTES = 1024 * 1024;
export const customIconId = (icon: string | null | undefined): string | null => (icon?.startsWith(CUSTOM_ICON_PREFIX) ? icon.slice(CUSTOM_ICON_PREFIX.length) : null);
export const customIconUrl = (id: string) => `/api/icons/${id}/image`;

export interface CustomIcon {
  id: string;
  name: string;
  url: string;
  /** Whether the reader may delete it: who uploaded it, and administrators. */
  canDelete: boolean;
}
/** The icon as text before a title (in notifications, exports…): the emoji, or nothing for an image. */
export const iconText = (icon: string | null | undefined): string => (icon && !customIconId(icon) ? `${icon} ` : "");

/** A page in "All pages": where it is, who made it, when it changed. */
export interface LibraryPage extends PageSummary {
  /** The space's name, or null for the reader's personal space. */
  workspaceName: string | null;
  /** Titles of the ancestors the reader can see, from the top. */
  path: string[];
  createdByName: string | null;
  createdAt: string;
  updatedAt: string;
}

/** The pages and how they are linked, for the graph. */
export interface PageGraph {
  nodes: { id: string; title: string; icon: string | null; kind: PageKind; workspaceId: string }[];
  /** "child": a subpage of `source`; "link": `source` links to or mentions `target`. */
  links: { source: string; target: string; kind: "child" | "link" }[];
}
