/**
 * The run views about how Foundry composed and connected a run. Composition
 * is like DevTools' Sources: what the agent was assembled from, step by step,
 * and which app or feature each tool came from. Queues is like the Messages
 * pane of a WebSocket: everything that crossed the run's boundary, in and
 * out, and which model request first saw it. Call chain is like the Initiator
 * chain, across runs. Runs in the same page script as dashboard-run.ts and
 * uses the builders in dashboard-foundry.ts.
 */
export const DASHBOARD_RUN_FOUNDRY_SCRIPT = String.raw`
/* ---- Composition ---- */
const COMPOSITION_NODES=[["Assembly","timeline","Timeline"],["Assembly","tools","Tools by origin"],["Capabilities","apps","Apps and installations"],["Capabilities","workbench","Working environment and REPL"],["Automation","playbooks","Playbooks"],["Automation","schedules","Schedules"],["Agents","delegates","Delegates and workers"],["Agents","mesh","Mesh"],["Extensions","extensions","Memory, layers and subscribers"],["Extensions","surface","Hooks, skills, subagents and calls"]];
function toolCallCounts(trace){const counts={};for(const item of trace.items)if(item.kind==="tool"&&!item.via)counts[item.name]=(counts[item.name]||0)+1;return counts}
function toolChip(name,counts,extra){
  const calls=counts[name]||0;
  return'<button type="button" class="cap tool-chip'+(calls?" called":"")+'" data-tool-filter="'+attr(name)+'" title="'+attr(calls?"Show its "+count(calls,"call")+" in Network":"Not called in this run")+'">'+esc(name)+(extra||"")+(calls?'<small>'+calls+'</small>':"")+'</button>';
}
function compositionTimeline(comp){
  const rows=[];
  for(const item of comp.resolves)rows.push({name:item.field,note:"resolve"+(item.count!==undefined?" · "+count(item.count,"item"):""),startAt:item.startAt,durationMs:item.durationMs,kind:"resolve"});
  if(comp.composed&&Number.isFinite(comp.endAt)){
    let at=comp.endAt-(comp.composed.durationMs||0);
    for(const step of comp.steps){rows.push({name:step.label,note:step.tools.length?count(step.tools.length,"tool"):step.kind||"",startAt:at,durationMs:step.ms,kind:step.step});at+=step.ms||0}
  }
  if(!rows.length)return empty("No assembly recorded","Runs record their assembly as they start. Runs from before Foundry recorded it, or handler-only runs, have none.");
  const start=Math.min(...rows.map(row=>row.startAt).filter(Number.isFinite));const end=Math.max(...rows.map(row=>row.startAt+(row.durationMs||0)).filter(Number.isFinite),comp.endAt||0);const span=Math.max(1,end-start);
  return'<p class="dt-note">How Foundry put this run’s agent together before its first turn'+(Number.isFinite(comp.durationMs)?", in "+esc(durationText(comp.durationMs)):"")+'. Definition fields resolve in parallel, then each step mounts its part.</p>'
    +'<table class="net-table comp-table"><thead><tr><th>Step</th><th></th><th class="c-time">Time</th><th class="c-wf">Waterfall</th></tr></thead><tbody>'
    +rows.map(row=>{const left=Number.isFinite(row.startAt)?(row.startAt-start)/span*100:0;const width=Math.max(.6,(row.durationMs||0)/span*100);return'<tr class="comp-row kind-'+attr(row.kind)+'"><td><b>'+esc(row.name)+'</b></td><td class="muted">'+esc(row.note)+'</td><td class="c-time mono">'+esc(durationText(row.durationMs))+'</td><td class="c-wf"><span class="wf-track"><span class="wf-bar" style="left:'+Math.min(99.4,left).toFixed(2)+'%;width:'+Math.min(width,100-left).toFixed(2)+'%"></span></span></td></tr>'}).join("")
    +'</tbody></table>';
}
function compositionTools(comp,trace,counts){
  const offered=(trace.items.filter(item=>item.kind==="model"&&!item.legacy).at(-1)||{}).toolNames||[];
  const unattributed=offered.filter(name=>!comp.origins[name]);
  const steps=comp.steps.filter(step=>step.tools.length);
  if(!steps.length&&!offered.length)return empty("No tools recorded","");
  return'<p class="dt-note">Each tool the agent had, under the step that added it. Click one to see its calls in Network.'+(comp.legacy?" This run was recorded before Foundry kept each step’s tools, so only steps that reported theirs are listed.":"")+'</p>'
    +steps.map(step=>'<section class="comp-group"><header><b>'+esc(step.label)+'</b>'+(step.kind?'<span class="muted">'+esc(step.kind)+'</span>':"")+'<span class="muted mono">'+count(step.tools.length,"tool")+'</span></header><div class="cap-list">'+step.tools.map(name=>toolChip(name,counts)).join("")+'</div></section>').join("")
    +(unattributed.length?'<section class="comp-group"><header><b>Offered, origin not recorded</b><span class="muted mono">'+count(unattributed.length,"tool")+'</span></header><div class="cap-list">'+unattributed.map(name=>toolChip(name,counts)).join("")+'</div></section>':"");
}
function compositionApps(comp,counts,instance){
  const installs=comp.installations.length?comp.installations:(instance?instance.installations:[]);
  const apps=comp.apps;
  if(!installs.length&&!apps.length)return empty("Nothing installed","Apps, MCP servers and shared tools installed on the instance appear here with the tools each gave the agent.");
  const stepFor=(install)=>comp.steps.find(step=>step.step==="installation"&&step.id===install.id);
  const mcp=comp.steps.find(step=>step.step==="mcp"&&!step.id);
  return'<p class="dt-note">What the instance has installed, and what each installation gave this run.</p>'
    +installs.map(install=>{
      const app=apps.find(item=>item.id===install.id);const step=stepFor(install);
      const tools=app?app.tools:step?step.tools.map(name=>({name})):[];
      return'<section class="comp-group"><header><b>'+esc(install.id)+'</b><span class="dt-badge">'+esc(install.kind)+'</span>'+(install.accountId?'<span class="muted">account '+esc(install.accountId)+'</span>':"")+(step&&Number.isFinite(step.ms)?'<span class="muted mono">'+esc(durationText(step.ms))+'</span>':"")+'</header>'
        +(app&&app.description?'<p class="dt-note">'+esc(app.description)+'</p>':"")
        +(tools.length?'<div class="cap-list">'+tools.map(tool=>toolChip(tool.name,counts,tool.readOnly===false?'<i class="tool-writes" title="Changes things">writes</i>':"")).join("")+'</div>':'<p class="dt-note">'+(install.kind==="mcp"?"Mounted with the other MCP servers below.":"No tools of its own.")+'</p>')
        +'</section>';
    }).join("")
    +(mcp&&mcp.tools.length?'<section class="comp-group"><header><b>MCP servers</b><span class="muted mono">'+count(mcp.tools.length,"tool")+'</span></header><div class="cap-list">'+mcp.tools.map(name=>toolChip(name,counts)).join("")+'</div></section>':"");
}
function compositionView(run,trace,events,view){
  const comp=buildComposition(events);const counts=toolCallCounts(trace);
  const instance=state.instances.find(item=>item.id===run.agentId);
  const node=COMPOSITION_NODES.some(entry=>entry[1]===view.cnode)?view.cnode:"timeline";
  const toolCount=comp.steps.reduce((sum,step)=>sum+step.tools.length,0);
  const counted={timeline:comp.steps.length+comp.resolves.length||"",tools:toolCount||"",apps:(comp.installations.length||(instance?instance.installations.length:0))||"",playbooks:(comp.playbooks.length||(instance?instance.playbooks.length:0))||"",schedules:comp.schedules.length||"",delegates:(comp.delegates.length+comp.durableSubagents.length)||"",extensions:(comp.memory.length+comp.layers.length+comp.subscribers.length)||"",surface:(comp.hooks.length+comp.skills.length+comp.subagents.length+comp.calls.length)||""};
  let tree="";let group="";
  COMPOSITION_NODES.forEach(entry=>{if(entry[0]!==group){group=entry[0];tree+='<div class="ctx-group">'+esc(group)+'</div>'}tree+='<button type="button" class="ctx-node'+(entry[1]===node?" active":"")+'" data-comp-node="'+entry[1]+'">'+esc(entry[2])+(counted[entry[1]]?'<small>'+esc(counted[entry[1]])+'</small>':"")+'</button>'});
  const list=(items,format)=>items.length?'<div class="cap-list">'+items.map(format).join("")+'</div>':'<p class="dt-note">None.</p>';
  let body="";
  if(node==="timeline")body=compositionTimeline(comp);
  else if(node==="tools")body=compositionTools(comp,trace,counts);
  else if(node==="apps")body=compositionApps(comp,counts,instance);
  else if(node==="playbooks"){
    const stored=instance?instance.playbooks:[];
    body='<p class="dt-note">Playbooks tell the agent how to handle what arrives on its transmissions. The definition composes them; the instance stores them.</p>'
      +'<div class="dt-section">Composed by the definition</div>'+list(comp.playbooks,item=>'<span class="cap">'+esc(item.name||item.id)+'</span>')
      +'<div class="dt-section">Stored on the instance</div>'+(stored.length?jsonBlock(stored,"comp:playbooks"):'<p class="dt-note">None.</p>');
  }
  else if(node==="schedules"){
    const activations=(state.activations||[]).filter(item=>item.agentId===run.agentId||item.createdByRunId===run.id);
    const timing=(t)=>!t?"":t.kind==="cron"?t.expression+" · "+t.timezone:t.kind==="every"?"every "+durationText(t.intervalMs):t.kind==="at"?"at "+fmtTime(t.at):"";
    body='<p class="dt-note">The definition’s schedules, synced when the run starts, and the instance’s activations: schedules and sleeps the runtime will fire.</p>'
      +'<div class="dt-section">Defined</div>'+(comp.schedules.length?kv(comp.schedules.map(item=>[item.name,esc(timing(item.timing))+(item.enabled===false?' <span class="st warn">disabled</span>':"")])):'<p class="dt-note">None.</p>')
      +(comp.scheduled.length?'<div class="dt-section">Created by this run</div>'+kv(comp.scheduled.map(item=>[short(item.id),(item.recurring?"recurring · ":"")+"next "+esc(fmtTime(item.nextRunAt))])):"")
      +'<div class="dt-section">Activations for this instance</div>'+(activations.length?'<table class="net-table"><thead><tr><th>Activation</th><th>Kind</th><th>Status</th><th>Next</th><th>Last run</th></tr></thead><tbody>'+activations.map(item=>'<tr><td class="mono">'+esc(item.scheduleName||short(item.id))+'</td><td>'+esc(item.kind||"")+'</td><td>'+esc(item.status||"")+'</td><td>'+esc(item.nextRunAt?fmtTime(item.nextRunAt):"—")+'</td><td>'+(item.lastRunId?'<a class="link mono" href="/runs/'+attr(item.lastRunId)+'" data-link>'+esc(short(item.lastRunId))+'</a>':"—")+'</td></tr>').join("")+'</tbody></table>':'<p class="dt-note">None.</p>');
  }
  else if(node==="delegates"){
    body='<p class="dt-note">Other agents this one can hand work to. Each delegation runs in the worker’s own conversation and reports back; see Call chain for the runs.</p>'
      +(comp.delegation?'<div class="dt-section">This run works for</div>'+kv([["Delegator",esc(comp.delegation.from)],["Task",esc(comp.delegation.task)],["Delegation",'<span class="mono">'+esc(comp.delegation.id)+'</span>']]):"")
      +'<div class="dt-section">Delegates</div>'+(comp.delegates.length?kv(comp.delegates.map(item=>[item.agent,esc(item.description||"")])):'<p class="dt-note">None.</p>')
      +'<div class="dt-section">Durable subagents</div>'+list(comp.durableSubagents,name=>'<span class="cap">'+esc(name)+'</span>')
      +(comp.composed?'<p class="dt-note">'+count(comp.composed.openDelegations||0,"delegation")+' open when the run started.</p>':"");
  }
  else if(node==="mesh")body=comp.mesh?kv([["Hosted mesh",comp.mesh.hosted?"mounted":"no"],["Your own transport",comp.mesh.transport?"mounted":"no"],["Open threads",esc(comp.mesh.threads??0)],comp.mesh.thread?["This run’s thread",'<span class="mono">'+esc(comp.mesh.thread)+'</span>']:null]):empty("No mesh","This agent doesn’t talk to peers over the mesh.");
  else if(node==="extensions")body='<div class="dt-section">Memory</div>'+list(comp.memory,id=>'<span class="cap">'+esc(id)+'</span>')+'<div class="dt-section">Layers</div>'+list(comp.layers,id=>'<span class="cap">'+esc(id)+'</span>')+'<div class="dt-section">Subscribers</div>'+list(comp.subscribers,id=>'<span class="cap">'+esc(id)+'</span>')+(comp.inboxes?'<div class="dt-section">Inbox</div><p class="dt-note">'+esc(count(comp.inboxes.count||0,"item"))+" loaded, "+esc(comp.inboxes.added||0)+" added, "+esc(comp.inboxes.updated||0)+' updated.</p>':"");
  else if(node==="surface")body='<div class="dt-section">Hooks</div>'+list(comp.hooks,name=>'<span class="cap">/'+esc(name)+'</span>')+'<div class="dt-section">Skills</div>'+list(comp.skills,name=>'<span class="cap">'+esc(name)+'</span>')+'<div class="dt-section">Subagents</div>'+list(comp.subagents,name=>'<span class="cap">'+esc(name)+'</span>')+'<div class="dt-section">Calls</div>'+list(comp.calls,call=>'<span class="cap">'+esc(call.name)+(call.exposed===false?' <small>not offered to the model</small>':"")+'</span>');
  else if(node==="workbench")body=(comp.workingEnvironment?'<div class="dt-section">Working environment</div>'+jsonBlock(comp.workingEnvironment,"comp:we"):'<div class="dt-section">Working environment</div><p class="dt-note">Not mounted.</p>')+(comp.repl?'<div class="dt-section">REPL</div>'+jsonBlock(comp.repl,"comp:repl"):'<div class="dt-section">REPL</div><p class="dt-note">Not mounted.</p>');
  return'<div class="ctx"><nav class="ctx-tree" aria-label="Composition">'+tree+'</nav><div class="ctx-view" data-scroll-key="comp:'+attr(node)+'">'+body+'</div></div>';
}

/* ---- Queues ---- */
function queueStatusClass(status){const s=String(status||"");return/fail|dropped|denied|rejected/.test(s)?"err":/waiting|deferred|queued|sent|posted/.test(s)?"warn":/joined|started|accepted|delivered|scheduled|approved|woke/.test(s)?"ok":""}
function queuesView(run,trace,events,view){
  state.queues=state.queues||{filter:"",dir:"all"};
  const q=state.queues;const rows=buildQueues(events,run,trace);const term=q.filter.trim().toLowerCase();
  const visible=rows.filter(row=>(q.dir==="all"||row.dir===q.dir)&&(!term||(row.channel+" "+row.title+" "+row.preview+" "+row.status).toLowerCase().includes(term)));
  const selected=rows.find(row=>row.key===view.queue);const base=new Date(runStartedAt(run)).getTime();
  const models=Object.fromEntries(trace.items.filter(item=>item.kind==="model").map(item=>[item.key,item]));
  const inbound=rows.filter(row=>row.dir==="in").length;
  let html='<div class="dt-toolbar"><label class="dt-filter">'+icon("search")+'<input id="queue-filter" value="'+attr(q.filter)+'" placeholder="Filter by channel, source or content" aria-label="Filter messages" /></label>'
    +'<div class="dt-chips" role="group" aria-label="Direction">'+[["all","All"],["in","Inbound"],["out","Outbound"]].map(entry=>'<button type="button" class="dt-chip'+(q.dir===entry[0]?" active":"")+'" data-queue-dir="'+entry[0]+'">'+entry[1]+'</button>').join("")+'</div>'
    +'<span class="dt-summary">'+esc(inbound)+' in · '+esc(rows.length-inbound)+' out</span></div>';
  html+='<div class="net-split'+(selected?" has-detail":"")+'"><div class="net-list" data-scroll-key="queue-list">';
  if(!rows.length)html+=empty("Nothing crossed this run’s boundary","What starts a run, what arrives while it works and what it sends out appear here.");
  else html+='<table class="net-table q-table">'+(selected?"":'<colgroup><col style="width:34px"><col style="width:13%"><col><col style="width:16%"><col style="width:15%"><col style="width:80px"></colgroup>')+'<thead><tr><th class="q-dir"></th><th>Channel</th><th>What</th><th>Status</th><th title="Inbound: the model request that first saw it. Outbound: the run it started.">Reached</th><th class="c-time">Time</th></tr></thead><tbody>'
    +visible.map(row=>'<tr class="net-row q-row'+(row.key===view.queue?" selected":"")+'" data-queue-item="'+attr(row.key)+'"><td class="q-dir"><span class="q-arrow '+row.dir+'" title="'+(row.dir==="in"?"Inbound":"Outbound")+'">'+(row.dir==="in"?"↓":"↑")+'</span></td><td class="mono">'+esc(row.channel)+'</td><td><span class="net-name"><span><b>'+esc(row.title)+'</b><small>'+esc(row.preview)+'</small></span></span></td><td><span class="st '+queueStatusClass(row.status)+'">'+esc(row.status)+'</span></td><td>'+(row.seenBy&&models[row.seenBy]?itemLink(row.seenBy,models[row.seenBy].name):row.childRunId?'<a class="link mono" href="/runs/'+attr(row.childRunId)+'" data-link>'+esc(short(row.childRunId))+'</a>':'<span class="muted">—</span>')+'</td><td class="c-time mono">'+esc(offsetFrom(base,isoAt(row.at)))+'</td></tr>').join("")
    +'</tbody></table>'+(visible.length?"":empty("Nothing matches","Clear the filter to see every message."));
  html+='</div>'+(selected?queueDetail(selected,run,models):"")+'</div>';
  return html;
}
function queueDetail(row,run,models){
  const base=new Date(runStartedAt(run)).getTime();
  return'<aside class="net-detail" aria-label="'+attr(row.title)+'"><div class="nd-head"><button type="button" class="nd-close" data-queue-close title="Close (Esc)" aria-label="Close">'+icon("close")+'</button><span class="nd-tab active">Message</span></div>'
    +'<div class="nd-title"><b>'+esc(row.title)+'</b><span>'+(row.dir==="in"?"inbound":"outbound")+" · "+esc(row.channel)+'</span></div><div class="nd-body">'
    +kv([["Status",'<span class="st '+queueStatusClass(row.status)+'">'+esc(row.status)+'</span>'+(row.error?' <span class="muted">'+esc(row.error)+'</span>':"")],
      [row.dir==="in"?"Arrived":"Sent",esc(offsetFrom(base,isoAt(row.at)))+' <span class="muted">'+esc(fmtTime(isoAt(row.at)))+'</span>'],
      Number.isFinite(row.injectedAt)?["Joined the conversation",esc(offsetFrom(base,isoAt(row.injectedAt)))]:null,
      row.seenBy&&models[row.seenBy]?["First seen by",itemLink(row.seenBy,models[row.seenBy].name)]:null,
      row.call?["Tool call",itemLink(row.call,"Open in Network")]:null,
      row.childRunId?["Run",'<a class="link mono" href="/runs/'+attr(row.childRunId)+'" data-link>'+esc(row.childRunId)+'</a>']:null,
      row.nextRunAt?["Next run",esc(fmtTime(row.nextRunAt))]:null])
    +(row.preview?'<div class="dt-section">Content</div><pre class="dt-pre">'+esc(row.preview)+'</pre>':"")
    +'<div class="dt-section">Detail</div>'+jsonBlock(row.detail,row.key+":detail")
    +(row.events.length?'<div class="dt-section">Events</div>'+jsonBlock(row.events.map(event=>({type:event.type,timestamp:event.timestamp,data:event.data})),row.key+":raw"):"")
    +'</div></aside>';
}

/* ---- Call chain ---- */
function ensureChainEvents(id){
  state.chain=state.chain||{events:null,at:0,loading:false};
  const c=state.chain;if(c.loading||(c.events&&Date.now()-c.at<10000))return;
  c.loading=true;
  api("/api/events?category=system&limit=5000").then(events=>{c.events=events;c.at=Date.now()}).catch(()=>{c.events=c.events||[]}).finally(()=>{c.loading=false;if(route().id===id&&runView().tab==="chain")rerenderRun(id)});
}
function chainCard(node){
  const run=node.run;
  return'<div class="chain-card">'+(run?'<a class="link" href="/runs/'+attr(node.id)+'?tab=chain" data-link><b>'+esc(run.agent)+'</b></a> '+status(run.status)+' <span class="muted mono">'+esc(short(node.id))+'</span> <span class="muted">'+esc(fmtTime(run.createdAt))+(run.completedAt?" · "+esc(durationText(Date.parse(run.completedAt)-Date.parse(runStartedAt(run)))):"")+'</span>':'<span class="mono">'+esc(short(node.id))+'</span> <span class="muted">not retained</span>')+'</div>';
}
function chainNode(node,self){
  const run=node.run;const edge=node.edge;
  const head=run?'<a class="link" href="/runs/'+attr(node.id)+'?tab=chain" data-link><b>'+esc(run.agent)+'</b></a> '+status(run.status)+' <span class="muted mono">'+esc(short(node.id))+'</span> <span class="muted">'+esc(fmtTime(run.createdAt))+(run.completedAt?" · "+esc(durationText(Date.parse(run.completedAt)-Date.parse(runStartedAt(run)))):"")+'</span>':'<span class="mono">'+esc(short(node.id))+'</span> <span class="muted">not retained</span>';
  return'<div class="chain-node'+(self?" self":"")+'">'+(edge?'<span class="chain-edge">'+esc(edge.label)+'</span>':"")+'<div class="chain-card">'+head+'</div>'
    +((node.children||[]).length?'<div class="chain-children">'+node.children.map(child=>chainNode(child,false)).join("")+'</div>':"")+'</div>';
}
function chainView(run,events){
  ensureChainEvents(run.id);
  const loaded=state.chain&&state.chain.events;
  const all=(loaded||[]).concat(events);
  const chain=buildRunChain(run.id,state.runs,all);
  const origin=chain.origin?'<div class="chain-node origin"><div class="chain-card"><b>'+esc(chain.origin.kind)+'</b> '+esc([chain.origin.provider,chain.origin.id,chain.origin.eventId,chain.origin.threadKey].filter(Boolean).join(" · "))+'</div></div>':"";
  let html='<div class="dt-pad"><p class="dt-note">The runs this one came from and the runs it started: delegations and their reports, spawns, schedules and sleeps, steering. Each links to its own run.'+(loaded?"":" Loading the runtime’s events…")+'</p><div class="chain">'+origin;
  // Each ancestor, then how it led to the run below it.
  for(const ancestor of chain.ancestors)html+='<div class="chain-node">'+chainCard(ancestor)+'<span class="chain-edge">'+esc(ancestor.edge.label)+'</span></div>';
  html+=chainNode({...chain.self,edge:null},true)+'</div>';
  if(!chain.ancestors.length&&!(chain.self.children||[]).length&&!chain.origin)html+=empty("A run on its own","Nothing recorded started this run, and it started no other runs.");
  return html+'</div>';
}
function bindRunFoundry(id){
  document.querySelectorAll("[data-comp-node]").forEach(node=>node.onclick=()=>{setRunView({cnode:node.dataset.compNode});rerenderRun(id)});
  document.querySelectorAll("[data-tool-filter]").forEach(node=>node.onclick=()=>{state.network.filter=node.dataset.toolFilter;state.network.kind="tools";setRunView({tab:"network",item:""});rerenderRun(id)});
  document.querySelectorAll("[data-queue-item]").forEach(node=>node.onclick=event=>{if(event.target.closest("a,[data-net-item]"))return;setRunView({queue:node.dataset.queueItem});rerenderRun(id)});
  document.querySelectorAll("[data-queue-dir]").forEach(node=>node.onclick=()=>{state.queues.dir=node.dataset.queueDir;rerenderRun(id)});
  const close=document.querySelector("[data-queue-close]");if(close)close.onclick=()=>{setRunView({queue:""});rerenderRun(id)};
  const input=$("queue-filter");
  if(input)input.oninput=event=>{const caret=event.target.selectionStart;state.queues.filter=event.target.value;rerenderRun(id);const next=$("queue-filter");if(next){next.focus();try{next.setSelectionRange(caret,caret)}catch{}}};
}
`;
