use std::{
    io::Error,
    sync::{
        atomic::{AtomicBool, Ordering},
        mpsc, Arc, Mutex,
    },
    time::Duration,
};

use cpal::{
    traits::{DeviceTrait, HostTrait, StreamTrait},
    Device, Sample, SizedSample,
};

use crate::audio_toolkit::{
    audio::{AudioInputEnhancer, AudioVisualiser, FrameResampler},
    constants,
    vad::{self, VadFrame},
    VoiceActivityDetector,
};

enum Cmd {
    Start { skip_frames: usize },
    Stop(mpsc::Sender<Vec<f32>>),
    Shutdown,
}

pub struct AudioRecorder {
    device: Option<Device>,
    cmd_tx: Option<mpsc::Sender<Cmd>>,
    worker_handle: Option<std::thread::JoinHandle<()>>,
    vad: Option<Arc<Mutex<Box<dyn vad::VoiceActivityDetector>>>>,
    level_cb: Option<Arc<dyn Fn(Vec<f32>) + Send + Sync + 'static>>,
    speech_cb: Option<Arc<dyn Fn(Vec<f32>) + Send + Sync + 'static>>,
    auto_enhance_flag: Option<Arc<AtomicBool>>,
}

impl AudioRecorder {
    pub fn new() -> Result<Self, Box<dyn std::error::Error>> {
        Ok(AudioRecorder {
            device: None,
            cmd_tx: None,
            worker_handle: None,
            vad: None,
            level_cb: None,
            speech_cb: None,
            auto_enhance_flag: None,
        })
    }

    pub fn with_vad(mut self, vad: Box<dyn VoiceActivityDetector>) -> Self {
        self.vad = Some(Arc::new(Mutex::new(vad)));
        self
    }

    pub fn with_level_callback<F>(mut self, cb: F) -> Self
    where
        F: Fn(Vec<f32>) + Send + Sync + 'static,
    {
        self.level_cb = Some(Arc::new(cb));
        self
    }

    pub fn with_speech_callback<F>(mut self, cb: F) -> Self
    where
        F: Fn(Vec<f32>) + Send + Sync + 'static,
    {
        self.speech_cb = Some(Arc::new(cb));
        self
    }

    pub fn with_auto_enhance_flag(mut self, flag: Arc<AtomicBool>) -> Self {
        self.auto_enhance_flag = Some(flag);
        self
    }

    pub fn open(&mut self, device: Option<Device>) -> Result<(), Box<dyn std::error::Error>> {
        if self.worker_handle.is_some() {
            return Ok(()); // already open
        }

        let (sample_tx, sample_rx) = mpsc::channel::<Vec<f32>>();
        let (cmd_tx, cmd_rx) = mpsc::channel::<Cmd>();

        let host = crate::audio_toolkit::get_cpal_host();
        let device = match device {
            Some(dev) => dev,
            None => host
                .default_input_device()
                .ok_or_else(|| Error::new(std::io::ErrorKind::NotFound, "No input device found"))?,
        };

        let thread_device = device.clone();
        let vad = self.vad.clone();
        // Move the optional level callback into the worker thread
        let level_cb = self.level_cb.clone();
        let speech_cb = self.speech_cb.clone();
        let auto_enhance_flag = self.auto_enhance_flag.clone();

        let worker = std::thread::spawn(move || {
            let config = match AudioRecorder::get_preferred_config(&thread_device) {
                Ok(c) => c,
                Err(e) => {
                    log::error!("Failed to get audio config: {}", e);
                    return;
                }
            };

            let sample_rate = config.sample_rate().0;
            let channels = config.channels() as usize;

            log::info!(
                "Using device: {:?}\nSample rate: {}\nChannels: {}\nFormat: {:?}",
                thread_device.name(),
                sample_rate,
                channels,
                config.sample_format()
            );

            let stream_result = match config.sample_format() {
                cpal::SampleFormat::U8 => AudioRecorder::build_stream::<u8>(
                    &thread_device,
                    &config,
                    sample_tx,
                    channels,
                    auto_enhance_flag.clone(),
                ),
                cpal::SampleFormat::I8 => AudioRecorder::build_stream::<i8>(
                    &thread_device,
                    &config,
                    sample_tx,
                    channels,
                    auto_enhance_flag.clone(),
                ),
                cpal::SampleFormat::I16 => AudioRecorder::build_stream::<i16>(
                    &thread_device,
                    &config,
                    sample_tx,
                    channels,
                    auto_enhance_flag.clone(),
                ),
                cpal::SampleFormat::I32 => AudioRecorder::build_stream::<i32>(
                    &thread_device,
                    &config,
                    sample_tx,
                    channels,
                    auto_enhance_flag.clone(),
                ),
                cpal::SampleFormat::F32 => AudioRecorder::build_stream::<f32>(
                    &thread_device,
                    &config,
                    sample_tx,
                    channels,
                    auto_enhance_flag.clone(),
                ),
                fmt => {
                    log::error!("Unsupported sample format: {:?}", fmt);
                    return;
                }
            };

            let stream = match stream_result {
                Ok(s) => s,
                Err(e) => {
                    log::error!("Failed to build audio stream: {}", e);
                    return;
                }
            };

            if let Err(e) = stream.play() {
                log::error!("Failed to start audio stream: {}", e);
                return;
            }

            // keep the stream alive while we process samples
            run_consumer(
                sample_rate,
                vad,
                sample_rx,
                cmd_rx,
                level_cb,
                speech_cb,
                auto_enhance_flag,
            );
            // stream is dropped here, after run_consumer returns
        });

        self.device = Some(device);
        self.cmd_tx = Some(cmd_tx);
        self.worker_handle = Some(worker);

        Ok(())
    }

    pub fn start(&self, skip_frames: usize) -> Result<(), Box<dyn std::error::Error>> {
        if let Some(tx) = &self.cmd_tx {
            tx.send(Cmd::Start { skip_frames })?;
        }
        Ok(())
    }

    pub fn stop(&self) -> Result<Vec<f32>, Box<dyn std::error::Error>> {
        let (resp_tx, resp_rx) = mpsc::channel();
        if let Some(tx) = &self.cmd_tx {
            tx.send(Cmd::Stop(resp_tx))?;
        }
        Ok(resp_rx.recv()?) // wait for the samples
    }

    pub fn close(&mut self) -> Result<(), Box<dyn std::error::Error>> {
        if let Some(tx) = self.cmd_tx.take() {
            let _ = tx.send(Cmd::Shutdown);
        }
        if let Some(h) = self.worker_handle.take() {
            let _ = h.join();
        }
        self.device = None;
        Ok(())
    }

    fn build_stream<T>(
        device: &cpal::Device,
        config: &cpal::SupportedStreamConfig,
        sample_tx: mpsc::Sender<Vec<f32>>,
        channels: usize,
        auto_enhance_flag: Option<Arc<AtomicBool>>,
    ) -> Result<cpal::Stream, cpal::BuildStreamError>
    where
        T: Sample + SizedSample + Send + 'static,
        f32: cpal::FromSample<T>,
    {
        let mut output_buffer = Vec::new();
        let mut enhancer = AudioInputEnhancer::new();
        let mut log_counter: u32 = 0;
        let mut cb_count: u64 = 0;
        let mut cb_start_time: Option<std::time::Instant> = None;

        let stream_cb = move |data: &[T], _: &cpal::InputCallbackInfo| {
            cb_count += 1;
            if cb_start_time.is_none() {
                cb_start_time = Some(std::time::Instant::now());
            }
            output_buffer.clear();

            if channels == 1 {
                // Direct conversion without intermediate Vec
                output_buffer.extend(data.iter().map(|&sample| sample.to_sample::<f32>()));
            } else {
                // Convert to mono directly
                let frame_count = data.len() / channels;
                output_buffer.reserve(frame_count);

                for frame in data.chunks_exact(channels) {
                    let mono_sample = frame
                        .iter()
                        .map(|&sample| sample.to_sample::<f32>())
                        .sum::<f32>()
                        / channels as f32;
                    output_buffer.push(mono_sample);
                }
            }

            let enhance_active = auto_enhance_flag
                .as_ref()
                .is_some_and(|flag| flag.load(Ordering::Relaxed));
            if enhance_active {
                enhancer.process(&mut output_buffer);
            }

            // Log audio stats every ~2 seconds
            log_counter += 1;
            if log_counter % 66 == 1 {
                let len = output_buffer.len();
                if len > 0 {
                    let rms =
                        (output_buffer.iter().map(|s| s * s).sum::<f32>() / len as f32).sqrt();
                    let peak = output_buffer.iter().map(|s| s.abs()).fold(0.0f32, f32::max);
                    let rms_db = if rms > 1e-10 {
                        20.0 * rms.log10()
                    } else {
                        -100.0
                    };
                    let peak_db = if peak > 1e-10 {
                        20.0 * peak.log10()
                    } else {
                        -100.0
                    };
                    let elapsed = cb_start_time
                        .map(|t| t.elapsed().as_secs_f64())
                        .unwrap_or(0.0);
                    let cb_rate = if elapsed > 0.0 {
                        cb_count as f64 / elapsed
                    } else {
                        0.0
                    };
                    log::debug!(
                        "[audio-input] cb#{} samples={} rms={:.4} ({:.1}dB) peak={:.4} ({:.1}dB) cb_rate={:.1}/s enhance={}",
                        cb_count, len, rms, rms_db, peak, peak_db, cb_rate, enhance_active
                    );
                }
            }

            if sample_tx.send(output_buffer.clone()).is_err() {
                log::error!("Failed to send samples");
            }
        };

        device.build_input_stream(
            &config.clone().into(),
            stream_cb,
            |err| log::error!("Stream error: {}", err),
            None,
        )
    }

    fn get_preferred_config(
        device: &cpal::Device,
    ) -> Result<cpal::SupportedStreamConfig, Box<dyn std::error::Error>> {
        // Get the device's native default config as our baseline
        let default_config = device.default_input_config()?;
        let target_rate = default_config.sample_rate();

        // Try to find a config matching the device's native rate with the best format
        let supported_configs = match device.supported_input_configs() {
            Ok(configs) => configs,
            Err(e) => {
                log::warn!("Could not enumerate input configs ({e}), using device default");
                return Ok(default_config);
            }
        };

        let mut best_config: Option<cpal::SupportedStreamConfigRange> = None;

        for config_range in supported_configs {
            if config_range.min_sample_rate() <= target_rate
                && config_range.max_sample_rate() >= target_rate
            {
                match best_config {
                    None => best_config = Some(config_range),
                    Some(ref current) => {
                        let score = |fmt: cpal::SampleFormat| match fmt {
                            cpal::SampleFormat::F32 => 4,
                            cpal::SampleFormat::I16 => 3,
                            cpal::SampleFormat::I32 => 2,
                            _ => 1,
                        };
                        if score(config_range.sample_format()) > score(current.sample_format()) {
                            best_config = Some(config_range);
                        }
                    }
                }
            }
        }

        if let Some(config) = best_config {
            return Ok(config.with_sample_rate(target_rate));
        }

        // If no config matched the native rate, fall back to default
        log::warn!("No config matched device native rate, using default config");
        Ok(default_config)
    }
}

fn run_consumer(
    in_sample_rate: u32,
    vad: Option<Arc<Mutex<Box<dyn vad::VoiceActivityDetector>>>>,
    sample_rx: mpsc::Receiver<Vec<f32>>,
    cmd_rx: mpsc::Receiver<Cmd>,
    level_cb: Option<Arc<dyn Fn(Vec<f32>) + Send + Sync + 'static>>,
    speech_cb: Option<Arc<dyn Fn(Vec<f32>) + Send + Sync + 'static>>,
    auto_enhance_flag: Option<Arc<AtomicBool>>,
) {
    let mut frame_resampler = FrameResampler::new(
        in_sample_rate as usize,
        constants::WHISPER_SAMPLE_RATE as usize,
        Duration::from_millis(30),
    );

    let mut processed_samples = Vec::<f32>::new();
    let mut recording = false;
    let mut skip_remaining: usize = 0;

    // ---------- debug stats for frequency analysis ---------------------- //
    let mut spectrum_log_counter: u32 = 0;
    let mut vad_speech_frames: u64 = 0;
    let mut vad_noise_frames: u64 = 0;
    let mut total_rms_sum: f64 = 0.0;
    let mut total_rms_count: u64 = 0;
    let mut recording_start_time: Option<std::time::Instant> = None;

    // ---------- waveform data flow tracking ------------------------------ //
    let mut recv_count: u64 = 0;
    let mut emit_count: u64 = 0;
    let mut last_waveform_log = std::time::Instant::now();
    let mut last_recv_raw_len;

    // ---------- spectrum visualisation setup ---------------------------- //
    const BUCKETS: usize = 16;
    const WINDOW_SIZE: usize = 512;
    let mut visualizer = AudioVisualiser::new(
        in_sample_rate,
        WINDOW_SIZE,
        BUCKETS,
        400.0,  // vocal_min_hz
        4000.0, // vocal_max_hz
    );

    fn handle_frame(
        samples: &[f32],
        recording: bool,
        skip_remaining: &mut usize,
        vad: &Option<Arc<Mutex<Box<dyn vad::VoiceActivityDetector>>>>,
        out_buf: &mut Vec<f32>,
        speech_cb: &Option<Arc<dyn Fn(Vec<f32>) + Send + Sync + 'static>>,
        vad_speech_frames: &mut u64,
        vad_noise_frames: &mut u64,
        total_rms_sum: &mut f64,
        total_rms_count: &mut u64,
    ) {
        if !recording {
            return;
        }

        // Skip initial frames to avoid capturing feedback sound
        if *skip_remaining > 0 {
            *skip_remaining -= 1;
            return;
        }

        // Track frame-level RMS for overall stats
        if !samples.is_empty() {
            let rms = (samples.iter().map(|s| s * s).sum::<f32>() / samples.len() as f32).sqrt();
            *total_rms_sum += rms as f64;
            *total_rms_count += 1;
        }

        if let Some(vad_arc) = vad {
            let mut det = vad_arc.lock().unwrap();
            match det.push_frame(samples).unwrap_or(VadFrame::Speech(samples)) {
                VadFrame::Speech(buf) => {
                    *vad_speech_frames += 1;
                    out_buf.extend_from_slice(buf);
                    if let Some(cb) = speech_cb {
                        cb(samples.to_vec());
                    }
                }
                VadFrame::Noise => {
                    *vad_noise_frames += 1;
                }
            }
        } else {
            out_buf.extend_from_slice(samples);
            if let Some(cb) = speech_cb {
                cb(samples.to_vec());
            }
        }
    }

    while let Ok(raw) = sample_rx.recv() {
        recv_count += 1;
        last_recv_raw_len = raw.len();

        // ---------- spectrum processing ---------------------------------- //
        let amplified = auto_enhance_flag
            .as_ref()
            .is_some_and(|f| f.load(Ordering::Relaxed));
        if let Some(buckets) = visualizer.feed(&raw, amplified) {
            emit_count += 1;

            if let Some(cb) = &level_cb {
                cb(buckets.clone());
            }

            // Log waveform data flow every ~2 seconds
            let now = std::time::Instant::now();
            if now.duration_since(last_waveform_log).as_millis() >= 2000 {
                let elapsed = now.duration_since(last_waveform_log).as_secs_f64();
                let recv_rate = recv_count as f64 / elapsed;
                let emit_rate = emit_count as f64 / elapsed;
                let max_bucket = buckets.iter().cloned().fold(0.0f32, f32::max);
                let avg_bucket = buckets.iter().sum::<f32>() / buckets.len() as f32;
                // Compact bucket values
                let bucket_str: String = buckets
                    .iter()
                    .map(|v| format!("{:.2}", v))
                    .collect::<Vec<_>>()
                    .join(",");
                log::debug!(
                    "[waveform] recv={}/s emit={}/s raw_len={} max={:.3} avg={:.3} buckets=[{}]",
                    recv_rate as u32,
                    emit_rate as u32,
                    last_recv_raw_len,
                    max_bucket,
                    avg_bucket,
                    bucket_str,
                );
                recv_count = 0;
                emit_count = 0;
                last_waveform_log = now;
            }

            // Log frequency spectrum every ~3 seconds during recording
            if recording {
                spectrum_log_counter += 1;
                if spectrum_log_counter % 100 == 1 {
                    let bars: Vec<String> = buckets
                        .iter()
                        .enumerate()
                        .map(|(i, &v)| {
                            let bar_len = (v * 20.0) as usize;
                            let bar: String = std::iter::repeat('#').take(bar_len).collect();
                            let freq_lo = 400.0 + (i as f32 / BUCKETS as f32).powi(2) * 3600.0;
                            let freq_hi =
                                400.0 + ((i + 1) as f32 / BUCKETS as f32).powi(2) * 3600.0;
                            format!("{:5.0}-{:5.0}Hz: {:.3} |{:<20}", freq_lo, freq_hi, v, bar)
                        })
                        .collect();
                    log::debug!(
                        "[audio-spectrum] frequency distribution:\n{}",
                        bars.join("\n")
                    );
                }
            }
        }

        // ---------- existing pipeline ------------------------------------ //
        frame_resampler.push(&raw, &mut |frame: &[f32]| {
            handle_frame(
                frame,
                recording,
                &mut skip_remaining,
                &vad,
                &mut processed_samples,
                &speech_cb,
                &mut vad_speech_frames,
                &mut vad_noise_frames,
                &mut total_rms_sum,
                &mut total_rms_count,
            )
        });

        // non-blocking check for a command
        while let Ok(cmd) = cmd_rx.try_recv() {
            match cmd {
                Cmd::Start { skip_frames } => {
                    processed_samples.clear();
                    recording = true;
                    skip_remaining = skip_frames;
                    visualizer.reset();
                    // Reset debug stats
                    spectrum_log_counter = 0;
                    vad_speech_frames = 0;
                    vad_noise_frames = 0;
                    total_rms_sum = 0.0;
                    total_rms_count = 0;
                    recording_start_time = Some(std::time::Instant::now());
                    log::info!(
                        "[audio-debug] Recording started (input_sample_rate={} skip_frames={})",
                        in_sample_rate,
                        skip_frames
                    );
                    if let Some(v) = &vad {
                        v.lock().unwrap().reset();
                    }
                }
                Cmd::Stop(reply_tx) => {
                    recording = false;

                    // Drain any audio chunks that were captured but not yet consumed
                    while let Ok(remaining) = sample_rx.try_recv() {
                        frame_resampler.push(&remaining, &mut |frame: &[f32]| {
                            handle_frame(
                                frame,
                                true,
                                &mut skip_remaining,
                                &vad,
                                &mut processed_samples,
                                &speech_cb,
                                &mut vad_speech_frames,
                                &mut vad_noise_frames,
                                &mut total_rms_sum,
                                &mut total_rms_count,
                            )
                        });
                    }

                    frame_resampler.finish(&mut |frame: &[f32]| {
                        handle_frame(
                            frame,
                            true,
                            &mut skip_remaining,
                            &vad,
                            &mut processed_samples,
                            &speech_cb,
                            &mut vad_speech_frames,
                            &mut vad_noise_frames,
                            &mut total_rms_sum,
                            &mut total_rms_count,
                        )
                    });

                    // Log recording summary
                    let duration = recording_start_time
                        .map(|t| t.elapsed())
                        .unwrap_or_default();
                    let avg_rms = if total_rms_count > 0 {
                        total_rms_sum / total_rms_count as f64
                    } else {
                        0.0
                    };
                    let avg_rms_db = if avg_rms > 1e-10 {
                        20.0 * avg_rms.log10()
                    } else {
                        -100.0
                    };
                    let total_vad = vad_speech_frames + vad_noise_frames;
                    let speech_pct = if total_vad > 0 {
                        vad_speech_frames as f64 / total_vad as f64 * 100.0
                    } else {
                        0.0
                    };
                    let output_samples = processed_samples.len();
                    let output_duration_s =
                        output_samples as f64 / constants::WHISPER_SAMPLE_RATE as f64;
                    log::info!(
                        "[audio-debug] Recording stopped: duration={:.1}s output_samples={} ({:.1}s audio) avg_rms={:.6} ({:.1}dB) vad_speech={} vad_noise={} speech_ratio={:.1}%",
                        duration.as_secs_f64(),
                        output_samples,
                        output_duration_s,
                        avg_rms,
                        avg_rms_db,
                        vad_speech_frames,
                        vad_noise_frames,
                        speech_pct,
                    );

                    let _ = reply_tx.send(std::mem::take(&mut processed_samples));
                }
                Cmd::Shutdown => return,
            }
        }
    }
}
