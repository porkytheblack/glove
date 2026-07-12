/** All interpreter-surfaced errors are `JsError` — a program error the model
 *  should read and fix, never a host crash. The message names the one thing to
 *  change (a did-you-mean, a rejected construct, the fuel/depth limit). */
export class JsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "JsError";
  }
}
