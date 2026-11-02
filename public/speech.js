// One player per call. Cancelling a call stops synthesis, audio and browser fallback.
export class SpeechPlayer {
  #controller = null;

  constructor({ audioContext, provider = 'browser', onFallback = () => {} }) {
    Object.assign(this, { audioContext, provider, onFallback });
  }

  async speak(text, lang) {
    this.cancel();
    const controller = new AbortController();
    this.#controller = controller;
    const { signal } = controller;
    try {
      if (this.provider === 'elevenlabs') {
        try {
          await this.#elevenLabs(text, lang, signal);
          return true;
        } catch (error) {
          signal.throwIfAborted();
          // A bad key, quota limit or provider outage should not delay every reply.
          this.provider = 'browser';
          this.onFallback();
        }
      }
      await this.#browser(text, lang, signal);
      return true;
    } catch (error) {
      if (signal.aborted) return false;
      throw error;
    } finally {
      if (this.#controller === controller) this.#controller = null;
    }
  }

  cancel() {
    this.#controller?.abort();
    this.#controller = null;
  }

  async #elevenLabs(text, lang, signal) {
    const response = await fetch('/api/speech', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, lang }),
      signal: AbortSignal.any([signal, AbortSignal.timeout(25000)]),
    });
    if (!response.ok) throw new Error('Speech generation failed.');
    const bytes = await response.arrayBuffer();
    signal.throwIfAborted();
    const buffer = await this.audioContext.decodeAudioData(bytes);
    signal.throwIfAborted();
    if (this.audioContext.state === 'suspended') await this.audioContext.resume();
    signal.throwIfAborted();
    await new Promise((resolve, reject) => {
      const source = this.audioContext.createBufferSource();
      const finish = () => {
        clearTimeout(stuck);
        signal.removeEventListener('abort', cancel);
        source.onended = null;
        source.disconnect();
      };
      const cancel = () => {
        source.stop();
        finish();
        reject(signal.reason);
      };
      const stuck = setTimeout(() => {
        source.stop();
        finish();
        reject(new Error('Audio playback timed out.'));
      }, buffer.duration * 1000 + 5000);
      source.buffer = buffer;
      source.connect(this.audioContext.destination);
      source.onended = () => { finish(); resolve(); };
      signal.addEventListener('abort', cancel, { once: true });
      try {
        source.start();
      } catch (error) {
        finish();
        reject(error);
      }
    });
  }

  #browser(text, lang, signal) {
    return new Promise((resolve, reject) => {
      if (!globalThis.speechSynthesis) return reject(new Error('Voice playback is unavailable. Please read the reply on screen.'));
      const synthesis = globalThis.speechSynthesis;
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = lang;
      const voices = synthesis.getVoices();
      const voice = voices.find((v) => v.lang === lang) ?? voices.find((v) => v.lang.startsWith(lang.slice(0, 2)));
      if (voice) utterance.voice = voice;
      utterance.rate = 1;
      const finish = () => {
        clearTimeout(stuck);
        signal.removeEventListener('abort', cancel);
        utterance.onend = utterance.onerror = null;
      };
      const cancel = () => {
        finish();
        synthesis.cancel();
        reject(signal.reason);
      };
      // Some browsers never fire onend. Reopen the line rather than leaving it muted.
      const stuck = setTimeout(() => {
        finish();
        synthesis.cancel();
        resolve();
      }, 4000 + text.length * 120);
      utterance.onend = utterance.onerror = () => { finish(); resolve(); };
      signal.addEventListener('abort', cancel, { once: true });
      try {
        synthesis.speak(utterance);
      } catch (error) {
        finish();
        reject(error);
      }
    });
  }
}
