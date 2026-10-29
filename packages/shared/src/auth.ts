import { z } from "zod";
import { LOCALES, t, type Locale } from "./i18n/index.js";

export const USER_ROLES = ["admin", "member"] as const;
export type UserRole = (typeof USER_ROLES)[number];

export const emailSchema = z.string().trim().toLowerCase().email().max(254);
export const passwordSchema = z
  .string()
  .min(8, { error: () => t("auth.passwordTooShort") })
  .max(256);
export const nameSchema = z.string().trim().min(1).max(100);

export const localeSchema = z.enum(LOCALES);

export const setupInput = z.object({
  name: nameSchema,
  email: emailSchema,
  password: passwordSchema,
  locale: localeSchema.optional(),
});
export type SetupInput = z.infer<typeof setupInput>;

export const loginInput = z.object({
  email: emailSchema,
  password: z.string().min(1).max(256),
});
export type LoginInput = z.infer<typeof loginInput>;

export const createInvitationInput = z.object({
  email: emailSchema.optional(),
  role: z.enum(USER_ROLES).default("member"),
});
export type CreateInvitationInput = z.infer<typeof createInvitationInput>;

export const acceptInvitationInput = z.object({
  name: nameSchema,
  email: emailSchema,
  password: passwordSchema,
  locale: localeSchema.optional(),
});
export type AcceptInvitationInput = z.infer<typeof acceptInvitationInput>;

export const updateUserInput = z.object({
  role: z.enum(USER_ROLES).optional(),
  disabled: z.boolean().optional(),
});
export type UpdateUserInput = z.infer<typeof updateUserInput>;

/** Changes to one's own account. Changing the email or the password requires the current password. */
export const updateMeInput = z
  .object({
    name: nameSchema.optional(),
    email: emailSchema.optional(),
    newPassword: passwordSchema.optional(),
    currentPassword: z.string().max(256).optional(),
    locale: localeSchema.optional(),
  })
  .strict();
export type UpdateMeInput = z.infer<typeof updateMeInput>;

export const AVATAR_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"] as const;
export const AVATAR_MAX_BYTES = 2 * 1024 * 1024;

export interface PublicUser {
  id: string;
  name: string;
  email: string;
  /** URL of the profile picture, or null. */
  avatarUrl: string | null;
  role: UserRole;
  disabled: boolean;
  /** Interface language. */
  locale: Locale;
  createdAt: string;
}

export interface InvitationInfo {
  id: string;
  email: string | null;
  role: UserRole;
  expiresAt: string;
  usedAt: string | null;
  createdAt: string;
}
