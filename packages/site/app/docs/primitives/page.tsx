import Link from "next/link";
import { LayerStack } from "@/components/diagrams";
import { docsMetadata } from "@/lib/docs-nav";
import { layers, partsOf, primitivesOf, type Primitive } from "@/lib/primitives";

export const metadata = docsMetadata("/docs/primitives");

function Name({ primitive }: { primitive: Primitive }) {
  const external = primitive.href.startsWith("http");
  return external ? (
    <a href={primitive.href} target="_blank" rel="noopener noreferrer">{primitive.name}</a>
  ) : (
    <Link href={primitive.href}>{primitive.name}</Link>
  );
}

export default function PrimitivesPage() {
  return (
    <article className="docs-content">
      <h1>Primitives map</h1>
      <p className="blog-lede">
        Before you build something for an agent, look for it here. Every primitive
        Glove, Glove Foundry and Kuiper give you is on this page, grouped by the part of
        a harness it serves. The last column is what people write by hand when they
        don&apos;t know the primitive exists.
      </p>

      <div className="docs-note"><span className="docs-note-icon">◆</span><p>
        <strong>Reading the tables.</strong> Each row gives the smallest call that uses
        the primitive and its package. The name links to the docs. The same list is in{" "}
        <a href="/llms.txt"><code>/llms.txt</code></a> and in the{" "}
        <Link href="/docs/agent-skill">agent skills</Link>, so your coding agent sees
        it too. The parts and layers are explained in{" "}
        <Link href="/docs/first-principles">First principles</Link>.
      </p></div>

      <LayerStack caption="Jump to a part. Production (Kuiper) wraps the system (Foundry), which wraps the harness (Glove)." />

      {layers.map((layer) => (
        <div key={layer.id} className={`tone-${layer.id}`}>
          <h2 id={`layer-${layer.id}`}>
            {layer.name}: {layer.owner}
          </h2>
          <p>{layer.claim}</p>
          {partsOf(layer.id).map((part) => (
            <div key={part.id} className="prim-part">
              <div className="prim-part-head">
                <h3 id={part.id}>{part.name}</h3>
                <span className="prim-part-q">{part.question}</span>
                <span className="prim-layer-tag">{layer.owner}</span>
              </div>
              <p>{part.answer}</p>
              <table className="prim-table">
                <thead>
                  <tr><th>Primitive</th><th>What you get</th><th>Instead of building</th></tr>
                </thead>
                <tbody>
                  {primitivesOf(part.id).map((primitive) => (
                    <tr key={primitive.name}>
                      <td>
                        <Name primitive={primitive} />
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
            </div>
          ))}
        </div>
      ))}

      <h2 id="missing">Something missing?</h2>
      <p>
        If you are about to build something that isn&apos;t here, first check whether
        it is a tool (most things are), an adapter behind an interface Glove already
        has, or a mount on an existing agent. Those are the{" "}
        <Link href="/docs/first-principles#principles">rules every primitive follows</Link>,
        and a new piece usually fits one of them. If it really is new,{" "}
        <a href="https://github.com/porkytheblack/glove/issues">open an issue</a>:
        it may belong in Glove.
      </p>
    </article>
  );
}
