---
name: "Provider 元数据 Manifest 化（原《Provider 配置 Schema 化》，Phase 0 经评审裁剪）"
tags: [post-processing, provider, settings, manifest, config-ui]
depends_on:
  - "PostProcessProvider 结构与默认 provider 列表已存在 (src-tauri/src/settings.rs:215, 1188)"
  - "provider CRUD 命令已存在 (src-tauri/src/shortcut/provider_cmds.rs:544-668)"
  - '模型目录外置先例 (src-tauri/src/catalog/mod.rs:14 include_str!("catalog.json"), commit 711b274c)'
  - "specta bindings 生成流程（bun tauri dev 触发 export）"
estimate: "2-3 days"
---

## 意图

"把 provider 元数据从『Rust 硬编码默认列表 + 前端硬编码模板列表』外置为单一声明式数据文件（`src-tauri/src/provider_catalog/providers.json`，编译期嵌入），前端的模板/分组/推荐/注册链接全部改读后端命令，使**新增一个 OpenAI 兼容 provider 只需在 providers.json 追加一条记录，零前端 diff、零 Rust 代码 diff**。"

解决的问题：当前同一份 provider 元数据在两处重复维护——`src-tauri/src/settings.rs` 的 `default_post_process_providers()`（settings.rs:1188，7 个跨平台内置 provider + macOS ARM64 的 Apple Intelligence，含 base_url/结构化输出支持/可删性）和 `src/components/settings/post-processing/providerTemplates.ts`（30 个模板，含 base_url/分类/官网/注册链接）。二者已发生漂移（**评审核实**：settings.rs:1226 有内置不可删的 `iflow`，providerTemplates.ts 的 30 个模板中没有 iflow；反向地，providerTemplates.ts:278 有 `apple_intelligence` 模板而它在 Rust 侧是 cfg 硬编码）。每新增一个 provider 都要同时改 Rust 与 TypeScript 两侧。

**范围裁剪说明（相对草稿）**：草稿原计划同时引入 `configSchema` + `SchemaConfigForm` schema 驱动表单（参考 DreDabe/auto-reply 的 `ProviderBundleManifest`）。评审指出：apiVersion 1 的 schema 只允许 4 个固定保留 key 且全部映射既有存储，schema 渲染出的表单与现有按 `allow_base_url_edit`/`models_endpoint` 条件渲染的表单完全同构，属零收益抽象——草稿自己也承认"当前没有任何一个真实 provider 需要额外字段"。本 spec 采纳该意见：**Phase 0 只做元数据 manifest 外置 + 前端换数据源（原 M1），config_schema/表单生成整体移入排除范围**，等第一个真实异构 provider（如 Azure OpenAI）出现再 bump api_version 设计。此裁剪待用户确认（见文末）。

## 约束

- **绝不引入动态代码加载**。auto-reply 的 `provider.bundle.js` 动态 import 机制不迁移：Rust 应用没有对应机制，且第三方 js 执行有供应链风险。providers.json 是纯数据（serde_json 解析），永远不含可执行内容。
- **providers.json 必须编译期嵌入**（`include_str!`），不能运行时从 Resource 目录读取：`default_post_process_providers()` 是 serde `#[serde(default = ...)]` 函数（settings.rs:906 引用），执行时**没有 AppHandle**，无法解析 Resource 路径。与模型目录先例一致（catalog/mod.rs:14）。
- **providers.json 不放在 `src-tauri/resources/` 下**：tauri.conf.json 的 `"resources": ["resources/**/*"]` glob 会把它再打包一份进 Resource 目录，用户修改 Resource 副本无效、易误解为可热改。文件放在 `src-tauri/src/provider_catalog/` 内（纯编译期，与 catalog.json 位置先例一致）。
- **settings.json 序列化格式向后兼容**：`PostProcessProvider`（settings.rs:215）的现有字段（id/label/base_url/builtin/deletable/allow_base_url_edit/models_endpoint/supports_structured_output/custom_headers/use_proxy）一个不删、语义不变；老用户的 settings.json 升级后无需迁移。
- `ensure_post_process_defaults()`（settings.rs:1352）的既有语义保持：非 deletable 内置 provider 缺失时补齐（settings.rs:1373-1376）；用户已删除的 deletable 内置 provider 不复活；api key ring 按 provider 补空条目；`supports_structured_output` 按默认列表同步。
- Apple Intelligence provider 保持 Rust 硬编码（cfg-gated macOS ARM64，base_url 为伪 URL `apple-intelligence://local`，无 HTTP 语义），不进入 providers.json。
- 本特性不涉及任何 LLM 调用与 prompt，`execute_llm_request_with_retry` / prompt 外置规则在此不适用；providers.json 解析为启动期同步操作（`LazyLock`），不产生新的 async 任务（自然满足"不从非 async 上下文 tokio::spawn"规则）。
- specta bindings 重生成需实际启动 `bun tauri dev` 约 30 秒触发 export（历史 spec 已验证 `cargo build` 不触发）。
- 提交前消除所有编译 warning；`cargo test --lib` 与前端 tsc 全绿。

## 已定决策

- **(待确认) Phase 0 范围 = 元数据 manifest 外置 + 前端换数据源；config_schema / SchemaConfigForm / `get_provider_manifest` / 合成 generic manifest 全部砍掉。** 理由（采纳评审意见）：草稿 apiVersion 1 的 schema 只许 `{base_url, models_endpoint, use_proxy, api_key}` 四个保留 key 且全部映射既有存储（api_key 还被豁免于表单渲染），schema 驱动表单与现有条件渲染表单同构，是给同质数据套的异质外壳。连带砍掉：select/password 等字段类型体系、"schema 含 base_url key 等价 allow_base_url_edit"的间接映射（改为 manifest 显式 `allow_base_url_edit` 布尔字段）、api_key 剥离条款。声明价值（"新增 provider 不改前端代码"）由换数据源完整交付。

- **数据文件 = 单一 `src-tauri/src/provider_catalog/providers.json`，不采用草稿的 per-file manifest + 手工 include 列表。** 理由（采纳评审意见）：草稿的意图声明（"只需新增一个 json 文件"）与其决策（还要改 mod.rs 的 include 列表）自相矛盾；单文件对齐 catalog.json 先例、零 include 维护、单测遍历最简单，新增 provider 真正做到只改一个 json 文件的一条记录。加载：新模块 `src-tauri/src/provider_catalog/mod.rs` 中 `include_str!("providers.json")` + `LazyLock` 解析缓存。不选 build.rs 自动 glob：多一层构建魔法。

- **providers.json 顶层结构**：`{ "api_version": 1, "providers": [...] }`。`api_version` 必须为 1，其余整文件拒绝（前向兼容闸门，为未来引入 config_schema 时 bump 预留）。每条 provider 记录字段：
  - `id`（必填，全文件唯一）、`name`（必填，品牌名，不翻译）
  - `category`（必填，`"official" | "openai_compatible" | "local"`，对应今天前端三个分组）
  - `recommended`（bool，默认 false，替代前端 `RECOMMENDED_PROVIDER_TEMPLATE_IDS`；推荐组内排序 = providers.json 中记录出现顺序）
  - `preinstalled`（bool，默认 false，对应今天 settings.rs 默认列表成员资格）、`deletable`（bool，默认 true）
  - `base_url`（必填，默认值）、`models_endpoint`（可选）
  - `supports_structured_output` / `allow_base_url_edit` / `use_proxy`（bool，默认 false；显式声明，直接映射 `PostProcessProvider` 同名字段）
  - `website_url` / `signup_url` / `free_model_provider`（可选，承接 providerTemplates.ts 既有展示字段）

  全部字段为 string/bool/Option 纯量，Rust 结构体 derive `serde::Deserialize + specta::Type`，无 `serde_json::Value`，specta 导出无歧义。

- **校验与失败处理**：解析时逐条校验——`id` 非空且唯一、`category` 属于合法枚举、`base_url` 存在。非法记录 `log::error!`（含 id 与原因）后跳过，不阻塞启动；`api_version != 1` 或整文件解析失败则目录为空（已有 settings.json 中的 provider 不受影响）。同时单元测试遍历校验全部记录（仿照 catalog 的测试），CI 拦截坏数据进发版。

- **`default_post_process_providers()` 生成规则（采纳评审补全）**：`providers.json 记录.filter(preinstalled).map(→ PostProcessProvider { builtin: true, custom_headers: None, 其余字段直映射 })` + Apple Intelligence cfg 分支照旧 push。`ensure_post_process_defaults()`（settings.rs:1373-1376）**不改**，继续只按 `!deletable` 补齐——"用户已删除的 openrouter/zai 不复活"由这两层既有机制自然满足，ensure 不新增读 manifest 的逻辑。`builtin_post_process_provider()` 辅助函数（settings.rs:1166）移除或内部化。

- **(待确认) 内置名单维持现状，不借机调整**：openai/anthropic/custom/iflow/gitee 预装且不可删，openrouter/zai 预装且可删——与 settings.rs 今日行为逐字段一致。iflow 的漂移按"补齐前端展示元数据"方向修复（为其记录补 category/website_url/signup_url），**不**降级为普通可删模板（降级会改变老用户的 ensure 补齐行为，违反"不借机改行为"原则）。推荐方案即维持现状，待用户确认。

- **新增一个 Tauri 命令：`list_provider_manifests() -> Vec<ProviderManifest>`**（供"添加 provider"对话框、分组/推荐展示、signup/free_model 查询）。放在 provider_cmds.rs，specta 注册（lib.rs 两处命令列表同步）。草稿中的 `get_provider_manifest`（按 id 取真实或合成 manifest）随范围裁剪一并砍掉：没有 schema 表单就没有消费方。同理，**不新增 use_proxy 写回命令**（已核实 update_custom_provider（provider_cmds.rs:571-599）仅支持 label/base_url/models_endpoint，且当前 UI 无任何 use_proxy 编辑入口——裁剪后无消费方，签名不动）。

- **Apple Intelligence 的前端展示条目由后端 cfg-gated 注入（采纳评审意见）**：providerTemplates.ts:278 现存 apple_intelligence 模板（Local 分组），删除模板数据后 `matchProviderTemplate`（ApiSettings.tsx:1001，消费点 1797/1893）会 miss。处理方式：`list_provider_manifests` 在 macOS ARM64 下于返回值末尾追加一条 Rust 代码构造的 Apple 条目（category "local"、deletable false），providers.json 本身保持平台无关。不选"前端保留单条常量"：违背前端零硬编码数据的目标。

- **用户自定义 provider 不产生 manifest 记录**：继续走现有 `add_custom_provider`（provider_cmds.rs:544）→ settings.json 存 `PostProcessProvider{builtin: false}`。其配置面板维持今天的手写控件渲染（本次不动）；`matchProviderTemplate` 的替代查询 miss 时按现状优雅降级（今天 iflow 无模板仍正常工作即是现行先例）。

- **providerTemplates.ts 删除数据数组，不保留前端降级回退（定案）**：Tauri invoke 本地命令失败即应用本身已不可用，前端备份数据毫无意义；类型由 bindings.ts 生成的 `ProviderManifest` 取代。

- **providers.json 初始内容 = settings.rs 7 个跨平台内置 ∪ providerTemplates.ts 30 模板中除 apple_intelligence 外的 29 个（并集约 30 条记录）**。逐条核对：行为字段（preinstalled/deletable/supports_structured_output/base_url/allow_base_url_edit/use_proxy）以 settings.rs 为准；展示字段（category/website_url/signup_url/free_model_provider/recommended）以 providerTemplates.ts 为准。`name`/品牌名不做多语言；分组 label 走现有 i18n key，16 个 locale 不新增大量文案。

## 边界

### 允许修改

- 新建：
  - `src-tauri/src/provider_catalog/providers.json`（约 30 条 provider 记录）
  - `src-tauri/src/provider_catalog/mod.rs`（记录结构定义、include_str! 加载、校验、单元测试）
- 修改：
  - `src-tauri/src/settings.rs`：`default_post_process_providers()` 改为由 provider_catalog 驱动；`builtin_post_process_provider()` 移除或内部化；Apple Intelligence 分支与 `ensure_post_process_defaults()` 原样保留
  - `src-tauri/src/shortcut/provider_cmds.rs`：新增 `list_provider_manifests`（含 Apple cfg 注入）
  - `src-tauri/src/lib.rs`：`mod provider_catalog;` + 两处命令注册列表
  - `src/components/settings/post-processing/ApiSettings.tsx`：分组 useMemo（945-1010）、`matchProviderTemplate` 及消费点（1797/1893）换读 `list_provider_manifests`
  - `src/components/settings/post-processing/dialogs/AddModelDialog.tsx`：`freeModelProvider` 查询（129-147）换源
  - `src/components/settings/post-processing/providerTemplates.ts`：删除数据数组（文件删除或缩减为类型 re-export）
  - `src/components/settings/PostProcessingSettingsApi/usePostProcessProviderState.ts`：仅如需透传 manifest 数据时最小扩展
  - `src/stores/settingsStore.ts`：新增 manifest 读取 action
  - `src/bindings.ts`：specta 重生成
  - `src/i18n/locales/*/translation.json`：如需少量分组 label key

### 禁止

- 实现任何形式的动态代码加载（provider.bundle.js 等价物、wasm 插件、脚本执行）或从网络下载/安装 manifest——供应链风险，已定决策明确排除
- 实现 config_schema、SchemaConfigForm、`get_provider_manifest`、合成 generic manifest——已裁剪出 Phase 0，防止实现者按旧草稿走
- 修改 `src-tauri/src/actions/post_process/core.rs` / `extensions.rs`——LLM 执行层与本特性无关，manifest 不进入请求链路
- 修改 `SecretKeyRing` 存储结构或 ApiSettings.tsx 内的多 key 管理 UI（ApiKeyList 相关段落）——key 管理与本次无关
- 修改 `src/components/settings/post-processing/providerBrandAssets.ts` 及 provider avatar 相关命令（provider_cmds.rs:342-380 一带）——avatar 体系独立
- 修改 `src/lib/providerTabsLayout.ts` 与 ApiSettings.tsx 的整体页面/tabs 布局——渐进迁移，禁止顺手重构
- 更改 `add_custom_provider` / `update_custom_provider` / `remove_custom_provider` / `reorder_post_process_providers` 的既有签名——前端调用点不随之震荡
- 更改 settings.json 中 `PostProcessProvider` 的序列化字段名或删除字段——老用户数据必须原样读回
- 修改 `tauri.conf.json` 或向 `src-tauri/resources/` 放置 provider 数据文件——providers.json 是纯编译期数据，不进 Resource 分发

## 排除范围

- **动态代码加载**（明确永不做，非"以后再做"）
- **config_schema / schema 驱动配置表单 / SchemaConfigForm / `get_provider_manifest` / 合成 manifest**（草稿 M2、M3 全部；等第一个真实需要异构字段的 provider——如 Azure OpenAI——出现，bump api_version 再设计；string/password/select/boolean 字段类型体系随之一并排除）
- 非保留 key 的自由 config 字段 + `provider_extra_config` 存储 + 请求层消费
- 品牌内置 provider 的 base_url 可编辑性放开（有用户反代场景诉求，但属行为变更，维持现状；有真实需求另立 spec）
- 用户在 app data dir 放置 manifest 覆盖/新增 provider（prompts 系统已有 user-dir override 先例可仿，企业内网私有网关分发亦属此类；当前无真实需求）
- 从 URL 安装 provider（auto-reply `installProviderFromUrl` 整条链路）
- providers.json 热重载 / 运行时刷新（编译期嵌入，改文件需重新构建）
- `use_proxy` 的 UI 编辑与写回命令（当前 UI 无消费入口，裁剪后无需求）
- key 管理、avatar、模型管理、tabs 布局的 schema 化；ApiSettings.tsx 拆分重构
- manifest `name` 及未来字段 title 的多语言化（api_version 1 不含 title 字段）
- `capabilities` 多能力声明（Votype Phase 0 全部 provider 同质）
- Apple Intelligence 的 manifest 化

## 验收场景

### 1. happy_path_add_provider_json_only

- **Given**: 主干代码已完成本特性。开发者要新增一个 OpenAI 兼容 provider "Novita"（此前 Votype 完全没有它）
- **When**: 仅在 `src-tauri/src/provider_catalog/providers.json` 追加一条记录（id/name/category/base_url/signup_url），重新构建
- **Then**:
  - `git diff` 中 `src/`（前端）目录零改动，`.rs` 文件零改动
  - 设置 → 后处理 → 添加 provider 对话框中出现 "Novita"，落在记录 `category` 对应分组；`recommended: true` 时出现在推荐组且组内顺序 = 文件内记录顺序
  - 添加后 settings.json 写入正确 base_url，`fetch_post_process_models` 按记录的 `models_endpoint` 拉取模型列表
  - AddModelDialog 中 signup 链接指向记录的 `signup_url`

### 2. happy_path_iflow_drift_healed

- **Given**: 本特性完成后的 providers.json 含 iflow 记录（preinstalled、不可删、补齐了 category/website_url/signup_url）
- **When**: 全新安装启动应用，打开后处理设置与添加 provider 对话框
- **Then**:
  - iflow 作为内置 provider 在场（与升级前 settings.rs 行为一致），且首次在前端模板分组中正确展示（漂移修复的直接可观测结果）
  - `list_provider_manifests` 返回的 iflow 记录字段与 providers.json 一致
  - 不再存在"某 provider 在 Rust 侧内置但前端模板列表查不到"的组合（Apple Intelligence 除外，走 cfg 注入）

### 3. error_path_invalid_providers_json

- **Given**: providers.json 数据损坏——三种子情形：(a) 两条记录声明相同 `id`；(b) 某记录 `category` 写成非法值 `"cloud"`；(c) 顶层 `api_version` 为 2
- **When**: 运行 `cargo test --lib`；以及（防御性）带着坏数据启动应用
- **Then**:
  - 单元测试遍历校验全部记录，三种子情形均使测试失败并指出记录 id（或文件级原因），CI 拦截，坏数据进不了发版
  - 运行时防御：(a)(b) 非法记录被 `log::error!` 记录后跳过，其余 provider 正常加载；(c) 整文件拒绝、目录为空，已有 settings.json 中的 provider 照常工作
  - 应用不 panic、设置页不白屏；被跳过的记录不出现在添加列表中，不产生半初始化的 `PostProcessProvider`

### 4. edge_case_legacy_settings_upgrade_unchanged

- **Given**: 老用户的 settings.json：包含 7 个跨平台内置 provider 中的 5 个（用户删除了 deletable 的 `openrouter` 与 `zai`）、2 个自定义 provider、各 provider 已配置的 api keys 与模型选择
- **When**: 升级到含本特性的版本，首次启动触发 settings 反序列化与 `ensure_post_process_defaults()`
- **Then**:
  - 非 deletable 内置 provider（openai/anthropic/custom/iflow/gitee）全部在场（缺失则按 providers.json 记录补齐）
  - 已删除的 `openrouter` / `zai` **不复活**（记录 `deletable: true` → ensure 既有逻辑不强制补齐，无需新逻辑）
  - 2 个自定义 provider 原样保留，id/base_url/keys 不变
  - `post_process_api_keys` / `post_process_models` 无丢失；`supports_structured_output` 按记录同步（沿用 ensure 的既有同步行为）
  - settings.json roundtrip 后不出现新增未知字段导致的结构变化

### 5. edge_case_provider_without_manifest_renders_as_today

- **Given**: settings.json 中存在一个 id 在 providers.json 中找不到的 provider（自定义 provider，或未来某版本移除了某内置记录后的遗留条目）
- **When**: 前端加载 provider 列表并选中该 provider
- **Then**:
  - `list_provider_manifests` 不包含该 id（命令只返回目录内容 + Apple 注入条目，不合成）
  - manifest 查询 miss 时该 provider 的面板按现状渲染（settings 数据驱动的手写控件），与升级前行为一致，无白屏、无 console error（现行先例：iflow 今天无模板仍正常工作）
  - 该 provider 不出现在"添加 provider"的模板列表中（它是用户已持有的 provider，照常出现在 provider tabs 中）

### 6. edge_case_apple_intelligence_stays_hardcoded

- **Given**: macOS ARM64 构建；providers.json 中**没有** apple_intelligence 记录
- **When**: 应用启动，用户打开后处理设置与添加 provider 对话框
- **Then**:
  - Apple Intelligence provider 照常出现（settings.rs cfg 分支注入），选择与使用行为与本特性上线前完全一致
  - `list_provider_manifests` 返回值含 cfg 注入的 Apple 条目，其分组（local）与标签展示**不回退**为缺失/generic 状态（对齐今天 providerTemplates.ts:278 模板提供的展示效果）
  - 非 macOS 平台构建中 Apple Intelligence 既不出现在 provider 列表也不出现在 `list_provider_manifests` 返回值中；providers.json 内容与平台无关

## 实施偏差

> 功能完成后填写。记录实际实现与 spec 的差异。

| 原计划 | 实际实现 | 原因 |
| ------ | -------- | ---- |
| —      | —        | —    |

## 待用户确认

1. **Phase 0 范围裁剪**：草稿标题所指的 config_schema/SchemaConfigForm（M2）已按评审 YAGNI 意见整体移入排除范围，本期只交付"元数据 manifest 外置 + 前端换数据源"。推荐接受裁剪（声明价值已完整交付，schema 留待首个异构 provider 出现时 bump api_version 引入）；若仍希望本期落地 schema 表单，请明示。
2. **内置名单是否维持现状**：推荐维持——openai/anthropic/custom/iflow/gitee 预装不可删、openrouter/zai 预装可删，iflow 仅补齐前端展示元数据修复漂移。替代方案（iflow 降级为普通可删模板）会改变老用户的 ensure 补齐行为，不推荐。
