// This promise has its own deadline because a browser permission prompt can outlive
// getCurrentPosition's timeout. A slow or denied fix must never block the call.
export function locateDevice({ signal, geolocation = navigator.geolocation } = {}) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason);
    if (!geolocation) return reject(new Error('Location is unavailable. Tell the agent the rescue address.'));
    const finish = (fn, value) => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', cancel);
      fn(value);
    };
    const cancel = () => finish(reject, signal.reason);
    const timer = setTimeout(() => finish(reject, new Error('Location timed out. Tell the agent the rescue address.')), 8000);
    signal?.addEventListener('abort', cancel, { once: true });
    try {
      geolocation.getCurrentPosition(
        ({ coords }) => finish(resolve, { lat: coords.latitude, lon: coords.longitude, accuracy: coords.accuracy }),
        (error) => finish(reject, new Error(error.code === 1
          ? 'Location was not shared. Tell the agent the rescue address.'
          : 'Location is unavailable. Tell the agent the rescue address.')),
        { enableHighAccuracy: true, maximumAge: 30000, timeout: 7000 },
      );
    } catch {
      finish(reject, new Error('Location is unavailable. Tell the agent the rescue address.'));
    }
  });
}
