import { createHash, randomBytes } from 'node:crypto';
import { getCache } from '@vercel/functions';

// Short-lived handoff for the iPhone Shortcut. iOS Safari cannot register a
// share_target, and a full photo does not fit reliably in a Shortcuts URL.
// The image is kept only until the page fetches it, or for two minutes.
export const SHARE_TTL_SECONDS = 120;
const MAX_INPUT_CHARS = 1800000;
const MAX_DECODED_BYTES = 1200000;
const ID_RE = /^[A-Za-z0-9_-]{22}$/;

const memory = new Map();
let clock = () => Date.now();

// Tests advance time without waiting for the real TTL.
export function __setShareClock(fn) {
  clock = typeof fn === 'function' ? fn : () => Date.now();
}

function memoryStore() {
  return {
    async get(key) {
      const row = memory.get(key);
      if (!row) return null;
      if (row.exp <= clock()) {
        memory.delete(key);
        return null;
      }
      return row.value;
    },
    async set(key, value, ttl) {
      memory.set(key, { value, exp: clock() + ttl * 1000 });
    },
    async del(key) {
      memory.delete(key);
    },
  };
}

function vercelStore() {
  const cache = getCache({
    namespace: 'receipt-share',
    keyHashFunction: (key) => createHash('sha256').update(String(key)).digest('hex'),
  });
  return {
    async get(key) {
      const value = await cache.get(key);
      return value == null ? null : value;
    },
    async set(key, value, ttl) {
      await cache.set(key, value, { ttl, name: 'receipt-handoff' });
    },
    async del(key) {
      await cache.delete(key);
    },
  };
}

function store() {
  // On Vercel this is the regional runtime cache, shared by later invocations
  // in the same region. Local runs and tests stay in this process.
  if (process.env.VERCEL) return vercelStore();
  return memoryStore();
}

function asRecord(value) {
  if (!value) return null;
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === 'object' ? parsed : null;
    } catch {
      return null;
    }
  }
  return typeof value === 'object' ? value : null;
}

function sniff(buf) {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.length >= 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'image/png';
  if (
    buf.length >= 12 &&
    buf.toString('ascii', 0, 4) === 'RIFF' &&
    buf.toString('ascii', 8, 12) === 'WEBP'
  ) {
    return 'image/webp';
  }
  return '';
}

export function decodeShareImage(input) {
  if (typeof input !== 'string') return { error: 'invalid' };
  let source = input.trim();
  const dataUrl = source.match(/^data:image\/(?:jpeg|jpg|png|webp);base64,([\s\S]+)$/i);
  if (dataUrl) source = dataUrl[1];
  source = source.replace(/\s+/g, '').replace(/-/g, '+').replace(/_/g, '/');
  if (source.length > MAX_INPUT_CHARS) return { error: 'too-large' };
  if (!source || !/^[A-Za-z0-9+/]+={0,2}$/.test(source)) return { error: 'invalid' };
  while (source.length % 4) source += '=';
  const buf = Buffer.from(source, 'base64');
  if (!buf.length || buf.length > MAX_DECODED_BYTES) return { error: 'too-large' };
  const mime = sniff(buf);
  if (!mime) return { error: 'invalid' };
  return { mime, data: buf.toString('base64') };
}

function imageField(body) {
  if (typeof body === 'string') return body;
  if (Buffer.isBuffer(body)) return body.toString('utf8');
  if (body && typeof body === 'object' && typeof body.image === 'string') return body.image;
  return '';
}

function readBody(req) {
  const body = req.body;
  if (typeof body === 'string') {
    const trimmed = body.trim();
    if (trimmed.startsWith('{')) {
      try {
        return JSON.parse(trimmed);
      } catch {
        return trimmed;
      }
    }
    return body;
  }
  return body;
}

function requestId(req) {
  const query = req.query || {};
  if (typeof query.id === 'string') return query.id;
  try {
    return new URL(req.url || '/', 'http://localhost').searchParams.get('id') || '';
  } catch {
    return '';
  }
}

function noStore(res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
}

export default async function handler(req, res) {
  noStore(res);
  try {
    if (req.method === 'POST') return await createShare(req, res);
    if (req.method === 'GET') return await readShare(req, res);
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Method not allowed' });
  } catch {
    return res.status(500).json({ error: 'Could not hand off the image. Please try again.' });
  }
}

async function createShare(req, res) {
  const image = decodeShareImage(imageField(readBody(req)));
  if (image.error === 'too-large') {
    return res.status(413).json({ error: 'Image is too large. Please share one smaller photo.' });
  }
  if (image.error) {
    return res.status(400).json({ error: 'Invalid image data. Please share the photo again.' });
  }

  const id = randomBytes(16).toString('base64url');
  const record = {
    exp: clock() + SHARE_TTL_SECONDS * 1000,
    mime: image.mime,
    data: image.data,
  };
  const bin = store();
  try {
    await bin.set(id, record, SHARE_TTL_SECONDS);
    const saved = asRecord(await bin.get(id));
    if (!saved || saved.data !== record.data || saved.mime !== record.mime) {
      await bin.del(id);
      return res.status(503).json({ error: 'Share handoff is temporarily unavailable.' });
    }
  } catch {
    return res.status(503).json({ error: 'Share handoff is temporarily unavailable.' });
  }
  return res.status(200).json({ id, expiresIn: SHARE_TTL_SECONDS });
}

async function readShare(req, res) {
  const id = requestId(req);
  if (!ID_RE.test(id)) return res.status(400).json({ error: 'Invalid share link.' });
  const bin = store();
  const record = asRecord(await bin.get(id));
  await bin.del(id);
  if (!record || typeof record.exp !== 'number' || record.exp < clock()) {
    return res.status(404).json({ error: 'This share has expired. Please share the photo again.' });
  }
  if (
    typeof record.data !== 'string' ||
    (record.mime !== 'image/jpeg' && record.mime !== 'image/png' && record.mime !== 'image/webp')
  ) {
    return res.status(404).json({ error: 'This share has expired. Please share the photo again.' });
  }
  return res.status(200).json({ mime: record.mime, data: record.data });
}
