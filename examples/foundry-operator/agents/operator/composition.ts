import { composeAgent } from "glove-foundry";
import memory from "./memory/operator.memory.js";
export const operatorComponents = composeAgent(memory);
