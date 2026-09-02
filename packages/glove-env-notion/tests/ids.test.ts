import assert from "node:assert/strict";
import test from "node:test";
import { dashed, isId, toId } from "../src/ids";

const ID = "1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d";
const DASHED = "1a2b3c4d-5e6f-7a8b-9c0d-1e2f3a4b5c6d";

test("a bare id gains its dashes", () => {
  assert.equal(toId(ID), DASHED);
  assert.equal(toId(DASHED), DASHED);
  assert.equal(dashed(ID), DASHED);
});

test("a slug ending in hex does not eat the id", () => {
  // Stripping dashes first would splice "Cafe" onto the front of the id and
  // return a well-formed id that addresses nothing.
  assert.equal(toId(`https://www.notion.so/Cafe-${ID}`), DASHED);
  assert.equal(toId(`https://www.notion.so/Deadbeef-Notes-${ID}`), DASHED);
});

test("the peeked page wins over the database it was opened from", () => {
  const db = "99999999999999999999999999999999";
  const url = `https://www.notion.so/workspace/Tasks-${db}?v=abcdef&p=${ID}&pm=s`;
  assert.equal(toId(url), DASHED);
});

test("a view id is not mistaken for an object", () => {
  const url = `https://www.notion.so/workspace/Tasks-${ID}?v=99999999999999999999999999999999`;
  assert.equal(toId(url), DASHED);
});

test("a dashed id inside a URL is found", () => {
  assert.equal(toId(`https://www.notion.so/${DASHED}`), DASHED);
});

test("what cannot carry an id says so", () => {
  assert.throws(() => toId(""), /empty/);
  assert.throws(() => toId("https://www.notion.so/"), /no Notion id/);
  assert.throws(() => toId("not an id"), /not a Notion id/);
  assert.equal(isId("nope"), false);
  assert.equal(isId(42), false);
  assert.equal(isId(DASHED), true);
});
