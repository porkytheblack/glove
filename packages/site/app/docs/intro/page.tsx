export default function IntroPage() {
  return (
    <div className="docs-content">
      <h1>What is Glove?</h1>

      <p>
        Glove is an open-source TypeScript framework for building AI-powered
        applications. Instead of wiring up pages, routes, and navigation
        manually, you describe what your app can do — and an AI figures out when
        to do it, based on what users ask for.
      </p>

      <h2>The core idea</h2>

      <p>
        Traditional apps encode user flows in UI: click this button, go to this
        page, fill out this form. Glove replaces that wiring with a
        conversation. The user says what they want, and an AI decides which
        capabilities to use.
      </p>

      <p>This means three things for you as a developer:</p>

      <ol>
        <li>You define capabilities (called <strong>tools</strong>)</li>
        <li>
          You define how results look (called <strong>renderers</strong>)
        </li>
        <li>
          The AI handles navigation, flow, and orchestration
        </li>
      </ol>

      <h2>Key terms</h2>

      <p>
        These are the building blocks of every Glove app. You&apos;ll see
        them throughout the docs:
      </p>

      <ul>
        <li>
          <strong>Agent</strong> &mdash; An AI that reads what the user
          asks for and decides which tools to call. Think of it as a smart
          coordinator that replaces your router and navigation logic.
        </li>
        <li>
          <strong>Tool</strong> &mdash; A single capability your app
          exposes. &ldquo;Search products,&rdquo; &ldquo;get weather,&rdquo;
          &ldquo;submit order&rdquo; are all tools. Each has a name (so the AI
          knows what it does), an input schema (so inputs are validated), and
          a function that runs when called.
        </li>
        <li>
          <strong>Display stack</strong> &mdash; A stack of UI components
          that tools push onto. When a tool runs, it can show the user a
          product grid, a form, a confirmation dialog — anything.
        </li>
        <li>
          <strong>pushAndWait</strong> &mdash; Push a UI component and
          pause the tool until the user responds. Used for forms,
          confirmations, and choices where the tool needs user input before
          continuing.
        </li>
        <li>
          <strong>pushAndForget</strong> &mdash; Push a UI component but
          keep the tool running. Used for displaying data, status updates, and
          results where the tool doesn&apos;t need to wait.
        </li>
        <li>
          <strong>Renderer</strong> &mdash; A React component that
          renders one entry on the display stack. You define it alongside the
          tool, so the tool and its UI live together.
        </li>
        <li>
          <strong>Adapter</strong> &mdash; A pluggable interface. Glove
          uses adapters for the AI model, data storage, UI state, and event
          observation. Swap OpenAI for Anthropic (or anything else) without
          changing your app code.
        </li>
      </ul>

      <h2>How it works</h2>

      <ol>
        <li>
          A user sends a message (like &ldquo;Find me running shoes under
          $100&rdquo;)
        </li>
        <li>
          The AI reads your list of tools and picks the right ones to call
        </li>
        <li>
          Tools execute &mdash; searching a database, calling an API, computing
          a result
        </li>
        <li>
          Tools can push UI onto the display stack &mdash; product grids,
          forms, confirmation dialogs
        </li>
        <li>
          The AI reads tool results and either responds to the user or calls
          more tools
        </li>
        <li>This loop continues until the user&apos;s request is fulfilled</li>
      </ol>

      <h2>What can you build?</h2>

      <ul>
        <li>
          <strong>Shopping assistant</strong> &mdash; tools for product search,
          cart management, checkout with payment confirmation
        </li>
        <li>
          <strong>Customer support bot</strong> &mdash; tools for searching
          docs, creating tickets, escalating to humans
        </li>
        <li>
          <strong>Internal dashboard</strong> &mdash; tools for querying
          databases, generating reports, running scripts with approval
        </li>
        <li>
          <strong>Onboarding flow</strong> &mdash; tools for collecting user
          info, setting preferences, configuring accounts
        </li>
      </ul>

      <h2>Which packages do I need?</h2>

      <ul>
        <li>
          <code>@glove/react</code> &mdash; React hooks and components.{" "}
          <strong>Start here</strong> if you&apos;re building a React/Next.js
          app. Includes <code>@glove/core</code> as a dependency.
        </li>
        <li>
          <code>@glove/next</code> &mdash; One-line server handler for
          Next.js API routes. Connects to OpenAI, Anthropic, and{" "}
          <a href="/docs/next#supported-providers">other providers</a>.
        </li>
        <li>
          <code>@glove/core</code> &mdash; The runtime engine. Agent loop,
          tool execution, display manager. You rarely import this directly
          &mdash; <code>@glove/react</code> re-exports what you need.
        </li>
      </ul>

      <p>
        <strong>Most projects need just two packages:</strong>{" "}
        <code>@glove/react</code> and <code>@glove/next</code>.
      </p>

      <h2>Ready to build?</h2>

      <p>
        <a href="/docs/getting-started">
          Get Started — build a working agent in 15 minutes &rarr;
        </a>
      </p>
    </div>
  );
}
