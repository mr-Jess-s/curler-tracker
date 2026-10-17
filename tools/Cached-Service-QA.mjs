import assert from 'node:assert/strict';
import handler from '../api/curling-io.js';

function response() {
  return {
    statusCode: 200, headers: {}, body: null,
    setHeader(key, value) { this.headers[key.toLowerCase()] = value; },
    status(code) { this.statusCode = code; return this; },
    json(value) { this.body = JSON.stringify(value); return this; },
    send(value) { this.body = value; return this; }
  };
}

let fetched = '';
globalThis.fetch = async url => {
  fetched = String(url);
  return { ok: true, status: 200, async text() { return '{"items":[],"seasons":[]}'; } };
};
let res = response();
await handler({ method: 'GET', query: { kind: 'competitions', subdomain: 'ab', occurred: '0' } }, res);
assert.equal(res.statusCode, 200);
assert.equal(fetched, 'https://api.curling.io/en/clubs/ab/competitions?occurred=0&registrations=f');
assert.match(res.headers['vercel-cdn-cache-control'], /s-maxage=300/);

res = response();
await handler({ method: 'GET', query: { kind: 'event', subdomain: 'mb', id: '26408' } }, res);
assert.equal(res.statusCode, 200);
assert.equal(fetched, 'https://api.curling.io/en/clubs/mb/events/26408');
assert.match(res.headers['vercel-cdn-cache-control'], /s-maxage=60/);

res = response();
await handler({ method: 'GET', query: { kind: 'event', subdomain: 'evil.example', id: '1' } }, res);
assert.equal(res.statusCode, 400);

res = response();
await handler({ method: 'POST', query: {} }, res);
assert.equal(res.statusCode, 405);
console.log('4 cached service checks passed.');
