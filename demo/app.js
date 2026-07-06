(() => {
const core = window.DiscussionCore;
const recordButton = document.querySelector("#recordButton");
const stateDot = document.querySelector("#stateDot");
const stateLabel = document.querySelector("#stateLabel");
const durationLabel = document.querySelector("#durationLabel");
const meter = document.querySelector("#meter");
const steps = document.querySelector("#steps");
const docResult = document.querySelector("#docResult");
const summaryResult = document.querySelector("#summaryResult");

let session = core.createInitialSession();
let timer = null;
let processingTimers = [];

function setStep(stepName, status) {
  const item = steps.querySelector(`[data-step="${stepName}"]`);
  if (!item) return;
  item.dataset.status = status;
}

function resetSteps() {
  ["record", "asr", "summary", "feishu"].forEach((step) => {
    setStep(step, "pending");
  });
}

function renderSession() {
  recordButton.textContent = session.buttonLabel;
  recordButton.disabled = session.status === "processing";
  stateDot.dataset.status = session.status;
  meter.dataset.status = session.status;

  const labels = {
    idle: "未开始",
    recording: "正在录音",
    processing: "正在处理",
    completed: "已完成",
    failed: "处理失败",
  };
  stateLabel.textContent = labels[session.status] || session.status;
  durationLabel.textContent = core.formatDuration(session.durationMs || 0);
}

function startDurationTimer() {
  clearInterval(timer);
  timer = setInterval(() => {
    if (session.status !== "recording") return;
    session = {
      ...session,
      durationMs: Date.now() - session.startedAtMs,
    };
    renderSession();
  }, 250);
}

function clearProcessingTimers() {
  processingTimers.forEach((item) => clearTimeout(item));
  processingTimers = [];
}

function renderResults() {
  docResult.innerHTML = `
    <a class="doc-link" href="${session.feishuDoc.url}" target="_blank" rel="noreferrer">
      打开飞书文档
    </a>
    <p class="muted">${session.feishuDoc.title} · ${session.feishuDoc.createdAtLabel}</p>
  `;

  summaryResult.innerHTML = `
    <p>${session.summary.overview}</p>
    <h3>关键结论</h3>
    <ul>${session.summary.decisions.map((item) => `<li>${item}</li>`).join("")}</ul>
    <h3>待办事项</h3>
    <ul>${session.summary.actionItems.map((item) => `<li>${item}</li>`).join("")}</ul>
  `;
}

function simulateProcessing() {
  clearProcessingTimers();
  setStep("record", "done");
  setStep("asr", "active");

  processingTimers.push(setTimeout(() => {
    setStep("asr", "done");
    setStep("summary", "active");
  }, 900));

  processingTimers.push(setTimeout(() => {
    setStep("summary", "done");
    setStep("feishu", "active");
  }, 1800));

  processingTimers.push(setTimeout(() => {
    setStep("feishu", "done");
    session = core.finishProcessing(session, core.scriptedTranscript);
    renderSession();
    renderResults();
  }, 2800));
}

function handleRecordButton() {
  if (session.status === "completed" || session.status === "failed") {
    session = core.createInitialSession();
    docResult.textContent = "录音结束后自动创建。";
    docResult.className = "placeholder";
    summaryResult.textContent = "等待会议纪要生成。";
    summaryResult.className = "placeholder";
    resetSteps();
    renderSession();
    return;
  }

  session = core.toggleRecording(session, Date.now());

  if (session.status === "recording") {
    resetSteps();
    setStep("record", "active");
    docResult.textContent = "录音结束后自动创建。";
    summaryResult.textContent = "录音中，结束后自动生成总结。";
    startDurationTimer();
  }

  if (session.status === "processing") {
    clearInterval(timer);
    simulateProcessing();
  }

  renderSession();
}

resetSteps();
renderSession();
recordButton.addEventListener("click", handleRecordButton);
})();
