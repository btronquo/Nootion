import { createHash, randomBytes } from "node:crypto";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { exportJWK, generateKeyPair, SignJWT } from "jose";

/** A tiny OpenID Connect provider, standing in for Microsoft Entra ID. */
export interface FakeOidc {
  issuer: string;
  clientId: string;
  clientSecret: string;
  /** Plays the provider's sign-in page: who signs in, for the URL Nootion redirected to. Returns the callback query. */
  authorize: (
    authorizeUrl: string,
    who: {
      sub: string;
      email?: string;
      preferred_username?: string;
      email_verified?: boolean;
      name?: string;
    },
  ) => string;
  close: () => Promise<void>;
}

export async function startFakeOidc(): Promise<FakeOidc> {
  const { publicKey, privateKey } = await generateKeyPair("RS256");
  const jwk = {
    ...(await exportJWK(publicKey)),
    kid: "k1",
    alg: "RS256",
    use: "sig",
  };
  const clientId = "11111111-2222-3333-4444-555555555555";
  const clientSecret = "fake-client-secret";
  const codes = new Map<
    string,
    {
      claims: Record<string, unknown>;
      nonce: string;
      challenge: string;
      redirectUri: string;
    }
  >();
  let issuer = "";

  const server = http.createServer((req, res) => {
    const url = new URL(req.url!, issuer);
    const json = (status: number, body: unknown) => (
      res.writeHead(status, { "content-type": "application/json" }),
      res.end(JSON.stringify(body))
    );
    if (url.pathname.endsWith("/.well-known/openid-configuration")) {
      return json(200, {
        issuer,
        authorization_endpoint: `${issuer}/authorize`,
        token_endpoint: `${issuer}/token`,
        jwks_uri: `${issuer}/keys`,
      });
    }
    if (url.pathname.endsWith("/keys")) return json(200, { keys: [jwk] });
    if (url.pathname.endsWith("/token") && req.method === "POST") {
      let raw = "";
      req.on("data", (c) => (raw += c));
      req.on("end", async () => {
        const p = new URLSearchParams(raw);
        const grant = codes.get(p.get("code") ?? "");
        codes.delete(p.get("code") ?? "");
        if (
          p.get("client_id") !== clientId ||
          p.get("client_secret") !== clientSecret
        )
          return json(401, { error: "invalid_client" });
        if (!grant || grant.redirectUri !== p.get("redirect_uri"))
          return json(400, { error: "invalid_grant" });
        const challenge = createHash("sha256")
          .update(p.get("code_verifier") ?? "")
          .digest("base64url");
        if (challenge !== grant.challenge)
          return json(400, {
            error: "invalid_grant",
            error_description: "PKCE",
          });
        const idToken = await new SignJWT({
          ...grant.claims,
          nonce: grant.nonce,
        })
          .setProtectedHeader({ alg: "RS256", kid: "k1" })
          .setIssuer(issuer)
          .setAudience(clientId)
          .setIssuedAt()
          .setExpirationTime("1h")
          .sign(privateKey);
        json(200, {
          token_type: "Bearer",
          id_token: idToken,
          access_token: "x",
        });
      });
      return;
    }
    json(404, { error: "not_found" });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  issuer = `http://127.0.0.1:${(server.address() as AddressInfo).port}/tenant-1/v2.0`;

  return {
    issuer,
    clientId,
    clientSecret,
    authorize(authorizeUrl, who) {
      const q = new URL(authorizeUrl).searchParams;
      if (
        q.get("client_id") !== clientId ||
        q.get("code_challenge_method") !== "S256"
      )
        throw new Error("bad authorize request");
      const code = randomBytes(12).toString("hex");
      codes.set(code, {
        claims: who,
        nonce: q.get("nonce")!,
        challenge: q.get("code_challenge")!,
        redirectUri: q.get("redirect_uri")!,
      });
      return `code=${code}&state=${q.get("state")}`;
    },
    close: () => new Promise((r) => server.close(() => r())),
  };
}
