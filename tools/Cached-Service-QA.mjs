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

let fetched = false;
globalThis.fetch = async () => {
  fetched = true;
  throw new Error('The public request path must not contact the upstream source.');
};

let res = response();
await handler({ method: 'GET', query: { kind: 'competitions', subdomain: 'ab', occurred: '0' } }, res);
assert.equal(res.statusCode, 307);
assert.equal(res.headers.location, '/data/source-cache/ab/competitions-0.json');
assert.match(res.headers['cache-control'], /s-maxage=300/);
assert.equal(res.headers['x-curler-tracker-source'], 'verified-archive-cache');
assert.equal(fetched, false);

res = response();
await handler({ method: 'GET', query: { kind: 'event', subdomain: 'mb', id: '26408' } }, res);
assert.equal(res.statusCode, 307);
assert.equal(res.headers.location, '/data/source-cache/mb/events/26408.json');
assert.equal(fetched, false);

res = response();
await handler({ method: 'GET', query: { kind: 'event', subdomain: 'evil.example', id: '1' } }, res);
assert.equal(res.statusCode, 400);

res = response();
await handler({ method: 'POST', query: {} }, res);
assert.equal(res.statusCode, 405);
console.log('4 cached service checks passed.');
