import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const html = readFileSync(new URL('./index.html', import.meta.url), 'utf8');

function shareHelpTag() {
  const tag = html.match(/<details\b[^>]*\bid="shareHelp"[^>]*>/);
  assert.ok(tag, 'share help details element should exist');
  return tag[0];
}

test('visible version is v6.8', () => {
  assert.match(html, /<title>收據 OCR 讀取器 v6\.8<\/title>/);
  assert.match(html, /class="site-ttl">收據 OCR 讀取器 v6\.8</);
  assert.equal(html.includes('v6.7'), false);
});

test('iPhone share tip starts closed and does not remember an open state', () => {
  assert.equal(/\bopen\b/.test(shareHelpTag()), false);
  assert.match(html, /if\(shareHelp\) shareHelp\.open=false;/);
  assert.equal(html.includes('shareHelp.open=true'), false);
  assert.equal(html.includes('shareHelp.open = true'), false);
  assert.equal(html.includes('localStorage'), false);
  assert.equal(html.includes('receiptOcrShareHint'), false);
  assert.match(html, /id="hideShareBtn"/);
  assert.match(html, /取得 URL 內容/);
  assert.match(html, /location\.origin\+'\/api\/share'/);
});

test('copy buttons drive the preview and the markdown toggle is gone', () => {
  assert.equal(html.includes('id="mdBtn"'), false);
  assert.equal(html.includes('Markdown 預覽'), false);
  assert.equal(html.includes('顯示原文'), false);
  assert.match(html, /id="cpBtn"/);
  assert.match(html, /id="mdCopyBtn"/);
  assert.match(html, /id="ocrTa"/);
  assert.match(html, /id="mdPreview"/);
  assert.match(html, /再揀一張/);
  assert.match(html, /再影一張/);
  assert.match(
    html,
    /cpBtn\.addEventListener\('click', function\(\)\{\s*setMdPreview\(false\);\s*copyText\(ocrTa\.value, cpBtn, '✅ 已複製'\);\s*\}\);/
  );
  assert.match(
    html,
    /mdCopyBtn\.addEventListener\('click', function\(\)\{\s*setMdPreview\(true\);\s*copyText\(toMarkdown\(ocrTa\.value\), mdCopyBtn, '✅ 已複製'\);\s*\}\);/
  );
  assert.match(html, /function showRes\(text, lang, engine\)\{[\s\S]*?ocrTa\.value=text;[\s\S]*?setMdPreview\(false\);/);
  assert.match(html, /識別完成後可以「複製全文」或者「複製 Markdown」/);
  assert.equal(html.includes('切換 Markdown 預覽'), false);
});

test('store, date, time, and payment chips are not extracted or rendered', () => {
  for (const name of ['extractMeta', 'findStore', 'extractDate', 'findPayment', 'renderMeta', 'metaBox', 'meta-chip', 'meta-box']) {
    assert.equal(html.includes(name), false, name);
  }
  for (const label of ['店名', '付款方式', '只保留較簡單的快速資料']) {
    assert.equal(html.includes(label), false, label);
  }
  assert.match(html, /ocrTa\.value=text;/);
});

test('default theme is still light', () => {
  assert.match(html, /setTheme\('light'\)/);
  assert.equal(html.includes("setTheme('dark')"), false);
  assert.match(html, /id="themeBtn"/);
});
