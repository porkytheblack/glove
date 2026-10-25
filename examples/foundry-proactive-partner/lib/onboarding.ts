/**
 * A person's account, as data. Their workspace holds their partner and the
 * computer it works on. What they want to hear about and how often are their
 * preferences, on the partner instance; the schedule is built from them.
 */
export interface Person {
  readonly id: string;
  readonly name: string;
  /** IANA time zone; the brief and check-ins follow it. */
  readonly timezone: string;
}

export interface Preferences {
  /** When the morning brief goes out, HH:MM in their time zone. */
  readonly briefAt: string;
  /** The hours a check-in looks for anything new. */
  readonly checkInHours: ReadonlyArray<number>;
  /** What is worth interrupting them for. */
  readonly hearAbout: ReadonlyArray<string>;
}

export const DEFAULT_PREFERENCES: Preferences = {
  briefAt: "07:30",
  checkInHours: [10, 13, 16, 19],
  hearAbout: ["payments due or failed", "documents to sign", "clients waiting on a reply", "calendar clashes"],
};

/** The partner: one per person, in their own workspace. */
export function partnerFor(person: Person, preferences: Preferences = DEFAULT_PREFERENCES) {
  return {
    id: person.id,
    workspaceId: person.id,
    name: "Partner",
    description: `${person.name}'s partner: looks after their inbox, calendar and errands.`,
    context: { name: person.name, timezone: person.timezone, preferences },
  };
}

/** The computer the partner hands long jobs to. Also data: one per person. */
export function computerFor(person: Pick<Person, "id">) {
  return {
    id: `${person.id}-computer`,
    workspaceId: person.id,
    name: "Computer",
    description: "The partner's own computer, with files and the web. Builds pages and dashboards and researches across sites. Takes minutes.",
    context: {},
  };
}

/** The person the example starts with. */
export const DEMO_PERSON: Person = { id: "ada", name: "Ada", timezone: "America/New_York" };

/** The one thread. Its id is derived from the person, so there is never a second. */
export const threadFor = (person: Pick<Person, "id">) => ({ id: `${person.id}-thread`, workspaceId: person.id, title: "Partner" });
