// The instance's own name and logo, set by administrators ("Administration › Branding").

/** The longest name administrators may give the app. */
export const APP_NAME_MAX = 40;

/** The largest logo accepted, in bytes. */
export const LOGO_MAX_BYTES = 1024 * 1024;

/** What every page (signed in or not) needs to show the instance's name and logo. */
export interface Branding {
  /** The name to show: the custom one, or "Nootion". */
  name: string;
  /** Whether administrators changed the name. */
  customName: boolean;
  /** The custom logo (versioned, so browsers may keep it), or null for Nootion's. */
  logoUrl: string | null;
}
