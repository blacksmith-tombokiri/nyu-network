import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import postgres from 'npm:postgres@3.4.7'
import { XMLParser } from 'npm:fast-xml-parser@5.3.0'

const sql = postgres(Deno.env.get('SUPABASE_DB_URL')!, {
  prepare: false,
  max: 1,
  idle_timeout: 5,
})

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  removeNSPrefix: true,
  trimValues: true,
  parseTagValue: false,
  parseAttributeValue: false,
})

type Endpoint = {
  endpoint_id: string
  source_id: string
  source_name: string
  endpoint_url: string
}

type NormalizedItem = {
  external_id: string | null
  source_url: string
  canonical_url: string
  original_title: string
  source_summary: string | null
  source_published_at: string | null
  content_hash: string
  dedupe_key: string
  metadata: Record<string, unknown>
}

type DecodeResult = {
  text: string
  encoding: string
  source: 'http-header' | 'xml-declaration' | 'fallback'
}

function asArray<T>(value: T | T[] | undefined | null): T[] {
  if (value == null) return []
  return Array.isArray(value) ? value : [value]
}

function textValue(value: unknown): string {
  if (value == null) return ''
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (Array.isArray(value)) return value.map(textValue).find(Boolean) ?? ''
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>
    return textValue(obj['#text'] ?? obj['__cdata'] ?? obj['value'] ?? '')
  }
  return ''
}

function stripHtml(input: string): string {
  return input
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim()
}

function normalizeEncodingLabel(raw: string | null | undefined): string | null {
  if (!raw) return null
  const label = raw.trim().toLowerCase().replace(/["']/g, '')
  if (['utf-8', 'utf8'].includes(label)) return 'utf-8'
  if (['shift_jis', 'shift-jis', 'sjis', 'ms_kanji', 'windows-31j', 'cp932', 'windows-932'].includes(label)) return 'shift_jis'
  if (['euc-jp', 'euc_jp', 'eucjp'].includes(label)) return 'euc-jp'
  if (['iso-2022-jp', 'jis'].includes(label)) return 'iso-2022-jp'
  return label
}

function sniffXmlEncoding(bytes: Uint8Array): string | null {
  const head = bytes.subarray(0, Math.min(bytes.length, 1024))
  let ascii = ''
  for (const b of head) ascii += String.fromCharCode(b)
  const match = ascii.match(/<\?xml[^>]*encoding\s*=\s*["']\s*([^"']+)\s*["']/i)
  return normalizeEncodingLabel(match?.[1] ?? null)
}

function headerEncoding(contentType: string | null): string | null {
  const match = contentType?.match(/charset\s*=\s*["']?([^;"'\s]+)/i)
  return normalizeEncodingLabel(match?.[1] ?? null)
}

function decodeBytesStrict(bytes: Uint8Array, encoding: string): string | null {
  try { return new TextDecoder(encoding, { fatal: true }).decode(bytes) }
  catch { return null }
}

function brokenTextScore(text: string): number {
  let bad = 0
  for (const ch of text) {
    const code = ch.charCodeAt(0)
    if (ch === '\uFFFD' || code === 0xfffd) bad += 1000
    else if (code < 0x20 && !['\n','\r','\t'].includes(ch)) bad += 200
    else if (code >= 0x80 && code <= 0x9f) bad += 30
  }
  return bad
}

function decodeFeed(bytes: Uint8Array, contentType: string | null): DecodeResult {
  const declared = sniffXmlEncoding(bytes)
  const header = headerEncoding(contentType)
  // XML declarations take precedence over HTTP suggestions when the declared encoding
  // can decode the WHOLE document losslessly. Never accept replacement characters.
  const encodings = Array.from(new Set([declared, header, 'utf-8', 'shift_jis', 'euc-jp']
    .filter(Boolean))) as string[]
  const valid: Array<{ encoding: string; text: string; bad: number }> = []
  for (const enc of encodings) {
    const result = decodeBytesStrict(bytes, enc)
    if (result !== null && brokenTextScore(result) === 0) valid.push({encoding: enc,text: result,bad: 0})
  }
  if (valid.length === 0) {
    throw new Error('FEED_ENCODING_UNDECODABLE: no complete lossless decoding; feed not saved')
  }
  const preferred = (declared && valid.find(x => x.encoding === declared))
    || (header && valid.find(x => x.encoding === header))
    || valid.find(x => x.encoding === 'utf-8')
    || valid[0]
  // A declared encoding that is invalid must not be silently replaced by guesswork.
  if (declared && preferred.encoding !== declared) {
    throw new Error('FEED_ENCODING_DECLARATION_MISMATCH: ' + declared + ' is not lossless; feed not saved')
  }
  return {
    text: preferred.text,encoding: preferred.encoding,
    source: declared === preferred.encoding ? 'xml-declaration'
      : header === preferred.encoding ? 'http-header' : 'fallback'
  }
}

function isBrokenTitle(title: string): boolean {
  if (!title) return true
  if (title.includes('�')) return true
  const badControl = [...title].some((ch) => {
    const code = ch.charCodeAt(0)
    return code < 0x20 && ch !== '\n' && ch !== '\r' && ch !== '\t'
  })
  return badControl
}

function extractLink(item: Record<string, unknown>): string {
  const candidates = asArray(item.link)
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.startsWith('http')) return candidate.trim()
    if (candidate && typeof candidate === 'object') {
      const obj = candidate as Record<string, unknown>
      const href = textValue(obj['@_href'] ?? obj['href'])
      const rel = textValue(obj['@_rel'] ?? obj['rel'])
      if (href.startsWith('http') && (!rel || rel === 'alternate')) return href.trim()
    }
  }
  const guid = textValue(item.guid)
  return guid.startsWith('http') ? guid.trim() : ''
}

function canonicalizeUrl(raw: string): string {
  try {
    const url = new URL(raw)
    url.hash = ''
    const drop = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'fbclid', 'gclid']
    for (const key of drop) url.searchParams.delete(key)
    url.hostname = url.hostname.toLowerCase()
    if (url.pathname !== '/') url.pathname = url.pathname.replace(/\/+$/, '')
    return url.toString()
  } catch {
    return raw.trim()
  }
}

function parseDate(raw: string): string | null {
  if (!raw) return null
  const d = new Date(raw)
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}

async function sha256(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input)
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('')
}

function getFeedItems(doc: Record<string, unknown>): Record<string, unknown>[] {
  const rss = doc.rss as Record<string, unknown> | undefined
  const channel = rss?.channel as Record<string, unknown> | undefined
  if (channel?.item) return asArray(channel.item) as Record<string, unknown>[]

  const rdf = (doc.RDF ?? doc.rdf) as Record<string, unknown> | undefined
  if (rdf?.item) return asArray(rdf.item) as Record<string, unknown>[]

  const feed = doc.feed as Record<string, unknown> | undefined
  if (feed?.entry) return asArray(feed.entry) as Record<string, unknown>[]

  return []
}

async function normalizeItem(item: Record<string, unknown>, endpointUrl: string, feedEncoding: string, encodingSource: string): Promise<NormalizedItem | null> {
  const title = stripHtml(textValue(item.title))
  const link = extractLink(item)
  if (!title || !link || isBrokenTitle(title)) return null

  const canonical = canonicalizeUrl(link)
  const rawSummary = textValue(item.description ?? item.summary ?? item.content ?? item.encoded)
  const cleanedSummary = stripHtml(rawSummary).slice(0, 4000)
  const summary = cleanedSummary && !cleanedSummary.includes('�') ? cleanedSummary : null
  const dateRaw = textValue(item.pubDate ?? item.date ?? item.published ?? item.updated)
  const published = parseDate(dateRaw)
  const external = textValue(item.guid ?? item.id) || null
  const contentHash = await sha256([title, summary ?? '', published ?? ''].join('\n'))
  const dedupeKey = await sha256(canonical.toLowerCase())

  return {
    external_id: external,
    source_url: link,
    canonical_url: canonical,
    original_title: title.slice(0, 1000),
    source_summary: summary,
    source_published_at: published,
    content_hash: contentHash,
    dedupe_key: dedupeKey,
    metadata: {
      endpoint_url: endpointUrl,
      fetched_via: 'rss',
      feed_encoding: feedEncoding,
      feed_encoding_source: encodingSource,
    },
  }
}

async function authorized(req: Request): Promise<boolean> {
  const provided = req.headers.get('x-nyu-token') ?? ''
  if (!provided) return false
  const rows = await sql<{ decrypted_secret: string }[]>`
    select decrypted_secret
    from vault.decrypted_secrets
    where name = 'nyu_fetch_token'
    limit 1
  `
  return rows.length === 1 && rows[0].decrypted_secret === provided
}

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return Response.json({ error: 'POST only' }, { status: 405 })

  try {
    if (!(await authorized(req))) return Response.json({ error: 'unauthorized' }, { status: 401 })

    let body: Record<string, unknown> = {}
    try { body = await req.json() } catch { /* empty body is fine */ }

    const requestedMax = Number(body.maxItemsPerFeed ?? 100)
    const maxItemsPerFeed = Math.max(1, Math.min(Number.isFinite(requestedMax) ? requestedMax : 100, 200))
    const domainFilter = typeof body.domain === 'string' ? body.domain.trim().toLowerCase() : null
    const dryRun = body.dry_run === true

    const endpoints = await sql<Endpoint[]>`
      select
        e.id::text as endpoint_id,
        e.source_id::text as source_id,
        s.name as source_name,
        e.endpoint_url
      from public.nyu_source_endpoints e
      join public.nyu_sources s on s.id = e.source_id
      where e.acquisition_method = 'rss'
        and e.is_enabled = true
        and s.is_active = true
        and s.reuse_status = 'approved'
        and s.auto_fetch_allowed = true
        and s.rights_tier = 'green'
        and s.production_enabled = true
        and s.commercial_use_allowed = true
        and coalesce(s.takedown_status,'none') = 'none'
        and (${domainFilter}::text is null or lower(s.domain) = ${domainFilter})
      order by e.priority asc, s.name asc
    `

    const results: Record<string, unknown>[] = []
    let insertedTotal = 0
    let updatedTotal = 0
    let failedFeeds = 0

    for (const endpoint of endpoints) {
      const startedAt = new Date().toISOString()
      try {
        const response = await fetch(endpoint.endpoint_url, {
          headers: {
            'User-Agent': 'NYU-Network-Fetcher/0.2 (+https://nfjqakbsaahjkyoylemy.supabase.co)',
            'Accept': 'application/rss+xml, application/atom+xml, application/rdf+xml, application/xml, text/xml;q=0.9, */*;q=0.1',
          },
          redirect: 'follow',
          signal: AbortSignal.timeout(15000),
        })

        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        const bytes = new Uint8Array(await response.arrayBuffer())
        const decoded = decodeFeed(bytes, response.headers.get('content-type'))
        const parsed = parser.parse(decoded.text) as Record<string, unknown>
        const rawItems = getFeedItems(parsed).slice(0, maxItemsPerFeed)
        if (dryRun) {
          const sample = rawItems.slice(0, 8).map(item => ({title: stripHtml(textValue(item.title)),link: extractLink(item)}))
          if (sample.some(x => isBrokenTitle(x.title))) throw new Error('FEED_TITLE_BROKEN: sampled title contains replacement or control code')
          results.push({source:endpoint.source_name,endpoint:endpoint.endpoint_url,status:'dry_run_ok',encoding:decoded.encoding,encoding_source:decoded.source,total_items:rawItems.length,sample,inserted:0,updated:0})
          continue
        }

        let feedInserted = 0
        let feedUpdated = 0
        let skipped = 0
        let skippedMojibake = 0

        for (const raw of rawItems) {
          const rawTitle = stripHtml(textValue(raw.title))
          if (rawTitle && isBrokenTitle(rawTitle)) {
            skipped++
            skippedMojibake++
            continue
          }

          const item = await normalizeItem(raw, endpoint.endpoint_url, decoded.encoding, decoded.source)
          if (!item) {
            skipped++
            continue
          }

          const existing = await sql<{ id: string }[]>`
            select id::text
            from public.nyu_source_items
            where source_id = ${endpoint.source_id}::uuid
              and canonical_url = ${item.canonical_url}
            limit 1
          `

          if (existing.length === 0) {
            await sql`
              insert into public.nyu_source_items (
                source_id, external_id, source_url, canonical_url,
                original_title, source_summary, source_published_at,
                content_hash, dedupe_key, processing_status, metadata
              ) values (
                ${endpoint.source_id}::uuid,
                ${item.external_id}, ${item.source_url}, ${item.canonical_url},
                ${item.original_title}, ${item.source_summary}, ${item.source_published_at}::timestamptz,
                ${item.content_hash}, ${item.dedupe_key}, 'discovered', ${sql.json(item.metadata)}
              )
            `
            feedInserted++
          } else {
            await sql`
              update public.nyu_source_items
              set external_id = ${item.external_id},
                  source_url = ${item.source_url},
                  original_title = ${item.original_title},
                  source_summary = ${item.source_summary},
                  source_published_at = ${item.source_published_at}::timestamptz,
                  content_hash = ${item.content_hash},
                  dedupe_key = ${item.dedupe_key},
                  metadata = metadata || ${sql.json(item.metadata)}
              where id = ${existing[0].id}::uuid
            `
            feedUpdated++
          }
        }

        await sql`
          update public.nyu_source_endpoints
          set last_fetch_at = now(),
              last_success_at = now(),
              last_http_status = ${response.status},
              last_error = null,
              updated_at = now()
          where id = ${endpoint.endpoint_id}::uuid
        `

        insertedTotal += feedInserted
        updatedTotal += feedUpdated
        results.push({
          source: endpoint.source_name,
          endpoint: endpoint.endpoint_url,
          started_at: startedAt,
          fetched: rawItems.length,
          inserted: feedInserted,
          updated: feedUpdated,
          skipped,
          skipped_mojibake: skippedMojibake,
          encoding: decoded.encoding,
          encoding_source: decoded.source,
          status: 'ok',
        })
      } catch (error) {
        failedFeeds++
        const message = error instanceof Error ? error.message : String(error)
        await sql`
          update public.nyu_source_endpoints
          set last_fetch_at = now(),
              last_error = ${message.slice(0, 2000)},
              updated_at = now()
          where id = ${endpoint.endpoint_id}::uuid
        `
        results.push({
          source: endpoint.source_name,
          endpoint: endpoint.endpoint_url,
          started_at: startedAt,
          status: 'error',
          error: message,
        })
      }
    }

    return Response.json({
      ok: failedFeeds === 0,
      fetcher_version: '0.3-encoding-safe',
      feeds_targeted: endpoints.length,
      feeds_failed: failedFeeds,
      inserted: insertedTotal,
      updated: updatedTotal,
      results,
    })
  } catch (error) {
    console.error(error)
    return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 })
  }
})
