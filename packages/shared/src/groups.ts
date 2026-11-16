import { z } from "zod";
import { PAGE_ROLES, type PageRole } from "./pages.js";

/**
 * Groups of people. Administrators make them (or the company's directory, through SCIM); a space or a page is then
 * shared with a group as with a person, and "@group" in a page tells everyone in it.
 */

/** A group opens a shared space as editor, commenter or viewer, never as owner: owners are named one by one. */
export const GROUP_WORKSPACE_ROLES = ["editor", "commenter", "viewer"] as const;
export type GroupWorkspaceRole = (typeof GROUP_WORKSPACE_ROLES)[number];

/** A group, as everyone (but guests) sees it: to share with it or mention it. */
export interface GroupSummary {
  id: string;
  name: string;
  description: string;
  memberCount: number;
  /** The user is in it. */
  mine: boolean;
  /** Made by the company's directory (SCIM): its members follow the directory. */
  scim: boolean;
}

export interface GroupMemberInfo {
  id: string;
  name: string;
  email: string;
  avatarUrl: string | null;
}

/** A group, as administrators see it: who is in it and what it opens. */
export interface GroupDetail extends GroupSummary {
  members: GroupMemberInfo[];
  spaces: { id: string; name: string; role: GroupWorkspaceRole }[];
  pages: { id: string; title: string; role: PageRole }[];
  createdAt: string;
}

/** A group in the members of a space. */
export interface WorkspaceGroupMember {
  groupId: string;
  name: string;
  memberCount: number;
  role: GroupWorkspaceRole;
}

/** A group a page is shared with. */
export interface PageGroupShare {
  groupId: string;
  name: string;
  memberCount: number;
  role: PageRole;
  /** Set when the share comes from an ancestor page. */
  inheritedFrom: { id: string; title: string } | null;
}

export const groupNameSchema = z.string().trim().min(1).max(100);
export const createGroupInput = z.object({ name: groupNameSchema, description: z.string().trim().max(500).optional() });
export const updateGroupInput = z.object({ name: groupNameSchema.optional(), description: z.string().trim().max(500).optional() });
export const groupMemberInput = z.object({ userId: z.string().min(1) });
export const setWorkspaceGroupInput = z.object({ groupId: z.string().min(1), role: z.enum(GROUP_WORKSPACE_ROLES) });
export const sharePageGroupInput = z.object({ groupId: z.string().min(1), role: z.enum(PAGE_ROLES) });
