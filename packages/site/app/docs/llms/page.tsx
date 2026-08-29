import { CodeBlock } from "@/components/code-block";

export const metadata = {
  title: "Glove for LLMs",
  description:
    "llms.txt, llms-full.txt and the agent skill — how to give a coding model accurate knowledge of Glove.",
};

export default function LlmsPage() {
  return (
    <div className="docs-content">
      <h1>Glove for LLMs</h1>

      <p>
        Most Glove code is now written with a model in the loop, and a model
        that has to guess an API writes plausible code that does not run. This
        page is the set of machine-readable surfaces that stop it guessing.
      </p>

      <table>
        <thead>
          <tr>
            <th>Surface</th>
            <th>What it is</th>
            <th>Size</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>
              <a href="/llms.txt">/llms.txt</a>
            </td>
            <td>
              The index — every docs page with a one-line summary and the
              packages it covers
            </td>
            <td>Small; fits in any context</td>
          </tr>
          <tr>
            <td>
              <a href="/llms-full.txt">/llms-full.txt</a>
            </td>
            <td>
              The condensed reference — mental model, install, every package
              with correct minimal usage, and the gotchas
            </td>
            <td>One long file</td>
          </tr>
          <tr>
            <td>
              <a href="/docs/agent-skill">Agent skill</a>
            </td>
            <td>
              An installable skill for Claude Code and compatible agents —
              architecture, API reference, patterns from the examples
            </td>
            <td>Loaded on demand</td>
          </tr>
          <tr>
            <td><a href="/foundry/llms.txt">/foundry/llms.txt</a></td>
            <td>The Foundry-only handbook index: definitions, instances, apps, playbooks, schedules, workspaces, runtime, and deployment</td>
            <td>Small; Foundry-specific</td>
          </tr>
          <tr>
            <td><a href="/foundry/llms-full.txt">/foundry/llms-full.txt</a></td>
            <td>A self-contained coding reference for building and operating a Foundry project</td>
            <td>One focused file</td>
          </tr>
        </tbody>
      </table>

      <h2 id="llms-txt">llms.txt</h2>

      <p>
        <a href="https://llmstxt.org" target="_blank" rel="noopener noreferrer">
          llms.txt
        </a>{" "}
        is a convention for giving language models a curated map of a site
        instead of leaving them to crawl it. Ours is generated from the same
        navigation tree the sidebar renders, so it can never drift from the
        docs: adding a page adds a line.
      </p>

      <CodeBlock
        filename="terminal"
        language="bash"
        code={`curl https://glove.dterminal.net/llms.txt`}
      />

      <CodeBlock
        filename="llms.txt (excerpt)"
        language="markdown"
        code={`# Glove

> Glove is an open-source TypeScript framework for AI-powered applications.
> You define capabilities as tools; an agent decides when to call them. …

## Start Here

What Glove is, how to install it, and a tour of every package.

- [What is Glove?](https://glove.dterminal.net/docs/intro): The idea behind Glove…
- [Installation](https://glove.dterminal.net/docs/installation): Which packages…
  [glove-core, glove-react, glove-next]`}
      />

      <h2 id="llms-full-txt">llms-full.txt</h2>

      <p>
        The index tells a model <em>where</em> things are;{" "}
        <a href="/llms-full.txt">llms-full.txt</a> tells it{" "}
        <em>how the APIs actually work</em>. It is a single hand-written file
        covering the mental model, installation, the server-side and full-stack
        shapes, the display stack, every provider, and the smallest correct
        snippet for each capability package — ending with the mistakes models
        most often make against this framework.
      </p>

      <p>
        Paste it into a system prompt, attach it to a project, or fetch it in a
        tool call:
      </p>

      <CodeBlock
        filename="terminal"
        language="bash"
        code={`# Claude Code, Cursor, or anything that reads a file into context
curl -o glove.md https://glove.dterminal.net/llms-full.txt`}
      />

      <h2 id="foundry-for-llms">Foundry for LLMs</h2>

      <p>
        Foundry has a separate pair of machine surfaces because its definition/instance
        boundary and runtime data model must not be collapsed into the lower-level Glove
        builder API. Give a coding agent the focused reference when it is editing a
        Foundry project:
      </p>

      <CodeBlock filename="terminal" language="bash" code={`curl -o glove-foundry.md \\
  https://glove.dterminal.net/foundry/llms-full.txt`} />

      <h2 id="agent-skill">The agent skill</h2>

      <p>
        For Claude Code specifically, the repo ships an{" "}
        <a href="https://agentskills.io" target="_blank" rel="noopener noreferrer">
          Agent Skill
        </a>{" "}
        that loads on demand when you work with Glove code — deeper than a
        pasted file, and it stays out of context until it is relevant.
      </p>

      <CodeBlock
        filename="terminal"
        language="bash"
        code={`npx skills add porkytheblack/glove -a claude-code

# or globally, available in every project
npx skills add porkytheblack/glove -a claude-code -g`}
      />

      <p>
        Once installed it activates automatically, or you can invoke it directly
        with <code>/glove</code>. Details and the manual install path are on the{" "}
        <a href="/docs/agent-skill">Agent Skill</a> page.
      </p>

      <h2 id="tips">Getting good code out of a model</h2>

      <ul>
        <li>
          <strong>Name the package.</strong> &ldquo;Use{" "}
          <code>glove-scratchpad</code>&rdquo; beats &ldquo;expose these tools
          efficiently&rdquo; — the surfaces are similar enough that a model will
          otherwise blend them.
        </li>
        <li>
          <strong>Say which shape you are in.</strong> Server-only (
          <code>glove-core</code>) and full-stack (<code>glove-react</code> +{" "}
          <code>glove-next</code>) have different entry points; a model told
          neither will mix them.
        </li>
        <li>
          <strong>Give it the version.</strong> Package versions are on{" "}
          <a href="/docs/packages">All Packages</a>; APIs across the 0.x
          packages still move.
        </li>
        <li>
          <strong>Point at an example.</strong> The{" "}
          <a href="/docs/showcase/travel-planner">showcase</a> pages are
          complete applications, and every one of them exists as runnable code
          in the repo.
        </li>
      </ul>
    </div>
  );
}
