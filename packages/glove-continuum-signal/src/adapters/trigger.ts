/**
 * Minimal adapter interface for remote trigger operations.
 *
 * Used when `agent.trigger(input)` or `agent.notify(input)` should reach a
 * Continuum server rather than write to a local adapter. Configured globally
 * via `configure({ endpoint, apiKey })` or `configure({ triggerAdapter })`.
 */
export interface TriggerAdapter {
  /**
   * Hand off an input for a registered agent. The server is responsible for
   * routing based on the agent's mode (triggered → new run, concurrent → notify).
   * Returns a run id.
   */
  trigger(agentName: string, input: unknown): Promise<string>;
  ping?(): Promise<boolean>;
}
