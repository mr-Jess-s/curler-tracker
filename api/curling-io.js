const ALLOWED_SUBDOMAINS = new Set(['ab','canada','bc','mb','nb','nl','ns','nt','nu','on','pe','qc','sk','yt']);

function single(value) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function handler(request, response) {
  const requestId = globalThis.crypto?.randomUUID?.() || Math.random().toString(36).slice(2);
  try {
    if (request.method !== 'GET') {
      response.setHeader('Allow', 'GET');
      return response.status(405).json({ error: 'Method not allowed', request_id: requestId });
    }
    const kind = single(request.query.kind);
    const subdomain = String(single(request.query.subdomain) || '').toLowerCase();
    if (!ALLOWED_SUBDOMAINS.has(subdomain) || !['competitions', 'event'].includes(kind)) {
      return response.status(400).json({ error: 'Invalid source request', request_id: requestId });
    }

    let upstream;
    let ttl;
    if (kind === 'competitions') {
      const occurred = Number(single(request.query.occurred));
      if (!Number.isInteger(occurred) || occurred < -8 || occurred > 1) {
        return response.status(400).json({ error: 'Invalid season offset', request_id: requestId });
      }
      upstream = `https://api.curling.io/en/clubs/${subdomain}/competitions?occurred=${occurred}&registrations=f`;
      ttl = 300;
    } else {
      const id = String(single(request.query.id) || '');
      if (!/^\d{1,12}$/.test(id)) return response.status(400).json({ error: 'Invalid event ID', request_id: requestId });
      upstream = `https://api.curling.io/en/clubs/${subdomain}/events/${id}`;
      ttl = 60;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    let sourceResponse;
    try {
      sourceResponse = await fetch(upstream, {
        headers: { Accept: 'application/json', 'User-Agent': 'CurlerTracker/26.21 public-cache' },
        signal: controller.signal
      });
    } finally {
      clearTimeout(timeout);
    }
    if (!sourceResponse.ok) {
      console.error(JSON.stringify({ requestId, upstream_status: sourceResponse.status, kind, subdomain }));
      response.setHeader('Cache-Control', 'public, s-maxage=15, stale-while-revalidate=60');
      return response.status(502).json({ error: 'Official source temporarily unavailable', request_id: requestId });
    }
    const text = await sourceResponse.text();
    JSON.parse(text);
    response.setHeader('Content-Type', 'application/json; charset=utf-8');
    response.setHeader('Vercel-CDN-Cache-Control', `public, s-maxage=${ttl}, stale-while-revalidate=3600`);
    response.setHeader('Cache-Control', 'public, max-age=30');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    return response.status(200).send(text);
  } catch (error) {
    console.error(JSON.stringify({ requestId, error: error?.name || 'Error', message: String(error?.message || error) }));
    response.setHeader('Cache-Control', 'no-store');
    return response.status(error?.name === 'AbortError' ? 504 : 502).json({
      error: error?.name === 'AbortError' ? 'Official source timed out' : 'Official source unavailable',
      request_id: requestId
    });
  }
}
