import type { RuntimeContextProvider } from "glove-core";
export function runtimeContextSupport() {
  const providers = new Set<RuntimeContextProvider>();
  return {
    addContextProvider(provider: RuntimeContextProvider) { providers.add(provider); return () => { providers.delete(provider); }; },
    async getRuntimeContext() { return (await Promise.all([...providers].map(p => p()))).filter(Boolean).join("\n"); },
  };
}
