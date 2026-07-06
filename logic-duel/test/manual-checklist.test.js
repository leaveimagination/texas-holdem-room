const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');

test('manual checklist prints fixture and operations verification steps', () => {
  const result = spawnSync(process.execPath, [path.join('scripts', 'manual-checklist.js')], {
    cwd: path.join(__dirname, '..'),
    encoding: 'utf8'
  });

  assert.equal(result.status, 0);
  assert.match(result.stdout, /\/healthz/);
  assert.match(result.stdout, /\/ws/);
  assert.match(result.stdout, /LOGIC_DUEL_ENABLE_FIXTURES=1/);
  assert.match(result.stdout, /0 red, 2 red, 2 blue, 7 red, 9 blue/);
});
