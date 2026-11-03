# Single sign-on (SSO) and SCIM

Nootion can let people sign in with their company account, through any OpenID Connect provider: Microsoft Entra
ID (formerly Azure AD), Google Workspace, Okta, Keycloak, Authentik… With SCIM, the provider can also create
accounts and disable people who leave, within minutes.

Everything is set in **Administration > Single sign-on (SSO)**. This guide walks through Microsoft Entra ID; other
providers ask for the same things under other names.

## 1. Register Nootion in Entra ID

In the [Entra admin center](https://entra.microsoft.com), as an administrator who can register applications:

1. **Applications > App registrations > New registration.**
   - Name: `Nootion`.
   - Supported account types: **Accounts in this organizational directory only** (single tenant).
   - Redirect URI: platform **Web**, and the address shown in Nootion under "Redirect URI":
     `https://<your Nootion>/api/auth/sso/callback`.
2. On the app's **Overview**, note the **Application (client) ID** and the **Directory (tenant) ID**.
3. **Certificates & secrets > New client secret.** Copy its **Value** (not its ID) right away. A secret lasts 24
   months at most: put a reminder in your calendar to make a new one before it runs out, and paste it in Nootion.
4. **API permissions**: the default `User.Read` is enough; Nootion asks for `openid`, `profile` and `email`, which
   need no admin consent.
5. Optional, to let only some people in: **Enterprise applications > Nootion > Properties > Assignment required?
   Yes**, then **Users and groups > Add user/group**.

## 2. Set it in Nootion

In Administration > Single sign-on (SSO):

| Field | Value |
| --- | --- |
| Button name | `Microsoft` (the button reads "Sign in with Microsoft") |
| Issuer URL | `https://login.microsoftonline.com/<tenant ID>/v2.0` |
| Client ID | the Application (client) ID |
| Client secret | the secret's Value |

Then:

- **New accounts**: who gets an account the first time they sign in.
  - *Only existing accounts and invited people* (the default): accounts that already exist are linked by their
    e-mail address, and invitations work as usual (by address, or with the link, followed by "Sign in with
    Microsoft").
  - *Anyone with an address in these domains*, e.g. `contoso.com`.
  - *Anyone who can sign in at the provider*: with "Assignment required" in Entra, that is the people and groups
    assigned to the app.
- **SSO session length**: 12 hours by default. After that, people go through Microsoft again: a click if they are
  still signed in there, the door closed if their account was disabled.
- **Allow passwords too**: turn it off to make SSO the only way in. Administrators can always still sign in with
  their password ("Administrator? Sign in with a password" on the sign-in page), so a broken setup or an expired
  secret doesn't lock everyone out.

Save, then click **Try signing in**.

Notes:

- Nootion asks the provider for its settings at `<issuer>/.well-known/openid-configuration`, then checks every
  sign-in with the provider's keys: the Nootion server must be able to reach `login.microsoftonline.com` over
  HTTPS. People's browsers go there anyway.
- Use the tenant ID in the issuer, not `common` or `organizations`: only accounts of your organization can then
  sign in.
- Accounts are recognised by the provider's id after the first sign-in: someone whose address changes keeps their
  account.
- Accounts made through SSO have no password. "Forgot password" sends nothing to them while passwords are off.

## 3. Disable people who leave: SCIM

With SCIM, Entra tells Nootion when someone is added to the app, renamed, disabled or removed. Nootion then creates
the account, keeps its name and address up to date, or disables it and signs it out everywhere. Accounts are never
deleted this way, only disabled, so what people wrote stays; an administrator can delete them in Administration.

1. In Nootion, in the SCIM part of the SSO settings, click **Turn on and make a token**. Copy the token: it is shown
   only once.
2. In Entra: **Enterprise applications > Nootion > Provisioning > Get started**, mode **Automatic**:
   - Tenant URL: the "Tenant URL" shown in Nootion, `https://<your Nootion>/api/scim/v2`.
   - Secret token: the token.
   - **Test connection**, then **Save**.
3. Under **Mappings**, turn **Provision Microsoft Entra ID Groups** off (Nootion has its own spaces and roles).
   The user mappings can stay as they are: Nootion uses `userName` and `emails` (the address), `displayName` (the
   name), `active` and `externalId`.
4. Under **Settings**, scope: *Sync only assigned users and groups* (recommended).
5. **Start provisioning.** Entra then syncs every 40 minutes or so; "Provision on demand" pushes one person at once.

Accounts that already exist in Nootion are matched by their e-mail address, so turning SCIM on later is fine.
Nootion never lets SCIM disable its last administrator.

### When Nootion isn't reachable from the internet

Signing in works on a private network: it is the browser that goes to Microsoft and comes back. SCIM is different:
it is Entra, in Microsoft's cloud, that calls Nootion. If Nootion is only reachable inside the company network,
either:

- install Microsoft's **provisioning agent** on a Windows server of the network, which relays the SCIM calls
  inside it (Entra ID P1 or P2 needed): see Microsoft's guide "Microsoft Entra on-premises application provisioning
  to SCIM-enabled apps", and give it the same tenant URL and token; or
- go without SCIM, and keep the SSO session length short: someone disabled in Entra can't sign in again, and loses
  access at the latest when their session ends.
