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
