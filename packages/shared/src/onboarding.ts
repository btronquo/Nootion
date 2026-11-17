/** What the app offers someone who signs in: the guided tour (new accounts) and the setup assistant (first administrator). */
export interface OnboardingState {
  /** The guided tour of what Nootion can do is still to be shown to this account. */
  tour: boolean;
  /** An administrator who hasn't finished (or skipped) the setup assistant of a new server. */
  setup: boolean;
  /** The user's "Discover" page with examples, when they still have it. */
  demoPageId: string | null;
}

/** Where a new server stands, for the steps of the setup assistant ("Administration › Setup assistant"). */
export interface SetupStatus {
  /** APP_URL, the address people open. */
  appUrl: string;
  /** Passkeys work at that address (HTTPS, or localhost). */
  passkeys: boolean;
  /** Attached files go to an S3-compatible bucket (FILES_S3_BUCKET) rather than the data folder. */
  filesBucket: string | null;
  /** An outgoing mail server is set (Administration › E-mail, or SMTP_* variables). */
  mail: boolean;
  /** Single sign-on is set up, with the label of its button. */
  sso: string | null;
  /** Automatic backups are scheduled. */
  backups: boolean;
  /** Plugins installed and turned on. */
  plugins: { enabled: number; total: number };
  /** The AI assistant plugin is installed / turned on. */
  assistant: { installed: boolean; enabled: boolean };
  /** Accounts (members and administrators) and pending invitations. */
  members: number;
  invitations: number;
  /** Guests may be invited on pages. */
  allowGuests: boolean;
}
