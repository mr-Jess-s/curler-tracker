const ALLOWED_SUBDOMAINS = new Set(['ab','canada','bc','mb','nb','nl','ns','nt','nu','on','pe','qc','sk','yt']);

function single(value) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function handler(request, response) {
  const requestId = globalThis.crypto?.randomUUID?.() || Math.random().toString(36).slice(2);
  if (request.method !== 'GET') {
    response.setHeader('Allow', 'GET');
    return response.status(405).json({ error: 'Method not allowed', request_id: requestId });
  }

  const kind = single(request.query.kind);
  const subdomain = String(single(request.query.subdomain) || '').toLowerCase();
  if (!ALLOWED_SUBDOMAINS.has(subdomain) || !['competitions', 'event'].includes(kind)) {
    return response.status(400).json({ error: 'Invalid source request', request_id: requestId });
  }

  let cachePath;
  if (kind === 'competitions') {
    const occurred = Number(single(request.query.occurred));
    if (!Number.isInteger(occurred) || occurred < -8 || occurred > 1) {
      return response.status(400).json({ error: 'Invalid season offset', request_id: requestId });
    }
    cachePath = `/data/source-cache/${subdomain}/competitions-${occurred}.json`;
  } else {
    const id = String(single(request.query.id) || '');
    if (!/^\d{1,12}$/.test(id)) {
      return response.status(400).json({ error: 'Invalid event ID', request_id: requestId });
    }
    cachePath = `/data/source-cache/${subdomain}/events/${id}.json`;
  }

  response.setHeader('Cache-Control', 'public, max-age=60, s-maxage=300, stale-while-revalidate=3600');
  response.setHeader('X-Curler-Tracker-Source', 'verified-archive-cache');
  response.setHeader('Location', cachePath);
  return response.status(307).send('');
}
