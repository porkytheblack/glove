export class AgentValidationError extends Error {
  readonly code = "AGENT_VALIDATION_ERROR" as const;
  readonly agentName: string;

  constructor(agentName: string, zodMessage: string) {
    super(`Invalid input for agent "${agentName}": ${zodMessage}`);
    this.name = "AgentValidationError";
    this.agentName = agentName;
  }
}

export class AgentNotFoundError extends Error {
  readonly code = "AGENT_NOT_FOUND" as const;
  readonly agentName: string;
  readonly filePath?: string;

  constructor(agentName: string, filePath?: string) {
    super(
      filePath
        ? `Agent "${agentName}" not found in ${filePath}`
        : `Agent "${agentName}" is not registered`,
    );
    this.name = "AgentNotFoundError";
    this.agentName = agentName;
    this.filePath = filePath;
  }
}

export class AgentTimeoutError extends Error {
  readonly code = "AGENT_TIMEOUT" as const;
  readonly agentName: string;
  readonly timeoutMs: number;

  constructor(agentName: string, timeoutMs: number) {
    super(`Agent "${agentName}" timed out after ${timeoutMs}ms`);
    this.name = "AgentTimeoutError";
    this.agentName = agentName;
    this.timeoutMs = timeoutMs;
  }
}

export class AgentTerminatedError extends Error {
  readonly code = "AGENT_TERMINATED" as const;
  readonly agentName: string;

  constructor(agentName: string, reason?: string) {
    super(
      reason
        ? `Agent "${agentName}" terminated: ${reason}`
        : `Agent "${agentName}" terminated`,
    );
    this.name = "AgentTerminatedError";
    this.agentName = agentName;
  }
}

export class ContinuumRemoteError extends Error {
  readonly code = "CONTINUUM_REMOTE_ERROR" as const;
  readonly statusCode: number;
  readonly remoteError?: string;

  constructor(statusCode: number, remoteError?: string, remoteMessage?: string) {
    super(
      remoteMessage
        ? `Continuum server returned ${statusCode}: ${remoteMessage}`
        : `Continuum server returned ${statusCode}`,
    );
    this.name = "ContinuumRemoteError";
    this.statusCode = statusCode;
    this.remoteError = remoteError;
  }
}
