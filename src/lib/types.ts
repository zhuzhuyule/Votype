import { z } from "zod";

export const ShortcutBindingSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  default_binding: z.string(),
  current_binding: z.string(),
});

export const ShortcutBindingsMapSchema = z.record(
  z.string(),
  ShortcutBindingSchema,
);

export const AudioDeviceSchema = z.object({
  index: z.string(),
  name: z.string(),
  is_default: z.boolean(),
});

export const OverlayPositionSchema = z.enum([
  "none",
  "top",
  "bottom",
  "follow",
]);
export type OverlayPosition = z.infer<typeof OverlayPositionSchema>;

export const ModelUnloadTimeoutSchema = z.enum([
  "never",
  "immediately",
  "min2",
  "min5",
  "min10",
  "min15",
  "hour1",
  "sec5",
]);
export type ModelUnloadTimeout = z.infer<typeof ModelUnloadTimeoutSchema>;

export const PasteMethodSchema = z.enum([
  "ctrl_v",
  "ctrl_shift_v",
  "direct",
  "shift_insert",
  "none",
]);
export type PasteMethod = z.infer<typeof PasteMethodSchema>;

export const ClipboardHandlingSchema = z.enum([
  "dont_modify",
  "copy_to_clipboard",
]);
export type ClipboardHandling = z.infer<typeof ClipboardHandlingSchema>;

export const LogLevelSchema = z.number().int().min(1).max(5).default(2);
export type LogLevelValue = z.infer<typeof LogLevelSchema>;

export const RecordingRetentionPeriodSchema = z.enum([
  "never",
  "preserve_limit",
  "days3",
  "weeks2",
  "months3",
]);
export type RecordingRetentionPeriod = z.infer<
  typeof RecordingRetentionPeriodSchema
>;

export const AppReviewPolicySchema = z.enum(["auto", "always", "never"]);
export type AppReviewPolicy = z.infer<typeof AppReviewPolicySchema>;

export const AppProfileSchema = z.object({
  id: z.string(),
  name: z.string(),
  policy: AppReviewPolicySchema,
  prompt_id: z.string().nullable().optional(),
  icon: z.string().nullable().optional(),
});
export type AppProfile = z.infer<typeof AppProfileSchema>;

export const LLMPromptSchema = z.object({
  id: z.string(),
  name: z.string(),
  prompt: z.string(),
  model_id: z.string().optional(),
  alias: z.string().optional().nullable(),
  icon: z.string().optional().nullable(),
});

export type LLMPrompt = z.infer<typeof LLMPromptSchema>;

export const ModelTypeSchema = z.enum(["text", "asr", "other"]);
export type ModelType = z.infer<typeof ModelTypeSchema>;

export const CachedModelSchema = z.object({
  id: z.string(),
  name: z.string(),
  model_type: ModelTypeSchema,
  provider_id: z.string(),
  model_id: z.string(),
  added_at: z.string(),
  custom_label: z.string().optional(),
});

export type CachedModel = z.infer<typeof CachedModelSchema>;

export const PostProcessProviderSchema = z.object({
  id: z.string(),
  label: z.string(),
  base_url: z.string(),
  allow_base_url_edit: z.boolean().optional().default(false),
  models_endpoint: z.string().nullable().optional(),
  kind: z
    .enum(["openai_compatible", "anthropic"])
    .optional()
    .default("openai_compatible"),
});

export type PostProcessProvider = z.infer<typeof PostProcessProviderSchema>;

export const SettingsSchema = z.object({
  bindings: ShortcutBindingsMapSchema,
  push_to_talk: z.boolean(),
  audio_feedback: z.boolean(),
  audio_feedback_volume: z.number().optional().default(1.0),
  sound_theme: z
    .enum(["marimba", "pop", "custom"])
    .optional()
    .default("marimba"),
  start_hidden: z.boolean().optional().default(false),
  autostart_enabled: z.boolean().optional().default(false),
  update_checks_enabled: z.boolean().optional().default(true),
  onboarding_completed: z.boolean().optional().default(false),
  selected_model: z.string(),
  always_on_microphone: z.boolean(),
  selected_microphone: z.string().nullable().optional(),
  clamshell_microphone: z.string().nullable().optional(),
  selected_output_device: z.string().nullable().optional(),
  translate_to_english: z.boolean(),
  selected_language: z.string(),
  overlay_position: OverlayPositionSchema,
  debug_mode: z.boolean(),
  log_level: LogLevelSchema.optional().default(2),
  custom_words: z.array(z.string()).optional().default([]),
  model_unload_timeout: ModelUnloadTimeoutSchema.optional().default("never"),
  word_correction_threshold: z.number().optional().default(0.18),
  history_limit: z.number().optional().default(5),
  recording_retention_period:
    RecordingRetentionPeriodSchema.optional().default("preserve_limit"),
  paste_method: PasteMethodSchema.optional().default("ctrl_v"),
  clipboard_handling: ClipboardHandlingSchema.optional().default("dont_modify"),
  post_process_enabled: z.boolean().optional().default(false),
  post_process_use_secondary_output: z.boolean().optional().default(false),
  post_process_use_local_candidate_when_online_asr: z
    .boolean()
    .optional()
    .default(false),
  post_process_secondary_model_id: z
    .string()
    .nullable()
    .optional()
    .default(null),
  post_process_provider_id: z.string().optional().default("openai"),
  post_process_providers: z
    .array(PostProcessProviderSchema)
    .optional()
    .default([]),
  post_process_api_keys: z.record(z.string()).optional().default({}),
  post_process_models: z.record(z.string()).optional().default({}),
  post_process_prompts: z.array(LLMPromptSchema).optional().default([]),
  post_process_selected_prompt_id: z.string().nullable().optional(),
  command_prefixes: z.string().nullable().optional(),
  cached_models: z.array(CachedModelSchema).optional().default([]),
  online_asr_enabled: z.boolean().optional().default(false),
  selected_asr_model_id: z.string().nullable().optional(),
  selected_prompt_model_id: z.string().nullable().optional(),
  mute_while_recording: z.boolean().optional().default(false),
  append_trailing_space: z.boolean().optional().default(false),
  sense_voice_use_itn: z.boolean().optional().default(true),
  punctuation_enabled: z.boolean().optional().default(false),
  punctuation_model: z
    .string()
    .optional()
    .default("punct-zh-en-ct-transformer-2024-04-12-int8"),
  favorite_transcription_models: z.array(z.string()).optional().default([]),
  offline_vad_force_interval_ms: z.number().optional().default(2000),
  offline_vad_force_window_seconds: z.number().optional().default(30),
  confidence_check_enabled: z.boolean().optional().default(false),
  confidence_threshold: z.number().min(0).max(100).optional().default(20),
  app_review_policies: z
    .record(z.string(), AppReviewPolicySchema)
    .optional()
    .default({}),
  app_profiles: z.array(AppProfileSchema).optional().default([]),
  app_to_profile: z.record(z.string(), z.string()).optional().default({}),
  post_process_context_enabled: z.boolean().optional().default(false),
  post_process_context_limit: z.number().min(1).max(10).optional().default(3),
});

export const BindingResponseSchema = z.object({
  success: z.boolean(),
  binding: ShortcutBindingSchema.nullable(),
  error: z.string().nullable(),
});

export type AudioDevice = z.infer<typeof AudioDeviceSchema>;
export type BindingResponse = z.infer<typeof BindingResponseSchema>;
export type ShortcutBinding = z.infer<typeof ShortcutBindingSchema>;
export type ShortcutBindingsMap = z.infer<typeof ShortcutBindingsMapSchema>;
export type Settings = z.infer<typeof SettingsSchema>;

export const ModelInfoSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  filename: z.string(),
  url: z.string().optional(),
  size_mb: z.number(),
  is_downloaded: z.boolean(),
  is_downloading: z.boolean(),
  partial_size: z.number(),
  is_directory: z.boolean(),
  engine_type: z.enum([
    "Whisper",
    "Parakeet",
    "SherpaOnnx",
    "SherpaOnnxPunctuation",
  ]),
  sherpa: z
    .object({
      mode: z.enum(["Streaming", "Offline"]),
      family: z.enum([
        "Transducer",
        "Zipformer2Ctc",
        "Paraformer",
        "SenseVoice",
        "FireRedAsr",
      ]),
      prefer_int8: z.boolean(),
    })
    .optional(),
  accuracy_score: z.number(),
  speed_score: z.number(),
  tags: z.array(z.string()).optional(),
  is_default: z.boolean().default(false),
});

export type ModelInfo = z.infer<typeof ModelInfoSchema>;

// =============================================================================
// Model Download/State Types (shared between hooks and components)
// =============================================================================

export interface DownloadProgress {
  model_id: string;
  downloaded: number;
  total: number;
  percentage: number;
}

export interface DownloadStats {
  startTime: number;
  lastUpdate: number;
  totalDownloaded: number;
  speed: number;
}

export interface ModelStateEvent {
  event_type: string;
  model_id?: string;
  model_name?: string;
  error?: string;
}

export type ModelStatus =
  | "ready"
  | "loading"
  | "downloading"
  | "extracting"
  | "error"
  | "unloaded"
  | "none";
