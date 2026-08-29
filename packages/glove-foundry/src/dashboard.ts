import { DASHBOARD_SCRIPT } from "./dashboard-script.js";
import { renderGloveMark, renderPhosphorIcon } from "./dashboard-icons.js";
import { DASHBOARD_STYLES } from "./dashboard-styles.js";

const NAV_ICONS = {
  overview: renderPhosphorIcon("overview"),
  agents: renderPhosphorIcon("agent"),
  runs: renderPhosphorIcon("runs"),
  automations: renderPhosphorIcon("automations"),
  integrations: renderPhosphorIcon("integrations"),
  workspaces: renderPhosphorIcon("workspaces"),
} as const;

export function renderDashboard(): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <meta name="color-scheme" content="dark" />
  <title>Glove Foundry · Inspector</title>
  <style>${DASHBOARD_STYLES}</style>
</head>
<body>
  <div class="app">
    <aside class="sidebar" id="sidebar">
      <a class="brand" href="/" data-link>
        ${renderGloveMark()}
        <span><strong>Glove Foundry</strong><small>Runtime inspector</small></span>
      </a>
      <nav class="nav">
        <div class="nav-label">Inspect</div>
        <a href="/" data-link data-nav="overview"><span class="nav-icon">${NAV_ICONS.overview}</span>Overview</a>
        <a href="/agents" data-link data-nav="agents"><span class="nav-icon">${NAV_ICONS.agents}</span>Agents</a>
        <a href="/runs" data-link data-nav="runs"><span class="nav-icon">${NAV_ICONS.runs}</span>Runs</a>
        <a href="/automations" data-link data-nav="automations"><span class="nav-icon">${NAV_ICONS.automations}</span>Automations</a>
        <a href="/integrations" data-link data-nav="integrations"><span class="nav-icon">${NAV_ICONS.integrations}</span>Integrations</a>
        <a href="/workspaces" data-link data-nav="workspaces"><span class="nav-icon">${NAV_ICONS.workspaces}</span>Workspaces</a>
      </nav>
      <div class="sidebar-foot">
        <div class="runtime-state" id="runtime-state"><i></i><span>Connecting to runtime…</span></div>
        <button class="shortcut" id="open-search"><span class="shortcut-label">${renderPhosphorIcon("search")}Search Foundry</span><kbd>⌘K</kbd></button>
      </div>
    </aside>
    <section class="main">
      <header class="topbar">
        <button class="button icon-button mobile-toggle" id="mobile-toggle" aria-label="Open navigation">${renderPhosphorIcon("menu")}</button>
        <div class="breadcrumbs" id="breadcrumbs"></div>
        <div class="top-actions">
          <span class="live-chip"><i></i><span id="event-state">Live updates</span></span>
          <button class="button primary" id="new-run">${renderPhosphorIcon("plus")} <span>New run</span></button>
        </div>
      </header>
      <main class="content" id="content">
        <div class="empty"><strong>Opening the Foundry…</strong>Reading definitions, instances, and runtime activity.</div>
      </main>
    </section>
  </div>

  <div class="drawer-backdrop" id="drawer">
    <section class="drawer" role="dialog" aria-modal="true" aria-labelledby="drawer-title">
      <div class="drawer-head">
        <div><div class="eyebrow">Direct invocation</div><h2 id="drawer-title">Start a run</h2></div>
        <button class="icon-button" id="close-drawer" aria-label="Close">${renderPhosphorIcon("close")}</button>
      </div>
      <div id="run-form-error" class="form-error hidden"></div>
      <form id="run-form">
        <div class="field"><label for="run-definition">Agent definition</label><select id="run-definition"></select></div>
        <div class="field"><label for="run-instance">Runtime instance</label><select id="run-instance"></select><small class="muted">Choose “Create a new instance” to provision one.</small></div>
        <div class="field"><label for="run-message">Message</label><textarea id="run-message" required placeholder="What should this agent work on?"></textarea></div>
        <div class="drawer-actions"><button type="button" class="button" id="cancel-run">Cancel</button><button type="submit" class="button primary">Start run</button></div>
      </form>
    </section>
  </div>

  <div class="search-modal" id="search-modal">
    <div class="search-box" role="dialog" aria-modal="true">
      <div class="search-input-wrap">${renderPhosphorIcon("search")}<input id="search-input" aria-label="Search Foundry" placeholder="Search pages, agents, instances, and runs…" autocomplete="off" /></div>
      <div class="search-results" id="search-results"></div>
    </div>
  </div>
  <div class="toast" id="toast"></div>
  <script>${DASHBOARD_SCRIPT}</script>
</body>
</html>`;
}
