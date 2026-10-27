export const DASHBOARD_STYLES = String.raw`
@import url('https://fonts.googleapis.com/css2?family=DM+Sans:ital,wght@0,300;0,400;0,500;0,600;1,400&family=JetBrains+Mono:wght@400;500&display=swap');
:root{
  --bg:#080B0A;--bg-elevated:#0F1613;--bg-surface:#141D18;--bg-surface-2:#19241F;
  --border:#243029;--border-subtle:#18211C;--border-strong:#32453B;
  --text-primary:#E7EEEA;--text-secondary:#93A399;--text-tertiary:#5C6F64;
  --accent:#9ED4B8;--accent-soft:#7BBFA0;--accent-strong:#BEE7D0;
  --accent-dim:rgba(158,212,184,.08);--accent-glow:rgba(158,212,184,.045);--accent-line:rgba(158,212,184,.16);
  --interface:#E4B879;--network:#83B3E2;--deploy:#B8A7E8;--media:#E29BA8;
  --success:#8CC494;--warn:#E4B879;--danger:#E29BA8;
  --sans:'DM Sans',-apple-system,BlinkMacSystemFont,sans-serif;--mono:'JetBrains Mono',monospace;
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
.status{display:inline-flex;align-items:center;gap:6px;border-radius:999px;padding:4px 8px;background:var(--bg-surface-2);color:var(--text-secondary);font:8px var(--mono);text-transform:uppercase;letter-spacing:.06em;white-space:nowrap;border:1px solid var(--border)}.status:before{content:"";width:5px;height:5px;border-radius:50%;background:var(--text-tertiary)}.status.completed,.status.connected,.status.active,.status.enabled,.status.resolved{background:rgba(140,196,148,.08);color:var(--success);border-color:rgba(140,196,148,.18)}.status.completed:before,.status.connected:before,.status.active:before,.status.enabled:before,.status.resolved:before{background:var(--success)}.status.running,.status.pending,.status.connecting,.status.reconnecting,.status.in-progress{background:rgba(131,179,226,.08);color:var(--network);border-color:rgba(131,179,226,.18)}.status.running:before,.status.pending:before,.status.connecting:before,.status.reconnecting:before,.status.in-progress:before{background:var(--network)}.status.paused{background:rgba(226,187,131,.08);color:var(--warning);border-color:rgba(226,187,131,.18)}.status.paused:before{background:var(--warning)}.status.failed,.status.cancelled,.status.disconnected,.status.dismissed{background:rgba(226,155,168,.08);color:var(--danger);border-color:rgba(226,155,168,.18)}.status.failed:before,.status.cancelled:before,.status.disconnected:before,.status.dismissed:before{background:var(--danger)}
.tag{display:inline-block;border:1px solid var(--border);border-radius:4px;padding:3px 6px;font:8px var(--mono);color:var(--text-secondary);margin:2px 4px 2px 0;background:var(--bg-surface)}.link{color:var(--accent);text-decoration:none;font-weight:500}.link:hover{text-decoration:underline;text-decoration-color:var(--accent-line)}.inline-icon{display:inline-flex;align-items:center;gap:5px}.inline-icon .icon{width:12px;height:12px}.empty{padding:38px 22px;text-align:center;color:var(--text-secondary);font-size:12px;line-height:1.6}.empty strong{display:block;color:var(--text-primary);font-size:14px;font-weight:500;margin-bottom:5px}.filters{display:flex;gap:8px;margin-bottom:14px}.filters input,.filters select{background:var(--bg-elevated);border:1px solid var(--border);border-radius:7px;padding:10px 12px;font-size:12px}.filters input{min-width:280px}
.definition-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px;margin-bottom:16px}.definition-card{display:block;color:inherit;text-decoration:none;background:var(--bg-elevated);border:1px solid var(--border-subtle);border-radius:var(--radius-lg);padding:19px;min-height:196px;position:relative;overflow:hidden;transition:transform .2s ease,border-color .2s ease,background .2s}.definition-card:before{content:"";position:absolute;inset:0;opacity:0;background:radial-gradient(110% 80% at 100% 0%,var(--accent-dim),transparent 60%);transition:opacity .2s}.definition-card:hover{transform:translateY(-2px);border-color:var(--accent-line);background:var(--bg-surface)}.definition-card:hover:before{opacity:1}.definition-icon{width:31px;height:31px;display:grid;place-items:center;border:1px solid var(--accent-line);border-radius:8px;color:var(--accent);background:var(--accent-dim);margin-bottom:15px;position:relative}.definition-icon .icon{width:17px;height:17px}.definition-open{position:absolute;right:17px;top:17px;color:var(--text-tertiary);transition:color .18s,transform .18s}.definition-open .icon{width:14px;height:14px}.definition-card:hover .definition-open{color:var(--accent);transform:translate(1px,-1px)}.definition-card h3{margin:0;font-size:17px;font-weight:500;position:relative}.definition-card p{color:var(--text-secondary);font-size:12px;font-weight:300;line-height:1.6;margin:9px 0 18px;position:relative}.definition-meta{position:absolute;left:19px;right:19px;bottom:17px;display:flex;justify-content:space-between;align-items:end}.definition-meta b{font:9px var(--mono);color:var(--accent-soft)}
.cap-list{display:flex;flex-wrap:wrap;gap:6px}.cap{border:1px solid var(--border);background:var(--bg-surface);border-radius:5px;padding:7px 9px;font:9px var(--mono);margin-bottom:6px;color:var(--text-secondary)}.detail-strip{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));border:1px solid var(--border-subtle);border-radius:var(--radius);background:var(--bg-elevated);margin-bottom:14px;overflow:hidden}.detail-strip>div{padding:15px;border-right:1px solid var(--border-subtle);min-width:0}.detail-strip>div:last-child{border-right:0}.detail-strip label{display:block;color:var(--text-tertiary);font:8px var(--mono);text-transform:uppercase;letter-spacing:.1em}.detail-strip strong{display:block;margin-top:8px;font-size:12px;font-weight:500;overflow-wrap:anywhere}.json{margin:0;background:#070A09;color:var(--text-secondary);border:1px solid var(--border-subtle);border-radius:7px;padding:14px;font:9px/1.65 var(--mono);white-space:pre-wrap;overflow:auto;max-height:360px}.summary-box{font-size:12px;line-height:1.65;overflow-wrap:anywhere}.summary-box dl{display:grid;grid-template-columns:130px 1fr;gap:9px 14px;margin:0}.summary-box dt{color:var(--text-tertiary);font:8px var(--mono);text-transform:uppercase;letter-spacing:.08em}.summary-box dd{margin:0;color:var(--text-secondary)}
.run-spine{position:relative;padding:4px 0}.run-spine:before{content:"";position:absolute;left:19px;top:14px;bottom:14px;width:1px;background:var(--border)}.phase{position:relative;display:grid;grid-template-columns:40px 1fr auto;gap:12px;padding:11px 4px}.phase-dot{width:12px;height:12px;border-radius:50%;background:var(--bg-elevated);border:2px solid var(--text-tertiary);margin:2px 0 0 13px;z-index:1}.phase.complete .phase-dot{border-color:var(--success);box-shadow:0 0 8px rgba(140,196,148,.2)}.phase.active .phase-dot{border-color:var(--network);box-shadow:0 0 0 5px rgba(131,179,226,.09)}.phase.error .phase-dot{border-color:var(--danger)}.phase strong{font-size:12px;font-weight:500}.phase p{margin:4px 0 0;color:var(--text-secondary);font-size:11px;font-weight:300;line-height:1.5}.phase time{font:8px var(--mono);color:var(--text-tertiary)}
.workspace-tabs{display:flex;gap:2px;border-bottom:1px solid var(--border-subtle);margin:20px 0 14px}.workspace-tabs button{border:0;background:transparent;padding:11px 13px;color:var(--text-secondary);font-size:11px;cursor:pointer;border-bottom:2px solid transparent}.workspace-tabs button.active{color:var(--accent);border-color:var(--accent);font-weight:500}.kv{display:grid;grid-template-columns:repeat(3,1fr);gap:10px}.kv-item{border:1px solid var(--border-subtle);border-radius:7px;padding:13px;background:var(--bg-surface)}.kv-item strong{font:10px var(--mono)}.kv-item small{display:block;color:var(--text-tertiary);margin-top:6px}.kv-value{margin-top:12px;color:var(--text-secondary);font-size:11px;line-height:1.5;overflow-wrap:anywhere}.callout{border:1px solid var(--accent-line);background:var(--accent-glow);border-radius:8px;padding:15px 17px;display:flex;align-items:flex-start;gap:12px;margin-bottom:14px}.callout b{font-size:12px;font-weight:500}.callout p{margin:4px 0 0;color:var(--text-secondary);font-size:11px;line-height:1.5}.callout .symbol{width:31px;height:31px;display:grid;place-items:center;flex:0 0 auto;border:1px solid var(--accent-line);border-radius:7px;color:var(--accent);background:var(--accent-dim)}.callout .symbol .icon{width:16px;height:16px}
.drawer-backdrop{position:fixed;inset:0;background:rgba(0,0,0,.62);backdrop-filter:blur(3px);z-index:40;display:none}.drawer-backdrop.open{display:block}.drawer{position:absolute;right:0;top:0;bottom:0;width:min(520px,100%);background:var(--bg-elevated);border-left:1px solid var(--border);box-shadow:-20px 0 60px rgba(0,0,0,.35);padding:26px;overflow:auto}.drawer-head{display:flex;align-items:flex-start;margin-bottom:28px}.drawer h2{margin:0;font-size:23px;font-weight:400;letter-spacing:-.025em}.drawer-head button{margin-left:auto;border:0;background:transparent;color:var(--text-secondary);cursor:pointer}.drawer-head button:hover{color:var(--text-primary);background:var(--bg-surface)}.field{margin-bottom:17px}.field label{display:block;font:8px var(--mono);text-transform:uppercase;letter-spacing:.12em;color:var(--text-tertiary);margin-bottom:7px}.field input,.field textarea,.field select{width:100%;border:1px solid var(--border);background:var(--bg);border-radius:7px;padding:11px 12px;font-size:12px}.field textarea{min-height:120px;resize:vertical}.form-error{background:rgba(226,155,168,.08);color:var(--danger);border:1px solid rgba(226,155,168,.18);border-radius:7px;padding:10px 12px;font-size:11px;margin-bottom:13px}.drawer-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:22px}
.search-modal{position:fixed;inset:0;background:rgba(0,0,0,.64);backdrop-filter:blur(4px);z-index:50;display:none;padding:12vh 20px}.search-modal.open{display:block}.search-box{max-width:650px;margin:auto;background:var(--bg-elevated);border:1px solid var(--border);border-radius:10px;box-shadow:var(--shadow);overflow:hidden}.search-input-wrap{display:flex;align-items:center;gap:12px;padding:0 20px;border-bottom:1px solid var(--border);color:var(--text-tertiary)}.search-input-wrap>.icon{width:19px;height:19px}.search-box input{width:100%;border:0;background:var(--bg-elevated);padding:18px 0;font-size:15px}.search-results{max-height:420px;overflow:auto;padding:8px}.search-result{display:block;padding:11px 12px;border-radius:6px;text-decoration:none;color:inherit}.search-result:hover{background:var(--accent-glow)}.search-result strong{font-size:12px;font-weight:500}.search-result small{display:block;color:var(--text-tertiary);margin-top:3px}.toast{position:fixed;right:24px;bottom:24px;background:var(--accent);color:var(--bg);border-radius:7px;padding:12px 15px;font-size:11px;font-weight:600;box-shadow:var(--shadow);z-index:60;transform:translateY(20px);opacity:0;pointer-events:none;transition:.2s}.toast.show{transform:none;opacity:1}
@media(max-width:1100px){.cols-4{grid-template-columns:repeat(2,1fr)}.definition-grid{grid-template-columns:repeat(2,1fr)}.cols-3{grid-template-columns:1fr 1fr}}
@media(max-width:760px){:root{--sidebar:0px}.sidebar{transform:translateX(-248px);width:248px;transition:transform .2s ease}.sidebar.open{transform:none}.mobile-toggle{display:inline-flex}.topbar{padding:0 16px}.live-chip{display:none}.content{padding:24px 16px 55px}.page-head{display:block}.page-head .actions{margin:18px 0 0}.cols-4,.cols-3,.cols-2,.definition-grid,.kv{grid-template-columns:1fr}.span-2{grid-column:auto}.detail-strip{display:block}.detail-strip>div{border-right:0;border-bottom:1px solid var(--border-subtle)}.filters{flex-wrap:wrap}.filters input{min-width:100%;width:100%}.top-actions .button.primary span{display:none}}

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

/* ---- Effect approvals. One warm decision rail breaks the cool runtime surface. ---- */
.approval-rail{position:relative;border:1px solid rgba(228,184,121,.28);border-left:3px solid var(--warn);border-radius:var(--radius);background:linear-gradient(100deg,rgba(228,184,121,.075),rgba(15,22,19,.96) 38%);margin-bottom:16px;overflow:hidden;box-shadow:0 16px 36px rgba(0,0,0,.16)}
.approval-rail>header{display:flex;align-items:flex-start;gap:20px;padding:16px 18px;border-bottom:1px solid rgba(228,184,121,.16)}
.approval-rail h2{margin:4px 0 0;font-size:16px;font-weight:500;letter-spacing:-.015em}.approval-rail header p{margin:5px 0 0;color:var(--text-secondary);font-size:11px;line-height:1.5}.approval-kicker{font:8px var(--mono);text-transform:uppercase;letter-spacing:.15em;color:var(--warn)}.approval-count{margin-left:auto;border:1px solid rgba(228,184,121,.24);border-radius:999px;padding:4px 8px;color:var(--warn);font:8px var(--mono);text-transform:uppercase;letter-spacing:.08em;white-space:nowrap}
.approval-list{display:grid}.approval-item{padding:16px 18px;border-top:1px solid var(--border-subtle)}.approval-item:first-child{border-top:0}.approval-context{display:flex;align-items:center;gap:10px;margin-bottom:10px}.approval-tool{font:10px var(--mono);color:var(--text-primary);background:rgba(228,184,121,.08);border:1px solid rgba(228,184,121,.18);border-radius:5px;padding:5px 8px}.approval-run{margin-left:auto;color:var(--text-secondary);font:9px var(--mono);text-decoration:none}.approval-run:hover{color:var(--warn)}
.approval-input{margin:0;max-height:220px;overflow:auto;white-space:pre-wrap;overflow-wrap:anywhere;border:1px solid var(--border-subtle);border-radius:7px;background:#070A09;padding:12px;color:var(--text-secondary);font:9px/1.65 var(--mono)}.approval-foot{display:flex;align-items:center;gap:16px;margin-top:12px;color:var(--text-tertiary);font:9px var(--mono)}.approval-actions{display:flex;gap:8px;margin-left:auto}.button.approve{border-color:var(--warn);background:var(--warn);color:#14110A;font-weight:600}.button.approve:hover{border-color:#F0C98D;background:#F0C98D;transform:translateY(-1px)}.approval-actions button:disabled{opacity:.55;cursor:wait;transform:none}

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

/* ---- WebChat. A focused conversation surface backed by native Glove history. ---- */
.content.chat-content{max-width:none;height:calc(100vh - 72px);padding:0;overflow:hidden}
.content.chat-content:before{display:none}
.chat-shell{display:grid;grid-template-columns:290px minmax(0,1fr);height:100%;background:var(--bg)}
.session-rail{min-width:0;border-right:1px solid var(--border-subtle);background:rgba(15,22,19,.7);display:flex;flex-direction:column;overflow:hidden}
.session-head{height:76px;padding:18px;display:flex;align-items:center;border-bottom:1px solid var(--border-subtle)}
.session-head>div{min-width:0}.session-head .eyebrow{font-size:8px;margin:0 0 5px}.session-head h1{margin:0;font-size:18px;font-weight:500;letter-spacing:-.02em}.session-head .button{margin-left:auto;color:var(--accent);background:var(--accent-dim);border-color:var(--accent-line)}
.session-agent{padding:14px 15px 8px}.session-agent>span{display:block;margin-bottom:6px;color:var(--text-tertiary);font:8px var(--mono);text-transform:uppercase;letter-spacing:.1em}.session-agent select{width:100%;border:1px solid var(--border);background:var(--bg);border-radius:7px;padding:9px 10px;font-size:11px}
.session-search{position:relative;margin:4px 15px 10px;display:flex;align-items:center;color:var(--text-tertiary)}.session-search>.icon{position:absolute;left:10px;width:13px;height:13px}.session-search input{width:100%;border:1px solid var(--border-subtle);background:var(--bg);border-radius:7px;padding:9px 10px 9px 31px;font-size:11px}.session-search input::placeholder{color:var(--text-tertiary)}
.session-list{padding:2px 8px 18px;overflow:auto;min-height:0}.chat-session{position:relative;width:100%;border:1px solid transparent;background:transparent;color:var(--text-secondary);padding:11px 12px;border-radius:7px;text-align:left;cursor:pointer;margin:1px 0}.chat-session:hover{background:var(--accent-glow);color:var(--text-primary)}.chat-session.active{background:var(--accent-dim);border-color:var(--accent-line);color:var(--text-primary)}.chat-session.active:before{content:"";position:absolute;left:0;top:10px;bottom:10px;width:2px;background:var(--accent)}.chat-session span{display:block;font-size:12px;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.chat-session small{display:block;margin-top:5px;color:var(--text-tertiary);font:8px var(--mono);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.conversation-pane{min-width:0;min-height:0;display:flex;flex-direction:column;background:radial-gradient(70% 38% at 50% 0%,var(--accent-glow),transparent 75%)}
.conversation-head{height:76px;flex:0 0 auto;border-bottom:1px solid var(--border-subtle);padding:14px 22px;display:flex;align-items:center;gap:20px;background:rgba(8,11,10,.5)}.conversation-head>div:first-child{min-width:0}.conversation-kicker{display:block;color:var(--accent-soft);font:8px var(--mono);text-transform:uppercase;letter-spacing:.1em;margin-bottom:5px}.conversation-head h2{margin:0;font-size:17px;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.conversation-meta{margin-left:auto;display:flex;align-items:center;gap:10px;color:var(--text-tertiary);font:8px var(--mono);white-space:nowrap}.conversation-rename{border:0;background:transparent;color:var(--text-tertiary);padding:5px 7px;border-radius:5px;font:8px var(--mono);cursor:pointer}.conversation-rename:hover{color:var(--accent);background:var(--accent-dim)}
.chat-store-warning{flex:0 0 auto;border-bottom:1px solid rgba(228,184,121,.22);background:rgba(228,184,121,.07);color:var(--warn);padding:9px 20px;font-size:10px;text-align:center}
.message-scroll{flex:1;min-height:0;overflow:auto;padding:32px max(24px,calc((100% - 920px)/2)) 22px;scrollbar-gutter:stable}
.load-history{display:flex;align-items:center;justify-content:center;gap:10px;margin:-12px auto 24px}.load-history .button{font-size:10px}.load-history>span{color:var(--text-tertiary);font:8px var(--mono)}
.chat-message{display:flex;align-items:flex-start;gap:12px;margin:0 auto 24px;max-width:920px}.chat-message.user{flex-direction:row-reverse}.message-avatar{width:29px;height:29px;flex:0 0 auto;border:1px solid var(--border);border-radius:8px;background:var(--bg-surface);color:var(--text-secondary);display:grid;place-items:center;font:10px var(--mono)}.message-avatar .icon{width:16px;height:16px;color:var(--accent)}.chat-message.user .message-avatar{background:var(--accent);border-color:var(--accent);color:var(--bg);font-weight:700}
.message-body{min-width:0;max-width:min(780px,82%)}.message-body>header{display:flex;align-items:center;gap:8px;margin:0 2px 6px}.message-body>header strong{font-size:11px;font-weight:600}.message-body>header span{color:var(--text-tertiary);font:8px var(--mono);text-transform:uppercase}.chat-message.user .message-body>header{justify-content:flex-end}.message-text{white-space:pre-wrap;overflow-wrap:anywhere;border:1px solid var(--border-subtle);background:var(--bg-elevated);border-radius:4px 12px 12px 12px;padding:12px 14px;color:var(--text-primary);font-size:13px;font-weight:300;line-height:1.62}.chat-message.user .message-text{border-color:var(--accent-line);background:var(--accent-dim);border-radius:12px 4px 12px 12px}.chat-message.optimistic{opacity:.65}
.chat-message.tool .message-avatar .icon{color:var(--network)}.chat-message.tool .message-body>header strong{color:var(--network)}
.message-attachments{display:flex;flex-wrap:wrap;gap:7px;margin-top:8px}.message-attachments>span{display:grid;grid-template-columns:18px minmax(0,1fr);column-gap:7px;align-items:center;min-width:160px;border:1px solid var(--border);background:var(--bg-surface);border-radius:7px;padding:8px 10px}.message-attachments .icon{grid-row:1/3;color:var(--accent);width:16px;height:16px}.message-attachments b{font-size:10px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.message-attachments small{color:var(--text-tertiary);font:8px var(--mono)}
.message-tools{margin-top:7px;border:1px solid var(--border-subtle);border-radius:7px;background:#070A09;overflow:hidden}.message-tools summary{padding:8px 10px;color:var(--network);font:9px var(--mono);cursor:pointer}.message-tools pre{margin:0;border-top:1px solid var(--border-subtle);padding:10px;max-height:260px;overflow:auto;color:var(--text-secondary);white-space:pre-wrap;font:8px/1.55 var(--mono)}
.chat-progress{flex:0 0 auto;margin:0 max(24px,calc((100% - 920px)/2)) 10px;border:1px solid var(--accent-line);background:linear-gradient(90deg,var(--accent-dim),var(--bg-elevated));border-radius:9px;padding:11px 13px;display:flex;align-items:center;gap:14px}.chat-progress>div:first-child{display:grid;grid-template-columns:17px minmax(0,1fr);align-items:center;min-width:0}.chat-progress .pulse-dot{grid-row:1/3}.chat-progress strong{font-size:11px}.chat-progress small{margin-top:2px;color:var(--text-tertiary);font:8px var(--mono);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.chat-progress-actions{display:flex;gap:7px;margin-left:auto}.chat-progress .button{padding:7px 9px;font-size:10px}
.chat-composer{flex:0 0 auto;margin:0 max(24px,calc((100% - 920px)/2)) 20px;border:1px solid var(--border-strong);background:var(--bg-elevated);border-radius:11px;box-shadow:0 18px 42px rgba(0,0,0,.24);overflow:hidden}.chat-composer textarea{display:block;width:100%;min-height:56px;max-height:180px;resize:vertical;border:0;background:transparent;padding:14px 15px 8px;font-size:13px;line-height:1.5}.chat-composer textarea:focus{outline:0}.composer-actions{display:flex;align-items:center;gap:10px;padding:6px 8px 8px}.composer-actions>span{color:var(--text-tertiary);font:8px var(--mono)}.composer-actions>.button{margin-left:auto}.attach-button{width:31px;height:31px;border:1px solid var(--border);border-radius:7px;color:var(--text-secondary);display:grid;place-items:center;cursor:pointer}.attach-button:hover{border-color:var(--border-strong);color:var(--accent);background:var(--accent-dim)}.attach-button .icon{width:15px;height:15px}.attach-button input{display:none}
.selected-files{display:flex;flex-wrap:wrap;gap:5px;padding:8px 10px 0}.selected-files:empty{display:none}.selected-files>span{display:flex;align-items:center;gap:6px;max-width:260px;border:1px solid var(--border);border-radius:6px;background:var(--bg-surface);padding:5px 6px;color:var(--text-secondary)}.selected-files .icon{width:12px;height:12px;color:var(--accent)}.selected-files b{font-size:9px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.selected-files small{color:var(--text-tertiary);font:8px var(--mono);white-space:nowrap}.selected-files button{border:0;background:transparent;color:var(--text-tertiary);padding:2px;cursor:pointer}.selected-files button .icon{color:inherit;width:10px;height:10px}.chat-composer .form-error{margin:0;border-width:1px 0 0;border-radius:0}
.chat-empty{margin:auto;max-width:430px;padding:40px 24px;text-align:center}.chat-empty.compact{min-height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center}.chat-empty-icon{width:36px;height:36px;color:var(--accent);margin:0 auto 17px}.chat-empty h2{margin:0;font-size:20px;font-weight:400;letter-spacing:-.02em}.chat-empty p{margin:9px 0 20px;color:var(--text-secondary);font-size:12px;line-height:1.6}.empty-action{text-align:center;margin-top:-24px}

@media(max-width:760px){
  .toolbar-right{margin-left:0;width:100%}
  .search-field,.search-field input{width:100%;min-width:0}
  .approval-rail>header,.approval-foot{display:block}.approval-count{display:inline-flex;margin:10px 0 0}.approval-context{align-items:flex-start}.approval-run{margin-left:0}.approval-actions{margin:12px 0 0}.approval-actions .button{flex:1}
  .hint{display:none}
  .content.chat-content{height:calc(100vh - 72px);padding:0}.chat-shell{grid-template-columns:1fr;grid-template-rows:auto minmax(0,1fr)}.session-rail{max-height:235px;border-right:0;border-bottom:1px solid var(--border-subtle)}.session-head{height:58px;padding:10px 14px}.session-head .eyebrow{display:none}.session-head h1{font-size:15px}.session-agent{padding:8px 12px 4px}.session-search{margin:4px 12px 7px}.session-list{display:flex;gap:5px;padding:2px 10px 10px;overflow:auto}.chat-session{min-width:180px;margin:0}.conversation-head{height:62px;padding:10px 14px}.conversation-meta span:not(.status){display:none}.message-scroll{padding:20px 13px}.message-body{max-width:88%}.chat-progress{margin:0 10px 8px}.chat-progress-actions a{display:none}.chat-composer{margin:0 10px 10px}.composer-actions>span{display:none}
}
/* ---- Run workbench: DevTools for an agent run. Dense rows, panes that scroll on their own. ---- */
.devtools{border:1px solid var(--border-subtle);border-radius:var(--radius);background:rgba(15,22,19,.95);overflow:hidden;margin-bottom:14px}
.dt-tabs{display:flex;align-items:stretch;gap:2px;border-bottom:1px solid var(--border-subtle);background:rgba(20,29,24,.5);padding:0 8px;overflow-x:auto}
.dt-tab{border:0;background:transparent;color:var(--text-secondary);font-size:12px;font-weight:500;padding:11px 12px 9px;display:inline-flex;align-items:center;gap:7px;cursor:pointer;border-bottom:2px solid transparent;white-space:nowrap}
.dt-tab .icon{width:14px;height:14px}
.dt-tab:hover{color:var(--text-primary)}
.dt-tab.active{color:var(--accent);border-bottom-color:var(--accent)}
.dt-badge{font:9px var(--mono);border-radius:10px;padding:1px 6px;background:var(--bg);color:var(--text-tertiary);font-variant-numeric:tabular-nums}
.dt-badge.err{background:rgba(226,155,168,.14);color:var(--danger)}
.dt-badge.warn{background:rgba(228,184,121,.14);color:var(--warn)}
.dt-live{display:inline-flex;align-items:center;gap:7px;align-self:center;margin-left:10px;font:9px var(--mono);text-transform:uppercase;letter-spacing:.1em;color:var(--accent)}
.dt-live .pulse-dot{width:7px;height:7px;margin:0}
.dt-hint{margin-left:auto;align-self:center;font:9px var(--mono);color:var(--text-tertiary);padding-left:16px;white-space:nowrap}
.dt-body{height:min(74vh,820px);min-height:460px;display:flex;flex-direction:column;min-width:0}
.dt-body.dt-summary{height:auto;min-height:0}
.dt-toolbar{display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:8px 10px;border-bottom:1px solid var(--border-subtle);background:rgba(8,11,10,.35);flex:0 0 auto}
.dt-filter{position:relative;display:flex;align-items:center}
.dt-filter .icon{position:absolute;left:9px;width:12px;height:12px;color:var(--text-tertiary)}
.dt-filter input{background:var(--bg);border:1px solid var(--border-subtle);border-radius:6px;padding:6px 10px 6px 27px;font-size:11px;min-width:250px;color:var(--text-primary)}
.dt-filter input:focus,.dt-select:focus{outline:none;border-color:var(--border-strong)}
.dt-select{background:var(--bg);border:1px solid var(--border-subtle);border-radius:6px;padding:6px 8px;font-size:11px;color:var(--text-primary)}
.dt-chips{display:flex;gap:2px}
.dt-chip{border:1px solid transparent;background:transparent;color:var(--text-secondary);border-radius:5px;padding:5px 9px;font-size:11px;cursor:pointer}
.dt-chip:hover{color:var(--text-primary)}
.dt-chip.active{background:var(--bg-surface-2);border-color:var(--border);color:var(--text-primary)}
.dt-summary{margin-left:auto;display:flex;gap:10px;font:10px var(--mono);color:var(--text-tertiary)}
.dt-pad{padding:16px;overflow:auto}
.st{font:9px var(--mono);text-transform:uppercase;letter-spacing:.05em;color:var(--text-secondary)}
.st.ok{color:var(--success)}.st.err{color:var(--danger)}.st.warn{color:var(--warn)}.st.live{color:var(--accent)}
.net-link{border:0;background:transparent;padding:0;color:var(--network);font:inherit;font-size:inherit;cursor:pointer;text-decoration:underline;text-decoration-color:rgba(131,179,226,.35);text-underline-offset:2px}
.net-link:hover{color:var(--text-primary)}

.net-split{flex:1;min-height:0;display:grid;grid-template-columns:minmax(0,1fr)}
.net-split.has-detail{grid-template-columns:minmax(280px,36%) minmax(0,1fr)}
.net-list{overflow:auto;min-height:0}
.net-table{width:100%;border-collapse:collapse;table-layout:fixed;font-size:11px}
.net-table col.w-name{width:30%}.net-table col.w-type{width:9%}.net-table col.w-status{width:8%}.net-table col.w-init{width:13%}.net-table col.w-size{width:10%}.net-table col.w-time{width:8%}.net-table col.w-wf{width:22%}
.net-table th{position:sticky;top:0;z-index:1;background:var(--bg-elevated);text-align:left;font:9px var(--mono);text-transform:uppercase;letter-spacing:.08em;color:var(--text-tertiary);padding:7px 10px;border-bottom:1px solid var(--border);border-right:1px solid var(--border-subtle);white-space:nowrap;overflow:hidden}
.net-table td{padding:5px 10px;border-bottom:1px solid var(--border-subtle);border-right:1px solid rgba(24,33,28,.7);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;vertical-align:middle;color:var(--text-secondary)}
.net-row{cursor:pointer}
.net-row:nth-child(even){background:rgba(20,29,24,.32)}
.net-row:hover{background:var(--accent-glow)}
.net-row.selected{background:var(--accent-dim);box-shadow:inset 2px 0 0 var(--accent)}
.net-name{display:flex;align-items:center;gap:9px;min-width:0}
.net-name>span{min-width:0}
.net-name b{display:block;font-weight:500;color:var(--text-primary);overflow:hidden;text-overflow:ellipsis}
.net-name small{display:block;color:var(--text-tertiary);font:9px var(--mono);overflow:hidden;text-overflow:ellipsis;margin-top:1px}
.net-row.failed .net-name b{color:var(--danger)}
.net-glyph{flex:0 0 auto;width:8px;height:8px;border-radius:2px;background:var(--accent)}
.kind-tool .net-glyph{background:var(--network);border-radius:50%}
.kind-subagent .net-glyph{background:var(--deploy)}
.net-row.compaction .net-glyph{background:var(--interface)}
.c-size,.c-time{font-family:var(--mono);font-size:10px;font-variant-numeric:tabular-nums}
.wf-track{position:relative;display:block;height:12px}
.wf-bar{position:absolute;top:3px;height:6px;border-radius:2px;background:var(--accent-soft);min-width:2px}
.kind-tool .wf-bar{background:var(--network)}
.kind-subagent .wf-bar{background:var(--deploy)}
.net-row.failed .wf-bar{background:var(--danger)}
.wf-bar.pending{background:repeating-linear-gradient(90deg,var(--accent) 0 5px,transparent 5px 9px);opacity:.8}
.net-split.has-detail .c-type,.net-split.has-detail .c-init,.net-split.has-detail .c-size,.net-split.has-detail .c-wf{display:none}
.net-split.has-detail th.c-status,.net-split.has-detail th.c-time{width:72px}
.net-foot{flex:0 0 auto;display:flex;flex-wrap:wrap;gap:6px 16px;padding:7px 12px;border-top:1px solid var(--border-subtle);font:10px var(--mono);color:var(--text-tertiary);background:rgba(8,11,10,.4)}
.net-foot-right{margin-left:auto}
.net-detail{border-left:1px solid var(--border);display:flex;flex-direction:column;min-width:0;min-height:0;background:var(--bg-elevated)}
.nd-head{display:flex;align-items:stretch;border-bottom:1px solid var(--border-subtle);overflow-x:auto;flex:0 0 auto}
.nd-close{border:0;background:transparent;color:var(--text-tertiary);padding:0 10px;cursor:pointer;display:flex;align-items:center}
.nd-close:hover{color:var(--text-primary)}
.nd-close .icon{width:13px;height:13px}
.nd-tab{border:0;background:transparent;color:var(--text-secondary);font-size:11px;padding:9px 10px 7px;border-bottom:2px solid transparent;cursor:pointer;white-space:nowrap;display:inline-flex;align-items:center;gap:6px}
.nd-tab:hover{color:var(--text-primary)}
.nd-tab.active{color:var(--text-primary);border-bottom-color:var(--accent)}
.nd-actions{margin-left:auto;display:flex;align-items:center;padding:0 8px}
.nd-actions .button{padding:5px 9px;font-size:10px}
.nd-title{display:flex;align-items:baseline;gap:10px;padding:12px 16px 0;flex:0 0 auto}
.nd-title b{font-size:14px;font-weight:500}.nd-title span{font:10px var(--mono);color:var(--text-tertiary)}
.nd-body{overflow:auto;padding:14px 16px 20px;min-height:0;flex:1}
.dt-kv{display:grid;grid-template-columns:140px minmax(0,1fr);gap:8px 14px;margin:0 0 14px;font-size:11px;line-height:1.5}
.dt-kv dt{color:var(--text-tertiary);font:9px var(--mono);text-transform:uppercase;letter-spacing:.08em;padding-top:3px}
.dt-kv dd{margin:0;color:var(--text-primary);overflow-wrap:anywhere}
.dt-kv .copy-btn{opacity:1;vertical-align:middle}
.dt-section{font:9px var(--mono);text-transform:uppercase;letter-spacing:.12em;color:var(--text-tertiary);margin:18px 0 8px}
.dt-note{font-size:11px;color:var(--text-secondary);line-height:1.55;margin:0 0 12px}
.dt-bar{display:flex;align-items:center;gap:8px;margin-bottom:8px;font:10px var(--mono);color:var(--text-tertiary)}
.dt-bar .copy-btn{opacity:1}
.dt-pre{margin:0;white-space:pre-wrap;overflow-wrap:anywhere;font:11px/1.6 var(--mono);color:var(--text-primary);background:#070A09;border:1px solid var(--border-subtle);border-radius:7px;padding:12px 14px}
.tool-def{border:1px solid var(--border-subtle);border-radius:7px;margin-bottom:6px;background:var(--bg)}
.tool-def>summary{display:flex;gap:10px;align-items:baseline;padding:8px 11px;cursor:pointer;font-size:11px}
.tool-def>summary b{font:500 11px var(--mono);color:var(--network)}
.tool-def>summary span{color:var(--text-tertiary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.tool-def>.dt-note,.tool-def>.jt-root{margin:0 11px 10px}
.sum-row{display:grid;grid-template-columns:minmax(0,1fr) auto auto;gap:12px;align-items:baseline;padding:7px 0;border-bottom:1px solid var(--border-subtle);font-size:11px}
.sum-row:last-child{border-bottom:0}
.sum-row .sum-msg{grid-column:1/-1;color:var(--text-secondary);font:10px var(--mono)}

/* Messages, as the model received them. */
.tm{border:1px solid var(--border-subtle);border-radius:8px;background:var(--bg);margin-bottom:8px;overflow:hidden}
.tm>header{display:flex;align-items:center;gap:8px;padding:6px 11px;border-bottom:1px solid var(--border-subtle);background:rgba(20,29,24,.45)}
.tm-role{font:9px var(--mono);text-transform:uppercase;letter-spacing:.1em;color:var(--text-secondary)}
.tm.user .tm-role{color:var(--accent)}.tm.agent .tm-role{color:var(--text-primary)}.tm.tool .tm-role{color:var(--network)}.tm.runtime .tm-role{color:var(--interface)}.tm.system .tm-role{color:var(--deploy)}
.tm.runtime{border-color:rgba(228,184,121,.2)}
.tm.new{border-color:var(--accent-line)}
.tm.missing{opacity:.6;border-style:dashed}
.tm-new{margin-left:auto;font:8px var(--mono);text-transform:uppercase;letter-spacing:.08em;color:var(--accent);background:var(--accent-dim);border-radius:10px;padding:2px 7px}
.tm-new.quiet{color:var(--text-tertiary);background:var(--bg-surface)}
.tm-text{padding:10px 12px;white-space:pre-wrap;overflow-wrap:anywhere;font-size:12px;line-height:1.55;max-height:480px;overflow:auto;color:var(--text-primary)}
.tm-call,.tm-result{padding:8px 12px;border-top:1px solid var(--border-subtle)}
.tm-call>span,.tm-result>span{display:block;font:10px var(--mono);color:var(--text-secondary);margin-bottom:6px}
.tm-result.status-error>span{color:var(--danger)}
.tm-note{font:10px/1.5 var(--mono);color:var(--text-tertiary);padding:6px 12px 8px;margin:0}
.tm-media-row{padding:0 12px 8px}
.tm-media{display:inline-flex;gap:6px;align-items:center;margin:0 6px 4px 0;font:10px var(--mono);border:1px solid var(--border);border-radius:5px;padding:4px 7px;color:var(--text-secondary)}
.tm-media .icon{width:11px;height:11px}
.msg-earlier{margin-bottom:10px}
.msg-earlier>summary{cursor:pointer;font-size:11px;color:var(--text-secondary);padding:8px 11px;border:1px dashed var(--border);border-radius:7px;margin-bottom:8px}
.msg-earlier[open]>summary{border-style:solid}

/* JSON trees */
.jt-root{font:11px/1.6 var(--mono);color:var(--text-secondary);overflow-wrap:anywhere}
.jt>summary{cursor:pointer;color:var(--text-tertiary)}
.jt[open]>summary{color:var(--text-tertiary)}
.jt-body{padding-left:14px;border-left:1px solid var(--border-subtle);margin-left:3px}
.jk{color:var(--deploy)}.jv.str{color:var(--accent-strong);white-space:pre-wrap}.jv.num{color:var(--network)}.jv.bool{color:var(--interface)}.jv.null{color:var(--text-tertiary);font-style:italic}
.jv-note{display:block;font-size:9px;color:var(--text-tertiary);text-transform:uppercase;letter-spacing:.08em;margin-bottom:2px}

/* Console */
.con-list{flex:1;min-height:0;overflow:auto;font:11px/1.5 var(--mono)}
.con-row{border-bottom:1px solid var(--border-subtle)}
.con-line{width:100%;border:0;background:transparent;display:grid;grid-template-columns:62px 14px minmax(0,1fr) auto;gap:8px;padding:4px 12px;text-align:left;cursor:pointer;align-items:start;font:inherit;color:var(--text-primary)}
.con-line:hover{background:var(--accent-glow)}
.con-time{color:var(--text-tertiary);font-variant-numeric:tabular-nums}
.con-lvl{display:flex;padding-top:2px}.con-lvl .icon{width:12px;height:12px}
.con-msg{white-space:pre-wrap;overflow-wrap:anywhere}
.con-src{color:var(--text-tertiary);font-size:9px;padding-top:2px}
.con-row.lvl-error{background:rgba(226,155,168,.06)}.con-row.lvl-error .con-line{color:var(--danger)}
.con-row.lvl-warn{background:rgba(228,184,121,.06)}.con-row.lvl-warn .con-line{color:var(--warn)}
.con-row.lvl-verbose .con-msg{color:var(--text-secondary)}
.con-detail{display:none;padding:4px 12px 12px 96px}
.con-row.open .con-detail{display:block}
.con-row.open .con-line{background:var(--accent-glow)}
.con-detail-head{display:flex;align-items:center;gap:12px;margin-bottom:6px;font-size:10px}
.con-detail-head .copy-btn{opacity:1;margin-left:auto}
.con-more{padding:10px 12px;margin:0}

/* Context */
.ctx{flex:1;min-height:0;display:grid;grid-template-columns:220px minmax(0,1fr)}
.ctx-tree{border-right:1px solid var(--border-subtle);overflow:auto;padding:6px 0 16px;background:rgba(8,11,10,.35)}
.ctx-group{font:9px var(--mono);text-transform:uppercase;letter-spacing:.12em;color:var(--text-tertiary);padding:12px 14px 5px}
.ctx-node{display:flex;align-items:center;gap:8px;width:100%;border:0;background:transparent;color:var(--text-secondary);font-size:12px;padding:6px 14px 6px 20px;cursor:pointer;text-align:left}
.ctx-node:hover{color:var(--text-primary);background:var(--accent-glow)}
.ctx-node.active{background:var(--accent-dim);color:var(--text-primary);box-shadow:inset 2px 0 0 var(--accent)}
.ctx-node small{margin-left:auto;font:9px var(--mono);color:var(--text-tertiary)}
.ctx-view{overflow:auto;padding:16px 18px 24px;min-height:0}
.ctx-request{display:flex;align-items:center;gap:8px;margin-bottom:14px;font:9px var(--mono);text-transform:uppercase;letter-spacing:.1em;color:var(--text-tertiary)}

@media(max-width:1100px){.dt-hint{display:none}}
@media(max-width:900px){
  .net-split.has-detail{grid-template-columns:1fr;grid-template-rows:minmax(160px,38%) minmax(0,1fr)}
  .net-detail{border-left:0;border-top:1px solid var(--border)}
  .c-init,.c-size,.c-type{display:none}
  .ctx{grid-template-columns:1fr;grid-template-rows:auto minmax(0,1fr)}
  .ctx-tree{display:flex;flex-wrap:nowrap;overflow-x:auto;padding:4px;border-right:0;border-bottom:1px solid var(--border-subtle)}
  .ctx-group{display:none}.ctx-node{width:auto;white-space:nowrap;padding:7px 10px}
  .con-detail{padding-left:12px}
  .dt-filter input{min-width:0;width:100%}.dt-filter{flex:1 1 200px}
  .dt-kv{grid-template-columns:1fr}
}
@media(prefers-reduced-motion:reduce){*{scroll-behavior:auto!important;transition:none!important}}
`;
