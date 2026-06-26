/**
 * A minimal in-memory McpAdapter for the example. In production this is where
 * per-conversation active-state persistence and real token resolution live; here
 * active ids are a Set and the token is a constant (the dummy servers don't
 * check auth).
 */
import type { McpAdapter } from "glove-mcp";

export class InMemoryMcpAdapter implements McpAdapter {
  identifier: string;
  private active: Set<string>;

  constructor(identifier: string, initiallyActive: string[] = []) {
    this.identifier = identifier;
    this.active = new Set(initiallyActive);
  }

  async getActive(): Promise<string[]> {
    return [...this.active];
  }
  async activate(id: string): Promise<void> {
    this.active.add(id);
  }
  async deactivate(id: string): Promise<void> {
    this.active.delete(id);
  }
  async getAccessToken(): Promise<string> {
    return "dummy-token";
  }
}
