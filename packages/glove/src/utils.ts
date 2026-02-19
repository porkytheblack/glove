import type { Message } from "./core";

// Returns messages from the last compaction onward. The store keeps full history
// for the frontend, while the model only sees the post-compaction context.
export function splitAtLastCompaction(messages: Array<Message>) {
    
    for (let i = messages.length - 1; i > 0;  i--) {
        if(messages[i].is_compaction) {
            return messages.slice(i)
        }
    }

    return messages
}