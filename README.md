# Bonk.io Server Selector

Version 1.0.0 · Standalone userscript · MIT license
Greasyfork Link: https://greasyfork.org/en/scripts/597834-bonk-io-server-selector

Choose the official Bonk server used for rooms you create. Includes a map with continent outlines, saved preferences, connection testing, and automatic location lookup for discovered endpoints.

## Install and use

1. Create a new script in Tampermonkey or Violentmonkey, paste in `BonkServerSelector.user.js`, and save.
2. Reload Bonk.io and open **Custom Game → Create → Server: Automatic**.
3. Choose a map marker or server name. Changing the selection saves it and reloads Bonk.
4. Reopen Create Game and create your room. Your choice remains saved for later visits.

Bonk opens normally without a startup screen. Selecting the already-active server does not reload.

| Control | What it does |
| --- | --- |
| Map marker or server row | Selects that endpoint and reloads if changed. |
| Test and choose fastest | Measures WebSocket connection setup time and selects the quickest responding endpoint. A changed selection reloads. |
| Refresh endpoint index | Samples public rooms for additional official endpoints and looks up unknown locations. |
| Bonk automatic | Restores Bonk's normal server allocation, reloading if changed. |

## Scope and limitations

- Only official `b2*.bonk.io` endpoints are selectable. Existing-room joins retain their original destinations.
- Measurements are connection estimates, not in-game ping. The quickest endpoint for you may not be best for other players.
- City coordinates are approximate. IP geolocation can be inaccurate; unavailable locations stay listed without a map marker.
- Choosing a server does not change your IP, public room-list country flag, or distance.
- If an endpoint is unavailable, choose another or Bonk automatic. Avoid running multiple server-selection mods together.
- Preferences and the endpoint catalog use local browser storage. Clearing site data removes them.

## Network requests and privacy

Discovery uses Bonk's public room-list/address APIs. Connection tests contact official Bonk endpoints.

Unknown endpoint locations use Google Public DNS to resolve the server hostname, followed by ipwho.is for that server IP's city, country, and coordinates. These services receive the server hostname/IP and see your request IP. Lookup requests omit credentials and referrers.

Successful locations are cached for 30 days; failed attempts become eligible for retry after one hour, on rediscovery or reload.

The script has no external code dependencies, custom updater, or privileged userscript grants.

## Implementation

The userscript runs at `document-start` in Bonk's game iframe. It changes only the `createserver` field in the room-list response before Bonk reads it. The selection stays fixed for that page load; changing it triggers a full reload.
