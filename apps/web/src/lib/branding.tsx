import { useQuery, useQueryClient } from "@tanstack/react-query";
import { DEFAULT_APP_NAME, setAppName, type Branding } from "@nootion/shared";
import { api } from "./api";

// The instance's own name and logo ("Administration › Branding"). The server writes them in the page (a meta tag),
// so that they are known before anything renders; the app then keeps them up to date from /api/branding.

const DEFAULT: Branding = { name: DEFAULT_APP_NAME, customName: false, logoUrl: null };
const DEFAULT_ICON = "/favicon.svg";

function fromPage(): Branding | null {
  const content = document.querySelector<HTMLMetaElement>('meta[name="nootion-branding"]')?.content;
  if (!content) return null;
  try {
    const b = JSON.parse(content) as Branding;
    return typeof b?.name === "string" ? b : null;
  } catch {
    return null;
  }
}

let current: Branding = fromPage() ?? DEFAULT;
setAppName(current.customName ? current.name : null);

/** The name and logo as known now (before the first answer of /api/branding, those of the page). */
export const brandingNow = () => current;

function setLink(rel: string, href: string, type?: string) {
  let link = document.querySelector<HTMLLinkElement>(`link[rel="${rel}"]`);
  if (!link) {
    link = document.createElement("link");
    link.rel = rel;
    document.head.appendChild(link);
  }
  link.href = href;
  if (type) link.type = type;
  else link.removeAttribute("type");
}

/** Shows a name and logo everywhere: texts (through t()), the browser tab, its icon. */
function applyBranding(b: Branding) {
  const before = current;
  current = b;
  setAppName(b.customName ? b.name : null);
  if (document.title === before.name || document.title === DEFAULT_APP_NAME) document.title = b.name;
  document.querySelector<HTMLMetaElement>('meta[name="apple-mobile-web-app-title"]')?.setAttribute("content", b.name);
  if (b.logoUrl !== before.logoUrl || b.logoUrl) {
    // The browser finds the image's type itself.
    setLink("icon", b.logoUrl ?? DEFAULT_ICON, b.logoUrl ? undefined : "image/svg+xml");
    setLink("apple-touch-icon", b.logoUrl ?? "/apple-touch-icon.png");
  }
}

export const brandingKey = ["branding"];

/** The instance's name and logo; components using it render again when administrators change them. */
export function useBranding(): Branding {
  const query = useQuery({
    queryKey: brandingKey,
    queryFn: async () => {
      const b = (await api<{ branding: Branding }>("/branding")).branding;
      // Before the components render with it, so that their texts say the new name.
      if (JSON.stringify(b) !== JSON.stringify(current)) applyBranding(b);
      return b;
    },
    initialData: current,
    // Fetched once per load: the page already had them.
    staleTime: Infinity,
    refetchOnMount: fromPage() ? false : "always",
  });
  return query.data ?? current;
}

/** After administrators change the name or logo: everything shows the new ones at once. */
export function useSetBranding() {
  const qc = useQueryClient();
  return (b: Branding) => {
    applyBranding(b);
    // The components showing them render again, with texts from t() that say the new name.
    qc.setQueryData(brandingKey, b);
  };
}

/** The instance's logo (Nootion's without one). */
export function BrandLogo({ className = "", size }: { className?: string; size?: number }) {
  const { logoUrl } = useBranding();
  return (
    <img
      src={logoUrl ?? DEFAULT_ICON}
      alt=""
      className={`object-contain ${className}`}
      style={size ? { width: size, height: size } : undefined}
      data-brand-logo
    />
  );
}
