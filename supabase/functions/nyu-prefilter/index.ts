import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import postgres from 'npm:postgres@3.4.7'

const sql = postgres(Deno.env.get('SUPABASE_DB_URL')!, {prepare:false,max:1,idle_timeout:5})
type Item = {id:string; title:string; summary:string|null; domain:string; source_name:string}
type Verdict = 'ai_candidate'|'manual_review'|'skip'
const VERSION='zencho-prefilter-v0.2'
const GAME_GOOD=/復元|保存|保全|アーカイブ|復活|オフライン版|オフライン.*再構築|長期.*遊|現代.*動作|GOG[.]com|クラウン603|アクセシビリティ|バリアフリー|障害者|医療|福祉|被災|寄付|チャリティ|教育|学習|権利侵害|複製を制限|クローンゲーム|自然言語でゲーム|個人宝箱|ロット.*廃止|対戦環境の改善|ゲーム.*(改善|修復|修正)|ゲーム.*(簡単|使いやす|遊びやす)|クリエイター.*収益/i
const ADMIN_ONLY=/公募|募集開始|意見募集|議事|検討会|審議会|会議.*開催|記者会見|採用試験|人事異動|入札|調達|リコール|説明会|セミナー/i
const SIGNALS=/成功|達成|社会実装|実用化|開発|実証|導入|開始|改善|増加|拡大|回復|削減|普及|保護|支援|救済|認定|表彰|受賞|解除|復興|省力化|長寿命|低減|リサイクル|農福|障害|就労|補助金|治療|再生|効果|研究|医療|復元|復活|防災|防止|デジタル|市民/i
const OUTCOME=/解消|回復|改善|救済|防止|減少|技術|対策の効果/i
const NEGATIVE=/リコール|不正アクセス|逮捕|死亡|被害|事故|回収命令|不具合/i
const ADMIN_EXCEPTIONS=/結果|成果|決定|採択|改善|実証|開始|導入|成功|表彰|開発/i
function decide(item:Item):{decision:Verdict;reason:string;signal:string}{
 const title=item.title||'', combined=title+' '+(item.summary||'')
 if(!title.trim()||title.includes('\uFFFD'))return{decision:'manual_review',reason:'missing_or_broken_title',signal:'encoding'}
 if(item.domain==='4gamer.net'){
  if(/(シミュレーションゲーム|配信開始|発売|予約受付)/.test(title) && !/(GOG[.]com|アーカイブ|復元に成功|オフライン.*再構築|アクセシビリティ|チャリティ|複製を制限|クローンゲーム)/.test(combined)) return {decision:'skip',reason:'game_release_promotion_even_if_social_keyword',signal:'game_release'}
  if(GAME_GOOD.test(combined))return{decision:'ai_candidate',reason:'gaming_social_or_cultural_benefit_signal',signal:'game_social_value'}
  return{decision:'skip',reason:'routine_game_or_commercial_news',signal:'game_other'}
 }
 if(item.domain==='projects.research-and-innovation.ec.europa.eu'){
  if(/dung.beetle|inner.compass/i.test(title)) return {decision:'manual_review',reason:'research_social_benefit_unproven',signal:'research_early'}
  return {decision:'ai_candidate',reason:'EU_applied_research_results',signal:'research_applied'}
 }
 if(item.domain==='esahubble.org')return{decision:'manual_review',reason:'editorial_green_to_yellow_candidate',signal:'astronomy'}
 if(NEGATIVE.test(combined)&&!OUTCOME.test(combined))return{decision:'manual_review',reason:'possible_negative_or_safety_news',signal:'risk_news'}
 if(/職員の募集|専門委員名簿|認定・登録番号を掲載|採用予定|全館停電|受付の一時停止/.test(title))return{decision:'skip',reason:'administrative_list_or_recruitment',signal:'admin_notice'}
 if(ADMIN_ONLY.test(title)&&!ADMIN_EXCEPTIONS.test(title))return{decision:'skip',reason:'administrative_announcement_without_outcome',signal:'admin_notice'}
 if(SIGNALS.test(combined))return{decision:'ai_candidate',reason:'potential_concrete_positive_change',signal:'social_outcome'}
 return{decision:'manual_review',reason:'ambiguous_or_insufficient_signal',signal:'uncertain'}
}
async function authorized(req:Request):Promise<boolean>{
 const token=req.headers.get('x-nyu-token')||''
 if(!token)return false
 const result=await sql`select decrypted_secret from vault.decrypted_secrets where name='nyu_fetch_token' limit 1`
 return result.length===1&&token===result[0].decrypted_secret
}
Deno.serve(async(req:Request)=>{
 if(req.method!=='POST')return Response.json({error:'POST only'},{status:405})
 try{
  if(!(await authorized(req)))return Response.json({error:'unauthorized'},{status:401})
  let body:Record<string,unknown>={}
  try{body=await req.json()}catch{}
  const from=typeof body.from==='string'?body.from:null
  const to=typeof body.to==='string'?body.to:null
  if(from&&!/^\d{4}-\d{2}-\d{2}$/.test(from))return Response.json({error:'Invalid from'},{status:400})
  if(to&&!/^\d{4}-\d{2}-\d{2}$/.test(to))return Response.json({error:'Invalid to'},{status:400})
  const domain=typeof body.domain==='string'?body.domain.trim():null
  const dryRun=body.dry_run===true
  const onlyNew=body.only_new!==false
  const lim=Math.min(Math.max(Number(body.limit)||800,1),2000)
  const rows=await sql`
   select i.id::text id,i.original_title title,i.source_summary summary,s.domain,s.name source_name
   from public.nyu_source_items i join public.nyu_sources s on s.id=i.source_id
   where s.rights_tier='green' and s.reuse_status='approved'
   and s.is_active=true and s.production_enabled=true and s.commercial_use_allowed=true
   and coalesce(s.takedown_status,'none')='none'
   and (${domain}::text is null or s.domain=${domain})
   and (${from}::date is null or (i.source_published_at at time zone 'Asia/Tokyo')::date >= ${from}::date)
   and (${to}::date is null or (i.source_published_at at time zone 'Asia/Tokyo')::date <= ${to}::date)
   and (${!onlyNew}::boolean or not (i.metadata ? 'zencho_prefilter'))
   order by i.source_published_at desc nulls last,i.discovered_at desc
   limit ${lim}`
  const counts={ai_candidate:0,manual_review:0,skip:0}
  const bySource:Record<string,Record<Verdict,number>>={}
  const samples:Record<Verdict,Array<{title:string;domain:string;reason:string}>>={ai_candidate:[],manual_review:[],skip:[]}
  let saved=0
  for(const item of rows){
   const result=decide(item)
   counts[result.decision]++
   if(!bySource[item.source_name])bySource[item.source_name]={ai_candidate:0,manual_review:0,skip:0}
   bySource[item.source_name][result.decision]++
   if(samples[result.decision].length<6)samples[result.decision].push({title:item.title,domain:item.domain,reason:result.reason})
   if(!dryRun){
    const payload={version:VERSION,decision:result.decision,reason:result.reason,signal:result.signal,
      decided_at:new Date().toISOString(),used_fields:['original_title','source_summary','source_domain'],
      ai_tokens_used:0,review_required:result.decision==='manual_review',
      does_not_change_editorial_score:true,does_not_change_publication:true}
    await sql`update public.nyu_source_items set metadata=jsonb_set(coalesce(metadata,'{}'::jsonb),'{zencho_prefilter}',${sql.json(payload)}::jsonb,true) where id=${item.id}::uuid`
    saved++
   }
  }
  return Response.json({ok:true,version:VERSION,dry_run:dryRun,processed:rows.length,saved,counts,by_source:bySource,samples,note:'Classification only. AI scoring, editorial decisions, publishing and processing_status unchanged.'})
 }catch(err){console.error(err);return Response.json({error:err instanceof Error?err.message:String(err)},{status:500})}
})
