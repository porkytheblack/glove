type Node = Record<string, any>;
type RuleContext = {
  report(input: { node: Node; messageId: string; data?: Record<string, string> }): void;
};

function propertyName(property: Node): string | undefined {
  if (property.computed) return undefined;
  return property.key?.name ?? property.key?.value;
}

const noAgentContracts = {
  meta: {
    type: "problem",
    docs: { description: "Keep transport input/output contracts out of agent definitions." },
    schema: [],
    messages: {
      forbidden: "Agent definitions cannot export or pass '{{name}}'. Foundry owns invocation and result contracts.",
    },
  },
  create(context: RuleContext) {
    return {
      CallExpression(node: Node) {
        if (node.callee?.type !== "Identifier" || node.callee.name !== "defineAgent") return;
        const object = node.arguments?.[0];
        if (object?.type !== "ObjectExpression") return;
        for (const property of object.properties ?? []) {
          const name = propertyName(property);
          if (name === "input" || name === "output") {
            context.report({ node: property, messageId: "forbidden", data: { name } });
          }
        }
      },
      ExportNamedDeclaration(node: Node) {
        const declaration = node.declaration;
        if (declaration?.type !== "VariableDeclaration") return;
        for (const item of declaration.declarations ?? []) {
          const name = item.id?.name;
          if (name === "input" || name === "output") {
            context.report({ node: item, messageId: "forbidden", data: { name } });
          }
        }
      },
    };
  },
};

const noRawDefinitionReferences = {
  meta: {
    type: "problem",
    docs: {
      description: "Require imported definition values for code-authored Foundry relationships.",
    },
    schema: [],
    messages: {
      direct:
        "Use the imported {{replacement}} definition instead of '{{name}}'. String ids belong at JSON/API/storage reconstruction boundaries.",
    },
  },
  create(context: RuleContext) {
    const inspectPlaybookValues = (node: Node): void => {
      if (!node || typeof node !== "object") return;
      if (node.type === "Property") {
        const name = propertyName(node);
        const replacement = name === "event"
          ? "event"
          : name === "action"
            ? "action"
            : name === "applicationAccountId"
              ? "applicationAccount"
              : undefined;
        if (name && replacement && (node.value?.type === "Literal" || name === "applicationAccountId")) {
          context.report({ node, messageId: "direct", data: { name, replacement } });
        }
      }
      for (const key of ["properties", "elements"]) {
        for (const child of node[key] ?? []) inspectPlaybookValues(child);
      }
      if (node.type === "Property") inspectPlaybookValues(node.value);
    };
    return {
      CallExpression(node: Node) {
        if (node.callee?.type !== "Identifier") return;
        const helper = node.callee.name;
        if (helper === "install") {
          const config = node.arguments?.[1];
          if (config?.type === "ObjectExpression") {
            for (const property of config.properties ?? []) {
              if (propertyName(property) === "accountId") {
                context.report({
                  node: property,
                  messageId: "direct",
                  data: { name: "accountId", replacement: "account" },
                });
              }
            }
          }
          return;
        }
        const object = node.arguments?.[0];
        if (object?.type !== "ObjectExpression") return;
        if (helper === "composePlaybook") inspectPlaybookValues(object);
        const forbidden = helper === "composePlaybook"
          ? new Map([
              ["transmissionId", "transmission"],
              ["applicationId", "application"],
              ["routeId", "route"],
              ["routeIds", "routes"],
            ])
          : null;
        if (!forbidden) return;
        for (const property of object.properties ?? []) {
          const name = propertyName(property);
          const replacement = name ? forbidden.get(name) : undefined;
          if (!name || !replacement) continue;
          context.report({
            node: property,
            messageId: "direct",
            data: { name, replacement },
          });
        }
      },
    };
  },
};

const FILE_ROUTED_HELPERS = new Set([
  "defineAgent",
  "definePlaybookAction",
  "defineAgentApplication",
  "defineApp",
  "defineConnection",
  "defineLayer",
  "defineMcp",
  "defineMemory",
  "definePlaybookSubscription",
  "defineSharedTool",
  "defineSubscriber",
  "defineTransmission",
  "defineTransmissionEvent",
  "defineTransmissionPredicate",
]);

const noFileDefinitionId = {
  meta: {
    type: "problem",
    docs: { description: "Let convention filenames own static definition identities." },
    schema: [],
    messages: {
      filename:
        "Remove this id. Default-export the definition and Foundry will derive its stable identity from the convention filename.",
    },
  },
  create(context: RuleContext) {
    return {
      CallExpression(node: Node) {
        if (node.callee?.type !== "Identifier" || !FILE_ROUTED_HELPERS.has(node.callee.name)) return;
        const object = node.arguments?.[0];
        if (object?.type !== "ObjectExpression") return;
        for (const property of object.properties ?? []) {
          if (propertyName(property) === "id") {
            context.report({ node: property, messageId: "filename" });
          }
        }
      },
    };
  },
};

export const foundryEslintPlugin = Object.freeze({
  rules: Object.freeze({
    "no-agent-contracts": noAgentContracts,
    "no-file-definition-id": noFileDefinitionId,
    "no-raw-definition-references": noRawDefinitionReferences,
  }),
});

/** Flat-config preset. Spread it after typescript-eslint's recommended config. */
export const foundryEslintConfig = Object.freeze({
  name: "glove-foundry/recommended",
  files: ["**/*.{ts,tsx,mts,js,mjs}"],
  plugins: { "glove-foundry": foundryEslintPlugin },
  rules: {
    "glove-foundry/no-agent-contracts": "error",
    "glove-foundry/no-file-definition-id": "error",
    "glove-foundry/no-raw-definition-references": "error",
  },
});

export default foundryEslintConfig;
