/**
 * The inspector's reading of a run's events, as browser JavaScript.
 *
 * `buildRunTrace` turns events into what the Network view lists: each model
 * request with the system prompt, messages, runtime context and tools it was
 * sent and the response it got, and each tool call with its input, result and
 * approval. `buildConsole` turns them into levelled log lines. Both are plain
 * functions over the `/api/runs/:id/events` JSON, so tests evaluate this same
 * source, and any other client of that API can use it.
 */
export const DASHBOARD_TRACE_SCRIPT = String.raw`
function traceTime(iso){const t=Date.parse(iso);return Number.isFinite(t)?t:NaN}
function traceType(event){return String(event.type||"").replace(/^agent\./,"")}
function tracePreview(value,limit){
  let text;
  if(typeof value==="string")text=value;
  else{try{text=JSON.stringify(value)}catch{text=String(value)}}
  text=String(text??"").replace(/\s+/g," ").trim();
  return text.length>(limit||90)?text.slice(0,(limit||90)-1)+"…":text;
}
function buildRunTrace(events,run){
  const ordered=[...(events||[])].sort((a,b)=>(a.sequence??0)-(b.sequence??0));
  const prompts={},toolSets={},requests={},calls={},items=[],pendingByName={};
  const totals={requests:0,tools:0,tokensIn:0,tokensOut:0,cacheRead:0,cacheWrite:0,modelMs:0,toolMs:0,errors:0};
  let open=null,previous=null,first=NaN,last=NaN;
  const runStart=run?traceTime(run.startedAt||run.createdAt):NaN;
  const runEnd=run&&run.completedAt?traceTime(run.completedAt):NaN;
  const runningTool=()=>{for(let i=items.length-1;i>=0;i--){const item=items[i];if(item.kind==="tool"&&item.status==="pending"&&!item.via)return item}return null};
  const addTool=(item)=>{totals.tools++;items.push(item);(pendingByName[item.name]=pendingByName[item.name]||[]).push(item);return item};
  for(const event of ordered){
    const at=traceTime(event.timestamp);
    if(Number.isFinite(at)){if(!(at>=first))first=at;if(!(at<=last))last=at}
    const type=traceType(event);const data=event.data||{};
    if(type==="model_request"){
      if(data.system_prompt&&typeof data.system_prompt.text==="string")prompts[data.system_prompt.hash]=data.system_prompt.text;
      if(data.tools&&data.tools.list)toolSets[data.tools.hash]=data.tools.list;
      const traced=data.messages||{};const added=traced.added||[];
      const base=traced.base?requests[traced.base]:null;const kept=traced.kept||0;
      const prefix=base?base.messages.slice(0,kept):Array.from({length:kept},()=>null);
      while(prefix.length<kept)prefix.push(null);
      const messages=prefix.concat(Array.from({length:traced.skipped||0},()=>null),added);
      let newFrom=messages.length-added.length;
      // A run's first request carries the conversation so far; what's new starts at the run's own message.
      if(!base)for(let i=messages.length-1;i>=0;i--){const m=messages[i];if(m&&m.sender==="user"&&!m.framework_context&&!(m.tool_results||[]).length&&!m.is_compaction){newFrom=i;break}}
      const initiator=data.purpose==="compaction"?{label:"compaction"}:previous&&previous.calls.length?{label:"after "+[...new Set(previous.calls.map(id=>calls[id]&&calls[id].name).filter(Boolean))].join(", "),key:previous.key}:previous?{label:"continues #"+previous.index,key:previous.key}:{label:"run input"};
      const item={kind:"model",key:"m:"+data.request_id,id:data.request_id,index:++totals.requests,name:"#"+(totals.requests)+" "+(data.purpose==="compaction"?"compaction":"request"),model:data.model||"",purpose:data.purpose||"turn",status:"pending",startAt:at,endAt:NaN,durationMs:NaN,sequence:event.sequence,request:data,end:null,promptHash:data.system_prompt&&data.system_prompt.hash,promptChars:data.system_prompt&&data.system_prompt.chars,toolsHash:data.tools&&data.tools.hash,toolNames:(data.tools&&data.tools.names)||[],messages,newFrom,context:data.context||[],response:[],calls:[],initiator,events:[event]};
      requests[data.request_id]=item;items.push(item);open=item;previous=item;continue;
    }
    if(type==="model_request_end"){
      const item=requests[data.request_id];if(!item)continue;
      item.end=data;item.events.push(event);item.status=data.status||"success";item.endAt=at;
      item.durationMs=Number.isFinite(data.duration_ms)?data.duration_ms:at-item.startAt;
      if(Number.isFinite(data.duration_ms)&&Number.isFinite(at))item.startAt=at-data.duration_ms;
      item.tokensIn=data.tokens_in;item.tokensOut=data.tokens_out;item.cacheRead=data.cache_read_input_tokens;item.cacheWrite=data.cache_creation_input_tokens;
      item.response=data.response||[];item.error=data.error;
      totals.tokensIn+=data.tokens_in||0;totals.tokensOut+=data.tokens_out||0;totals.cacheRead+=data.cache_read_input_tokens||0;totals.cacheWrite+=data.cache_creation_input_tokens||0;
      if(Number.isFinite(item.durationMs))totals.modelMs+=item.durationMs;
      if(item.status!=="success")totals.errors++;
      for(const message of item.response)for(const call of message.tool_calls||[]){
        if(!call.id)continue;
        item.calls.push(call.id);calls[call.id]=calls[call.id]||{name:call.tool_name,request:item};
        // Adapters that don't stream tool_use: the call starts when the response arrives.
        if(!calls[call.id].item)calls[call.id].item=addTool({kind:"tool",key:"t:"+call.id,id:call.id,name:call.tool_name,input:call.input_args,status:"pending",startAt:at,endAt:NaN,durationMs:NaN,sequence:event.sequence,request:item.key,initiator:{label:"#"+item.index+" "+(item.purpose==="compaction"?"compaction":"request"),key:item.key},events:[]});
      }
      if(open===item)open=null;continue;
    }
    if(type==="model_response_complete"||type==="model_response"){
      const target=open||previous;
      if(target&&(target===open||!target.stopReason)){target.stopReason=data.stop_reason;target.events.push(event);continue}
      if(!target){
        // A runtime without request events: the response is all there is.
        const item={kind:"model",key:"m:"+(event.id||event.sequence),id:String(event.id||event.sequence),index:++totals.requests,name:"#"+totals.requests+" response",model:"",purpose:"turn",status:"success",startAt:at,endAt:at,durationMs:NaN,sequence:event.sequence,request:null,end:null,messages:[],newFrom:0,context:[],response:[{sender:"agent",text:data.text||"",tool_calls:data.tool_calls}],calls:[],toolNames:[],initiator:{label:"run"},stopReason:data.stop_reason,tokensIn:data.tokens_in,tokensOut:data.tokens_out,events:[event],legacy:true};
        totals.tokensIn+=data.tokens_in||0;totals.tokensOut+=data.tokens_out||0;items.push(item);
      }
      continue;
    }
    if(type==="tool_use"){
      const request=open||previous;
      const item=addTool({kind:"tool",key:"t:"+(data.id||event.id||event.sequence),id:data.id,name:data.name||"tool",input:data.input,status:"pending",startAt:at,endAt:NaN,durationMs:NaN,sequence:event.sequence,request:request?request.key:null,initiator:request?{label:"#"+request.index+" "+(request.purpose==="compaction"?"compaction":"request"),key:request.key}:{label:"model"},events:[event]});
      if(data.id){calls[data.id]=calls[data.id]||{name:item.name,request};calls[data.id].item=item}
      continue;
    }
    if(type==="tool_use_result"){
      const id=data.id||data.call_id;const name=data.name||data.tool_name||"tool";
      let item=id&&calls[id]&&calls[id].item;
      const queue=pendingByName[name]||[];
      if(!item)item=queue.find(candidate=>candidate.status==="pending"&&!candidate.via);
      if(!item)item=addTool({kind:"tool",key:"t:"+(id||event.id||event.sequence),id,name,input:undefined,status:"pending",startAt:at,endAt:NaN,durationMs:NaN,sequence:event.sequence,request:null,initiator:{label:"model"},events:[]});
      const index=queue.indexOf(item);if(index>=0)queue.splice(index,1);
      item.events.push(event);item.result=data.result||{};item.status=(data.result&&data.result.status)||"success";item.endAt=at;
      item.durationMs=Number.isFinite(data.duration_ms)?data.duration_ms:at-item.startAt;
      if(Number.isFinite(data.duration_ms)&&Number.isFinite(at))item.startAt=at-data.duration_ms;
      if(Number.isFinite(item.durationMs))totals.toolMs+=item.durationMs;
      if(item.status==="error")totals.errors++;
      continue;
    }
    if(/^foundry\.approval\./.test(type)){
      const name=data.toolName;const queue=pendingByName[name]||[];
      if(type==="foundry.approval.requested"){const item=queue.find(candidate=>!candidate.approval&&!candidate.via);if(item){item.approval={id:data.id,status:"pending",requestedAt:event.timestamp,input:data.toolInput};item.events.push(event)}}
      else{const item=[...items].reverse().find(candidate=>candidate.approval&&(candidate.approval.id===data.approvalId||(candidate.name===name&&candidate.approval.status==="pending")));if(item){item.approval.status=data.status||(type==="foundry.approval.failed"?"failed":type==="foundry.approval.unavailable"?"unavailable":"settled");item.approval.settledAt=event.timestamp;item.events.push(event)}}
      continue;
    }
    if(/^foundry\.repl\.programmatic-tool\./.test(type)){
      const name=data.tool||"tool";
      if(type==="foundry.repl.programmatic-tool.started"){const parent=runningTool();addTool({kind:"tool",via:"repl",key:"p:"+(event.id||event.sequence),name,fn:data.function,status:"pending",startAt:at,endAt:NaN,durationMs:NaN,sequence:event.sequence,request:parent?parent.request:null,initiator:parent?{label:parent.name+" (REPL)",key:parent.key}:{label:"REPL"},events:[event]});continue}
      const item=[...items].reverse().find(candidate=>candidate.via==="repl"&&candidate.name===name&&candidate.status==="pending");
      if(item){item.events.push(event);item.endAt=at;item.durationMs=data.durationMs;item.status=type.endsWith("completed")?"success":type.endsWith("failed")?"error":"denied";if(Number.isFinite(data.durationMs)&&Number.isFinite(at))item.startAt=at-data.durationMs;if(item.status!=="success")totals.errors++}
      else if(!type.endsWith("completed")){totals.tools++;totals.errors++;items.push({kind:"tool",via:"repl",key:"p:"+(event.id||event.sequence),name,fn:data.function,status:type.split(".").pop(),startAt:at,endAt:at,durationMs:0,sequence:event.sequence,initiator:{label:"REPL"},result:{status:"error",message:data.reason},events:[event]})}
      continue;
    }
    if(type==="subagent_invoked"){items.push({kind:"subagent",key:"s:"+(event.id||event.sequence),name:data.name,prompt:data.prompt,status:"pending",startAt:at,endAt:NaN,durationMs:NaN,sequence:event.sequence,initiator:{label:"subagent"},events:[event]});continue}
    if(type==="subagent_completed"){const item=[...items].reverse().find(candidate=>candidate.kind==="subagent"&&candidate.name===data.name&&candidate.status==="pending");if(item){item.status=data.status||"success";item.endAt=at;item.durationMs=at-item.startAt;item.message=data.message;item.events.push(event)}continue}
  }
  const start=Number.isFinite(runStart)?Math.min(runStart,Number.isFinite(first)?first:runStart):first;
  const live=run&&(run.status==="running"||run.status==="pending");
  const end=live?Math.max(Date.now(),Number.isFinite(last)?last:0):Number.isFinite(runEnd)?Math.max(runEnd,Number.isFinite(last)?last:runEnd):last;
  for(const item of items){if(item.kind==="model"){item.systemPrompt=prompts[item.promptHash];item.tools=toolSets[item.toolsHash]}}
  return{items,prompts,toolSets,totals,start,end};
}

/* Console levels follow DevTools: errors, warnings, info, and verbose detail hidden by default. */
function describeEvent(event){
  const type=traceType(event);const data=event.data||{};
  const level=(value,message,source)=>({level:value,message,source:source||event.category||"system"});
  if(type==="log.stderr")return level("warn",String(data.message??""),"stderr");
  if(type==="log.stdout")return level("info",String(data.message??""),"stdout");
  if(type==="run.failed")return level("error","Run failed"+(data.error?": "+data.error:""));
  if(type==="run.timeout")return level("error","Run timed out");
  if(type==="run.cancelled")return level("warn","Run cancelled");
  if(type==="run.retry")return level("warn","Retrying: attempt "+data.attempt+" of "+data.maxAttempts);
  if(/^run\./.test(type))return level("info","Run "+type.slice(4).replace(/-/g," "));
  if(type==="model_request"){const m=data.messages||{};const added=(m.added||[]).length;return level("info","→ Model request "+tracePreview(data.model,40)+" · "+(m.total??0)+" messages"+(added&&m.base?" ("+added+" new)":"")+" · "+(data.context||[]).length+" context · "+((data.tools&&data.tools.names)||[]).length+" tools"+(data.purpose==="compaction"?" · compaction":""))}
  if(type==="model_request_end"){
    if(data.status==="error")return level("error","← Model request failed after "+data.duration_ms+"ms: "+(data.error||"unknown error"));
    if(data.status==="aborted")return level("warn","← Model request aborted after "+data.duration_ms+"ms");
    const calls=(data.response||[]).reduce((n,m)=>n+(m.tool_calls||[]).length,0);
    return level("info","← Model response in "+data.duration_ms+"ms · "+(data.tokens_in??"?")+" in / "+(data.tokens_out??"?")+" out"+(calls?" · "+calls+" tool call"+(calls===1?"":"s"):""));
  }
  if(type==="model_response_complete"||type==="model_response")return level("verbose","Response"+(data.stop_reason?" ("+data.stop_reason+")":"")+": "+tracePreview(data.text||"",120));
  if(type==="text_delta")return level("verbose","Streamed text: "+tracePreview(data.text,160));
  if(type==="tool_use")return level("info","Tool call "+data.name+"("+tracePreview(data.input,100)+")");
  if(type==="tool_use_result"){
    const status=data.result&&data.result.status;const name=data.name||data.tool_name;const time=Number.isFinite(data.duration_ms)?" in "+data.duration_ms+"ms":"";
    if(status==="error")return level("error",name+" failed"+time+": "+tracePreview(data.result.message||data.result.data,140));
    if(status==="aborted")return level("warn",name+" aborted"+time);
    return level("info",name+" returned"+time+": "+tracePreview(data.result&&data.result.data,120));
  }
  if(type==="token_consumption")return level("verbose","Tokens: "+tracePreview(data.consumption,120));
  if(type==="runtime_context")return level("verbose","Runtime context: "+(data.messages||[]).map(m=>tracePreview(m.text,60)).join(" | "));
  if(type==="compaction_start")return level("info","Compacting the conversation at "+data.current_token_consumption+" tokens");
  if(type==="compaction_end")return level("info","Compaction finished");
  if(type==="foundry.approval.requested")return level("warn","Waiting for approval: "+data.toolName+"("+tracePreview(data.toolInput,80)+")");
  if(type==="foundry.approval.settled")return level(data.status==="approved"?"info":"warn","Approval "+data.status+": "+data.toolName);
  if(type==="foundry.approval.failed"||type==="foundry.approval.unavailable")return level("error","Approval "+type.split(".").pop()+": "+(data.toolName||"")+(data.error?" · "+data.error:""));
  if(/^foundry\.repl\.programmatic-tool\./.test(type)){const what=type.split(".").pop();return level(what==="completed"||what==="started"?"verbose":"error","REPL "+data.function+"() "+what+(data.durationMs!==undefined?" in "+data.durationMs+"ms":"")+(data.reason?": "+data.reason:""))}
  if(type==="hook_invoked")return level("info","Hook /"+data.name);
  if(type==="skill_invoked")return level("info","Skill "+data.name+" ("+data.source+")");
  if(type==="subagent_invoked")return level("info","Subagent "+data.name+": "+tracePreview(data.prompt,100));
  if(type==="subagent_completed")return level(data.status==="error"?"error":"info","Subagent "+data.name+" "+data.status+(data.message?": "+tracePreview(data.message,100):""));
  if(type==="foundry.guidance.state")return level("verbose","Guidance state");
  if(/fail|error/.test(type))return level("error",type+(data.error?": "+tracePreview(data.error,140):""));
  if(/denied|limit|warn|unavailable/.test(type))return level("warn",type);
  if(/^foundry\.(assembly|definition|layer|subscriber|repl|mesh|working-environment|installation|application)\./.test(type))return level("verbose",type.replace(/^foundry\./,""),"assembly");
  return level("verbose",type);
}
function buildConsole(events){
  const rows=[];let stream=null;
  for(const event of [...(events||[])].sort((a,b)=>(a.sequence??0)-(b.sequence??0))){
    if(traceType(event)==="text_delta"){
      if(!stream){stream={key:"c:"+(event.id||event.sequence),level:"verbose",source:"model",timestamp:event.timestamp,type:"text_delta",text:"",chunks:0,events:[]};rows.push(stream)}
      stream.text+=String((event.data&&event.data.text)||"");stream.chunks++;stream.events.push(event);
      stream.message="Streamed text ("+stream.chunks+" chunk"+(stream.chunks===1?"":"s")+"): "+tracePreview(stream.text,160);
      stream.data={text:stream.text,chunks:stream.chunks};
      continue;
    }
    stream=null;
    const described=describeEvent(event);
    rows.push({key:"c:"+(event.id||event.sequence),level:described.level,source:described.source,message:described.message,timestamp:event.timestamp,type:event.type,data:event.data,events:[event]});
  }
  return rows;
}
`;
