import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import postgres from 'npm:postgres@3.4.7';
const db=postgres(Deno.env.get('SUPABASE_DB_URL')!,{prepare:false,max:1,idle_timeout:5});
const VERSION='nyu-factpack-auto-v0.3-extract';
const tidy=(s:string,max=1500)=>s.replace(/\s+/g,' ').trim().slice(0,max);
const future=/予定|検討|可能性|見込み|目指|期待|計画|予測|試験|実証|調査中|議論|審議|募集|公募|開催します/;
const outcome=/効果|改善|向上|削減|増加|達成|解消|成功|成果|世界初|最大|初めて/;
const risky=/事故|死亡|感染|損害|被害|災害|犯罪|暴力|汚染|訴訟/;
const action=/発表|公表|公開|掲載|策定|決定|採択|認定|施行|完了|開始/;
function host(url:string,domain:string){try{const u=new URL(url);return u.protocol==='https:'&&!u.port&&!u.username&&!u.password&&(u.hostname===domain||u.hostname.endsWith('.'+domain));}catch{return false;}}
function htmlText(v:string){
 const visible=v.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,' ')
 .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi,' ')
 .replace(/<nav\b[^>]*>[\s\S]*?<\/nav>/gi,' ')
 .replace(/<footer\b[^>]*>[\s\S]*?<\/footer>/gi,' ')
 .replace(/<[^>]+>/g,' ');
 return tidy(visible.replace(/&#(x[0-9a-f]+|[0-9]+);/gi,(_,n)=>{
  const code=n[0].toLowerCase()==='x'?parseInt(n.slice(1),16):parseInt(n,10);
  return code>=32&&code<=0x10ffff?String.fromCodePoint(code):' ';
 }).replace(/&nbsp;|&#160;/gi,' ').replace(/&amp;/gi,'&')
 .replace(/&lt;/gi,'<').replace(/&gt;/gi,'>').replace(/&quot;/gi,'"')
 .replace(/&apos;|&#39;/gi,"'"),26000);
}
function normalized(s:string){return tidy(s.normalize('NFKC').replace(/[\s\u3000]+/g,' ').replace(/[「」『』【】（）()［］、。，．,.！!？?：:・･]/g,' '),26000);}
function textMatchInfo(title:string,body:string){
 const key=normalized(title),data=normalized(body),index=data.indexOf(key);
 return {matched:index>=0,position:index,normalized_key:key,normalized_body:data};
}
function scopedHtml(html:string){
 const main=html.match(/<main\b[^>]*>([\s\S]*?)<\/main>/i)?.[1];
 if(main)return {main,kind:'official_main',note:'main_element'};
 const article=html.match(/<article\b[^>]*>([\s\S]*?)<\/article>/i)?.[1];
 if(article)return {main:article,kind:'official_main',note:'article_element'};
 const tag=html.match(/<(?:div|section)\b(?=[^>]*\bid\s*=\s*["']?(?:main|contents|mainContents|mainArea|main_content|main_contents|content)(?:["'\s>]))[^>]*>/i);
 if(!tag||tag.index==null)return {main:'',kind:'missing',note:'no_content_container'};
 const after=html.slice(tag.index+tag[0].length);
 const ending=after.search(/<(?:footer|nav)\b|<div\b[^>]*\bid\s*=\s*["']?(?:footer|foot)/i);
 const scoped=ending>=0?after.slice(0,ending):after.slice(0,100000);
 return {main:scoped,kind:'official_main',note:'named_content_container'};
}
function dateKeys(value:string|null){if(!value)return [];const d=new Date(value);if(Number.isNaN(d.getTime()))return [];const parts=new Intl.DateTimeFormat('en-US',{timeZone:'Asia/Tokyo',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(d);const n=(k:string)=>parts.find(x=>x.type===k)?.value||'';const y=n('year'),m=n('month'),day=n('day');const western=y+'年'+Number(m)+'月'+Number(day)+'日';const yr=Number(y);const era=yr>=2019?'令和'+(yr-2018)+'年'+Number(m)+'月'+Number(day)+'日':null;return [western,y+'/'+m+'/'+day,y+'-'+m+'-'+day,...(era?[era]:[])];}
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
 if(!textMatchInfo(title,text).matched)problems.push('headline_not_in_official_body_after_normalization');
 if(!dateKeys(s.published_at).some(x=>normalized(text).includes(normalized(x))))problems.push('publication_date_unconfirmed');
 if(text.includes('�'))problems.push('invalid_text');
 const mm=textMatchInfo(title,text);
 // Preserve the literal source words and punctuation; normalized text is only for matching.
 const excerpt=mm.matched?tidy(text.slice(0,900),900):'';
 if(excerpt.length<80||!textMatchInfo(title,excerpt).matched||!dateKeys(s.published_at).some(x=>normalized(excerpt).includes(normalized(x))))problems.push('insufficient_evidence_excerpt');
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
  const scoped=scopedHtml(html);
  if(!scoped.main)return {kind:'missing',text:'',note:scoped.note};
  return {kind:scoped.kind,text:htmlText(scoped.main),note:scoped.note};
 }catch{return {kind:'missing',text:'',note:'fetch_error'};}
}

const routine=/配信決定|配信開始|アーケードアーカイブス|DLC|アップデート|動画を掲載|ダッシュボードを更新|ページを更新|開催します|検討会|審議します|会議|イベント募集|募集開始|プレゼントキャンペーン/i;
const possibleValue=/福祉|医療|健康|支援|環境|防災|復興|農|食|保全|保護|研究|教育|表彰|認定|選定|採択|改善|省エネ|自然|資源|生物多様性|技術開発|補助金/i;
const followupValue=/国民向け行政サービスロードマップ|サービスを開始した事業者及び事例一覧|導入事例を追加|新たに導入|実用化|サービスを開始|制度を開始|社会実装/i;
const routineEvenWithValue=/解説動画を掲載|取組項目と概要を更新|審議します|検討会を開催します|ダッシュボードを更新|式典|表敬訪問/i;
const meaningfulPolicy=/施行|閣議決定|法律の改正|政令.*改正|公営住宅|ひとり親控除|オンライン申請|支援制度.*開始|補助金.*決定|給付.*開始|住宅.*制度|無償化|サービス.*導入|新たな制度/i;
const adminNotice=/出張|交代式|記者会見|大臣.*会談|リコール|人事|受賞式|叙勲|イベント|シンポジウム|フェア.*開催|委員会.*開催|研究会.*開催|公聴会.*予定|情報.*掲載しました|解説動画|ダッシュボード.*更新/i;
function route(s:Item, reasons:string[]) {
 if(s.existing_id||s.already_evaluated||s.already_published)return {decision:'skip',reasons:['existing_record']};
 if(!s.eligible||!['ai_candidate','manual_review'].includes(s.prefilter||''))return {decision:'skip',reasons:['not_eligible_or_not_candidate']};
 if(s.prefilter==='manual_review') {
  if(adminNotice.test(s.title)&&!meaningfulPolicy.test(s.title))return {decision:'skip',reasons:['manual_prefilter_routine_notice']};
  if(meaningfulPolicy.test(s.title))return {decision:'review',reasons:['manual_prefilter_policy_change_needs_evidence',...reasons]};
  return {decision:'skip',reasons:['manual_prefilter_without_concrete_change']};
 }
 // Avoid false positives from topic-only cues (e.g. disaster, environment, support) when the event is a routine announcement.
 if(routineEvenWithValue.test(s.title))return {decision:'skip',reasons:['routine_without_new_outcome']};
 // Potentially substantive programme details or evidence of a newly adopted service merit a human look,
 // but never constitute an automatic "positive-news" judgement.
 if(followupValue.test(s.title))return {decision:'review',reasons:['substantive_update_needs_evidence',...reasons]};
 if(routine.test(s.title))return {decision:'skip',reasons:['routine_or_offtopic']};
 if(!possibleValue.test(s.title))return {decision:'skip',reasons:['no_editorial_value_signal']};
 return {decision:'review',reasons:['topic_value_needs_evidence',...reasons]};
}
async function auth(req:Request){const tok=req.headers.get('x-nyu-token')||'';if(!tok)return false;const v=await db.unsafe("select decrypted_secret from vault.decrypted_secrets where name='nyu_fetch_token' limit 1");if(v.length!==1)return false;const a=new TextEncoder().encode(tok),b=new TextEncoder().encode(v[0].decrypted_secret);if(a.length!==b.length)return false;let diff=0;for(let i=0;i<a.length;i++)diff|=a[i]^b[i];return diff===0;}
Deno.serve(async req=>{
 if(req.method!=='POST')return Response.json({ok:false,error:'POST_only'},{status:405});
 try{
  if(!await auth(req))return Response.json({ok:false,error:'unauthorized'},{status:401});
  const args=await req.json().catch(()=>({})),mode=args.mode||'preview';
  if(!['fixtures','preview','auto_save','route_queue'].includes(mode))return Response.json({ok:false,error:'invalid_mode'},{status:400});
  if(args.publish||args.live||args.provider==='openai')return Response.json({ok:false,error:'live_actions_disabled'},{status:409});
  if(mode==='fixtures'){
   const item:Item={id:'fixture',title:'令和8年度の行政手続に関する詳細な報告書を公開しました',url:'https://example.invalid/news',domain:'example.invalid',name:'架空省庁',source_type:'government',published_at:'2026-11-10T00:00:00Z',eligible:true,prefilter:'ai_candidate',existing_id:null,already_evaluated:false,already_published:false};
   const body='令和8年度の行政手続に関する詳細な報告書を公開しました。2026年11月10日。令和8年度の行政手続に関する詳細な報告書を公開しました。これは架空の文書公開の検証データです。実在する省庁の発表ではありません。文書の公開を想定した技術的なテストであり、取り組みの実際の成果を保証するものではありません。公開した資料は行政手続の記録を取りまとめた架空の文書です。本試験では記事から確認できる公表行為だけを抽出するのであり、資料に記載された行政サービスの実績が正しいという判断は含みません。';
   const a=check(item,body,'official_main'),b=check({...item,title:'来年度の改善成果を目指す計画を発表しました'},body,'official_main'),c=check(item,body,'feed_summary'),d=check({...item,existing_id:'exists'},body,'official_main');
   return Response.json({ok:true,mode,version:VERSION,checks:{strict_html:a.ok,ambiguous_blocked:!b.ok,rss_blocked:!c.ok,existing_blocked:!d.ok,substantive_roadmap_to_review:route({...item,title:'国民向け行政サービスロードマップの最新版を公表しました'},['missing_body']).decision==='review',new_adoption_case_to_review:route({...item,title:'サービスを開始した事業者及び事例一覧を更新しました'},['missing_body']).decision==='review',explainer_video_to_skip:route({...item,title:'AIの解説動画を掲載しました'},['missing_body']).decision==='skip',routine_meeting_to_skip:route({...item,title:'環境問題に関する検討会を開催します'},['missing_body']).decision==='skip',routine_game_release_to_skip:route({...item,title:'アーケードアーカイブス新作ゲーム配信決定'},['missing_body']).decision==='skip',inactive_source_to_skip:route({...item,eligible:false,title:'防災庁誕生'},['missing_body']).decision==='skip',manual_policy_to_review:route({...item,prefilter:'manual_review',title:'公営住宅のひとり親控除について政令を閣議決定'},['prefilter_manual']).decision==='review',manual_routine_to_skip:route({...item,prefilter:'manual_review',title:'国土交通省職員の出張について'},['prefilter_manual']).decision==='skip',normalized_title_punctuation:check({...item,title:'令和８年度の行政手続に関する詳細な報告書を公開しました'},body,'official_main').ok,wrong_title_blocked:!check({...item,title:'令和8年度の実施成果を確定しました'},body,'official_main').ok,missing_date_blocked:!check({...item,published_at:'2026-12-12T00:00:00Z'},body,'official_main').ok,unscoped_shell_blocked:!check(item,body,'missing').ok,main_fallback_detected:scopedHtml('<html><div id="contents"><h1>政府発表</h1><p>本文</p></div></html>').note==='named_content_container',missing_scoped_container_blocked:scopedHtml('<html><nav>政府発表</nav><p>本文</p></html>').kind==='missing',japanese_era_date_matched:dateKeys('2026-10-27T07:00:00Z').some(x=>normalized('令和８年10月27日').includes(normalized(x))),wrong_era_date_blocked:!dateKeys('2026-10-27T07:00:00Z').some(x=>normalized('令和８年10月28日').includes(normalized(x))),excerpt_verbatim_punctuation:check(item,body,'official_main').excerpt.includes('。'),false_date_outside_excerpt_blocked:!check(item,body.replace('2026年11月10日','')+' 補足説明 '.repeat(230)+' 2026年11月10日','official_main').ok},fixture_blockers:a.reasons,api_calls:0,db_writes:0,publications_created:0});
  }
  const domain=typeof args.domain==='string'&&args.domain.length<=200?args.domain:null;
  const itemId=typeof args.source_item_id==='string'&&/^[0-9a-f]{8}-[0-9a-f-]{27,}$/.test(args.source_item_id)?args.source_item_id:null;
  if(args.source_item_id&&!itemId)return Response.json({ok:false,error:'invalid_item_id'},{status:400});
  const limit=Math.max(1,Math.min(mode==='route_queue'?10:5,Number.isInteger(args.limit)?args.limit:2));
  const rows=await db.unsafe("select i.id::text id,i.original_title title,i.source_url url,s.domain,s.name,s.source_type,i.source_published_at::text published_at,(s.is_active and s.rights_tier='green' and s.production_enabled and s.commercial_use_allowed=true and s.reuse_status='approved' and coalesce(s.takedown_status,'none')='none') eligible,i.metadata->'zencho_prefilter'->>'decision' prefilter,f.id::text existing_id,exists(select 1 from public.nyu_evaluations e where e.source_item_id=i.id) already_evaluated,exists(select 1 from public.nyu_article_sources a where a.source_item_id=i.id) already_published from public.nyu_source_items i join public.nyu_sources s on s.id=i.source_id left join public.nyu_source_fact_packs f on f.source_item_id=i.id where s.rights_tier='green' and s.is_active and s.reuse_status='approved' and ($1::text is null or s.domain=$1) and ($2::uuid is null or i.id=$2::uuid) and i.metadata->'zencho_prefilter'->>'decision' in ('ai_candidate','manual_review') and ($4::boolean=false or (f.id is null and not exists(select 1 from public.nyu_factpack_review_queue q where q.source_item_id=i.id) and not exists(select 1 from public.nyu_evaluations ev where ev.source_item_id=i.id) and not exists(select 1 from public.nyu_article_sources ar where ar.source_item_id=i.id))) order by case when i.metadata->'zencho_prefilter'->>'decision'='ai_candidate' then 0 else 1 end, i.source_published_at desc nulls last,i.discovered_at desc limit $3",[domain,itemId,limit,mode==='route_queue']) as Item[];
  let saved=0;const results:any[]=[];
  for(const s of rows){
   if(s.existing_id){results.push({source_item_id:s.id,status:'existing_preserved'});continue;}
   const officialSource=s.prefilter==='ai_candidate'&&s.eligible&&['government','public'].includes(s.source_type);
   const fetched=officialSource?await fetchBody(s):{kind:'missing',text:'',note:s.prefilter==='manual_review'?'prefilter_manual_review_no_source_fetch':'not_official_source'};
   const r=s.prefilter==='manual_review'?{ok:false,reasons:['prefilter_manual_review'],excerpt:'',title:tidy(s.title,250)}:check(s,fetched.text,fetched.kind);
   let status=r.ok?'auto_eligible_preview':'needs_review';
   let routed:null|'review'|'skip'=null;
   if(mode==='route_queue'&&!r.ok){
    const classification=route(s,r.reasons);
    routed=classification.decision as 'review'|'skip';
    const stored=await db.unsafe("insert into public.nyu_factpack_review_queue (source_item_id,decision,status,reason_codes,source_note,evidence_preview,routing_version) values ($1::uuid,$2,'pending',$3::jsonb,$4,$5,'nyu-review-router-v0.1') on conflict (source_item_id) do nothing returning source_item_id",[s.id,routed,db.json(classification.reasons),fetched.note,tidy(r.excerpt,300)]);
    status=stored.length?(routed==='review'?'queued_for_human':'excluded_from_human_queue'):'previous_routing_preserved';
   }
   if((mode==='auto_save'||mode==='route_queue')&&r.ok){
    const extra={review_type:'auto_source_verified_v1',verification_method:'exact_official_html_extract_v1',verified_at:new Date().toISOString(),verified_source_url:s.url,evidence_kind:'official_html_main',evidence_excerpt:r.excerpt,ready_for_scoring:true,ready_for_publication:false,source_date:s.published_at,auto_gate_version:VERSION};
    const caveats=['出典元で確認できる発表・公開の事実のみ。実際の効果・成果や独立した真偽の保証ではありません。'];
    const n=await db.unsafe("insert into public.nyu_source_fact_packs(source_item_id,schema_version,extraction_status,event_summary,actors,when_text,where_text,target_audience,key_numbers,change_summary,implementation_stage,caveats,extra_facts,source_language,source_content_hash,extraction_model,prompt_version,extracted_at) values($1::uuid,'auto-0.1','complete',$2,$3::jsonb,$4,$5,$6::jsonb,$7::jsonb,$8,$9,$10::jsonb,$11::jsonb,$12,$13,$14,$15,now()) on conflict(source_item_id) do nothing returning id",[s.id,r.title,db.json([s.name]),null,null,db.json([]),db.json([]),r.title,'announced',db.json(caveats),db.json(extra),/[^\x00-\x7f]/.test(r.title)?'ja':'en',await digest(r.excerpt),'deterministic-source-extract',VERSION]);
    if(n.length){saved++;status='auto_completed';}else status='existing_preserved';
   }
   results.push({source_item_id:s.id,status,route_decision:routed,auto_eligible:r.ok,reasons:r.reasons,fetch_note:fetched.note,evidence_preview:r.ok?r.excerpt.slice(0,220):undefined});
  }
  return Response.json({ok:true,mode,version:VERSION,processed:rows.length,auto_eligible:results.filter(x=>x.auto_eligible).length,db_writes:saved,queue_added:results.filter(x=>x.status==='queued_for_human').length,queue_skipped:results.filter(x=>x.status==='excluded_from_human_queue').length,api_calls:0,publications_created:0,results});
 }catch(e){console.error(e);return Response.json({ok:false,error:'auto_factpack_failed'},{status:500});}
});