import { createInvite } from "glove-foundry-web-kit/server";

// A sign-in link for one person, good for 7 days. Their workspace is their id.
//   pnpm invite maya
// Signed with WEB_SESSION_SECRET; WEB_URL is where the web app is reached.

const [personId] = process.argv.slice(2);
if (!personId) throw new Error("Usage: pnpm invite <personId>");
if (!process.env.WEB_SESSION_SECRET) console.error("No WEB_SESSION_SECRET is set, so this link only works with a development server.");
const base = (process.env.WEB_URL ?? `http://localhost:${process.env.PORT ?? "3000"}`).replace(/\/$/, "");
console.log(`${base}/signin?t=${createInvite(personId)}`);
