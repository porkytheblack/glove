# glove-env-email

Email stdlib adapter for [`glove-working-environment`](../glove-working-environment). Opens `.eml` and Outlook `.msg` messages inside the agent's virtual filesystem as **`env:email`** — headers, body, and **attachments written into the tree** so every other adapter can read them.

```bash
pnpm add glove-env-email
```

```ts
import { createWorkingEnvironment } from "glove-working-environment";
import { email } from "glove-env-email";

const env = await createWorkingEnvironment({ stdlib: [email()] });
```

## Why

An inbox is where the complicated files come from. Before this, an attached `.eml` was a wall: no adapter claimed it, `ls` called it bytes, `describe` had nowhere to route it, and the PDF inside — the thing the user was actually asking about — was unreachable. The whole point of the rest of the environment is opening awkward artifacts, and the commonest envelope they arrive in could not be opened at all.

## What the model gets

| Function | Does |
|---|---|
| `describe(path)` | Sender, subject, date, and what is attached — writes nothing |
| `extract(path, { dir?, include?, inline? })` | The whole message, with every attachment written into the tree |

The job is small and specific: **turn one message into the files it contains.**

```js
import { extract } from 'env:email';
import { pdf } from 'env:documents';

/** Summarises whatever PDF came attached to a message. */
export default async function main() {
  const mail = await extract('/inbox/thread.eml', { include: '*.pdf' });
  if (mail.attachments.length === 0) return { subject: mail.subject, note: mail.note ?? 'no PDF attached' };

  const doc = await pdf.extractText(mail.attachments[0].path);
  return { subject: mail.subject, from: mail.from?.address, text: doc.text.slice(0, 2000) };
}
```

`attachments[].path` is an ordinary VFS path. `env:documents`, `env:images`, `env:spreadsheets`, `env:archives` and `env:ocr` all take it as-is — once the envelope is open, nothing downstream needs to know an email was involved. Attachments land in `<message path without extension>.attachments/` unless `dir` says otherwise.

## Recognition is by content

Messages arrive from export tools named `message`, `1.txt`, `forward.eml.txt`. So the bytes decide:

- an OLE compound file (`D0CF11E0…`) is a `.msg`;
- a block of RFC 5322 headers with at least one header a message must carry is an `.eml`;
- the extension only breaks ties.

`.mbox` is recognised and **refused**, by count: parsing it would return the first message and silently drop the other 399, which is the failure mode that looks exactly like success.

`handles` claims `.eml`, `.msg` and `.mbox` by extension but declares **no magic bytes** — legacy `.doc`, `.xls` and `.ppt` are compound files too, and magic beats extension across every adapter, so claiming `D0CF11E0` would take `describe` dispatch for all of them in order to answer "not a readable message".

## Attachment names are the sender's, not yours

An attachment filename is chosen by whoever sent the message, and a path that climbs out of the destination is a legal MIME filename. The rule is one step rather than a detector: **only the basename survives**, so a path cannot be spelled at all. On top of that, control characters are stripped, `.`/`..`/empty become `attachment-N`, and collisions are disambiguated (`report.pdf`, `report-2.pdf`).

Read `attachments[].path` rather than assuming the name you saw.

Inline parts — the logo in a signature, anything the HTML body references as `cid:…` — are skipped by default and reported in `note`. A long signature can carry a dozen and none of them is the document you wanted. Pass `{ inline: true }` when they are.

Attachment bytes go through the same guarded handle as any other write, so they count against `maxVfsBytes`. A message declaring more than `maxAttachments` (default 200) is refused before anything is written.

## Formats

| Format | Read | Notes |
|---|---|---|
| `.eml` | ✅ | RFC 5322, MIME, RFC 2047 encoded words, nested multiparts — via `mailparser` |
| `.msg` | ✅ | Outlook OLE compound file — via `@kenjiuno/msgreader` |
| `.mbox` | refused | a mailbox is many messages; the refusal says how many |

An embedded message inside a `.msg` (a forwarded mail attached as an item rather than a file) is **reported in `note`, not extracted** — writing a fabricated `.msg` that might not load is worse than saying it was skipped.

Nothing is written back: this module reads messages, it does not compose them.
