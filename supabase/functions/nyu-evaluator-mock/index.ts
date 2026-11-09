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
  const evidenceReady=fixture?true:source.fact_status==='complete' && Boolean(normalize(source.fact_summary));
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
    if(mode!=='fixtures'&&mode!=='candidates') return Response.json({ok:false,error:'unsupported mode'},{status:400});
    if(body.publish===true||body.write===true||body.live===true||body.provider==='openai')
      return Response.json({ok:false,error:'mock_only_live_actions_disabled'},{status:409});
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
