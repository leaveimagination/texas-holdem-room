const scriptedTranscript = [
  {
    speakerDisplayName: "Speaker 1",
    text: "我们希望 FanDo 的入口越简单越好，最好只有一个开始和结束录音的按钮。",
    startMs: 0,
    endMs: 5200,
  },
  {
    speakerDisplayName: "Speaker 2",
    text: "结束录音以后，不需要大家再复制内容，系统自动生成飞书文档。",
    startMs: 5600,
    endMs: 10400,
  },
  {
    speakerDisplayName: "Speaker 3",
    text: "第一版先不做实时回复，重点验证录音、讯飞转写、说话人区分和纪要质量。",
    startMs: 11100,
    endMs: 16600,
  },
  {
    speakerDisplayName: "Speaker 1",
    text: "待办是准备讯飞账号，确认飞书文档权限，然后做一个真实会议的端到端测试。",
    startMs: 17100,
    endMs: 22400,
  },
];

function createInitialSession() {
  return {
    id: "session-demo-001",
    status: "idle",
    buttonLabel: "开始录音",
    startedAtMs: null,
    endedAtMs: null,
    durationMs: 0,
    transcript: [],
    summary: null,
    feishuDoc: null,
  };
}

function toggleRecording(session, nowMs) {
  if (session.status === "idle" || session.status === "completed" || session.status === "failed") {
    return {
      ...createInitialSession(),
      id: session.id,
      status: "recording",
      buttonLabel: "结束录音",
      startedAtMs: nowMs,
      endedAtMs: null,
    };
  }

  if (session.status === "recording") {
    return {
      ...session,
      status: "processing",
      buttonLabel: "正在生成总结...",
      endedAtMs: nowMs,
      durationMs: Math.max(0, nowMs - session.startedAtMs),
    };
  }

  return session;
}

function formatDuration(ms) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function buildMeetingSummary(transcript) {
  const transcriptLines = transcript.map(
    (segment) => `- ${segment.speakerDisplayName}：${segment.text}`,
  );
  const title = "FanDo 一键录音会议纪要";
  const overview =
    "本次讨论将 FanDo 线下会议能力收敛为单按钮录音流程：点击开始录音，再次点击结束录音，系统自动完成转写、说话人区分、总结生成和飞书文档创建。";
  const decisions = [
    "第一版只保留一个主按钮，用于开始录音和结束录音。",
    "结束录音后自动生成飞书文档，不在第一版加入实时语音回复。",
  ];
  const actionItems = [
    "准备讯飞 ASR 大模型和在线语音合成的应用密钥。",
    "确认 FanDo 创建飞书文档所需的授权和默认保存位置。",
    "用一场真实线下会议验证转写、说话人区分和纪要质量。",
  ];
  const risks = [
    "会议室麦克风质量会显著影响转写和说话人区分效果。",
    "飞书文档创建失败时，需要保留本地录音和转写结果以便重试。",
  ];

  const markdown = [
    `# ${title}`,
    "",
    "## 会议摘要",
    overview,
    "",
    "## 关键结论",
    ...decisions.map((item) => `- ${item}`),
    "",
    "## 待办事项",
    ...actionItems.map((item) => `- ${item}`),
    "",
    "## 风险与注意事项",
    ...risks.map((item) => `- ${item}`),
    "",
    "## 原始转写",
    ...transcriptLines,
    "",
  ].join("\n");

  return {
    title,
    overview,
    decisions,
    actionItems,
    risks,
    markdown,
  };
}

function createFeishuDocDraft(summary, sessionId) {
  return {
    title: summary.title,
    url: `https://feishu.cn/docx/demo-${sessionId}`,
    markdown: summary.markdown,
    createdAtLabel: "Demo 模拟创建",
  };
}

function finishProcessing(session, transcript = scriptedTranscript) {
  const summary = buildMeetingSummary(transcript);
  const feishuDoc = createFeishuDocDraft(summary, session.id);

  return {
    ...session,
    status: "completed",
    buttonLabel: "开始新录音",
    transcript,
    summary,
    feishuDoc,
  };
}

const exported = {
  createInitialSession,
  toggleRecording,
  finishProcessing,
  buildMeetingSummary,
  createFeishuDocDraft,
  formatDuration,
  scriptedTranscript,
};

if (typeof module !== "undefined") {
  module.exports = exported;
}

if (typeof window !== "undefined") {
  window.DiscussionCore = exported;
}
