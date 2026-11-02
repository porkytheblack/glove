/**
 * The run page: a run reads like a browser's DevTools. Network lists every
 * model request and tool call with what it was sent and what came back,
 * Console is the run's log, Context is what the agent had to work with, and
 * Summary is the outcome. Runs in the same page script as dashboard-script.ts
 * and uses its helpers and the trace functions from dashboard-trace.ts.
 */
export const DASHBOARD_RUN_SCRIPT = String.raw`
const RUN_TABS=[["summary","Summary","overview"],["network","Network","network"],["console","Console","terminal"],["context","Context","context"]];
function runView(){
  const params=new URLSearchParams(location.search);const tab=params.get("tab");
  return{tab:RUN_TABS.some(t=>t[0]===tab)?tab:"network",item:params.get("item")||"",pane:params.get("pane")||"",node:params.get("node")||"",request:params.get("request")||""};
}
function setRunView(patch){
  const params=new URLSearchParams(location.search);
  Object.entries(patch).forEach(([key,value])=>{if(value)params.set(key,value);else params.delete(key)});
  if(params.get("tab")==="network")params.delete("tab");
  const search=params.toString();history.replaceState({},"",location.pathname+(search?"?"+search:""));
}
async function ensureRunEvents(id){
  const cached=state.runEvents[id];
  const after=cached&&cached.length?cached[cached.length-1].sequence:null;
  const fresh=await api("/api/runs/"+encodeURIComponent(id)+"/events"+(after===null?"":"?after="+after));
  state.runEvents[id]=after===null?fresh:cached.concat(fresh);
}
function runEventsFor(id){return state.runEvents[id]||eventsFor(id)}
function fmtTokens(value){const n=Number(value);if(!Number.isFinite(n))return"—";if(n<1000)return String(n);if(n<1e6)return(n/1000).toFixed(n<10000?1:0)+"k";return(n/1e6).toFixed(1)+"M"}
function jsonSize(value){try{return(JSON.stringify(value)??"").length}catch{return 0}}
function isoAt(ms){return Number.isFinite(ms)?new Date(ms).toISOString():""}
function offsetFrom(base,iso){const at=new Date(iso).getTime();return Number.isFinite(base)&&Number.isFinite(at)?"+"+durationText(Math.max(0,at-base)):""}

/* ---- A JSON tree, like DevTools': collapsed past two levels, strings that hold JSON opened up. ---- */
function jsonTree(value,key,depth){
  depth=depth||0;
  if(value===undefined)return'<span class="jv null">not recorded</span>';
  if(value===null)return'<span class="jv null">null</span>';
  if(typeof value==="string"){
    const text=value.trim();
    if(depth===0&&/^[\[{]/.test(text)){try{return'<span class="jv-note">JSON in a string</span>'+jsonTree(JSON.parse(text),key,0)}catch{}}
    return'<span class="jv str">"'+esc(value)+'"</span>';
  }
  if(typeof value==="number")return'<span class="jv num">'+esc(value)+'</span>';
  if(typeof value==="boolean")return'<span class="jv bool">'+value+'</span>';
  const isArray=Array.isArray(value);const entries=isArray?value.map((item,index)=>[index,item]):Object.entries(value);
  if(!entries.length)return'<span class="jv">'+(isArray?"[]":"{}")+'</span>';
  const preview=isArray?"Array("+entries.length+")":"{"+entries.slice(0,4).map(entry=>esc(entry[0])).join(", ")+(entries.length>4?", …":"")+"}";
  return'<details class="jt" data-persist="jt:'+attr(key)+'"'+(depth<2?" open":"")+'><summary>'+preview+'</summary><div class="jt-body">'
    +entries.slice(0,400).map(entry=>'<div class="jt-row"><span class="jk">'+esc(entry[0])+'</span>: '+jsonTree(entry[1],key+"."+entry[0],depth+1)+'</div>').join("")
    +(entries.length>400?'<div class="muted">… '+(entries.length-400)+' more</div>':"")+'</div></details>';
}
function jsonBlock(value,key){return'<div class="jt-root">'+jsonTree(value,key)+'</div>'}

/* ---- Messages as the model received them. ---- */
function traceRole(message){
  if(message.framework_context==="runtime")return{label:"Runtime context",cls:"runtime"};
  if(message.framework_context==="inbox")return{label:"Inbox",cls:"runtime"};
  if(message.is_compaction)return{label:"Compaction summary",cls:"system"};
  if(message.is_compaction_request)return{label:"Compaction request",cls:"system"};
  if(message.is_skill_injection)return{label:"Skill",cls:"system"};
  if(message.sender==="user"&&(message.tool_results||[]).length)return{label:"Tool results",cls:"tool"};
  return message.sender==="user"?{label:"User",cls:"user"}:{label:"Agent",cls:"agent"};
}
function traceMessageHtml(message,key,isNew){
  if(!message)return'<article class="tm missing"><header><span class="tm-role">Not retained</span></header><p class="tm-note">An earlier request recorded this message, and its events are no longer retained.</p></article>';
  const role=traceRole(message);let body="";
  const toolText=(message.tool_results||[]).length&&message.text==="tool results";
  if(message.text&&!toolText)body+='<div class="tm-text">'+esc(message.text)+'</div>';
  if(message.text_chars)body+='<p class="tm-note">Recorded the first '+esc(message.text.length.toLocaleString())+' of '+esc(message.text_chars.toLocaleString())+' characters.</p>';
  const media=(message.content||[]).filter(part=>part.type!=="text");
  if(media.length)body+='<div class="tm-media-row">'+media.map(part=>'<span class="tm-media">'+icon("paperclip")+esc(part.type)+(part.name?" · "+esc(part.name):"")+(part.media_type?" · "+esc(part.media_type):"")+'</span>').join("")+'</div>';
  (message.tool_calls||[]).forEach((call,index)=>{body+='<div class="tm-call"><span>Calls '+(call.id?'<button type="button" class="net-link" data-net-item="t:'+attr(call.id)+'">'+esc(call.tool_name)+'</button>':'<b>'+esc(call.tool_name)+'</b>')+(call.id?' <span class="muted">'+esc(short(call.id))+'</span>':"")+'</span>'+jsonBlock(call.input_args,key+":call"+index)+'</div>'});
  (message.tool_results||[]).forEach((result,index)=>{body+='<div class="tm-result status-'+attr(result.status)+'"><span>'+(result.call_id?'<button type="button" class="net-link" data-net-item="t:'+attr(result.call_id)+'">'+esc(result.tool_name)+'</button>':'<b>'+esc(result.tool_name)+'</b>')+' · '+esc(result.status)+(Number.isFinite(result.duration_ms)?" · "+esc(durationText(result.duration_ms)):"")+'</span>'+(result.message?'<p class="tm-note">'+esc(result.message)+'</p>':"")+jsonBlock(result.data,key+":result"+index)+'</div>'});
  if(message.reasoning_omitted)body+='<p class="tm-note">The provider’s reasoning was sent back with this message. It isn’t recorded.</p>';
  return'<article class="tm '+role.cls+(isNew?" new":"")+'"><header><span class="tm-role">'+esc(role.label)+'</span>'+(isNew?'<span class="tm-new">new</span>':"")+'</header>'+(body||'<p class="tm-note">Empty.</p>')+'</article>';
}
function messagesHtml(messages,newFrom,key){
  const earlier=messages.slice(0,newFrom);const fresh=messages.slice(newFrom);
  return(earlier.length?'<details class="msg-earlier" data-persist="'+attr(key)+':earlier"><summary>'+count(earlier.length,"earlier message")+' <span class="muted">· already in the conversation</span></summary>'+earlier.map((message,index)=>traceMessageHtml(message,key+":"+index,false)).join("")+'</details>':"")
    +(fresh.length?fresh.map((message,index)=>traceMessageHtml(message,key+":"+(newFrom+index),Boolean(earlier.length))).join(""):'<p class="dt-note">No messages.</p>');
}

/* ---- Network ---- */
function itemStatus(item){
  if(item.approval&&item.approval.status==="pending")return'<span class="st warn">approval</span>';
  const map={success:["ok","ok"],error:["err","error"],aborted:["warn","aborted"],denied:["warn","denied"],limit:["warn","limit"],pending:["live","pending"]};
  const value=map[item.status]||["",item.status||"—"];
  return'<span class="st '+value[0]+'">'+esc(value[1])+'</span>';
}
function itemType(item){return item.kind==="model"?(item.purpose==="compaction"?"compaction":"model"):item.via==="repl"?"repl call":item.kind}
function itemSubtitle(item){
  if(item.kind==="model")return(item.model||"model")+(item.messages.length?" · "+count(item.messages.length,"message"):"")+(item.context.length?" · "+item.context.length+" context":"");
  if(item.kind==="tool")return item.via==="repl"?(item.fn||item.name)+"()":tracePreview(item.input,80);
  return tracePreview(item.prompt,80);
}
function itemSize(item){
  if(item.kind==="model")return item.tokensIn!==undefined?fmtTokens(item.tokensIn)+" → "+fmtTokens(item.tokensOut):"—";
  return item.result?fmtBytes(jsonSize(item.result.data)):"—";
}
function netMatches(item,kind,term){
  if(kind==="model"&&item.kind!=="model")return false;
  if(kind==="tools"&&item.kind!=="tool")return false;
  if(kind==="errors"&&!["error","aborted","denied","limit"].includes(item.status))return false;
  if(!term)return true;
  const text=[item.name,item.model,item.fn,tracePreview(item.input,600),item.kind==="model"?(item.response||[]).map(message=>message.text).join(" "):tracePreview(item.result&&item.result.data,600)].join(" ").toLowerCase();
  return text.includes(term);
}
function netRow(item,trace,selectedKey){
  const span=Math.max(1,trace.end-trace.start);const pending=item.status==="pending";
  const left=Number.isFinite(item.startAt)?Math.min(99.4,Math.max(0,(item.startAt-trace.start)/span*100)):0;
  const width=Number.isFinite(item.durationMs)?Math.max(.6,item.durationMs/span*100):pending?100-left:.6;
  const failed=["error","aborted","denied","limit"].includes(item.status);
  return'<tr class="net-row kind-'+attr(item.kind)+(item.purpose==="compaction"?" compaction":"")+(item.key===selectedKey?" selected":"")+(failed?" failed":"")+'" data-net-item="'+attr(item.key)+'">'
    +'<td class="c-name"><span class="net-name"><i class="net-glyph"></i><span><b>'+esc(item.name)+'</b><small>'+esc(itemSubtitle(item))+'</small></span></span></td>'
    +'<td class="c-type">'+esc(itemType(item))+'</td>'
    +'<td class="c-status">'+itemStatus(item)+'</td>'
    +'<td class="c-init">'+(item.initiator.key?'<button type="button" class="net-link" data-net-item="'+attr(item.initiator.key)+'">'+esc(item.initiator.label)+'</button>':'<span class="muted">'+esc(item.initiator.label)+'</span>')+'</td>'
    +'<td class="c-size">'+esc(itemSize(item))+'</td>'
    +'<td class="c-time">'+(pending?'<span class="st live">…</span>':esc(durationText(item.durationMs)))+'</td>'
    +'<td class="c-wf"><span class="wf-track"><span class="wf-bar'+(pending?" pending":"")+'" style="left:'+left.toFixed(2)+'%;width:'+Math.min(width,100-left).toFixed(2)+'%"></span></span></td></tr>';
}
function modelPanes(item){return[["overview","Overview"],["prompt","Prompt"],["messages","Messages",item.messages.length],["context","Context",item.context.length],["tools","Tools",item.toolNames.length],["response","Response"],["raw","Raw"]]}
function toolPanes(){return[["overview","Overview"],["input","Input"],["result","Result"],["raw","Raw"]]}
function detailPanes(item){return item.kind==="model"?modelPanes(item):item.kind==="tool"?toolPanes():[["overview","Overview"],["raw","Raw"]]}
function kv(rows){return'<dl class="dt-kv">'+rows.filter(Boolean).map(row=>'<dt>'+esc(row[0])+'</dt><dd>'+row[1]+'</dd>').join("")+'</dl>'}
function itemLink(key,label){return'<button type="button" class="net-link" data-net-item="'+attr(key)+'">'+esc(label)+'</button>'}
function requestJson(item){return jsonText({model:item.model,system:item.systemPrompt??null,messages:item.messages,context:item.context,tools:item.tools||item.toolNames})}
function modelDetail(item,trace,run,pane){
  const base=new Date(runStartedAt(run)).getTime();
  if(item.legacy&&["prompt","messages","context","tools"].includes(pane))return'<p class="dt-note">This run was recorded before Foundry kept what each model request was sent, or with <code>observability.modelRequests</code> off. Its response and tool calls are here; its prompt, messages, context and tools aren’t.</p>';
  if(pane==="prompt"){
    if(item.systemPrompt===undefined)return'<p class="dt-note">This request’s system prompt ('+esc((item.promptChars||0).toLocaleString())+' characters) was recorded with an earlier request whose events are no longer retained.</p>';
    const versions=Object.keys(trace.prompts).length;
    return'<div class="dt-bar"><span>'+esc((item.promptChars??item.systemPrompt.length).toLocaleString())+' characters'+(versions>1?" · one of "+versions+" system prompts in this run":"")+'</span>'+copyButton(item.systemPrompt,"system prompt")+'</div>'+(item.systemPrompt?'<pre class="dt-pre">'+esc(item.systemPrompt)+'</pre>':'<p class="dt-note">The system prompt was empty.</p>');
  }
  if(pane==="messages")return'<p class="dt-note">The conversation as this request sent it'+(item.newFrom?", with what’s new since the last request at the end":"")+'. Runtime context is under Context.</p>'+messagesHtml(item.messages,item.newFrom,item.key+":m");
  if(pane==="context"){
    if(!item.context.length)return'<p class="dt-note">No runtime context. Context providers (memory, goals, forms, or the agent’s own) add it at the end of each request, outside the stored conversation.</p>';
    const before=trace.items.filter(other=>other.kind==="model"&&other.index<item.index).at(-1);
    return'<p class="dt-note">Added at the end of this request by context providers (memory, goals, forms, or the agent’s own). It isn’t stored in the conversation, and it is worked out again before every request.</p>'
      +item.context.map((message,index)=>{const prior=before&&before.context[index];const change=!before?"":!prior?"new":prior.text!==message.text?"changed":"same as #"+before.index;return'<article class="tm runtime"><header><span class="tm-role">Context '+(index+1)+'</span>'+(change?'<span class="tm-new'+(change.startsWith("same")?" quiet":"")+'">'+esc(change)+'</span>':"")+'</header><div class="tm-text">'+esc(message.text)+'</div>'+((message.content||[]).filter(part=>part.type!=="text").map(part=>'<span class="tm-media">'+icon("paperclip")+esc(part.type)+'</span>').join(""))+'</article>'}).join("");
  }
  if(pane==="tools"){
    if(!item.tools)return'<p class="dt-note">'+count(item.toolNames.length,"tool")+' offered. Their descriptions were recorded with an earlier request whose events are no longer retained.</p><div class="cap-list">'+item.toolNames.map(name=>'<span class="cap">'+esc(name)+'</span>').join("")+'</div>';
    return'<p class="dt-note">What the model was told about each tool it could call.</p>'+item.tools.map(tool=>'<details class="tool-def" data-persist="'+attr(item.key+":tool:"+tool.name)+'"><summary><b>'+esc(tool.name)+'</b><span>'+esc(tracePreview(tool.description,110))+'</span></summary><p class="dt-note">'+esc(tool.description)+'</p>'+jsonBlock(tool.input_schema,item.key+":schema:"+tool.name)+'</details>').join("");
  }
  if(pane==="response"){
    if(item.status==="pending")return'<p class="dt-note">Waiting for the model.</p>';
    return(item.error?'<div class="alert danger"><span class="symbol">'+icon("warning")+'</span><div><b>The request '+esc(item.status==="aborted"?"was aborted":"failed")+'.</b><p>'+esc(item.error)+'</p></div></div>':"")
      +kv([item.stopReason?["Stop reason",esc(item.stopReason)]:null,["Tokens",esc(fmtTokens(item.tokensIn))+" in · "+esc(fmtTokens(item.tokensOut))+" out"]])
      +(item.response||[]).map((message,index)=>traceMessageHtml(message,item.key+":r"+index,false)).join("");
  }
  if(pane==="raw")return'<div class="dt-bar"><span>'+count(item.events.length,"event")+'</span>'+copyButton(jsonText(item.events),"raw events")+'</div>'+jsonBlock(item.events.map(event=>({type:event.type,timestamp:event.timestamp,data:event.data})),item.key+":raw");
  const fresh=item.messages.slice(item.newFrom);const calls=(item.response||[]).flatMap(message=>message.tool_calls||[]);
  return kv([
    ["Request",'<span class="mono">'+esc(item.id)+'</span> '+copyButton(item.id,"request id")],
    ["Model",esc(item.model||"—")],
    ["Status",itemStatus(item)+(item.error?' <span class="muted">'+esc(item.error)+'</span>':"")],
    ["Started",esc(offsetFrom(base,isoAt(item.startAt)))+' <span class="muted">'+esc(fmtTime(isoAt(item.startAt)))+'</span>'],
    ["Duration",esc(durationText(item.durationMs))],
    ["Tokens",esc(fmtTokens(item.tokensIn))+" in · "+esc(fmtTokens(item.tokensOut))+" out"+(item.cacheRead?" · "+esc(fmtTokens(item.cacheRead))+" read from cache":"")+(item.cacheWrite?" · "+esc(fmtTokens(item.cacheWrite))+" written to cache":"")],
    item.stopReason?["Stop reason",esc(item.stopReason)]:null,
    ["Initiator",item.initiator.key?itemLink(item.initiator.key,item.initiator.label):esc(item.initiator.label)],
    ["System prompt",(item.promptChars!==undefined?esc(item.promptChars.toLocaleString())+" characters":"—")+" · "+'<button type="button" class="net-link" data-net-pane="prompt">view</button>'],
    ["Messages",esc(count(item.messages.length,"message"))+(fresh.length&&item.newFrom?" · "+fresh.length+" new":"")+" · "+'<button type="button" class="net-link" data-net-pane="messages">view</button>'],
    ["Runtime context",esc(count(item.context.length,"entry","entries"))+(item.context.length?" · "+'<button type="button" class="net-link" data-net-pane="context">view</button>':"")],
    ["Tools offered",esc(item.toolNames.length)+(item.toolNames.length?" · "+'<button type="button" class="net-link" data-net-pane="tools">view</button>':"")],
  ])
  +(calls.length?'<div class="dt-section">Tool calls in the response</div><div class="cap-list">'+calls.map(call=>call.id?itemLink("t:"+call.id,call.tool_name):'<span class="cap">'+esc(call.tool_name)+'</span>').join("")+'</div>':"")
  +((item.response||[]).some(message=>message.text)?'<div class="dt-section">Reply</div><div class="dt-pre">'+esc((item.response||[]).map(message=>message.text).filter(Boolean).join("\n\n"))+'</div>':"");
}
function toolDetail(item,run,pane){
  const base=new Date(runStartedAt(run)).getTime();
  if(pane==="input")return item.via==="repl"?'<p class="dt-note">Calls made from inside the REPL record their function and timing. Their input stays in the REPL program; see the REPL tool call that made it.</p>':jsonBlock(item.input,item.key+":input");
  if(pane==="result"){
    if(!item.result)return'<p class="dt-note">'+(item.status==="pending"?"Still running.":"No result recorded.")+'</p>';
    return kv([["Status",itemStatus(item)],item.result.message?["Message",esc(item.result.message)]:null,["Size",esc(fmtBytes(jsonSize(item.result.data)))]])+(typeof item.result.data==="string"&&!/^\s*[\[{]/.test(item.result.data)?'<pre class="dt-pre">'+esc(item.result.data)+'</pre>':jsonBlock(item.result.data,item.key+":result"));
  }
  if(pane==="raw")return'<div class="dt-bar"><span>'+count(item.events.length,"event")+'</span>'+copyButton(jsonText(item.events),"raw events")+'</div>'+jsonBlock(item.events.map(event=>({type:event.type,timestamp:event.timestamp,data:event.data})),item.key+":raw");
  if(item.kind==="subagent")return kv([["Subagent",esc(item.name)],["Status",itemStatus(item)],["Duration",esc(durationText(item.durationMs))],item.message?["Result",esc(item.message)]:null])+'<div class="dt-section">Prompt</div><pre class="dt-pre">'+esc(item.prompt||"")+'</pre>';
  return kv([
    item.id?["Call",'<span class="mono">'+esc(item.id)+'</span> '+copyButton(item.id,"call id")]:null,
    ["Tool",esc(item.name)+(item.via==="repl"?' <span class="muted">· '+esc(item.fn||"")+'() from the REPL</span>':"")],
    ["Status",itemStatus(item)],
    Number.isFinite(item.startAt)?["Started",esc(offsetFrom(base,isoAt(item.startAt)))]:null,
    ["Duration",esc(durationText(item.durationMs))],
    ["Called by",item.initiator.key?itemLink(item.initiator.key,item.initiator.label):esc(item.initiator.label)],
    item.approval?["Approval",'<span class="st '+(item.approval.status==="approved"?"ok":item.approval.status==="pending"?"warn":"err")+'">'+esc(item.approval.status)+'</span> <span class="muted">requested '+esc(fmtTime(item.approval.requestedAt))+(item.approval.settledAt?", settled "+esc(fmtTime(item.approval.settledAt)):"")+'</span>']:null,
    item.result?["Result",esc(fmtBytes(jsonSize(item.result.data)))+" · "+'<button type="button" class="net-link" data-net-pane="result">view</button>']:null,
  ])+(item.via==="repl"?"":'<div class="dt-section">Input</div>'+jsonBlock(item.input,item.key+":overview-input"));
}
function netDetail(item,trace,run,view){
  const panes=detailPanes(item);const pane=panes.some(entry=>entry[0]===view.pane)?view.pane:"overview";
  const body=item.kind==="model"?modelDetail(item,trace,run,pane):toolDetail(item,run,pane);
  return'<aside class="net-detail" aria-label="'+attr(item.name)+'"><div class="nd-head"><button type="button" class="nd-close" data-net-close title="Close (Esc)" aria-label="Close">'+icon("close")+'</button>'
    +panes.map(entry=>'<button type="button" class="nd-tab'+(entry[0]===pane?" active":"")+'" data-net-pane="'+attr(entry[0])+'">'+esc(entry[1])+(entry[2]?'<span class="dt-badge">'+entry[2]+'</span>':"")+'</button>').join("")
    +(item.kind==="model"&&item.request?'<span class="nd-actions">'+'<button type="button" class="button" data-copy="'+attr(requestJson(item))+'" title="The system prompt, messages, context and tools of this request as JSON">'+icon("copy")+'<span>Copy request</span></button></span>':"")
    +'</div><div class="nd-title"><b>'+esc(item.name)+'</b><span>'+esc(itemType(item))+(item.model?" · "+esc(item.model):"")+'</span></div><div class="nd-body" data-scroll-key="nd:'+attr(item.key+":"+pane)+'">'+body+'</div></aside>';
}
function runNetwork(run,trace,view){
  const term=state.network.filter.trim().toLowerCase();
  const visible=trace.items.filter(item=>netMatches(item,state.network.kind,term));
  const selected=trace.items.find(item=>item.key===view.item);
  const kinds=[["all","All"],["model","Model"],["tools","Tools"],["errors","Errors"]];
  const t=trace.totals;
  let html='<div class="dt-toolbar"><label class="dt-filter">'+icon("search")+'<input id="net-filter" value="'+attr(state.network.filter)+'" placeholder="Filter by name, input or result" aria-label="Filter requests" /></label>'
    +'<div class="dt-chips" role="group" aria-label="Request type">'+kinds.map(kind=>'<button type="button" class="dt-chip'+(state.network.kind===kind[0]?" active":"")+'" data-net-kind="'+kind[0]+'">'+kind[1]+'</button>').join("")+'</div></div>';
  html+='<div class="net-split'+(selected?" has-detail":"")+'"><div class="net-list" data-scroll-key="net-list">';
  if(!trace.items.length)html+=empty("No requests recorded","Model requests and tool calls appear here as the run makes them. Runs recorded before request tracing, or with observability.modelRequests off, list only tool calls and responses.");
  else html+='<table class="net-table">'+(selected?"":'<colgroup><col class="w-name"><col class="w-type"><col class="w-status"><col class="w-init"><col class="w-size"><col class="w-time"><col class="w-wf"></colgroup>')+'<thead><tr><th class="c-name">Name</th><th class="c-type">Type</th><th class="c-status">Status</th><th class="c-init">Initiator</th><th class="c-size" title="Tokens in → out for model requests, result size for tools">Size</th><th class="c-time">Time</th><th class="c-wf">Waterfall</th></tr></thead><tbody>'+visible.map(item=>netRow(item,trace,view.item)).join("")+'</tbody></table>'+(visible.length?"":empty("Nothing matches","Clear the filter to see every request."));
  html+='</div>'+(selected?netDetail(selected,trace,run,view):"")+'</div>';
  html+='<div class="net-foot"><span>'+(visible.length===trace.items.length?"":visible.length+" / ")+count(t.requests,"model request")+'</span><span>'+count(t.tools,"tool call")+'</span><span>'+esc(fmtTokens(t.tokensIn))+' in · '+esc(fmtTokens(t.tokensOut))+' out'+(t.cacheRead?" · "+esc(fmtTokens(t.cacheRead))+" cached":"")+'</span><span>model '+esc(durationText(t.modelMs))+' · tools '+esc(durationText(t.toolMs))+'</span>'+(t.errors?'<span class="st err">'+count(t.errors,"error")+'</span>':"")+'<span class="net-foot-right">finished in '+esc(durationText(runDurationMs(run)))+'</span></div>';
  return html;
}

/* ---- Console ---- */
const CONSOLE_LEVELS={default:["error","warn","info"],all:["error","warn","info","verbose"],warnings:["error","warn"],errors:["error"]};
function revealKey(row){
  const type=String(row.type||"").replace(/^agent\./,"");const data=row.data||{};
  if(type==="model_request"||type==="model_request_end")return"m:"+data.request_id;
  if(type==="tool_use")return data.id?"t:"+data.id:"";
  if(type==="tool_use_result")return(data.id||data.call_id)?"t:"+(data.id||data.call_id):"";
  return"";
}
function consoleRow(row,base){
  const reveal=revealKey(row);
  const glyph=row.level==="error"||row.level==="warn"?icon("warning"):"";
  return'<div class="con-row lvl-'+attr(row.level)+'" data-event-key="'+attr(row.key)+'"><button type="button" class="con-line"><span class="con-time" title="'+attr(fullDate(row.timestamp))+'">'+esc(offsetFrom(base,row.timestamp))+'</span><span class="con-lvl">'+glyph+'</span><span class="con-msg">'+esc(row.message)+'</span><span class="con-src">'+esc(row.source)+'</span></button>'
    +'<div class="con-detail"><div class="con-detail-head"><span class="mono muted">'+esc(row.type)+" · "+esc(fmtTime(row.timestamp))+'</span>'+(reveal?'<button type="button" class="net-link" data-reveal="'+attr(reveal)+'">Open in Network</button>':"")+copyButton(jsonText(row.data),"event data")+'</div>'+(row.type==="text_delta"?'<pre class="dt-pre">'+esc(row.data.text)+'</pre>':jsonBlock(row.data,row.key))+'</div></div>';
}
function runConsole(run,rows){
  const c=state.console;const levels=CONSOLE_LEVELS[c.level]||CONSOLE_LEVELS.default;const term=c.filter.trim().toLowerCase();
  const sources=[...new Set(rows.map(row=>row.source))].sort();
  const visible=rows.filter(row=>levels.includes(row.level)&&(c.source==="all"||row.source===c.source)&&(!term||(row.message+" "+row.type).toLowerCase().includes(term)));
  const shown=visible.slice(-1500);const base=new Date(runStartedAt(run)).getTime();
  const errors=rows.filter(row=>row.level==="error").length;const warnings=rows.filter(row=>row.level==="warn").length;const hidden=rows.length-visible.length;
  return'<div class="dt-toolbar"><label class="dt-filter">'+icon("search")+'<input id="con-filter" value="'+attr(c.filter)+'" placeholder="Filter" aria-label="Filter the console" /></label>'
    +'<select class="dt-select" id="con-level" aria-label="Levels">'+[["default","Default levels"],["all","All levels"],["warnings","Warnings and errors"],["errors","Errors"]].map(option=>'<option value="'+option[0]+'"'+(c.level===option[0]?" selected":"")+'>'+option[1]+'</option>').join("")+'</select>'
    +'<select class="dt-select" id="con-source" aria-label="Source"><option value="all">All sources</option>'+sources.map(source=>'<option value="'+attr(source)+'"'+(c.source===source?" selected":"")+'>'+esc(source)+'</option>').join("")+'</select>'
    +'<span class="dt-summary">'+(errors?'<span class="st err">'+count(errors,"error")+'</span> ':"")+(warnings?'<span class="st warn">'+count(warnings,"warning")+'</span> ':"")+(hidden?esc(hidden)+" hidden":"")+'</span></div>'
    +'<div class="con-list" data-scroll-key="con-list" data-follow>'+(visible.length>shown.length?'<p class="dt-note con-more">'+esc(visible.length-shown.length)+' earlier lines aren’t shown. Narrow the filter to see them.</p>':"")+(shown.length?shown.map(row=>consoleRow(row,base)).join(""):empty(rows.length?"Nothing at these levels":"Nothing logged yet",rows.length?"Choose All levels to include verbose detail, such as assembly and streamed text.":"The run’s log appears here as it works."))+'</div>';
}

/* ---- Context: what the agent had, like DevTools' Application panel. ---- */
const CONTEXT_NODES=[["Model request","prompt","System prompt"],["Model request","runtime","Runtime context"],["Model request","tools","Tools"],["Model request","messages","Messages"],["Run","input","Input"],["Run","output","Output"],["Agent","instance","Instance context"],["Agent","installations","Installations"],["Agent","playbooks","Playbooks"],["Memory","guidance","Goals, facts and forms"],["Memory","memory","Memory"]];
function runContext(run,trace,events,view){
  const models=trace.items.filter(item=>item.kind==="model"&&!item.legacy);
  const request=models.find(item=>item.id===view.request)||models.at(-1);
  const node=CONTEXT_NODES.some(entry=>entry[1]===view.node)?view.node:"prompt";
  const instance=state.instances.find(item=>item.id===run.agentId);
  const memoryEvents=events.filter(event=>event.category==="memory");
  const counts={prompt:Object.keys(trace.prompts).length||"",runtime:request?request.context.length:"",tools:request?request.toolNames.length:"",messages:request?request.messages.length:"",installations:instance?instance.installations.length:"",playbooks:instance?instance.playbooks.length:"",memory:memoryEvents.length||""};
  let tree="";let group="";
  CONTEXT_NODES.forEach(entry=>{if(entry[0]!==group){group=entry[0];tree+='<div class="ctx-group">'+esc(group)+'</div>'}tree+='<button type="button" class="ctx-node'+(entry[1]===node?" active":"")+'" data-ctx-node="'+entry[1]+'">'+esc(entry[2])+(counts[entry[1]]!==undefined&&counts[entry[1]]!==""?'<small>'+esc(counts[entry[1]])+'</small>':"")+'</button>'});
  const scoped=["prompt","runtime","tools","messages"].includes(node);
  let body="";
  if(scoped&&!request)body=empty("No model requests recorded","Runs recorded before request tracing, or with observability.modelRequests off, don’t carry what the model was sent. Tool calls and results are under Network.");
  else if(node==="prompt")body=modelDetail(request,trace,run,"prompt")+(Object.keys(trace.prompts).length>1?'<div class="dt-section">System prompts in this run</div>'+Object.keys(trace.prompts).map(hash=>{const users=models.filter(item=>item.promptHash===hash);return'<p class="dt-note">'+users.map(item=>itemLink(item.key,"#"+item.index)).join(" ")+' · '+esc(tracePreview(trace.prompts[hash],140))+'</p>'}).join(""):"");
  else if(node==="runtime")body=modelDetail(request,trace,run,"context");
  else if(node==="tools")body=modelDetail(request,trace,run,"tools");
  else if(node==="messages")body=modelDetail(request,trace,run,"messages");
  else if(node==="input"){const message=run.input&&run.input.message;const text=typeof message==="string"?message:message&&typeof message.text==="string"?message.text:"";body=(text?'<div class="dt-section">Message</div><pre class="dt-pre">'+esc(text)+'</pre>':"")+'<div class="dt-section">Recorded input</div>'+jsonBlock(run.input,"ctx:input")}
  else if(node==="output")body=run.status==="failed"?'<div class="alert danger"><span class="symbol">'+icon("warning")+'</span><div><b>The run failed.</b><p>'+esc(runErrorText(run))+'</p></div></div>':run.output===undefined?'<p class="dt-note">'+(isLiveRun(run)?"The run hasn’t finished.":"No output recorded.")+'</p>':jsonBlock(run.output,"ctx:output");
  else if(node==="instance")body=instance?kv([["Instance",'<a class="link mono" href="/instances/'+attr(instance.id)+'" data-link>'+esc(instance.name||instance.id)+'</a>'],["Definition",esc(instance.definitionId)],["Workspace",'<a class="link mono" href="/workspaces/'+attr(instance.workspaceId)+'" data-link>'+esc(instance.workspaceId)+'</a>'],["Conversation",run.conversationId?'<a class="link mono" href="'+attr(chatPath(instance.id,run.conversationId))+'" data-link>'+esc(short(run.conversationId))+'</a>':"—"]])+'<div class="dt-section">Context</div><p class="dt-note">The instance’s stored context as it is now. A run reads it when it starts.</p>'+jsonBlock(instance.context||{},"ctx:instance"):empty("Instance not found","This run’s agent instance is no longer stored.");
  else if(node==="installations")body=instance?(instance.installations.length?jsonBlock(instance.installations,"ctx:installations"):empty("Nothing installed","Applications, MCP servers and shared tools installed on this instance appear here.")):empty("Instance not found","");
  else if(node==="playbooks")body=instance?(instance.playbooks.length?jsonBlock(instance.playbooks,"ctx:playbooks"):empty("No playbooks","")):empty("Instance not found","");
  else if(node==="guidance"){const card=guidanceCard(events);const latest=[...events].reverse().find(event=>/(?:^|\.)foundry\.guidance\.state$/.test(event.type));body=card?card+'<div class="dt-section">Latest state</div>'+jsonBlock(latest.data,"ctx:guidance"):empty("No goals, facts or forms","This run didn’t mount guidance, or it hasn’t reported yet.")}
  else if(node==="memory")body='<p class="dt-note">What the run mounted for memory, and memory events it recorded. What memory put in front of the model is in each request’s runtime context.</p>'+(request&&request.context.length?'<p class="dt-note">'+itemLink(request.key,"Open #"+request.index+"’s runtime context")+'</p>':"")+(memoryEvents.length?memoryEvents.map(event=>'<div class="dt-section">'+esc(event.type.replace(/^agent\./,""))+" · "+esc(fmtTime(event.timestamp))+'</div>'+jsonBlock(event.data,"ctx:mem:"+event.id)).join(""):empty("No memory events","This run recorded no memory events."));
  const select=scoped&&models.length?'<label class="ctx-request"><span>As of</span><select class="dt-select" id="ctx-request">'+models.map(item=>'<option value="'+attr(item.id)+'"'+(item===request?" selected":"")+'>'+esc(item.name)+" · "+esc(fmtTime(isoAt(item.startAt)))+'</option>').join("")+'</select></label>':"";
  return'<div class="ctx"><nav class="ctx-tree" aria-label="Context">'+tree+'</nav><div class="ctx-view" data-scroll-key="ctx:'+attr(node)+'">'+select+body+'</div></div>';
}

/* ---- Summary ---- */
function runSummary(run,events,trace){
  const slow=trace.items.filter(item=>Number.isFinite(item.durationMs)).sort((a,b)=>b.durationMs-a.durationMs).slice(0,5);
  const failed=trace.items.filter(item=>["error","aborted","denied","limit"].includes(item.status));
  let html='<div class="dt-pad">'+guidanceCard(events)+'<div class="grid cols-3"><section class="card span-2"><div class="card-head"><h2>Run spine</h2><span class="meta">'+count(events.length,"event")+'</span></div><div class="card-body"><div class="trace-note">Observable work only: what was sent, called and returned. A model’s hidden reasoning isn’t recorded.</div><div class="run-spine">'+phaseData(run,events).map(p=>'<div class="phase '+p.state+'"><span class="phase-dot"></span><div><strong>'+esc(p.name)+'</strong><p>'+esc(p.detail)+'</p></div><time title="'+attr(fullDate(p.time))+'">'+esc(fmtTime(p.time))+'</time></div>').join("")+'</div></div></section>';
  html+=card("Result",'<div class="card-body"><div class="summary-box"><dl><dt>Created</dt><dd>'+relCell(run.createdAt)+'</dd><dt>Started</dt><dd>'+relCell(run.startedAt)+'</dd><dt>Finished</dt><dd>'+relCell(run.completedAt)+'</dd><dt>Timeout</dt><dd>'+esc(durationText(run.timeoutMs))+'</dd></dl></div><details data-persist="output" open><summary class="link">Output</summary>'+jsonBlock(run.output??run.error??null,"summary:output")+'</details><details data-persist="input"><summary class="link">Input</summary>'+jsonBlock(run.input,"summary:input")+'</details></div>',"Recorded outcome");
  html+='</div><div class="grid cols-2">';
  html+=card("Slowest steps",slow.length?'<div class="card-body">'+slow.map(item=>'<div class="sum-row">'+itemLink(item.key,item.name)+'<span class="muted">'+esc(itemType(item))+'</span><span class="mono">'+esc(durationText(item.durationMs))+'</span></div>').join("")+'</div>':empty("Nothing timed yet",""),"Network");
  html+=card("Errors",failed.length?'<div class="card-body">'+failed.map(item=>'<div class="sum-row">'+itemLink(item.key,item.name)+'<span class="muted">'+esc(item.status)+'</span><span class="sum-msg">'+esc(tracePreview(item.error||(item.result&&(item.result.message||item.result.data))||"",120))+'</span></div>').join("")+'</div>':empty("No failed requests or tool calls",""),count(failed.length,"error"));
  return html+'</div></div>';
}

function renderRun(id){
  const run=state.runs.find(x=>x.id===id);if(!run)return renderNotFound("Run");
  const events=runEventsFor(id);const trace=buildRunTrace(events,run);const rows=buildConsole(events);const view=runView();
  crumbs([{label:"Runs",href:"/runs"},{label:short(id)}]);
  const actions=(isLiveRun(run)?'<button class="button danger" data-cancel>Cancel run</button>':"")
    +'<button class="button" data-copy="'+attr(run.id)+'">'+icon("copy")+'<span>Copy run id</span></button>'
    +'<button class="button" data-export-trace title="The run and every event, as JSON">'+icon("download")+'<span>Export trace</span></button>'
    +'<button class="button primary" data-rerun>'+icon("refresh")+'<span>Run again</span></button>';
  let html=pageHead("Run",run.agent+" · "+short(id),explainRun(run),actions);
  const failure=runErrorText(run);
  if(failure)html+='<div class="alert danger"><span class="symbol">'+icon("warning")+'</span><div><b>This run failed'+(run.attempts>1?" after "+count(run.attempts,"attempt"):"")+'.</b><p>'+esc(failure)+'</p></div></div>';
  html+=approvalRail(pendingApprovals(run.id),"This run is waiting for a decision");
  const t=trace.totals;
  html+='<div class="detail-strip">'
    +'<div><label>Status</label><strong>'+status(run.status)+'</strong></div>'
    +'<div><label>Duration</label><strong>'+durCell(run)+'</strong></div>'
    +'<div><label>Model requests</label><strong>'+esc(t.requests)+(t.errors?' <span class="st err">'+count(t.errors,"error")+'</span>':"")+'</strong></div>'
    +'<div><label>Tool calls</label><strong>'+esc(t.tools)+'</strong></div>'
    +'<div><label>Tokens</label><strong>'+esc(fmtTokens(t.tokensIn))+" in · "+esc(fmtTokens(t.tokensOut))+" out"+'</strong></div>'
    +'<div><label>Agent instance</label><strong>'+(run.agentId?'<a class="link mono" href="/instances/'+attr(run.agentId)+'" data-link>'+esc(short(run.agentId))+'</a>':"Not recorded")+'</strong></div>'
    +'</div>';
  const errors=rows.filter(row=>row.level==="error").length;const warnings=rows.filter(row=>row.level==="warn").length;
  const badge={network:trace.items.length?'<span class="dt-badge">'+trace.items.length+'</span>':"",console:(errors?'<span class="dt-badge err">'+errors+'</span>':"")+(warnings?'<span class="dt-badge warn">'+warnings+'</span>':"")};
  html+='<section class="devtools"><div class="dt-tabs" role="tablist" aria-label="Run views">'+RUN_TABS.map(tab=>'<button type="button" role="tab" class="dt-tab'+(view.tab===tab[0]?" active":"")+'" aria-selected="'+(view.tab===tab[0])+'" data-run-tab="'+tab[0]+'">'+icon(tab[2])+esc(tab[1])+(badge[tab[0]]||"")+'</button>').join("")
    +(isLiveRun(run)?'<span class="dt-live"><i class="pulse-dot"></i>Live</span>':"")+'<span class="dt-hint">1–4 views · j / k requests · / filter · Esc close</span></div><div class="dt-body dt-'+view.tab+'">'
    +(view.tab==="summary"?runSummary(run,events,trace):view.tab==="console"?runConsole(run,rows):view.tab==="context"?runContext(run,trace,events,view):runNetwork(run,trace,view))+'</div></section>';
  $("content").innerHTML=html;
  bindRun(id,run,trace,events);
}
function rerenderRun(id){const view=captureView();renderRun(id);restoreView(view)}
function selectRunItem(id,key){if(!key)return;setRunView({tab:"network",item:key});rerenderRun(id);requestAnimationFrame(()=>document.querySelector('.net-row.selected')?.scrollIntoView({block:"nearest"}))}
function bindRun(id,run,trace,events){
  document.querySelectorAll("[data-run-tab]").forEach(node=>node.onclick=()=>{setRunView({tab:node.dataset.runTab});rerenderRun(id)});
  document.querySelectorAll("[data-net-item]").forEach(node=>node.onclick=event=>{event.preventDefault();event.stopPropagation();selectRunItem(id,node.dataset.netItem)});
  document.querySelectorAll("[data-reveal]").forEach(node=>node.onclick=event=>{event.stopPropagation();selectRunItem(id,node.dataset.reveal)});
  document.querySelectorAll("[data-net-pane]").forEach(node=>node.onclick=()=>{setRunView({pane:node.dataset.netPane});rerenderRun(id)});
  document.querySelectorAll("[data-net-kind]").forEach(node=>node.onclick=()=>{state.network.kind=node.dataset.netKind;rerenderRun(id)});
  const close=document.querySelector("[data-net-close]");if(close)close.onclick=()=>{setRunView({item:"",pane:""});rerenderRun(id)};
  const keepTyping=(input,apply)=>input&&(input.oninput=event=>{const caret=event.target.selectionStart;apply(event.target.value);rerenderRun(id);const next=$(input.id);if(next){next.focus();try{next.setSelectionRange(caret,caret)}catch{}}});
  keepTyping($("net-filter"),value=>{state.network.filter=value});
  keepTyping($("con-filter"),value=>{state.console.filter=value});
  const level=$("con-level");if(level)level.onchange=event=>{state.console.level=event.target.value;rerenderRun(id)};
  const source=$("con-source");if(source)source.onchange=event=>{state.console.source=event.target.value;rerenderRun(id)};
  document.querySelectorAll(".con-line").forEach(node=>node.onclick=()=>node.parentElement.classList.toggle("open"));
  document.querySelectorAll("[data-ctx-node]").forEach(node=>node.onclick=()=>{setRunView({node:node.dataset.ctxNode});rerenderRun(id)});
  const request=$("ctx-request");if(request)request.onchange=event=>{setRunView({request:event.target.value});rerenderRun(id)};
  const cancel=document.querySelector("[data-cancel]");if(cancel)cancel.onclick=()=>void cancelRun(id);
  const rerun=document.querySelector("[data-rerun]");
  if(rerun)rerun.onclick=()=>openRunDrawer(state.instances.find(x=>x.id===run.agentId)?.definitionId,run.agentId,typeof run.input?.message?.text==="string"?run.input.message.text:typeof run.input?.message==="string"?run.input.message:"");
  const exportButton=document.querySelector("[data-export-trace]");
  if(exportButton)exportButton.onclick=()=>{const blob=new Blob([JSON.stringify({run,events},null,2)+"\n"],{type:"application/json"});const url=URL.createObjectURL(blob);const link=document.createElement("a");link.href=url;link.download="run-"+run.id+".json";document.body.appendChild(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);toast("Trace exported")};
  dataLinks();
}
/* Keys on the run page: 1-4 switch views, j/k walk the requests, Esc closes the open one. */
function runKeys(e){
  const current=route();if(current.section!=="runs"||!current.id)return false;
  const index=["1","2","3","4"].indexOf(e.key);
  if(index>=0){setRunView({tab:RUN_TABS[index][0]});rerenderRun(current.id);return true}
  const view=runView();
  if(view.tab==="network"&&(e.key==="j"||e.key==="k"||e.key==="ArrowDown"||e.key==="ArrowUp")){
    const rows=[...document.querySelectorAll(".net-row")];if(!rows.length)return false;
    const at=rows.findIndex(row=>row.dataset.netItem===view.item);
    const next=rows[Math.min(rows.length-1,Math.max(0,at<0?0:at+(e.key==="j"||e.key==="ArrowDown"?1:-1)))];
    e.preventDefault();selectRunItem(current.id,next.dataset.netItem);return true;
  }
  if(e.key==="Escape"&&view.item){setRunView({item:"",pane:""});rerenderRun(current.id);return true}
  return false;
}
`;
