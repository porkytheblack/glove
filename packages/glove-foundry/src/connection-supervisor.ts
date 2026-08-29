import { Effect } from "effect";
import type { FoundryAccountSessionAdapter, FoundryAgentApplication } from "./capabilities.js";
import type {
  ApplicationConnectionState,
  FoundryApplicationConnection,
} from "./connection.js";
import type { AccountReference, InboundRoute } from "./domain.js";

export interface DesiredApplicationConnection {
  readonly id: string;
  readonly application: FoundryAgentApplication;
  readonly connection: FoundryApplicationConnection;
  readonly definitionId: string;
  readonly workspaceId: string;
  readonly account?: AccountReference;
  readonly routes: ReadonlyArray<InboundRoute>;
  readonly accountSessions?: FoundryAccountSessionAdapter;
}

interface RunningConnection {
  desired: DesiredApplicationConnection;
  controller: AbortController;
  task: Promise<void>;
}

export interface ApplicationConnectionSupervisorOptions {
  readonly receive: (input: {
    readonly routeId: string;
    readonly eventId: string;
    readonly threadKey: string;
    readonly raw: unknown;
  }) => Promise<void>;
  readonly emit: (event: {
    readonly type: string;
    readonly data: unknown;
  }) => void;
}

function safeError(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

function routeSignature(routes: ReadonlyArray<InboundRoute>): string {
  return routes.map((route) => route.id).sort().join("\0");
}

/**
 * Purpose-built in-process supervisor. The public API only sees application
 * connections; a deployment backend may replace this implementation without
 * changing application definitions.
 */
export class ApplicationConnectionSupervisor {
  private readonly running = new Map<string, RunningConnection>();
  private readonly states = new Map<string, ApplicationConnectionState>();

  constructor(private readonly options: ApplicationConnectionSupervisorOptions) {}

  list(): ReadonlyArray<ApplicationConnectionState> {
    return [...this.states.values()].map((state) => ({
      ...state,
      routeIds: [...state.routeIds],
    }));
  }

  async reconcile(desired: ReadonlyArray<DesiredApplicationConnection>): Promise<void> {
    const wanted = new Map(desired.map((item) => [item.id, item]));
    for (const [id, running] of this.running) {
      const next = wanted.get(id);
      if (
        !next ||
        routeSignature(next.routes) !== routeSignature(running.desired.routes)
      ) {
        await this.stop(id);
        if (!next) this.states.delete(id);
      }
    }
    for (const item of desired) {
      if (!this.running.has(item.id)) this.start(item);
    }
  }

  async reconnect(id: string): Promise<void> {
    const current = this.running.get(id)?.desired;
    if (!current) throw new Error(`Application connection "${id}" was not found.`);
    await this.stop(id);
    this.start(current);
  }

  async stopAll(): Promise<void> {
    await Promise.all([...this.running.keys()].map((id) => this.stop(id)));
  }

  private start(desired: DesiredApplicationConnection): void {
    const controller = new AbortController();
    const task = this.run(desired, controller.signal).finally(() => {
      const current = this.running.get(desired.id);
      if (current?.controller === controller) this.running.delete(desired.id);
    });
    this.running.set(desired.id, { desired, controller, task });
  }

  private async stop(id: string): Promise<void> {
    const running = this.running.get(id);
    if (!running) return;
    running.controller.abort();
    await running.task.catch(() => undefined);
    this.running.delete(id);
    this.update(running.desired, {
      status: "disconnected",
      disconnectedAt: new Date().toISOString(),
    });
  }

  private async run(
    desired: DesiredApplicationConnection,
    signal: AbortSignal,
  ): Promise<void> {
    let attempts = 0;
    while (!signal.aborted) {
      attempts += 1;
      this.update(desired, {
        status: attempts === 1 ? "connecting" : "reconnecting",
        attempts,
      });
      let ready = false;
      try {
        const program = desired.connection.connect({
          applicationId: desired.application.id,
          connectionId: desired.connection.id,
          definitionId: desired.definitionId,
          workspaceId: desired.workspaceId,
          ...(desired.account ? { account: desired.account } : {}),
          routes: desired.routes,
          signal,
          ready: () => Effect.sync(() => {
            if (ready) return;
            ready = true;
            this.update(desired, {
              status: "connected",
              attempts,
              connectedAt: new Date().toISOString(),
              error: "",
            });
          }),
          receive: (input) => Effect.tryPromise({
            try: async () => {
              if (!desired.routes.some((route) => route.id === input.route.id)) {
                throw new Error(
                  `Connection "${desired.id}" emitted through inactive route "${input.route.id}".`,
                );
              }
              this.update(desired, {
                status: ready ? "connected" : "connecting",
                attempts,
                lastEventAt: new Date().toISOString(),
              });
              await this.options.receive({
                routeId: input.route.id,
                eventId: input.eventId,
                threadKey: input.threadKey,
                raw: input.raw,
              });
            },
            catch: (cause) => cause,
          }).pipe(Effect.orDie),
          ...(desired.account && desired.accountSessions
            ? {
                withAccountSession: <A>(
                  operation: string,
                  use: (session: unknown) => Effect.Effect<A, unknown, never>,
                ) => desired.accountSessions!.withSession({
                  accountId: desired.account!.id,
                  operation,
                  agentId: `connection:${desired.id}`,
                  conversationId: `connection:${desired.id}`,
                  workspaceId: desired.workspaceId,
                }, use),
              }
            : {}),
        });
        await Effect.runPromise(program as Effect.Effect<void, unknown>, { signal });
        if (signal.aborted) break;
        throw new Error("Provider connection ended.");
      } catch (cause) {
        if (signal.aborted) break;
        this.update(desired, {
          status: "failed",
          attempts,
          disconnectedAt: new Date().toISOString(),
          error: safeError(cause),
        });
      }
      const backoffMs = Math.min(30_000, 250 * 2 ** Math.min(attempts - 1, 7));
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, backoffMs);
        signal.addEventListener("abort", () => {
          clearTimeout(timer);
          resolve();
        }, { once: true });
      });
    }
  }

  private update(
    desired: DesiredApplicationConnection,
    patch: Partial<ApplicationConnectionState>,
  ): void {
    const prior = this.states.get(desired.id);
    const state: ApplicationConnectionState = Object.freeze({
      id: desired.id,
      applicationId: desired.application.id,
      connectionId: desired.connection.id,
      definitionId: desired.definitionId,
      workspaceId: desired.workspaceId,
      ...(desired.account ? { accountId: desired.account.id } : {}),
      routeIds: Object.freeze(desired.routes.map((route) => route.id).sort()),
      status: patch.status ?? prior?.status ?? "disconnected",
      attempts: patch.attempts ?? prior?.attempts ?? 0,
      ...(patch.connectedAt ?? prior?.connectedAt
        ? { connectedAt: patch.connectedAt ?? prior?.connectedAt }
        : {}),
      ...(patch.disconnectedAt ?? prior?.disconnectedAt
        ? { disconnectedAt: patch.disconnectedAt ?? prior?.disconnectedAt }
        : {}),
      ...(patch.lastEventAt ?? prior?.lastEventAt
        ? { lastEventAt: patch.lastEventAt ?? prior?.lastEventAt }
        : {}),
      ...(patch.error !== undefined
        ? patch.error ? { error: patch.error } : {}
        : prior?.error ? { error: prior.error } : {}),
    });
    this.states.set(desired.id, state);
    this.options.emit({
      type: `application.connection.${state.status}`,
      data: state,
    });
  }
}
