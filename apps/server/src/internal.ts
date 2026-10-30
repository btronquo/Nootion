import { randomBytes } from "node:crypto";

// The server calling its own API on behalf of a user (public forms run their steps as the link's author). The secret
// changes at each start and never leaves the process: requests from outside can't use these headers.
export const INTERNAL_SECRET = randomBytes(32).toString("hex");
export const INTERNAL_HEADER = "x-nootion-internal";
export const ACT_AS_HEADER = "x-nootion-act-as";
