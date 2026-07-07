const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('guess select controls are disabled when the player cannot act', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');

  assert.match(source, /const disabled = !canAct\(\);/);
  assert.match(source, /guessTile\(index, disabled\)/);
  assert.match(source, /numberSelect\(`number-\$\{index\}`, disabled\)/);
  assert.match(source, /colorSelect\(`color-\$\{index\}`, disabled\)/);
  assert.match(source, /el\('select', \{ name, 'aria-label': name, disabled \}/);
});
