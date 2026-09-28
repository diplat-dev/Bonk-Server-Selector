# Bonk.io Server Selector

Choose the official Bonk server used for rooms you create, directly from the **Create Game** window. No VPN or system configuration needed.

## Features

- Location map with continent outlines and a server list.
- Saved server preference across visits.
- **Test and choose fastest** to compare connection setup times and select the quickest responding endpoint.
- **Refresh endpoint index** to discover official servers used by public rooms.
- Automatic city/country labels and approximate coordinates for newly discovered endpoints.
- **Bonk automatic** to return to the game's normal server selection.

## How to use

1. Install the script with a userscript manager and reload Bonk.io.
2. Open **Custom Game → Create** and click the server button.
3. Select a location, or use **Test and choose fastest**.
4. If the selection changes, Bonk reloads. Reopen Create Game and create your room.

Your choice is remembered. There is no startup selection screen, and joining someone else's room uses that room's server as usual.

## What to expect

The displayed milliseconds measure WebSocket connection setup, not in-game ping. Results vary with network conditions and do not guarantee better gameplay for everyone in the room.

Location markers are approximate. Failed location lookups leave endpoints listed without a marker. Selecting a server does not change your IP address or the public room-list country flag and distance.

Only official Bonk endpoints are supported. If a server is unavailable, select another or Bonk automatic. Avoid enabling more than one server-selection mod at once.

## Privacy

The script stores preferences and its server catalog locally. Unknown server locations are looked up through Google Public DNS and ipwho.is. These services receive the server hostname/IP and see your request IP; requests omit credentials and referrers. Locations are cached for 30 days to reduce requests.

No external code libraries, custom updater, or privileged userscript permissions are used.
