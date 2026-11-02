import { watchState } from "../../server/muse";
import { pagePerson } from "../../server/signed-in";
import { Watch } from "../../ui/Watch";

export default async function WatchPage() {
  const person = await pagePerson();
  return <Watch initial={await watchState(person.id)} />;
}
