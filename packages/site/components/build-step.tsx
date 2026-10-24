// Chrome for the "Build it up" guide (/docs/build/*): the step kicker, the
// "already built for you" table drawn from lib/primitives.ts, and the ladder
// that shows where the reader is.

import Link from "next/link";
import { BuildLadder, buildSteps } from "@/components/diagrams";
import { primitivesOf, type PartId } from "@/lib/primitives";

export function StepKicker({ href }: { href: string }) {
  const index = buildSteps.findIndex((step) => step.href === href);
  return (
    <span className="foundry-doc-kicker">
      Build it up · Step {index + 1} of {buildSteps.length}
    </span>
  );
}

/** Every primitive for the given parts, from the catalogue. */
export function AlreadyBuilt({ parts }: { parts: PartId[] }) {
  const rows = parts.flatMap((part) => primitivesOf(part));
  return (
    <table className="prim-table">
      <thead>
        <tr><th>Primitive</th><th>What you get</th><th>Instead of building</th></tr>
      </thead>
      <tbody>
        {rows.map((primitive) => (
          <tr key={primitive.name}>
            <td>
              {primitive.href.startsWith("http") ? (
                <a href={primitive.href} target="_blank" rel="noopener noreferrer">{primitive.name}</a>
              ) : (
                <Link href={primitive.href}>{primitive.name}</Link>
              )}
              <span className="prim-pkg">{primitive.pkg}</span>
            </td>
            <td>
              {primitive.gives}
              <span className="prim-api"><code>{primitive.api}</code></span>
            </td>
            <td>{primitive.insteadOf}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function StepPath({ href }: { href: string }) {
  return (
    <>
      <h2 id="the-path">The whole path</h2>
      <BuildLadder current={href} />
    </>
  );
}
