import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import postgres from "npm:postgres@3.4.7";

const db=postgres(Deno.env.get("SUPABASE_DB_URL")!,{prepare:false,max:1,idle_timeout:5});
const BASE=Deno.env.get("SUPABASE_URL")!;
const VERSION="nyu-ai-safety-runner-v0.1";
type Options={mode?:string;limit?:number;idempotency_key?:string;domain?:string;source_item_id?:string;simulate_failure?:boolean;publish?:boolean;live?:boolean;provider?:string};
function json(payload:unknown,status=200){return Response.json(payload,{status});}
async function authorized(req:Request):Promise<boolean>{
 const t=req.headers.get("x-nyu-token")||"";
 if(!t)return false;
 const r=await db.unsafe("select decrypted_secret from vault.decrypted_secrets where name='nyu_fetch_token' limit 1");
 if(r.length!==1)return false;
 const a=new TextEncoder().encode(t),b=new TextEncoder().encode(r[0].decrypted_secret);
 if(a.length!==b.length)return false;
 let diff=0;for(let i=0;i<a.length;i++)diff |= a[i]^b[i];
 return diff===0;
}
async function evaluate(token:string,body:unknown){
 const r=await fetch(BASE+"/functions/v1/nyu-evaluator-mock",{
  method:"POST",headers:{"Content-Type":"application/json","x-nyu-token":token},
  body:JSON.stringify(body),signal:AbortSignal.timeout(25000)
 });
 const data=await r.json().catch(()=>({}));
 if(!r.ok||data.ok!==true)throw new Error("mock_evaluator_failed");
 return data;
}
async function begin(scope:string,key:string,items:number){
 const r=await db.unsafe("select nyu_private.nyu_ai_safety_begin($1,$2,$3) result",[scope,key,items]);
 return r[0].result;
}
async function finish(scope:string,id:string,success:boolean,processed:number,accepted:number,errorCode:string|null,summary:Record<string,unknown>){
 const r=await db.unsafe("select nyu_private.nyu_ai_safety_finish($1,$2::uuid,$3,$4,$5,$6,$7::jsonb) result",[
  scope,id,success,processed,accepted,errorCode,JSON.stringify(summary)
 ]);
 return r[0].result;
}
Deno.serve(async(req:Request)=>{
 if(req.method!=="POST")return json({ok:false,error:"POST_only"},405);
 let scope="",runId:string|null=null,requestedItems=0;
 try{
  if(!(await authorized(req)))return json({ok:false,error:"unauthorized"},401);
  let body:Options;
  try{body=await req.json();}catch{return json({ok:false,error:"invalid_json"},400);}
  if(!body||typeof body!=="object"||Array.isArray(body))return json({ok:false,error:"invalid_body"},400);
  if(body.publish===true||body.live===true||body.provider==="openai")return json({ok:false,error:"live_actions_disabled"},409);
  if(body.mode!=="simulate"&&body.mode!=="approved")return json({ok:false,error:"invalid_mode"},400);
  scope=body.mode==="simulate"?"sandbox":"mock";
  const key=body.idempotency_key;
  if(typeof key!=="string"||!/^[A-Za-z0-9][A-Za-z0-9._:-]{7,119}$/.test(key))return json({ok:false,error:"invalid_idempotency_key"},400);
  if(body.limit!==undefined&&(!Number.isInteger(body.limit)||body.limit<1||body.limit>20))return json({ok:false,error:"invalid_limit"},400);
  requestedItems=body.limit??1;
  if(body.simulate_failure===true&&body.mode!=="simulate")return json({ok:false,error:"fail_injection_sandbox_only"},409);
  if(body.domain!==undefined&&(typeof body.domain!=="string"||body.domain.length>200))return json({ok:false,error:"invalid_domain"},400);
  if(body.source_item_id!==undefined&&(typeof body.source_item_id!=="string"||!/^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(body.source_item_id)))return json({ok:false,error:"invalid_source_item_id"},400);
  // Atomic reservation runs before any evaluator execution. Denied reservations never call the evaluator.
  const reserve=await begin(scope,key,requestedItems);
  if(!reserve.ok)return json({ok:false,version:VERSION,mode:body.mode,blocked:true,reason:reserve.reason,run_id:reserve.run_id??null,api_calls:0,publications_created:0},409);
  runId=reserve.run_id;
  if(body.simulate_failure===true)throw new Error("injected_test_failure");
  const input=body.mode==="simulate" ? {mode:"fixtures"} : {
    mode:"approved_factpacks",limit:requestedItems,
    ...(body.domain?{domain:body.domain}:{}),
    ...(body.source_item_id?{source_item_id:body.source_item_id}:{})
  };
  const response=await evaluate(req.headers.get("x-nyu-token")!,input);
  const results=Array.isArray(response.results)?response.results.slice(0,requestedItems):[];
  const processed=results.length;
  const accepted=body.mode==="simulate"?results.filter((x:any)=>x.publication_preview?.would_publish_if_real_ai_and_verified===true).length:
    results.filter((x:any)=>x.accepted===true).length;
  const recorded=await finish(scope,runId,true,processed,accepted,null,{
   mode:body.mode,source:"nyu-evaluator-mock",simulated:true,approved_count:accepted,
   no_eligible_factpacks:body.mode==="approved"&&processed===0
  });
  if(!recorded.ok)return json({ok:false,error:"finalize_failed_closed",run_id:runId,api_calls:0},503);
  return json({ok:true,version:VERSION,run_id:runId,mode:body.mode,scope,
   requested_items:requestedItems,processed_items:processed,accepted_items:accepted,
   estimated_reserved_cents:reserve.reserved_estimated_cents,currency:"USD",
   estimated_cost_only:true,not_real_provider_pricing:true,api_calls:0,publications_created:0,
   database_writes_to_articles:0,circuit_open:recorded.circuit_open,
   results:results.map((x:any)=>({source_item_id:x.source_item_id,accepted:body.mode==="simulate"?null:x.accepted===true,
    mock_score:x.mock_evaluation?.score_total??null,blocked_reasons:x.blocked_reasons??[],
    preview:x.publication_preview?.verdict??null,actually_published:false})),
   note:"Safety-guarded mock only. No paid AI or publishing."});
 }catch(err){
  const errcode=err instanceof Error&&err.message==="injected_test_failure"?"simulated_failure":"evaluation_failed";
  if(runId){
   try{
    const f=await finish(scope,runId,false,0,0,errcode,{simulation:true,stage:"evaluation"});
    return json({ok:false,error:errcode,run_id:runId,scope,circuit_open:f.circuit_open??true,
      consecutive_failures:f.consecutive_failures??null,api_calls:0,publications_created:0},503);
   }catch{
    return json({ok:false,error:"finalization_failed_closed",run_id:runId,api_calls:0},503);
   }
  }
  console.error("nyu-ai-safety-runner",err);
  return json({ok:false,error:"guard_unavailable_fail_closed",api_calls:0},503);
 }
});
