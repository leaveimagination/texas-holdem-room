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
  '3. Try starting from Bob and confirm the non-owner action is rejected.',
  '4. Start the game from Alice, the owner.',
  '5. Confirm each tab sees only its own hand while the opponent hand is hidden.',
  '6. Ask a visible question card and confirm the turn passes.',
  '7. Submit one incorrect complete guess and confirm hands remain hidden while the turn passes.',
  '8. In fixture mode, Bob can finish by guessing Alice: 0 red, 2 red, 2 blue, 7 red, 9 blue.',
  '9. Confirm both hands reveal only after the game is finished.',
  '10. Refresh a tab and confirm reconnect restores the same seat.',
  '',
  'Expected limitations:',
  '- Rooms are in memory and disappear on process restart.',
  '- Version 1 is for friendly games and has no accounts, moderation, or shuffle proof.'
];

console.log(checklist.join('\n'));
