import tseslint from "typescript-eslint";
import foundry from "glove-foundry/eslint";

export default [
  { ignores: [".foundry/**"] },
  ...tseslint.configs.recommended,
  foundry,
];
