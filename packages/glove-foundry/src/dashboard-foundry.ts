/**
 * How Foundry composed and connected a run, as browser JavaScript.
 *
 * - `buildComposition` reads what the run was assembled from: each assembly
 *   step and the tools it added, the apps and installations, playbooks,
 *   schedules, delegates, mesh, memory and the rest.
 * - `buildQueues` lists everything that crossed the run's boundary: what
 *   started it, what arrived while it ran (transmissions, delegation updates,
 *   agent and mesh messages, inbox items, approval decisions) and when the
 *   model first saw each, and what it sent out (transmissions, delegations,
 *   messages, spawns, schedules, sleeps).
 * - `buildRunChain` puts the run among the runs it came from and started.
 *
 * Like dashboard-trace.ts these are plain functions over the operator API's
 * JSON, so tests evaluate this same source. They use `traceType` and
 * `tracePreview` from that script.
 */
export const DASHBOARD_FOUNDRY_SCRIPT = String.raw`
function foundryAt(event){const t=Date.parse(event&&event.timestamp);return Number.isFinite(t)?t:NaN}
function foundrySorted(events){return[...(events||[])].sort((a,b)=>(a.sequence??0)-(b.sequence??0))}

/* ---- Composition ---- */
const COMPOSITION_LEGACY_STEPS={"foundry.application.transmission-tools.mounted":["transmissions","App transmissions"],"foundry.working-environment.mounted":["workbench","Working environment"]};
function buildComposition(events){
  const ordered=foundrySorted(events);
  const result={composed:null,resolves:[],steps:[],tools:[],origins:{},apps:[],installations:[],playbooks:[],schedules:[],scheduled:[],delegates:[],durableSubagents:[],mesh:null,memory:[],layers:[],subscribers:[],hooks:[],skills:[],subagents:[],calls:[],workingEnvironment:null,repl:null,inboxes:null,delegation:null,startAt:NaN,endAt:NaN,durationMs:NaN,legacy:true};
  const open={};
  for(const event of ordered){
    const type=traceType(event);const data=event.data||{};const at=foundryAt(event);
    if(type==="foundry.assembly.resolve.start"){if(!(result.startAt<=at))result.startAt=at;open[data.field]={field:data.field,startAt:at,endAt:NaN,durationMs:NaN};result.resolves.push(open[data.field]);continue}
    if(type==="foundry.assembly.resolve.complete"){const item=open[data.field];if(item){item.endAt=at;item.durationMs=at-item.startAt;if(data.count!==undefined)item.count=data.count;delete open[data.field]}continue}
    if(type==="foundry.assembly.composed"){
      result.composed=data;result.legacy=false;result.endAt=at;
      if(Number.isFinite(data.durationMs)&&!(result.startAt<=at-data.durationMs))result.startAt=at-data.durationMs;
      result.steps=(data.steps||[]).map(step=>({...step,tools:[...(step.tools||[])]}));
      result.tools=[...(data.tools||[])];result.installations=data.installations||[];
      result.apps=data.apps||[];result.playbooks=data.playbooks||[];result.schedules=data.schedules||[];
      result.delegates=data.delegates||[];result.durableSubagents=data.durableSubagents||[];result.mesh=data.mesh||null;
      result.hooks=data.hooks||[];result.skills=data.skills||[];result.subagents=data.subagents||[];result.calls=data.calls||[];
      result.delegation=data.delegation||null;
      if(data.repl&&!result.repl)result.repl={};
      if(data.workingEnvironment&&!result.workingEnvironment)result.workingEnvironment={};
      continue;
    }
    if(type==="foundry.definition.memory.mounted"){result.memory.push(data.id);continue}
    if(type==="foundry.layer.mounted"){result.layers.push(data.id);continue}
    if(type==="foundry.subscriber.mounted"){result.subscribers.push(data.id);continue}
    if(type==="foundry.working-environment.mounted"){result.workingEnvironment={...(result.workingEnvironment||{}),...data}}
    if(type==="foundry.repl.mounted"){result.repl={...(result.repl||{}),...data};continue}
    if(type==="foundry.definition.inboxes.loaded"){result.inboxes=data;continue}
    if(type==="scheduled-action.created"){result.scheduled.push({id:data.commandId,recurring:data.recurring,nextRunAt:data.nextRunAt});continue}
    if(result.legacy){
      // Runs recorded before foundry.assembly.composed: what the mount events say.
      if(COMPOSITION_LEGACY_STEPS[type]&&(data.tools||[]).length){const step=COMPOSITION_LEGACY_STEPS[type];result.steps.push({step:step[0],label:step[1],tools:[...data.tools],ms:NaN})}
      if(type==="foundry.application.mcp.mounted")result.steps.push({step:"mcp",label:data.id,id:data.id,tools:[...(data.tools||[])],ms:NaN});
      if(type==="foundry.installation.completed"){result.installations.push({kind:data.kind,id:data.id});result.steps.push({step:"installation",label:data.id,kind:data.kind,id:data.id,tools:[],ms:NaN})}
      if(type==="foundry.definition.playbooks.composed")result.playbooks=(data.names||[]).map(name=>({name}));
      if(type==="foundry.definition.schedules.loaded")result.schedules=(data.names||[]).map(name=>({name}));
      if(type==="foundry.definition.delegates.loaded")result.delegates=(data.delegates||[]).map(agent=>({agent}));
      if(type==="foundry.mesh.mounted")result.mesh={hosted:true,threads:data.open,...(data.thread?{thread:data.thread}:{})};
    }
    if(type==="turn_start"&&!Number.isFinite(result.endAt))result.endAt=at;
  }
  if(Number.isFinite(result.startAt)&&Number.isFinite(result.endAt))result.durationMs=Math.max(0,result.endAt-result.startAt);
  for(const step of result.steps)for(const name of step.tools)if(!result.origins[name])result.origins[name]={step:step.step,label:step.label};
  if(!result.tools.length)result.tools=Object.keys(result.origins);
  return result;
}

/* ---- Queues: what crossed the run's boundary ---- */
function queueChannel(kind,source){
  const k=String(kind||"");
  if(k==="transmission"||/^foundry:route:/.test(String(source||"")))return"transmission";
  if(k==="agent-message")return"agent message";
  if(k==="mesh")return"mesh";
  if(/^delegation|^reply$/.test(k))return"delegation";
  if(/approval/.test(k))return"approval";
  return k||"event";
}
const QUEUE_PHASE={wake:"as the turn's message",request:"before the request",loop:"between tool steps"};
function queueCommand(data){
  const type=data.type||"command";
  const timing=data.timing?(data.timing.kind==="at"?"at "+data.timing.at:data.timing.kind==="every"?"every "+Math.round(data.timing.intervalMs/1000)+"s":data.timing.kind==="cron"?data.timing.expression+" ("+data.timing.timezone+")":""):"";
  if(type==="transmit")return{channel:"transmission",title:"Transmission "+(data.routeId||data.transmissionId||""),preview:tracePreview(data.payload,160)};
  if(type==="spawn")return{channel:"spawn",title:"Spawn "+(data.definitionId||""),preview:tracePreview(data.message,160)};
  if(type==="schedule")return{channel:"schedule",title:"Schedule "+timing,preview:tracePreview(data.message,160)};
  if(/^schedule\./.test(type))return{channel:"schedule",title:"Schedule "+type.slice(9)+" "+(data.activationId||""),preview:data.patch?tracePreview(data.patch,160):""};
  if(type==="sleep")return{channel:"sleep",title:"Sleep until "+(data.wakeAt||""),preview:tracePreview(data.message,160)};
  if(type==="background")return{channel:"background",title:"Background run",preview:tracePreview(data.message,160)};
  if(type==="delegate")return{channel:"delegation",title:"Delegate to "+data.to,preview:tracePreview(data.task,160)};
  if(type==="delegate.reply")return{channel:"delegation",title:"Reply to worker",preview:tracePreview(data.message,160)};
  if(type==="delegate.ask")return{channel:"delegation",title:"Ask the delegator",preview:tracePreview(data.question,160)};
  if(type==="agent.message")return{channel:"agent message",title:"Message "+data.to,preview:tracePreview(data.message,160)};
  if(type==="mesh.send")return{channel:"mesh",title:"Mesh message to "+((data.message&&data.message.to)||""),preview:tracePreview(data.message&&(data.message.text||data.message.body||data.message),160)};
  if(/^mesh\./.test(type))return{channel:"mesh",title:"Mesh "+type.slice(5),preview:""};
  return{channel:"command",title:type,preview:""};
}
function buildQueues(events,run,trace){
  const ordered=foundrySorted(events);
  const rows=[];const byEvent={};const byCommand={};const byDelegation={};const approvals={};
  const models=((trace&&trace.items)||[]).filter(item=>item.kind==="model"&&!item.legacy);
  const seenAfter=(sequence)=>models.find(item=>(item.sequence??0)>sequence)||null;
  const source=run&&run.input&&run.input.source;
  if(run){
    const message=run.input&&run.input.message;
    const text=typeof message==="string"?message:Array.isArray(message)?message.filter(part=>part&&part.type==="text").map(part=>part.text).join(" "):"";
    const kind=(source&&source.kind)||"direct";
    const delegationTitle=source&&/^result:/.test(String(source.id||""))?"Delegation result":source&&/^delegation_/.test(String(source.id||""))?"Delegated task":"Delegation update";
    const titles={direct:"Message",transmission:"Transmission "+((source&&source.id)||""),activation:"Schedule or sleep fired",spawn:"Spawned",background:"Background run",delegation:delegationTitle,["agent-message"]:"Agent message",mesh:"Mesh thread"};
    const first=models[0]||null;
    rows.push({key:"q:trigger",dir:"in",channel:kind==="direct"?"message":queueChannel(kind),title:titles[kind]||kind,preview:tracePreview(text,200),status:"started the run",at:Date.parse(run.createdAt),seenBy:first?first.key:null,detail:{source:source||{kind:"direct"},...(source&&source.eventId?{eventId:source.eventId}:{}),...(source&&source.threadKey?{threadKey:source.threadKey}:{})},events:[]});
  }
  let turnSeen=false;
  for(const event of ordered){
    const type=traceType(event);const data=event.data||{};const at=foundryAt(event);
    if(type==="turn_start")turnSeen=true;
    if(type==="event_received"){
      const row={key:"q:e:"+data.id,dir:"in",channel:queueChannel(data.kind,data.source),title:data.source,preview:data.preview||"",status:data.disposition,at,seenBy:null,detail:{id:data.id,source:data.source,kind:data.kind,disposition:data.disposition},events:[event]};
      // The first delivery of an event turn is what started the run.
      if(!turnSeen&&rows[0]&&rows[0].key==="q:trigger"&&!rows[0].event&&source&&source.kind!=="direct"){rows[0].event=data.id;rows[0].events.push(event);byEvent[data.id]=rows[0];continue}
      byEvent[data.id]=row;rows.push(row);continue;
    }
    if(type==="event_injected"){
      for(const id of data.ids||[]){const row=byEvent[id];if(!row)continue;const seen=seenAfter(event.sequence??0);if(row.key!=="q:trigger")row.status="joined "+(QUEUE_PHASE[data.phase]||data.phase);row.injectedAt=at;row.seenBy=seen?seen.key:row.seenBy;row.events.push(event)}
      continue;
    }
    if(type==="event_dropped"){const row=byEvent[data.id];if(row){row.status="dropped ("+data.reason+")";row.events.push(event)}continue}
    if(type==="inbox_injected"){
      const seen=seenAfter(event.sequence??0);
      rows.push({key:"q:i:"+(event.id||event.sequence),dir:"in",channel:"inbox",title:"Resolved: "+(data.tags||[]).join(", "),preview:(data.ids||[]).join(", "),status:"joined "+(QUEUE_PHASE[data.phase]||data.phase),at,seenBy:seen?seen.key:null,detail:data,events:[event]});continue;
    }
    if(type==="tool_use"&&data.name==="glove_post_to_inbox"){
      const input=data.input||{};
      rows.push({key:"q:p:"+(data.id||event.sequence),dir:"out",channel:"inbox",title:"Posted: "+(input.tag||"item"),preview:tracePreview(input.request,200),status:input.blocking?"posted, blocking":"posted",at,call:data.id?"t:"+data.id:null,detail:input,events:[event]});continue;
    }
    if(type==="foundry.core.command"){
      if(data.type==="playbook.sync"||data.type==="schedule.sync")continue;
      const described=queueCommand(data);
      const row={key:"q:c:"+(data.id||event.sequence),dir:"out",...described,status:"sent",at,detail:data,events:[event]};
      if(data.id)byCommand[data.id]=row;if(data.delegationId)byDelegation[data.delegationId]=row;
      rows.push(row);continue;
    }
    if(type==="core.command.accepted"){const row=byCommand[data.commandId];if(row){row.status="accepted";if(data.childRunId)row.childRunId=data.childRunId;row.events.push(event)}continue}
    if(type==="core.command.failed"){const row=byCommand[data.command&&data.command.id];if(row){row.status="failed";row.error=data.error;row.events.push(event)}continue}
    if(type==="scheduled-action.created"){const row=byCommand[data.commandId];if(row){row.status="scheduled";row.nextRunAt=data.nextRunAt;row.events.push(event)}continue}
    if(type==="transmission.outbound.delivered"){const row=byCommand[data.commandId];if(row){row.status="delivered";row.events.push(event)}else rows.push({key:"q:o:"+(event.id||event.sequence),dir:"out",channel:"transmission",title:"Transmission "+(data.routeId||""),preview:"",status:"delivered",at,detail:data,events:[event]});continue}
    if(type==="delegation.started"){const row=byDelegation[data.delegationId];if(row){row.status="started";row.childRunId=data.workerRunId;row.events.push(event)}continue}
    if(type==="delegation.question"||type==="delegation.replied"){const row=[...rows].reverse().find(candidate=>candidate.dir==="out"&&candidate.detail&&candidate.detail.delegationId===data.delegationId&&candidate.status==="sent");if(row){row.status="delivered";row.events.push(event)}continue}
    if(type==="delegation.delivered"&&data.mode==="live"){
      // Answers and updates handed to this run while it ran: a waiting question is answered.
      const asked=[...rows].reverse().find(candidate=>candidate.dir==="out"&&candidate.detail&&candidate.detail.type==="delegate.ask"&&candidate.status!=="answered");
      if(asked){asked.status="answered";asked.events.push(event)}
      rows.push({key:"q:l:"+(event.id||event.sequence),dir:"in",channel:/^delegation_/.test(String(data.conversationId||""))?"delegation":"mailbox",title:asked?"Answer to: "+tracePreview(asked.preview,60):"Delivered while running",preview:tracePlural(data.count||1,"delivery")+" handed to the live run",status:"delivered",at,seenBy:null,detail:data,events:[event]});
      continue;
    }
    if(type==="foundry.approval.requested"){const row={key:"q:a:"+data.id,dir:"out",channel:"approval",title:"Approval for "+data.toolName,preview:tracePreview(data.toolInput,160),status:"waiting",at,detail:data,events:[event]};approvals[data.id]=row;rows.push(row);continue}
    if(type==="foundry.approval.settled"||type==="foundry.approval.failed"||type==="foundry.approval.unavailable"){
      const row=approvals[data.approvalId]||[...rows].reverse().find(candidate=>candidate.channel==="approval"&&candidate.detail.toolName===data.toolName&&candidate.status==="waiting");
      if(row){row.status=data.status||type.split(".").pop();row.settledAt=at;row.events.push(event)}continue;
    }
  }
  return rows.sort((a,b)=>(Number.isFinite(a.at)?a.at:0)-(Number.isFinite(b.at)?b.at:0));
}

/* ---- Call chain: the run among the runs it came from and started ---- */
const CHAIN_COMMANDS={spawn:"spawned",schedule:"scheduled",sleep:"woke from sleep",background:"background run",["agent.message"]:"messaged"};
function buildRunChain(runId,runs,events){
  const byId={};for(const run of runs||[])byId[run.id]=run;
  const parents={};const children={};const seen=new Set();
  const link=(from,to,label,detail)=>{
    if(!from||!to||from===to)return;const key=from+">"+to+">"+label;if(seen.has(key))return;seen.add(key);
    const edge={from,to,label,...(detail?{detail}:{})};(children[from]=children[from]||[]).push(edge);(parents[to]=parents[to]||[]).push(edge);
  };
  const delegations={};const commands={};const replies=[];
  for(const event of foundrySorted(events)){
    const type=traceType(event);const data=event.data||{};
    if(type==="foundry.core.command"&&data.id){commands[data.id]={runId:event.runId,type:data.type};continue}
    if(type==="delegation.started"){delegations[data.delegationId]={to:data.to,runId:event.runId,workerRunId:data.workerRunId};link(event.runId,data.workerRunId,"delegated to "+data.to,data.delegationId);continue}
    if(type==="delegation.replied"){replies.push({from:event.runId,delegationId:data.delegationId});continue}
    if(type==="core.command.accepted"){link(event.runId,data.childRunId,CHAIN_COMMANDS[data.type]||data.type||"started");continue}
    if(type==="run.steered"){link(data.fromRunId,data.toRunId||event.runId,"steered");continue}
  }
  // Answers reach a worker that is still running.
  for(const reply of replies){const delegation=delegations[reply.delegationId];if(delegation)link(reply.from,delegation.workerRunId,"replied",reply.delegationId)}
  // What a run hears back arrives as a run of its own, named by what it answers.
  const COMMAND_EDGES={["delegate.ask"]:"asked",["delegate.reply"]:"replied",["agent.message"]:"messaged"};
  for(const run of runs||[]){
    const source=run.input&&run.input.source;
    if(!source||!source.id||source.kind==="direct")continue;
    const id=String(source.id);
    if(/^result:/.test(id)){link(id.slice(7),run.id,"reported back");continue}
    if(commands[id]){link(commands[id].runId,run.id,COMMAND_EDGES[commands[id].type]||commands[id].type);continue}
    const delegation=source.kind==="delegation"&&delegations[id];
    if(delegation&&run.id!==delegation.workerRunId&&run.agent!==delegation.to&&delegation.workerRunId)link(delegation.workerRunId,run.id,"reported back",id);
  }
  const node=(id,edge)=>{const run=byId[id];return{id,run:run||null,edge:edge||null}};
  const ancestors=[];const visited=new Set([runId]);let current=runId;
  while(parents[current]&&parents[current].length&&ancestors.length<12){const edge=parents[current][0];if(visited.has(edge.from))break;visited.add(edge.from);ancestors.unshift(node(edge.from,edge));current=edge.from}
  const top=ancestors.length?ancestors[0].run:byId[runId];
  const origin=top&&top.input&&top.input.source&&top.input.source.kind!=="direct"?{kind:top.input.source.kind,id:top.input.source.id,provider:top.input.source.provider,eventId:top.input.source.eventId,threadKey:top.input.source.threadKey}:null;
  const started=(id)=>{const run=byId[id];const at=run?Date.parse(run.createdAt):NaN;return Number.isFinite(at)?at:Infinity};
  const descend=(id,depth,path)=>[...(children[id]||[])].sort((a,b)=>started(a.to)-started(b.to)).map(edge=>{const child=node(edge.to,edge);child.children=depth<4&&!path.has(edge.to)?descend(edge.to,depth+1,new Set([...path,edge.to])):[];return child});
  const self=node(runId,parents[runId]&&parents[runId][0]);
  self.children=descend(runId,0,new Set([runId]));
  return{origin,ancestors,self,parents:parents[runId]||[]};
}
`;
