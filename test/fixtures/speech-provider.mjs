// Injected only into the HTTP integration-test child. No real API calls or keys.
globalThis.fetch = async (url, options) => {
  if (new URL(url).origin !== 'https://api.elevenlabs.io') throw new Error('Unexpected outbound request');
  if (options.headers['xi-api-key'] !== 'test-elevenlabs-key') throw new Error('Incorrect test API key');
  const body = JSON.parse(options.body);
  if (body.text === 'provider failure') return new Response('PRIVATE upstream error body', { status: 401 });
  return new Response(`mock audio: ${body.text}`, { headers: { 'Content-Type': 'audio/mpeg' } });
};
