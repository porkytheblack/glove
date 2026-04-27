/**
 * How the discovery subagent handles ambiguous matches.
 *
 * - `interactive`: subagent calls `ask_user` via `pushAndWait`. Requires a
 *   renderer for `mcp_picker` registered on the displayManager.
 * - `auto-pick-best`: subagent always picks the highest-ranked match. No
 *   human in the loop. Default for `serverMode: true`.
 * - `defer-to-main`: subagent returns the candidate list as text and lets
 *   the main agent decide.
 */
export type DiscoveryAmbiguityPolicy =
  | { type: "interactive" }
  | { type: "auto-pick-best" }
  | { type: "defer-to-main" };
