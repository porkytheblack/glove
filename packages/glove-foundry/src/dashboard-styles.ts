export const DASHBOARD_STYLES = String.raw`
:root{
  --bg:#080B0A;--bg-elevated:#0F1613;--bg-surface:#141D18;--bg-surface-2:#19241F;
  --border:#243029;--border-subtle:#18211C;--border-strong:#32453B;
  --text-primary:#E7EEEA;--text-secondary:#93A399;--text-tertiary:#5C6F64;
  --accent:#9ED4B8;--accent-soft:#7BBFA0;--accent-strong:#BEE7D0;
  --accent-dim:rgba(158,212,184,.08);--accent-glow:rgba(158,212,184,.045);--accent-line:rgba(158,212,184,.16);
  --interface:#E4B879;--network:#83B3E2;--deploy:#B8A7E8;--media:#E29BA8;
  --success:#8CC494;--warn:#E4B879;--danger:#E29BA8;
  --sans:'DM Sans','Inter',-apple-system,BlinkMacSystemFont,'Segoe UI','Helvetica Neue',Arial,sans-serif;
  --mono:'JetBrains Mono','SF Mono',ui-monospace,SFMono-Regular,Menlo,Consolas,'Liberation Mono',monospace;
  --sidebar:248px;--radius:10px;--radius-lg:14px;--shadow:0 24px 64px rgba(0,0,0,.34);
  font-family:var(--sans);color:var(--text-primary);background:var(--bg);color-scheme:dark;
}
*{box-sizing:border-box}html,body{margin:0;min-height:100%;background:var(--bg)}html{scroll-behavior:smooth}body{font-family:var(--sans);color:var(--text-primary);-webkit-font-smoothing:antialiased;overflow-x:hidden}
body:before{content:"";position:fixed;inset:0 0 auto 0;height:100vh;background:radial-gradient(60% 40% at 55% -5%,rgba(158,212,184,.06),transparent 70%);pointer-events:none;z-index:0}
button,input,textarea,select{font:inherit;color:inherit}button,a{touch-action:manipulation}button:focus-visible,a:focus-visible,input:focus-visible,textarea:focus-visible,select:focus-visible{outline:2px solid var(--accent-soft);outline-offset:2px;border-radius:5px}
::selection{background:rgba(158,212,184,.22);color:var(--text-primary)}.mono{font-family:var(--mono)}.muted{color:var(--text-secondary)}.hidden{display:none!important}
.icon{display:block;width:1em;height:1em;flex:0 0 auto;fill:currentColor}.icon-button{padding:8px;aspect-ratio:1}.icon-button .icon{width:17px;height:17px}
.app{min-height:100vh;position:relative;z-index:1}.sidebar{position:fixed;inset:0 auto 0 0;width:var(--sidebar);background:rgba(8,11,10,.92);backdrop-filter:blur(20px) saturate(140%);border-right:1px solid var(--border-subtle);z-index:20;display:flex;flex-direction:column}
.brand{height:72px;display:flex;align-items:center;gap:11px;padding:0 20px;border-bottom:1px solid var(--border-subtle);color:inherit;text-decoration:none}.brand-mark{width:26px;height:26px;color:var(--accent);filter:drop-shadow(0 3px 12px rgba(158,212,184,.2));transition:transform .25s ease}.brand:hover .brand-mark{transform:rotate(-7deg) scale(1.05)}.brand strong{display:block;font-size:14px;font-weight:600;letter-spacing:-.015em}.brand small{display:block;color:var(--text-tertiary);font:9px/1.4 var(--mono);text-transform:uppercase;letter-spacing:.13em;margin-top:3px}
.nav{padding:20px 12px}.nav-label{padding:0 11px 9px;color:var(--text-tertiary);font:9px var(--mono);text-transform:uppercase;letter-spacing:.15em}.nav a{position:relative;color:var(--text-secondary);text-decoration:none;display:flex;align-items:center;gap:11px;padding:9px 11px;border-radius:7px;margin:2px 0;font-size:13px;transition:color .18s,background .18s}.nav a:hover{background:var(--accent-glow);color:var(--text-primary)}.nav a.active{background:var(--accent-dim);color:var(--accent)}.nav a.active:before{content:"";position:absolute;left:-12px;width:2px;height:22px;background:var(--accent)}.nav-icon{width:18px;height:18px;color:var(--text-tertiary);display:grid;place-items:center}.nav-icon svg{width:17px;height:17px;fill:currentColor}.nav a.active .nav-icon{color:var(--accent)}
.sidebar-foot{margin-top:auto;padding:18px;border-top:1px solid var(--border-subtle)}.runtime-state{display:flex;align-items:center;gap:9px;font-size:11px;color:var(--text-secondary)}.runtime-state i{width:7px;height:7px;border-radius:50%;background:var(--success);box-shadow:0 0 8px rgba(140,196,148,.55)}.runtime-state.bad i{background:var(--danger)}.shortcut{margin-top:12px;width:100%;border:1px solid var(--border);background:var(--bg-elevated);color:var(--text-secondary);border-radius:7px;padding:8px 10px;text-align:left;font-size:11px;cursor:pointer;display:flex;align-items:center;justify-content:space-between}.shortcut:hover{border-color:var(--border-strong);color:var(--text-primary)}.shortcut-label{display:flex;align-items:center;gap:7px}.shortcut-label .icon{width:14px;height:14px}.shortcut kbd{color:var(--text-tertiary);font:9px var(--mono);border:0;background:transparent;padding:0}
.main{margin-left:var(--sidebar);min-height:100vh}.topbar{height:72px;background:rgba(8,11,10,.72);backdrop-filter:blur(20px) saturate(140%);border-bottom:1px solid var(--border-subtle);display:flex;align-items:center;padding:0 32px;position:sticky;top:0;z-index:10}.breadcrumbs{display:flex;align-items:center;gap:8px;font:11px var(--mono);color:var(--text-tertiary)}.breadcrumbs a{color:var(--text-tertiary);text-decoration:none}.breadcrumbs a:hover{color:var(--accent)}.crumb-separator{display:grid;place-items:center;color:var(--text-tertiary)}.crumb-separator .icon{width:10px;height:10px}.top-actions{margin-left:auto;display:flex;align-items:center;gap:9px}.live-chip{display:flex;align-items:center;gap:7px;border:1px solid var(--border);background:var(--bg-elevated);padding:8px 10px;border-radius:7px;font:9px var(--mono);text-transform:uppercase;letter-spacing:.07em;color:var(--text-secondary)}.live-chip i{width:6px;height:6px;border-radius:50%;background:var(--success);box-shadow:0 0 8px rgba(140,196,148,.45)}
.button{border:1px solid var(--border);background:var(--bg-elevated);color:var(--text-secondary);border-radius:7px;padding:9px 13px;font-weight:500;font-size:12px;cursor:pointer;text-decoration:none;display:inline-flex;align-items:center;justify-content:center;gap:7px;transition:border-color .18s,background .18s,color .18s,transform .18s}.button>.icon{width:15px;height:15px}.button:hover{border-color:var(--border-strong);background:var(--bg-surface);color:var(--text-primary)}.button.primary{border-color:var(--accent);background:var(--accent);color:var(--bg);font-weight:600;box-shadow:0 2px 18px rgba(158,212,184,.12)}.button.primary:hover{background:var(--accent-strong);transform:translateY(-1px)}.mobile-toggle{display:none}.content{max-width:1480px;margin:0 auto;padding:36px 36px 72px;position:relative}
.content:before{content:"";position:absolute;inset:0;z-index:-1;pointer-events:none;background-image:linear-gradient(var(--border-subtle) 1px,transparent 1px),linear-gradient(90deg,var(--border-subtle) 1px,transparent 1px);background-size:56px 56px;mask-image:linear-gradient(to bottom,rgba(0,0,0,.25),transparent 300px);opacity:.34}
.page-head{display:flex;align-items:flex-end;gap:24px;margin-bottom:28px}.eyebrow{display:flex;align-items:center;gap:8px;font:10px var(--mono);color:var(--accent-soft);text-transform:uppercase;letter-spacing:.14em;margin-bottom:12px}.eyebrow:before{content:"";width:18px;height:1px;background:var(--accent-line)}.page-head h1{font-size:34px;font-weight:400;line-height:1.08;letter-spacing:-.035em;margin:0}.page-head p{margin:9px 0 0;color:var(--text-secondary);max-width:690px;font-size:14px;font-weight:300;line-height:1.6}.page-head .actions{margin-left:auto;display:flex;gap:8px;align-items:center}.page-rule{width:42px;height:2px;background:var(--accent);margin-bottom:16px}
.grid{display:grid;gap:14px}.cols-4{grid-template-columns:repeat(4,1fr)}.cols-3{grid-template-columns:repeat(3,1fr)}.cols-2{grid-template-columns:repeat(2,1fr)}.span-2{grid-column:span 2}.card{background:rgba(15,22,19,.92);border:1px solid var(--border-subtle);border-radius:var(--radius);min-width:0;margin-bottom:14px;overflow:hidden}.card-head{padding:14px 16px;border-bottom:1px solid var(--border-subtle);display:flex;align-items:center;gap:12px;background:rgba(20,29,24,.3)}.card-head h2{font-size:13px;font-weight:500;margin:0}.card-head .meta{margin-left:auto;color:var(--text-tertiary);font:9px var(--mono)}.card-body{padding:16px}.metric{padding:18px;min-height:124px;margin-bottom:0}.metric label{display:block;color:var(--text-tertiary);font:9px var(--mono);text-transform:uppercase;letter-spacing:.12em}.metric strong{display:block;font-size:30px;font-weight:400;letter-spacing:-.035em;margin-top:15px}.metric small{display:block;color:var(--text-secondary);font-size:11px;font-weight:300;margin-top:6px}.metric.accent{border-top:2px solid var(--accent)}
.table-wrap{overflow:auto}.table{width:100%;border-collapse:collapse;min-width:650px}.table th{padding:11px 15px;text-align:left;color:var(--text-tertiary);font:9px var(--mono);text-transform:uppercase;letter-spacing:.1em;border-bottom:1px solid var(--border-subtle);white-space:nowrap}.table td{padding:13px 15px;border-bottom:1px solid var(--border-subtle);font-size:12px;vertical-align:top}.table tr:last-child td{border-bottom:0}.table tbody tr.clickable{cursor:pointer}.table tbody tr.clickable:hover{background:var(--accent-glow)}.primary-cell{font-weight:500;color:var(--text-primary)}.secondary{display:block;color:var(--text-tertiary);font:9px/1.55 var(--mono);margin-top:4px;overflow-wrap:anywhere}
.status{display:inline-flex;align-items:center;gap:6px;border-radius:999px;padding:4px 8px;background:var(--bg-surface-2);color:var(--text-secondary);font:8px var(--mono);text-transform:uppercase;letter-spacing:.06em;white-space:nowrap;border:1px solid var(--border)}.status:before{content:"";width:5px;height:5px;border-radius:50%;background:var(--text-tertiary)}.status.completed,.status.connected,.status.active,.status.enabled,.status.resolved{background:rgba(140,196,148,.08);color:var(--success);border-color:rgba(140,196,148,.18)}.status.completed:before,.status.connected:before,.status.active:before,.status.enabled:before,.status.resolved:before{background:var(--success)}.status.running,.status.pending,.status.connecting,.status.reconnecting,.status.in-progress{background:rgba(131,179,226,.08);color:var(--network);border-color:rgba(131,179,226,.18)}.status.running:before,.status.pending:before,.status.connecting:before,.status.reconnecting:before,.status.in-progress:before{background:var(--network)}.status.failed,.status.cancelled,.status.disconnected,.status.dismissed{background:rgba(226,155,168,.08);color:var(--danger);border-color:rgba(226,155,168,.18)}.status.failed:before,.status.cancelled:before,.status.disconnected:before,.status.dismissed:before{background:var(--danger)}
.tag{display:inline-block;border:1px solid var(--border);border-radius:4px;padding:3px 6px;font:8px var(--mono);color:var(--text-secondary);margin:2px 4px 2px 0;background:var(--bg-surface)}.link{color:var(--accent);text-decoration:none;font-weight:500}.link:hover{text-decoration:underline;text-decoration-color:var(--accent-line)}.inline-icon{display:inline-flex;align-items:center;gap:5px}.inline-icon .icon{width:12px;height:12px}.empty{padding:38px 22px;text-align:center;color:var(--text-secondary);font-size:12px;line-height:1.6}.empty strong{display:block;color:var(--text-primary);font-size:14px;font-weight:500;margin-bottom:5px}.filters{display:flex;gap:8px;margin-bottom:14px}.filters input,.filters select{background:var(--bg-elevated);border:1px solid var(--border);border-radius:7px;padding:10px 12px;font-size:12px}.filters input{min-width:280px}
.definition-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px;margin-bottom:16px}.definition-card{display:block;color:inherit;text-decoration:none;background:var(--bg-elevated);border:1px solid var(--border-subtle);border-radius:var(--radius-lg);padding:19px;min-height:196px;position:relative;overflow:hidden;transition:transform .2s ease,border-color .2s ease,background .2s}.definition-card:before{content:"";position:absolute;inset:0;opacity:0;background:radial-gradient(110% 80% at 100% 0%,var(--accent-dim),transparent 60%);transition:opacity .2s}.definition-card:hover{transform:translateY(-2px);border-color:var(--accent-line);background:var(--bg-surface)}.definition-card:hover:before{opacity:1}.definition-icon{width:31px;height:31px;display:grid;place-items:center;border:1px solid var(--accent-line);border-radius:8px;color:var(--accent);background:var(--accent-dim);margin-bottom:15px;position:relative}.definition-icon .icon{width:17px;height:17px}.definition-open{position:absolute;right:17px;top:17px;color:var(--text-tertiary);transition:color .18s,transform .18s}.definition-open .icon{width:14px;height:14px}.definition-card:hover .definition-open{color:var(--accent);transform:translate(1px,-1px)}.definition-card h3{margin:0;font-size:17px;font-weight:500;position:relative}.definition-card p{color:var(--text-secondary);font-size:12px;font-weight:300;line-height:1.6;margin:9px 0 18px;position:relative}.definition-meta{position:absolute;left:19px;right:19px;bottom:17px;display:flex;justify-content:space-between;align-items:end}.definition-meta b{font:9px var(--mono);color:var(--accent-soft)}
.cap-list{display:flex;flex-wrap:wrap;gap:6px}.cap{border:1px solid var(--border);background:var(--bg-surface);border-radius:5px;padding:7px 9px;font:9px var(--mono);margin-bottom:6px;color:var(--text-secondary)}.detail-strip{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));border:1px solid var(--border-subtle);border-radius:var(--radius);background:var(--bg-elevated);margin-bottom:14px;overflow:hidden}.detail-strip>div{padding:15px;border-right:1px solid var(--border-subtle);min-width:0}.detail-strip>div:last-child{border-right:0}.detail-strip label{display:block;color:var(--text-tertiary);font:8px var(--mono);text-transform:uppercase;letter-spacing:.1em}.detail-strip strong{display:block;margin-top:8px;font-size:12px;font-weight:500;overflow-wrap:anywhere}.json{margin:0;background:#070A09;color:var(--text-secondary);border:1px solid var(--border-subtle);border-radius:7px;padding:14px;font:9px/1.65 var(--mono);white-space:pre-wrap;overflow:auto;max-height:360px}.summary-box{font-size:12px;line-height:1.65;overflow-wrap:anywhere}.summary-box dl{display:grid;grid-template-columns:130px 1fr;gap:9px 14px;margin:0}.summary-box dt{color:var(--text-tertiary);font:8px var(--mono);text-transform:uppercase;letter-spacing:.08em}.summary-box dd{margin:0;color:var(--text-secondary)}
.run-spine{position:relative;padding:4px 0}.run-spine:before{content:"";position:absolute;left:19px;top:14px;bottom:14px;width:1px;background:var(--border)}.phase{position:relative;display:grid;grid-template-columns:40px 1fr auto;gap:12px;padding:11px 4px}.phase-dot{width:12px;height:12px;border-radius:50%;background:var(--bg-elevated);border:2px solid var(--text-tertiary);margin:2px 0 0 13px;z-index:1}.phase.complete .phase-dot{border-color:var(--success);box-shadow:0 0 8px rgba(140,196,148,.2)}.phase.active .phase-dot{border-color:var(--network);box-shadow:0 0 0 5px rgba(131,179,226,.09)}.phase.error .phase-dot{border-color:var(--danger)}.phase strong{font-size:12px;font-weight:500}.phase p{margin:4px 0 0;color:var(--text-secondary);font-size:11px;font-weight:300;line-height:1.5}.phase time{font:8px var(--mono);color:var(--text-tertiary)}
.event-row{border-top:1px solid var(--border-subtle)}.event-toggle{width:100%;border:0;background:transparent;padding:12px 15px;display:grid;grid-template-columns:82px 110px minmax(0,1fr) auto;gap:11px;text-align:left;align-items:center;cursor:pointer}.event-toggle:hover,.event-row.open .event-toggle{background:var(--accent-glow)}.event-time,.event-category{font:8px var(--mono);color:var(--text-tertiary)}.event-type{font:9px var(--mono);overflow:hidden;text-overflow:ellipsis}.event-detail{display:none;padding:0 15px 14px}.event-row.open .event-detail{display:block}.trace-note{border-left:2px solid var(--accent);padding:10px 12px;background:var(--accent-dim);font-size:11px;line-height:1.5;color:var(--text-secondary);margin-bottom:14px}
.workspace-tabs{display:flex;gap:2px;border-bottom:1px solid var(--border-subtle);margin:20px 0 14px}.workspace-tabs button{border:0;background:transparent;padding:11px 13px;color:var(--text-secondary);font-size:11px;cursor:pointer;border-bottom:2px solid transparent}.workspace-tabs button.active{color:var(--accent);border-color:var(--accent);font-weight:500}.kv{display:grid;grid-template-columns:repeat(3,1fr);gap:10px}.kv-item{border:1px solid var(--border-subtle);border-radius:7px;padding:13px;background:var(--bg-surface)}.kv-item strong{font:10px var(--mono)}.kv-item small{display:block;color:var(--text-tertiary);margin-top:6px}.kv-value{margin-top:12px;color:var(--text-secondary);font-size:11px;line-height:1.5;overflow-wrap:anywhere}.callout{border:1px solid var(--accent-line);background:var(--accent-glow);border-radius:8px;padding:15px 17px;display:flex;align-items:flex-start;gap:12px;margin-bottom:14px}.callout b{font-size:12px;font-weight:500}.callout p{margin:4px 0 0;color:var(--text-secondary);font-size:11px;line-height:1.5}.callout .symbol{width:31px;height:31px;display:grid;place-items:center;flex:0 0 auto;border:1px solid var(--accent-line);border-radius:7px;color:var(--accent);background:var(--accent-dim)}.callout .symbol .icon{width:16px;height:16px}
.drawer-backdrop{position:fixed;inset:0;background:rgba(0,0,0,.62);backdrop-filter:blur(3px);z-index:40;display:none}.drawer-backdrop.open{display:block}.drawer{position:absolute;right:0;top:0;bottom:0;width:min(520px,100%);background:var(--bg-elevated);border-left:1px solid var(--border);box-shadow:-20px 0 60px rgba(0,0,0,.35);padding:26px;overflow:auto}.drawer-head{display:flex;align-items:flex-start;margin-bottom:28px}.drawer h2{margin:0;font-size:23px;font-weight:400;letter-spacing:-.025em}.drawer-head button{margin-left:auto;border:0;background:transparent;color:var(--text-secondary);cursor:pointer}.drawer-head button:hover{color:var(--text-primary);background:var(--bg-surface)}.field{margin-bottom:17px}.field label{display:block;font:8px var(--mono);text-transform:uppercase;letter-spacing:.12em;color:var(--text-tertiary);margin-bottom:7px}.field input,.field textarea,.field select{width:100%;border:1px solid var(--border);background:var(--bg);border-radius:7px;padding:11px 12px;font-size:12px}.field textarea{min-height:120px;resize:vertical}.form-error{background:rgba(226,155,168,.08);color:var(--danger);border:1px solid rgba(226,155,168,.18);border-radius:7px;padding:10px 12px;font-size:11px;margin-bottom:13px}.drawer-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:22px}
.search-modal{position:fixed;inset:0;background:rgba(0,0,0,.64);backdrop-filter:blur(4px);z-index:50;display:none;padding:12vh 20px}.search-modal.open{display:block}.search-box{max-width:650px;margin:auto;background:var(--bg-elevated);border:1px solid var(--border);border-radius:10px;box-shadow:var(--shadow);overflow:hidden}.search-input-wrap{display:flex;align-items:center;gap:12px;padding:0 20px;border-bottom:1px solid var(--border);color:var(--text-tertiary)}.search-input-wrap>.icon{width:19px;height:19px}.search-box input{width:100%;border:0;background:var(--bg-elevated);padding:18px 0;font-size:15px}.search-results{max-height:420px;overflow:auto;padding:8px}.search-result{display:block;padding:11px 12px;border-radius:6px;text-decoration:none;color:inherit}.search-result:hover{background:var(--accent-glow)}.search-result strong{font-size:12px;font-weight:500}.search-result small{display:block;color:var(--text-tertiary);margin-top:3px}.toast{position:fixed;right:24px;bottom:24px;background:var(--accent);color:var(--bg);border-radius:7px;padding:12px 15px;font-size:11px;font-weight:600;box-shadow:var(--shadow);z-index:60;transform:translateY(20px);opacity:0;pointer-events:none;transition:.2s}.toast.show{transform:none;opacity:1}
@media(max-width:1100px){.cols-4{grid-template-columns:repeat(2,1fr)}.definition-grid{grid-template-columns:repeat(2,1fr)}.cols-3{grid-template-columns:1fr 1fr}}
@media(max-width:760px){:root{--sidebar:0px}.sidebar{transform:translateX(-248px);width:248px;transition:transform .2s ease}.sidebar.open{transform:none}.mobile-toggle{display:inline-flex}.topbar{padding:0 16px}.live-chip{display:none}.content{padding:24px 16px 55px}.page-head{display:block}.page-head .actions{margin:18px 0 0}.cols-4,.cols-3,.cols-2,.definition-grid,.kv{grid-template-columns:1fr}.span-2{grid-column:auto}.detail-strip{display:block}.detail-strip>div{border-right:0;border-bottom:1px solid var(--border-subtle)}.filters{flex-wrap:wrap}.filters input{min-width:100%;width:100%}.event-toggle{grid-template-columns:70px 90px 1fr}.event-toggle span:last-child{display:none}.top-actions .button.primary span{display:none}}

/* ---- Elapsed time and duration ---- */
.rel{color:var(--text-secondary);white-space:nowrap;font-variant-numeric:tabular-nums;cursor:help;border-bottom:1px dotted var(--border-strong)}
.dur{font-family:var(--mono);font-size:10px;color:var(--text-secondary);white-space:nowrap;font-variant-numeric:tabular-nums}
.dur.live{color:var(--accent);position:relative;padding-left:12px}
.dur.live:before{content:"";position:absolute;left:0;top:50%;transform:translateY(-50%);width:5px;height:5px;border-radius:50%;background:var(--accent);animation:pulse-dot 1.6s ease-in-out infinite}
@keyframes pulse-dot{0%,100%{opacity:1;box-shadow:0 0 0 0 var(--accent-line)}50%{opacity:.45;box-shadow:0 0 0 4px transparent}}
.attempts{font-family:var(--mono);font-size:10px;color:var(--text-tertiary);font-variant-numeric:tabular-nums}
.attempts.warn{color:var(--warn)}

/* ---- Copyable identifiers ---- */
.id-cell{display:inline-flex;align-items:center;gap:5px;min-width:0}
.id-cell .mono{font-family:var(--mono);font-size:11px;color:var(--text-primary);overflow:hidden;text-overflow:ellipsis}
.copy-btn{border:0;background:transparent;color:var(--text-tertiary);padding:3px;border-radius:5px;cursor:pointer;display:inline-flex;align-items:center;opacity:0;transition:opacity .14s,color .14s,background .14s}
.copy-btn .icon{width:12px;height:12px}
.copy-btn .copy-ok{display:none}
tr:hover .copy-btn,.id-cell:hover .copy-btn,.copy-btn:focus-visible{opacity:1}
.copy-btn:hover{color:var(--accent);background:var(--accent-dim)}
.copy-btn.copied{opacity:1;color:var(--success)}
.copy-btn.copied .icon{display:none}
.copy-btn.copied .copy-ok{display:block}
.button .icon{width:13px;height:13px}

/* ---- Filter toolbar ---- */
.toolbar{display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:14px}
.toolbar-right{display:flex;align-items:center;gap:8px;margin-left:auto;flex-wrap:wrap}
.segmented{display:inline-flex;background:var(--bg-elevated);border:1px solid var(--border-subtle);border-radius:8px;padding:3px;gap:2px;overflow:auto}
.segmented button{border:0;background:transparent;color:var(--text-secondary);font-size:11px;font-weight:500;padding:6px 10px;border-radius:6px;cursor:pointer;display:inline-flex;align-items:center;gap:6px;white-space:nowrap;transition:background .16s,color .16s}
.segmented button:hover{color:var(--text-primary)}
.segmented button.active{background:var(--bg-surface-2);color:var(--text-primary);box-shadow:inset 0 0 0 1px var(--border)}
.seg-count{font-family:var(--mono);font-size:9px;color:var(--text-tertiary);background:var(--bg);border-radius:20px;padding:2px 6px;font-variant-numeric:tabular-nums}
.segmented button.active .seg-count{color:var(--accent);background:var(--accent-dim)}
.search-field,.select-field{position:relative;display:inline-flex;align-items:center}
.search-field-icon,.select-field-icon{position:absolute;left:10px;display:flex;color:var(--text-tertiary);pointer-events:none}
.search-field-icon .icon,.select-field-icon .icon{width:13px;height:13px}
.search-field input,.select-field select{background:var(--bg-elevated);border:1px solid var(--border-subtle);border-radius:8px;padding:8px 12px 8px 30px;font-size:12px;color:var(--text-primary);min-width:150px}
.search-field input{min-width:230px}
.select-field select{appearance:none;cursor:pointer;padding-right:26px}
.search-field input::placeholder{color:var(--text-tertiary)}
.search-field input:focus,.select-field select:focus{border-color:var(--border-strong);outline:none}
.filter-note{display:flex;align-items:center;gap:12px;flex-wrap:wrap;font-size:11px;color:var(--text-secondary);background:var(--accent-glow);border:1px solid var(--accent-line);border-radius:8px;padding:9px 13px;margin-bottom:14px}
.filter-note .link{border:0;background:transparent;cursor:pointer;font-size:11px;padding:0;margin-left:auto}
.hint{font:10px var(--mono);color:var(--text-tertiary);margin:14px 0 0;letter-spacing:.03em}
.card-foot{padding:11px 15px;border-top:1px solid var(--border-subtle);font-size:11px}

/* ---- Row states and the keyboard cursor ---- */
.runs-table{min-width:820px}
tr.row-failed td:first-child{box-shadow:inset 2px 0 0 var(--danger)}
tr.row-live td:first-child{box-shadow:inset 2px 0 0 var(--accent)}
tr.cursor,.definition-card.cursor{outline:1px solid var(--accent-soft);outline-offset:-1px;background:var(--accent-glow)}

/* ---- Alerts ---- */
.alert{display:flex;gap:13px;align-items:flex-start;border-radius:var(--radius);padding:14px 16px;margin-bottom:16px;border:1px solid var(--border)}
.alert .symbol{display:flex;flex:0 0 auto;margin-top:1px}
.alert .symbol .icon{width:17px;height:17px}
.alert b{display:block;font-size:12px;font-weight:600;margin-bottom:3px}
.alert p{margin:0;font-size:12px;color:var(--text-secondary);line-height:1.55;word-break:break-word}
.alert.danger{background:rgba(226,155,168,.07);border-color:rgba(226,155,168,.26)}
.alert.danger .symbol{color:var(--danger)}
.alert.danger b{color:var(--danger)}
.alert.live{background:var(--accent-glow);border-color:var(--accent-line)}
.alert.live b{color:var(--accent)}
.pulse-dot{width:9px;height:9px;border-radius:50%;background:var(--accent);display:block;margin-top:4px;animation:pulse-dot 1.6s ease-in-out infinite}
.live-chip.pulse i{animation:live-ping .7s ease-out}
@keyframes live-ping{0%{transform:scale(1);opacity:1}45%{transform:scale(2.1);opacity:.45}100%{transform:scale(1);opacity:1}}

/* ---- Event trace ---- */
.event-controls{display:flex;align-items:center;gap:12px;flex-wrap:wrap;padding:12px 15px;border-bottom:1px solid var(--border-subtle)}
.event-controls-right{display:flex;align-items:center;gap:12px;margin-left:auto;flex-wrap:wrap}
.event-controls-right .muted{font-size:11px}
.event-list{max-height:640px;overflow:auto}
.chips{display:flex;gap:5px;flex-wrap:wrap}
.chip{border:1px solid var(--border-subtle);background:var(--bg-elevated);color:var(--text-secondary);border-radius:20px;padding:5px 11px;font:9px var(--mono);text-transform:uppercase;letter-spacing:.07em;cursor:pointer;transition:border-color .16s,color .16s,background .16s}
.chip:hover{color:var(--text-primary);border-color:var(--border)}
.chip.active{background:var(--accent-dim);border-color:var(--accent-line);color:var(--accent)}
.event-toggle{grid-template-columns:74px 62px 104px minmax(0,1fr) auto!important}
.event-offset{color:var(--accent-soft);font-size:9px;font-variant-numeric:tabular-nums}
.event-caret{display:flex;color:var(--text-tertiary)}
.event-caret .icon{width:13px;height:13px;transition:transform .18s}
.event-row.open .event-caret .icon{transform:rotate(180deg)}
.event-detail-head{display:flex;align-items:center;gap:8px;padding:9px 15px 0}
.event-detail-head .copy-btn{opacity:1;margin-left:auto}

/* ---- Skeletons ---- */
.skeleton{padding:6px 0}
.skeleton-row{display:flex;align-items:center;gap:16px;padding:13px 15px;border-bottom:1px solid var(--border-subtle)}
.skeleton-row span{height:9px;border-radius:20px;background:linear-gradient(90deg,var(--bg-surface) 0%,var(--bg-surface-2) 50%,var(--bg-surface) 100%);background-size:200% 100%;animation:shimmer 1.5s linear infinite}
.skeleton-row span:last-child{margin-left:auto}
@keyframes shimmer{0%{background-position:200% 0}100%{background-position:-200% 0}}
.boot-skeleton{padding:32px}
.boot-skeleton p{font-size:12px;margin-top:18px}

/* ---- Run drawer ---- */
.drawer-hint{font-size:9px;color:var(--text-tertiary);margin-right:auto;letter-spacing:.06em}
.button.pending{opacity:.65;cursor:progress}
.button.danger{color:var(--danger);border-color:rgba(226,155,168,.3)}
.button.danger:hover{background:rgba(226,155,168,.09);border-color:var(--danger)}

@media(max-width:760px){
  .toolbar-right{margin-left:0;width:100%}
  .search-field,.search-field input{width:100%;min-width:0}
  .event-toggle{grid-template-columns:60px 54px minmax(0,1fr) auto!important}
  .event-toggle .event-category{display:none}
  .hint{display:none}
}
@media(prefers-reduced-motion:reduce){*{scroll-behavior:auto!important;transition:none!important}}
`;
