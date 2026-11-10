/** Whether a newer Nootion is out, for administrators. */
export interface UpdateStatus {
  /** The running version, e.g. "3.1.0", or "3.1.0-dev" outside a release image. */
  current: string;
  /** False when the server doesn't look (UPDATE_CHECK=false). */
  checking: boolean;
  checkedAt: string | null;
  latest: { version: string; url: string; publishedAt: string | null } | null;
  available: boolean;
  /** The administrator asked not to be told about this version again. */
  dismissed: boolean;
}

/** One release of CHANGELOG.md. */
export interface ReleaseNotes {
  version: string;
  /** "2026-11-03", or null when the changelog doesn't say. */
  date: string | null;
  /** The release's section of the changelog, in Markdown (### headings and lists). */
  markdown: string;
}

/** The "What's new" window: the releases this user hasn't seen yet, newest first; empty when there is nothing new. */
export interface WhatsNew {
  version: string;
  releases: ReleaseNotes[];
}
