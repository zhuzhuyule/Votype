pub struct AudioInputEnhancer {
    current_gain: f32,
}

impl AudioInputEnhancer {
    const TARGET_RMS: f32 = 0.18;
    const MIN_RMS_FOR_BOOST: f32 = 0.015;
    const MAX_GAIN: f32 = 4.0;
    const ATTACK: f32 = 0.18;
    const RELEASE: f32 = 0.04;
    const SOFT_CLIP_DRIVE: f32 = 1.6;

    pub fn new() -> Self {
        Self { current_gain: 1.0 }
    }

    pub fn process(&mut self, samples: &mut [f32]) {
        if samples.is_empty() {
            return;
        }

        let rms = (samples.iter().map(|sample| sample * sample).sum::<f32>()
            / samples.len() as f32)
            .sqrt();

        let target_gain = if rms < Self::MIN_RMS_FOR_BOOST {
            1.0
        } else {
            (Self::TARGET_RMS / rms).clamp(1.0, Self::MAX_GAIN)
        };

        let smoothing = if target_gain > self.current_gain {
            Self::ATTACK
        } else {
            Self::RELEASE
        };
        self.current_gain += (target_gain - self.current_gain) * smoothing;

        for sample in samples {
            let amplified = *sample * self.current_gain;
            *sample = ((amplified * Self::SOFT_CLIP_DRIVE).tanh() / Self::SOFT_CLIP_DRIVE.tanh())
                .clamp(-1.0, 1.0);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::AudioInputEnhancer;

    fn rms(samples: &[f32]) -> f32 {
        (samples.iter().map(|sample| sample * sample).sum::<f32>() / samples.len() as f32).sqrt()
    }

    #[test]
    fn keeps_near_silence_stable() {
        let mut enhancer = AudioInputEnhancer::new();
        let mut samples = vec![0.001; 480];
        enhancer.process(&mut samples);

        assert!(rms(&samples) < 0.005);
    }

    #[test]
    fn boosts_quiet_voice() {
        let mut enhancer = AudioInputEnhancer::new();
        let mut samples: Vec<f32> = (0..480)
            .map(|index| if index % 2 == 0 { 0.05 } else { -0.05 })
            .collect();
        let before = rms(&samples);
        enhancer.process(&mut samples);
        let after = rms(&samples);

        assert!(after > before);
    }

    #[test]
    fn limits_hot_input() {
        let mut enhancer = AudioInputEnhancer::new();
        let mut samples: Vec<f32> = (0..480)
            .map(|index| if index % 2 == 0 { 1.2 } else { -1.2 })
            .collect();
        enhancer.process(&mut samples);

        let peak = samples
            .iter()
            .copied()
            .fold(0.0_f32, |acc, sample| acc.max(sample.abs()));
        assert!(peak <= 1.0);
    }
}
