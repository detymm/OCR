export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const apiKey = process.env.OCR_SPACE_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'Server OCR key is not configured.' });
  }

  const body = req.body || {};
  const image = body.image;
  const language = ['cht', 'chs', 'eng', 'jpn', 'auto'].includes(body.language) ? body.language : 'cht';
  const engine = ['1', '3', '5'].includes(String(body.engine)) ? String(body.engine) : '3';

  // Only accept a compressed image data URL, not arbitrary remote URLs.
  if (typeof image !== 'string' || !/^data:image\/(jpeg|jpg|png|webp);base64,[A-Za-z0-9+/=]+$/i.test(image)) {
    return res.status(400).json({ error: 'Invalid image data. Please choose the image again.' });
  }
  if (image.length > 650000) {
    return res.status(413).json({ error: 'Image is too large. Please use a smaller image.' });
  }

  try {
    const form = new FormData();
    form.append('apikey', apiKey);
    form.append('base64Image', image);
    form.append('language', engine === '3' ? 'auto' : language);
    form.append('isOverlayRequired', 'false');
    form.append('detectOrientation', 'true');
    form.append('scale', 'true');
    form.append('OCREngine', engine);

    const upstream = await fetch('https://api.ocr.space/parse/image', {
      method: 'POST',
      body: form,
      signal: AbortSignal.timeout(55000),
    });
    const data = await upstream.json();
    // Do not return or log the secret key.
    return res.status(upstream.ok ? 200 : upstream.status).json(data);
  } catch (err) {
    const timedOut = err && (err.name === 'TimeoutError' || err.name === 'AbortError');
    return res.status(timedOut ? 504 : 502).json({
      error: timedOut ? 'OCR service timed out. Please retry.' : 'Could not reach OCR service. Please retry.',
    });
  }
}
