import { PHOSPHOR_ICON_PATHS } from "./dashboard-icons.js";

const ICON_PATHS_JSON = JSON.stringify(PHOSPHOR_ICON_PATHS);

export const DASHBOARD_SCRIPT = String.raw`
const ICON_PATHS=${ICON_PATHS_JSON};
const state={manifest:null,instances:[],subscriptions:[],connections:[],runs:[],events:[],health:null,transmissions:[],accounts:[],routes:[],bindings:[],activations:[],conversations:{},workspaces:{},filters:{runs:"all"},workspaceTab:"entries",showAllEvents:false};
const $=id=>document.getElementById(id);
const esc=value=>String(value??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c]));
const attr=value=>esc(value).replace(/\x60/g,"&#96;");
const fmtDate=iso=>iso?new Date(iso).toLocaleString([],{month:"short",day:"numeric",hour:"2-digit",minute:"2-digit"}):"—";
const fmtTime=iso=>iso?new Date(iso).toLocaleTimeString([],{hour:"2-digit",minute:"2-digit",second:"2-digit"}):"—";
const short=value=>{const text=String(value??"");return text.length>22?text.slice(0,10)+"…"+text.slice(-7):text};
const jsonText=value=>JSON.stringify(value,null,2);
const count=(n,word)=>n+" "+word+(n===1?"":"s");
const icon=(name,className)=>'<svg class="'+(className||"icon")+'" data-phosphor="'+name+'" viewBox="0 0 256 256" fill="currentColor" aria-hidden="true"><path d="'+ICON_PATHS[name]+'"/></svg>';

async function api(url,options){
  const response=await fetch(url,options);let body;
  try{body=await response.json()}catch{body={error:"The runtime returned an unreadable response."}}
  if(!response.ok)throw new Error(body.error||("Request failed ("+response.status+")"));return body;
}
function toast(message){const node=$("toast");node.textContent=message;node.classList.add("show");setTimeout(()=>node.classList.remove("show"),2400)}
function route(){const parts=location.pathname.split("/").filter(Boolean).map(decodeURIComponent);return{parts,section:parts[0]||"overview",id:parts.slice(1).join("/")}}
function go(path){history.pushState({},"",path);void navigate()}
function status(value){return '<span class="status '+attr(value)+'">'+esc(value)+'</span>'}
function tags(values){return(values||[]).map(value=>'<span class="tag">'+esc(value)+'</span>').join("")}
function empty(title,detail){return'<div class="empty"><strong>'+esc(title)+'</strong>'+esc(detail)+'</div>'}
function pageHead(eyebrow,title,detail,actions){return'<div class="page-head"><div><div class="page-rule"></div><div class="eyebrow">'+esc(eyebrow)+'</div><h1>'+esc(title)+'</h1><p>'+esc(detail)+'</p></div>'+(actions?'<div class="actions">'+actions+'</div>':"")+'</div>'}
function card(title,body,meta,classes){return'<section class="card '+(classes||"")+'"><div class="card-head"><h2>'+esc(title)+'</h2>'+(meta?'<span class="meta">'+esc(meta)+'</span>':"")+'</div>'+body+'</section>'}
function metric(label,value,note,accent){return'<section class="card metric '+(accent?"accent":"")+'"><label>'+esc(label)+'</label><strong>'+esc(value)+'</strong><small>'+esc(note)+'</small></section>'}
function dataLinks(){
  document.querySelectorAll("[data-link]").forEach(node=>node.onclick=event=>{if(event.metaKey||event.ctrlKey||event.shiftKey||event.altKey)return;event.preventDefault();go(node.getAttribute("href"))});
  document.querySelectorAll("[data-go]").forEach(node=>node.onclick=event=>{if(event.target.closest("a,button"))return;go(node.dataset.go)});
}
function workspaceIds(){const ids=new Set();state.instances.forEach(x=>ids.add(x.workspaceId));state.subscriptions.forEach(x=>ids.add(x.workspaceId));state.connections.forEach(x=>ids.add(x.workspaceId));state.runs.forEach(x=>{if(x.workspaceId)ids.add(x.workspaceId)});return[...ids].filter(Boolean).sort()}
function definition(id){return state.manifest?.agents?.agents?.find(x=>x.id===id)}
function eventsFor(runId){return state.events.filter(event=>event.runId===runId)}
function isKeyRunEvent(event){
  const type=event.type;
  if(/^run\./.test(type)||/^scheduled-action\./.test(type))return true;
  return /(?:playbooks\.composed|definition\.schedules\.loaded|application\.transmission-tools\.mounted|working-environment\.(?:mounted|snapshot\.saved)|repl\.mounted|subscriber\.mounted|layer\.mounted|installation\.(?:started|completed|failed)|definition\.memory\.mounted|definition\.inboxes\.loaded|tool_use(?:_result)?|model_response_complete)$/.test(type);
}
function activeRuns(){return state.runs.filter(run=>run.status==="pending"||run.status==="running")}
function failureRuns(){return state.runs.filter(run=>run.status==="failed")}
function recent(array){return[...array].sort((a,b)=>String(b.createdAt||b.timestamp||b.updatedAt).localeCompare(String(a.createdAt||a.timestamp||a.updatedAt)))}
function explainRun(run){
  if(run.status==="failed")return run.error||"The runtime could not complete this run.";
  const source=run.input?.source?.kind;
  if(source==="transmission")return"Started by an inbound transmission.";
  if(source==="activation")return"Started by a scheduled activation or wake-up.";
  if(source==="spawn")return"Spawned by another agent run.";
  if(source==="background")return"Continued as background work.";
  if(run.status==="completed")return"The agent completed the requested work.";
  return"The agent is processing a direct message.";
}
function navState(section){const key=section==="overview"?"overview":section;document.querySelectorAll("[data-nav]").forEach(node=>node.classList.toggle("active",node.dataset.nav===key));$("sidebar").classList.remove("open")}
function crumbs(items){$("breadcrumbs").innerHTML=items.map((item,index)=>index===items.length-1?'<span>'+esc(item.label)+'</span>':'<a href="'+attr(item.href)+'" data-link>'+esc(item.label)+'</a><span class="crumb-separator">'+icon("caretRight")+'</span>').join("")}

function renderOverview(){
  crumbs([{label:"Overview"}]);
  const recentRuns=recent(state.runs).slice(0,6);const definitions=state.manifest?.agents?.agents||[];const live=activeRuns();
  let html=pageHead("Runtime at a glance","What is happening now","Start here. Foundry separates code-defined agents from their runtime instances, then records every invocation as a run.",'<a class="button" href="/agents" data-link>Browse agents</a><button class="button primary" data-new-run>Start a run</button>');
  html+='<div class="grid cols-4">'+metric("Agent definitions",definitions.length,"Discovered from the agents folder",true)+metric("Runtime instances",state.instances.length,"Persisted agent identities")+metric("Active work",live.length,live.length?"Runs currently pending or running":"No work in flight")+metric("Attention needed",failureRuns().length,"Failed runs in retained history")+'</div>';
  html+='<div class="grid cols-2" style="margin-top:16px">';
  const activity=recentRuns.map(run=>'<tr class="clickable" data-go="/runs/'+attr(run.id)+'"><td><span class="primary-cell">'+esc(run.agent)+'</span><span class="secondary">'+esc(short(run.id))+'</span></td><td>'+status(run.status)+'</td><td>'+esc(explainRun(run))+'</td><td>'+esc(fmtDate(run.createdAt))+'</td></tr>').join("");
  html+=card("Recent runs",'<div class="table-wrap"><table class="table"><thead><tr><th>Agent</th><th>Status</th><th>Why it ran</th><th>Started</th></tr></thead><tbody>'+activity+'</tbody></table></div>'+(activity?"":empty("No runs yet","Start a run to see its progress and trace here.")),count(state.runs.length,"run"),"span-2");
  const map=definitions.slice(0,6).map(def=>{const instances=state.instances.filter(x=>x.definitionId===def.id);return'<tr class="clickable" data-go="/agents/'+attr(def.id)+'"><td><span class="primary-cell">'+esc(def.id)+'</span><span class="secondary">'+esc(def.description)+'</span></td><td>'+instances.length+'</td><td>'+esc((def.workingEnvironment?"Working environment · ":"")+(def.repl?def.repl+" REPL":"No REPL"))+'</td></tr>'}).join("");
  html+=card("Agent map",'<div class="table-wrap"><table class="table"><thead><tr><th>Definition</th><th>Instances</th><th>Mounted surface</th></tr></thead><tbody>'+map+'</tbody></table></div>',count(definitions.length,"definition"));
  const automationCount=state.activations.length+state.subscriptions.length+state.connections.length;
  html+=card("Background activity",'<div class="card-body">'+(automationCount?'<div class="summary-box"><dl><dt>Scheduled wake-ups</dt><dd>'+state.activations.length+'</dd><dt>Playbook listeners</dt><dd>'+state.subscriptions.length+'</dd><dt>Inbound connections</dt><dd>'+state.connections.length+'</dd></dl><p><a class="link inline-icon" href="/automations" data-link>Inspect automation state '+icon("external")+'</a></p></div>':empty("Nothing is listening yet","Schedules, sleeping runs, playbooks, and app connections appear here."))+'</div>');
  html+='</div>';$("content").innerHTML=html;document.querySelectorAll("[data-new-run]").forEach(x=>x.onclick=openRunDrawer);dataLinks();
}

function renderAgents(){
  crumbs([{label:"Agents"}]);const definitions=state.manifest?.agents?.agents||[];
  let html=pageHead("Code and runtime","Agents","A definition is the code-discovered recipe. An instance is persisted runtime data with its own context, apps, playbooks, and conversations.",'<button class="button primary" data-new-run>Start a run</button>');
  html+='<div class="callout"><span class="symbol">'+icon("definitions")+'</span><div><b>Definitions and instances are intentionally separate.</b><p>Editing a file changes what can be assembled. Updating an instance changes what one runtime identity actually has installed.</p></div></div>';
  html+='<div class="definition-grid">'+definitions.map(def=>{const instances=state.instances.filter(x=>x.definitionId===def.id);const features=[def.workingEnvironment?"VFS":null,def.repl?def.repl+" repl":null,def.mesh?"mesh":null].filter(Boolean);return'<a class="definition-card" href="/agents/'+attr(def.id)+'" data-link><span class="definition-icon">'+icon("agent")+'</span><span class="definition-open">'+icon("external")+'</span><h3>'+esc(def.id)+'</h3><p>'+esc(def.description)+'</p><div>'+tags(features)+'</div><div class="definition-meta"><b>'+count(instances.length,"instance")+'</b><span class="muted mono" style="font-size:9px">'+esc(def.file)+'</span></div></a>'}).join("")+'</div>';
  const rows=recent(state.instances).map(instance=>'<tr class="clickable" data-go="/instances/'+attr(instance.id)+'"><td><span class="primary-cell">'+esc(short(instance.id))+'</span><span class="secondary">'+esc(instance.workspaceId)+'</span></td><td><a class="link" href="/agents/'+attr(instance.definitionId)+'" data-link>'+esc(instance.definitionId)+'</a></td><td>'+instance.installations.length+'</td><td>'+instance.playbooks.length+'</td><td>'+esc(fmtDate(instance.updatedAt))+'</td></tr>').join("");
  html+=card("Runtime instances",'<div class="table-wrap"><table class="table"><thead><tr><th>Instance</th><th>Definition</th><th>Installed</th><th>Playbooks</th><th>Updated</th></tr></thead><tbody>'+rows+'</tbody></table></div>'+(rows?"":empty("No runtime instances","Start a run or create an instance from a definition.")),count(state.instances.length,"instance"));
  $("content").innerHTML=html;document.querySelectorAll("[data-new-run]").forEach(x=>x.onclick=openRunDrawer);dataLinks();
}

function renderDefinition(id){
  const def=definition(id);if(!def)return renderNotFound("Agent definition");
  crumbs([{label:"Agents",href:"/agents"},{label:id}]);
  const instances=state.instances.filter(x=>x.definitionId===id);const caps=state.manifest?.definitions?.[id]?.capabilities||{tools:[],applications:[],mcp:[],memory:[]};const surfaces=state.manifest?.definitions?.[id]?.surfaces||{layers:[],subscribers:[]};
  let html=pageHead("Agent definition",id,def.description,'<button class="button" data-create-instance="'+attr(id)+'">Create instance</button><button class="button primary" data-new-run="'+attr(id)+'">Start a run</button>');
  html+='<div class="detail-strip"><div><label>File route</label><strong class="mono">'+esc(def.file)+'</strong></div><div><label>Assembly</label><strong>'+esc(def.assembly)+" · "+esc(def.handler)+' handler</strong></div><div><label>Runtime surfaces</label><strong>'+(def.workingEnvironment?"Working environment":"No working environment")+(def.repl?" · "+esc(def.repl)+" REPL":"")+'</strong></div><div><label>Lazy fields</label><strong>'+esc(def.lazy.length?def.lazy.join(", "):"None")+'</strong></div></div>';
  const rows=instances.map(x=>'<tr class="clickable" data-go="/instances/'+attr(x.id)+'"><td><span class="primary-cell">'+esc(short(x.id))+'</span><span class="secondary">'+esc(x.workspaceId)+'</span></td><td>'+x.installations.length+'</td><td>'+x.playbooks.length+'</td><td>'+esc(fmtDate(x.updatedAt))+'</td></tr>').join("");
  html+=card("Runtime instances",'<div class="table-wrap"><table class="table"><thead><tr><th>Instance</th><th>Installed</th><th>Playbooks</th><th>Updated</th></tr></thead><tbody>'+rows+'</tbody></table></div>'+(rows?"":empty("No instance exists","Create one now or let a playbook provision one when an inbound event matches.")),count(instances.length,"instance"));
  html+='<div class="grid cols-2">';
  const groups=[["Shared tools",caps.tools],["Applications",caps.applications],["MCP",caps.mcp],["Memory",caps.memory]];
  html+=card("Capability catalogue",'<div class="card-body">'+groups.map(group=>'<div style="margin-bottom:14px"><span class="secondary">'+esc(group[0])+'</span><div class="cap-list">'+(group[1].length?group[1].map(x=>'<span class="cap">'+esc(x.id)+'</span>').join(""):'<span class="muted" style="font-size:11px">None discovered</span>')+'</div></div>').join("")+'</div>',"Available to instances");
  html+=card("Native composition",'<div class="card-body"><div class="summary-box"><dl><dt>Layers</dt><dd>'+esc((surfaces.layers||[]).map(x=>x.id).join(", ")||"None")+'</dd><dt>Subscribers</dt><dd>'+esc((surfaces.subscribers||[]).map(x=>x.id).join(", ")||"None")+'</dd><dt>Calls</dt><dd>'+esc(def.calls.join(", ")||"None")+'</dd><dt>Subagents</dt><dd>'+esc(def.subagents.join(", ")||"None")+'</dd><dt>Schedules</dt><dd>'+esc(def.schedules.join(", ")||"None")+'</dd><dt>Playbooks</dt><dd>'+esc(def.playbooks.join(", ")||"None")+'</dd></dl></div></div>',"Code-defined");
  html+='</div>';$("content").innerHTML=html;document.querySelectorAll("[data-new-run]").forEach(x=>x.onclick=()=>openRunDrawer(id));document.querySelectorAll("[data-create-instance]").forEach(x=>x.onclick=()=>void createInstance(id));dataLinks();
}

async function ensureConversations(agentId){if(!state.conversations[agentId])state.conversations[agentId]=await api("/api/conversations?agent="+encodeURIComponent(agentId))}
function renderInstance(id){
  const instance=state.instances.find(x=>x.id===id);if(!instance)return renderNotFound("Agent instance");
  crumbs([{label:"Agents",href:"/agents"},{label:instance.definitionId,href:"/agents/"+instance.definitionId},{label:short(id)}]);
  const conversations=state.conversations[id]||[];const runs=recent(state.runs.filter(x=>x.agentId===id));
  let html=pageHead("Runtime instance",short(id),"Persisted runtime data assembled from "+instance.definitionId+". This identity can be updated without changing the code definition.",'<button class="button primary" data-instance-run>Send message</button>');
  html+='<div class="detail-strip"><div><label>Definition</label><strong><a class="link" href="/agents/'+attr(instance.definitionId)+'" data-link>'+esc(instance.definitionId)+'</a></strong></div><div><label>Workspace</label><strong><a class="link mono" href="/workspaces/'+attr(instance.workspaceId)+'" data-link>'+esc(instance.workspaceId)+'</a></strong></div><div><label>Conversations</label><strong>'+conversations.length+'</strong></div><div><label>Last updated</label><strong>'+esc(fmtDate(instance.updatedAt))+'</strong></div></div>';
  html+='<div class="grid cols-2">';
  const convRows=recent(conversations).map(c=>'<tr><td><span class="primary-cell">'+esc(c.title||"Untitled conversation")+'</span><span class="secondary">'+esc(short(c.id))+'</span></td><td>'+esc(fmtDate(c.updatedAt))+'</td></tr>').join("");
  html+=card("Conversations",'<div class="table-wrap"><table class="table"><thead><tr><th>Conversation</th><th>Updated</th></tr></thead><tbody>'+convRows+'</tbody></table></div>'+(convRows?"":empty("No conversations","The first message creates a conversation for this instance.")),count(conversations.length,"conversation"));
  const runRows=runs.slice(0,8).map(run=>'<tr class="clickable" data-go="/runs/'+attr(run.id)+'"><td><span class="primary-cell">'+esc(short(run.id))+'</span><span class="secondary">'+esc(explainRun(run))+'</span></td><td>'+status(run.status)+'</td><td>'+esc(fmtDate(run.createdAt))+'</td></tr>').join("");
  html+=card("Recent runs",'<div class="table-wrap"><table class="table"><thead><tr><th>Run</th><th>Status</th><th>Started</th></tr></thead><tbody>'+runRows+'</tbody></table></div>'+(runRows?"":empty("No runs","Send this instance a message to begin.")),count(runs.length,"run"));
  html+=card("Installed capabilities",'<div class="card-body">'+(instance.installations.length?instance.installations.map(x=>'<div class="cap">'+esc(x.kind)+" · "+esc(x.id)+(x.accountId?" · account "+esc(x.accountId):"")+'</div>').join(""):empty("Nothing installed","Applications, MCP servers, and shared tools are instance data."))+'</div>',count(instance.installations.length,"installation"));
  html+=card("Playbooks and context",'<div class="card-body"><div class="summary-box"><dl><dt>Playbooks</dt><dd>'+esc(instance.playbooks.map(x=>x.name||x.id).join(", ")||"None")+'</dd><dt>Context keys</dt><dd>'+esc(Object.keys(instance.context||{}).join(", ")||"None")+'</dd><dt>Provisioning key</dt><dd class="mono">'+esc(instance.provisioningKey||"Directly provisioned")+'</dd></dl></div><details><summary class="link">View stored instance data</summary><pre class="json">'+esc(jsonText(instance))+'</pre></details></div>',"Persisted data");
  html+='</div>';$("content").innerHTML=html;document.querySelector("[data-instance-run]").onclick=()=>openRunDrawer(instance.definitionId,id);dataLinks();
}

function renderRuns(){
  crumbs([{label:"Runs"}]);let runs=recent(state.runs);if(state.filters.runs!=="all")runs=runs.filter(x=>x.status===state.filters.runs);
  let html=pageHead("Execution history","Runs","Each invocation has one status, one result, and a chronological trace. Open a run to follow assembly, model work, tools, and completion.",'<button class="button primary" data-new-run>Start a run</button>');
  html+='<div class="filters"><input id="run-search" placeholder="Search agent, run id, or input…"><select id="run-filter"><option value="all">All statuses</option><option value="running">Running</option><option value="completed">Completed</option><option value="failed">Failed</option><option value="cancelled">Cancelled</option></select></div>';
  const rows=runs.map(run=>'<tr class="clickable run-search-row" data-search="'+attr((run.agent+" "+run.id+" "+jsonText(run.input)).toLowerCase())+'" data-go="/runs/'+attr(run.id)+'"><td><span class="primary-cell">'+esc(run.agent)+'</span><span class="secondary">'+esc(short(run.id))+'</span></td><td>'+status(run.status)+'</td><td>'+esc(run.input?.source?.kind||"direct")+'</td><td>'+run.attempts+" / "+run.maxAttempts+'</td><td>'+esc(fmtDate(run.createdAt))+'</td></tr>').join("");
  html+=card("All runs",'<div class="table-wrap"><table class="table"><thead><tr><th>Agent / run</th><th>Status</th><th>Source</th><th>Attempts</th><th>Started</th></tr></thead><tbody>'+rows+'</tbody></table></div>'+(rows?"":empty("No matching runs","Change the filter or start a new run.")),count(runs.length,"run"));
  $("content").innerHTML=html;$("run-filter").value=state.filters.runs;$("run-filter").onchange=e=>{state.filters.runs=e.target.value;renderRuns()};$("run-search").oninput=e=>{const term=e.target.value.toLowerCase();document.querySelectorAll(".run-search-row").forEach(row=>row.classList.toggle("hidden",!row.dataset.search.includes(term)))};document.querySelector("[data-new-run]").onclick=openRunDrawer;dataLinks();
}

function phaseData(run,events){
  const has=pattern=>events.some(e=>pattern.test(e.type));const time=pattern=>events.find(e=>pattern.test(e.type))?.timestamp;
  return[
    {name:"Accepted",detail:"The runtime recorded the invocation and its source.",state:"complete",time:run.createdAt},
    {name:"Assembled",detail:"Foundry resolved context-dependent tools, memory, apps, layers, and working surfaces.",state:has(/assembly.*complete|agent\.started|run\.started/)?"complete":run.status==="failed"?"error":"active",time:time(/assembly.*complete|run\.started/)},
    {name:"Agent work",detail:has(/tool_/)?"The model used one or more mounted tools.":"The model processed the request with its assembled context.",state:run.status==="running"?"active":run.status==="failed"?"error":"complete",time:time(/model_|text_delta|tool_/)},
    {name:run.status==="failed"?"Failed":run.status==="cancelled"?"Cancelled":run.status==="completed"?"Completed":"In progress",detail:explainRun(run),state:run.status==="failed"||run.status==="cancelled"?"error":run.status==="completed"?"complete":"active",time:run.completedAt||time(/run\.(completed|failed|cancelled)/)}
  ];
}
function renderRun(id){
  const run=state.runs.find(x=>x.id===id);if(!run)return renderNotFound("Run");const events=eventsFor(id);
  const visibleEvents=state.showAllEvents?events:events.filter(isKeyRunEvent);
  crumbs([{label:"Runs",href:"/runs"},{label:short(id)}]);
  let html=pageHead("Run detail",run.agent+" · "+short(id),"Follow the high-level phases first. Expand individual events only when you need raw adapter or model evidence.",run.status==="running"||run.status==="pending"?'<button class="button" data-cancel>Cancel run</button>':"");
  html+='<div class="detail-strip"><div><label>Status</label><strong>'+status(run.status)+'</strong></div><div><label>Source</label><strong>'+esc(run.input?.source?.kind||"direct")+'</strong></div><div><label>Agent instance</label><strong>'+(run.agentId?'<a class="link mono" href="/instances/'+attr(run.agentId)+'" data-link>'+esc(short(run.agentId))+'</a>':"Not recorded")+'</strong></div><div><label>Attempts</label><strong>'+run.attempts+" of "+run.maxAttempts+'</strong></div></div>';
  html+='<div class="grid cols-3"><section class="card span-2"><div class="card-head"><h2>Run spine</h2><span class="meta">'+count(events.length,"event")+'</span></div><div class="card-body"><div class="trace-note">This shows observable work intent and outcomes. It does not expose private hidden chain-of-thought.</div><div class="run-spine">'+phaseData(run,events).map(p=>'<div class="phase '+p.state+'"><span class="phase-dot"></span><div><strong>'+esc(p.name)+'</strong><p>'+esc(p.detail)+'</p></div><time>'+esc(fmtTime(p.time))+'</time></div>').join("")+'</div></div></section>';
  html+=card("Result",'<div class="card-body"><div class="summary-box"><dl><dt>Created</dt><dd>'+esc(fmtDate(run.createdAt))+'</dd><dt>Started</dt><dd>'+esc(fmtDate(run.startedAt))+'</dd><dt>Finished</dt><dd>'+esc(fmtDate(run.completedAt))+'</dd><dt>Timeout</dt><dd>'+Math.round(run.timeoutMs/1000)+' seconds</dd></dl></div><details open><summary class="link">Output</summary><pre class="json">'+esc(jsonText(run.output??run.error??null))+'</pre></details><details><summary class="link">Input</summary><pre class="json">'+esc(jsonText(run.input))+'</pre></details></div>',"Recorded outcome");html+='</div>';
  const eventRows=visibleEvents.map(event=>'<div class="event-row"><button class="event-toggle"><span class="event-time">'+esc(fmtTime(event.timestamp))+'</span><span class="event-category">'+esc(event.category)+'</span><span class="event-type">'+esc(event.type)+'</span><span>⌄</span></button><div class="event-detail"><pre class="json">'+esc(jsonText(event.data))+'</pre></div></div>').join("");
  const eventControl='<div class="card-body" style="display:flex;align-items:center;gap:12px;padding-top:11px;padding-bottom:11px"><span class="muted" style="font-size:11px">'+(state.showAllEvents?"Showing every retained event, including assembly and process detail.":"Showing the lifecycle events that explain this run. Expand one for raw evidence.")+'</span><button class="button" style="margin-left:auto" data-toggle-events>'+(state.showAllEvents?"Show key events":"Show all "+events.length+" events")+'</button></div>';
  html+=card("Observable event trace",eventControl+(eventRows||empty("No key events retained","Show all events to inspect runtime logs.")),count(visibleEvents.length,"event"));
  $("content").innerHTML=html;document.querySelectorAll(".event-toggle").forEach(x=>x.onclick=()=>x.parentElement.classList.toggle("open"));document.querySelector("[data-toggle-events]").onclick=()=>{state.showAllEvents=!state.showAllEvents;renderRun(id)};const cancel=document.querySelector("[data-cancel]");if(cancel)cancel.onclick=()=>void cancelRun(id);dataLinks();
}

function renderAutomations(){
  crumbs([{label:"Automations"}]);let html=pageHead("Background work","Automations","Schedules and sleeps create future activations. Playbook subscriptions listen for inbound transmissions and can provision one or many agent instances.","");
  html+='<div class="grid cols-3">'+metric("Scheduled activations",state.activations.length,"Future triggers and sleeping runs",true)+metric("Playbook subscriptions",state.subscriptions.length,"Inbound event policies")+metric("Application connections",state.connections.length,"Long-lived inbound workers")+'</div>';
  const actRows=recent(state.activations).map(x=>'<tr><td><span class="primary-cell">'+esc(x.kind==="sleep"?"Sleeping run":x.scheduleName||"Scheduled activation")+'</span><span class="secondary">'+esc(short(x.id))+'</span></td><td><a class="link" href="/instances/'+attr(x.agentId)+'" data-link>'+esc(short(x.agentId))+'</a></td><td>'+status(x.status)+'</td><td>'+esc(x.timing?.at||x.timing?.cron||x.timing?.everyMs||"Configured timing")+'</td><td>'+esc(x.origin)+'</td></tr>').join("");
  html+=card("Schedules and sleeps",'<div class="table-wrap"><table class="table"><thead><tr><th>Activation</th><th>Agent</th><th>Status</th><th>Timing</th><th>Origin</th></tr></thead><tbody>'+actRows+'</tbody></table></div>'+(actRows?"":empty("No future activations","Agents create schedules and sleeps through Foundry utility tools.")),count(state.activations.length,"activation"));
  const subRows=state.subscriptions.map(x=>'<tr><td><span class="primary-cell">'+esc(x.playbook?.name||x.playbook?.id||x.id)+'</span><span class="secondary">'+esc(short(x.id))+'</span></td><td>'+status(x.enabled?"enabled":"disabled")+'</td><td>'+esc(x.targets.map(t=>t.definitionId+" · "+t.provisioning.mode).join(", "))+'</td><td>'+esc(x.workspaceId)+'</td></tr>').join("");
  html+=card("Playbook listeners",'<div class="table-wrap"><table class="table"><thead><tr><th>Playbook</th><th>State</th><th>Targets / provisioning</th><th>Workspace</th></tr></thead><tbody>'+subRows+'</tbody></table></div>'+(subRows?"":empty("No playbook subscriptions","Runtime-defined subscriptions appear when a frontend or adapter installs them.")),count(state.subscriptions.length,"subscription"));
  const connRows=state.connections.map(x=>'<tr><td><span class="primary-cell">'+esc(x.applicationId)+'</span><span class="secondary">'+esc(x.connectionId)+'</span></td><td>'+status(x.status)+'</td><td>'+esc(x.definitionId)+'</td><td>'+x.routeIds.length+'</td><td>'+esc(fmtDate(x.lastEventAt))+'</td></tr>').join("");
  html+=card("Inbound application workers",'<div class="table-wrap"><table class="table"><thead><tr><th>Application / connection</th><th>Status</th><th>Definition</th><th>Routes</th><th>Last event</th></tr></thead><tbody>'+connRows+'</tbody></table></div>'+(connRows?"":empty("No inbound workers","A connection starts only when an installed app has an active inbound playbook.")),count(state.connections.length,"connection"));
  $("content").innerHTML=html;dataLinks();
}

function renderIntegrations(){
  crumbs([{label:"Integrations"}]);let html=pageHead("External boundaries","Integrations","Inspect application transmissions and the runtime data that binds accounts, routes, and agent instances. Credential acquisition and refresh remain adapter-owned.","");
  html+='<div class="callout"><span class="symbol">'+icon("secure")+'</span><div><b>Foundry stores references, never credential material.</b><p>Accounts expose safe metadata and opaque adapter ownership. Routes and bindings determine what an instance can receive and send.</p></div></div>';
  const txRows=state.transmissions.map(x=>'<tr><td><span class="primary-cell">'+esc(x.name)+'</span><span class="secondary">'+esc(x.id)+'</span></td><td><span class="tag">'+esc(x.shape)+'</span></td><td>'+x.capabilities.length+'</td><td>'+esc(x.description)+'</td></tr>').join("");
  html+=card("Transmission catalogue",'<div class="table-wrap"><table class="table"><thead><tr><th>Transmission</th><th>Shape</th><th>Capabilities</th><th>Purpose</th></tr></thead><tbody>'+txRows+'</tbody></table></div>'+(txRows?"":empty("No transmissions discovered","Install an agent-local application definition to add inbound or outbound behavior.")),count(state.transmissions.length,"transmission"));
  html+='<div class="grid cols-3">';
  html+=card("Accounts",'<div class="card-body">'+(state.accounts.length?state.accounts.map(x=>'<div class="kv-item"><strong>'+esc(x.label||x.externalAccountId)+'</strong><small>'+esc(x.transmissionId)+" · "+esc(short(x.id))+'</small></div>').join(""):empty("No accounts","Account references are supplied by the application adapter."))+'</div>',count(state.accounts.length,"account"));
  html+=card("Routes",'<div class="card-body">'+(state.routes.length?state.routes.map(x=>'<div class="kv-item"><strong>'+esc(x.id)+'</strong><small>'+esc(x.direction)+" · "+esc(x.transmissionId)+'</small><div>'+status(x.enabled?"enabled":"disabled")+'</div></div>').join(""):empty("No routes","Routes are runtime data for transmission paths."))+'</div>',count(state.routes.length,"route"));
  html+=card("Agent bindings",'<div class="card-body">'+(state.bindings.length?state.bindings.map(x=>'<div class="kv-item"><strong>'+esc(short(x.agentId))+'</strong><small>'+esc(x.transmissionId)+" · "+x.capabilities.length+' capabilities</small><div>'+status(x.enabled?"enabled":"disabled")+'</div></div>').join(""):empty("No bindings","Bindings grant an instance access to routes and capabilities."))+'</div>',count(state.bindings.length,"binding"));
  html+='</div>';$("content").innerHTML=html;dataLinks();
}

async function ensureWorkspace(id){if(!id)return;const values=await Promise.all(["entries","inbox","tasks","environment"].map(surface=>api("/api/workspaces/"+encodeURIComponent(id)+"/"+surface)));state.workspaces[id]={entries:values[0],inbox:values[1],tasks:values[2],environment:values[3]}}
function renderWorkspaces(id){
  const ids=workspaceIds();if(!id&&ids.length){go("/workspaces/"+encodeURIComponent(ids[0]));return}
  crumbs(id?[{label:"Workspaces",href:"/workspaces"},{label:id}]:[{label:"Workspaces"}]);
  if(!id){$("content").innerHTML=pageHead("Shared data","Workspaces","Workspaces hold shared entries, an inbox, tasks, and safe environment values across agent instances.","")+empty("No workspaces yet","Create an agent instance with a workspace id to begin.");return}
  const data=state.workspaces[id]||{entries:[],inbox:[],tasks:[],environment:[]};const localInstances=state.instances.filter(x=>x.workspaceId===id);
  let html=pageHead("Shared data","Workspace · "+id,"Inspect collaboration state shared by this workspace. Secret environment values are intentionally never exposed.",'<select class="button" id="workspace-select">'+ids.map(x=>'<option value="'+attr(x)+'" '+(x===id?"selected":"")+'>'+esc(x)+'</option>').join("")+'</select>');
  html+='<div class="grid cols-4">'+metric("Agent instances",localInstances.length,"Runtime identities in this workspace",true)+metric("Shared entries",data.entries.length,"Documents and structured values")+metric("Inbox items",data.inbox.length,"Cross-agent and external handoffs")+metric("Open tasks",data.tasks.filter(x=>x.status==="open"||x.status==="in-progress").length,"Work still requiring action")+'</div>';
  html+='<div class="workspace-tabs"><button data-tab="entries">Entries</button><button data-tab="inbox">Inbox</button><button data-tab="tasks">Tasks</button><button data-tab="environment">Environment</button></div><div id="workspace-panel"></div>';
  $("content").innerHTML=html;$("workspace-select").onchange=e=>go("/workspaces/"+encodeURIComponent(e.target.value));document.querySelectorAll("[data-tab]").forEach(x=>x.onclick=()=>{state.workspaceTab=x.dataset.tab;renderWorkspacePanel(data)});renderWorkspacePanel(data);dataLinks();
}
function renderWorkspacePanel(data){
  document.querySelectorAll("[data-tab]").forEach(x=>x.classList.toggle("active",x.dataset.tab===state.workspaceTab));const values=data[state.workspaceTab]||[];let body="";
  if(state.workspaceTab==="entries")body=values.length?'<div class="kv">'+values.map(x=>'<div class="kv-item"><strong>'+esc(x.key)+'</strong><small>Updated '+esc(fmtDate(x.updatedAt))+'</small><div class="kv-value">'+esc(typeof x.value==="string"?x.value:jsonText(x.value))+'</div></div>').join("")+'</div>':empty("No shared entries","Agents can place documents and structured data into this workspace.");
  if(state.workspaceTab==="inbox")body=values.length?'<div class="table-wrap"><table class="table"><thead><tr><th>Topic</th><th>Agent</th><th>Status</th><th>Updated</th></tr></thead><tbody>'+recent(values).map(x=>'<tr><td><span class="primary-cell">'+esc(x.topic)+'</span><span class="secondary">'+esc(short(x.id))+'</span></td><td>'+esc(short(x.agentId||"shared"))+'</td><td>'+status(x.status)+'</td><td>'+esc(fmtDate(x.updatedAt))+'</td></tr>').join("")+'</tbody></table></div>':empty("Inbox is clear","Shared handoffs and external requests will appear here.");
  if(state.workspaceTab==="tasks")body=values.length?'<div class="table-wrap"><table class="table"><thead><tr><th>Task</th><th>Owner</th><th>Status</th><th>Updated</th></tr></thead><tbody>'+recent(values).map(x=>'<tr><td><span class="primary-cell">'+esc(x.title)+'</span><span class="secondary">'+esc(x.detail||short(x.id))+'</span></td><td>'+esc(short(x.agentId||"workspace"))+'</td><td>'+status(x.status)+'</td><td>'+esc(fmtDate(x.updatedAt))+'</td></tr>').join("")+'</tbody></table></div>':empty("No tasks","Agents can create shared tasks for work that spans conversations.");
  if(state.workspaceTab==="environment")body='<div class="callout"><span class="symbol">'+icon("secure")+'</span><div><b>Only safe values are visible.</b><p>Credential material remains inside user-owned adapters and is never returned by this endpoint.</p></div></div>'+(values.length?'<div class="kv">'+values.map(x=>'<div class="kv-item"><strong>'+esc(x.key)+'</strong><small>'+esc(x.scope)+'</small><div class="kv-value">'+esc(typeof x.value==="string"?x.value:jsonText(x.value))+'</div></div>').join("")+'</div>':empty("No public environment values","Mount an environment adapter to expose non-secret context."));
  $("workspace-panel").innerHTML=card(state.workspaceTab[0].toUpperCase()+state.workspaceTab.slice(1),'<div class="card-body">'+body+'</div>',count(values.length,"item"));
}

function renderNotFound(label){crumbs([{label:"Not found"}]);$("content").innerHTML=pageHead("Inspector",label+" not found","The requested runtime record does not exist or is no longer retained.",'<a class="button" href="/" data-link>Return to overview</a>');dataLinks()}
async function loadBase(){
  const endpoints=["/api/manifest","/api/agent-instances","/api/playbook-subscriptions","/api/application-connections","/api/runs","/api/events","/health","/api/transmissions","/api/accounts","/api/routes","/api/bindings","/api/activations"];
  const results=await Promise.all(endpoints.map(url=>api(url)));[state.manifest,state.instances,state.subscriptions,state.connections,state.runs,state.events,state.health,state.transmissions,state.accounts,state.routes,state.bindings,state.activations]=results;renderHealth();
}
async function refreshActivity(){
  try{const endpoints=["/api/agent-instances","/api/playbook-subscriptions","/api/application-connections","/api/runs","/api/events","/api/activations","/health"];const values=await Promise.all(endpoints.map(url=>api(url)));[state.instances,state.subscriptions,state.connections,state.runs,state.events,state.activations,state.health]=values;renderHealth();await navigate(false)}catch{$("event-state").textContent="Refresh paused"}
}
function renderHealth(){const ok=Boolean(state.health?.ok);$("runtime-state").classList.toggle("bad",!ok);$("runtime-state").querySelector("span").textContent=ok?"Runtime healthy":"Runtime needs attention"}
async function navigate(load=true){
  const current=route();navState(current.section);
  try{
    if(load&&current.section==="instances"&&current.id)await ensureConversations(current.id);
    if(load&&current.section==="workspaces"&&current.id)await ensureWorkspace(current.id);
    if(current.section==="overview")renderOverview();else if(current.section==="agents"&&!current.id)renderAgents();else if(current.section==="agents")renderDefinition(current.id);else if(current.section==="instances")renderInstance(current.id);else if(current.section==="runs"&&!current.id)renderRuns();else if(current.section==="runs")renderRun(current.id);else if(current.section==="automations")renderAutomations();else if(current.section==="integrations")renderIntegrations();else if(current.section==="workspaces")renderWorkspaces(current.id);else renderNotFound("Page");
  }catch(error){$("content").innerHTML='<div class="form-error">'+esc(error.message)+'</div>';console.error(error)}
}

function openRunDrawer(definitionId,instanceId){
  const definitions=state.manifest?.agents?.agents||[];$("run-definition").innerHTML=definitions.map(x=>'<option value="'+attr(x.id)+'">'+esc(x.id)+'</option>').join("");
  if(typeof definitionId==="string"&&definition(definitionId))$("run-definition").value=definitionId;updateInstanceOptions(instanceId);$("run-message").value="";$("run-form-error").classList.add("hidden");$("drawer").classList.add("open");setTimeout(()=>$("run-message").focus(),20);
}
function closeRunDrawer(){$("drawer").classList.remove("open")}
function updateInstanceOptions(selected){const definitionId=$("run-definition").value;const instances=state.instances.filter(x=>x.definitionId===definitionId);$("run-instance").innerHTML='<option value="">Create a new instance</option>'+instances.map(x=>'<option value="'+attr(x.id)+'">'+esc(short(x.id))+" · "+esc(x.workspaceId)+'</option>').join("");if(selected&&instances.some(x=>x.id===selected))$("run-instance").value=selected}
async function createInstance(definitionId){try{const workspace=workspaceIds()[0]||"foundry-dashboard";const instance=await api("/api/agent-instances",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({definitionId,workspaceId:workspace})});state.instances=[...state.instances,instance];toast("Instance created");go("/instances/"+encodeURIComponent(instance.id))}catch(error){toast(error.message)}}
async function startRun(event){
  event.preventDefault();const errorNode=$("run-form-error");errorNode.classList.add("hidden");
  try{
    const definitionId=$("run-definition").value;let instance=state.instances.find(x=>x.id===$("run-instance").value);
    if(!instance){instance=await api("/api/agent-instances",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({definitionId,workspaceId:workspaceIds()[0]||"foundry-dashboard"})});state.instances=[...state.instances,instance]}
    await ensureConversations(instance.id);let conversation=state.conversations[instance.id][0];
    if(!conversation){conversation=await api("/api/conversations",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({agentId:instance.id,title:"Foundry inspector"})});state.conversations[instance.id]=[conversation]}
    const run=await api("/api/conversations/"+encodeURIComponent(conversation.id)+"/messages",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({agentId:instance.id,message:$("run-message").value})});state.runs=[...state.runs,run];closeRunDrawer();toast("Run accepted");go("/runs/"+encodeURIComponent(run.id));
  }catch(error){errorNode.textContent=error.message;errorNode.classList.remove("hidden")}
}
async function cancelRun(id){try{await api("/api/runs/"+encodeURIComponent(id)+"/cancel",{method:"POST"});toast("Cancellation requested");await refreshActivity()}catch(error){toast(error.message)}}

function searchItems(){
  const items=[{label:"Overview",detail:"Runtime health and recent activity",path:"/"},{label:"Agents",detail:"Definitions and runtime instances",path:"/agents"},{label:"Runs",detail:"Execution history and traces",path:"/runs"},{label:"Automations",detail:"Schedules, sleeps, playbooks, and connections",path:"/automations"},{label:"Integrations",detail:"Transmissions, routes, accounts, and bindings",path:"/integrations"},{label:"Workspaces",detail:"Shared entries, inbox, tasks, and environment",path:"/workspaces"}];
  (state.manifest?.agents?.agents||[]).forEach(x=>items.push({label:x.id,detail:"Agent definition · "+x.description,path:"/agents/"+x.id}));state.instances.forEach(x=>items.push({label:short(x.id),detail:"Agent instance · "+x.definitionId,path:"/instances/"+x.id}));recent(state.runs).slice(0,100).forEach(x=>items.push({label:short(x.id),detail:"Run · "+x.agent+" · "+x.status,path:"/runs/"+x.id}));return items;
}
function renderSearch(){const term=$("search-input").value.trim().toLowerCase();const matches=searchItems().filter(x=>!term||(x.label+" "+x.detail).toLowerCase().includes(term)).slice(0,12);$("search-results").innerHTML=matches.map(x=>'<a class="search-result" href="'+attr(x.path)+'" data-search-link><strong>'+esc(x.label)+'</strong><small>'+esc(x.detail)+'</small></a>').join("")||empty("No matches","Try an agent id, instance id, run id, or page name.");document.querySelectorAll("[data-search-link]").forEach(x=>x.onclick=e=>{e.preventDefault();closeSearch();go(x.getAttribute("href"))})}
function openSearch(){$("search-modal").classList.add("open");$("search-input").value="";renderSearch();setTimeout(()=>$("search-input").focus(),20)}function closeSearch(){$("search-modal").classList.remove("open")}

$("new-run").onclick=()=>openRunDrawer();$("close-drawer").onclick=closeRunDrawer;$("cancel-run").onclick=closeRunDrawer;$("drawer").onclick=e=>{if(e.target===$("drawer"))closeRunDrawer()};$("run-definition").onchange=()=>updateInstanceOptions();$("run-form").onsubmit=startRun;$("open-search").onclick=openSearch;$("search-input").oninput=renderSearch;$("search-modal").onclick=e=>{if(e.target===$("search-modal"))closeSearch()};$("mobile-toggle").onclick=()=>$("sidebar").classList.toggle("open");window.onpopstate=()=>void navigate();document.addEventListener("keydown",e=>{if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==="k"){e.preventDefault();openSearch()}if(e.key==="Escape"){closeSearch();closeRunDrawer()}});
loadBase().then(async()=>{await navigate();const stream=new EventSource("/api/events");stream.onopen=()=>{$("event-state").textContent="Live updates"};stream.onmessage=()=>void refreshActivity();stream.onerror=()=>{$("event-state").textContent="Reconnecting…"};setInterval(()=>void refreshActivity(),10000)}).catch(error=>{$("content").innerHTML='<div class="form-error"><strong>Could not open Foundry.</strong><br>'+esc(error.message)+'</div>';$("runtime-state").classList.add("bad");$("runtime-state").querySelector("span").textContent="Runtime unavailable"});
`;
