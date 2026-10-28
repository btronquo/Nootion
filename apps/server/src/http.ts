import type { FastifyReply, FastifyRequest } from "fastify";
import type { ZodType } from "zod";

export class HttpError extends Error {
  constructor(
    public statusCode: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

export const notFound = () => new HttpError(404, "not_found", "Ressource introuvable.");
export const forbidden = () => new HttpError(403, "forbidden", "Accès refusé.");
export const unauthorized = () => new HttpError(401, "unauthorized", "Connexion requise.");

export function parseBody<T>(schema: ZodType<T>, body: unknown): T {
  const result = schema.safeParse(body);
  if (!result.success) {
    const first = result.error.issues[0];
    const field = first?.path.join(".");
    throw new HttpError(400, "invalid_input", field ? `${field} : ${first.message}` : (first?.message ?? "Données invalides."));
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
