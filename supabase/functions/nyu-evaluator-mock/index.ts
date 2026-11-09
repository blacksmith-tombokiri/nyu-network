import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import postgres from 'npm:postgres@3.4.7';

const sql = postgres(Deno.env.get('SUPABASE_DB_URL')!, { prepare: false, max: 1, idle_timeout: 5 });
const VERSION = 'nyu-evaluator-mock-v0.1';
const BRANDS = new Set(['zencho']);
const CATEGORIES = new Set(['good','forward','nature','repair','food','mind']);
type Source = {
  id: string; title: string; source_url: string; source_name: string; domain: string;
  summary: string|null; published_at: string|null; prefilter: string|null;
  fact_summary: string|null; fact_status: string|null; fact_pack_id: string|null;
  category_hint: string|null;
};
type MockScore = { score_common: number; score_category: number; score_total: number; gate_result:'pass'|'review'|'fail'; category_code:string; title:string; summary:string; comment:string; reason:string; score_breakdown:Record<string,unknown> };

const normalize = (s: unknown, max = 4000) => typeof s === 'string' ? s.trim().slice(0,max) : '';
function categoryHint(title:string):string {
  if (/食|農|給食|栄養|食品|漁業/.test(title)) return 'food';
  if (/環境|脱炭素|気候|自然|再生材|生態|廃棄/.test(title)) return 'nature';
  if (/復興|修復|補修|復元|保存|アーカイブ/.test(title)) return 'repair';
  if (/医療|健康|福祉|教育|支援|寄付/.test(title)) return 'good';
  return 'forward';
}
function route(s:MockScore, evidenceReady:boolean) {
  const meetsScore = s.score_total>=80 && s.gate_result==='pass';
  const validParts = Number.isInteger(s.score_common) && s.score_common>=0 && s.score_common<=60 &&
    Number.isInteger(s.score_category) && s.score_category>=0 && s.score_category<=40 &&
    s.score_total===s.score_common+s.score_category && CATEGORIES.has(s.category_code);
  const hasEditorial = Boolean(s.title.trim() && s.summary.trim() && s.comment.trim() && s.reason.trim());
  const wouldPublish = validParts && meetsScore && hasEditorial && evidenceReady;
  return {
    verdict: !validParts?'invalid_mock_score':!evidenceReady?'blocked_missing_verified_fact_pack':
      !hasEditorial?'blocked_missing_editorial':wouldPublish?'would_publish':'would_hold',
    simulated_80_plus: meetsScore,
    schema_valid: validParts && hasEditorial,
    verified_fact_pack_present: evidenceReady,
    would_publish_if_real_ai_and_verified: wouldPublish,
    actually_published: false,
    live_publication_enabled: false
  };
}
function mockEvaluate(source:Source, fixtureScore?:number):MockScore {
  const evidence = normalize(source.fact_summary||source.summary);
  // Synthetic test score only. No editorial value or accuracy is inferred from this score.
  const score = fixtureScore ?? (source.fact_summary ? 85 : evidence.length>=80 ? 75 : 40);
  const common = score>=80?50:score>=70?45:25;
  const cat = score-common;
  return {
    score_common:common,score_category:cat,score_total:score,
    gate_result:score>=80?'pass':score>=70?'review':'fail',
    category_code:CATEGORIES.has(source.category_hint||'')?source.category_hint!:categoryHint(source.title),
    title:source.title,
    summary:evidence,
    comment:'［模擬評価］AI評価未実施。掲載禁止。',
    reason:'［テスト専用］固定ルールで模擬点を設定。事実確認・善兆評価を行ったものではありません。',
    score_breakdown:{simulation_only:true,fixture_score:fixtureScore??null,version:VERSION}
  };
}
function output(source:Source, fixtureScore?:number, fixture=false) {
  const score=mockEvaluate(source,fixtureScore);
  const evidenceReady=fixture===true; // Only approvedOutput or explicitly synthetic fixtures can preview publication eligibility.
  return {
    source_item_id:source.id,
    source:{name:source.source_name,domain:source.domain,title:source.title,url:source.source_url,published_at:source.published_at},
    input:{brand_slug:'zencho',prefilter:source.prefilter,source_summary_present:Boolean(source.summary),
      fact_pack_id:source.fact_pack_id,fact_pack_complete:evidenceReady},
    mock_evaluation:score,
    publication_preview:route(score,evidenceReady),
    warning:'SIMULATION ONLY. Scores are not AI-generated; no live database writes or publications.'
  };
}
function fixtures():Source[] {
  return [
    {id:'fixture-pass-85',title:'【架空テスト】改善施策の成果を確認',source_url:'',source_name:'架空テスト情報源',domain:'example.invalid',summary:'改善施策の成果について、検証済みの記録が存在するという仮定のテストデータです。',published_at:null,prefilter:'ai_candidate',fact_summary:'検証済みの成果を想定したテスト用の架空事実情報。実在記事ではありません。',fact_status:'complete',fact_pack_id:'fixture',category_hint:'forward'},
    {id:'fixture-review-75',title:'【架空テスト】事業の実証を開始',source_url:'',source_name:'架空テスト情報源',domain:'example.invalid',summary:'実証開始のみが確認され、効果は未確定という架空のテスト記事です。',published_at:null,prefilter:'ai_candidate',fact_summary:'検証段階で効果が未確定という架空の事実情報。',fact_status:'complete',fact_pack_id:'fixture',category_hint:'forward'},
    {id:'fixture-fail-40',title:'【架空テスト】会議の開催を告知',source_url:'',source_name:'架空テスト情報源',domain:'example.invalid',summary:'会議開催の予定を発表したという架空テストデータです。',published_at:null,prefilter:'manual_review',fact_summary:'会議開催のみの告知という架空の事実情報。',fact_status:'complete',fact_pack_id:'fixture',category_hint:'forward'}
  ];
}
  const required=(s:ApprovedRow):string[]=>{
    const reasons:string[]=[];
    if(s.fact_status!=='complete')reasons.push('factpack_not_complete');
    if(s.review_type!=='human_verified_source'||s.ready_for_scoring!==true)reasons.push('not_human_approved');
    if(!s.reviewer_active||!s.reviewed_by||!s.reviewed_at||!normalize(s.review_note))reasons.push('reviewer_or_audit_missing');
    if(s.reviewed_source_url!==s.source_url)reasons.push('source_url_changed');
    if(!s.source_hash||! /^[0-9a-f]{64}$/.test(s.source_hash))reasons.push('evidence_hash_missing');
    if(!normalize(s.evidence_excerpt,800)||normalize(s.evidence_excerpt,800).length<40)reasons.push('evidence_excerpt_missing');
    if(s.evidence_kind==='missing'||!s.evidence_kind)reasons.push('evidence_kind_missing');
    if(!normalize(s.fact_summary)||normalize(s.fact_summary).length<40||!normalize(s.fact_change)||normalize(s.fact_change).length<20)reasons.push('fact_fields_incomplete');
    if(!Array.isArray(s.caveats)||s.caveats.length===0)reasons.push('caveats_missing');
    if(!['announced','planned','pilot','started','ongoing','completed','result_reported'].includes(s.implementation_stage))reasons.push('stage_invalid');
    if(!s.source_eligible||s.prefilter!=='ai_candidate')reasons.push('source_or_prefilter_not_eligible');
    if(s.has_evaluation||s.has_article)reasons.push('already_processed');
    return reasons;
  };
  function approvedOutput(s:ApprovedRow){
    const reasons=required(s);
    if(reasons.length) return {source_item_id:s.id,accepted:false,blocked_reasons:reasons,actually_published:false};
    const src:Source={id:s.id,title:s.title,source_url:s.source_url,source_name:s.source_name,domain:s.domain,summary:s.summary,published_at:s.published_at,prefilter:s.prefilter,fact_summary:s.fact_summary,fact_status:s.fact_status,fact_pack_id:s.fact_pack_id,category_hint:null};
    const o=output(src,undefined,true);
    return {...o,accepted:true,blocked_reasons:[],approval:{reviewed_at:s.reviewed_at,review_type:s.review_type,source_hash_present:true,verified_for_mock_input:true},
      warning:'SIMULATION ONLY. Approved input used for a synthetic score, not actual AI verification. No publication.'};
  }
  type ApprovedRow=Source&{review_type:string|null;ready_for_scoring:boolean;reviewed_by:string|null;reviewed_at:string|null;review_note:string|null;reviewed_source_url:string|null;reviewer_active:boolean;source_hash:string|null;evidence_excerpt:string|null;evidence_kind:string|null;fact_change:string|null;caveats:unknown;implementation_stage:string;source_eligible:boolean;has_evaluation:boolean;has_article:boolean};
  const approvedFixtures=()=>{
    const base:ApprovedRow={id:'fixture-approved',title:'架空の改善施策についての確認済み成果',source_url:'https://example.invalid/test',source_name:'テスト機関',domain:'example.invalid',summary:null,published_at:null,prefilter:'ai_candidate',fact_summary:'架空の施策で改善が報告されたという設定のテスト文章。実際の情報ではなく、模擬評価の接続経路を検証するための文章です。',fact_status:'complete',fact_pack_id:'fixture',category_hint:null,review_type:'human_verified_source',ready_for_scoring:true,reviewed_by:'fixture-human',reviewed_at:'2026-11-10T00:00:00Z',review_note:'架空の出典確認済み',reviewed_source_url:'https://example.invalid/test',reviewer_active:true,source_hash:'a'.repeat(64),evidence_excerpt:'架空の改善を確認したという想定の文章です。これは接続機能の検証専用フィクスチャであり、実際の報道や成果ではありません。',evidence_kind:'feed_summary',fact_change:'架空の施策により改善が確認されたとするテスト設定です。',caveats:['これは架空の内容で実在の成果ではありません。'],implementation_stage:'result_reported',source_eligible:true,has_evaluation:false,has_article:false};
    const denied={...base,id:'fixture-unapproved',review_type:'unverified_machine_draft',ready_for_scoring:false};
    const old={...base,id:'fixture-legacy',review_type:'manual_official_source_body',ready_for_scoring:false};
    const changed={...base,id:'fixture-changed-url',reviewed_source_url:'https://example.invalid/other'};
    const processed={...base,id:'fixture-processed',has_evaluation:true};
    const result=[base,denied,old,changed,processed].map(approvedOutput);
    return {ok:true,version:VERSION,mode:'approval_gate_fixtures',provider:'mock',api_calls:0,database_writes:0,publications_created:0,results:result,checks:{approved_pass:result[0].accepted===true,unapproved_blocked:result[1].accepted===false,legacy_blocked:result[2].accepted===false,source_changed_blocked:result[3].accepted===false,duplicate_blocked:result[4].accepted===false}};
  };
async function authorized(req:Request) {
  const token=req.headers.get('x-nyu-token')??'';
  if(!token) return false;
  const r=await sql<{decrypted_secret:string}[]>`select decrypted_secret from vault.decrypted_secrets where name='nyu_fetch_token' limit 1`;
  if(r.length!==1) return false;
  const a=new TextEncoder().encode(token), b=new TextEncoder().encode(r[0].decrypted_secret);
  if(a.length!==b.length)return false;
  let diff=0;
  for(let i=0;i<a.length;i++)diff |= a[i]^b[i];
  return diff===0;
}

Deno.serve(async (req:Request)=>{
  if(req.method!=='POST') return Response.json({ok:false,error:'POST only'},{status:405});
  try {
    if(!(await authorized(req))) return Response.json({ok:false,error:'unauthorized'},{status:401});
    const body=await req.json().catch(()=>({}));
    if(!body || typeof body!=='object'||Array.isArray(body)) return Response.json({ok:false,error:'invalid body'},{status:400});
    const mode=body.mode??'fixtures';
    if(mode!=='fixtures'&&mode!=='candidates'&&mode!=='approved_factpacks'&&mode!=='approval_gate_fixtures') return Response.json({ok:false,error:'unsupported mode'},{status:400});
    if(body.publish===true||body.write===true||body.live===true||body.provider==='openai')
      return Response.json({ok:false,error:'mock_only_live_actions_disabled'},{status:409});
    if(mode==='approval_gate_fixtures') return Response.json(approvedFixtures());
    if(mode==='approved_factpacks'){
      if(body.domain!=null&&(typeof body.domain!=='string'||body.domain.length>200))return Response.json({ok:false,error:'invalid_domain'},{status:400});
      const domain=typeof body.domain==='string'&&body.domain.trim()?body.domain.trim().toLowerCase():null;
      const limit=Math.max(1,Math.min(10,Math.trunc(Number(body.limit)||5)));
      const id=typeof body.source_item_id==='string' && /^[0-9a-f]{8}-[0-9a-f-]{27,}$/.test(body.source_item_id)?body.source_item_id:null;
      if(body.source_item_id&&!id)return Response.json({ok:false,error:'invalid_source_item_id'},{status:400});
      const approved=await sql<ApprovedRow[]>`
        select i.id::text as id,i.original_title as title,i.source_url,s.name as source_name,s.domain,
          i.source_summary as summary,i.source_published_at::text as published_at,
          i.metadata->'zencho_prefilter'->>'decision' as prefilter,
          f.event_summary as fact_summary,f.extraction_status as fact_status,f.id::text as fact_pack_id,
          null::text as category_hint, f.extra_facts->>'review_type' as review_type,
          (f.extra_facts->>'ready_for_scoring')='true' as ready_for_scoring,
          f.extra_facts->>'reviewed_by' as reviewed_by, f.extra_facts->>'reviewed_at' as reviewed_at,
          f.extra_facts->>'review_note' as review_note, f.extra_facts->>'reviewed_source_url' as reviewed_source_url,
          exists(select 1 from public.nyu_admin_users au where au.user_id::text=f.extra_facts->>'reviewed_by' and au.is_active=true and au.role in ('owner','admin','editor')) as reviewer_active,
          f.source_content_hash as source_hash, f.extra_facts->>'evidence_excerpt' as evidence_excerpt,
          f.extra_facts->>'evidence_kind' as evidence_kind, f.change_summary as fact_change,
          f.caveats,f.implementation_stage,
          (s.is_active=true and s.rights_tier='green' and s.production_enabled=true and s.reuse_status='approved' and s.commercial_use_allowed=true and coalesce(s.takedown_status,'none')='none') as source_eligible,
          exists(select 1 from public.nyu_evaluations e where e.source_item_id=i.id) as has_evaluation,
          exists(select 1 from public.nyu_article_sources a where a.source_item_id=i.id) as has_article
        from public.nyu_source_fact_packs f join public.nyu_source_items i on i.id=f.source_item_id
        join public.nyu_sources s on s.id=i.source_id
        where f.extraction_status='complete'
          and f.extra_facts->>'review_type'='human_verified_source'
          and f.extra_facts->>'ready_for_scoring'='true'
          and (${domain}::text is null or s.domain=${domain})
          and (${id}::uuid is null or i.id=${id}::uuid)
        order by f.updated_at desc limit ${limit}
      `;
      const results=approved.map(approvedOutput);
      return Response.json({ok:true,version:VERSION,mode,provider:'mock',api_calls:0,database_writes:0,publications_created:0,processed:results.length,accepted:results.filter(x=>x.accepted).length,blocked:results.filter(x=>!x.accepted).length,results,
        note:'Human-approved, traceable factpacks only. Synthetic scoring preview, no article publication, no evaluation persistence.'});
    }
    if(mode==='fixtures') {
      const result=fixtures().map((x,i)=>output(x,[85,75,40][i],true));
      return Response.json({ok:true,version:VERSION,mode,provider:'mock',api_calls:0,database_writes:0,
        publications_created:0,results:result,checks:{
          pass85:result[0].publication_preview.would_publish_if_real_ai_and_verified,
          review75:!result[1].publication_preview.would_publish_if_real_ai_and_verified,
          fail40:!result[2].publication_preview.would_publish_if_real_ai_and_verified}});
    }
    if(body.domain!=null && (typeof body.domain!=='string'||body.domain.length>200))return Response.json({ok:false,error:'invalid_domain'},{status:400});
    const domain=typeof body.domain==='string' && body.domain.trim()?body.domain.trim().toLowerCase():null;
    const limit=Math.max(1,Math.min(10,Math.trunc(Number(body.limit)||5)));
    const rows=await sql<Source[]>`
      select i.id::text as id,i.original_title as title,i.source_url,
        s.name as source_name,s.domain,i.source_summary as summary,
        i.source_published_at::text as published_at,
        i.metadata->'zencho_prefilter'->>'decision' as prefilter,
        fp.event_summary as fact_summary,fp.extraction_status as fact_status,
        fp.id::text as fact_pack_id, null::text as category_hint
      from public.nyu_source_items i
      join public.nyu_sources s on s.id=i.source_id
      left join lateral (
        select f.id,f.event_summary,f.extraction_status
        from public.nyu_source_fact_packs f
        where f.source_item_id=i.id and f.extraction_status='complete'
        order by f.extracted_at desc nulls last limit 1
      ) fp on true
      where s.is_active=true and s.rights_tier='green' and s.production_enabled=true
        and s.reuse_status='approved' and s.commercial_use_allowed=true
        and i.metadata->'zencho_prefilter'->>'decision'='ai_candidate'
        and (${domain}::text is null or s.domain=${domain})
        and not exists(select 1 from public.nyu_evaluations e where e.source_item_id=i.id)
        and not exists(select 1 from public.nyu_article_sources ars where ars.source_item_id=i.id)
      order by i.source_published_at desc nulls last,i.discovered_at desc limit ${limit}
    `;
    const results=rows.map(x=>output(x));
    return Response.json({ok:true,version:VERSION,mode,provider:'mock',api_calls:0,database_writes:0,
      publications_created:0,processed:results.length,results,
      note:'No OpenAI API is called. Preview never writes to nyu_evaluations, nyu_articles or other tables.'});
  }catch(err){
    console.error('nyu-evaluator-mock',err);
    return Response.json({ok:false,error:'mock_evaluation_failed'},{status:500});
  }
});
