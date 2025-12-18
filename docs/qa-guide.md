osu!dojo Manual QA Guide

This guide covers features that cannot be easily verified by automated tests, such as OBS visualization, real-time WebSocket data, and actual Bancho connectivity.

1. Prerequisites

- Local Tosu Client: You need the tosu memory reader running locally.
- osu! Client: Logged in to a client connected to Bancho (or private server).
- OBS Studio: With a Browser Source pointed to the overlay.

2. Testing the Overlay (Visuals)

Goal: Verify the health bars move and the pass notification triggers.

- Start a Mock Attempt (Dev Mode):
  - Run: `npm run bot` (ensure you are using the mock bot or real bot).
  - Command: `!dojo start <dan_id>`.

- Connect Overlay:
  - URL: `http://localhost:3000/overlay/<attempt_id>?ip=localhost`
  - Action: Verify "tosu ✓" appears in top left.

- Play a Map:
  - Open osu! and play the specific map ID required by the attempt.
  - Check: Does the "YOU" bar move in sync with your score?
  - Check: Does the "RIVAL" bar appear?
  - Check: Upon passing the map, does the "PASS DETECTED - Press F2" alert appear?

3. Testing Bancho Connectivity (Real Bot)

Goal: Verify the bot can manage a real lobby.

- Config: Ensure `.env` has valid `OSU_IRC_USERNAME` and `OSU_IRC_PASSWORD`.
- Start: Run `npm run bot`.
- Invite: Send `!dojo start 1` to the bot via osu! chat.

- Lobby Flow:
  - Invite: Did you receive an invite?
  - Host: Are you the host?
  - Map: Is the correct map selected?
  - Fail: Fail the map on purpose. Does the bot detect it and fail the attempt?
  - Retry: Start again, pass the map. Does the bot detect the score and rotate to the next map?

4. Testing Crash Recovery (Chaos Monkey)

Goal: Verify the bot resumes a lobby after the process dies.

- Start a real lobby as above.
- While playing a long map (e.g., 2 minutes in), kill the bot terminal (Ctrl+C).
- Finish the map in osu!.
- Restart the bot: `npm run bot`.

Verify:

- Bot logs should say: `[Recovery] Found 1 zombie lobby`.
- Bot should rejoin your lobby: `[Recovery] Rejoined lobby...`.
- Bot should fetch match history from osu! API and detect you finished the map.
- Bot should rotate to the next map.
