const ALLOWED_PATHS = {
  '/api/subscribe': { methods: ['POST'], query: [] },
  '/api/payment/status': { methods: ['GET', 'DELETE'], query: ['id'] },
  '/api/subscription': { methods: ['GET'], query: [] }
}
const RELAY_BASE = process.env.HIVERELAY_API_BASE || 'https://relay.hivetalk.org'

export default async function handler(req, res) {
  const url = new URL(req.url, `https://${req.headers.host || 'localhost'}`)
  const path = url.searchParams.get('path')

  const spec = path ? ALLOWED_PATHS[path] : undefined
  if (!spec) {
    res.statusCode = 400
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify({ error: 'invalid or disallowed path' }))
    return
  }

  const method = (req.method || 'GET').toUpperCase()
  if (!spec.methods.includes(method)) {
    res.statusCode = 405
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify({ error: 'method not allowed' }))
    return
  }

  url.searchParams.delete('path')
  // Drop any query keys the chosen endpoint does not expect.
  for (const key of Array.from(url.searchParams.keys())) {
    if (!spec.query.includes(key)) url.searchParams.delete(key)
  }
  const upstreamQuery = url.searchParams.toString()
  const upstreamUrl = `${RELAY_BASE}${path}${upstreamQuery ? '?' + upstreamQuery : ''}`

  const body = await readBody(req)

  const forwardHeaders = {}
  const toForward = ['authorization', 'x-challenge', 'x-l402', 'content-type']
  for (const h of toForward) {
    const v = req.headers[h]
    if (v) forwardHeaders[h] = v
  }

  try {
    const upstream = await fetch(upstreamUrl, {
      method,
      headers: forwardHeaders,
      body: body.length ? body : undefined
    })

    const upstreamBody = Buffer.from(await upstream.arrayBuffer())

    res.statusCode = upstream.status
    const contentType = upstream.headers.get('content-type')
    if (contentType) res.setHeader('Content-Type', contentType)
    const wwwAuth = upstream.headers.get('www-authenticate')
    if (wwwAuth) res.setHeader('WWW-Authenticate', wwwAuth)
    res.end(upstreamBody)
  } catch (err) {
    console.error('billing/proxy: upstream fetch failed for', upstreamUrl, err)
    res.statusCode = 502
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify({ error: 'relay unreachable' }))
  }
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    req.on('data', (chunk) => chunks.push(chunk))
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', reject)
  })
}
