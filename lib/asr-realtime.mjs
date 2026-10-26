import { EventEmitter } from 'node:events';
import WebSocket from 'ws';

const REALTIME_URL = 'wss://api.meta.ai/v1/asr/realtime';

// One streaming Muse Voice Transcribe session in ENDPOINTING mode.
// Feed 16-bit little-endian mono PCM at 24 kHz with write(); listen for:
//   'ready'    { sessionId }
//   'partial'  text           (cumulative hypothesis for the current turn)
//   'turn'     { turnId, text } (post-processed transcript of a finished turn)
//   'error'    Error
//   'close'    { code, reason }
export class RealtimeTranscriber extends EventEmitter {
  #ws;
  #ready = false;
  #pending = [];

  constructor({ keywords, languageBias, sessionId } = {}) {
    super();
    const url = sessionId ? `${REALTIME_URL}?sessionId=${encodeURIComponent(sessionId)}` : REALTIME_URL;
    this.#ws = new WebSocket(url);

    this.#ws.on('open', () => {
      this.#ws.send(
        JSON.stringify({
          authorization: { accessToken: `Bearer ${process.env.MODEL_API_KEY}` },
          audioEncoding: 'PCM_24KHZ',
          model: 'muse-voice-transcribe-1.0',
          mode: 'ENDPOINTING',
          emitAudioProgress: false,
          ...(keywords?.length && { keywords }),
          ...(languageBias?.length && { languageBias }),
        }),
      );
    });

    this.#ws.on('message', (data, isBinary) => {
      if (isBinary) return;
      const event = JSON.parse(data.toString());
      if (!this.#ready && event.sessionId && !event.type) {
        this.#ready = true;
        for (const chunk of this.#pending) this.#ws.send(chunk);
        this.#pending = [];
        this.emit('ready', { sessionId: event.sessionId });
        return;
      }
      switch (event.type) {
        case 'transcript':
          this.emit('partial', event.transcript);
          break;
        case 'speechComplete':
          if (event.transcript?.trim()) this.emit('turn', { turnId: event.turnId, text: event.transcript.trim() });
          break;
        case 'error':
          this.emit('error', new Error(`${event.errorType ?? 'asr'}: ${event.message}`));
          break;
      }
    });

    this.#ws.on('error', (err) => this.emit('error', err));
    this.#ws.on('close', (code, reason) => this.emit('close', { code, reason: reason.toString() }));
  }

  write(pcm) {
    if (this.#ws.readyState !== WebSocket.OPEN) return;
    if (this.#ready) this.#ws.send(pcm);
    else this.#pending.push(pcm);
  }

  end() {
    if (this.#ws.readyState === WebSocket.OPEN) this.#ws.send(JSON.stringify({ type: 'endStream' }));
  }

  close() {
    this.#ws.close();
  }
}
