---
name: "统一润色策略层级"
tags: [post-processing, settings, policy, app-profile, refactor]
depends_on:
  - "AppProfile / TitleRule / app_to_profile 已存在 (settings.rs:542-565, 982-984)"
  - "app_category.rs 的 from_app_name 七类静态映射 (CodeEditor / Terminal / InstantMessaging / Email / Notes / Browser / Other)"
  - "docs/specs/2026-05-21-app-rule-suggestion-engine.spec.md（suggestion engine 自动写入的 TitleMatchType::Exact 规则必须继续被解析）"
estimate: "2-3 days"
---

## 意图

"把目前散落在 4 处、各自为政的 app 策略解析逻辑收敛为**单一纯函数 resolver**，并在现有'全局默认 → 具体 App(AppProfile) → 窗口标题(TitleRule)'两端之间插入缺失的中间层级——**App 类别**，形成显式的优先级链：全局默认 → App 类别 → 具体 App → TitleRule，'具体覆盖一般'。Phase 0 只层级化 2 个维度：review 行为（AppReviewPolicy）与 prompt 选择（prompt_id）。"

解决的问题（全部有代码实证）：

1. **解析逻辑散落且已经漂移。** 同一套 "app → profile → title rule" 解析在 4 处各写一遍：
   - `src-tauri/src/actions/transcribe.rs:2184-2258`（解析点 A，无 profile 时 fallback `AppReviewPolicy::Never`，见 2245 行）
   - `src-tauri/src/actions/transcribe.rs:2888-2926`（解析点 B，同样的逻辑重写一遍，无 profile 时 fallback 却是 `AppReviewPolicy::Auto`，见 2926 行）
   - `src-tauri/src/clipboard.rs:291-300`（`should_use_selection_clipboard_fallback`，用**大小写敏感**的 `app_to_profile.get()`，与 A/B 的 `eq_ignore_ascii_case` 不一致——app 名大小写不匹配时该 app 的 `disable_selection_clipboard_fallback` 配置静默失效）
   - `src-tauri/src/shortcut/review_cmds.rs:16-34`（`should_translate_review_insert`，第 4 份查找实现）
     四处各自演化，已产生两处事实性行为分歧。继续散落下去每加一个策略维度都要改 4 处。
2. **缺"类别"层级。** `app_category.rs` 的七类映射目前只用于 `{{scenario-hint}}` 提示词（`prompt_builder.rs:544-566`），用户无法表达"所有 Terminal 类 app 一律不弹 review"这种一般性意图——只能为 iTerm2、Warp、Ghostty 逐个建 AppProfile。
3. **参考实现已验证该模型可行。** auto-reply（/tmp/auto-reply-review）的三级自动回复开关（全局 / 模式 / 对象，README "三级自动回复优先级" + `generic-channel-session.ts` 的 `resolveHandler` 用 `resolvedMode` 覆盖 `handler.autoReply`）证明"具体覆盖一般 + 单点解析"在同类产品中是清晰可维护的。Votype 的对应映射：autoReply on ≈ `AppReviewPolicy::Never`（直接插入），autoReply off ≈ `Always`（人工确认）。

## 约束

- **不新增任何 LLM 调用**（预定决策）。因此本 spec 不涉及 prompt 文件；如未来扩展需要 LLM，一律外置 `src-tauri/resources/prompts/*.md` 并用 `execute_llm_request_with_retry`。
- resolver 必须是**同步纯函数**：`(&AppSettings, 窗口上下文) → EffectivePolicy`，无 IO、无锁、无 async，可脱离 Tauri 独立单测。调用点不新增任何 spawn；不违反 "非 async 上下文禁 `tokio::spawn`" 规则。
- **严格向后兼容**：不重命名、不删除、不改任何现有 settings 字段的序列化格式。新字段一律 `#[serde(default)]`。老配置升级后，在未配置任何类别策略时，resolver 输出必须与现有 4 处内联逻辑**逐位一致**（唯一例外见已定决策 8 的大小写统一，属显式记录的行为修正）。旧版本降级读到新配置也安全（serde 默认忽略未知字段）。
- 类别键固定为 `app_category.rs::from_app_name` 返回的 7 个静态字符串，不允许自定义类别。
- `pipeline.rs` / `routing.rs` / `extensions.rs` 的入参与内部逻辑**零改动**——策略在进入 pipeline 之前解析完毕，`override_prompt_id` 通路（`routing.rs:1057-1075`）原样复用。
- 前端持久化走现有 `useSettings().updateSetting("category_policies", ...)` 通用通路（同 `AppReviewPolicies.tsx:613` 对 `app_profiles` 的用法），**不新增 Tauri command**。
- 提交前清零所有编译 warning。

## 已定决策

1. **层级链 = 全局默认(L1) → App 类别(L2, 新增) → 具体 App(L3, 现有 AppProfile) → TitleRule(L3.5, 现有)。** TitleRule 就是"第 4 级窗口标题维度"的现有雏形，Phase 0 完全保留其语义与优先级顶位；"联系人"维度（从窗口标题提取会话对象）不实现，写入排除范围。不选"另起一套全新策略树"：AppProfile/TitleRule 基础设施完整且有 suggestion engine 在持续写入，推倒重来违背迁移成本约束。

2. **Phase 0 维度收窄为 2 个：review 行为 + prompt 选择。** 理由：这恰好是 L3（AppProfile/TitleRule）**已经支持**的两个维度（`settings.rs:547-548, 555-556`），层级化它们不需要动 pipeline 任何入参。不选纳入"润色总开关"（`post_process_enabled` 有 5 个消费点：transcribe.rs:1142/2119、pipeline.rs:147/1339、commands/history.rs:481，层级化需把 EffectivePolicy 穿透到 pipeline 入口，改动面失控）；不选"强度 (Lite/Full)"与"模型选择"（`multi_model_*` / `length_routing_*` 是全局管线形态开关，per-app 化属投机）。三者全部进排除范围。

3. **L2 数据模型：`category_policies: HashMap<String, CategoryPolicy>` 新增于 AppSettings，`CategoryPolicy { review_policy: Option<AppReviewPolicy>, prompt_id: Option<String> }`，`None` = 继承上一级（全局）。** Option 化字段使未来追加维度是纯增量。不选给 `AppProfile` 加 category 字段：类别由 `from_app_name` 派生，不需要存储。

4. **L2 仅在该 app 无 AppProfile 时参与解析（严格 parity 优先）。** 现有语义中 `AppReviewPolicy::Auto` 是终态（= 走全局置信度逻辑），且 TitleRule.policy = Auto **不会** fallback 到 profile.policy（`transcribe.rs:2919` 是 `unwrap_or`，rule 命中即终态）。若把 Auto 重定义为"继承上一级"，会改变 "rule=Auto + profile=Always" 这类老配置的行为。Phase 0 保持 Auto 终态语义不变；"Auto 改继承"进排除范围，未来另行拍板。
   **重要交互——suggestion engine 会静默短路 L2**：suggestion engine 在用户接受建议时自动创建 AppProfile（`policy: Auto`）并追加 `TitleMatchType::Exact` 规则、写入 `app_to_profile`（`managers/suggestion_engine.rs:345` 起，`apply_accepted_suggestion`）。因此**用户从未手配 profile 的 app 也可能已拥有 profile**，导致其类别策略不生效。该行为按设计保留（Auto 终态 + L2 仅无 profile 时参与），以验收场景 8 固化，并由 source=App 日志与 UI 提示文案（见决策 10）提供可解释性——这是层级模型最反直觉的点，预期是 bug report 高发区，必须可自查。

5. **resolver 落点：新建 `src-tauri/src/policy_resolver.rs`，在 lib.rs 注册 mod。** 签名：

   ```rust
   pub fn resolve_effective_policy(
       settings: &AppSettings,
       app_name: Option<&str>,
       window_title: Option<&str>,
       fallback_review_policy: AppReviewPolicy,
   ) -> EffectivePolicy
   ```

   输出：

   ```rust
   pub enum PolicyLevel { Global, Category, App, TitleRule }
   pub struct EffectivePolicy {
       pub review_policy: AppReviewPolicy,
       pub review_policy_source: PolicyLevel,
       pub override_prompt_id: Option<String>,   // None → 下游沿用 post_process_selected_prompt_id
       pub prompt_source: Option<PolicyLevel>,
       pub translate_to_english_on_insert: bool,        // L3 直通维度（非层级）
       pub disable_selection_clipboard_fallback: bool,  // L3 直通维度（非层级）
   }
   ```

   不选放进 settings.rs（已 2300+ 行）；不选放 `actions/post_process/`（clipboard.rs 与 review_cmds.rs 在该模块之外也要调用）。
   **clipboard.rs 调用点以 `window_title = None` 调用 resolver**：`should_use_selection_clipboard_fallback` 现有签名只有 `active_app_name`（clipboard.rs:275-278），且 `disable_selection_clipboard_fallback` 本就是 L3 直通维度、TitleRule 不参与——禁止为取 title 扩大该函数及其上游调用链的签名。

6. **`fallback_review_policy` 参数化，保留两个 transcribe.rs 调用点现有的 fallback 差异（A=Never，B=Auto）。** 这个差异疑似历史 bug，但 Phase 0 的使命是"收敛不改判"——统一 fallback 是行为变更，进排除范围单独拍板，不夹带。

7. **每维度解析顺序**：
   - review：TitleRule.policy（最长 pattern 胜出，沿用 `transcribe.rs:2226-2228` 语义）→ AppProfile.policy → CategoryPolicy.review_policy（仅无 profile 时）→ `fallback_review_policy`；
   - prompt：TitleRule.prompt_id → AppProfile.prompt_id → CategoryPolicy.prompt_id（仅无 profile 时）→ None（下游全局 prompt 兜底位置不动）。

8. **app 名查找统一为 `eq_ignore_ascii_case`。(待确认)** 这是本 spec 唯一有意的行为修正：修复 clipboard.rs:291 大小写敏感 `get()` 导致的配置静默失效。写入验收场景 5 显式验证。存量用户中 app 名大小写不匹配者，升级后 `disable_selection_clipboard_fallback` 会从静默失效变为突然生效——推荐接受此"修复即变化"（配置本意即如此），待用户确认（见文末）。
   **该统一仅限 app 名查找。TitleRule 的 Text 匹配保持现行 Unicode `to_lowercase().contains` 语义（transcribe.rs:2206-2209），不得顺手改为 `to_ascii_lowercase` 变体**——两者对非 ASCII 大小写映射（如土耳其语 'İ'、西里尔字母）行为不同。纳入场景 3 的 parity 测试输入集锁定。

9. **可观测性只到日志。** resolver 返回 per-dimension source（PolicyLevel），调用点 A 用它替换现有 `transcribe.rs:2251` 的 "App profile resolution" info 日志（格式如 `[Policy] review=always(source=TitleRule) prompt=xxx(source=Category)`）。不写 `pipeline_decisions` 表（schema 变更进排除范围）。
   **非法 regex 规则记 debug 级别日志（含规则 id 与 pattern），不用 warn**：resolver 每次转写/粘贴都会执行，同一条坏规则 warn 会刷屏；而"warn 按规则 id 进程内去重"需要 static 可变状态 + 锁，违反 resolver "无 IO、无锁纯函数"约束。debug 级别零状态、排障时开 debug 日志即可见。

10. **前端 Phase 0 UI 最小化：在 `AppReviewPolicies.tsx` 顶部加一个"类别默认策略"区块**，固定 7 行（七类），每行 = 类别名 + review 策略下拉（继承全局 / always / never，不提供 auto）+ prompt 下拉（默认 / 具体 prompt）。持久化经 `updateSetting("category_policies", ...)`。不选独立设置页：类别策略与 per-app 策略语义同域，放一起用户才能理解"具体覆盖一般"。
    区块内固定展示一句提示文案：**"已有单独 App 配置的应用不受类别策略影响（包括接受建议后自动创建的配置）"**——对应决策 4 的 suggestion engine 短路交互，文案走 i18n key。

11. **类别 prompt 下拉排除内置哨兵 prompt `__PASS_THROUGH__` / `__LITE_POLISH__`，只列真实 prompt。(待确认)** 理由：排除是零成本决策；放开需先验证 `routing.rs:1057` 起的 override_prompt_id 通路对哨兵 id 的查找行为，属额外验证成本，Phase 1 再议（见排除范围）。resolver 端配套防御：`CategoryPolicy.prompt_id` 若为哨兵值（用户手改配置注入），视为未配置（None），不下传。

12. **i18n 新增文案 key 仅 en/zh 全量落地，其余 14 个 locale 不新增，缺失 key 经 `fallbackLng: "en"`（`src/i18n/index.ts:71`）回退英文。** 与项目既有惯例一致：实测 en/zh 各 1225 个 key 全量，其余 locale 仅 335-573 个部分覆盖、一直依赖 en fallback。

## 边界

### 允许修改

- 新建：
  - `src-tauri/src/policy_resolver.rs`（resolver + PolicyLevel/EffectivePolicy/CategoryPolicy 相关逻辑 + 单测）
- 修改：
  - `src-tauri/src/settings.rs`：仅新增 `CategoryPolicy` 结构体与 `category_policies` 字段（`#[serde(default)]`）及默认值初始化
  - `src-tauri/src/lib.rs`：仅注册 `mod policy_resolver;`
  - `src-tauri/src/actions/transcribe.rs`：仅限把 2184-2258 与 2888-2926 两处内联解析块替换为 `resolve_effective_policy` 调用（fallback 分别传 `Never` / `Auto`），及配套日志行
  - `src-tauri/src/clipboard.rs`：仅 `should_use_selection_clipboard_fallback` 改为读 `EffectivePolicy.disable_selection_clipboard_fallback`，以 `window_title = None` 调 resolver（硬编码 unsafe-app 名单 `is_selection_clipboard_fallback_unsafe_app`，clipboard.rs:302-308，原样保留）
  - `src-tauri/src/shortcut/review_cmds.rs`：仅 `should_translate_review_insert` 改为读 `EffectivePolicy.translate_to_english_on_insert`
  - `src/components/settings/post-processing/AppReviewPolicies.tsx`：新增"类别默认策略"区块（含决策 10 的提示文案）
  - `src/lib/types.ts`：新增 CategoryPolicy 的 Zod schema（前车之鉴：2026-05-21 spec 偏差表记录过漏改此文件导致 TS2367）
  - `src/bindings.ts`：specta 重生成
  - `src/i18n/locales/en/translation.json`、`src/i18n/locales/zh/translation.json`：新增类别策略文案 key（其余 14 个 locale 不动，走 en fallback，见决策 12）

### 禁止

- 修改 `AppProfile` / `TitleRule` / `AppReviewPolicy` / `TitleMatchType` 的现有字段、变体或序列化格式——suggestion engine 与用户存量配置依赖它们
- 修改 `src-tauri/src/actions/post_process/routing.rs`（含 `resolve_effective_model`，routing.rs:876——那是**模型**解析链，本 spec 不碰模型维度）
- 修改 `src-tauri/src/actions/post_process/pipeline.rs` / `extensions.rs` / `core.rs` / `prompt_builder.rs` / `recent_context.rs`——策略在 pipeline 之外解析完毕，管线入参不变
- 修改 `src-tauri/src/managers/suggestion_engine.rs`——规则推荐引擎的独立 title 匹配逻辑不动，是否复用 resolver helper 进排除范围
- 修改 `src-tauri/src/app_category.rs` 的映射内容（resolver 只读调用 `from_app_name`）
- 删除或重命名任何现有 settings 字段；`post_process_enabled` / `smart_routing_enabled` / `length_routing_enabled` / `multi_model_*` 等全局开关原位保留、消费点不动
- 动 `settings.rs:2003-2024` 的 `app_review_policies` → `app_profiles` 旧迁移逻辑
- 新增 Tauri command（持久化走现有 `updateSetting` 通用通路）
- 新增任何 LLM 调用或 prompt 文件

## 排除范围

- **全局 101 字段配置膨胀治理**——本 spec 是策略域重构，不解决 AppSettings 整体分层/拆分问题，另立 spec。
- 润色总开关（`post_process_enabled`）、强度（Lite/Full）、模型选择（`multi_model_*` / `length_routing_*`）的层级化——Phase 0 只做 review 行为 + prompt 两维；`post_process_enabled` 层级化需把 EffectivePolicy 穿透进 pipeline 入口（5 个消费点），是否纳入后续 phase 待未来评估。
- 第 4 级"联系人"层（从窗口标题/UI 提取会话对象后按联系人路由）——仅在数据模型注释中说明预留位次（比 TitleRule 更具体），不加 dead enum variant、不加字段。
- `AppReviewPolicy::Auto` 重定义为"继承上一级"——涉及老配置行为变化（"rule=Auto + profile=Always" 类存量配置），未来方向另行拍板；Phase 0 保持 Auto 终态。
- 统一两个 transcribe.rs 调用点的 no-profile fallback（Never vs Auto）——疑似历史 bug，但统一即行为变更，未来另行拍板；Phase 0 参数化保留差异（决策 6）。
- 类别 prompt 下拉放开哨兵 prompt（`__PASS_THROUGH__` / `__LITE_POLISH__`）——Phase 1 再议，前置条件是验证 `routing.rs:1057` 通路对哨兵 id 的查找行为（决策 11）。
- 策略解析结果写入 `pipeline_decisions` 表——需要 schema 变更，且日志已够 Phase 0 排障。
- suggestion_engine.rs 复用 resolver 的 title 匹配 helper——DRY 收益小于扩大爆炸半径的成本。
- 用户自定义类别 / 修改 app→category 映射 / 类别策略导入导出与预设模板。
- `translate_to_english_on_insert` / `disable_selection_clipboard_fallback` 的类别级配置——保持 L3 直通。

## 验收场景

### 1. happy_path_category_default_applies（Happy path）

- **Given**: 用户从未为 Ghostty 配置 AppProfile（`app_to_profile` 无对应项）；`category_policies["Terminal"] = { review_policy: Some(Never), prompt_id: Some(code_prompt_id) }`
- **When**: 用户在 Ghostty 中录音，transcribe.rs 解析点 A 调用 `resolve_effective_policy(settings, Some("Ghostty"), Some(title), Never)`
- **Then**:
  - 返回 `review_policy = Never, review_policy_source = Category, override_prompt_id = Some(code_prompt_id), prompt_source = Some(Category)`
  - 结果直接插入不弹 review；pipeline 收到的 `override_prompt_id` 为 code_prompt_id（经现有 routing.rs:1057 通路生效）
  - 日志出现 `source=Category` 字样

### 2. happy_path_specific_overrides_general（Happy path）

- **Given**: `category_policies["Terminal"] = { review_policy: Some(Never), .. }`；同时 iTerm2 已有 AppProfile `{ policy: Always, prompt_id: None, rules: [TitleRule { pattern: "vim", match_type: Text, policy: Never, prompt_id: Some(p2) }] }`
- **When**:
  1. 活动窗口为 iTerm2、title 不含 "vim" → resolver 求值
  2. 活动窗口为 iTerm2、title = "vim ~/notes.md" → resolver 求值
- **Then**:
  1. `review_policy = Always, source = App`——L3 覆盖 L2，类别的 Never 不生效
  2. `review_policy = Never, source = TitleRule, override_prompt_id = Some(p2), prompt_source = Some(TitleRule)`——TitleRule 覆盖 profile；多条规则命中时仍按最长 pattern 胜出（沿用现语义）

### 3. edge_case_legacy_config_parity（Edge case / 迁移）

- **Given**: 一份**不含** `category_policies` 键的老 settings.json（含有 profile 的 app、无 profile 的 app、多规则最长胜出、Text 大小写不敏感 contains、Exact、Regex 各构造一例；其中 Text 规则须含一例非 ASCII 大小写映射字符——如 pattern "İSTANBUL" 配土耳其语 title——锁定 Unicode `to_lowercase().contains` 语义（transcribe.rs:2206-2209），防止实现顺手改为 `to_ascii_lowercase` 变体）
- **When**: 反序列化后对该固定输入集分别以 `fallback = Never`（对应解析点 A）与 `fallback = Auto`（对应解析点 B）调用 resolver，与旧内联逻辑的期望输出逐一比对；再整体序列化回写
- **Then**:
  - `category_policies` 反序列化为空 map；每个用例的 `(review_policy, override_prompt_id)` 与旧逻辑完全一致（含无 profile → 按调用点 fallback Never/Auto）
  - roundtrip 序列化不丢失、不改写任何现有字段
  - 该比对以 `policy_resolver.rs` 内单元测试固化，作为回归护栏

### 4. error_path_invalid_regex_rule（Error path）

- **Given**: 某 AppProfile 含 `TitleRule { pattern: "([unclosed", match_type: Regex, policy: Never, .. }`，同 profile 另有一条可命中的 Text 规则
- **When**: resolver 对该 app 求值
- **Then**:
  - 非法 regex 规则按"不匹配"处理（保持现行 `unwrap_or(false)` 语义），resolver 不 panic、不报错中断
  - 记一条 **debug 级别**日志指明规则 id 与 pattern（不用 warn：resolver 每次转写/粘贴都执行，同一条坏规则会刷屏，而进程内去重需引入可变状态与锁，违反纯函数约束，见决策 9）
  - 解析继续：Text 规则正常命中并生效

### 5. edge_case_case_insensitive_unification（Edge case / 有意行为修正）

- **Given**: `app_to_profile` 存的键是 `"Ghostty"`，其 profile `disable_selection_clipboard_fallback = true`；活动 app 名上报为 `"ghostty"`
- **When**: `should_use_selection_clipboard_fallback` 经 resolver 求值（`window_title = None`，见决策 5）
- **Then**:
  - 旧行为：大小写敏感 `get()` 失配 → 配置静默失效、fallback 被允许；新行为：case-insensitive 命中 profile → 返回 false，禁用 fallback
  - 该差异是本 spec 唯一有意的行为修正，需在 changelog / 实施偏差表显式记录
  - 硬编码 unsafe-app 名单（clipboard.rs:302-308）行为不变

### 6. edge_case_unknown_or_other_category（Edge case）

- **Given**: (a) 用户手改配置写入未知类别键 `category_policies["Gaming"]`；(b) `category_policies["Other"] = { review_policy: Some(Always), .. }` 且活动 app 为 Finder（`from_app_name` → "Other"）且无 profile
- **When**: resolver 分别求值
- **Then**:
  - (a) `from_app_name` 永不返回 "Gaming"，该项被静默忽略，不 panic、不影响其他解析
  - (b) "Other" 是合法类别，Finder 命中 `review_policy = Always, source = Category`

### 7. happy_path_frontend_persistence（Happy path）

- **Given**: 设置页"类别默认策略"区块中，用户把 InstantMessaging 的 review 策略从"继承全局"改为 "never"
- **When**: 前端调用 `updateSetting("category_policies", {...})`，随后重启应用
- **Then**:
  - settings.json 持久化 `category_policies.InstantMessaging.review_policy = "never"`；重启后 UI 与 resolver 均读到该值
  - 微信（无 profile，`from_app_name("微信")` → "InstantMessaging"）录音直接插入不弹 review
  - 其余 6 个类别保持"继承全局"，行为不变

### 8. edge_case_profile_auto_shadows_category（Edge case / 层级模型最反直觉行为）

- **Given**: `category_policies["Terminal"] = { review_policy: Some(Never), .. }`；且：
  - (a) iTerm2 有用户手建 AppProfile `{ policy: Auto, rules: [] }`
  - (b) Warp 从未被用户手配过，但用户曾接受一条规则建议，suggestion engine 的 `apply_accepted_suggestion`（`managers/suggestion_engine.rs:345` 起）已自动创建 AppProfile `{ policy: Auto, rules: [Exact 规则] }` 并写入 `app_to_profile`
- **When**: resolver 分别对两个 app 求值；(b) 中当前 title 不命中该 Exact 规则
- **Then**:
  - 两例均返回 `review_policy = Auto, source = App`——类别的 Never **不生效**（L2 仅在无 profile 时参与，Auto 是终态，见决策 4），走全局置信度逻辑
  - 日志 `source=App` 使"为什么我设了类别策略却没生效"可自查
  - UI 类别区块的提示文案（决策 10）覆盖此情形，含 suggestion engine 自动创建的 profile

## 实施偏差

> 功能完成后填写。记录实际实现与 spec 的差异。

| 原计划 | 实际实现 | 原因 |
| ------ | -------- | ---- |
| —      | —        | —    |

## 待用户确认

1. **clipboard 大小写统一的"修复即变化"（决策 8）**：存量用户中 app 名大小写与 `app_to_profile` 键不匹配者，升级后 `disable_selection_clipboard_fallback` 将从静默失效变为突然生效。推荐：**接受**——这是配置本意，且为本 spec 唯一有意行为修正，已由场景 5 固化并要求显式记录。
2. **类别 prompt 下拉排除哨兵 prompt（决策 11）**：Phase 0 不允许在类别层选择 `__PASS_THROUGH__` / `__LITE_POLISH__`，resolver 对手改注入的哨兵值按未配置处理。推荐：**接受排除**——零成本且不阻塞任何 Phase 0 场景；放开留待 Phase 1 验证 routing.rs:1057 通路后再议。
