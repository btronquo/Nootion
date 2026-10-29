import type { FastifyReply, FastifyRequest } from "fastify";
import type { ZodType } from "zod";
import { t } from "@nootion/shared";

export class HttpError extends Error {
  constructor(
    public statusCode: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

export const notFound = () => new HttpError(404, "not_found", t("error.notFound"));
export const forbidden = () => new HttpError(403, "forbidden", t("error.forbidden"));
export const unauthorized = () => new HttpError(401, "unauthorized", t("error.unauthorized"));

export function parseBody<T>(schema: ZodType<T>, body: unknown): T {
  const result = schema.safeParse(body);
  if (!result.success) {
    const first = result.error.issues[0];
    const field = first?.path.join(".");
    throw new HttpError(400, "invalid_input", field ? t("error.invalidField", { field, message: first.message }) : (first?.message ?? t("error.invalidInput")));
  }
  return result.data;
}

export function requireUser(req: FastifyRequest) {
  if (!req.user) throw unauthorized();
  return req.user;
}

export function requireAdmin(req: FastifyRequest) {
  const user = requireUser(req);
  if (user.role !== "admin") throw forbidden();
  return user;
}

export type Reply = FastifyReply;
