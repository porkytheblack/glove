import "server-only";
import { notFound, redirect } from "next/navigation";
import { HttpError, currentPerson } from "glove-foundry-web-kit/server";

/** The signed-in person for a page, or off to sign in. */
export async function pagePerson() {
  const person = await currentPerson();
  if (!person) redirect("/welcome");
  return person;
}

/** A guard's 404 as the page's not-found. */
export async function orNotFound<T>(promise: Promise<T>): Promise<T> {
  try {
    return await promise;
  } catch (error) {
    if (error instanceof HttpError && error.status === 404) notFound();
    throw error;
  }
}
