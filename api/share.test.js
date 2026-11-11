import assert from 'node:assert/strict';
import test from 'node:test';
import handler, { __setShareClock, decodeShareImage, SHARE_TTL_SECONDS } from './share.js';

const TINY_JPEG =
  '/9j/4AAQSkZJRgABAgAAAQABAAD//gAQTGF2YzYwLjMxLjEwMgD/2wBDAAgEBAQEBAUFBQUFBQYGBgYGBgYGBgYGBgYHBwcICAgHBwcGBwcHCAgICAkJCQgICAgJCQoKCgwMCwsODg4RERT/xABLAAEBAAAAAAAAAAAAAAAAAAAABwEBAAAAAAAAAAAAAAAAAAAAABABAAAAAAAAAAAAAAAAAAAAABEBAAAAAAAAAAAAAAAAAAAAAP/AABEIAAIAAgMBIgACEQADEQD/2gAMAwEAAhEDEQA/AL+AD//Z';
const TINY_PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

function mockRes() {
  return {
    statusCode: 200,
    headers: {},
    body: null,
    setHeader(key, value) {
      this.headers[key] = value;
      return this;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(obj) {
      this.body = obj;
      return this;
    },
  };
}

async function call(method, { body, url, query } = {}) {
  const res = mockRes();
  await handler({ method, body, url: url || '/api/share', query: query || {}, headers: {} }, res);
  return res;
}

test('decodeShareImage accepts a jpeg data URL and rejects other bytes', () => {
  const ok = decodeShareImage('data:image/jpeg;base64,' + TINY_JPEG);
  assert.equal(ok.mime, 'image/jpeg');
  assert.equal(Buffer.from(ok.data, 'base64')[0], 0xff);
  assert.equal(decodeShareImage('aGVsbG8=').error, 'invalid');
  assert.equal(decodeShareImage('').error, 'invalid');
});

test('POST stores a jpeg once and GET returns it a single time', async () => {
  const created = await call('POST', { body: { image: TINY_JPEG } });
  assert.equal(created.statusCode, 200);
  assert.equal(created.headers['Cache-Control'], 'no-store');
  assert.match(created.body.id, /^[A-Za-z0-9_-]{22}$/);
  assert.equal(created.body.expiresIn, SHARE_TTL_SECONDS);
  assert.equal(JSON.stringify(created.body).includes(TINY_JPEG.slice(0, 24)), false);

  const read = await call('GET', { url: '/api/share?id=' + created.body.id, query: { id: created.body.id } });
  assert.equal(read.statusCode, 200);
  assert.equal(read.body.mime, 'image/jpeg');
  assert.equal(Buffer.from(read.body.data, 'base64')[0], 0xff);

  const again = await call('GET', { query: { id: created.body.id } });
  assert.equal(again.statusCode, 404);
  assert.equal(again.body.data, undefined);
});

test('POST accepts a png data URL and a raw base64 string', async () => {
  const png = await call('POST', { body: { image: 'data:image/png;base64,' + TINY_PNG } });
  assert.equal(png.statusCode, 200);
  const pngRead = await call('GET', { query: { id: png.body.id } });
  assert.equal(pngRead.body.mime, 'image/png');

  const raw = await call('POST', { body: TINY_JPEG.match(/.{1,40}/g).join('\n') });
  assert.equal(raw.statusCode, 200);
  const rawRead = await call('GET', { url: '/api/share?id=' + raw.body.id });
  assert.equal(rawRead.statusCode, 200);
  assert.equal(rawRead.body.mime, 'image/jpeg');
});

test('rejects invalid, oversized, unknown, and unsupported requests', async () => {
  assert.equal((await call('POST', { body: { image: 'hello' } })).statusCode, 400);
  assert.equal((await call('POST', { body: {} })).statusCode, 400);
  assert.equal((await call('POST', { body: { image: 'A'.repeat(1800001) } })).statusCode, 413);

  const big = Buffer.alloc(1200001, 0);
  big[0] = 0xff;
  big[1] = 0xd8;
  big[2] = 0xff;
  assert.equal((await call('POST', { body: { image: big.toString('base64') } })).statusCode, 413);

  const webp = Buffer.alloc(16);
  webp.write('RIFF', 0);
  webp.write('WEBP', 8);
  const webpRes = await call('POST', { body: { image: webp.toString('base64') } });
  assert.equal(webpRes.statusCode, 200);
  assert.equal((await call('GET', { query: { id: webpRes.body.id } })).body.mime, 'image/webp');

  assert.equal((await call('GET', { query: { id: 'short' } })).statusCode, 400);
  assert.equal((await call('GET', { query: { id: 'a'.repeat(22) } })).statusCode, 404);
  const denied = await call('PUT', { body: { image: TINY_JPEG } });
  assert.equal(denied.statusCode, 405);
  assert.equal(denied.headers.Allow, 'GET, POST');
});

test('a handoff expires even if it was not fetched', async () => {
  const created = await call('POST', { body: { image: TINY_JPEG } });
  __setShareClock(() => Date.now() + (SHARE_TTL_SECONDS + 5) * 1000);
  try {
    const read = await call('GET', { query: { id: created.body.id } });
    assert.equal(read.statusCode, 404);
  } finally {
    __setShareClock(null);
  }
});
