/**
 * The Glove-facing surface: tools a subagent folds, the mount helper, and the
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
  createContainmentReporter,
  type StoreAndTruncateOptions,
  type ContainmentInfo,
  type ContainmentListener,
  type ContainmentReporter,
  type ContainmentReport,
} from "./store-and-truncate";

export {
  containTools,
  mountContainedTools,
  type ContainToolsOptions,
} from "./contain";
