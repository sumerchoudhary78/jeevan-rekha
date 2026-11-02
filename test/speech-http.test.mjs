import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { request } from 'node:http';
import { test } from 'node:test';

async function startServer(t, key = 'test-elevenlabs-key') {
  const child = spawn(process.execPath, ['--import', './test/fixtures/speech-provider.mjs', 'server/index.mjs'], {
    cwd: new URL('..', import.meta.url),
    env: { ...process.env, PORT: '0', STORE_PATH: ':memory:', MODEL_API_KEY: 'test-meta-key',
      DEMO_PASSCODE: 'test-access', ELEVENLABS_API_KEY: key },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  t.after(async () => {
    if (child.exitCode === null) { child.kill(); await once(child, 'exit'); }
  });
  return new Promise((resolve, reject) => {
    let output = '';
    const timer = setTimeout(() => reject(new Error('Test server failed to start')), 5000);
    child.on('error', reject);
    child.on('exit', () => { clearTimeout(timer); reject(new Error(`Test server exited: ${output}`)); });
    child.stdout.on('data', (chunk) => {
      output += chunk;
      const match = output.match(/http:\/\/localhost:(\d+)/);
      if (match) { clearTimeout(timer); resolve(`http://127.0.0.1:${match[1]}`); }
    });
  });
}

const headers = { Cookie: 'jr_access=test-access', 'Content-Type': 'application/json' };
const speech = (base, body) => fetch(`${base}/api/speech`, { method: 'POST', headers, body: JSON.stringify(body) });

test('speech HTTP route preserves access control, validates inputs and returns safe audio', async (t) => {
  const base = await startServer(t);
  const denied = await fetch(`${base}/api/speech`, { method: 'POST', body: '{}' });
  assert.equal(denied.status, 401);
  const config = await fetch(`${base}/api/config`, { headers }).then((r) => r.json());
  assert.equal(config.speech.provider, 'elevenlabs');
  assert.ok(!JSON.stringify(config).includes('test-elevenlabs-key'));

  const response = await speech(base, { text: 'हम तीस लोग हैं।', lang: 'hi-IN' });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-type'), 'audio/mpeg');
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(await response.text(), 'mock audio: हम तीस लोग हैं।');

  for (const body of [null, {}, { text: 'x'.repeat(2001), lang: 'en-IN' }, { text: 'Hello', lang: 'xx' }]) {
    const invalid = await speech(base, body);
    assert.equal(invalid.status, 400);
  }
  const malformed = await fetch(`${base}/api/speech`, { method: 'POST', headers, body: '{' });
  assert.equal(malformed.status, 400);
  const oversized = await speech(base, { text: 'x'.repeat(17 * 1024), lang: 'en-IN' });
  assert.equal(oversized.status, 413);

  const failed = await speech(base, { text: 'provider failure', lang: 'en-IN' });
  assert.equal(failed.status, 502);
  assert.equal((await failed.text()).includes('PRIVATE'), false);
});

test('speech HTTP parser preserves Indian-script text split inside a UTF-8 character', async (t) => {
  const base = await startServer(t);
  const body = Buffer.from(JSON.stringify({ text: 'हम तीस लोग हैं।', lang: 'hi-IN' }));
  const splitAt = body.indexOf(Buffer.from('ह')) + 1;
  const result = await new Promise((resolve, reject) => {
    const req = request(`${base}/api/speech`, { method: 'POST', headers }, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => resolve({ status: response.statusCode, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject);
    req.write(body.subarray(0, splitAt));
    setImmediate(() => req.end(body.subarray(splitAt)));
  });
  assert.equal(result.status, 200);
  assert.equal(result.body, 'mock audio: हम तीस लोग हैं।');
});

test('missing ElevenLabs key advertises device voice and fails the paid route safely', async (t) => {
  const base = await startServer(t, '');
  const config = await fetch(`${base}/api/config`, { headers }).then((r) => r.json());
  assert.equal(config.speech.provider, 'browser');
  const response = await speech(base, { text: 'Hello', lang: 'en-IN' });
  assert.equal(response.status, 503);
});
