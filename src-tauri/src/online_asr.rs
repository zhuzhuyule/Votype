use crate::settings::PostProcessProvider;
use anyhow::{anyhow, Context, Result};
use hound;
use reqwest::blocking::{multipart, Client};
use serde::Serialize;
use std::io::Cursor;
use std::time::Duration;

const DEFAULT_TRANSCRIPTION_PATH: &str = "audio/transcriptions";
const DEFAULT_SAMPLE_RATE: u32 = 16000;

#[derive(Clone, Serialize)]
pub struct OnlineAsrStatusEvent {
    pub stage: String,
    pub detail: Option<String>,
}

pub struct OnlineAsrClient {
    pub sample_rate: u32,
    pub timeout: Duration,
}

impl OnlineAsrClient {
    pub fn new(sample_rate: u32, timeout: Duration) -> Self {
        Self {
            sample_rate,
            timeout,
        }
    }

    pub fn transcribe(
        &self,
        provider: &PostProcessProvider,
        api_key: Option<String>,
        model_id: &str,
        samples: &[f32],
    ) -> Result<String> {
        let wav_bytes = encode_wav(samples, self.sample_rate)?;
        let url = format!(
            "{}/{}",
            provider.base_url.trim_end_matches('/'),
            DEFAULT_TRANSCRIPTION_PATH
        );

        println!("Online ASR request: url={}, model={}", url, model_id);
        let client = Client::builder()
            .timeout(self.timeout)
            .build()
            .context("failed to build HTTP client")?;

        let form = multipart::Form::new()
            .part(
                "file",
                multipart::Part::bytes(wav_bytes)
                    .file_name("recording.wav")
                    .mime_str("audio/wav")?,
            )
            .text("model", model_id.to_string());

        let mut request = client.post(&url).multipart(form);
        if let Some(key) = api_key {
            request = request.bearer_auth(key);
        }

        let response = request
            .send()
            .context("failed to send transcription request")?;

        if !response.status().is_success() {
            let status = response.status();
            let text = response
                .text()
                .unwrap_or_else(|_| "Failed to read body".to_string());
            return Err(anyhow!(
                "remote transcription failed ({}): {}",
                status,
                text
            ));
        }

        let body: serde_json::Value = response
            .json()
            .context("failed to deserialize transcription response")?;

        let text = body
            .get("text")
            .or_else(|| body.get("result"))
            .and_then(|value| value.as_str())
            .ok_or_else(|| anyhow!("transcription missing text field"))?
            .to_string();

        Ok(text)
    }
}

fn encode_wav(samples: &[f32], sample_rate: u32) -> Result<Vec<u8>> {
    let spec = hound::WavSpec {
        channels: 1,
        sample_rate,
        bits_per_sample: 16,
        sample_format: hound::SampleFormat::Int,
    };

    let mut cursor = Cursor::new(Vec::new());
    {
        let mut writer =
            hound::WavWriter::new(&mut cursor, spec).context("failed to create WAV writer")?;
        for &sample in samples.iter() {
            let clamped = (sample * i16::MAX as f32).clamp(i16::MIN as f32, i16::MAX as f32);
            writer
                .write_sample(clamped as i16)
                .context("failed to write sample")?;
        }
        writer.finalize().context("failed to finalize WAV")?;
    }

    Ok(cursor.into_inner())
}
