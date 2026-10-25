---
"glove-foundry": minor
---

Apps can be backed by an MCP server, the REPL sees installed apps as groups, and topology can live in a file.

- `defineApp({ mcp: { entry, auth, tools } })` mounts an MCP server's tools through the app. The connection opens with the installation's account: `auth(session)` turns the agent's `accountSessions` session into HTTP headers or stdio environment, so Foundry never holds the credential. `tools(tool, ctx)` returns `"allow"`, `"ask"` or `"hide"` for each tool. By default read-only tools run and everything else waits for approval. Connections close when the run ends. An app that connects with an account refuses an installation without one.
- `programmaticTools.select` receives `apps`: one group per installed app, its live tools named for code (`gmail.search_threads(...)`), grouped under the app and marked read-only where the server says so. `keepDirect: false` takes the selected tools out of the model's tool list, so they are reached only from code; a tool that needs approval always stays direct.
- `fileTopologyStore(file)` keeps routes and bindings in a JSON file, so topology an application writes at runtime survives a restart on one host. Use it in `defineApplication({ services })` with your account directory and `memoryEventStore`.
- Application connections find their account through the account directory, so accounts an application's own directory adds at runtime get their connections.
