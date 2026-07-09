/** Language semantics — the supported Python subset. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { PySession } from "../src/session";

async function run(code: string): Promise<unknown> {
  const s = PySession.create();
  return (await s.execute(code)).value;
}

test("literals, arithmetic, and operator precedence", async () => {
  assert.equal(await run("1 + 2 * 3"), 7);
  assert.equal(await run("2 ** 10"), 1024);
  assert.equal(await run("17 % 5"), 2);
  assert.equal(await run("7 // 2"), 3);
  assert.equal(await run("-7 // 2"), -4); // Python floor division rounds toward -inf
  assert.equal(await run("(-7) % 3"), 2); // Python modulo follows the divisor's sign
});

test("boolean ops return operands (Python and/or)", async () => {
  assert.equal(await run("True and 'yes'"), "yes");
  assert.equal(await run("None or 'fallback'"), "fallback");
  assert.deepEqual(await run("0 or []"), []);
  assert.equal(await run("not 0"), true);
  assert.equal(await run("not [1]"), false);
});

test("Python truthiness", async () => {
  assert.equal(await run("True if [] else False"), false);
  assert.equal(await run("True if {} else False"), false);
  assert.equal(await run("True if '' else False"), false);
  assert.equal(await run("True if 0 else False"), false);
  assert.equal(await run("True if None else False"), false);
  assert.equal(await run("True if [0] else False"), true);
  assert.equal(await run("True if 'x' else False"), true);
});

test("ternary a if c else b", async () => {
  assert.equal(await run("'a' if 1 < 2 else 'b'"), "a");
  assert.equal(await run("'a' if 1 > 2 else 'b'"), "b");
});

test("f-strings interpolate expressions", async () => {
  assert.equal(await run("n = 3\nf'n is {n} and {n * 2}'"), "n is 3 and 6");
  assert.equal(await run("xs = [1, 2, 3]\nf'{len(xs)} items'"), "3 items");
});

test("lists, tuples, dicts, sets", async () => {
  assert.deepEqual(await run("[1, 2, 3]"), [1, 2, 3]);
  assert.deepEqual(await run("{'a': 1, 'b': 2}"), { a: 1, b: 2 });
  assert.deepEqual(await run("d = {'a': 1}\nd['b'] = 2\nd"), { a: 1, b: 2 });
  assert.equal(await run("len({1, 2, 2, 3})"), 3);
});

test("assignment and tuple unpacking", async () => {
  assert.deepEqual(await run("a, b = 1, 2\n[a, b]"), [1, 2]);
  assert.deepEqual(await run("a, b = [10, 20]\n[a, b]"), [10, 20]);
  assert.equal(await run("x = 1\nx = x + 4\nx"), 5);
  assert.equal(await run("x = 0\nx += 5\nx *= 2\nx"), 10);
});

test("indexing and negative indices", async () => {
  assert.equal(await run("[10, 20, 30][1]"), 20);
  assert.equal(await run("[10, 20, 30][-1]"), 30);
  assert.equal(await run("'hello'[0]"), "h");
  assert.equal(await run("{'k': 'v'}['k']"), "v");
});

test("slicing", async () => {
  assert.deepEqual(await run("[1, 2, 3, 4, 5][1:3]"), [2, 3]);
  assert.deepEqual(await run("[1, 2, 3, 4, 5][:2]"), [1, 2]);
  assert.deepEqual(await run("[1, 2, 3, 4, 5][::2]"), [1, 3, 5]);
  assert.deepEqual(await run("[1, 2, 3][::-1]"), [3, 2, 1]);
  assert.equal(await run("'hello'[1:4]"), "ell");
  assert.equal(await run("'hello'[::-1]"), "olleh");
});

test("chained comparisons", async () => {
  assert.equal(await run("1 < 2 < 3"), true);
  assert.equal(await run("1 < 2 > 5"), false);
  assert.equal(await run("n = 5\n0 < n <= 5"), true);
});

test("in / not in", async () => {
  assert.equal(await run("2 in [1, 2, 3]"), true);
  assert.equal(await run("'x' in {'x': 1}"), true);
  assert.equal(await run("'ell' in 'hello'"), true);
  assert.equal(await run("5 not in [1, 2, 3]"), true);
});

test("list comprehension with filter", async () => {
  assert.deepEqual(await run("[x * x for x in range(5)]"), [0, 1, 4, 9, 16]);
  assert.deepEqual(await run("[x for x in range(10) if x % 2 == 0]"), [0, 2, 4, 6, 8]);
});

test("nested comprehension and dict/set comprehensions", async () => {
  assert.deepEqual(await run("[a + b for a in [1, 2] for b in [10, 20]]"), [11, 21, 12, 22]);
  assert.deepEqual(await run("{k: v for k, v in [('a', 1), ('b', 2)]}"), { a: 1, b: 2 });
  assert.equal(await run("len({x % 3 for x in range(9)})"), 3);
});

test("comprehension variables do not leak to the session", async () => {
  const s = PySession.create();
  await s.execute("[y for y in range(3)]");
  await assert.rejects(() => s.execute("y"), /not defined/);
});

test("def and return", async () => {
  assert.equal(await run("def sq(n):\n  return n * n\nsq(6)"), 36);
  assert.equal(
    await run("def fib(n):\n  if n < 2:\n    return n\n  return fib(n-1) + fib(n-2)\nfib(10)"),
    55,
  );
});

test("def with default arguments", async () => {
  assert.equal(await run("def greet(name, punct='!'):\n  return name + punct\ngreet('hi')"), "hi!");
  assert.equal(await run("def greet(name, punct='!'):\n  return name + punct\ngreet('hi', punct='?')"), "hi?");
});

test("lambda", async () => {
  assert.equal(await run("f = lambda x: x + 1\nf(9)"), 10);
  assert.deepEqual(await run("sorted([3, 1, 2], key=lambda x: -x)"), [3, 2, 1]);
});

test("for / while with break and continue", async () => {
  assert.equal(await run("t = 0\nfor i in range(5):\n  t += i\nt"), 10);
  assert.equal(await run("t = 0\nfor i in range(10):\n  if i == 5:\n    break\n  t += i\nt"), 10);
  assert.equal(await run("t = 0\nfor i in range(5):\n  if i % 2 == 0:\n    continue\n  t += i\nt"), 4);
  assert.equal(await run("n = 0\nwhile n < 3:\n  n += 1\nn"), 3);
});

test("try / except / finally and raise", async () => {
  assert.equal(await run("try:\n  x = [1][5]\nexcept:\n  x = 'caught'\nx"), "caught");
  assert.equal(
    await run("try:\n  raise ValueError('bad')\nexcept Exception as e:\n  msg = e['message']\nmsg"),
    "bad",
  );
  assert.deepEqual(await run("log = []\ntry:\n  log.append('t')\nfinally:\n  log.append('f')\nlog"), ["t", "f"]);
  assert.deepEqual(
    await run("log = []\ntry:\n  log.append('t')\nfinally:\n  log.append('f')\n''.join(log)"),
    "tf",
  );
});

test("builtins: len range enumerate zip sum min max sorted", async () => {
  assert.equal(await run("len([1, 2, 3])"), 3);
  assert.deepEqual(await run("list(range(3))"), [0, 1, 2]);
  assert.deepEqual(await run("[list(t) for t in enumerate(['a', 'b'])]"), [[0, "a"], [1, "b"]]);
  assert.deepEqual(await run("[list(t) for t in zip([1, 2], ['a', 'b'])]"), [[1, "a"], [2, "b"]]);
  assert.equal(await run("sum([1, 2, 3, 4])"), 10);
  assert.equal(await run("min([5, 2, 8])"), 2);
  assert.equal(await run("max([5, 2, 8])"), 8);
  assert.deepEqual(await run("sorted([3, 1, 2])"), [1, 2, 3]);
  assert.deepEqual(await run("sorted([3, 1, 2], reverse=True)"), [3, 2, 1]);
});

test("builtins: any all abs round map filter", async () => {
  assert.equal(await run("any([False, True])"), true);
  assert.equal(await run("all([True, False])"), false);
  assert.equal(await run("abs(-7)"), 7);
  assert.equal(await run("round(3.14159, 2)"), 3.14);
  assert.deepEqual(await run("list(map(lambda x: x * 2, [1, 2, 3]))"), [2, 4, 6]);
  assert.deepEqual(await run("list(filter(lambda x: x > 1, [1, 2, 3]))"), [2, 3]);
});

test("type converters and isinstance", async () => {
  assert.equal(await run("int('42')"), 42);
  assert.equal(await run("float('3.5')"), 3.5);
  assert.equal(await run("str(42)"), "42");
  assert.deepEqual(await run("list('abc')"), ["a", "b", "c"]);
  assert.equal(await run("isinstance([], list)"), true);
  assert.equal(await run("isinstance('x', str)"), true);
  assert.equal(await run("isinstance(1, int)"), true);
  assert.equal(await run("isinstance(1, str)"), false);
});

test("str methods", async () => {
  assert.equal(await run("'Hello'.upper()"), "HELLO");
  assert.equal(await run("'  hi  '.strip()"), "hi");
  assert.deepEqual(await run("'a,b,c'.split(',')"), ["a", "b", "c"]);
  assert.equal(await run("'-'.join(['a', 'b', 'c'])"), "a-b-c");
  assert.equal(await run("'hello'.replace('l', 'L')"), "heLLo");
  assert.equal(await run("'hello'.startswith('he')"), true);
  assert.equal(await run("'abcabc'.count('a')"), 2);
});

test("list methods mutate in place", async () => {
  assert.deepEqual(await run("xs = [1, 2]\nxs.append(3)\nxs"), [1, 2, 3]);
  assert.deepEqual(await run("xs = [3, 1, 2]\nxs.sort()\nxs"), [1, 2, 3]);
  assert.deepEqual(await run("xs = [3, 1, 2]\nxs.sort(key=lambda x: -x)\nxs"), [3, 2, 1]);
  assert.equal(await run("xs = [1, 2, 3]\nxs.pop()"), 3);
});

test("dict methods", async () => {
  assert.deepEqual(await run("{'a': 1, 'b': 2}.get('a')"), 1);
  assert.equal(await run("{'a': 1}.get('z', 'default')"), "default");
  assert.deepEqual(await run("list({'a': 1, 'b': 2}.keys())"), ["a", "b"]);
  assert.deepEqual(await run("list({'a': 1, 'b': 2}.values())"), [1, 2]);
  assert.deepEqual(await run("[list(t) for t in {'a': 1}.items()]"), [["a", 1]]);
});

test("dict rows support both p['k'] and p.k access", async () => {
  assert.equal(await run("p = {'count': 5}\np['count']"), 5);
  assert.equal(await run("p = {'count': 5}\np.count"), 5);
});
