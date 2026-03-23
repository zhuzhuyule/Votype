use rustfft::{num_complex::Complex32, Fft, FftPlanner};
use std::sync::Arc;

const DB_MAX: f32 = -18.0;
const GAIN: f32 = 1.8;
const CURVE_POWER: f32 = 0.6;

// --- Adaptive noise-gate mode (amplify OFF) ---
/// How many dB above the noise floor counts as "zero" for the visualiser.
const NOISE_GATE_MARGIN: f32 = 6.0;
/// How quickly the noise floor adapts (higher = faster).
const NOISE_ALPHA: f32 = 0.015;
/// Absolute minimum floor so the gate never drops unreasonably low.
const NOISE_FLOOR_MIN: f32 = -60.0;

// --- Amplified mode (amplify ON) — original fixed-range behaviour ---
const AMPLIFIED_DB_MIN: f32 = -72.0;

pub struct AudioVisualiser {
    fft: Arc<dyn Fft<f32>>,
    window: Vec<f32>,
    bucket_ranges: Vec<(usize, usize)>,
    fft_input: Vec<Complex32>,
    noise_floor: Vec<f32>,
    buffer: Vec<f32>,
    window_size: usize,
    buckets: usize,
}

impl AudioVisualiser {
    pub fn new(
        sample_rate: u32,
        window_size: usize,
        buckets: usize,
        freq_min: f32,
        freq_max: f32,
    ) -> Self {
        let mut planner = FftPlanner::<f32>::new();
        let fft = planner.plan_fft_forward(window_size);

        let window: Vec<f32> = (0..window_size)
            .map(|i| {
                0.5 * (1.0 - (2.0 * std::f32::consts::PI * i as f32 / window_size as f32).cos())
            })
            .collect();

        let nyquist = sample_rate as f32 / 2.0;
        let freq_min = freq_min.min(nyquist);
        let freq_max = freq_max.min(nyquist);

        let mut bucket_ranges = Vec::with_capacity(buckets);

        for b in 0..buckets {
            let log_start = (b as f32 / buckets as f32).powi(2);
            let log_end = ((b + 1) as f32 / buckets as f32).powi(2);

            let start_hz = freq_min + (freq_max - freq_min) * log_start;
            let end_hz = freq_min + (freq_max - freq_min) * log_end;

            let start_bin = ((start_hz * window_size as f32) / sample_rate as f32) as usize;
            let mut end_bin = ((end_hz * window_size as f32) / sample_rate as f32) as usize;

            if end_bin <= start_bin {
                end_bin = start_bin + 1;
            }

            let start_bin = start_bin.min(window_size / 2);
            let end_bin = end_bin.min(window_size / 2);

            bucket_ranges.push((start_bin, end_bin));
        }

        Self {
            fft,
            window,
            bucket_ranges,
            fft_input: vec![Complex32::new(0.0, 0.0); window_size],
            noise_floor: vec![-40.0; buckets],
            buffer: Vec::with_capacity(window_size * 2),
            window_size,
            buckets,
        }
    }

    /// When `amplified` is true, uses the original fixed-range normalisation
    /// (DB_MIN → DB_MAX) which makes even quiet ambient noise visible.
    /// When false, normalises relative to the tracked noise floor so that
    /// ambient noise reads ≈ 0.
    pub fn feed(&mut self, samples: &[f32], amplified: bool) -> Option<Vec<f32>> {
        self.buffer.extend_from_slice(samples);

        let mut latest_buckets = None;

        while self.buffer.len() >= self.window_size {
            let window_samples = &self.buffer[..self.window_size];
            let mean = window_samples.iter().sum::<f32>() / self.window_size as f32;

            for (i, &sample) in window_samples.iter().enumerate() {
                let windowed_sample = (sample - mean) * self.window[i];
                self.fft_input[i] = Complex32::new(windowed_sample, 0.0);
            }

            self.fft.process(&mut self.fft_input);

            let mut buckets = vec![0.0; self.buckets];

            for (bucket_idx, &(start_bin, end_bin)) in self.bucket_ranges.iter().enumerate() {
                if start_bin >= end_bin || end_bin > self.fft_input.len() / 2 {
                    continue;
                }

                let mut power_sum = 0.0;
                for bin_idx in start_bin..end_bin {
                    let magnitude = self.fft_input[bin_idx].norm();
                    power_sum += magnitude * magnitude;
                }

                let avg_power = power_sum / (end_bin - start_bin) as f32;
                let db = if avg_power > 1e-12 {
                    20.0 * (avg_power.sqrt() / self.window_size as f32).log10()
                } else {
                    -80.0
                };

                // Update noise floor estimate (only when signal is close to or
                // below the current floor — speech won't raise it).
                if db < self.noise_floor[bucket_idx] + 10.0 {
                    self.noise_floor[bucket_idx] = (NOISE_ALPHA * db
                        + (1.0 - NOISE_ALPHA) * self.noise_floor[bucket_idx])
                        .max(NOISE_FLOOR_MIN);
                }

                let normalized = if amplified {
                    // Amplified mode: fixed range, everything is visible.
                    ((db - AMPLIFIED_DB_MIN) / (DB_MAX - AMPLIFIED_DB_MIN)).clamp(0.0, 1.0)
                } else {
                    // Adaptive mode: normalise relative to noise floor.
                    let floor = self.noise_floor[bucket_idx] + NOISE_GATE_MARGIN;
                    let range = DB_MAX - floor;
                    if range > 1.0 {
                        ((db - floor) / range).clamp(0.0, 1.0)
                    } else {
                        0.0
                    }
                };
                buckets[bucket_idx] = (normalized * GAIN).powf(CURVE_POWER).clamp(0.0, 1.0);
            }

            for i in 1..buckets.len() - 1 {
                buckets[i] = buckets[i] * 0.7 + buckets[i - 1] * 0.15 + buckets[i + 1] * 0.15;
            }

            latest_buckets = Some(buckets);
            self.buffer.drain(..self.window_size);
        }

        latest_buckets
    }

    pub fn reset(&mut self) {
        self.buffer.clear();
        self.noise_floor.fill(-40.0);
    }
}
