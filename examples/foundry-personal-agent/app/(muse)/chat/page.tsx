import { chatState, museOf, personaOf } from "../../server/muse";
import { orNotFound, pagePerson } from "../../server/signed-in";
import { Chat } from "../../ui/Chat";

export default async function ChatPage() {
  const person = await pagePerson();
  const muse = await orNotFound(museOf(person.id));
  const persona = personaOf(muse);
  return <Chat name={persona.name} avatar={persona.avatar} initial={await chatState(person.id)} />;
}
