# FanDo 讯飞 ASR + TTS 完整链路调研

日期：2026-06-25

## 结论摘要

如果 FanDo 第一版倾向使用讯飞方案，推荐链路是：

1. FanDo/Electron 采集电脑麦克风音频。
2. 音频预处理成 16k、16bit、单声道 PCM，或编码成讯飞推荐的 Opus。
3. 通过讯飞“实时语音转写大模型” WebSocket 上传音频流。
4. 请求参数开启 `role_type=2`，使用实时角色分离的盲分模式。
5. FanDo 解析讯飞返回的词、时间戳和角色标识，映射成 `Speaker 1`、`Speaker 2`。
6. 本地检测“FanDo，你怎么看？”等点名句。
7. 命中后把最近 3 到 5 分钟转写上下文交给 FanDo agent。
8. agent 生成文本回复。
9. 将回复文本一次性提交给讯飞在线语音合成 WebSocket。
10. FanDo 边接收讯飞返回的 base64 音频片段，边播放。
11. 播放期间记录 TTS 时间区间，过滤麦克风里录到的 FanDo 自己声音。

这条链路可以覆盖当前目标：线下会议室电脑麦克风收音、实时转写、区分不同说话人、点名 FanDo 后自动语音播报。

## 讯飞 ASR：实时语音转写大模型

### 为什么不是标准版

讯飞实时语音转写有标准版和大模型版。标准版可以做实时语音转文字，但本功能需要“说话人区分”。讯飞大模型版文档明确包含角色分离能力，其中 `role_type=2` 可以开启实时角色分离的盲分模式。

因此 FanDo 讨论模式应优先接“实时语音转写大模型”，而不是标准版。

### 接口基础

讯飞实时语音转写大模型使用 WebSocket：

- 请求协议：`wss`
- 请求地址：`wss://office-api-ast-dx.iflyaisol.com/ast/communicate/v1?{请求参数}`
- 鉴权方式：签名机制
- 响应格式：JSON
- 音频属性：16k、16bit、单声道
- PCM 音频格式：`pcm_s16le`
- 数据发送建议：每 40ms 发送 1280 字节
- 语言能力：中英 + 202 种方言混合识别；37 种语种免切需要单独付费/人工对接

### ASR 请求关键参数

FanDo 第一版建议参数：

```text
appId=<讯飞应用 ID>
accessKeyId=<讯飞应用 Key>
uuid=<FanDo 会议 session id 或用户 id>
utc=<当前时间，按讯飞要求格式>
lang=autodialect
audio_encode=pcm_s16le
samplerate=16000
role_type=2
pd=com 或 tech
eng_vad_mdn=1
signature=<按讯飞规则生成>
```

说明：

- `lang=autodialect`：适合中文会议，支持中英和大量方言免切。
- `role_type=2`：开启实时角色分离盲分模式。
- `feature_ids` 暂不传：因为我们第一版不做实名声纹识别。
- `pd` 可按场景选择。企业内部讨论可先用 `com`，技术讨论可试 `tech`。
- `eng_vad_mdn`：文档中 1 表示远场，2 表示近场。线下会议室电脑麦克风更接近远场，第一版先用 1。

### 签名

讯飞大模型 ASR 的签名规则：

1. 将所有请求参数按参数名升序排序，不包含 `signature`。
2. 对每个 key 和 value 做 URL 编码。
3. 拼成 `key=value&key=value` 的 baseString。
4. 用 `accessKeySecret` 对 baseString 做 HmacSHA1。
5. 将结果做 Base64 编码，作为 `signature`。

FanDo 中不应把密钥暴露到前端渲染进程。建议在主进程或本地 Gateway 侧完成签名和 WebSocket 连接。

### 音频上传

握手成功后，FanDo 持续发送 binary message，内容为音频二进制数据。若使用 PCM：

- 采样率：16000 Hz
- 采样位深：16 bit
- 声道：mono
- 每帧：40ms / 1280 字节

如果 Electron 采集到的是 48k stereo float，需要在本地做：

- 重采样到 16k。
- 双声道混单声道。
- float 转 int16 PCM。
- 分帧节流，避免发送过快。

停止会议时发送结束标识：

```json
{"end": true, "sessionId": "当前会议 session id"}
```

### ASR 返回解析

讯飞返回 JSON。结果字段重点：

- `msg_type=result`
- `res_type=asr`
- `data.seg_id`：消息号
- `data.cn.st.bg`：句子开始时间
- `data.cn.st.ed`：句子结束时间
- `data.cn.st.type`：`0` 确定性结果，`1` 中间结果
- `data.cn.st.rt.ws.cw.w`：词文本
- `data.cn.st.rt.ws.cw.wp`：词类型，普通词、标点等
- `data.cn.st.rt.ws.cw.wb`：词开始时间
- `data.cn.st.rt.ws.cw.we`：词结束时间
- `data.cn.st.rt.ws.cw.rl`：角色分离标识
- `data.ls`：是否最后一帧

角色分离字段 `rl` 的规则：

- 只有开启角色分离后出现。
- `rl=1/2/3...` 表示切换到对应说话人。
- `rl=0` 表示继续上一位说话人。

FanDo 需要维护一个当前 speaker 状态：

```text
currentSpeaker = Speaker 1
如果词上出现 rl=2，则 currentSpeaker = Speaker 2
如果词上 rl=0，则沿用 currentSpeaker
```

最终构造成 FanDo 内部 transcript segment：

```json
{
  "speakerId": "speaker-2",
  "speakerDisplayName": "Speaker 2",
  "text": "我觉得这个方案可以先做 MVP。",
  "startMs": 12340,
  "endMs": 15880,
  "isPartial": false,
  "source": "participant"
}
```

### ASR 错误处理

需要重点处理：

- 鉴权失败：检查 appId、accessKeyId、signature。
- 用量不足：提示配置额度。
- 并发路数满：提示稍后重试或联系管理员。
- 时间戳偏差过大：校准本机时间。
- 音频发送超速：严格按 40ms 节奏发送。
- 长时间未传音频：会议暂停时要么保持心跳策略，要么关闭当前连接，恢复时重连。
- 单次转写音频时长上限：文档错误码中提到 8 小时上限，超长会议需要自动滚动 session。

## 讯飞 TTS：在线语音合成 WebSocket

### 接口基础

讯飞在线语音合成使用 WebSocket：

- 请求协议：`wss`
- 请求地址：`wss://tts-api.xfyun.cn/v2/tts`
- 鉴权：支持 APIPassword，或 APPID + APIKey + APISecret 签名。
- 响应格式：JSON
- 音频属性：16k 或 8k
- 音频格式：pcm、mp3、speex、speex-wb、opus
- 文本长度：单次调用小于 8000 字节，约 2000 汉字
- 返回音频：base64 编码片段

注意：讯飞在线语音合成是“音频流式返回”，但文档说明文本只能一次性传输，不支持多次分段传输。因此 FanDo 不能把 LLM token 逐字流式喂给这个 TTS。推荐等 agent 回复完成，或至少等一句完整回复生成后，再提交给 TTS。

### TTS 鉴权

推荐第一版使用方式一：APIPassword。

理由：

- 接入简单。
- 不需要每次构造 HMAC 签名。
- FanDo 本地 Gateway 可通过请求头 `x-api-key` 传入 APIPassword。

如果统一走 APPID/APIKey/APISecret，也可以使用方式二：HmacSHA256 生成 authorization、date、host 参数。

### TTS 请求体

推荐第一版使用：

```json
{
  "common": {
    "app_id": "<AppID>"
  },
  "business": {
    "aue": "lame",
    "vcn": "xiaoyan",
    "speed": 50,
    "pitch": 50,
    "volume": 50
  },
  "data": {
    "status": 2,
    "text": "<base64 后的回复文本>"
  }
}
```

字段说明：

- `aue`：音频编码。第一版建议用 `lame`/mp3，播放链路简单；如果追求低延迟可评估 `raw` PCM。
- `vcn`：发音人。第一版可先用基础发音人，例如 `xiaoyan`。
- `speed`：语速。会议自动播报建议略快但清晰，先用 50。
- `pitch`：音高，先用默认 50。
- `volume`：音量，先用默认 50。
- `text`：base64 编码后的回复文本。
- `status`：文档要求固定为 2。

### TTS 返回解析

返回 JSON：

- `code=0` 表示成功。
- `data.audio`：base64 编码音频片段。
- `data.status=1`：合成中。
- `data.status=2`：合成结束。
- `sid`：会话 id。

FanDo 播放策略：

1. 接收每个 `data.audio`。
2. base64 解码成音频 bytes。
3. 推入播放缓冲。
4. 首包到达后即可开始播放。
5. `status=2` 后关闭 TTS 会话。

### TTS 错误处理

重点处理：

- `10005`：appid 授权失败。
- `10006`：缺失必要参数。
- `10007`：参数值无效。
- `10109`：文本长度超出限制。
- `10160`：请求 JSON 非法。
- `10161`：base64 解码失败。
- `11200`：功能未授权或授权到期。
- `11202`：QPS 超限。
- `11203`：并发超限。
- `10200`：读取数据超时。

当 TTS 失败时，FanDo 应降级为屏幕文字回复，不应阻塞继续监听。

## FanDo 端到端链路

### 运行时组件

建议新增一个 `DiscussionVoiceSession`，内部包含：

- `MicCapture`：麦克风采集。
- `AudioResampler`：重采样与分帧。
- `IflytekAsrClient`：讯飞 ASR WebSocket。
- `TranscriptAssembler`：将词级结果组装成 speaker segment。
- `WakePhraseDetector`：点名检测。
- `AgentResponder`：调用 FanDo agent。
- `IflytekTtsClient`：讯飞 TTS WebSocket。
- `PlaybackController`：音频播放与回声过滤。
- `MeetingArtifactBuilder`：会后总结。

### 主流程

```text
用户点击“开始讨论模式”
  -> 获取麦克风权限
  -> 创建 ASR WebSocket，role_type=2
  -> 采集麦克风音频
  -> 预处理为 16k/16bit/mono PCM
  -> 每 40ms 发送 1280 字节给讯飞
  -> 接收 ASR JSON
  -> 解析词、标点、时间戳、rl speaker 标识
  -> UI 展示 Speaker 1/2/3 转写
  -> 本地检测“FanDo，你怎么看？”
  -> 构建上下文并调用 FanDo agent
  -> 得到回复文本
  -> 等待自然停顿
  -> 创建 TTS WebSocket
  -> 发送 base64 文本
  -> 接收 base64 音频片段
  -> 边接收边播放
  -> 播放期间过滤自身回声
  -> 回到监听状态
```

### 点名检测

第一版规则：

- 文本包含 `FanDo`、`fando`、`饭豆`、`范斗` 等可配置唤醒词。
- 同一句或相邻短句包含请求意图：`你怎么看`、`总结一下`、`帮我们分析`、`我们决定了什么`、`给个建议`。
- 如果只是“之后问 FanDo”这类非直接请求，不触发。

为了减少误触发，FanDo 可以先在 UI 显示“检测到点名”，但语音播报仍需满足自然停顿。

### 自然停顿与自动播报

建议：

- 回复生成完成后进入 `WaitingForPause`。
- 最近 1.2 到 1.8 秒没有 participant 语音最终结果或 VAD 活跃，则开始 TTS。
- 如果 8 秒内一直有人说话，FanDo 可继续等待，不抢话。
- 用户可点击“立即播报”或“取消播报”。

### 回声控制

TTS 播报期间，电脑麦克风可能录到 FanDo 自己的声音。第一版必须做产品层过滤：

- `PlaybackController` 记录 TTS 开始和结束时间。
- ASR 返回结果如果时间戳与 TTS 播放区间重叠，默认标记为 `echoCandidate`。
- `echoCandidate` 不参与点名检测，不进入主要会议上下文。
- 播报期间可以临时降低麦克风增益或暂停本地送 ASR，但暂停会漏掉用户打断，第一版建议先“不暂停，只过滤”。

如果后续要支持“用户打断 FanDo”，需要更强的声学回声消除和 VAD 策略。

## 配置清单

需要在 FanDo 设置页或本地安全配置中保存：

### 讯飞 ASR

- `iflytek.asr.appId`
- `iflytek.asr.accessKeyId`
- `iflytek.asr.accessKeySecret`
- `iflytek.asr.lang`
- `iflytek.asr.roleType=2`
- `iflytek.asr.domain=pd`
- `iflytek.asr.vadMdn`

### 讯飞 TTS

- `iflytek.tts.appId`
- `iflytek.tts.apiPassword` 或 `apiKey/apiSecret`
- `iflytek.tts.voice`
- `iflytek.tts.audioEncoding`
- `iflytek.tts.speed`
- `iflytek.tts.pitch`
- `iflytek.tts.volume`

密钥必须放在主进程、Gateway 或 secret store 中，不应暴露给 renderer。

## MVP 验证计划

### 第 1 步：ASR Spike

目标：验证讯飞实时语音转写大模型能否稳定返回 speaker。

测试材料：

- 2 人会议音频 5 分钟。
- 3 人会议音频 5 分钟。
- 4 人会议音频 5 分钟。
- 一段有重叠说话和笑声的真实会议音频。

检查项：

- 延迟。
- 字准率。
- `rl` speaker 切换稳定性。
- 角色数量是否合理。
- 同一个人是否频繁变成不同 Speaker。
- 多人同时说话时错误表现。

### 第 2 步：TTS Spike

目标：验证讯飞在线语音合成在 FanDo 自动播报场景是否自然。

检查项：

- 首包延迟。
- 整句播放延迟。
- 音色自然度。
- 音量是否适合会议室。
- mp3 与 raw PCM 播放链路复杂度。
- 特色发音人是否需要额外授权。

### 第 3 步：端到端 Demo

目标：做一个最小闭环。

- Electron 采集麦克风。
- 接讯飞 ASR。
- UI 展示 speaker 转写。
- 检测“FanDo，你怎么看？”
- 调 FanDo agent。
- 接讯飞 TTS 播报。
- 播报期间过滤 echoCandidate。

## 关键风险

- 角色盲分效果必须用真实会议室测试，不能只看干净录音。
- 文档中 TTS 文本不支持多次分段传输，因此 LLM token 级实时播报不适合第一版。
- 会议音频上传到讯飞云端，需要明确用户授权和数据处理边界。
- 如果会议超过 8 小时，需要按讯飞上限做 session 滚动。
- 如果公司网络需要代理或白名单，WebSocket 长连接要单独测试。
- 基础发音人免费，但特色发音人可能收费或需授权。

## 建议

第一版使用讯飞全家桶是可行的：

- ASR：实时语音转写大模型，`role_type=2`，盲分。
- TTS：在线语音合成 WebSocket，基础发音人。
- FanDo：本地做点名检测、上下文构建、自然停顿和回声过滤。

产品 demo 阶段建议先购买或领取小额度试用，优先用外接会议麦克风测试。只要 speaker 盲分效果能过关，讯飞方案会比自研或私有化方案更快落地。

## 来源

- 讯飞实时语音转写大模型：https://www.xfyun.cn/doc/spark/asr_llm/rtasr_llm.html
- 讯飞实时语音转写标准版：https://www.xfyun.cn/doc/asr/rtasr/API.html
- 讯飞在线语音合成 API：https://www.xfyun.cn/doc/tts/online_tts/API.html
- 讯飞在线语音合成服务说明：https://www.xfyun.cn/doc/tts/online_tts/tts_description.html
- 讯飞实时语音转写产品页：https://www.xfyun.cn/services/rtasr
