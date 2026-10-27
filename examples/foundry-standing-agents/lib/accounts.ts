import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename } from "node:fs/promises";
import { Effect, Layer, Schema } from "effect";
import {
  AccountDirectory,
  AccountNotFound,
  AccountReference,
  fileTopologyStore,
  memoryEventStore,
  type FoundryAccountSessionAdapter,
} from "glove-foundry";
import gmail from "../agents/dot/transmissions/gmail.transmission.js";
import { refresh, type Provider } from "./oauth.js";
import { dataDir, dataPath } from "./paths.js";

// The accounts people connect, kept by you, not by Foundry. Your OAuth
// callback saves two things: the account (who it is, safe to show) and its
// tokens (secret, in a separate file only this process user can read).
// Foundry reads accounts through `services` and asks for a session through
// `accountSessions`; it never holds a token.

export interface ConnectedAccount {
  /** Your id for the connection, like maya-gmail. */
  readonly id: string;
  /** The person's workspace. */
  readonly person: string;
  /** Which app it connects, by the app's file name. */
  readonly app: string;
  readonly provider: Provider;
  /** The identity at the provider: an email address, a user id. */
  readonly externalAccountId: string;
  readonly label?: string;
  readonly metadata: Readonly<Record<string, string>>;
  /** A sample account: its apps use local servers and the ledger instead of the provider. */
  readonly offline?: boolean;
}

export interface Tokens {
  readonly accessToken: string;
  readonly refreshToken?: string;
  /** Epoch milliseconds. */
  readonly expiresAt?: number;
}

/** What an operation gets inside the credential boundary. */
export interface AccountSession {
  readonly accessToken: string;
  readonly account: ConnectedAccount;
}

const accountsFile = () => dataPath("accounts.json");
const tokensFile = () => dataPath("tokens.json");

async function readJson<T>(file: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await readFile(file, "utf8")) as T;
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === "ENOENT") return fallback;
    throw cause;
  }
}

async function writeJson(file: string, value: unknown): Promise<void> {
  await mkdir(dataDir, { recursive: true });
  const temporary = `${file}.${randomUUID()}.tmp`;
  const handle = await open(temporary, "wx", 0o600);
  try {
    await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`);
  } finally {
    await handle.close();
  }
  await rename(temporary, file);
}

export function readAccounts(): Promise<ConnectedAccount[]> {
  return readJson<ConnectedAccount[]>(accountsFile(), []);
}

export async function readAccount(id: string): Promise<ConnectedAccount | undefined> {
  return (await readAccounts()).find((account) => account.id === id);
}

export async function accountsOf(person: string): Promise<ConnectedAccount[]> {
  return (await readAccounts()).filter((account) => account.person === person);
}

/** What your OAuth callback calls once the provider hands back tokens. */
export async function saveAccount(account: ConnectedAccount, tokens: Tokens): Promise<void> {
  const tokensByAccount = await readJson<Record<string, Tokens>>(tokensFile(), {});
  await writeJson(tokensFile(), { ...tokensByAccount, [account.id]: tokens });
  await writeJson(accountsFile(), [...(await readAccounts()).filter((item) => item.id !== account.id), account]);
}

/**
 * Apps with a transmission, and which one. Their accounts appear in Foundry's
 * account directory, so routes, bindings and connections can use them. An
 * app that is only an MCP server (Linear here) needs no entry: its
 * installation names the account and accountSessions resolves it.
 */
const TRANSMISSIONS: Readonly<Record<string, () => string>> = { gmail: () => gmail.id };

function reference(account: ConnectedAccount): AccountReference | undefined {
  const transmission = TRANSMISSIONS[account.app];
  if (!transmission) return undefined;
  return Schema.decodeUnknownSync(AccountReference)({
    id: account.id,
    transmissionId: transmission(),
    externalAccountId: account.externalAccountId,
    ...(account.label ? { label: account.label } : {}),
    // Opaque to Foundry. accountSessions below is the only reader.
    accessRef: `tokens://${account.id}`,
    metadata: account.metadata,
  });
}

/**
 * Foundry's view of your accounts, read live so a new connection shows up at
 * once. `extra` adds accounts the application defines in code, such as a bot
 * user that belongs to the app rather than to a person.
 */
function accountDirectory(extra: ReadonlyArray<AccountReference>) {
  return Layer.succeed(AccountDirectory, {
    get: (id) => Effect.flatMap(Effect.promise(readAccounts), (accounts) => {
      const found = accounts.find((item) => item.id === id);
      const account = (found && reference(found)) ?? extra.find((item) => item.id === id);
      return account ? Effect.succeed(account) : Effect.fail(new AccountNotFound({ accountId: id }));
    }),
    list: (filter = {}) => Effect.map(Effect.promise(readAccounts), (accounts) => [...extra, ...accounts.flatMap((account) => reference(account) ?? [])]
      .filter((account) => !filter.transmissionId || account.transmissionId === filter.transmissionId)),
  });
}

/**
 * The accounts above, plus routes and bindings in a file so the ones written
 * when someone connects an app survive a restart. Give it to
 * defineApplication({ services }); it replaces the application's own
 * `accounts`, so pass any of those as `extra`.
 */
export function servicesWith(extra: ReadonlyArray<AccountReference> = []) {
  return Layer.mergeAll(
    accountDirectory(extra),
    fileTopologyStore(dataPath("topology.json")),
    memoryEventStore,
  );
}

export const services = servicesWith();

async function sessionFor(accountId: string): Promise<AccountSession> {
  const account = (await readAccounts()).find((item) => item.id === accountId);
  if (!account) throw new Error(`No connected account ${accountId}.`);
  const tokensByAccount = await readJson<Record<string, Tokens>>(tokensFile(), {});
  let tokens = tokensByAccount[accountId];
  if (!tokens) throw new Error(`Account ${accountId} has no tokens. Connect it again.`);
  if (tokens.refreshToken && tokens.expiresAt && tokens.expiresAt - 60_000 < Date.now()) {
    // Two processes refreshing at once both get valid tokens; the last write wins.
    tokens = await refresh(account.provider, tokens.refreshToken);
    await writeJson(tokensFile(), { ...tokensByAccount, [accountId]: tokens });
  }
  return { accessToken: tokens.accessToken, account };
}

/**
 * The credential boundary. Foundry asks for an operation on an account
 * (gmail:send, mcp:connect, gmail:watch) and gets the result of `use`, never
 * the token. Installers, connections and outbound deliveries all come here.
 */
export const accountSessions: FoundryAccountSessionAdapter = {
  identifier: "connected-accounts",
  withSession: (request, use) => Effect.flatMap(
    Effect.tryPromise({ try: () => sessionFor(request.accountId), catch: (cause) => cause }),
    use,
  ),
};
