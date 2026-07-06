#!/usr/bin/env node

const checklist = [
  '# Logic Duel Online Manual Verification',
  '',
  'Install and start:',
  '1. npm install',
  '2. LOGIC_DUEL_ENABLE_FIXTURES=1 npm start',
  '3. Open http://localhost:3000 in two browser tabs.',
  '',
  'Operations checks:',
  '- GET /healthz returns HTTP 200 with status ok, version, uptimeSeconds, activeRooms, activeConnections, and expiredRoomsCleaned.',
  '- WebSocket connects on /ws using the same host as the page.',
  '- Server logs must not print reconnect tokens or full hands by default.',
  '',
  'Gameplay checks:',
  '1. In tab A, create a room as Alice and note the room code.',
  '2. In tab B, join the room as Bob.',
  '3. Start the game from Alice, the owner.',
  '4. Confirm each tab sees only its own hand while the opponent hand is hidden.',
  '5. Ask a visible question card and confirm the turn passes.',
  '6. In fixture mode, Bob can finish by guessing Alice: 0 red, 2 red, 2 blue, 7 red, 9 blue.',
  '7. Confirm both hands reveal only after the game is finished.',
  '8. Refresh a tab and confirm reconnect restores the same seat.',
  '',
  'Expected limitations:',
  '- Rooms are in memory and disappear on process restart.',
  '- Version 1 is for friendly games and has no accounts, moderation, or shuffle proof.'
];

console.log(checklist.join('\n'));
