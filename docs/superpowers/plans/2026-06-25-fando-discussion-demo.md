# FanDo Discussion Demo Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a local browser demo that demonstrates FanDo Discussion Mode without requiring live Xunfei credentials.

**Architecture:** The demo is a static web app with a small tested JavaScript core. The core simulates streaming ASR speaker segments, detects explicit FanDo wake phrases, filters echo candidates during TTS playback windows, and produces a meeting summary. The UI presents the full user flow: start listening, speaker transcript, FanDo thinking, waiting for pause, automatic voice playback, and end-of-meeting summary.

**Tech Stack:** Plain HTML/CSS/JavaScript, Node.js built-in test runner, browser SpeechSynthesis when available, no external dependencies.

## Global Constraints

- The demo must run locally without API keys.
- The demo must clearly indicate that ASR/diarization is simulated.
- The code must separate core behavior from UI rendering.
- The UI must demonstrate the approved first-version behavior: offline meeting room, speaker separation, explicit FanDo address, automatic TTS after a pause, echo filtering, and meeting summary.
- No raw audio is recorded or uploaded in the demo.

---

### Task 1: Core Discussion Logic

**Files:**
- Create: `demo/discussion-core.js`
- Create: `demo/discussion-core.test.js`

**Interfaces:**
- Produces: `normalizeSpeakerId(roleLabel)`, `shouldTriggerFanDo(text)`, `isEchoCandidate(segment, playbackWindows)`, `buildSummary(segments, replies)`, `scriptedSegments`
- Consumes: none

- [ ] **Step 1: Write the failing tests**

```javascript
const assert = require("node:assert/strict");
const test = require("node:test");
const {
  normalizeSpeakerId,
  shouldTriggerFanDo,
  isEchoCandidate,
  buildSummary,
} = require("./discussion-core.js");

test("normalizes numeric role labels to stable speaker ids", () => {
  assert.equal(normalizeSpeakerId(1), "speaker-1");
  assert.equal(normalizeSpeakerId("2"), "speaker-2");
  assert.equal(normalizeSpeakerId(0), "speaker-unknown");
});

test("triggers only when FanDo is directly addressed with a request", () => {
  assert.equal(shouldTriggerFanDo("FanDo，你怎么看？"), true);
  assert.equal(shouldTriggerFanDo("饭豆，帮我们总结一下"), true);
  assert.equal(shouldTriggerFanDo("我们之后可以问 FanDo"), false);
  assert.equal(shouldTriggerFanDo("这个方案你怎么看"), false);
});

test("marks transcript segments inside TTS playback windows as echo candidates", () => {
  const segment = { startMs: 4200, endMs: 5200 };
  const windows = [{ startMs: 4000, endMs: 6000 }];
  assert.equal(isEchoCandidate(segment, windows), true);
  assert.equal(isEchoCandidate({ startMs: 6200, endMs: 7000 }, windows), false);
});

test("builds meeting summary from participant segments and FanDo replies", () => {
  const summary = buildSummary(
    [
      { speakerDisplayName: "Speaker 1", text: "我们先做一个 MVP。", source: "participant" },
      { speakerDisplayName: "Speaker 2", text: "重点验证讯飞角色盲分。", source: "participant" },
    ],
    [{ text: "建议先验证 ASR、TTS 和回声过滤。" }]
  );

  assert.match(summary.overview, /MVP/);
  assert.equal(summary.decisions.length, 1);
  assert.equal(summary.actionItems.length, 2);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test demo/discussion-core.test.js`
Expected: FAIL because `discussion-core.js` does not exist.

- [ ] **Step 3: Implement the core**

Create `demo/discussion-core.js` with the exported functions and scripted demo segments.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test demo/discussion-core.test.js`
Expected: PASS.

### Task 2: Browser Demo UI

**Files:**
- Create: `demo/index.html`
- Create: `demo/styles.css`
- Create: `demo/app.js`

**Interfaces:**
- Consumes: `scriptedSegments`, `shouldTriggerFanDo`, `isEchoCandidate`, `buildSummary`
- Produces: Local demo page at `demo/index.html`

- [ ] **Step 1: Add the page skeleton**

Create a static HTML shell with the transcript panel, controls, FanDo status, and summary panel.

- [ ] **Step 2: Add styling**

Create responsive CSS for a work-focused dashboard interface.

- [ ] **Step 3: Add UI behavior**

Use scripted segments to animate the meeting, trigger FanDo on explicit address, speak via browser TTS when available, filter echo candidates, and show a summary.

- [ ] **Step 4: Verify manually**

Open the page locally or through a dev server. Confirm start, pause, FanDo response, TTS, and summary flow.

### Task 3: Local Server And Smoke Check

**Files:**
- No new files.

**Interfaces:**
- Consumes: `demo/index.html`
- Produces: local URL for review

- [ ] **Step 1: Start a static server**

Run: `python -m http.server 4173 -d demo`
Expected: server available at `http://127.0.0.1:4173/`.

- [ ] **Step 2: Smoke test**

Use a browser or HTTP request to verify `index.html`, `app.js`, and `styles.css` load successfully.
