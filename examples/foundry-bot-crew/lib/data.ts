import { FileFoundryDataAdapter } from "glove-foundry";
import { dataPath } from "./paths.js";

/** People, their bots, conversations, threads and skills live in `.data/foundry.json`. */
export const data = new FileFoundryDataAdapter({ file: dataPath("foundry.json") });
