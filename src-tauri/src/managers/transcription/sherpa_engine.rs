use super::*;

pub(super) struct SherpaOnnxOnlineRecognizer {
    recognizer: *const sherpa_rs_sys::SherpaOnnxOnlineRecognizer,
    _empty: CString,
    _encoder: CString,
    _decoder: CString,
    _joiner: CString,
    _tokens: CString,
    _provider: CString,
    _decoding_method: CString,
}

pub(super) struct SherpaOnnxOfflineRecognizer {
    recognizer: *const sherpa_rs_sys::SherpaOnnxOfflineRecognizer,
    _empty: CString,
    _tokens: CString,
    _provider: CString,
    _decoding_method: CString,
    // Model-specific fields (kept to own the CString memory).
    _model: CString,
    _language: CString,
    _encoder: CString,
    _decoder: CString,
}

pub(super) struct SherpaOnnxOfflinePunctuation {
    punct: *const sherpa_rs_sys::SherpaOnnxOfflinePunctuation,
    _model: CString,
    _provider: CString,
}

impl SherpaOnnxOnlineRecognizer {
    pub(super) fn new_transducer(
        encoder: String,
        decoder: String,
        joiner: String,
        tokens: String,
        provider: String,
        num_threads: i32,
        debug: bool,
    ) -> Result<Self> {
        let empty = CString::new("")?;
        let encoder = CString::new(encoder)?;
        let decoder = CString::new(decoder)?;
        let joiner = CString::new(joiner)?;
        let tokens = CString::new(tokens)?;
        let provider = CString::new(provider)?;
        // `modified_beam_search` is generally more stable than `greedy_search`
        // for partial results (reduces repeated tokens/oscillation), at some CPU cost.
        let decoding_method = CString::new("modified_beam_search")?;

        let mut online_model_config: sherpa_rs_sys::SherpaOnnxOnlineModelConfig =
            unsafe { mem::zeroed() };
        online_model_config.debug = debug.into();
        online_model_config.num_threads = num_threads;
        online_model_config.provider = provider.as_ptr();
        online_model_config.tokens = tokens.as_ptr();
        online_model_config.transducer = sherpa_rs_sys::SherpaOnnxOnlineTransducerModelConfig {
            encoder: encoder.as_ptr(),
            decoder: decoder.as_ptr(),
            joiner: joiner.as_ptr(),
        };
        online_model_config.paraformer = sherpa_rs_sys::SherpaOnnxOnlineParaformerModelConfig {
            encoder: empty.as_ptr(),
            decoder: empty.as_ptr(),
        };

        let mut recognizer_config: sherpa_rs_sys::SherpaOnnxOnlineRecognizerConfig =
            unsafe { mem::zeroed() };
        recognizer_config.decoding_method = decoding_method.as_ptr();
        recognizer_config.max_active_paths = 4;
        recognizer_config.feat_config = sherpa_rs_sys::SherpaOnnxFeatureConfig {
            sample_rate: 16000,
            feature_dim: 80,
        };
        recognizer_config.enable_endpoint = 1;
        recognizer_config.rule1_min_trailing_silence = 2.4;
        recognizer_config.rule2_min_trailing_silence = 1.2;
        // Safeguard for long utterances: force an endpoint after ~20s.
        recognizer_config.rule3_min_utterance_length = 20.0;
        recognizer_config.model_config = online_model_config;

        let recognizer =
            unsafe { sherpa_safe::SafeSherpaOnnxCreateOnlineRecognizer(&recognizer_config) };
        if recognizer.is_null() {
            return Err(anyhow::anyhow!(
                "Failed to create Sherpa streaming recognizer"
            ));
        }

        Ok(Self {
            recognizer,
            _empty: empty,
            _encoder: encoder,
            _decoder: decoder,
            _joiner: joiner,
            _tokens: tokens,
            _provider: provider,
            _decoding_method: decoding_method,
        })
    }

    pub(super) fn new_paraformer(
        encoder: String,
        decoder: String,
        tokens: String,
        provider: String,
        num_threads: i32,
        debug: bool,
    ) -> Result<Self> {
        let empty = CString::new("")?;
        let encoder = CString::new(encoder)?;
        let decoder = CString::new(decoder)?;
        let joiner = CString::new("")?;
        let tokens = CString::new(tokens)?;
        let provider = CString::new(provider)?;
        // Paraformer online recognizer currently supports only `greedy_search`.
        let decoding_method = CString::new("greedy_search")?;

        let mut online_model_config: sherpa_rs_sys::SherpaOnnxOnlineModelConfig =
            unsafe { mem::zeroed() };
        online_model_config.debug = debug.into();
        online_model_config.num_threads = num_threads;
        online_model_config.provider = provider.as_ptr();
        online_model_config.tokens = tokens.as_ptr();
        online_model_config.transducer = sherpa_rs_sys::SherpaOnnxOnlineTransducerModelConfig {
            encoder: empty.as_ptr(),
            decoder: empty.as_ptr(),
            joiner: empty.as_ptr(),
        };
        online_model_config.paraformer = sherpa_rs_sys::SherpaOnnxOnlineParaformerModelConfig {
            encoder: encoder.as_ptr(),
            decoder: decoder.as_ptr(),
        };

        let mut recognizer_config: sherpa_rs_sys::SherpaOnnxOnlineRecognizerConfig =
            unsafe { mem::zeroed() };
        recognizer_config.decoding_method = decoding_method.as_ptr();
        recognizer_config.max_active_paths = 4;
        recognizer_config.feat_config = sherpa_rs_sys::SherpaOnnxFeatureConfig {
            sample_rate: 16000,
            feature_dim: 80,
        };
        recognizer_config.enable_endpoint = 1;
        recognizer_config.rule1_min_trailing_silence = 2.4;
        recognizer_config.rule2_min_trailing_silence = 1.2;
        recognizer_config.rule3_min_utterance_length = 20.0;
        recognizer_config.model_config = online_model_config;

        let recognizer =
            unsafe { sherpa_safe::SafeSherpaOnnxCreateOnlineRecognizer(&recognizer_config) };
        if recognizer.is_null() {
            return Err(anyhow::anyhow!("Failed to create Sherpa online recognizer"));
        }

        Ok(Self {
            recognizer,
            _empty: empty,
            _encoder: encoder,
            _decoder: decoder,
            _joiner: joiner,
            _tokens: tokens,
            _provider: provider,
            _decoding_method: decoding_method,
        })
    }

    pub(super) fn decode(&self, sample_rate: i32, samples: &[f32]) -> Result<String> {
        if samples.is_empty() {
            return Ok(String::new());
        }

        let stream = unsafe { sherpa_safe::SafeSherpaOnnxCreateOnlineStream(self.recognizer) };
        if stream.is_null() {
            return Err(anyhow::anyhow!("Failed to create Sherpa online stream"));
        }

        // Feed audio in small chunks to match streaming usage.
        const CHUNK_SAMPLES: usize = 3200; // 0.2s at 16kHz
        let mut offset = 0usize;
        while offset < samples.len() {
            let end = (offset + CHUNK_SAMPLES).min(samples.len());
            unsafe {
                if sherpa_safe::SafeSherpaOnnxOnlineStreamAcceptWaveform(
                    stream,
                    sample_rate,
                    samples[offset..end].as_ptr(),
                    (end - offset) as i32,
                ) != 1
                {
                    return Err(anyhow::anyhow!("Sherpa online accept waveform failed"));
                }
                while sherpa_safe::SafeSherpaOnnxIsOnlineStreamReady(self.recognizer, stream) == 1 {
                    if sherpa_safe::SafeSherpaOnnxDecodeOnlineStream(self.recognizer, stream) != 1 {
                        return Err(anyhow::anyhow!("Sherpa online decode failed"));
                    }
                }
            }
            offset = end;
        }

        // Add some tail paddings to flush the final tokens.
        let tail_len = (sample_rate as usize * 3) / 10; // 0.3 seconds
        let tail = vec![0.0f32; tail_len];
        unsafe {
            if sherpa_safe::SafeSherpaOnnxOnlineStreamAcceptWaveform(
                stream,
                sample_rate,
                tail.as_ptr(),
                tail.len() as i32,
            ) != 1
            {
                return Err(anyhow::anyhow!("Sherpa online accept waveform failed"));
            }
            if sherpa_safe::SafeSherpaOnnxOnlineStreamInputFinished(stream) != 1 {
                return Err(anyhow::anyhow!("Sherpa online input_finished failed"));
            }
            while sherpa_safe::SafeSherpaOnnxIsOnlineStreamReady(self.recognizer, stream) == 1 {
                if sherpa_safe::SafeSherpaOnnxDecodeOnlineStream(self.recognizer, stream) != 1 {
                    return Err(anyhow::anyhow!("Sherpa online decode failed"));
                }
            }
        }

        let result_ptr =
            unsafe { sherpa_safe::SafeSherpaOnnxGetOnlineStreamResult(self.recognizer, stream) };
        let text = if result_ptr.is_null() {
            String::new()
        } else {
            let raw_text = unsafe { (*result_ptr).text };
            if raw_text.is_null() {
                String::new()
            } else {
                unsafe { CStr::from_ptr(raw_text) }
                    .to_string_lossy()
                    .trim()
                    .to_string()
            }
        };

        unsafe {
            if !result_ptr.is_null() {
                sherpa_safe::SafeSherpaOnnxDestroyOnlineRecognizerResult(result_ptr);
            }
            sherpa_safe::SafeSherpaOnnxDestroyOnlineStream(stream);
        }

        Ok(text)
    }

    pub(super) fn create_stream(&self) -> Result<*const sherpa_rs_sys::SherpaOnnxOnlineStream> {
        let stream = unsafe { sherpa_safe::SafeSherpaOnnxCreateOnlineStream(self.recognizer) };
        if stream.is_null() {
            return Err(anyhow::anyhow!("Failed to create Sherpa online stream"));
        }
        Ok(stream)
    }

    pub(super) fn accept_waveform(
        &self,
        stream: *const sherpa_rs_sys::SherpaOnnxOnlineStream,
        sample_rate: i32,
        samples: &[f32],
    ) {
        let ok = unsafe {
            sherpa_safe::SafeSherpaOnnxOnlineStreamAcceptWaveform(
                stream,
                sample_rate,
                samples.as_ptr(),
                samples.len() as i32,
            )
        };
        if ok != 1 {
            warn!("Sherpa online accept_waveform failed (ignored)");
        }
    }

    pub(super) fn decode_ready(&self, stream: *const sherpa_rs_sys::SherpaOnnxOnlineStream) {
        unsafe {
            while sherpa_safe::SafeSherpaOnnxIsOnlineStreamReady(self.recognizer, stream) == 1 {
                if sherpa_safe::SafeSherpaOnnxDecodeOnlineStream(self.recognizer, stream) != 1 {
                    warn!("Sherpa online decode failed (ignored)");
                    break;
                }
            }
        }
    }

    pub(super) fn input_finished(&self, stream: *const sherpa_rs_sys::SherpaOnnxOnlineStream) {
        let ok = unsafe { sherpa_safe::SafeSherpaOnnxOnlineStreamInputFinished(stream) };
        if ok != 1 {
            warn!("Sherpa online input_finished failed (ignored)");
        }
    }

    pub(super) fn is_endpoint(&self, stream: *const sherpa_rs_sys::SherpaOnnxOnlineStream) -> bool {
        unsafe { sherpa_safe::SafeSherpaOnnxOnlineStreamIsEndpoint(self.recognizer, stream) == 1 }
    }

    pub(super) fn reset_stream(&self, stream: *const sherpa_rs_sys::SherpaOnnxOnlineStream) {
        let ok = unsafe { sherpa_safe::SafeSherpaOnnxOnlineStreamReset(self.recognizer, stream) };
        if ok != 1 {
            warn!("Sherpa online reset_stream failed (ignored)");
        }
    }

    pub(super) fn get_text(&self, stream: *const sherpa_rs_sys::SherpaOnnxOnlineStream) -> String {
        let result_ptr =
            unsafe { sherpa_safe::SafeSherpaOnnxGetOnlineStreamResult(self.recognizer, stream) };
        if result_ptr.is_null() {
            return String::new();
        }

        let text = unsafe { (*result_ptr).text };
        let out = if text.is_null() {
            String::new()
        } else {
            unsafe { CStr::from_ptr(text) }
                .to_string_lossy()
                .to_string()
        };

        unsafe {
            sherpa_safe::SafeSherpaOnnxDestroyOnlineRecognizerResult(result_ptr);
        }

        out
    }
}

unsafe impl Send for SherpaOnnxOnlineRecognizer {}
unsafe impl Sync for SherpaOnnxOnlineRecognizer {}

impl Drop for SherpaOnnxOnlineRecognizer {
    fn drop(&mut self) {
        unsafe {
            sherpa_safe::SafeSherpaOnnxDestroyOnlineRecognizer(self.recognizer);
        }
    }
}

impl SherpaOnnxOfflineRecognizer {
    pub(super) fn new_paraformer(
        model: String,
        tokens: String,
        provider: String,
        num_threads: i32,
        debug: bool,
    ) -> Result<Self> {
        let empty = CString::new("")?;
        let encoder = CString::new("")?;
        let decoder = CString::new("")?;
        let model = CString::new(model)?;
        let language = CString::new("")?;
        let tokens = CString::new(tokens)?;
        let provider = CString::new(provider)?;
        let decoding_method = CString::new("greedy_search")?;

        let mut model_config: sherpa_rs_sys::SherpaOnnxOfflineModelConfig =
            unsafe { mem::zeroed() };
        model_config.tokens = tokens.as_ptr();
        model_config.num_threads = num_threads;
        model_config.debug = debug.into();
        model_config.provider = provider.as_ptr();
        model_config.paraformer = sherpa_rs_sys::SherpaOnnxOfflineParaformerModelConfig {
            model: model.as_ptr(),
        };
        // Ensure other model configs are well-defined even if unused.
        model_config.fire_red_asr = sherpa_rs_sys::SherpaOnnxOfflineFireRedAsrModelConfig {
            encoder: empty.as_ptr(),
            decoder: empty.as_ptr(),
        };

        let mut recognizer_config: sherpa_rs_sys::SherpaOnnxOfflineRecognizerConfig =
            unsafe { mem::zeroed() };
        recognizer_config.feat_config = sherpa_rs_sys::SherpaOnnxFeatureConfig {
            sample_rate: 16000,
            feature_dim: 80,
        };
        recognizer_config.model_config = model_config;
        recognizer_config.decoding_method = decoding_method.as_ptr();
        recognizer_config.max_active_paths = 4;

        let recognizer =
            unsafe { sherpa_safe::SafeSherpaOnnxCreateOfflineRecognizer(&recognizer_config) };
        if recognizer.is_null() {
            return Err(anyhow::anyhow!(
                "Failed to create Sherpa offline recognizer"
            ));
        }

        Ok(Self {
            recognizer,
            _empty: empty,
            _tokens: tokens,
            _provider: provider,
            _decoding_method: decoding_method,
            _model: model,
            _language: language,
            _encoder: encoder,
            _decoder: decoder,
        })
    }

    pub(super) fn new_fire_red_asr(
        encoder: String,
        decoder: String,
        tokens: String,
        provider: String,
        num_threads: i32,
        debug: bool,
    ) -> Result<Self> {
        let empty = CString::new("")?;
        let encoder = CString::new(encoder)?;
        let decoder = CString::new(decoder)?;
        let model = CString::new("")?;
        let language = CString::new("auto")?;
        let tokens = CString::new(tokens)?;
        let provider = CString::new(provider)?;
        let decoding_method = CString::new("greedy_search")?;

        let mut model_config: sherpa_rs_sys::SherpaOnnxOfflineModelConfig =
            unsafe { mem::zeroed() };
        model_config.tokens = tokens.as_ptr();
        model_config.num_threads = num_threads;
        model_config.debug = debug.into();
        model_config.provider = provider.as_ptr();
        model_config.fire_red_asr = sherpa_rs_sys::SherpaOnnxOfflineFireRedAsrModelConfig {
            encoder: encoder.as_ptr(),
            decoder: decoder.as_ptr(),
        };
        model_config.sense_voice = sherpa_rs_sys::SherpaOnnxOfflineSenseVoiceModelConfig {
            model: empty.as_ptr(),
            language: empty.as_ptr(),
            use_itn: 0,
        };

        let mut recognizer_config: sherpa_rs_sys::SherpaOnnxOfflineRecognizerConfig =
            unsafe { mem::zeroed() };
        recognizer_config.feat_config = sherpa_rs_sys::SherpaOnnxFeatureConfig {
            sample_rate: 16000,
            feature_dim: 80,
        };
        recognizer_config.model_config = model_config;
        recognizer_config.decoding_method = decoding_method.as_ptr();
        recognizer_config.max_active_paths = 4;

        let recognizer =
            unsafe { sherpa_safe::SafeSherpaOnnxCreateOfflineRecognizer(&recognizer_config) };
        if recognizer.is_null() {
            return Err(anyhow::anyhow!(
                "Failed to create Sherpa offline recognizer"
            ));
        }

        Ok(Self {
            recognizer,
            _empty: empty,
            _tokens: tokens,
            _provider: provider,
            _decoding_method: decoding_method,
            _model: model,
            _language: language,
            _encoder: encoder,
            _decoder: decoder,
        })
    }

    pub(super) fn new_sense_voice(
        model: String,
        tokens: String,
        language: String,
        use_itn: bool,
        provider: String,
        num_threads: i32,
        debug: bool,
    ) -> Result<Self> {
        let empty = CString::new("")?;
        let encoder = CString::new("")?;
        let decoder = CString::new("")?;
        let model = CString::new(model)?;
        let language = CString::new(language)?;
        let tokens = CString::new(tokens)?;
        let provider = CString::new(provider)?;
        let decoding_method = CString::new("greedy_search")?;

        let mut model_config: sherpa_rs_sys::SherpaOnnxOfflineModelConfig =
            unsafe { mem::zeroed() };
        model_config.tokens = tokens.as_ptr();
        model_config.num_threads = num_threads;
        model_config.debug = debug.into();
        model_config.provider = provider.as_ptr();
        model_config.sense_voice = sherpa_rs_sys::SherpaOnnxOfflineSenseVoiceModelConfig {
            model: model.as_ptr(),
            language: language.as_ptr(),
            use_itn: i32::from(use_itn),
        };
        model_config.fire_red_asr = sherpa_rs_sys::SherpaOnnxOfflineFireRedAsrModelConfig {
            encoder: empty.as_ptr(),
            decoder: empty.as_ptr(),
        };

        let mut recognizer_config: sherpa_rs_sys::SherpaOnnxOfflineRecognizerConfig =
            unsafe { mem::zeroed() };
        recognizer_config.feat_config = sherpa_rs_sys::SherpaOnnxFeatureConfig {
            sample_rate: 16000,
            feature_dim: 80,
        };
        recognizer_config.model_config = model_config;
        recognizer_config.decoding_method = decoding_method.as_ptr();
        recognizer_config.max_active_paths = 4;

        let recognizer =
            unsafe { sherpa_safe::SafeSherpaOnnxCreateOfflineRecognizer(&recognizer_config) };
        if recognizer.is_null() {
            return Err(anyhow::anyhow!(
                "Failed to create Sherpa offline recognizer"
            ));
        }

        Ok(Self {
            recognizer,
            _empty: empty,
            _tokens: tokens,
            _provider: provider,
            _decoding_method: decoding_method,
            _model: model,
            _language: language,
            _encoder: encoder,
            _decoder: decoder,
        })
    }

    pub(super) fn decode(&self, sample_rate: i32, samples: &[f32]) -> Result<String> {
        if samples.is_empty() {
            return Ok(String::new());
        }

        let stream = unsafe { sherpa_safe::SafeSherpaOnnxCreateOfflineStream(self.recognizer) };
        if stream.is_null() {
            return Err(anyhow::anyhow!("Failed to create Sherpa offline stream"));
        }

        if unsafe {
            sherpa_safe::SafeSherpaOnnxAcceptWaveformOffline(
                stream,
                sample_rate,
                samples.as_ptr(),
                samples.len() as i32,
            )
        } != 1
        {
            unsafe { sherpa_safe::SafeSherpaOnnxDestroyOfflineStream(stream) };
            return Err(anyhow::anyhow!("Sherpa offline accept waveform failed"));
        }
        if unsafe { sherpa_safe::SafeSherpaOnnxDecodeOfflineStream(self.recognizer, stream) } != 1 {
            unsafe { sherpa_safe::SafeSherpaOnnxDestroyOfflineStream(stream) };
            return Err(anyhow::anyhow!("Sherpa offline decode failed"));
        }

        let result_ptr = unsafe { sherpa_safe::SafeSherpaOnnxGetOfflineStreamResult(stream) };
        let text = if result_ptr.is_null() {
            String::new()
        } else {
            let raw_text = unsafe { (*result_ptr).text };
            if raw_text.is_null() {
                String::new()
            } else {
                unsafe { CStr::from_ptr(raw_text) }
                    .to_string_lossy()
                    .trim()
                    .to_string()
            }
        };

        unsafe {
            if !result_ptr.is_null() {
                sherpa_safe::SafeSherpaOnnxDestroyOfflineRecognizerResult(result_ptr);
            }
            sherpa_safe::SafeSherpaOnnxDestroyOfflineStream(stream);
        }

        Ok(text)
    }
}

unsafe impl Send for SherpaOnnxOfflineRecognizer {}
unsafe impl Sync for SherpaOnnxOfflineRecognizer {}

impl Drop for SherpaOnnxOfflineRecognizer {
    fn drop(&mut self) {
        unsafe {
            sherpa_safe::SafeSherpaOnnxDestroyOfflineRecognizer(self.recognizer);
        }
    }
}

impl SherpaOnnxOfflinePunctuation {
    pub(super) fn new_ct_transformer(
        model: String,
        provider: String,
        num_threads: i32,
        debug: bool,
    ) -> Result<Self> {
        let model = CString::new(model)?;
        let provider = CString::new(provider)?;

        let config = sherpa_rs_sys::SherpaOnnxOfflinePunctuationConfig {
            model: sherpa_rs_sys::SherpaOnnxOfflinePunctuationModelConfig {
                ct_transformer: model.as_ptr(),
                num_threads,
                debug: debug.into(),
                provider: provider.as_ptr(),
            },
        };

        let punct = unsafe { sherpa_safe::SafeSherpaOnnxCreateOfflinePunctuation(&config) };
        if punct.is_null() {
            return Err(anyhow::anyhow!(
                "Failed to create Sherpa offline punctuation model"
            ));
        }

        Ok(Self {
            punct,
            _model: model,
            _provider: provider,
        })
    }

    pub(super) fn add_punct(&self, text: &str) -> Result<String> {
        if text.trim().is_empty() {
            return Ok(String::new());
        }
        let input = CString::new(text)?;
        let out_ptr = unsafe {
            sherpa_safe::SafeSherpaOfflinePunctuationAddPunct(self.punct, input.as_ptr())
        };
        if out_ptr.is_null() {
            return Ok(String::new());
        }
        let out = unsafe { CStr::from_ptr(out_ptr) }
            .to_string_lossy()
            .to_string();
        unsafe {
            sherpa_safe::SafeSherpaOfflinePunctuationFreeText(out_ptr);
        }
        Ok(out)
    }
}

unsafe impl Send for SherpaOnnxOfflinePunctuation {}
unsafe impl Sync for SherpaOnnxOfflinePunctuation {}

impl Drop for SherpaOnnxOfflinePunctuation {
    fn drop(&mut self) {
        unsafe {
            sherpa_safe::SafeSherpaOnnxDestroyOfflinePunctuation(self.punct);
        }
    }
}
