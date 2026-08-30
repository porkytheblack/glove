import { PHOSPHOR_ICON_PATHS } from "./dashboard-icons.js";

const ICON_PATHS_JSON = JSON.stringify(PHOSPHOR_ICON_PATHS);

export const DASHBOARD_SCRIPT = String.raw`
const ICON_PATHS=${ICON_PATHS_JSON};
const state={manifest:null,instances:[],subscriptions:[],connections:[],runs:[],events:[],health:null,transmissions:[],accounts:[],routes:[],bindings:[],activations:[],conversations:{},workspaces:{},showAllEvents:false,eventCategory:"all",ready:false,cursor:-1,liveAt:null};
const $=id=>document.getElementById(id);
const esc=value=>String(value??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c]));
const attr=value=>esc(value).replace(/\x60/g,"&#96;");
const fmtDate=iso=>iso?new Date(iso).toLocaleString([],{month:"short",day:"numeric",hour:"2-digit",minute:"2-digit"}):"—";
const fmtTime=iso=>iso?new Date(iso).toLocaleTimeString([],{hour:"2-digit",minute:"2-digit",second:"2-digit"}):"—";
const short=value=>{const text=String(value??"");return text.length>22?text.slice(0,10)+"…"+text.slice(-7):text};
const jsonText=value=>JSON.stringify(value,null,2);
const count=(n,word)=>n+" "+word+(n===1?"":"s");
const icon=(name,className)=>'<svg class="'+(className||"icon")+'" data-phosphor="'+name+'" viewBox="0 0 256 256" fill="currentColor" aria-hidden="true"><path d="'+ICON_PATHS[name]+'"/></svg>';

/* ---- Elapsed time. Operators read runs in "how long ago" and "how long did it take". ---- */
const DAY=86400000;
function spanText(ms){
  const seconds=Math.round(ms/1000);if(seconds<60)return seconds+"s";
  const minutes=Math.round(seconds/60);if(minutes<60)return minutes+"m";
  const hours=Math.round(minutes/60);if(hours<24)return hours+"h";
  const days=Math.round(hours/24);if(days<30)return days+"d";
  return Math.round(days/30)+"mo";
}
function relTime(iso){
  if(!iso)return"—";
  const then=new Date(iso).getTime();if(!Number.isFinite(then))return"—";
  const delta=Date.now()-then;
  if(delta<-1000)return"in "+spanText(-delta);
  if(delta<5000)return"just now";
  return spanText(delta)+" ago";
}
function durationText(ms){
  if(!Number.isFinite(ms)||ms<0)return"—";
  if(ms<1000)return Math.round(ms)+"ms";
  if(ms<60000)return(ms/1000).toFixed(ms<10000?2:1)+"s";
  const minutes=Math.floor(ms/60000);const seconds=Math.round(ms%60000/1000);
  if(minutes<60)return minutes+"m "+seconds+"s";
  return Math.floor(minutes/60)+"h "+minutes%60+"m";
}
function fullDate(iso){return iso?new Date(iso).toLocaleString([],{weekday:"short",month:"short",day:"numeric",year:"numeric",hour:"2-digit",minute:"2-digit",second:"2-digit"}):"Not recorded"}
function isLiveRun(run){return run.status==="running"||run.status==="pending"}
function runStartedAt(run){return run.startedAt||run.createdAt}
function runDurationMs(run){
  const start=new Date(runStartedAt(run)).getTime();if(!Number.isFinite(start))return NaN;
  const finished=run.completedAt?new Date(run.completedAt).getTime():isLiveRun(run)?Date.now():NaN;
  return Number.isFinite(finished)?finished-start:NaN;
}
/* A relative timestamp that the one-second ticker keeps current without a re-render. */
function relCell(iso){return iso?'<time class="rel" data-rel="'+attr(iso)+'" title="'+attr(fullDate(iso))+'">'+esc(relTime(iso))+'</time>':'<span class="muted">—</span>'}
function durCell(run){
  const live=isLiveRun(run)&&Boolean(runStartedAt(run));
  const text=durationText(runDurationMs(run));
  return'<span class="dur'+(live?" live":"")+'"'+(live?' data-since="'+attr(runStartedAt(run))+'"':"")+' title="'+attr(live?"Still running":"Total run duration")+'">'+esc(text)+'</span>';
}
function tickTimes(){
  document.querySelectorAll("[data-rel]").forEach(node=>{const next=relTime(node.dataset.rel);if(node.textContent!==next)node.textContent=next});
  document.querySelectorAll("[data-since]").forEach(node=>{const started=new Date(node.dataset.since).getTime();const next=Number.isFinite(started)?durationText(Date.now()-started):"—";if(node.textContent!==next)node.textContent=next});
}

/* ---- Copy. Ids are truncated for scanning, so every one of them stays retrievable. ---- */
function copyButton(value,label){return'<button class="copy-btn" type="button" data-copy="'+attr(value)+'" title="Copy '+attr(label||value)+'" aria-label="Copy '+attr(label||value)+'">'+icon("copy")+icon("check","icon copy-ok")+'</button>'}
function idCell(value,extraClass){return'<span class="id-cell '+(extraClass||"")+'"><span class="mono">'+esc(short(value))+'</span>'+copyButton(value)+'</span>'}
async function copyValue(button){
  const value=button.dataset.copy;
  try{
    if(navigator.clipboard&&window.isSecureContext){await navigator.clipboard.writeText(value)}
    else{
      const area=document.createElement("textarea");area.value=value;area.setAttribute("readonly","");
      area.style.position="fixed";area.style.top="-1000px";area.style.opacity="0";
      document.body.appendChild(area);area.select();document.execCommand("copy");area.remove();
    }
    button.classList.add("copied");setTimeout(()=>button.classList.remove("copied"),1200);
    toast("Copied "+short(value));
  }catch{toast("Could not copy to the clipboard")}
}

/* ---- View state. Live updates repaint the page, so the parts a person is
       actively using -- scroll, focus, caret, expanded rows -- survive it. ---- */
function captureView(){
  const active=document.activeElement;
  return{
    scroll:window.scrollY,
    focus:active&&active.id?active.id:null,
    caret:active&&typeof active.selectionStart==="number"?active.selectionStart:null,
    open:[...document.querySelectorAll("[data-event-key].open")].map(node=>node.dataset.eventKey),
    details:[...document.querySelectorAll("details[data-persist]")].filter(node=>node.open).map(node=>node.dataset.persist)
  };
}
function restoreView(view){
  if(!view)return;
  if(view.open.length)document.querySelectorAll("[data-event-key]").forEach(node=>{if(view.open.includes(node.dataset.eventKey))node.classList.add("open")});
  if(view.details.length)document.querySelectorAll("details[data-persist]").forEach(node=>{if(view.details.includes(node.dataset.persist))node.open=true});
  if(view.focus){
    const node=$(view.focus);
    if(node&&node!==document.activeElement){
      node.focus({preventScroll:true});
      if(view.caret!==null&&typeof node.setSelectionRange==="function"){try{node.setSelectionRange(view.caret,view.caret)}catch{}}
    }
  }
  if(view.scroll)window.scrollTo(0,view.scroll);
}
function skeleton(rows){
  let html="";for(let index=0;index<(rows||5);index++)html+='<div class="skeleton-row"><span style="width:'+(46+index*7%34)+'%"></span><span style="width:'+(16+index*5%14)+'%"></span></div>';
  return'<div class="skeleton" aria-busy="true" aria-label="Loading">'+html+'</div>';
}

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
  document.querySelectorAll("[data-copy]").forEach(node=>node.onclick=event=>{event.preventDefault();event.stopPropagation();void copyValue(node)});
  syncCursor();
}
/* ---- Row cursor. j/k walk a list and Enter opens it, without reaching for the mouse. ---- */
function cursorRows(){return[...document.querySelectorAll("[data-go]")]}
function syncCursor(){
  const rows=cursorRows();
  if(state.cursor>=rows.length)state.cursor=rows.length-1;
  rows.forEach((row,index)=>row.classList.toggle("cursor",index===state.cursor));
}
function moveCursor(delta){
  const rows=cursorRows();if(!rows.length)return;
  state.cursor=state.cursor<0?(delta>0?0:rows.length-1):Math.min(rows.length-1,Math.max(0,state.cursor+delta));
  syncCursor();
  const row=rows[state.cursor];
  if(row)row.scrollIntoView({block:"nearest"});
}
function openCursor(){
  const row=cursorRows()[state.cursor];
  if(row)go(row.dataset.go);
}
function isTyping(){
  const node=document.activeElement;if(!node)return false;
  const tag=node.tagName;
  return tag==="INPUT"||tag==="TEXTAREA"||tag==="SELECT"||node.isContentEditable;
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
  const activity=recentRuns.map(run=>'<tr class="clickable'+(run.status==="failed"?" row-failed":"")+(isLiveRun(run)?" row-live":"")+'" data-go="/runs/'+attr(run.id)+'"><td><span class="primary-cell">'+esc(run.agent)+'</span><span class="secondary">'+esc(explainRun(run))+'</span></td><td>'+status(run.status)+'</td><td>'+idCell(run.id)+'</td><td>'+durCell(run)+'</td><td>'+relCell(run.createdAt)+'</td></tr>').join("");
  html+=card("Recent runs",'<div class="table-wrap"><table class="table"><thead><tr><th>Agent</th><th>Status</th><th>Run</th><th>Duration</th><th>Started</th></tr></thead><tbody>'+activity+'</tbody></table></div>'+(activity?"":(state.ready?empty("No runs yet","Start a run to see its progress and trace here."):skeleton(4)))+'<div class="card-foot"><a class="link inline-icon" href="/runs" data-link>View all runs '+icon("external")+'</a></div>',count(state.runs.length,"run"),"span-2");
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
  const rows=recent(state.instances).map(instance=>'<tr class="clickable" data-go="/instances/'+attr(instance.id)+'"><td>'+idCell(instance.id)+'<span class="secondary">'+esc(instance.workspaceId)+'</span></td><td><a class="link" href="/agents/'+attr(instance.definitionId)+'" data-link>'+esc(instance.definitionId)+'</a></td><td>'+instance.installations.length+'</td><td>'+instance.playbooks.length+'</td><td>'+relCell(instance.updatedAt)+'</td></tr>').join("");
  html+=card("Runtime instances",'<div class="table-wrap"><table class="table"><thead><tr><th>Instance</th><th>Definition</th><th>Installed</th><th>Playbooks</th><th>Updated</th></tr></thead><tbody>'+rows+'</tbody></table></div>'+(rows?"":empty("No runtime instances","Start a run or create an instance from a definition.")),count(state.instances.length,"instance"));
  $("content").innerHTML=html;document.querySelectorAll("[data-new-run]").forEach(x=>x.onclick=openRunDrawer);dataLinks();
}

function renderDefinition(id){
  const def=definition(id);if(!def)return renderNotFound("Agent definition");
  crumbs([{label:"Agents",href:"/agents"},{label:id}]);
  const instances=state.instances.filter(x=>x.definitionId===id);const caps=state.manifest?.definitions?.[id]?.capabilities||{tools:[],applications:[],mcp:[],memory:[]};const surfaces=state.manifest?.definitions?.[id]?.surfaces||{layers:[],subscribers:[]};
  let html=pageHead("Agent definition",id,def.description,'<button class="button" data-create-instance="'+attr(id)+'">Create instance</button><button class="button primary" data-new-run="'+attr(id)+'">Start a run</button>');
  html+='<div class="detail-strip"><div><label>File route</label><strong class="mono">'+esc(def.file)+'</strong></div><div><label>Assembly</label><strong>'+esc(def.assembly)+" · "+esc(def.handler)+' handler</strong></div><div><label>Runtime surfaces</label><strong>'+(def.workingEnvironment?"Working environment":"No working environment")+(def.repl?" · "+esc(def.repl)+" REPL":"")+'</strong></div><div><label>Lazy fields</label><strong>'+esc(def.lazy.length?def.lazy.join(", "):"None")+'</strong></div></div>';
  const rows=instances.map(x=>'<tr class="clickable" data-go="/instances/'+attr(x.id)+'"><td>'+idCell(x.id)+'<span class="secondary">'+esc(x.workspaceId)+'</span></td><td>'+x.installations.length+'</td><td>'+x.playbooks.length+'</td><td>'+relCell(x.updatedAt)+'</td></tr>').join("");
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
  let html=pageHead("Runtime instance",short(id),"Persisted runtime data assembled from "+instance.definitionId+". This identity can be updated without changing the code definition.",'<button class="button" data-copy="'+attr(id)+'">'+icon("copy")+'<span>Copy instance id</span></button><button class="button primary" data-instance-run>Send message</button>');
  html+='<div class="detail-strip"><div><label>Definition</label><strong><a class="link" href="/agents/'+attr(instance.definitionId)+'" data-link>'+esc(instance.definitionId)+'</a></strong></div><div><label>Workspace</label><strong><a class="link mono" href="/workspaces/'+attr(instance.workspaceId)+'" data-link>'+esc(instance.workspaceId)+'</a></strong></div><div><label>Conversations</label><strong>'+conversations.length+'</strong></div><div><label>Last updated</label><strong>'+relCell(instance.updatedAt)+'</strong></div></div>';
  html+='<div class="grid cols-2">';
  const convRows=recent(conversations).map(c=>'<tr><td><span class="primary-cell">'+esc(c.title||"Untitled conversation")+'</span>'+idCell(c.id)+'</td><td>'+relCell(c.updatedAt)+'</td></tr>').join("");
  html+=card("Conversations",'<div class="table-wrap"><table class="table"><thead><tr><th>Conversation</th><th>Updated</th></tr></thead><tbody>'+convRows+'</tbody></table></div>'+(convRows?"":empty("No conversations","The first message creates a conversation for this instance.")),count(conversations.length,"conversation"));
  const runRows=runs.slice(0,8).map(run=>'<tr class="clickable'+(run.status==="failed"?" row-failed":"")+(isLiveRun(run)?" row-live":"")+'" data-go="/runs/'+attr(run.id)+'"><td>'+idCell(run.id)+'<span class="secondary">'+esc(explainRun(run))+'</span></td><td>'+status(run.status)+'</td><td>'+durCell(run)+'</td><td>'+relCell(run.createdAt)+'</td></tr>').join("");
  html+=card("Recent runs",'<div class="table-wrap"><table class="table"><thead><tr><th>Run</th><th>Status</th><th>Duration</th><th>Started</th></tr></thead><tbody>'+runRows+'</tbody></table></div>'+(runRows?"":empty("No runs","Send this instance a message to begin."))+(runs.length>8?'<div class="card-foot"><a class="link inline-icon" href="/runs?q='+encodeURIComponent(instance.id)+'" data-link>View all '+count(runs.length,"run")+' '+icon("external")+'</a></div>':""),count(runs.length,"run"));
  html+=card("Installed capabilities",'<div class="card-body">'+(instance.installations.length?instance.installations.map(x=>'<div class="cap">'+esc(x.kind)+" · "+esc(x.id)+(x.accountId?" · account "+esc(x.accountId):"")+'</div>').join(""):empty("Nothing installed","Applications, MCP servers, and shared tools are instance data."))+'</div>',count(instance.installations.length,"installation"));
  html+=card("Playbooks and context",'<div class="card-body"><div class="summary-box"><dl><dt>Playbooks</dt><dd>'+esc(instance.playbooks.map(x=>x.name||x.id).join(", ")||"None")+'</dd><dt>Context keys</dt><dd>'+esc(Object.keys(instance.context||{}).join(", ")||"None")+'</dd><dt>Provisioning key</dt><dd class="mono">'+esc(instance.provisioningKey||"Directly provisioned")+'</dd></dl></div><details><summary class="link">View stored instance data</summary><pre class="json">'+esc(jsonText(instance))+'</pre></details></div>',"Persisted data");
  html+='</div>';$("content").innerHTML=html;document.querySelector("[data-instance-run]").onclick=()=>openRunDrawer(instance.definitionId,id);dataLinks();
}

/* ---- Run filters live in the URL, so a filtered view is a link you can send. ---- */
function runQuery(){
  const params=new URLSearchParams(location.search);
  return{status:params.get("status")||"all",source:params.get("source")||"all",q:params.get("q")||""};
}
function setRunQuery(patch){
  const next=Object.assign(runQuery(),patch);
  const params=new URLSearchParams();
  if(next.status!=="all")params.set("status",next.status);
  if(next.source!=="all")params.set("source",next.source);
  if(next.q)params.set("q",next.q);
  const search=params.toString();
  history.replaceState({},"",location.pathname+(search?"?"+search:""));
  return next;
}
function runSource(run){return run.input?.source?.kind||"direct"}
function matchesStatus(run,status){
  if(status==="all")return true;
  if(status==="running")return isLiveRun(run);
  return run.status===status;
}
function filterRuns(runs,query){
  const term=query.q.trim().toLowerCase();
  return runs.filter(run=>{
    if(!matchesStatus(run,query.status))return false;
    if(query.source!=="all"&&runSource(run)!==query.source)return false;
    if(!term)return true;
    return(run.agent+" "+run.id+" "+(run.agentId||"")+" "+jsonText(run.input)).toLowerCase().includes(term);
  });
}
function statusSegments(runs,active){
  const options=[["all","All"],["running","Running"],["completed","Completed"],["failed","Failed"],["cancelled","Cancelled"]];
  return'<div class="segmented" role="tablist" aria-label="Filter runs by status">'+options.map(option=>{
    const total=runs.filter(run=>matchesStatus(run,option[0])).length;
    const on=active===option[0];
    return'<button type="button" role="tab" aria-selected="'+(on?"true":"false")+'" class="'+(on?"active":"")+'" data-status="'+attr(option[0])+'">'+esc(option[1])+'<span class="seg-count">'+total+'</span></button>';
  }).join("")+'</div>';
}
function runRow(run,showAgent){
  const failed=run.status==="failed";
  return'<tr class="clickable run-row'+(failed?" row-failed":"")+(isLiveRun(run)?" row-live":"")+'" data-go="/runs/'+attr(run.id)+'">'
    +(showAgent===false?"":'<td><span class="primary-cell">'+esc(run.agent)+'</span><span class="secondary">'+esc(explainRun(run))+'</span></td>')
    +'<td>'+status(run.status)+'</td>'
    +'<td>'+idCell(run.id)+'</td>'
    +'<td><span class="tag">'+esc(runSource(run))+'</span></td>'
    +'<td>'+durCell(run)+'</td>'
    +'<td>'+(run.attempts>1?'<span class="attempts warn">'+run.attempts+" / "+run.maxAttempts+'</span>':'<span class="attempts">'+run.attempts+" / "+run.maxAttempts+'</span>')+'</td>'
    +'<td>'+relCell(run.createdAt)+'</td></tr>';
}
function renderRuns(){
  crumbs([{label:"Runs"}]);
  const query=runQuery();const all=recent(state.runs);const runs=filterRuns(all,query);
  const sources=[...new Set(all.map(runSource))].sort();
  const live=all.filter(isLiveRun).length;
  let html=pageHead("Execution history","Runs","Each invocation has one status, one result, and a chronological trace. Filters stay in the address bar, so any view here is a link you can share.",'<button class="button" data-refresh>'+icon("refresh")+'<span>Refresh</span></button><button class="button primary" data-new-run>'+icon("plus")+'<span>Start a run</span></button>');
  html+='<div class="toolbar">'+statusSegments(all,query.status)
    +'<div class="toolbar-right">'
    +'<label class="search-field"><span class="search-field-icon">'+icon("search")+'</span><input id="run-search" value="'+attr(query.q)+'" placeholder="Search agent, run id, or input…" aria-label="Search runs" /></label>'
    +'<label class="select-field"><span class="select-field-icon">'+icon("funnel")+'</span><select id="run-source" aria-label="Filter runs by source"><option value="all">Any source</option>'+sources.map(kind=>'<option value="'+attr(kind)+'"'+(query.source===kind?" selected":"")+'>'+esc(kind)+'</option>').join("")+'</select></label>'
    +'</div></div>';
  const activeFilters=[query.status!=="all"?"status "+query.status:null,query.source!=="all"?"source "+query.source:null,query.q?'matching "'+query.q+'"':null].filter(Boolean);
  if(activeFilters.length)html+='<div class="filter-note"><span>Showing '+count(runs.length,"run")+' of '+all.length+' · '+esc(activeFilters.join(" · "))+'</span><button class="link" type="button" data-clear-filters>Clear filters</button></div>';
  const rows=runs.map(run=>runRow(run)).join("");
  const meta=count(runs.length,"run")+(live?" · "+live+" in flight":"");
  html+=card("All runs",'<div class="table-wrap"><table class="table runs-table"><thead><tr><th>Agent</th><th>Status</th><th>Run</th><th>Source</th><th>Duration</th><th>Attempts</th><th>Started</th></tr></thead><tbody>'+rows+'</tbody></table></div>'+(rows?"":(state.ready?empty(all.length?"No runs match these filters":"No runs yet",all.length?"Clear a filter or widen the search to see the rest.":"Start a run to watch it assemble, work, and complete here."):skeleton(5))),meta);
  html+='<p class="hint">'+esc("j / k to move · Enter to open · / to search · c to start a run · r to refresh")+'</p>';
  $("content").innerHTML=html;
  state.cursor=-1;
  document.querySelectorAll("[data-status]").forEach(node=>node.onclick=()=>{setRunQuery({status:node.dataset.status});renderRuns()});
  $("run-source").onchange=event=>{setRunQuery({source:event.target.value});renderRuns()};
  const search=$("run-search");
  search.oninput=event=>{
    const caret=event.target.selectionStart;
    setRunQuery({q:event.target.value});
    renderRuns();
    const next=$("run-search");
    if(next){next.focus();try{next.setSelectionRange(caret,caret)}catch{}}
  };
  const clear=document.querySelector("[data-clear-filters]");
  if(clear)clear.onclick=()=>{history.replaceState({},"",location.pathname);renderRuns()};
  document.querySelector("[data-new-run]").onclick=()=>openRunDrawer();
  document.querySelector("[data-refresh]").onclick=()=>void refreshActivity();
  dataLinks();
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
function eventOffset(run,event){
  const base=new Date(run.createdAt).getTime();const at=new Date(event.timestamp).getTime();
  if(!Number.isFinite(base)||!Number.isFinite(at))return"";
  return"+"+durationText(Math.max(0,at-base));
}
function runErrorText(run){
  if(run.status!=="failed")return"";
  if(typeof run.error==="string")return run.error;
  if(run.error&&typeof run.error==="object")return run.error.message||jsonText(run.error);
  return"The runtime recorded a failure without a message.";
}
function renderRun(id){
  const run=state.runs.find(x=>x.id===id);if(!run)return renderNotFound("Run");
  const events=eventsFor(id);
  const categories=[...new Set(events.map(event=>event.category))].filter(Boolean).sort();
  let visibleEvents=state.showAllEvents?events:events.filter(isKeyRunEvent);
  if(state.eventCategory!=="all")visibleEvents=visibleEvents.filter(event=>event.category===state.eventCategory);
  crumbs([{label:"Runs",href:"/runs"},{label:short(id)}]);
  const actions=(isLiveRun(run)?'<button class="button danger" data-cancel>Cancel run</button>':"")
    +'<button class="button" data-copy="'+attr(run.id)+'">'+icon("copy")+'<span>Copy run id</span></button>'
    +'<button class="button primary" data-rerun>'+icon("refresh")+'<span>Run again</span></button>';
  let html=pageHead("Run detail",run.agent+" · "+short(id),"Follow the high-level phases first. Expand individual events only when you need raw adapter or model evidence.",actions);
  const failure=runErrorText(run);
  if(failure)html+='<div class="alert danger"><span class="symbol">'+icon("warning")+'</span><div><b>This run failed'+(run.attempts>1?" after "+count(run.attempts,"attempt"):"")+'.</b><p>'+esc(failure)+'</p></div></div>';
  if(isLiveRun(run))html+='<div class="alert live"><span class="symbol"><i class="pulse-dot"></i></span><div><b>This run is still '+esc(run.status)+'.</b><p>New events stream in below as the runtime records them.</p></div></div>';
  html+='<div class="detail-strip">'
    +'<div><label>Status</label><strong>'+status(run.status)+'</strong></div>'
    +'<div><label>Duration</label><strong>'+durCell(run)+'</strong></div>'
    +'<div><label>Source</label><strong>'+esc(runSource(run))+'</strong></div>'
    +'<div><label>Agent instance</label><strong>'+(run.agentId?'<a class="link mono" href="/instances/'+attr(run.agentId)+'" data-link>'+esc(short(run.agentId))+'</a>':"Not recorded")+'</strong></div>'
    +'<div><label>Attempts</label><strong>'+run.attempts+" of "+run.maxAttempts+'</strong></div>'
    +'</div>';
  html+='<div class="grid cols-3"><section class="card span-2"><div class="card-head"><h2>Run spine</h2><span class="meta">'+count(events.length,"event")+'</span></div><div class="card-body"><div class="trace-note">This shows observable work intent and outcomes. It does not expose private hidden chain-of-thought.</div><div class="run-spine">'+phaseData(run,events).map(p=>'<div class="phase '+p.state+'"><span class="phase-dot"></span><div><strong>'+esc(p.name)+'</strong><p>'+esc(p.detail)+'</p></div><time title="'+attr(fullDate(p.time))+'">'+esc(fmtTime(p.time))+'</time></div>').join("")+'</div></div></section>';
  html+=card("Result",'<div class="card-body"><div class="summary-box"><dl><dt>Created</dt><dd>'+relCell(run.createdAt)+'</dd><dt>Started</dt><dd>'+relCell(run.startedAt)+'</dd><dt>Finished</dt><dd>'+relCell(run.completedAt)+'</dd><dt>Timeout</dt><dd>'+esc(durationText(run.timeoutMs))+'</dd></dl></div><details data-persist="output" open><summary class="link">Output</summary><pre class="json">'+esc(jsonText(run.output??run.error??null))+'</pre></details><details data-persist="input"><summary class="link">Input</summary><pre class="json">'+esc(jsonText(run.input))+'</pre></details></div>',"Recorded outcome");
  html+='</div>';
  const eventRows=visibleEvents.map((event,index)=>{
    const key=event.id||event.type+":"+event.timestamp+":"+index;
    return'<div class="event-row" data-event-key="'+attr(key)+'">'
      +'<button class="event-toggle" type="button"><span class="event-time">'+esc(fmtTime(event.timestamp))+'</span><span class="event-offset mono">'+esc(eventOffset(run,event))+'</span><span class="event-category">'+esc(event.category)+'</span><span class="event-type">'+esc(event.type)+'</span><span class="event-caret">'+icon("caretDown")+'</span></button>'
      +'<div class="event-detail"><div class="event-detail-head"><span class="muted mono">'+esc(event.type)+'</span>'+copyButton(jsonText(event.data),"event payload")+'</div><pre class="json">'+esc(jsonText(event.data))+'</pre></div></div>';
  }).join("");
  const categoryChips=categories.length>1?'<div class="chips">'+['all'].concat(categories).map(name=>'<button type="button" class="chip'+(state.eventCategory===name?" active":"")+'" data-category="'+attr(name)+'">'+esc(name==="all"?"All categories":name)+'</button>').join("")+'</div>':"";
  const eventControl='<div class="event-controls">'+categoryChips+'<div class="event-controls-right"><span class="muted">'+esc(state.showAllEvents?"Showing every retained event, including assembly and process detail.":"Showing the lifecycle events that explain this run.")+'</span><button class="button" type="button" data-toggle-events>'+esc(state.showAllEvents?"Show key events":"Show all "+events.length+" events")+'</button></div></div>';
  html+=card("Observable event trace",eventControl+'<div class="event-list">'+(eventRows||empty("No events to show","Clear the category filter or show every retained event."))+'</div>',count(visibleEvents.length,"event"));
  $("content").innerHTML=html;
  document.querySelectorAll(".event-toggle").forEach(node=>node.onclick=()=>node.parentElement.classList.toggle("open"));
  document.querySelectorAll("[data-category]").forEach(node=>node.onclick=()=>{state.eventCategory=node.dataset.category;renderRun(id)});
  document.querySelector("[data-toggle-events]").onclick=()=>{state.showAllEvents=!state.showAllEvents;renderRun(id)};
  const cancel=document.querySelector("[data-cancel]");if(cancel)cancel.onclick=()=>void cancelRun(id);
  const rerun=document.querySelector("[data-rerun]");
  if(rerun)rerun.onclick=()=>openRunDrawer(state.instances.find(x=>x.id===run.agentId)?.definitionId,run.agentId,typeof run.input?.message?.text==="string"?run.input.message.text:typeof run.input?.message==="string"?run.input.message:"");
  dataLinks();
}

function renderAutomations(){
  crumbs([{label:"Automations"}]);let html=pageHead("Background work","Automations","Schedules and sleeps create future activations. Playbook subscriptions listen for inbound transmissions and can provision one or many agent instances.","");
  html+='<div class="grid cols-3">'+metric("Scheduled activations",state.activations.length,"Future triggers and sleeping runs",true)+metric("Playbook subscriptions",state.subscriptions.length,"Inbound event policies")+metric("Application connections",state.connections.length,"Long-lived inbound workers")+'</div>';
  const actRows=recent(state.activations).map(x=>'<tr><td><span class="primary-cell">'+esc(x.kind==="sleep"?"Sleeping run":x.scheduleName||"Scheduled activation")+'</span><span class="secondary">'+esc(short(x.id))+'</span></td><td><a class="link" href="/instances/'+attr(x.agentId)+'" data-link>'+esc(short(x.agentId))+'</a></td><td>'+status(x.status)+'</td><td>'+esc(x.timing?.at||x.timing?.cron||x.timing?.everyMs||"Configured timing")+'</td><td>'+esc(x.origin)+'</td></tr>').join("");
  html+=card("Schedules and sleeps",'<div class="table-wrap"><table class="table"><thead><tr><th>Activation</th><th>Agent</th><th>Status</th><th>Timing</th><th>Origin</th></tr></thead><tbody>'+actRows+'</tbody></table></div>'+(actRows?"":empty("No future activations","Agents create schedules and sleeps through Foundry utility tools.")),count(state.activations.length,"activation"));
  const subRows=state.subscriptions.map(x=>'<tr><td><span class="primary-cell">'+esc(x.playbook?.name||x.playbook?.id||x.id)+'</span><span class="secondary">'+esc(short(x.id))+'</span></td><td>'+status(x.enabled?"enabled":"disabled")+'</td><td>'+esc(x.targets.map(t=>t.definitionId+" · "+t.provisioning.mode).join(", "))+'</td><td>'+esc(x.workspaceId)+'</td></tr>').join("");
  html+=card("Playbook listeners",'<div class="table-wrap"><table class="table"><thead><tr><th>Playbook</th><th>State</th><th>Targets / provisioning</th><th>Workspace</th></tr></thead><tbody>'+subRows+'</tbody></table></div>'+(subRows?"":empty("No playbook subscriptions","Runtime-defined subscriptions appear when a frontend or adapter installs them.")),count(state.subscriptions.length,"subscription"));
  const connRows=state.connections.map(x=>'<tr><td><span class="primary-cell">'+esc(x.applicationId)+'</span><span class="secondary">'+esc(x.connectionId)+'</span></td><td>'+status(x.status)+'</td><td>'+esc(x.definitionId)+'</td><td>'+x.routeIds.length+'</td><td>'+relCell(x.lastEventAt)+'</td></tr>').join("");
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
  const counts={entries:data.entries.length,inbox:data.inbox.length,tasks:data.tasks.length,environment:data.environment.length};
  html+='<div class="workspace-tabs" role="tablist">'+["entries","inbox","tasks","environment"].map(tab=>'<button type="button" role="tab" data-tab="'+attr(tab)+'">'+esc(tab[0].toUpperCase()+tab.slice(1))+'<span class="seg-count">'+counts[tab]+'</span></button>').join("")+'</div><div id="workspace-panel"></div>';
  $("content").innerHTML=html;
  $("workspace-select").onchange=e=>go("/workspaces/"+encodeURIComponent(e.target.value));
  document.querySelectorAll("[data-tab]").forEach(x=>x.onclick=()=>{
    const params=new URLSearchParams(location.search);
    if(x.dataset.tab==="entries")params.delete("tab");else params.set("tab",x.dataset.tab);
    const search=params.toString();
    history.replaceState({},"",location.pathname+(search?"?"+search:""));
    renderWorkspacePanel(data);
  });
  renderWorkspacePanel(data);dataLinks();
}
function workspaceTab(){
  const tab=new URLSearchParams(location.search).get("tab")||"entries";
  return["entries","inbox","tasks","environment"].includes(tab)?tab:"entries";
}
function renderWorkspacePanel(data){
  const active=workspaceTab();
  document.querySelectorAll("[data-tab]").forEach(x=>{const on=x.dataset.tab===active;x.classList.toggle("active",on);x.setAttribute("aria-selected",on?"true":"false")});
  const values=data[active]||[];let body="";
  if(active==="entries")body=values.length?'<div class="kv">'+values.map(x=>'<div class="kv-item"><strong>'+esc(x.key)+'</strong><small>Updated '+relTime(x.updatedAt)+'</small><div class="kv-value">'+esc(typeof x.value==="string"?x.value:jsonText(x.value))+'</div></div>').join("")+'</div>':empty("No shared entries","Agents can place documents and structured data into this workspace.");
  if(active==="inbox")body=values.length?'<div class="table-wrap"><table class="table"><thead><tr><th>Topic</th><th>Agent</th><th>Status</th><th>Updated</th></tr></thead><tbody>'+recent(values).map(x=>'<tr><td><span class="primary-cell">'+esc(x.topic)+'</span><span class="secondary">'+esc(short(x.id))+'</span></td><td>'+esc(short(x.agentId||"shared"))+'</td><td>'+status(x.status)+'</td><td>'+relCell(x.updatedAt)+'</td></tr>').join("")+'</tbody></table></div>':empty("Inbox is clear","Shared handoffs and external requests will appear here.");
  if(active==="tasks")body=values.length?'<div class="table-wrap"><table class="table"><thead><tr><th>Task</th><th>Owner</th><th>Status</th><th>Updated</th></tr></thead><tbody>'+recent(values).map(x=>'<tr><td><span class="primary-cell">'+esc(x.title)+'</span><span class="secondary">'+esc(x.detail||short(x.id))+'</span></td><td>'+esc(short(x.agentId||"workspace"))+'</td><td>'+status(x.status)+'</td><td>'+relCell(x.updatedAt)+'</td></tr>').join("")+'</tbody></table></div>':empty("No tasks","Agents can create shared tasks for work that spans conversations.");
  if(active==="environment")body='<div class="callout"><span class="symbol">'+icon("secure")+'</span><div><b>Only safe values are visible.</b><p>Credential material remains inside user-owned adapters and is never returned by this endpoint.</p></div></div>'+(values.length?'<div class="kv">'+values.map(x=>'<div class="kv-item"><strong>'+esc(x.key)+'</strong><small>'+esc(x.scope)+'</small><div class="kv-value">'+esc(typeof x.value==="string"?x.value:jsonText(x.value))+'</div></div>').join("")+'</div>':empty("No public environment values","Mount an environment adapter to expose non-secret context."));
  $("workspace-panel").innerHTML=card(active[0].toUpperCase()+active.slice(1),'<div class="card-body">'+body+'</div>',count(values.length,"item"));
}

function renderNotFound(label){crumbs([{label:"Not found"}]);$("content").innerHTML=pageHead("Inspector",label+" not found","The requested runtime record does not exist or is no longer retained.",'<a class="button" href="/" data-link>Return to overview</a>');dataLinks()}
async function loadBase(){
  const endpoints=["/api/manifest","/api/agent-instances","/api/playbook-subscriptions","/api/application-connections","/api/runs","/api/events","/health","/api/transmissions","/api/accounts","/api/routes","/api/bindings","/api/activations"];
  const results=await Promise.all(endpoints.map(url=>api(url)));[state.manifest,state.instances,state.subscriptions,state.connections,state.runs,state.events,state.health,state.transmissions,state.accounts,state.routes,state.bindings,state.activations]=results;renderHealth();
}
/* Every observability event used to trigger a full reload and repaint, which
   made a busy run unreadable. Events are coalesced into one refresh instead,
   and the repaint restores whatever the operator was doing. */
let refreshTimer=null;let refreshing=false;let refreshQueued=false;
function scheduleRefresh(){
  markLive();
  if(refreshTimer)return;
  refreshTimer=setTimeout(()=>{refreshTimer=null;void refreshActivity()},350);
}
function markLive(){
  state.liveAt=Date.now();
  const chip=document.querySelector(".live-chip");
  if(!chip)return;
  chip.classList.remove("pulse");void chip.offsetWidth;chip.classList.add("pulse");
}
async function refreshActivity(){
  if(refreshing){refreshQueued=true;return}
  refreshing=true;
  try{
    const endpoints=["/api/agent-instances","/api/playbook-subscriptions","/api/application-connections","/api/runs","/api/events","/api/activations","/health"];
    const values=await Promise.all(endpoints.map(url=>api(url)));
    [state.instances,state.subscriptions,state.connections,state.runs,state.events,state.activations,state.health]=values;
    renderHealth();
    $("event-state").textContent="Live updates";
    await navigate(false,true);
  }catch{$("event-state").textContent="Refresh paused"}
  finally{
    refreshing=false;
    if(refreshQueued){refreshQueued=false;scheduleRefresh()}
  }
}
function renderHealth(){const ok=Boolean(state.health?.ok);$("runtime-state").classList.toggle("bad",!ok);$("runtime-state").querySelector("span").textContent=ok?"Runtime healthy":"Runtime needs attention"}
async function navigate(load=true,preserve=false){
  const current=route();navState(current.section);
  const view=preserve?captureView():null;
  try{
    if(load&&current.section==="instances"&&current.id)await ensureConversations(current.id);
    if(load&&current.section==="workspaces"&&current.id)await ensureWorkspace(current.id);
    if(current.section==="overview")renderOverview();else if(current.section==="agents"&&!current.id)renderAgents();else if(current.section==="agents")renderDefinition(current.id);else if(current.section==="instances")renderInstance(current.id);else if(current.section==="runs"&&!current.id)renderRuns();else if(current.section==="runs")renderRun(current.id);else if(current.section==="automations")renderAutomations();else if(current.section==="integrations")renderIntegrations();else if(current.section==="workspaces")renderWorkspaces(current.id);else renderNotFound("Page");
  }catch(error){$("content").innerHTML='<div class="form-error">'+esc(error.message)+'</div>';console.error(error)}
  restoreView(view);
  tickTimes();
}

function openRunDrawer(definitionId,instanceId,message){
  const definitions=state.manifest?.agents?.agents||[];$("run-definition").innerHTML=definitions.map(x=>'<option value="'+attr(x.id)+'">'+esc(x.id)+'</option>').join("");
  if(typeof definitionId==="string"&&definition(definitionId))$("run-definition").value=definitionId;
  updateInstanceOptions(instanceId);
  $("run-message").value=typeof message==="string"?message:"";
  $("run-form-error").classList.add("hidden");
  setRunSubmitting(false);
  $("drawer").classList.add("open");
  setTimeout(()=>{const box=$("run-message");box.focus();box.setSelectionRange(box.value.length,box.value.length)},20);
}
function setRunSubmitting(pending){
  const submit=$("run-submit");
  submit.disabled=pending;
  submit.classList.toggle("pending",pending);
  submit.textContent=pending?"Starting…":"Start run";
}
function closeRunDrawer(){$("drawer").classList.remove("open")}
function updateInstanceOptions(selected){const definitionId=$("run-definition").value;const instances=state.instances.filter(x=>x.definitionId===definitionId);$("run-instance").innerHTML='<option value="">Create a new instance</option>'+instances.map(x=>'<option value="'+attr(x.id)+'">'+esc(short(x.id))+" · "+esc(x.workspaceId)+'</option>').join("");if(selected&&instances.some(x=>x.id===selected))$("run-instance").value=selected}
async function createInstance(definitionId){try{const workspace=workspaceIds()[0]||"foundry-dashboard";const instance=await api("/api/agent-instances",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({definitionId,workspaceId:workspace})});state.instances=[...state.instances,instance];toast("Instance created");go("/instances/"+encodeURIComponent(instance.id))}catch(error){toast(error.message)}}
async function startRun(event){
  event.preventDefault();const errorNode=$("run-form-error");errorNode.classList.add("hidden");setRunSubmitting(true);
  try{
    const definitionId=$("run-definition").value;let instance=state.instances.find(x=>x.id===$("run-instance").value);
    if(!instance){instance=await api("/api/agent-instances",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({definitionId,workspaceId:workspaceIds()[0]||"foundry-dashboard"})});state.instances=[...state.instances,instance]}
    await ensureConversations(instance.id);let conversation=state.conversations[instance.id][0];
    if(!conversation){conversation=await api("/api/conversations",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({agentId:instance.id,title:"Foundry inspector"})});state.conversations[instance.id]=[conversation]}
    const run=await api("/api/conversations/"+encodeURIComponent(conversation.id)+"/messages",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({agentId:instance.id,message:$("run-message").value})});state.runs=[...state.runs,run];closeRunDrawer();toast("Run accepted");go("/runs/"+encodeURIComponent(run.id));
  }catch(error){errorNode.textContent=error.message;errorNode.classList.remove("hidden")}
  finally{setRunSubmitting(false)}
}
async function cancelRun(id){try{await api("/api/runs/"+encodeURIComponent(id)+"/cancel",{method:"POST"});toast("Cancellation requested");await refreshActivity()}catch(error){toast(error.message)}}

function searchItems(){
  const items=[{label:"Overview",detail:"Runtime health and recent activity",path:"/"},{label:"Agents",detail:"Definitions and runtime instances",path:"/agents"},{label:"Runs",detail:"Execution history and traces",path:"/runs"},{label:"Automations",detail:"Schedules, sleeps, playbooks, and connections",path:"/automations"},{label:"Integrations",detail:"Transmissions, routes, accounts, and bindings",path:"/integrations"},{label:"Workspaces",detail:"Shared entries, inbox, tasks, and environment",path:"/workspaces"}];
  (state.manifest?.agents?.agents||[]).forEach(x=>items.push({label:x.id,detail:"Agent definition · "+x.description,path:"/agents/"+x.id}));state.instances.forEach(x=>items.push({label:short(x.id),detail:"Agent instance · "+x.definitionId,path:"/instances/"+x.id}));recent(state.runs).slice(0,100).forEach(x=>items.push({label:short(x.id),detail:"Run · "+x.agent+" · "+x.status,path:"/runs/"+x.id}));return items;
}
function renderSearch(){const term=$("search-input").value.trim().toLowerCase();const matches=searchItems().filter(x=>!term||(x.label+" "+x.detail).toLowerCase().includes(term)).slice(0,12);$("search-results").innerHTML=matches.map(x=>'<a class="search-result" href="'+attr(x.path)+'" data-search-link><strong>'+esc(x.label)+'</strong><small>'+esc(x.detail)+'</small></a>').join("")||empty("No matches","Try an agent id, instance id, run id, or page name.");document.querySelectorAll("[data-search-link]").forEach(x=>x.onclick=e=>{e.preventDefault();closeSearch();go(x.getAttribute("href"))})}
function openSearch(){$("search-modal").classList.add("open");$("search-input").value="";renderSearch();setTimeout(()=>$("search-input").focus(),20)}function closeSearch(){$("search-modal").classList.remove("open")}

$("new-run").onclick=()=>openRunDrawer();$("close-drawer").onclick=closeRunDrawer;$("cancel-run").onclick=closeRunDrawer;$("drawer").onclick=e=>{if(e.target===$("drawer"))closeRunDrawer()};$("run-definition").onchange=()=>updateInstanceOptions();$("run-form").onsubmit=startRun;$("open-search").onclick=openSearch;$("search-input").oninput=renderSearch;$("search-modal").onclick=e=>{if(e.target===$("search-modal"))closeSearch()};$("mobile-toggle").onclick=()=>$("sidebar").classList.toggle("open");window.onpopstate=()=>void navigate();
$("run-message").addEventListener("keydown",e=>{if((e.metaKey||e.ctrlKey)&&e.key==="Enter"){e.preventDefault();$("run-form").requestSubmit()}});
document.addEventListener("keydown",e=>{
  if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==="k"){e.preventDefault();openSearch();return}
  if(e.key==="Escape"){closeSearch();closeRunDrawer();return}
  if(e.metaKey||e.ctrlKey||e.altKey||isTyping())return;
  if($("drawer").classList.contains("open")||$("search-modal").classList.contains("open"))return;
  if(e.key==="j"){e.preventDefault();moveCursor(1)}
  else if(e.key==="k"){e.preventDefault();moveCursor(-1)}
  else if(e.key==="Enter"||e.key==="o"){if(state.cursor>=0){e.preventDefault();openCursor()}}
  else if(e.key==="/"){const box=$("run-search");if(box){e.preventDefault();box.focus();box.select()}else{e.preventDefault();openSearch()}}
  else if(e.key==="c"){e.preventDefault();openRunDrawer()}
  else if(e.key==="r"){e.preventDefault();void refreshActivity()}
});
setInterval(tickTimes,1000);
loadBase().then(async()=>{
  state.ready=true;
  await navigate();
  const stream=new EventSource("/api/events");
  stream.onopen=()=>{$("event-state").textContent="Live updates"};
  stream.onmessage=scheduleRefresh;
  stream.onerror=()=>{$("event-state").textContent="Reconnecting…"};
  setInterval(()=>void refreshActivity(),10000);
}).catch(error=>{$("content").innerHTML='<div class="form-error"><strong>Could not open Foundry.</strong><br>'+esc(error.message)+'</div>';$("runtime-state").classList.add("bad");$("runtime-state").querySelector("span").textContent="Runtime unavailable"});
`;
