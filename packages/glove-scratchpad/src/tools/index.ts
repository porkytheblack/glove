/**
 * The Glove-facing surface: tools a subdroid folds, the mount helper, and the
 * store-and-truncate wrapper that contains tool results.
 */
export {
  scratchpadTools,
  buildDescribeTool,
  buildQueryTool,
  buildMaterializeTool,
  buildListTool,
  type ScratchpadToolOptions,
} from "./surface";

export {
  mountScratchpad,
  SCRATCHPAD_PREAMBLE,
  type MountScratchpadConfig,
} from "./mount";

export {
  storeAndTruncate,
  stubData,
  type StoreAndTruncateOptions,
} from "./store-and-truncate";
