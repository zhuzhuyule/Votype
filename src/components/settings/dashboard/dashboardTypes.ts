export interface HistoryEntry {
  id: number;
  file_name: string;
  timestamp: number;
  saved: boolean;
  title: string;
  transcription_text: string;
  streaming_text?: string | null;
  streaming_asr_model?: string | null;
  post_processed_text?: string | null;
  post_process_prompt?: string | null;
  post_process_prompt_id?: string | null;
  post_process_model?: string | null;
  duration_ms?: number | null;
  char_count?: number | null;
  corrected_char_count?: number | null;
  transcription_ms?: number | null;
  language?: string | null;
  asr_model?: string | null;
  app_name?: string | null;
  window_title?: string | null;
  deleted: boolean;
  /** Whether the audio file has been deleted (for space cleanup) */
  audio_deleted: boolean;
}

export type DashboardSelection =
  | { type: "preset"; preset: "7d" | "30d" | "40d" | "all" }
  | { type: "day"; day: string };

export interface PaginatedHistoryResult {
  entries: HistoryEntry[];
  total_count: number;
  offset: number;
  limit: number;
}
