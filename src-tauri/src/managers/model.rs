use crate::settings::{get_settings, write_settings};
use anyhow::Result;
use flate2::read::GzDecoder;
use futures_util::StreamExt;
use log::{debug, info, warn};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::fs::File;
use std::io::{Read, Write};
use std::path::Path;
use std::path::PathBuf;
use std::sync::Mutex;
use tar::Archive;
use tauri::{AppHandle, Emitter, Manager};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum EngineType {
    Whisper,
    Parakeet,
    SherpaOnnx,
    SherpaOnnxPunctuation,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum SherpaOnnxAsrMode {
    Streaming,
    Offline,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum SherpaOnnxAsrFamily {
    /// Online transducer (e.g. streaming zipformer) via encoder/decoder/joiner.
    Transducer,
    /// Online paraformer via encoder/decoder.
    Paraformer,
    /// Offline SenseVoice via `model.onnx`.
    SenseVoice,
    /// Offline FireRedASR via encoder/decoder.
    FireRedAsr,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SherpaOnnxModelSpec {
    pub mode: SherpaOnnxAsrMode,
    pub family: SherpaOnnxAsrFamily,
    /// Whether to prefer int8 variants when searching for model files.
    pub prefer_int8: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelInfo {
    pub id: String,
    pub name: String,
    pub description: String,
    pub filename: String,
    pub url: Option<String>,
    pub size_mb: u64,
    pub is_downloaded: bool,
    pub is_downloading: bool,
    pub partial_size: u64,
    pub is_directory: bool,
    pub engine_type: EngineType,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sherpa: Option<SherpaOnnxModelSpec>,
    pub accuracy_score: f32, // 0.0 to 1.0, higher is more accurate
    pub speed_score: f32,    // 0.0 to 1.0, higher is faster
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct UserModelEntry {
    id: String,
    name: String,
    description: String,
    filename: String,
    url: String,
    size_mb: u64,
    is_directory: bool,
    engine_type: EngineType,
    sherpa: Option<SherpaOnnxModelSpec>,
    accuracy_score: f32,
    speed_score: f32,
}

impl UserModelEntry {
    fn into_model_info(self) -> ModelInfo {
        ModelInfo {
            id: self.id,
            name: self.name,
            description: self.description,
            filename: self.filename,
            url: Some(self.url),
            size_mb: self.size_mb,
            is_downloaded: false,
            is_downloading: false,
            partial_size: 0,
            is_directory: self.is_directory,
            engine_type: self.engine_type,
            sherpa: self.sherpa,
            accuracy_score: self.accuracy_score,
            speed_score: self.speed_score,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DownloadProgress {
    pub model_id: String,
    pub downloaded: u64,
    pub total: u64,
    pub percentage: f64,
}

pub struct ModelManager {
    app_handle: AppHandle,
    models_dir: PathBuf,
    user_catalog_path: PathBuf,
    available_models: Mutex<HashMap<String, ModelInfo>>,
}

impl ModelManager {
    fn read_user_catalog(path: &Path) -> Result<Vec<UserModelEntry>> {
        if !path.exists() {
            return Ok(Vec::new());
        }
        let data = fs::read_to_string(path)?;
        if data.trim().is_empty() {
            return Ok(Vec::new());
        }
        Ok(serde_json::from_str::<Vec<UserModelEntry>>(&data)?)
    }

    fn write_user_catalog(path: &Path, entries: &[UserModelEntry]) -> Result<()> {
        let json = serde_json::to_string_pretty(entries)?;
        fs::write(path, json)?;
        Ok(())
    }

    fn filename_from_url(url: &str) -> Result<String> {
        let without_query = url.split('?').next().unwrap_or(url);
        let filename = without_query
            .split('/')
            .filter(|s| !s.is_empty())
            .last()
            .ok_or_else(|| anyhow::anyhow!("URL missing filename"))?;
        Ok(filename.to_string())
    }

    fn strip_archive_extensions(name: &str) -> String {
        let mut s = name.to_string();
        for ext in [".tar.bz2", ".tar.gz", ".tgz"] {
            if s.ends_with(ext) {
                s.truncate(s.len() - ext.len());
                return s;
            }
        }
        s
    }

    fn strip_known_prefixes(name: &str) -> String {
        let s = name.trim();
        let s = s.strip_prefix("sherpa-onnx-").unwrap_or(s);
        s.to_string()
    }

    fn infer_sherpa_spec_from_name(name: &str) -> Option<SherpaOnnxModelSpec> {
        let lower = name.to_lowercase();
        let prefer_int8 = lower.contains("int8");
        let mode = if lower.contains("streaming") {
            SherpaOnnxAsrMode::Streaming
        } else {
            SherpaOnnxAsrMode::Offline
        };
        let family = if lower.contains("sense-voice") {
            SherpaOnnxAsrFamily::SenseVoice
        } else if lower.contains("fire-red-asr") {
            SherpaOnnxAsrFamily::FireRedAsr
        } else if lower.contains("paraformer") {
            SherpaOnnxAsrFamily::Paraformer
        } else {
            SherpaOnnxAsrFamily::Transducer
        };
        Some(SherpaOnnxModelSpec {
            mode,
            family,
            prefer_int8,
        })
    }

    fn infer_engine_type_from_name(name: &str) -> EngineType {
        let lower = name.to_lowercase();
        if lower.contains("punct") || lower.contains("punctuation") {
            EngineType::SherpaOnnxPunctuation
        } else {
            EngineType::SherpaOnnx
        }
    }

    fn unique_model_id(models: &HashMap<String, ModelInfo>, preferred: &str) -> Result<String> {
        if !models.contains_key(preferred) {
            return Ok(preferred.to_string());
        }
        for i in 2..=9999u32 {
            let candidate = format!("{}-{}", preferred, i);
            if !models.contains_key(&candidate) {
                return Ok(candidate);
            }
        }
        Err(anyhow::anyhow!("Unable to allocate a unique model id"))
    }

    pub fn new(app_handle: &AppHandle) -> Result<Self> {
        // Create models directory in app data
        let models_dir = app_handle
            .path()
            .app_data_dir()
            .map_err(|e| anyhow::anyhow!("Failed to get app data dir: {}", e))?
            .join("models");

        if !models_dir.exists() {
            fs::create_dir_all(&models_dir)?;
        }

        let user_catalog_path = models_dir.join("catalog.user.json");

        let mut available_models = HashMap::new();

        // TODO this should be read from a JSON file or something..
        available_models.insert(
            "small".to_string(),
            ModelInfo {
                id: "small".to_string(),
                name: "Whisper Small".to_string(),
                description: "models.small.description".to_string(),
                filename: "ggml-small.bin".to_string(),
                url: Some("https://blob.handy.computer/ggml-small.bin".to_string()),
                size_mb: 487,
                is_downloaded: false,
                is_downloading: false,
                partial_size: 0,
                is_directory: false,
                engine_type: EngineType::Whisper,
                sherpa: None,
                accuracy_score: 0.60,
                speed_score: 0.85,
            },
        );

        // Add downloadable models
        available_models.insert(
            "medium".to_string(),
            ModelInfo {
                id: "medium".to_string(),
                name: "Whisper Medium".to_string(),
                description: "models.medium.description".to_string(),
                filename: "whisper-medium-q4_1.bin".to_string(),
                url: Some("https://blob.handy.computer/whisper-medium-q4_1.bin".to_string()),
                size_mb: 492, // Approximate size
                is_downloaded: false,
                is_downloading: false,
                partial_size: 0,
                is_directory: false,
                engine_type: EngineType::Whisper,
                sherpa: None,
                accuracy_score: 0.75,
                speed_score: 0.60,
            },
        );

        available_models.insert(
            "turbo".to_string(),
            ModelInfo {
                id: "turbo".to_string(),
                name: "Whisper Turbo".to_string(),
                description: "models.turbo.description".to_string(),
                filename: "ggml-large-v3-turbo.bin".to_string(),
                url: Some("https://blob.handy.computer/ggml-large-v3-turbo.bin".to_string()),
                size_mb: 1600, // Approximate size
                is_downloaded: false,
                is_downloading: false,
                partial_size: 0,
                is_directory: false,
                engine_type: EngineType::Whisper,
                sherpa: None,
                accuracy_score: 0.80,
                speed_score: 0.40,
            },
        );

        available_models.insert(
            "large".to_string(),
            ModelInfo {
                id: "large".to_string(),
                name: "Whisper Large".to_string(),
                description: "models.large.description".to_string(),
                filename: "ggml-large-v3-q5_0.bin".to_string(),
                url: Some("https://blob.handy.computer/ggml-large-v3-q5_0.bin".to_string()),
                size_mb: 1100, // Approximate size
                is_downloaded: false,
                is_downloading: false,
                partial_size: 0,
                is_directory: false,
                engine_type: EngineType::Whisper,
                sherpa: None,
                accuracy_score: 0.85,
                speed_score: 0.30,
            },
        );

        // Add NVIDIA Parakeet models (directory-based)
        available_models.insert(
            "parakeet-tdt-0.6b-v2".to_string(),
            ModelInfo {
                id: "parakeet-tdt-0.6b-v2".to_string(),
                name: "Parakeet V2".to_string(),
                description: "models.parakeet-tdt-0.6b-v2.description".to_string(),
                filename: "parakeet-tdt-0.6b-v2-int8".to_string(), // Directory name
                url: Some("https://blob.handy.computer/parakeet-v2-int8.tar.gz".to_string()),
                size_mb: 473, // Approximate size for int8 quantized model
                is_downloaded: false,
                is_downloading: false,
                partial_size: 0,
                is_directory: true,
                engine_type: EngineType::Parakeet,
                sherpa: None,
                accuracy_score: 0.85,
                speed_score: 0.85,
            },
        );

        available_models.insert(
            "parakeet-tdt-0.6b-v3".to_string(),
            ModelInfo {
                id: "parakeet-tdt-0.6b-v3".to_string(),
                name: "Parakeet V3".to_string(),
                description: "models.parakeet-tdt-0.6b-v3.description".to_string(),
                filename: "parakeet-tdt-0.6b-v3-int8".to_string(), // Directory name
                url: Some("https://blob.handy.computer/parakeet-v3-int8.tar.gz".to_string()),
                size_mb: 478, // Approximate size for int8 quantized model
                is_downloaded: false,
                is_downloading: false,
                partial_size: 0,
                is_directory: true,
                engine_type: EngineType::Parakeet,
                sherpa: None,
                accuracy_score: 0.80,
                speed_score: 0.85,
            },
        );

        available_models.insert(
            "sherpa-zipformer-zh-int8-2025-06-30".to_string(),
            ModelInfo {
                id: "sherpa-zipformer-zh-int8-2025-06-30".to_string(),
                name: "Sherpa Chinese".to_string(),
                description: "models.sherpa-zipformer-zh-int8-2025-06-30.description".to_string(),
                filename: "sherpa-onnx-streaming-zipformer-zh-int8-2025-06-30".to_string(),
                url: Some("https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-streaming-zipformer-zh-int8-2025-06-30.tar.bz2".to_string()),
                size_mb: 127,
                is_downloaded: false,
                is_downloading: false,
                partial_size: 0,
                is_directory: true,
                engine_type: EngineType::SherpaOnnx,
                sherpa: Some(SherpaOnnxModelSpec {
                    mode: SherpaOnnxAsrMode::Streaming,
                    family: SherpaOnnxAsrFamily::Transducer,
                    prefer_int8: true,
                }),
                accuracy_score: 0.82,
                speed_score: 0.97,
            },
        );

        available_models.insert(
            "sherpa-zipformer-zh-xlarge-int8-2025-06-30".to_string(),
            ModelInfo {
                id: "sherpa-zipformer-zh-xlarge-int8-2025-06-30".to_string(),
                name: "Sherpa Chinese XL".to_string(),
                description: "models.sherpa-zipformer-zh-xlarge-int8-2025-06-30.description"
                    .to_string(),
                filename: "sherpa-onnx-streaming-zipformer-zh-xlarge-int8-2025-06-30".to_string(),
                url: Some("https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-streaming-zipformer-zh-xlarge-int8-2025-06-30.tar.bz2".to_string()),
                size_mb: 570,
                is_downloaded: false,
                is_downloading: false,
                partial_size: 0,
                is_directory: true,
                engine_type: EngineType::SherpaOnnx,
                sherpa: Some(SherpaOnnxModelSpec {
                    mode: SherpaOnnxAsrMode::Streaming,
                    family: SherpaOnnxAsrFamily::Transducer,
                    prefer_int8: true,
                }),
                accuracy_score: 0.90,
                speed_score: 0.70,
            },
        );

        available_models.insert(
            "sherpa-zipformer-en-kroko-2025-08-06".to_string(),
            ModelInfo {
                id: "sherpa-zipformer-en-kroko-2025-08-06".to_string(),
                name: "Sherpa English".to_string(),
                description: "models.sherpa-zipformer-en-kroko-2025-08-06.description".to_string(),
                filename: "sherpa-onnx-streaming-zipformer-en-kroko-2025-08-06".to_string(),
                url: Some("https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-streaming-zipformer-en-kroko-2025-08-06.tar.bz2".to_string()),
                size_mb: 55,
                is_downloaded: false,
                is_downloading: false,
                partial_size: 0,
                is_directory: true,
                engine_type: EngineType::SherpaOnnx,
                sherpa: Some(SherpaOnnxModelSpec {
                    mode: SherpaOnnxAsrMode::Streaming,
                    family: SherpaOnnxAsrFamily::Transducer,
                    prefer_int8: false,
                }),
                accuracy_score: 0.78,
                speed_score: 0.98,
            },
        );

        available_models.insert(
            "sherpa-zipformer-de-kroko-2025-08-06".to_string(),
            ModelInfo {
                id: "sherpa-zipformer-de-kroko-2025-08-06".to_string(),
                name: "Sherpa German".to_string(),
                description: "models.sherpa-zipformer-de-kroko-2025-08-06.description".to_string(),
                filename: "sherpa-onnx-streaming-zipformer-de-kroko-2025-08-06".to_string(),
                url: Some("https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-streaming-zipformer-de-kroko-2025-08-06.tar.bz2".to_string()),
                size_mb: 55,
                is_downloaded: false,
                is_downloading: false,
                partial_size: 0,
                is_directory: true,
                engine_type: EngineType::SherpaOnnx,
                sherpa: Some(SherpaOnnxModelSpec {
                    mode: SherpaOnnxAsrMode::Streaming,
                    family: SherpaOnnxAsrFamily::Transducer,
                    prefer_int8: false,
                }),
                accuracy_score: 0.78,
                speed_score: 0.98,
            },
        );

        available_models.insert(
            "sherpa-zipformer-es-kroko-2025-08-06".to_string(),
            ModelInfo {
                id: "sherpa-zipformer-es-kroko-2025-08-06".to_string(),
                name: "Sherpa Spanish".to_string(),
                description: "models.sherpa-zipformer-es-kroko-2025-08-06.description".to_string(),
                filename: "sherpa-onnx-streaming-zipformer-es-kroko-2025-08-06".to_string(),
                url: Some("https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-streaming-zipformer-es-kroko-2025-08-06.tar.bz2".to_string()),
                size_mb: 119,
                is_downloaded: false,
                is_downloading: false,
                partial_size: 0,
                is_directory: true,
                engine_type: EngineType::SherpaOnnx,
                sherpa: Some(SherpaOnnxModelSpec {
                    mode: SherpaOnnxAsrMode::Streaming,
                    family: SherpaOnnxAsrFamily::Transducer,
                    prefer_int8: false,
                }),
                accuracy_score: 0.80,
                speed_score: 0.95,
            },
        );

        available_models.insert(
            "sherpa-zipformer-fr-kroko-2025-08-06".to_string(),
            ModelInfo {
                id: "sherpa-zipformer-fr-kroko-2025-08-06".to_string(),
                name: "Sherpa French".to_string(),
                description: "models.sherpa-zipformer-fr-kroko-2025-08-06.description".to_string(),
                filename: "sherpa-onnx-streaming-zipformer-fr-kroko-2025-08-06".to_string(),
                url: Some("https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-streaming-zipformer-fr-kroko-2025-08-06.tar.bz2".to_string()),
                size_mb: 55,
                is_downloaded: false,
                is_downloading: false,
                partial_size: 0,
                is_directory: true,
                engine_type: EngineType::SherpaOnnx,
                sherpa: Some(SherpaOnnxModelSpec {
                    mode: SherpaOnnxAsrMode::Streaming,
                    family: SherpaOnnxAsrFamily::Transducer,
                    prefer_int8: false,
                }),
                accuracy_score: 0.78,
                speed_score: 0.98,
            },
        );

        available_models.insert(
            "sherpa-zipformer-ru-vosk-int8-2025-08-16".to_string(),
            ModelInfo {
                id: "sherpa-zipformer-ru-vosk-int8-2025-08-16".to_string(),
                name: "Sherpa Russian".to_string(),
                description: "models.sherpa-zipformer-ru-vosk-int8-2025-08-16.description"
                    .to_string(),
                filename: "sherpa-onnx-streaming-zipformer-small-ru-vosk-int8-2025-08-16"
                    .to_string(),
                url: Some("https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-streaming-zipformer-small-ru-vosk-int8-2025-08-16.tar.bz2".to_string()),
                size_mb: 23,
                is_downloaded: false,
                is_downloading: false,
                partial_size: 0,
                is_directory: true,
                engine_type: EngineType::SherpaOnnx,
                sherpa: Some(SherpaOnnxModelSpec {
                    mode: SherpaOnnxAsrMode::Streaming,
                    family: SherpaOnnxAsrFamily::Transducer,
                    prefer_int8: true,
                }),
                accuracy_score: 0.70,
                speed_score: 0.99,
            },
        );

        available_models.insert(
            "sherpa-paraformer-zh-en-streaming".to_string(),
            ModelInfo {
                id: "sherpa-paraformer-zh-en-streaming".to_string(),
                name: "Sherpa Chinese + English Paraformer".to_string(),
                description: "models.sherpa-paraformer-zh-en-streaming.description".to_string(),
                filename: "sherpa-onnx-streaming-paraformer-bilingual-zh-en".to_string(),
                url: Some("https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-streaming-paraformer-bilingual-zh-en.tar.bz2".to_string()),
                size_mb: 1000,
                is_downloaded: false,
                is_downloading: false,
                partial_size: 0,
                is_directory: true,
                engine_type: EngineType::SherpaOnnx,
                sherpa: Some(SherpaOnnxModelSpec {
                    mode: SherpaOnnxAsrMode::Streaming,
                    family: SherpaOnnxAsrFamily::Paraformer,
                    prefer_int8: false,
                }),
                accuracy_score: 0.84,
                speed_score: 0.92,
            },
        );

        // Punctuation (post-processing): zh+en mixed.
        available_models.insert(
            "punct-zh-en-ct-transformer-2024-04-12-int8".to_string(),
            ModelInfo {
                id: "punct-zh-en-ct-transformer-2024-04-12-int8".to_string(),
                name: "Punctuation Chinese + English".to_string(),
                description: "models.punct-zh-en-ct-transformer-2024-04-12-int8.description"
                    .to_string(),
                filename: "sherpa-onnx-punct-ct-transformer-zh-en-vocab272727-2024-04-12-int8"
                    .to_string(),
                url: Some("https://github.com/k2-fsa/sherpa-onnx/releases/download/punctuation-models/sherpa-onnx-punct-ct-transformer-zh-en-vocab272727-2024-04-12-int8.tar.bz2".to_string()),
                size_mb: 62,
                is_downloaded: false,
                is_downloading: false,
                partial_size: 0,
                is_directory: true,
                engine_type: EngineType::SherpaOnnxPunctuation,
                sherpa: None,
                accuracy_score: 0.80,
                speed_score: 0.95,
            },
        );

        available_models.insert(
            "punct-zh-en-ct-transformer-2024-04-12".to_string(),
            ModelInfo {
                id: "punct-zh-en-ct-transformer-2024-04-12".to_string(),
                name: "Punctuation Chinese + English (Large)".to_string(),
                description: "models.punct-zh-en-ct-transformer-2024-04-12.description".to_string(),
                filename: "sherpa-onnx-punct-ct-transformer-zh-en-vocab272727-2024-04-12"
                    .to_string(),
                url: Some("https://github.com/k2-fsa/sherpa-onnx/releases/download/punctuation-models/sherpa-onnx-punct-ct-transformer-zh-en-vocab272727-2024-04-12.tar.bz2".to_string()),
                size_mb: 266,
                is_downloaded: false,
                is_downloading: false,
                partial_size: 0,
                is_directory: true,
                engine_type: EngineType::SherpaOnnxPunctuation,
                sherpa: None,
                accuracy_score: 0.88,
                speed_score: 0.70,
            },
        );

        available_models.insert(
            "sherpa-sensevoice-zh-en-ja-ko-yue-int8-2025-09-09".to_string(),
            ModelInfo {
                id: "sherpa-sensevoice-zh-en-ja-ko-yue-int8-2025-09-09".to_string(),
                name: "Sherpa SenseVoice Multilingual".to_string(),
                description:
                    "models.sherpa-sensevoice-zh-en-ja-ko-yue-int8-2025-09-09.description"
                        .to_string(),
                filename: "sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2025-09-09".to_string(),
                url: Some("https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2025-09-09.tar.bz2".to_string()),
                size_mb: 166,
                is_downloaded: false,
                is_downloading: false,
                partial_size: 0,
                is_directory: true,
                engine_type: EngineType::SherpaOnnx,
                sherpa: Some(SherpaOnnxModelSpec {
                    mode: SherpaOnnxAsrMode::Offline,
                    family: SherpaOnnxAsrFamily::SenseVoice,
                    prefer_int8: true,
                }),
                accuracy_score: 0.87,
                speed_score: 0.75,
            },
        );

        // Offline Paraformer (non-streaming): Chinese / trilingual.
        available_models.insert(
            "sherpa-paraformer-zh-int8-2025-10-07".to_string(),
            ModelInfo {
                id: "sherpa-paraformer-zh-int8-2025-10-07".to_string(),
                name: "Sherpa Paraformer Chinese".to_string(),
                description: "models.sherpa-paraformer-zh-int8-2025-10-07.description".to_string(),
                filename: "sherpa-onnx-paraformer-zh-int8-2025-10-07".to_string(),
                url: Some("https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-paraformer-zh-int8-2025-10-07.tar.bz2".to_string()),
                size_mb: 218,
                is_downloaded: false,
                is_downloading: false,
                partial_size: 0,
                is_directory: true,
                engine_type: EngineType::SherpaOnnx,
                sherpa: Some(SherpaOnnxModelSpec {
                    mode: SherpaOnnxAsrMode::Offline,
                    family: SherpaOnnxAsrFamily::Paraformer,
                    prefer_int8: true,
                }),
                accuracy_score: 0.82,
                speed_score: 0.95,
            },
        );

        available_models.insert(
            "sherpa-paraformer-zh-small-2024-03-09".to_string(),
            ModelInfo {
                id: "sherpa-paraformer-zh-small-2024-03-09".to_string(),
                name: "Sherpa Paraformer Chinese (Small)".to_string(),
                description: "models.sherpa-paraformer-zh-small-2024-03-09.description".to_string(),
                filename: "sherpa-onnx-paraformer-zh-small-2024-03-09".to_string(),
                url: Some("https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-paraformer-zh-small-2024-03-09.tar.bz2".to_string()),
                size_mb: 75,
                is_downloaded: false,
                is_downloading: false,
                partial_size: 0,
                is_directory: true,
                engine_type: EngineType::SherpaOnnx,
                sherpa: Some(SherpaOnnxModelSpec {
                    mode: SherpaOnnxAsrMode::Offline,
                    family: SherpaOnnxAsrFamily::Paraformer,
                    prefer_int8: false,
                }),
                accuracy_score: 0.78,
                speed_score: 0.97,
            },
        );

        available_models.insert(
            "sherpa-paraformer-trilingual-zh-cantonese-en".to_string(),
            ModelInfo {
                id: "sherpa-paraformer-trilingual-zh-cantonese-en".to_string(),
                name: "Sherpa Paraformer Zh+Yue+En".to_string(),
                description: "models.sherpa-paraformer-trilingual-zh-cantonese-en.description"
                    .to_string(),
                filename: "sherpa-onnx-paraformer-trilingual-zh-cantonese-en".to_string(),
                url: Some("https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-paraformer-trilingual-zh-cantonese-en.tar.bz2".to_string()),
                size_mb: 1011,
                is_downloaded: false,
                is_downloading: false,
                partial_size: 0,
                is_directory: true,
                engine_type: EngineType::SherpaOnnx,
                sherpa: Some(SherpaOnnxModelSpec {
                    mode: SherpaOnnxAsrMode::Offline,
                    family: SherpaOnnxAsrFamily::Paraformer,
                    prefer_int8: false,
                }),
                accuracy_score: 0.80,
                speed_score: 0.93,
            },
        );

        // Merge user-provided catalog entries.
        if let Ok(user_entries) = Self::read_user_catalog(&user_catalog_path) {
            for entry in user_entries {
                let model = entry.into_model_info();
                available_models.entry(model.id.clone()).or_insert(model);
            }
        }

        let manager = Self {
            app_handle: app_handle.clone(),
            models_dir,
            user_catalog_path,
            available_models: Mutex::new(available_models),
        };

        // Migrate any bundled models to user directory
        manager.migrate_bundled_models()?;

        // Check which models are already downloaded
        manager.update_download_status()?;

        // Auto-select a model if none is currently selected
        manager.auto_select_model_if_needed()?;

        Ok(manager)
    }

    pub fn add_model_from_url(&self, url: String) -> Result<String> {
        if !url.starts_with("http://") && !url.starts_with("https://") {
            return Err(anyhow::anyhow!("URL must start with http:// or https://"));
        }

        let archive_name = Self::filename_from_url(&url)?;
        let base_name = Self::strip_archive_extensions(&archive_name);
        let is_directory = archive_name.ends_with(".tar.gz")
            || archive_name.ends_with(".tgz")
            || archive_name.ends_with(".tar.bz2")
            || archive_name.ends_with(".bz2");
        let filename = if is_directory {
            base_name.clone()
        } else {
            archive_name.clone()
        };

        let preferred_id = Self::strip_known_prefixes(&base_name);
        let final_id = {
            let models = self.available_models.lock().unwrap();
            if models.contains_key(&preferred_id) {
                return Ok(preferred_id);
            }
            Self::unique_model_id(&models, &preferred_id)?
        };

        let entry = UserModelEntry {
            id: final_id.clone(),
            name: preferred_id.replace('-', " "),
            description: "modelSelector.userAddedModel".to_string(),
            filename,
            url: url.clone(),
            size_mb: 0,
            is_directory,
            engine_type: Self::infer_engine_type_from_name(&base_name),
            sherpa: Self::infer_sherpa_spec_from_name(&base_name),
            accuracy_score: 0.8,
            speed_score: 0.8,
        };

        let mut entries = Self::read_user_catalog(&self.user_catalog_path)?;
        entries.push(entry.clone());
        Self::write_user_catalog(&self.user_catalog_path, &entries)?;

        {
            let mut models = self.available_models.lock().unwrap();
            models.insert(final_id.clone(), entry.into_model_info());
        }
        self.update_download_status()?;

        Ok(final_id)
    }

    pub fn get_available_models(&self) -> Vec<ModelInfo> {
        let models = self.available_models.lock().unwrap();
        models.values().cloned().collect()
    }

    pub fn get_model_info(&self, model_id: &str) -> Option<ModelInfo> {
        let models = self.available_models.lock().unwrap();
        models.get(model_id).cloned()
    }

    fn migrate_bundled_models(&self) -> Result<()> {
        // Check for bundled models and copy them to user directory
        let bundled_models = ["ggml-small.bin"]; // Add other bundled models here if any

        for filename in &bundled_models {
            let bundled_path = self.app_handle.path().resolve(
                &format!("resources/models/{}", filename),
                tauri::path::BaseDirectory::Resource,
            );

            if let Ok(bundled_path) = bundled_path {
                if bundled_path.exists() {
                    let user_path = self.models_dir.join(filename);

                    // Only copy if user doesn't already have the model
                    if !user_path.exists() {
                        info!("Migrating bundled model {} to user directory", filename);
                        fs::copy(&bundled_path, &user_path)?;
                        info!("Successfully migrated {}", filename);
                    }
                }
            }
        }

        Ok(())
    }

    fn update_download_status(&self) -> Result<()> {
        let mut models = self.available_models.lock().unwrap();

        for model in models.values_mut() {
            if model.is_directory {
                // For directory-based models, check if the directory exists
                let model_path = self.models_dir.join(&model.filename);
                let partial_path = self.models_dir.join(format!("{}.partial", &model.filename));
                let extracting_path = self
                    .models_dir
                    .join(format!("{}.extracting", &model.filename));

                // Clean up any leftover .extracting directories from interrupted extractions
                if extracting_path.exists() {
                    warn!("Cleaning up interrupted extraction for model: {}", model.id);
                    let _ = fs::remove_dir_all(&extracting_path);
                }

                model.is_downloaded = model_path.exists() && model_path.is_dir();
                model.is_downloading = false;

                // Get partial file size if it exists (for the .tar.gz being downloaded)
                if partial_path.exists() {
                    model.partial_size = partial_path.metadata().map(|m| m.len()).unwrap_or(0);
                } else {
                    model.partial_size = 0;
                }
            } else {
                // For file-based models (existing logic)
                let model_path = self.models_dir.join(&model.filename);
                let partial_path = self.models_dir.join(format!("{}.partial", &model.filename));

                model.is_downloaded = model_path.exists();
                model.is_downloading = false;

                // Get partial file size if it exists
                if partial_path.exists() {
                    model.partial_size = partial_path.metadata().map(|m| m.len()).unwrap_or(0);
                } else {
                    model.partial_size = 0;
                }
            }
        }

        Ok(())
    }

    fn auto_select_model_if_needed(&self) -> Result<()> {
        // Check if we have a selected model in settings
        let settings = get_settings(&self.app_handle);

        // If no model is selected or selected model is empty
        if settings.selected_model.is_empty() {
            // Find the first available (downloaded) model
            let models = self.available_models.lock().unwrap();
            if let Some(available_model) = models.values().find(|model| model.is_downloaded) {
                info!(
                    "Auto-selecting model: {} ({})",
                    available_model.id, available_model.name
                );

                // Update settings with the selected model
                let mut updated_settings = settings;
                updated_settings.selected_model = available_model.id.clone();
                write_settings(&self.app_handle, updated_settings);

                info!("Successfully auto-selected model: {}", available_model.id);
            }
        }

        Ok(())
    }

    pub async fn download_model(&self, model_id: &str) -> Result<()> {
        let model_info = {
            let models = self.available_models.lock().unwrap();
            models.get(model_id).cloned()
        };

        let model_info =
            model_info.ok_or_else(|| anyhow::anyhow!("Model not found: {}", model_id))?;

        let url = model_info
            .url
            .ok_or_else(|| anyhow::anyhow!("No download URL for model"))?;
        let model_path = self.models_dir.join(&model_info.filename);
        let partial_path = self
            .models_dir
            .join(format!("{}.partial", &model_info.filename));

        // Don't download if complete version already exists
        if model_path.exists() {
            // Clean up any partial file that might exist
            if partial_path.exists() {
                let _ = fs::remove_file(&partial_path);
            }
            self.update_download_status()?;
            return Ok(());
        }

        // Check if we have a partial download to resume
        let mut resume_from = if partial_path.exists() {
            let size = partial_path.metadata()?.len();
            info!("Resuming download of model {} from byte {}", model_id, size);
            size
        } else {
            info!("Starting fresh download of model {} from {}", model_id, url);
            0
        };

        // Mark as downloading
        {
            let mut models = self.available_models.lock().unwrap();
            if let Some(model) = models.get_mut(model_id) {
                model.is_downloading = true;
            }
        }

        // Create HTTP client with range request for resuming
        let client = reqwest::Client::new();
        let mut request = client.get(&url);

        if resume_from > 0 {
            request = request.header("Range", format!("bytes={}-", resume_from));
        }

        let mut response = request.send().await?;

        // If we tried to resume but server returned 200 (not 206 Partial Content),
        // the server doesn't support range requests. Delete partial file and restart
        // fresh to avoid file corruption (appending full file to partial).
        if resume_from > 0 && response.status() == reqwest::StatusCode::OK {
            warn!(
                "Server doesn't support range requests for model {}, restarting download",
                model_id
            );
            drop(response);
            let _ = fs::remove_file(&partial_path);

            // Reset resume_from since we're starting fresh
            resume_from = 0;

            // Restart download without range header
            response = client.get(&url).send().await?;
        }

        // Check for success or partial content status
        if !response.status().is_success()
            && response.status() != reqwest::StatusCode::PARTIAL_CONTENT
        {
            // Mark as not downloading on error
            {
                let mut models = self.available_models.lock().unwrap();
                if let Some(model) = models.get_mut(model_id) {
                    model.is_downloading = false;
                }
            }
            return Err(anyhow::anyhow!(
                "Failed to download model: HTTP {}",
                response.status()
            ));
        }

        let total_size = if resume_from > 0 {
            // For resumed downloads, add the resume point to content length
            resume_from + response.content_length().unwrap_or(0)
        } else {
            response.content_length().unwrap_or(0)
        };

        let mut downloaded = resume_from;
        let mut stream = response.bytes_stream();

        // Open file for appending if resuming, or create new if starting fresh
        let mut file = if resume_from > 0 {
            std::fs::OpenOptions::new()
                .create(true)
                .append(true)
                .open(&partial_path)?
        } else {
            std::fs::File::create(&partial_path)?
        };

        // Emit initial progress
        let initial_progress = DownloadProgress {
            model_id: model_id.to_string(),
            downloaded,
            total: total_size,
            percentage: if total_size > 0 {
                (downloaded as f64 / total_size as f64) * 100.0
            } else {
                0.0
            },
        };
        let _ = self
            .app_handle
            .emit("model-download-progress", &initial_progress);

        // Download with progress
        while let Some(chunk) = stream.next().await {
            let chunk = chunk.map_err(|e| {
                // Mark as not downloading on error
                {
                    let mut models = self.available_models.lock().unwrap();
                    if let Some(model) = models.get_mut(model_id) {
                        model.is_downloading = false;
                    }
                }
                e
            })?;

            file.write_all(&chunk)?;
            downloaded += chunk.len() as u64;

            let percentage = if total_size > 0 {
                (downloaded as f64 / total_size as f64) * 100.0
            } else {
                0.0
            };

            // Emit progress event
            let progress = DownloadProgress {
                model_id: model_id.to_string(),
                downloaded,
                total: total_size,
                percentage,
            };

            let _ = self.app_handle.emit("model-download-progress", &progress);
        }

        file.flush()?;
        drop(file); // Ensure file is closed before moving

        // Verify downloaded file size matches expected size
        if total_size > 0 {
            let actual_size = partial_path.metadata()?.len();
            if actual_size != total_size {
                // Download is incomplete/corrupted - delete partial and return error
                let _ = fs::remove_file(&partial_path);
                {
                    let mut models = self.available_models.lock().unwrap();
                    if let Some(model) = models.get_mut(model_id) {
                        model.is_downloading = false;
                    }
                }
                return Err(anyhow::anyhow!(
                    "Download incomplete: expected {} bytes, got {} bytes",
                    total_size,
                    actual_size
                ));
            }
        }

        // Handle directory-based models (extract tar.gz) vs file-based models
        if model_info.is_directory {
            // Emit extraction started event
            let _ = self.app_handle.emit("model-extraction-started", model_id);
            info!("Extracting archive for directory-based model: {}", model_id);

            // Use a temporary extraction directory to ensure atomic operations
            let temp_extract_dir = self
                .models_dir
                .join(format!("{}.extracting", &model_info.filename));
            let final_model_dir = self.models_dir.join(&model_info.filename);

            // Clean up any previous incomplete extraction
            if temp_extract_dir.exists() {
                let _ = fs::remove_dir_all(&temp_extract_dir);
            }

            // Create temporary extraction directory
            fs::create_dir_all(&temp_extract_dir)?;

            // Open the downloaded archive file
            let archive_file = File::open(&partial_path)?;
            let url_path = url.split('?').next().unwrap_or(&url);
            let reader: Box<dyn Read> = if url_path.ends_with(".bz2") {
                Box::new(bzip2::read::BzDecoder::new(archive_file))
            } else {
                // Default to gzip
                Box::new(GzDecoder::new(archive_file))
            };
            let mut archive = Archive::new(reader);

            // Extract to the temporary directory first
            archive.unpack(&temp_extract_dir).map_err(|e| {
                let error_msg = format!("Failed to extract archive: {}", e);
                // Clean up failed extraction
                let _ = fs::remove_dir_all(&temp_extract_dir);
                let _ = self.app_handle.emit(
                    "model-extraction-failed",
                    &serde_json::json!({
                        "model_id": model_id,
                        "error": error_msg
                    }),
                );
                anyhow::anyhow!(error_msg)
            })?;

            // Find the actual extracted directory (archive might have a nested structure)
            let extracted_dirs: Vec<_> = fs::read_dir(&temp_extract_dir)?
                .filter_map(|entry| entry.ok())
                .filter(|entry| entry.file_type().map(|ft| ft.is_dir()).unwrap_or(false))
                .collect();

            if extracted_dirs.len() == 1 {
                // Single directory extracted, move it to the final location
                let source_dir = extracted_dirs[0].path();
                if final_model_dir.exists() {
                    fs::remove_dir_all(&final_model_dir)?;
                }
                fs::rename(&source_dir, &final_model_dir)?;
                // Clean up temp directory
                let _ = fs::remove_dir_all(&temp_extract_dir);
            } else {
                // Multiple items or no directories, rename the temp directory itself
                if final_model_dir.exists() {
                    fs::remove_dir_all(&final_model_dir)?;
                }
                fs::rename(&temp_extract_dir, &final_model_dir)?;
            }

            info!("Successfully extracted archive for model: {}", model_id);
            // Emit extraction completed event
            let _ = self.app_handle.emit("model-extraction-completed", model_id);

            // Remove the downloaded tar.gz file
            let _ = fs::remove_file(&partial_path);
        } else {
            // Move partial file to final location for file-based models
            fs::rename(&partial_path, &model_path)?;
        }

        // Update download status
        {
            let mut models = self.available_models.lock().unwrap();
            if let Some(model) = models.get_mut(model_id) {
                model.is_downloading = false;
                model.is_downloaded = true;
                model.partial_size = 0;
            }
        }

        // Emit completion event
        let _ = self.app_handle.emit("model-download-complete", model_id);

        info!(
            "Successfully downloaded model {} to {:?}",
            model_id, model_path
        );

        Ok(())
    }

    pub fn delete_model(&self, model_id: &str) -> Result<()> {
        debug!("ModelManager: delete_model called for: {}", model_id);

        let model_info = {
            let models = self.available_models.lock().unwrap();
            models.get(model_id).cloned()
        };

        let model_info =
            model_info.ok_or_else(|| anyhow::anyhow!("Model not found: {}", model_id))?;

        debug!("ModelManager: Found model info: {:?}", model_info);

        let model_path = self.models_dir.join(&model_info.filename);
        let partial_path = self
            .models_dir
            .join(format!("{}.partial", &model_info.filename));
        debug!("ModelManager: Model path: {:?}", model_path);
        debug!("ModelManager: Partial path: {:?}", partial_path);

        let mut deleted_something = false;

        if model_info.is_directory {
            // Delete complete model directory if it exists
            if model_path.exists() && model_path.is_dir() {
                info!("Deleting model directory at: {:?}", model_path);
                fs::remove_dir_all(&model_path)?;
                info!("Model directory deleted successfully");
                deleted_something = true;
            }
        } else {
            // Delete complete model file if it exists
            if model_path.exists() {
                info!("Deleting model file at: {:?}", model_path);
                fs::remove_file(&model_path)?;
                info!("Model file deleted successfully");
                deleted_something = true;
            }
        }

        // Delete partial file if it exists (same for both types)
        if partial_path.exists() {
            info!("Deleting partial file at: {:?}", partial_path);
            fs::remove_file(&partial_path)?;
            info!("Partial file deleted successfully");
            deleted_something = true;
        }

        if !deleted_something {
            return Err(anyhow::anyhow!("No model files found to delete"));
        }

        // Update download status
        self.update_download_status()?;
        debug!("ModelManager: download status updated");

        Ok(())
    }

    pub fn get_model_path(&self, model_id: &str) -> Result<PathBuf> {
        let model_info = self
            .get_model_info(model_id)
            .ok_or_else(|| anyhow::anyhow!("Model not found: {}", model_id))?;

        if !model_info.is_downloaded {
            return Err(anyhow::anyhow!("Model not available: {}", model_id));
        }

        // Ensure we don't return partial files/directories
        if model_info.is_downloading {
            return Err(anyhow::anyhow!(
                "Model is currently downloading: {}",
                model_id
            ));
        }

        let model_path = self.models_dir.join(&model_info.filename);
        let partial_path = self
            .models_dir
            .join(format!("{}.partial", &model_info.filename));

        if model_info.is_directory {
            // For directory-based models, ensure the directory exists and is complete
            if model_path.exists() && model_path.is_dir() && !partial_path.exists() {
                Ok(model_path)
            } else {
                Err(anyhow::anyhow!(
                    "Complete model directory not found: {}",
                    model_id
                ))
            }
        } else {
            // For file-based models (existing logic)
            if model_path.exists() && !partial_path.exists() {
                Ok(model_path)
            } else {
                Err(anyhow::anyhow!(
                    "Complete model file not found: {}",
                    model_id
                ))
            }
        }
    }

    pub fn cancel_download(&self, model_id: &str) -> Result<()> {
        debug!("ModelManager: cancel_download called for: {}", model_id);

        let _model_info = {
            let models = self.available_models.lock().unwrap();
            models.get(model_id).cloned()
        };

        let _model_info =
            _model_info.ok_or_else(|| anyhow::anyhow!("Model not found: {}", model_id))?;

        // Mark as not downloading
        {
            let mut models = self.available_models.lock().unwrap();
            if let Some(model) = models.get_mut(model_id) {
                model.is_downloading = false;
            }
        }

        // Note: The actual download cancellation would need to be handled
        // by the download task itself. This just updates the state.
        // The partial file is kept so the download can be resumed later.

        // Update download status to reflect current state
        self.update_download_status()?;

        info!("Download cancelled for: {}", model_id);
        Ok(())
    }
}
