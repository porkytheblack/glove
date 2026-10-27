export declare function demoSecret(name: string, base?: string): string;

export declare function withDemoEnv<Env extends Record<string, string | undefined>>(
  env: Env,
  vars: (secret: (name: string) => string, web: string) => Record<string, string>,
): Env & Record<string, string>;
