---
name: "本地 API Agent Skill 化"
tags: [local-api, security, agent-skill, server, transcription]
depends_on:
  - "现有本地 OpenAI 兼容 server（openai_api_server.rs，默认 127.0.0.1:33178，/v1/models、/v1/chat/completions、/v1/audio/transcriptions）"
  - "2026-07 全项目审查结论：access key 弱生成（openai_api_server.rs:786-795）与 server 默认开启（settings.rs:1067-1069）两项安全缺陷——由本 spec 的 Phase A 修复并作为独立 PR 先行合入，是 Phase B/C 的硬前置"
  - "TranscriptionCoordinator::send_input 触发通路（SIGUSR2 signal_handle.rs:27 / CLI cli.rs:64-69 已复用，证明通路可靠）"
estimate: "2-3 days"
---

## 意图

"为 Votype 已有的本地 OpenAI 兼容 server 补一份标准 SKILL.md 和最小控制端点（查状态 + 触发/结束一次转写会话），让 Claude Code 等本地 agent 能以文档化、可鉴权的方式驱动 Votype；作为硬前置，先行修复 2026-07 审查发现的两个安全缺陷——access key 生成换 CSPRNG（≥128 bit）、server 默认改为 opt-in。"

解决的问题：Votype 的本地 server 已经能提供模型列表、chat 代理和音频转写，但（a）它的 access key 由 SHA256(包名+版本+PID+秒级时间戳) 截 29 字符生成（openai_api_server.rs:786-795），输入全部可推测，本地恶意进程或 DNS rebinding 页面可离线穷举；（b）server 默认开启（settings.rs:1067-1069），绝大多数用户不知道自己暴露了一个把自己云端 API key 当代理用的本地端口；（c）没有任何面向 agent 的使用文档，agent 无法发现或安全地驱动它。把安全地基修好之后，一份 API 文档式 SKILL.md + 三个克制的控制端点就能让 agent 完成"确认 Votype 在线 → 开始录音 → 结束录音"的完整闭环。

**交付结构（评审拆分要求的承接）**：本 spec 分两个独立可交付阶段，各出一个 PR：

- **Phase A（安全修复 PR，先行合入）**：CSPRNG key、legacy key 轮换、opt-in 默认值、开关即启动、摘要比较。已核实 `start_openai_api_server` 在 lib.rs:413 无条件调用且先执行 `ensure_local_api_settings`（openai_api_server.rs:288-289），key 轮换在 disabled 状态下也会执行——Phase A 完全自洽，不依赖 Phase B/C 的任何代码，弱 key + 默认开启是审查确认的在线漏洞，其修复不等待 skill 功能排期。
- **Phase B/C（skill PR，依赖 Phase A 合入）**：三个 `/skill/*` 控制端点 + SKILL.md。不允许在弱 key 状态下上线新控制面。

## 约束

- **Phase A 先行**：Phase B/C 的 PR 不得先于或并入 Phase A 合并；`/skill/*` 端点在 CSPRNG key 与 opt-in 默认值落地前不得存在于任何已合入分支。
- 新 key 熵 ≥128 bit，来源必须是操作系统 CSPRNG（`rand::rngs::OsRng` 或等价物）；`Cargo.toml` 允许为此新增 `rand` 依赖（当前无此依赖，已核实）。
- server 仍绑定 `127.0.0.1`（`allow_lan` 时 `0.0.0.0`，维持现状不动）；**新增的 `/skill/*` 端点即使在 `allow_lan=true` 时也只接受 loopback 来源**。
- `/skill/*` 端点复用现有 `authorize_request`（openai_api_server.rs:649-683）鉴权与 `ApiError` 错误信封，不另造一套鉴权。
- 触发转写只能复用 `TranscriptionCoordinator::send_input(..., ActivationMode::Toggle)` 既有通路（与 SIGUSR2 / CLI 完全一致），不得绕过协调器直接操作 `AudioRecordingManager` 或 `ACTION_MAP`。
- 对 `transcription_coordinator.rs` 只允许**新增只读 stage snapshot 发布**（原子量 + 一个收敛赋值的内部 helper，见决策 9），不得改变 `Command` / `Stage` / 去抖 / 任何控制流语义。
- 遵守 CLAUDE.md 运行时规则：server 启动继续用 `tauri::async_runtime::spawn`（现状即如此，openai_api_server.rs:310）；"设置开启即启动 server"在 Tauri command 上下文中调用同一函数，不引入 `block_on`；协调器线程上只做原子 store，不做任何阻塞/异步操作。
- 本特性**不新增任何 LLM 调用与 prompt 文件**（prompt 外置规则、`execute_llm_request_with_retry` 规则不适用；现存 `execute_llm_request_with_messages` 调用不在本 spec 范围内改动）。
- SKILL.md 属仓库公开文件，禁止包含任何真实 access key、用户路径等私密信息。
- 修改后消除全部编译 warning 再提交。

## 已定决策

### A. 安全修复（Phase A，独立 PR 先行合入）

1. **key 生成换 CSPRNG：`votype-local-` + 32 位 hex（16 字节 OsRng，恰好 128 bit）**，替换 openai_api_server.rs:786-795 的 SHA256 派生实现。不选 `uuid::Uuid::new_v4()`（已有依赖但仅 122 bit 随机，达不到 ≥128 bit 硬指标）；不选沿用 SHA256 结构（问题不在哈希而在输入可推测）。前端 `AdvancedSettings.tsx:159-168` 已用 `crypto.getRandomValues`（18 字节/144 bit），不需要改，两端格式统一为 `votype-local-<hex>` 前缀。

2. **legacy 弱 key 升级即轮换，立即作废，无宽限期。** `ensure_local_api_settings`（openai_api_server.rs:258-286）在"key 为空"之外增加一条：key 匹配 `^votype-local-[0-9a-f]{16}$`（legacy 格式恰 29 字符）即视为弱 key，用 CSPRNG 重新生成并写回 settings。作废时机 = 升级后首次启动。理由：弱 key 本身就是漏洞，宽限期等于把洞多开一个版本周期；用户脚本失效的代价是"去设置页重新复制一次 key"，可接受。误伤分析：前端生成的 key 是 36 位 hex（49 字符）、新后端 key 是 32 位 hex（45 字符）、用户自定义 key 恰好命中该正则的概率可忽略。**轮换通知定案：`log::info` 一条 + release notes 提示，不加 toast/红点**——不扩前端范围，用旧 key 失效的用户到设置页复制新 key 即恢复，设置页展示的 key 自动变为新值。

3. **`default_openai_compatible_api_enabled()` 由 `true` 改为 `false`（settings.rs:1067-1069），opt-in。** **存量用户处置定案：settings.json 已显式写有 `openai_compatible_api_enabled: true` 的用户保留现状不强制重置**（serde default 只对缺失字段生效），release notes 提示该行为。理由：兼容优先——强制重置会打断正在依赖该 API 的用户；opt-in 的目标是"新装机默认不暴露端口"，存量已知情用户（至少写过一次设置）不在该目标内。

4. **开关打开即启动 server，不再要求重启应用。** 现状：`start_openai_api_server` 仅在启动时（lib.rs:413）调用一次，`change_openai_compatible_api_enabled_setting`（settings_cmds.rs:64-72）只写设置——default 改 false 后，新用户"打开开关却没有 server"是死路。方案：`openai_api_server.rs` 增加 `AtomicBool` 已启动守卫，`change_openai_compatible_api_enabled_setting(true)` 时若未启动则调用 `start_openai_api_server`；关闭开关维持现状（listener 不停，`authorize_request` 每请求读设置返回 503 `service_disabled`，openai_api_server.rs:651-659），重新打开无需再启动。

5. **key 比较改为 SHA256 摘要比较缓解 timing side-channel。** `authorize_request` 现为明文 `==`（openai_api_server.rs:678）；改为对 supplied/expected 各做一次 Sha256 再比较摘要（sha2 已是依赖，零新增成本）。不引入 `subtle` crate——摘要比较的时序泄露对象是摘要而非 key，已足够。

### B. 控制端点（Phase B，依赖 Phase A）

6. **端点清单：`GET /skill/status`、`POST /skill/transcribe/start`、`POST /skill/transcribe/stop`，挂载在根路径**（不进 `/v1` nest——它们不是 OpenAI 兼容语义；base path 无论怎么配，skill 端点地址恒为 `http://127.0.0.1:<port>/skill/...`，SKILL.md 里可以写死）。参考 auto-reply skill-server 的 status/start/pause 三端点克制设计。

7. **不暴露历史读取端点。** 转写历史是用户的全部语音输入，属最敏感数据；一个持有 key 的 agent/进程可借此整库外传。agent 若需要"拿到转写文本"，用自己的音频走既有 `/v1/audio/transcriptions`；驱动桌面转写会话的结果走原有 paste 通路进入用户焦点应用，不经 HTTP 返回。

8. **`stop` 不返回转写文本，start/stop 均为"派发 + 有界确认"语义，前置校验按三态快照映射。** 处理流程异步且结果去向是焦点应用，HTTP 层不等待 pipeline。handler 内：
   - 持全局 `tokio::sync::Mutex` 操作锁（`try_lock` 失败 → 409 `operation_in_progress`）；
   - **锁内读 stage 快照做前置校验**（在锁内而非锁前读取，缩小与快捷键的竞态窗口，见威胁模型"残余竞态"）：
     - `start`：Idle → 派发；Recording → 409 `already_recording`；Processing → 409 `busy_processing`；
     - `stop`：Recording → 派发；Idle → 409 `not_recording`；**Processing → 409 `busy_processing`**（录音已结束、pipeline 在收尾，stop 无对象——与 SKILL.md 错误码表逐字对齐，实现前不得二义）；
   - 校验通过则派发 `send_input("transcribe", "skill-api", true, ActivationMode::Toggle)`，随后在锁内以 50ms 间隔轮询 stage 快照至多 500ms 确认翻转：确认则返回 `{ok:true, status:"recording"|"processing"}`，超时返回 `{ok:true, dispatched:true, confirmed:false}`（agent 转而轮询 `/skill/status`，禁止盲目重发，见 SKILL.md 大纲）。理由：协调器是 fire-and-forget 串行队列，有界确认既避免双请求净效果归零（toggle 两次=没录），又不给协调器加任何回执机制。

9. **`TranscriptionCoordinator` 发布只读三态 stage 快照（Idle / Recording / Processing），赋值点用内部 helper 收敛。** 现状 `Stage` 线程私有，外部只能看 `AudioRecordingManager::is_recording()`（audio.rs:550）——它在 Processing 阶段返回 false，会让 `/skill/transcribe/start` 在后处理进行中误判空闲并触发 `interrupt_current_operation`（transcription_coordinator.rs:98-100），打断在途 pipeline。方案：协调器持一个 `Arc<AtomicU8>`；stage 赋值现散布在 8 处（transcription_coordinator.rs:53 初始化、82/100/118/147/151 循环内、217/229 start/stop helper 内），逐点手工 store 极易漏改导致快照漂移——**新增内部 helper `fn set_stage(stage: &mut Stage, snapshot: &AtomicU8, new: Stage)` 收敛全部赋值点**，helper 内先赋值再 store。这仍是纯附加、不改任何控制流，符合"仅新增只读快照"边界；HTTP 层只读。这是唯一动协调器文件的理由。

10. **`/skill/status` 也要求鉴权（定案关闭）。** 录音中/处理中状态本身是隐私信号（"用户此刻在口述"）；未鉴权探测者能拿到的只有 401——而 401 本身已足以让 agent 判断"Votype 在线"，可用性无损。响应体：`{ok:true, status:"idle"|"recording"|"processing", app_version:"x.y.z"}`，不含模型/设备等指纹信息。

11. **不加任何 CORS 放行头。** 明确不复制 auto-reply skill-server 的 `Access-Control-Allow-Origin: *`（反面教材：等于邀请任意网页读取本地 API 响应）。现状 axum 无 CORS layer，浏览器预检天然拦截跨源 JSON POST，保持。

12. **`/skill/*` 仅限 loopback，判定依据只能是 TCP 对端地址。** 通过 axum `ConnectInfo<SocketAddr>` 校验对端 IP `is_loopback()`，否则 403 `loopback_only`。**实现前提：现有 serve 调用是 `axum::serve(listener, router)`（openai_api_server.rs:342），未启用 connect-info——必须同步改为 `axum::serve(listener, router.into_make_service_with_connect_info::<SocketAddr>())`**，否则 handler 中提取 `ConnectInfo` 会失败。**明令禁止**退而用 `Host` / `X-Forwarded-For` 等请求头做 loopback 判定（头可伪造）。即使用户开了 `allow_lan`（为局域网内其他设备用 `/v1` 转写服务），"远程触发这台机器的麦克风"也不应成为可能。

### C. SKILL.md（Phase C，与 Phase B 同 PR）

13. **存放位置定案：仓库根 `skills/votype-agent/SKILL.md`（新建目录）**，对齐 auto-reply 的 `skills/autoreply-agent/` 布局，作为独立可拷贝目录便于用户装入 `~/.claude/skills/`。不做应用内打包/导出（列入排除范围，Phase 1 视需求再说）。

14. **SKILL.md 内容大纲**（API 文档式，不含任何真实 key）：
    - frontmatter：`name: votype_agent`，`description`（何时使用：驱动/查询 Votype 语音转写），OS 要求。
    - 前置条件：Votype 桌面端运行中；设置 → 高级 → Local API 已启用（明确说明默认关闭，需用户手动打开）；Access Key 从设置页复制，建议 `export VOTYPE_API_KEY=...` 提供给 agent；默认地址 `http://127.0.0.1:33178`。
    - 鉴权：`Authorization: Bearer <key>` 或 `x-api-key`。
    - 控制端点：`/skill/status`、`/skill/transcribe/start`、`/skill/transcribe/stop` 的 curl 示例 + 响应。
    - 既有 OpenAI 兼容端点简表：`GET /v1/models`、`POST /v1/chat/completions`、`POST /v1/audio/transcriptions`（base path 可在设置中改，默认 `/v1`）。
    - 错误码表：`401 unauthorized` / `503 service_disabled` / `409 already_recording` / `409 not_recording` / `409 busy_processing`（start 于 Processing 中，或 stop 于 Processing 中）/ `409 operation_in_progress` / `403 loopback_only`。
    - 使用流程：status 确认在线 → start → 用户说话 → stop → 轮询 status 回到 idle；转写文本经系统粘贴进入当前焦点应用，**不经 API 返回**。
    - **并发纪律（必写）**：收到 `{dispatched:true, confirmed:false}` 时**以 `/skill/status` 轮询结果为准，禁止盲目重发 start/stop**（重发 toggle 可能把刚开始的录音停掉）；agent 驱动会话期间提醒用户避免同时使用转写快捷键（两者共享同一 toggle 通路，无法互斥）。
    - 注意事项：不提供历史读取；key 保密不入仓库；端口/base path 以设置页为准。

## 威胁模型

**资产**：① 麦克风（远程触发录音 = 窃听面）；② 用户配置的云 provider API key（`/v1/chat/completions` 与在线 ASR 是用用户的 key 做代理——弱鉴权等于把用户付费 LLM 额度免费开放）；③ 转写历史（本 spec 坚持不经 HTTP 暴露）；④ 焦点应用文本注入（转写结果 paste 到当前焦点窗口）。

| 攻击者                            | 能力                                                | 防线                                                                                                                                                                               | 残余风险                                                                           |
| --------------------------------- | --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| 同用户本地恶意进程                | 可直接读 settings.json 拿到明文 key                 | **key 不防它**（诚实声明：任何本地明文 key 都防不了同用户文件读取；该攻击者能做的远不止调 API）。缓解：opt-in 默认关闭缩小暴露窗口；录音必现 overlay（既有行为）使隐蔽窃听可被察觉 | 明文 key 存储（审查已知项，加密存储超本 spec 范围）                                |
| 恶意网页（CSRF / DNS rebinding）  | 能向 127.0.0.1:33178 发请求；rebinding 后还能读响应 | 无法读本地文件 → 拿不到 CSPRNG key；不加 CORS 头；**旧弱 key 可被离线穷举（PID×时间戳空间小），CSPRNG 修复直接封死**                                                               | Host/Origin 校验未做（列入排除范围，key 已足够时属演进项）                         |
| LAN 攻击者（`allow_lan=true` 时） | 可扫描并访问 0.0.0.0:33178                          | key 是唯一屏障 → CSPRNG 是 allow_lan 存在的前提；`/skill/*` loopback-only 且判定只认 TCP 对端地址（决策 12），麦克风控制面对 LAN 恒关闭；`allow_lan` 本身默认 false 且需显式打开   | `/v1/*` 走明文 HTTP，LAN 内可被嗅探（TLS 超范围；设置页已有 LAN 提示文案可加警示） |

### 残余竞态（非攻击者，但必须文档化的并发窗口）

操作锁只序列化 `/skill/*` 请求之间；它无法与用户快捷键互斥——快捷键事件与 skill 派发汇入同一个协调器串行队列（binding_id 同为 `"transcribe"`），协调器无 CAS/条件派发语义。两个已知窗口：

1. **skill start 与用户快捷键交错**：handler 在锁内读到 Idle 与协调器实际处理其 toggle 之间，若用户恰好按下快捷键开始录音，skill 的 toggle 会把用户刚开始的录音停掉。缓解：前置校验在**锁内**读快照（决策 8）把窗口缩到毫秒级，但无法归零——这是复用既有 toggle 通路（约束）的固有代价，接受并在 SKILL.md 并发纪律中向 agent 声明。
2. **30ms 全局 press 去抖可能静默丢弃 skill 派发**：协调器对所有 press 事件做 30ms 去抖且不分来源（transcription_coordinator.rs:12 `DEBOUNCE`、69-73 判定）——若用户按键与 skill 派发间隔 <30ms，skill 的 toggle 被 `continue` 丢弃且无任何回执。缓解：决策 8 的有界确认会因快照未翻转而返回 `{dispatched:true, confirmed:false}`，agent 按 SKILL.md 纪律轮询 status 而非重发。

不做的缓解：给协调器加派发回执/条件 toggle——违反"不改控制流语义"约束，且窗口实际危害是"一次录音被误停"，可由用户重录恢复，不值得为此改造协调器（见排除范围）。

## 边界

### 允许修改

**Phase A（安全 PR）：**

- `src-tauri/src/openai_api_server.rs`：CSPRNG key 生成、legacy key 轮换、摘要比较、`AtomicBool` 启动守卫
- `src-tauri/src/settings.rs`：仅 `default_openai_compatible_api_enabled()`（1067-1069 行）返回值 `true` → `false`
- `src-tauri/src/shortcut/settings_cmds.rs`：仅 `change_openai_compatible_api_enabled_setting`（64-72 行）增加"开启时启动 server"
- `src-tauri/Cargo.toml`：新增 `rand` 依赖
- `src/components/settings/advanced/AdvancedSettings.tsx`：默认关闭后的开关说明文案、"打开即生效无需重启"提示

**Phase B/C（skill PR）：**

- `src-tauri/src/openai_api_server.rs`：`/skill/*` 路由与 handler、loopback 校验、serve 调用改 `into_make_service_with_connect_info::<SocketAddr>()`（决策 12）
- `src-tauri/src/transcription_coordinator.rs`：仅新增只读 stage 快照发布（原子量 + `set_stage` 收敛 helper，决策 9），不改任何控制流
- 新建：`skills/votype-agent/SKILL.md`

### 禁止

- 修改 `handle_models` / `handle_chat_completions` / `handle_audio_transcriptions` 三个业务 handler 的逻辑（本 spec 只动鉴权与新增路由）
- 修改 `src-tauri/src/actions/transcribe.rs`、`src-tauri/src/shortcut/handler.rs`、`src-tauri/src/cli.rs`、`src-tauri/src/signal_handle.rs`——触发通路只复用不改造
- 修改协调器的 `Command` / `Stage` 枚举语义、去抖、`ACTION_MAP`（stage 快照 + `set_stage` helper 是唯一允许的附加）
- 用请求头（`Host` / `X-Forwarded-For` 等）判定 loopback——只认 `ConnectInfo` 的 TCP 对端地址（决策 12）
- 新增 Tauri command / 重生成 bindings（本特性纯 HTTP 面 + 既有设置命令，前端无新 API）
- 添加任何 CORS 放行头（理由见决策 11）
- 在仓库任何文件（含 SKILL.md、测试）中写入真实 access key
- 新增 prompt 文件或 LLM 调用（本特性没有 LLM 环节）
- 停用/重绑定运行中的 listener（关闭开关走 503 语义，端口/host 变更仍需重启，维持现状）

## 排除范围

- MCP server 形态、SSE/流式事件推送——Phase 0 只做 HTTP 轮询。
- SKILL.md 应用内打包、导出按钮、自动安装到 `~/.claude/skills/`——Phase 0 仅仓库文件。
- `stop` 返回转写文本 / 转写完成 webhook——结果去向维持 paste 通路。
- 历史读取端点、历史检索端点（含"只读最近一条"）——极敏感，明确不做。
- key 分权（多 key、按端点 scope、只读 key）与速率限制。
- key 加密存储（settings.json 明文问题是审查已知独立项）。
- TLS / Host header 校验 / Origin 校验。
- `start` 指定 `binding_id`（如 `invoke_skill`）或指定模型/语言参数——Phase 0 硬编码 `"transcribe"`。
- 协调器派发回执 / 条件 toggle / CAS 语义——残余竞态（见威胁模型）按文档化接受，不改造协调器。
- 端口占用 fallback（auto-reply 的 12680→12681 机制）——Votype 端口可配置，冲突时日志报错维持现状。
- 存量用户 `enabled=true` 的强制重置——已定案保留现状（决策 3），不再悬置。
- 统一 `execute_llm_request_with_messages` → `execute_llm_request_with_retry`（既有已知债务，另行跟踪）。

## 验收场景

> 场景按交付阶段分组：1/2/4/8 随 Phase A（安全 PR）验收；3/5/6/7/9/10 随 Phase B/C（skill PR）验收。

### Phase A（安全 PR）

#### 1. happy_path_fresh_install_csprng_and_optin

- **Given**: 全新安装，settings.json 不存在
- **When**: 应用首次启动，`ensure_local_api_settings` 执行
- **Then**:
  - 生成的 key 匹配 `^votype-local-[0-9a-f]{32}$`（128 bit CSPRNG）；两次独立安装生成的 key 不同
  - `openai_compatible_api_enabled` 为 `false`，`127.0.0.1:33178` 无进程监听（`curl` 连接拒绝）
  - 设置页开关显示关闭，key 已可见可复制

#### 2. happy_path_legacy_key_rotation

- **Given**: 存量用户升级，settings.json 中 key 为 legacy 格式（`votype-local-` + 16 位 hex，共 29 字符），`enabled: true`
- **When**: 升级后首次启动
- **Then**:
  - key 被替换为新格式 32 位 hex，settings.json 落盘，日志出现轮换记录
  - 用旧 key 请求 `/v1/models` → 401 `unauthorized`（旧 key 即刻作废）
  - 从设置页复制新 key 请求 `/v1/models` → 200
  - 用户此前手动自定义的 key（不匹配 legacy 正则）不被触碰

#### 4. error_path_auth_failures

- **Given**: server 曾在本次会话启用后被用户关闭开关；另有一个从未打开过开关的全新会话
- **When**: ① 无 `Authorization` 头请求 `/v1/models`；② 错误 key 请求；③ 关闭开关后用正确 key 请求；④ 全新会话（server 从未启动）请求
- **Then**:
  - ①② → 401，`ApiError` 信封，错误信息不回显期望 key 的任何片段
  - ③ → 503 `service_disabled`（listener 仍在，鉴权层拒绝）
  - ④ → TCP 连接拒绝（进程根本不监听）

#### 8. edge_case_existing_user_default_preserved

- **Given**: ① 存量 settings.json 显式含 `"openai_compatible_api_enabled": true`；② 另一份旧 settings.json 完全缺失该字段
- **When**: 升级后启动
- **Then**:
  - ① server 照常自启动监听（显式值优先，serde default 不覆盖）
  - ② 反序列化得 `false`，不监听——与全新安装同等待遇

### Phase B/C（skill PR）

#### 3. happy_path_agent_dictation_flow

- **Given**: server 已启用，agent 持有效 key，stage 为 Idle
- **When**: agent 依次 `GET /skill/status` → `POST /skill/transcribe/start` →（用户说话）→ `POST /skill/transcribe/stop` → 轮询 `GET /skill/status`
- **Then**:
  - status 依次返回 `idle` → start 返回 `{ok:true,status:"recording"}` 且录音 overlay 出现 → stop 返回 `{ok:true,status:"processing"}` → 轮询最终回到 `idle`
  - 转写文本经既有 paste 通路进入焦点应用；任何 HTTP 响应体中都不含转写文本
  - `/skill/status` 无 `Authorization` 头请求 → 401（决策 10）

#### 5. error_path_start_while_recording

- **Given**: 用户正用快捷键录音（stage = Recording）
- **When**: agent `POST /skill/transcribe/start`
- **Then**: 409 `already_recording`；录音不被打断，快捷键停止行为不受影响

#### 6. edge_case_start_or_stop_during_processing

- **Given**: 一次录音刚 stop，pipeline 后处理进行中（stage = Processing，此时 `AudioRecordingManager::is_recording()` 已为 false）
- **When**: agent 分别 `POST /skill/transcribe/start` 与 `POST /skill/transcribe/stop`
- **Then**:
  - 两者均 409 `busy_processing`（决策 8 三态映射；stop 在 Processing 阶段不是 `not_recording`）
  - 在途 pipeline **不被 `interrupt_current_operation` 打断**，转写结果正常送达
  - （此场景证明 stage 快照的必要性：仅凭 `is_recording()` 会误判空闲）

#### 7. edge_case_lan_isolation

- **Given**: `allow_lan = true`，server 绑定 `0.0.0.0:33178`，另一台 LAN 机器持有效 key
- **When**: LAN 机器分别请求 `/v1/models` 与 `/skill/status`；本机 loopback 请求 `/skill/status`
- **Then**:
  - LAN → `/v1/models`：200（既有能力，用户显式开启承担）
  - LAN → `/skill/status`：403 `loopback_only`（key 正确也拒绝；伪造 `Host: 127.0.0.1` 或 `X-Forwarded-For: 127.0.0.1` 头同样 403——判定只认 TCP 对端地址）
  - loopback → `/skill/status`：200

#### 9. edge_case_concurrent_start_requests

- **Given**: stage = Idle，两个 agent 进程同时 `POST /skill/transcribe/start`
- **When**: 两请求并发到达
- **Then**:
  - 恰一个请求获得操作锁并派发 toggle、在 500ms 有界确认内返回 `{ok:true,status:"recording"}`；另一个返回 409（`operation_in_progress` 或 `already_recording`，取决于时序）
  - 最终 stage 为 Recording——不出现"toggle 两次净效果为停止"的双派发

#### 10. edge_case_skill_start_races_user_hotkey

- **Given**: stage = Idle，agent 发起 `POST /skill/transcribe/start`；几乎同时用户按下转写快捷键
- **When**: 两个 toggle 事件先后进入协调器串行队列（顺序不定），且两者间隔可能落入 30ms 去抖窗口
- **Then**:
  - 任一顺序下应用不 panic、不出现 stage 快照与协调器实际 `Stage` 不一致（`set_stage` 收敛保证）
  - 若 skill 派发被 30ms 去抖丢弃：有界确认超时，start 返回 `{ok:true, dispatched:true, confirmed:false}`；agent 随后轮询 `/skill/status` 看到的状态与真实 stage 一致（Recording——用户按键生效）
  - 若两个 toggle 均生效（净效果 = 录音开始又停止）：最终 status 回到 `idle` 或 `processing`，无挂死；该窗口为文档化的残余竞态（见威胁模型），SKILL.md 并发纪律已声明"以 status 为准、禁止盲目重发"
  - 不要求实现消除该竞态——本场景验收的是"竞态发生时系统状态可观测且自洽"

## 实施偏差

> 功能完成后填写。记录实际实现与 spec 的差异。

| 原计划 | 实际实现 | 原因 |
| ------ | -------- | ---- |
| —      | —        | —    |

## 待用户确认

1. **Phase A 是否物理拆分为独立 spec 文件**：YAGNI 评审要求把安全修复拆成独立 spec 先行合入。本次修订受"只落盘一个 spec 文件"的约束，改为在本 spec 内以两阶段/两 PR（Phase A 先行合入、Phase B/C depends_on Phase A）承接其实质。若你希望严格执行"独立 spec 文件"，需另行把本文件的 Phase A 部分（决策 1-5 + 场景 1/2/4/8 + 对应边界）抽出为 `docs/specs/2026-07-18-local-api-security-hardening.spec.md` 并调整本文件 depends_on 指向它——内容无需重写，纯文件拆分。
