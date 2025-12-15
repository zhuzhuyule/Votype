use anyhow::Result;
use hound::{WavSpec, WavWriter};
use log::debug;
use std::path::Path;

/// Save audio samples as a WAV file
pub async fn save_wav_file<P: AsRef<Path>>(file_path: P, samples: &[f32]) -> Result<()> {
    let spec = WavSpec {
        channels: 1,
        sample_rate: 16000,
        bits_per_sample: 16,
        sample_format: hound::SampleFormat::Int,
    };

    let mut writer = WavWriter::create(file_path.as_ref(), spec)?;

    // Convert f32 samples to i16 for WAV
    for sample in samples {
        let sample_i16 = (sample * i16::MAX as f32) as i16;
        writer.write_sample(sample_i16)?;
    }

    writer.finalize()?;
    debug!("Saved WAV file: {:?}", file_path.as_ref());
    Ok(())
}

/// Read audio samples from a WAV file
pub fn read_wav_file<P: AsRef<Path>>(file_path: P) -> Result<Vec<f32>> {
    let mut reader = hound::WavReader::open(file_path.as_ref())?;
    let spec = reader.spec();

    // We only support 16-bit integer samples for now (as that's what we save)
    if spec.sample_format != hound::SampleFormat::Int || spec.bits_per_sample != 16 {
        return Err(anyhow::anyhow!(
            "Unsupported WAV format: {:?}. Only 16-bit integer supported.",
            spec
        ));
    }

    // Read samples and convert to f32
    let samples: Result<Vec<f32>, _> = reader
        .samples::<i16>()
        .map(|s| s.map(|v| v as f32 / i16::MAX as f32))
        .collect();

    let samples = samples?;
    debug!(
        "Read WAV file: {:?} ({} samples, {}Hz)",
        file_path.as_ref(),
        samples.len(),
        spec.sample_rate
    );

    Ok(samples)
}
