/** An error with a status a route can answer with. Its message reaches the browser. */
export class HttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

export const notFound = (): HttpError => new HttpError(404, "Not found.");

/**
 * Wrap a route handler: an HttpError becomes its status and message; anything
 * else is logged and answered with a plain 500, so internals stay on the server.
 */
export function handle<A extends unknown[]>(handler: (...args: A) => Promise<Response>): (...args: A) => Promise<Response> {
  return async (...args) => {
    try {
      return await handler(...args);
    } catch (error) {
      if (error instanceof HttpError) return Response.json({ error: error.message }, { status: error.status });
      console.error(error);
      return Response.json({ error: "Something went wrong." }, { status: 500 });
    }
  };
}
