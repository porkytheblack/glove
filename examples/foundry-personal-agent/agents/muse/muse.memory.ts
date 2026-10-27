import { personalMemory } from "../../lib/memory.js";

/**
 * What Muse knows about its person, whichever channel they said it in.
 * glove_context_set keeps a fact; glove_context_unset is how Muse forgets one
 * when they ask.
 */
export default personalMemory("What Muse knows about its person: people, preferences, plans");
