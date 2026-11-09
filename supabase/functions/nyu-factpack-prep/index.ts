import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import postgres from 'npm:postgres@3.4.7';
const db=postgres(Deno.env.get('SUPABASE_DB_URL')!,{prepare:false,max:1,idle_timeout:5});
const VERSION='nyu-factpack-prep-v0.1';
const clean=(s:unknown,max=650)=>typeof s==='string'?s.replace(/\s+/g,' ').trim().slice(0,max):'';
async function digest(s:string){let d=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s));return Array.from(new Uint8Array(d)).map(x=>x.toString(16).padStart(2,'0')).join('');}
function validHost(url:string,domain:string){try{let u=new URL(url);return u.protocol==='https:'&&!u.username&&!u.password&&!u.port&&(u.hostname===domain||u.hostname.endsWith('.'+domain));}catch{return false;}}
function phase(t:string){if(/実証|試験運用/.test(t))return 'pilot';if(/成果|結果|効果を確認/.test(t))return 'result_reported';if(/開始した|実施した|導入した/.test(t))return 'started';if(/予定|計画|実施へ/.test(t))return 'planned';if(/採択|決定|公表|公開|発表|認定/.test(t))return 'announced';return 'unknown';}
function numbers(t:string){return [...t.matchAll(/\d+(?:\.\d+)?\s*(?:件|人|社|団体|%|％|年|億円|万円|施設)/g)].slice(0,8).map(m=>({literal:m[0],source_excerpt:t.slice(Math.max(0,(m.index||0)-25),Math.min(t.length,(m.index||0)+m[0].length+25))}));}
async function auth(req:Request){let tok=req.headers.get('x-nyu-token')||'';if(!tok)return false;let v=await db.unsafe("select decrypted_secret from vault.decrypted_secrets where name='nyu_fetch_token' limit 1");if(v.length!==1)return false;let a=new TextEncoder().encode(tok),b=new TextEncoder().encode(v[0].decrypted_secret);if(a.length!==b.length)return false;let diff=0;for(let i=0;i<a.length;i++)diff|=a[i]^b[i];return diff===0;}
function stripHtml(s:string){return clean(s.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,' ').replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi,' ').replace(/<[^>]+>/g,' ').replace(/&nbsp;/gi,' ').replace(/&amp;/gi,'&').replace(/&lt;/gi,'<').replace(/&gt;/gi,'>').replace(/&quot;/gi,'"'),650);}
async function fetchExcerpt(url:string,domain:string){
 if(!validHost(url,domain))return {quote:'',note:'host_not_allowed'};
 try{
  const r=await fetch(url,{redirect:'manual',signal:AbortSignal.timeout(10000),headers:{Accept:'text/html'}});
  if(!r.ok)return {quote:'',note:'http_'+r.status};
  if(!/text\/html|application\/xhtml\+xml/.test(r.headers.get('content-type')||''))return {quote:'',note:'not_html'};
  if(Number(r.headers.get('content-length')||0)>500000)return {quote:'',note:'oversized'};
  let reader=r.body?.getReader();if(!reader)return {quote:'',note:'no_body'};
  let parts:Uint8Array[]=[],total=0;
  while(true){let x=await reader.read();if(x.done)break;total+=x.value.length;if(total>500000){await reader.cancel();return {quote:'',note:'oversized'};}parts.push(x.value);}
  let bytes=new Uint8Array(total),pos=0;for(let x of parts){bytes.set(x,pos);pos+=x.length;}
  let head=new TextDecoder('ascii').decode(bytes.subarray(0,1500));
  let charset=head.match(/charset\s*=\s*["']?([a-z0-9_-]+)/i)?.[1]||r.headers.get('content-type')?.match(/charset\s*=\s*["']?([a-z0-9_-]+)/i)?.[1]||'utf-8';
  let h:string;try{h=new TextDecoder(charset,{fatal:true}).decode(bytes);}catch{return {quote:'',note:'bad_encoding'};}
  let main=h.match(/<article\b[^>]*>([\s\S]*?)<\/article>/i)?.[1]||h.match(/<main\b[^>]*>([\s\S]*?)<\/main>/i)?.[1]||'';
  let q=stripHtml(main);
  return {quote:q.length>=40&&!q.includes('�')?q:'',note:q.length>=40?'html_excerpt_unverified':'no_excerpt'};
 }catch{return {quote:'',note:'fetch_error_or_timeout'};}
}
type S={id:string;title:string;url:string;summary:string|null;published_at:string|null;domain:string;name:string;fact_id:string|null;fact_status:string|null;fact_summary:string|null;fact_hash:string|null;fact_extra:any;valid_source:boolean};
async function createDraft(s:S,fetchHtml:boolean){
 let quote=clean(s.summary,650).replace(/&#(x[0-9a-f]+|\d+);/gi,(_m,n)=>{const hex=n.charAt(0).toLowerCase()==='x';const v=parseInt(hex?n.slice(1):n,hex?16:10);return Number.isFinite(v)&&v>0&&v<=0x10ffff?String.fromCodePoint(v):' ';}).replace(/&amp;/gi,'&').replace(/&quot;/gi,'"').replace(/&lt;/gi,'<').replace(/&gt;/gi,'>'),kind='feed_summary',warnings:string[]=[];
 if(fetchHtml){let v=await fetchExcerpt(s.url,s.domain);warnings.push(v.note);if(v.quote){quote=v.quote;kind='html_excerpt';}}
 let evidence=quote.length>=40&&!quote.includes('�')&&validHost(s.url,s.domain);
 if(!evidence){quote='';kind='missing';warnings.push('source_excerpt_insufficient');}
 let step=phase(s.title);
 if(['announced','planned','pilot'].includes(step))warnings.push('outcome_not_demonstrated');
 if(!s.published_at)warnings.push('source_publication_date_missing');
 let pack={
  source_item_id:s.id,schema_version:'0.1',extraction_status:'needs_review',
  event_summary:quote||null,actors:[s.name],when_text:null,where_text:null,target_audience:[],
  key_numbers:numbers(quote),change_summary:null,implementation_stage:step,
  caveats:['出典文の自動抽出下書き。必ず元情報で事実確認すること。',...warnings],
  extra_facts:{review_type:'unverified_machine_draft',source_url:s.url,source_title:s.title,
   source_published_at:s.published_at,evidence_kind:kind,evidence_excerpt:quote,
   validation_warnings:warnings,ready_for_scoring:false,ready_for_publication:false},
  source_language:/^[\x00-\x7f]*$/.test(s.title+' '+quote)?'en':'ja',
  source_content_hash:evidence?await digest(quote):null,
  extraction_model:'deterministic-no-ai',prompt_version:VERSION
 };
 return {pack,validation:{source_eligible:s.valid_source,evidence_present:evidence,requires_human_review:true,
  schema_valid:true,ready_for_scoring:false,ready_for_publication:false,
  blockers:[...(!s.valid_source?['source_not_approved']:[]),...(!evidence?['missing_evidence']:[])],warnings}};
}
Deno.serve(async req=>{
 if(req.method!=='POST')return Response.json({ok:false,error:'POST only'},{status:405});
 try{
  if(!(await auth(req)))return Response.json({ok:false,error:'unauthorized'},{status:401});
  let body=await req.json().catch(()=>({}));let mode=body.mode||'preview';
  if(!['fixtures','preview','save_review','validate_existing'].includes(mode))return Response.json({ok:false,error:'invalid_mode'},{status:400});
  if(body.publish===true||body.complete===true||body.run_ai===true)return Response.json({ok:false,error:'live_actions_disabled'},{status:409});
  if(mode==='fixtures'){
   let x:S={id:'test-fixture',title:'新事業の実証を開始',url:'https://example.org/article',summary:'架空の実証を開始したとの発表である。実際の改善効果はまだ確認されていないため、成果が出たとはいえない。',published_at:'2026-11-10',domain:'example.org',name:'架空情報源',fact_id:null,fact_status:null,fact_summary:null,fact_hash:null,fact_extra:null,valid_source:true};
   return Response.json({ok:true,version:VERSION,mode,db_writes:0,api_calls:0,publications_created:0,results:[await createDraft(x,false)]});
  }
  let domain=typeof body.domain==='string'&&body.domain.length<=200?body.domain.trim().toLowerCase():null;
  let item=typeof body.source_item_id==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(body.source_item_id)?body.source_item_id:null;
  if(body.source_item_id&&!item)return Response.json({ok:false,error:'invalid_item_id'},{status:400});
  if(mode==='save_review'&&body.fetch_html===true)return Response.json({ok:false,error:'save_review_requires_feed_summary'},{status:409});
  let limit=Math.min(10,Math.max(1,Math.trunc(Number(body.limit)||3)));
  let rows=await db.unsafe("select i.id::text id,i.original_title title,i.source_url url,i.source_summary summary,i.source_published_at::text published_at,s.domain,s.name,f.id::text fact_id,f.extraction_status fact_status,f.event_summary fact_summary,f.source_content_hash fact_hash,f.extra_facts fact_extra,(s.rights_tier='green' and s.reuse_status='approved' and s.is_active and s.production_enabled and s.commercial_use_allowed=true) valid_source from public.nyu_source_items i join public.nyu_sources s on s.id=i.source_id left join public.nyu_source_fact_packs f on f.source_item_id=i.id where s.rights_tier='green' and s.is_active and s.reuse_status='approved' and ($1::text is null or s.domain=$1) and ($2::uuid is null or i.id=$2::uuid) and ($3::boolean or (s.production_enabled=true and s.commercial_use_allowed=true and i.metadata->'zencho_prefilter'->>'decision'='ai_candidate')) order by i.source_published_at desc nulls last,i.discovered_at desc limit $4",[domain,item,mode==='validate_existing',limit]) as S[];
  let writes=0,result:any[]=[];
  for(let row of rows){
   if(mode==='validate_existing'){
    result.push({id:row.id,status:row.fact_status||'missing',summary_present:!!clean(row.fact_summary),auto_verified:false,
     review_flags:[...(!row.fact_id?['factpack_missing']:[]),...(row.fact_status==='complete'&&!row.fact_hash?['legacy_hash_missing']:[]),
     ...(row.fact_status==='complete'&&!row.fact_extra?.review_type?['review_provenance_missing']:[])]});
    continue;
   }
   if(row.fact_id){result.push({id:row.id,status:'existing_preserved',existing_status:row.fact_status});continue;}
   let data=await createDraft(row,mode==='preview'&&body.fetch_html===true);
   let status='preview_only';
   if(mode==='save_review'){
    if(data.validation.evidence_present&&data.validation.source_eligible){
     let d=data.pack;
     let saved=await db.unsafe("insert into public.nyu_source_fact_packs (source_item_id,schema_version,extraction_status,event_summary,actors,when_text,where_text,target_audience,key_numbers,change_summary,implementation_stage,caveats,extra_facts,source_language,source_content_hash,extraction_model,prompt_version,extracted_at) values ($1::uuid,$2,'needs_review',$3,$4::jsonb,$5,$6,$7::jsonb,$8::jsonb,$9,$10,$11::jsonb,$12::jsonb,$13,$14,$15,$16,now()) on conflict(source_item_id) do nothing returning id",[row.id,d.schema_version,d.event_summary,db.json(d.actors),d.when_text,d.where_text,db.json(d.target_audience),db.json(d.key_numbers),d.change_summary,d.implementation_stage,db.json(d.caveats),db.json(d.extra_facts),d.source_language,d.source_content_hash,d.extraction_model,d.prompt_version]);
     if(saved.length){writes++;status='saved_needs_review';}else status='existing_preserved';
    }else status='blocked_missing_evidence';
   }
   result.push({id:row.id,title:row.title,status,...data});
  }
  return Response.json({ok:true,version:VERSION,mode,processed:rows.length,db_writes:writes,api_calls:0,publications_created:0,results:result,
   note:'Unverified drafts only. Does not score, set complete, or publish.'});
 }catch(err){console.error(err);return Response.json({ok:false,error:'factpack_prep_failed'},{status:500});}

});