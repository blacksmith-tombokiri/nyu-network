import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import postgres from 'npm:postgres@3.4.7';
const db=postgres(Deno.env.get('SUPABASE_DB_URL')!,{prepare:false,max:2,idle_timeout:8});
const BASE=Deno.env.get('SUPABASE_URL')!;
const VERSION='nyu-pipeline-sequential-v0.2';
const MAX_FETCH_CONCURRENT=5;
const timeout=50000;
function okJson(value:unknown,status=200){return Response.json(value,{status});}
async function authorized(req:Request){
 const token=req.headers.get('x-nyu-token')||'';
 if(!token)return false;
 const v=await db.unsafe("select decrypted_secret from vault.decrypted_secrets where name='nyu_fetch_token' limit 1");
 if(v.length!==1)return false;
 const a=new TextEncoder().encode(token),b=new TextEncoder().encode(v[0].decrypted_secret);
 if(a.length!==b.length)return false;
 let mismatch=0;for(let i=0;i<a.length;i++)mismatch|=a[i]^b[i];
 return mismatch===0;
}
function scheduledCycle(){
 const jst=new Date(Date.now()+9*3600000);
 const date=jst.toISOString().slice(0,10).replaceAll('-','');
 const hour=Math.floor(jst.getUTCHours()/6)*6;
 return 'scheduled_'+date+'_'+String(hour).padStart(2,'0');
}
async function call(slug:string,token:string,body:Record<string,unknown>,ms=timeout){
 const r=await fetch(BASE+'/functions/v1/'+slug,{method:'POST',
  headers:{'Content-Type':'application/json','x-nyu-token':token},
  body:JSON.stringify(body),signal:AbortSignal.timeout(ms)});
 const j=await r.json().catch(()=>({}));
 if(!r.ok||j.ok===false||j.error)throw Error(slug+'_failed_'+r.status+'_'+String(j.error||'').slice(0,90));
 return j;
}
async function start(cycle:string,stage:string,domain:string|null,mode:string){
 const rows=await db.unsafe("select nyu_private.nyu_pipeline_start_stage($1,$2,$3,$4) result",[cycle,stage,domain,mode]);
 return rows[0].result;
}
async function finish(cycle:string,stage:string,passed:boolean,data:unknown,error:string|null){
 const rows=await db.unsafe("select nyu_private.nyu_pipeline_finish_stage($1,$2,$3,$4::jsonb,$5) result",
  [cycle,stage,passed,JSON.stringify(data),error]);
 return rows[0].result;
}
async function sources(domain:string|null){
 return await db.unsafe("select distinct s.domain from public.nyu_sources s join public.nyu_source_endpoints e on e.source_id=s.id where e.acquisition_method='rss' and e.is_enabled=true and s.is_active=true and s.auto_fetch_allowed=true and s.rights_tier='green' and s.reuse_status='approved' and s.production_enabled=true and s.commercial_use_allowed=true and coalesce(s.takedown_status,'none')='none' and ($1::text is null or s.domain=$1) order by s.domain",[domain]) as Array<{domain:string}>;
}
async function fetchStage(token:string,domain:string|null){
 const choices=await sources(domain);
 if(!choices.length)throw Error('no_eligible_rss_sources');
 const output:Array<{domain:string;ok:boolean;inserted:number;updated:number;error?:string}>=[];
 for(let i=0;i<choices.length;i+=MAX_FETCH_CONCURRENT){
  const batch=choices.slice(i,i+MAX_FETCH_CONCURRENT);
  const results=await Promise.all(batch.map(async s=>{
   try{
    const n=s.domain==='4gamer.net'?100:45;
    const r=await call('nyu-fetch-rss',token,{domain:s.domain,maxItemsPerFeed:n},timeout);
    return {domain:s.domain,ok:r.ok===true,inserted:Number(r.inserted||0),updated:Number(r.updated||0),
      ...(r.ok===true?{}:{error:'feed_failed'})};
   }catch(e){return {domain:s.domain,ok:false,inserted:0,updated:0,error:String(e).slice(0,150)};}
  }));
  output.push(...results);
 }
 const successes=output.filter(r=>r.ok);
 if(!successes.length)throw Error('all_rss_sources_failed');
 return {eligible_sources:choices.length,successes:successes.length,failures:output.length-successes.length,
  fetched_inserted:output.reduce((n,x)=>n+x.inserted,0),fetched_updated:output.reduce((n,x)=>n+x.updated,0),
  result:output};
}
async function prefilterStage(token:string,domain:string|null){
 const result=await call('nyu-prefilter',token,{domain,only_new:true,limit:500,dry_run:false});
 if(!result.ok||!result.counts)throw Error('prefilter_response_invalid');
 return {processed:Number(result.processed||0),saved:Number(result.saved||0),counts:result.counts,
  version:result.version,remaining_possible:result.processed>=500};
}
async function routeStage(token:string,domain:string|null){
 const chunks:any[]=[];let processed=0,review=0,excluded=0,autoverified=0;
 for(let i=0;i<3;i++){
  const r=await call('nyu-factpack-auto',token,{mode:'route_queue',domain,limit:10});
  chunks.push({processed:r.processed,queue_added:r.queue_added,queue_skipped:r.queue_skipped,
    auto_verified:r.db_writes||0});
  processed+=Number(r.processed||0);
  review+=Number(r.queue_added||0);
  excluded+=Number(r.queue_skipped||0);
  autoverified+=Number(r.db_writes||0);
  if(Number(r.processed||0)<10)break;
 }
 return {processed,review,excluded,autoverified,chunks,more_candidates_possible:chunks.length===3&&chunks[2].processed===10};
}
async function mockStage(token:string,cycle:string,domain:string|null){
 const q=await db.unsafe("select count(*)::int as n from public.nyu_source_fact_packs f join public.nyu_source_items i on i.id=f.source_item_id join public.nyu_sources s on s.id=i.source_id where f.extraction_status='complete' and f.extra_facts->>'review_type' in ('human_verified_source','auto_source_verified_v1') and f.extra_facts->>'ready_for_scoring'='true' and s.is_active and s.production_enabled and s.rights_tier='green' and s.reuse_status='approved' and s.commercial_use_allowed=true and coalesce(s.takedown_status,'none')='none' and not exists(select 1 from public.nyu_evaluations e where e.source_item_id=i.id) and ($1::text is null or s.domain=$1)",[domain]);
 const count=Number(q[0]?.n||0);
 if(!count)return {mock_only:true,skipped:'no_approved_factpacks',processed:0,api_calls:0,publications_created:0};
 const limit=Math.min(2,count);
 try{
  const r=await call('nyu-ai-safety-runner',token,{mode:'approved',limit,
    idempotency_key:'pipeline:'+cycle,...(domain?{domain}:{})},35000);
  if(!r.ok)throw Error('safety_runner_denied');
  return {mock_only:true,processed:r.processed_items||0,accepted:r.accepted_items||0,
    run_id:r.run_id||null,estimated_cost_only:true,api_calls:0,publications_created:0};
 }catch(e){
  return {mock_only:true,skipped:'budget_or_safety_guard_denied',reason:String(e).slice(0,150),
    api_calls:0,publications_created:0};
 }
}
async function status(){
 const rows=await db.unsafe("select cycle_key,mode,stage,domain_filter,started_at,completed_at,fetch_result,prefilter_result,route_result,mock_result,last_error from nyu_private.nyu_pipeline_cycles order by started_at desc limit 6");
 const s=await db.unsafe("select (select count(*) from public.nyu_source_items where metadata->'zencho_prefilter'->>'decision' is null)::int as unprefiltered,(select count(*) from public.nyu_factpack_review_queue where decision='review' and status='pending')::int as human_review,(select count(*) from public.nyu_source_fact_packs where extraction_status='complete' and extra_facts->>'review_type' in ('human_verified_source','auto_source_verified_v1'))::int as verified_packs");
 return {ok:true,mode:'preview',version:VERSION,next_cycle:scheduledCycle(),cycles:rows,backlog:s[0],
  api_calls:0,publications_created:0};
}
Deno.serve(async req=>{
 if(req.method!=='POST')return okJson({ok:false,error:'POST_only'},405);
 let cycle:string|null=null,stage:string|null=null,acquired=false;
 try{
  if(!await authorized(req))return okJson({ok:false,error:'unauthorized'},401);
  const body=await req.json().catch(()=>({}));
  if(!body||typeof body!=='object'||Array.isArray(body))return okJson({ok:false,error:'invalid_body'},400);
  if(body.publish===true||body.live===true||body.provider==='openai'||body.write_articles===true)
   return okJson({ok:false,error:'paid_ai_and_publication_disabled'},409);
  if(body.mode==='preview')return okJson(await status());
  if(body.mode==='fixtures'){
   const [f,a]=await Promise.all([
    call('nyu-factpack-auto',req.headers.get('x-nyu-token')!,{mode:'fixtures'}),
    call('nyu-evaluator-mock',req.headers.get('x-nyu-token')!,{mode:'approval_gate_fixtures'})]);
   return okJson({ok:true,mode:'fixtures',version:VERSION,
    factpack_checks:f.checks,evaluation_checks:a.checks,api_calls:0,publications_created:0,
    scheduled_cycle:scheduledCycle(),stage_order:['fetch','prefilter','route','mock']});
  }
  if(body.mode!=='run'||!['fetch','prefilter','route','mock'].includes(body.stage))
   return okJson({ok:false,error:'invalid_mode_or_stage'},400);
  stage=body.stage;
  const domain=body.domain==null?null:body.domain;
  if(domain!==null&&(typeof domain!=='string'||!/^[a-z0-9.-]{3,180}$/.test(domain)))
   return okJson({ok:false,error:'invalid_domain'},400);
  const isManual=body.cycle_key!==undefined;
  if(isManual&&(typeof body.cycle_key!=='string'||!/^manual_[a-z0-9_-]{7,95}$/.test(body.cycle_key)))
   return okJson({ok:false,error:'invalid_manual_cycle_key'},400);
  cycle=isManual?body.cycle_key:scheduledCycle();
  const mode=isManual?'manual':'scheduled';
  const admitted=await start(cycle,stage,domain,mode);
  if(!admitted.ok)return okJson({ok:true,skipped:true,reason:admitted.reason,
   current_stage:admitted.stage,cycle_key:cycle,api_calls:0,publications_created:0});
  acquired=true;
  const token=req.headers.get('x-nyu-token')!;
  let result:unknown;
  if(stage==='fetch')result=await fetchStage(token,domain);
  else if(stage==='prefilter')result=await prefilterStage(token,domain);
  else if(stage==='route')result=await routeStage(token,domain);
  else result=await mockStage(token,cycle,domain);
  const completed=await finish(cycle,stage,true,result,null);
  acquired=false;
  return okJson({ok:true,cycle_key:cycle,mode,stage,cycle_stage:completed.stage,
   version:VERSION,result,api_calls:0,publications_created:0,no_paid_api:true});
 }catch(e){
  const error=e instanceof Error?e.message:String(e);
  if(acquired&&cycle&&stage){
   try{await finish(cycle,stage,false,{failed_stage:stage},error);}catch{}
  }
  console.error('nyu-pipeline',error);
  return okJson({ok:false,cycle_key:cycle,stage,error:error.slice(0,220),
   api_calls:0,publications_created:0},503);
 }
});
