import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import postgres from 'npm:postgres@3.4.7';
const db=postgres(Deno.env.get('SUPABASE_DB_URL')!,{prepare:false,max:1,idle_timeout:5});
const VERSION='nyu-factpack-auto-v0.1';
const tidy=(s:string,max=1500)=>s.replace(/\s+/g,' ').trim().slice(0,max);
const future=/予定|検討|可能性|見込み|目指|期待|計画|予測|試験|実証|調査中|議論|審議|募集|公募|開催します/;
const outcome=/効果|改善|向上|削減|増加|達成|解消|成功|成果|世界初|最大|初めて/;
const risky=/事故|死亡|感染|損害|被害|災害|犯罪|暴力|汚染|訴訟/;
const action=/発表|公表|公開|掲載|策定|決定|採択|認定|施行|完了|開始/;
function host(url:string,domain:string){try{const u=new URL(url);return u.protocol==='https:'&&!u.port&&!u.username&&!u.password&&(u.hostname===domain||u.hostname.endsWith('.'+domain));}catch{return false;}}
function htmlText(v:string){return tidy(v.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,' ').replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi,' ').replace(/<[^>]+>/g,' ').replace(/&nbsp;/gi,' ').replace(/&amp;/gi,'&').replace(/&lt;/gi,'<').replace(/&gt;/gi,'>').replace(/&quot;/gi,'"'),26000);}
function dateKeys(value:string|null){if(!value)return [];const d=new Date(value);if(Number.isNaN(d.getTime()))return [];const parts=new Intl.DateTimeFormat('en-US',{timeZone:'Asia/Tokyo',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(d);const n=(k:string)=>parts.find(x=>x.type===k)?.value||'';const y=n('year'),m=n('month'),day=n('day');return [y+'年'+Number(m)+'月'+Number(day)+'日',y+'/'+m+'/'+day,y+'-'+m+'-'+day];}
async function digest(s:string){const h=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s));return [...new Uint8Array(h)].map(v=>v.toString(16).padStart(2,'0')).join('');}
type Item={id:string;title:string;url:string;domain:string;name:string;source_type:string;published_at:string|null;eligible:boolean;prefilter:string|null;existing_id:string|null;already_evaluated:boolean;already_published:boolean};
function check(s:Item,body:string,kind:string){
 const problems:string[]=[];
 if(!s.eligible||!['government','public'].includes(s.source_type))problems.push('source_not_eligible');
 if(s.prefilter!=='ai_candidate')problems.push('not_candidate');
 if(s.existing_id||s.already_evaluated||s.already_published)problems.push('existing_record');
 if(!host(s.url,s.domain))problems.push('source_url_not_https_allowlisted');
 if(kind!=='official_main')problems.push('official_body_unavailable');
 const title=tidy(s.title,250),text=tidy(body,26000);
 if(title.length<24||title.length>180||text.length<190||text.length>26000)problems.push('length_outside_limits');
 if(!action.test(title)||future.test(title)||outcome.test(title)||risky.test(title))problems.push('ambiguous_or_nonextractive_claim');
 if(!text.includes(title))problems.push('headline_not_exactly_in_official_body');
 if(!dateKeys(s.published_at).some(x=>text.includes(x)))problems.push('publication_date_unconfirmed');
 if(text.includes('�'))problems.push('invalid_text');
 const ix=text.indexOf(title),excerpt=ix>=0?tidy(text.slice(ix,ix+900),900):'';
 if(excerpt.length<80)problems.push('insufficient_evidence_excerpt');
 return {ok:problems.length===0,reasons:problems,excerpt,title};
}
async function fetchBody(s:Item){
 if(!host(s.url,s.domain))return {kind:'missing',text:'',note:'url_not_allowed'};
 try{
  const res=await fetch(s.url,{redirect:'manual',signal:AbortSignal.timeout(10000),headers:{Accept:'text/html'}});
  if(!res.ok)return {kind:'missing',text:'',note:'http_'+res.status};
  if(!/text\/html|application\/xhtml\+xml/.test(res.headers.get('content-type')||''))return {kind:'missing',text:'',note:'not_html'};
  if(Number(res.headers.get('content-length')||0)>600000)return {kind:'missing',text:'',note:'oversized'};
  const reader=res.body?.getReader();if(!reader)return {kind:'missing',text:'',note:'no_body'};
  let chunks:Uint8Array[]=[],len=0;
  while(true){let x=await reader.read();if(x.done)break;len+=x.value.length;if(len>600000){await reader.cancel();return {kind:'missing',text:'',note:'oversized'};}chunks.push(x.value);}
  let bytes=new Uint8Array(len),at=0;for(const x of chunks){bytes.set(x,at);at+=x.length;}
  const head=new TextDecoder('ascii').decode(bytes.subarray(0,1500));
  const charset=head.match(/charset\s*=\s*["']?([a-z0-9_-]+)/i)?.[1]||res.headers.get('content-type')?.match(/charset\s*=\s*["']?([a-z0-9_-]+)/i)?.[1]||'utf-8';
  let html:string;try{html=new TextDecoder(charset,{fatal:true}).decode(bytes);}catch{return {kind:'missing',text:'',note:'encoding_error'};}
  const main=html.match(/<main\b[^>]*>([\s\S]*?)<\/main>/i)?.[1]||html.match(/<article\b[^>]*>([\s\S]*?)<\/article>/i)?.[1];
  if(!main)return {kind:'missing',text:'',note:'no_main'};
  return {kind:'official_main',text:htmlText(main),note:'original_html_extracted'};
 }catch{return {kind:'missing',text:'',note:'fetch_error'};}
}
async function auth(req:Request){const tok=req.headers.get('x-nyu-token')||'';if(!tok)return false;const v=await db.unsafe("select decrypted_secret from vault.decrypted_secrets where name='nyu_fetch_token' limit 1");if(v.length!==1)return false;const a=new TextEncoder().encode(tok),b=new TextEncoder().encode(v[0].decrypted_secret);if(a.length!==b.length)return false;let diff=0;for(let i=0;i<a.length;i++)diff|=a[i]^b[i];return diff===0;}
Deno.serve(async req=>{
 if(req.method!=='POST')return Response.json({ok:false,error:'POST_only'},{status:405});
 try{
  if(!await auth(req))return Response.json({ok:false,error:'unauthorized'},{status:401});
  const args=await req.json().catch(()=>({})),mode=args.mode||'preview';
  if(!['fixtures','preview','auto_save'].includes(mode))return Response.json({ok:false,error:'invalid_mode'},{status:400});
  if(args.publish||args.live||args.provider==='openai')return Response.json({ok:false,error:'live_actions_disabled'},{status:409});
  if(mode==='fixtures'){
   const item:Item={id:'fixture',title:'令和8年度の行政手続に関する詳細な報告書を公開しました',url:'https://example.invalid/news',domain:'example.invalid',name:'架空省庁',source_type:'government',published_at:'2026-11-10T00:00:00Z',eligible:true,prefilter:'ai_candidate',existing_id:null,already_evaluated:false,already_published:false};
   const body='令和8年度の行政手続に関する詳細な報告書を公開しました。2026年11月10日。令和8年度の行政手続に関する詳細な報告書を公開しました。これは架空の文書公開の検証データです。実在する省庁の発表ではありません。文書の公開を想定した技術的なテストであり、取り組みの実際の成果を保証するものではありません。公開した資料は行政手続の記録を取りまとめた架空の文書です。本試験では記事から確認できる公表行為だけを抽出するのであり、資料に記載された行政サービスの実績が正しいという判断は含みません。';
   const a=check(item,body,'official_main'),b=check({...item,title:'来年度の改善成果を目指す計画を発表しました'},body,'official_main'),c=check(item,body,'feed_summary'),d=check({...item,existing_id:'exists'},body,'official_main');
   return Response.json({ok:true,mode,version:VERSION,checks:{strict_html:a.ok,ambiguous_blocked:!b.ok,rss_blocked:!c.ok,existing_blocked:!d.ok},fixture_blockers:a.reasons,api_calls:0,db_writes:0,publications_created:0});
  }
  const domain=typeof args.domain==='string'&&args.domain.length<=200?args.domain:null;
  const itemId=typeof args.source_item_id==='string'&&/^[0-9a-f]{8}-[0-9a-f-]{27,}$/.test(args.source_item_id)?args.source_item_id:null;
  if(args.source_item_id&&!itemId)return Response.json({ok:false,error:'invalid_item_id'},{status:400});
  const limit=Math.max(1,Math.min(5,Number.isInteger(args.limit)?args.limit:2));
  const rows=await db.unsafe("select i.id::text id,i.original_title title,i.source_url url,s.domain,s.name,s.source_type,i.source_published_at::text published_at,(s.is_active and s.rights_tier='green' and s.production_enabled and s.commercial_use_allowed=true and s.reuse_status='approved' and coalesce(s.takedown_status,'none')='none') eligible,i.metadata->'zencho_prefilter'->>'decision' prefilter,f.id::text existing_id,exists(select 1 from public.nyu_evaluations e where e.source_item_id=i.id) already_evaluated,exists(select 1 from public.nyu_article_sources a where a.source_item_id=i.id) already_published from public.nyu_source_items i join public.nyu_sources s on s.id=i.source_id left join public.nyu_source_fact_packs f on f.source_item_id=i.id where s.rights_tier='green' and s.is_active and s.reuse_status='approved' and ($1::text is null or s.domain=$1) and ($2::uuid is null or i.id=$2::uuid) and i.metadata->'zencho_prefilter'->>'decision'='ai_candidate' order by i.source_published_at desc nulls last,i.discovered_at desc limit $3",[domain,itemId,limit]) as Item[];
  let saved=0;const results:any[]=[];
  for(const s of rows){
   if(s.existing_id){results.push({source_item_id:s.id,status:'existing_preserved'});continue;}
   if(!s.eligible||!['government','public'].includes(s.source_type)){results.push({source_item_id:s.id,status:'needs_review',reasons:['not_eligible_source']});continue;}
   const fetched=await fetchBody(s),r=check(s,fetched.text,fetched.kind);
   let status=r.ok?'auto_eligible_preview':'needs_review';
   if(mode==='auto_save'&&r.ok){
    const extra={review_type:'auto_source_verified_v1',verification_method:'exact_official_html_extract_v1',verified_at:new Date().toISOString(),verified_source_url:s.url,evidence_kind:'official_html_main',evidence_excerpt:r.excerpt,ready_for_scoring:true,ready_for_publication:false,source_date:s.published_at,auto_gate_version:VERSION};
    const caveats=['出典元で確認できる発表・公開の事実のみ。実際の効果・成果や独立した真偽の保証ではありません。'];
    const n=await db.unsafe("insert into public.nyu_source_fact_packs(source_item_id,schema_version,extraction_status,event_summary,actors,when_text,where_text,target_audience,key_numbers,change_summary,implementation_stage,caveats,extra_facts,source_language,source_content_hash,extraction_model,prompt_version,extracted_at) values($1::uuid,'auto-0.1','complete',$2,$3::jsonb,$4,$5,$6::jsonb,$7::jsonb,$8,$9,$10::jsonb,$11::jsonb,$12,$13,$14,$15,now()) on conflict(source_item_id) do nothing returning id",[s.id,r.title,JSON.stringify([s.name]),null,null,JSON.stringify([]),JSON.stringify([]),r.title,'announced',JSON.stringify(caveats),JSON.stringify(extra),/[^\x00-\x7f]/.test(r.title)?'ja':'en',await digest(r.excerpt),'deterministic-source-extract',VERSION]);
    if(n.length){saved++;status='auto_completed';}else status='existing_preserved';
   }
   results.push({source_item_id:s.id,status,auto_eligible:r.ok,reasons:r.reasons,fetch_note:fetched.note,evidence_preview:r.ok?r.excerpt.slice(0,220):undefined});
  }
  return Response.json({ok:true,mode,version:VERSION,processed:rows.length,auto_eligible:results.filter(x=>x.auto_eligible).length,db_writes:saved,api_calls:0,publications_created:0,results});
 }catch(e){console.error(e);return Response.json({ok:false,error:'auto_factpack_failed'},{status:500});}
});