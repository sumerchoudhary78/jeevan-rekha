# Automatic rescue location and case map

The caller page asks the browser for this device's location when a call starts.
The checked **Use my location for this rescue** option makes that the rescue pin.
Calls proceed while location is being acquired; a denied or unanswered permission
prompt never blocks the conversation. A fix is cached for at most 30 seconds and
acquisition stops waiting after eight seconds.

The browser requires HTTPS (or localhost) and location permission. Callers reporting
from somewhere else should turn the option off and tell the agent the rescue address.
The agent also records `rescue_at_device: "no"` if the caller explicitly says the
rescue is elsewhere; that switches the pin back to the reported rescue location.

Coordinates are not a street address. The agent asks for a landmark and verifies
any named place without inventing a village from coordinates. A confirmed known
locality more than 10 km from an accurate device fix uses the reported locality;
a coarse device fix (over 100 m accuracy radius) also yields to a confirmed known
locality. An unconfirmed address remains marked approximate. Device accuracy is
shown on the case, marker popup, and map's selection panel.

An accurate device point plus a landmark can locate a case even outside the demo
gazetteer. Nearby device-based cases can be offered on the case board; joining
still requires the caller's answer. A new caller's device never moves an existing
shared rescue case when the calls join.

## Protocol and storage

On the existing authenticated `/ws/call` connection, the client sends:

```json
{"type":"location","position":{"lat":25.611,"lon":85.14,"accuracy":18}}
```

Numbers must be finite, latitude within ±90, longitude within ±180, and accuracy
between 0 and 100,000 metres. Coordinates are sent in the message body, not URL
parameters. Invalid fixes are rejected and the call can continue with an address.

The session emits a `location` event when the fix arrives. Events associated with
a case include `caseLocation: { lat, lon, source, accuracy }`. Existing case JSON
and SSE snapshots include `locationSource` (`device` or `reported`) and
`locationAccuracy` (metres, null for reported places). The caller's own report
keeps its device fix for provenance. Existing SQLite stores acquire the new
columns on startup, preserving their cases and reports.

## Selecting a case

- A case card, its map marker, or a live call's **Show case on map** button selects
  that exact case. Cards also support Enter and Space.
- The selected card and pin are highlighted. Its popup opens, and a shared device
  fix gets an accuracy circle. Coordinates are plotted as received, without random
  offsets.
- Selection survives queue re-ranking and incoming cases. A late location update
  moves the selected pin; rescued or merged cases are removed from active selection.
- The caller's **View case … on the map** link opens `/control?case=JR-…`, selecting
  the matching case after its snapshot loads.

See the [browser geolocation documentation](https://developer.mozilla.org/en-US/docs/Web/API/Geolocation/getCurrentPosition)
and [Leaflet reference](https://leafletjs.com/reference.html).
