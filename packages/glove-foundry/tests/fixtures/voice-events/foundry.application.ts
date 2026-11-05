import { Effect } from "effect";
import { defineApplication } from "../../../src/application.js";
import type { FoundryEventReceipt } from "../../../src/event-receipts.js";
import { FileFoundryDataAdapter } from "../../../src/file-data.js";
import { crashIf } from "./support.js";

/** The file data adapter, with crash checkpoints on receipt writes (in whichever process writes them). */
class CheckpointAdapter extends FileFoundryDataAdapter {
  override putEventReceipt(receipt: FoundryEventReceipt) {
    return Effect.tap(super.putEventReceipt(receipt), () => Effect.sync(() => {
      if (receipt.status === "accepted" && !receipt.transcriptMessageId) crashIf("after-accepted");
      if (receipt.status === "dispatching") crashIf("after-dispatching");
    }));
  }
}

export default defineApplication({
  name: "Voice events",
  data: new CheckpointAdapter({ file: `${process.env.FOUNDRY_VOICE_DIR}/foundry.json` }),
});
