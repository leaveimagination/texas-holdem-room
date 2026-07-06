const assert = require("node:assert/strict");
const test = require("node:test");
const {
  createInitialSession,
  toggleRecording,
  finishProcessing,
  buildMeetingSummary,
  createFeishuDocDraft,
  scriptedTranscript,
} = require("./discussion-core.js");

test("single action button starts and stops recording", () => {
  const idle = createInitialSession();
  const recording = toggleRecording(idle, 1000);
  const processing = toggleRecording(recording, 91000);

  assert.equal(idle.status, "idle");
  assert.equal(recording.status, "recording");
  assert.equal(recording.buttonLabel, "结束录音");
  assert.equal(processing.status, "processing");
  assert.equal(processing.durationMs, 90000);
  assert.equal(processing.buttonLabel, "正在生成总结...");
});

test("builds a structured meeting summary from transcript segments", () => {
  const summary = buildMeetingSummary(scriptedTranscript);

  assert.match(summary.title, /FanDo/);
  assert.equal(summary.decisions.length, 2);
  assert.equal(summary.actionItems.length, 3);
  assert.match(summary.markdown, /关键结论/);
  assert.match(summary.markdown, /原始转写/);
});

test("creates a Feishu document draft with stable link and markdown body", () => {
  const summary = buildMeetingSummary(scriptedTranscript);
  const doc = createFeishuDocDraft(summary, "session-demo-001");

  assert.equal(doc.title, summary.title);
  assert.match(doc.url, /^https:\/\/feishu\.cn\/docx\/demo-session-demo-001$/);
  assert.match(doc.markdown, /# FanDo/);
  assert.match(doc.markdown, /待办事项/);
});

test("finishProcessing creates a completed session with Feishu document", () => {
  const processing = toggleRecording(toggleRecording(createInitialSession(), 0), 65000);
  const completed = finishProcessing(processing, scriptedTranscript);

  assert.equal(completed.status, "completed");
  assert.equal(completed.buttonLabel, "开始新录音");
  assert.match(completed.feishuDoc.url, /feishu\.cn\/docx/);
  assert.equal(completed.summary.actionItems.length, 3);
});
