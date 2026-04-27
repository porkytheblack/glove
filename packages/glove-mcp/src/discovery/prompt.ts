import type { DiscoveryAmbiguityPolicy } from "./policy";

const COMMON = `You help the main assistant find and activate capabilities it doesn't currently have.

When the main assistant asks you for a capability:
1. Use list_capabilities to search the catalogue for matches.
2. If exactly one capability obviously matches, call activate(id) and return a single sentence describing what was activated.
3. {{POLICY}}
4. If nothing matches, return a single sentence saying so.

Be brief. Your text reply is what the main assistant sees as the result of its find_capability call.
You may also receive requests to deactivate capabilities — call deactivate(id) for those.`;

const POLICY_PARAGRAPHS: Record<DiscoveryAmbiguityPolicy["type"], string> = {
  interactive:
    "If multiple capabilities could match, call ask_user with a brief question and the options. When the user picks, call activate(id).",
  "auto-pick-best":
    "If multiple capabilities match, pick the one that best matches the request and activate it. Do not ask. Be decisive.",
  "defer-to-main":
    "If multiple capabilities match, do NOT activate any. Return a single message listing the candidates (one per line: 'id — name: description') and tell the main assistant to ask the user which to use, or to pick based on context.",
};

export function defaultPromptFor(policy: DiscoveryAmbiguityPolicy): string {
  return COMMON.replace("{{POLICY}}", POLICY_PARAGRAPHS[policy.type]);
}
