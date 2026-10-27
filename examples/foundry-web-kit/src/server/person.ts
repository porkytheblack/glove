import { HttpError } from "./errors";
import { SESSION_COOKIE, readSession } from "./session";

/** Who is signed in. Their workspace is their id. */
export interface SignedIn {
  readonly id: string;
}

/** The signed-in person in a page, layout or route, or null. */
export async function currentPerson(): Promise<SignedIn | null> {
  // Loaded here so the rest of the kit runs in plain Node (scripts, tests).
  const { cookies } = await import("next/headers");
  const session = readSession((await cookies()).get(SESSION_COOKIE)?.value);
  return session ? { id: session.personId } : null;
}

/** Every API route starts here: the signed-in person, or a 401. */
export async function requirePerson(): Promise<SignedIn> {
  const person = await currentPerson();
  if (!person) throw new HttpError(401, "Sign in first.");
  return person;
}
