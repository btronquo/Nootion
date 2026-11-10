import { createHash, randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";
import {
  ssoSettingsInput,
  t,
  type SsoInfo,
  type SsoSettings,
  type SsoSettingsInput,
} from "@nootion/shared";
import type { Db } from "./db/index.js";
import { ssoSettings } from "./db/schema.js";
import { HttpError } from "./http.js";
import { decryptSecret, encryptSecret, secretKey } from "./secrets.js";
import { hashToken, newToken } from "./auth/tokens.js";

const ROW = "default";
/** Where the provider sends people back. */
export const SSO_CALLBACK = "/api/auth/sso/callback";
export const SCIM_PATH = "/api/scim/v2";

interface Discovery {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  jwks_uri: string;
}

/** Who signed in, as the provider says. */
export interface SsoIdentity {
  subject: string;
  email: string | null;
  /** False when the provider says the address was never checked (anyone could have typed it). */
  emailVerified: boolean;
  name: string | null;
}

const b64url = (b: Buffer) => b.toString("base64url");

/** Single sign-on with an OpenID Connect provider, and the SCIM token, as administrators set them. */
export function createSso(opts: { db: Db; appSecret: string; appUrl: string }) {
  const { db } = opts;
  const key = secretKey(opts.appSecret, "nootion-sso");
  const row = () =>
    db.select().from(ssoSettings).where(eq(ssoSettings.id, ROW)).get();
  const config = (): SsoSettingsInput | null => {
    const r = row();
    return r ? ssoSettingsInput.parse(r.config) : null;
  };
  const redirectUri = () => `${opts.appUrl}${SSO_CALLBACK}`;

  function get(): SsoSettings | null {
    const r = row();
    if (!r) return null;
    const { clientSecret: _, ...c } = ssoSettingsInput.parse(r.config);
    return {
      ...c,
      hasSecret: !!r.secret,
      redirectUri: redirectUri(),
      scim: { url: `${opts.appUrl}${SCIM_PATH}`, enabled: !!r.scimTokenHash },
    };
  }

  function save(input: SsoSettingsInput): SsoSettings {
    const old = row();
    const oldConfig = old ? ssoSettingsInput.parse(old.config) : null;
    // A secret is kept only for the same application at the same provider.
    const sameApp =
      oldConfig?.issuer === input.issuer &&
      oldConfig.clientId === input.clientId;
    const secret = input.clientSecret
      ? encryptSecret(key, input.clientSecret)
      : sameApp
        ? (old?.secret ?? null)
        : null;
    if (!secret)
      throw new HttpError(400, "invalid_input", t("sso.secretRequired"));
    if (input.signup === "domains" && !input.domains.length)
      throw new HttpError(400, "invalid_input", t("sso.domainsRequired"));
    const { clientSecret: _, ...stored } = input;
    const values = {
      config: { ...stored, issuer: input.issuer.replace(/\/+$/, "") },
      secret,
      updatedAt: new Date(),
    };
    db.insert(ssoSettings)
      .values({ id: ROW, ...values })
      .onConflictDoUpdate({ target: ssoSettings.id, set: values })
      .run();
    discovery = null;
    return get()!;
  }

  function remove() {
    db.delete(ssoSettings).where(eq(ssoSettings.id, ROW)).run();
    discovery = null;
  }

  /** For the sign-in page; null when SSO is off. */
  function info(): SsoInfo | null {
    const c = config();
    return c ? { label: c.label, passwordLogin: c.passwordLogin } : null;
  }

  // The provider's endpoints, read once from its discovery document.
  let discovery: {
    issuer: string;
    doc: Discovery;
    jwks: ReturnType<typeof createRemoteJWKSet>;
    at: number;
  } | null = null;
  async function discover(issuer: string) {
    if (
      discovery &&
      discovery.issuer === issuer &&
      Date.now() - discovery.at < 24 * 3600_000
    )
      return discovery;
    let doc: Discovery;
    try {
      const res = await fetch(`${issuer}/.well-known/openid-configuration`, {
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      doc = (await res.json()) as Discovery;
    } catch (err) {
      throw new HttpError(
        502,
        "sso_unreachable",
        t("sso.unreachable", { reason: (err as Error).message }),
      );
    }
    if (!doc.authorization_endpoint || !doc.token_endpoint || !doc.jwks_uri)
      throw new HttpError(
        502,
        "sso_unreachable",
        t("sso.unreachable", { reason: "discovery" }),
      );
    discovery = {
      issuer,
      doc,
      jwks: createRemoteJWKSet(new URL(doc.jwks_uri)),
      at: Date.now(),
    };
    return discovery;
  }

  /** Where to send the browser, and what to remember until it comes back. */
  async function begin(): Promise<{
    url: string;
    state: string;
    nonce: string;
    verifier: string;
  }> {
    const c = config();
    if (!c) throw new HttpError(404, "sso_off", t("sso.off"));
    const { doc } = await discover(c.issuer);
    const state = b64url(randomBytes(24));
    const nonce = b64url(randomBytes(24));
    const verifier = b64url(randomBytes(32));
    const url = new URL(doc.authorization_endpoint);
    url.search = new URLSearchParams({
      response_type: "code",
      client_id: c.clientId,
      redirect_uri: redirectUri(),
      scope: "openid profile email",
      state,
      nonce,
      code_challenge: b64url(createHash("sha256").update(verifier).digest()),
      code_challenge_method: "S256",
    }).toString();
    return { url: url.toString(), state, nonce, verifier };
  }

  /** Trades the code for the ID token, checks it, and says who signed in. */
  async function finish(
    code: string,
    nonce: string,
    verifier: string,
  ): Promise<SsoIdentity> {
    const c = config();
    const r = row();
    if (!c || !r) throw new HttpError(404, "sso_off", t("sso.off"));
    const secret = r.secret ? decryptSecret(key, r.secret) : null;
    if (!secret)
      throw new HttpError(400, "sso_secret", t("sso.secretUnreadable"));
    const { doc, jwks } = await discover(c.issuer);
    const res = await fetch(doc.token_endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        accept: "application/json",
      },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: redirectUri(),
        client_id: c.clientId,
        client_secret: secret,
        code_verifier: verifier,
      }),
      signal: AbortSignal.timeout(15_000),
    });
    const body = (await res.json().catch(() => null)) as {
      id_token?: string;
      error?: string;
      error_description?: string;
    } | null;
    if (!res.ok || !body?.id_token)
      throw new Error(
        body?.error_description ?? body?.error ?? `HTTP ${res.status}`,
      );
    const { payload } = await jwtVerify(body.id_token, jwks, {
      issuer: doc.issuer,
      audience: c.clientId,
      clockTolerance: 60,
    });
    if (payload.nonce !== nonce) throw new Error("nonce");
    return identity(payload);
  }

  // SCIM: one token, shown once to administrators.
  function newScimToken(): string {
    if (!row()) throw new HttpError(404, "sso_off", t("sso.off"));
    const token = `scim_${newToken()}`;
    db.update(ssoSettings)
      .set({ scimTokenHash: hashToken(token) })
      .where(eq(ssoSettings.id, ROW))
      .run();
    return token;
  }
  function removeScimToken() {
    db.update(ssoSettings)
      .set({ scimTokenHash: null })
      .where(eq(ssoSettings.id, ROW))
      .run();
  }
  function scimTokenValid(token: string): boolean {
    const hash = row()?.scimTokenHash;
    return !!hash && hash === hashToken(token);
  }

  return {
    get,
    save,
    remove,
    config,
    info,
    begin,
    finish,
    newScimToken,
    removeScimToken,
    scimTokenValid,
  };
}

export type Sso = ReturnType<typeof createSso>;

/** Microsoft puts the address in "email" only when the mailbox has one; "preferred_username" is the sign-in name. */
function identity(p: JWTPayload): SsoIdentity {
  const str = (v: unknown) =>
    typeof v === "string" && v.trim() ? v.trim() : null;
  const email =
    [p.email, p.preferred_username, p.upn]
      .map(str)
      .find((v) => v && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v)) ?? null;
  // Only an explicit "not verified" counts: Entra ID and others don't send the claim at all.
  const verified = p.email_verified ?? p.xms_edov;
  return {
    subject: String(p.sub),
    email: email?.toLowerCase() ?? null,
    emailVerified: !(verified === false || verified === "false"),
    name: str(p.name),
  };
}
