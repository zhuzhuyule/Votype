use std::os::raw::c_char;

extern "C" {
    pub fn SafeSherpaOnnxCreateOnlineRecognizer(
        config: *const sherpa_rs_sys::SherpaOnnxOnlineRecognizerConfig,
    ) -> *const sherpa_rs_sys::SherpaOnnxOnlineRecognizer;
    pub fn SafeSherpaOnnxDestroyOnlineRecognizer(
        recognizer: *const sherpa_rs_sys::SherpaOnnxOnlineRecognizer,
    );
    pub fn SafeSherpaOnnxCreateOnlineStream(
        recognizer: *const sherpa_rs_sys::SherpaOnnxOnlineRecognizer,
    ) -> *const sherpa_rs_sys::SherpaOnnxOnlineStream;
    pub fn SafeSherpaOnnxDestroyOnlineStream(stream: *const sherpa_rs_sys::SherpaOnnxOnlineStream);
    pub fn SafeSherpaOnnxOnlineStreamAcceptWaveform(
        stream: *const sherpa_rs_sys::SherpaOnnxOnlineStream,
        sample_rate: i32,
        samples: *const f32,
        n: i32,
    ) -> i32;
    pub fn SafeSherpaOnnxOnlineStreamInputFinished(
        stream: *const sherpa_rs_sys::SherpaOnnxOnlineStream,
    ) -> i32;
    pub fn SafeSherpaOnnxIsOnlineStreamReady(
        recognizer: *const sherpa_rs_sys::SherpaOnnxOnlineRecognizer,
        stream: *const sherpa_rs_sys::SherpaOnnxOnlineStream,
    ) -> i32;
    pub fn SafeSherpaOnnxDecodeOnlineStream(
        recognizer: *const sherpa_rs_sys::SherpaOnnxOnlineRecognizer,
        stream: *const sherpa_rs_sys::SherpaOnnxOnlineStream,
    ) -> i32;
    pub fn SafeSherpaOnnxGetOnlineStreamResult(
        recognizer: *const sherpa_rs_sys::SherpaOnnxOnlineRecognizer,
        stream: *const sherpa_rs_sys::SherpaOnnxOnlineStream,
    ) -> *const sherpa_rs_sys::SherpaOnnxOnlineRecognizerResult;
    pub fn SafeSherpaOnnxDestroyOnlineRecognizerResult(
        result: *const sherpa_rs_sys::SherpaOnnxOnlineRecognizerResult,
    );
    pub fn SafeSherpaOnnxOnlineStreamIsEndpoint(
        recognizer: *const sherpa_rs_sys::SherpaOnnxOnlineRecognizer,
        stream: *const sherpa_rs_sys::SherpaOnnxOnlineStream,
    ) -> i32;
    pub fn SafeSherpaOnnxOnlineStreamReset(
        recognizer: *const sherpa_rs_sys::SherpaOnnxOnlineRecognizer,
        stream: *const sherpa_rs_sys::SherpaOnnxOnlineStream,
    ) -> i32;

    pub fn SafeSherpaOnnxCreateOfflineRecognizer(
        config: *const sherpa_rs_sys::SherpaOnnxOfflineRecognizerConfig,
    ) -> *const sherpa_rs_sys::SherpaOnnxOfflineRecognizer;
    pub fn SafeSherpaOnnxDestroyOfflineRecognizer(
        recognizer: *const sherpa_rs_sys::SherpaOnnxOfflineRecognizer,
    );
    pub fn SafeSherpaOnnxCreateOfflineStream(
        recognizer: *const sherpa_rs_sys::SherpaOnnxOfflineRecognizer,
    ) -> *const sherpa_rs_sys::SherpaOnnxOfflineStream;
    pub fn SafeSherpaOnnxDestroyOfflineStream(
        stream: *const sherpa_rs_sys::SherpaOnnxOfflineStream,
    );
    pub fn SafeSherpaOnnxAcceptWaveformOffline(
        stream: *const sherpa_rs_sys::SherpaOnnxOfflineStream,
        sample_rate: i32,
        samples: *const f32,
        n: i32,
    ) -> i32;
    pub fn SafeSherpaOnnxDecodeOfflineStream(
        recognizer: *const sherpa_rs_sys::SherpaOnnxOfflineRecognizer,
        stream: *const sherpa_rs_sys::SherpaOnnxOfflineStream,
    ) -> i32;
    pub fn SafeSherpaOnnxGetOfflineStreamResult(
        stream: *const sherpa_rs_sys::SherpaOnnxOfflineStream,
    ) -> *const sherpa_rs_sys::SherpaOnnxOfflineRecognizerResult;
    pub fn SafeSherpaOnnxDestroyOfflineRecognizerResult(
        result: *const sherpa_rs_sys::SherpaOnnxOfflineRecognizerResult,
    );

    pub fn SafeSherpaOnnxCreateOfflinePunctuation(
        config: *const sherpa_rs_sys::SherpaOnnxOfflinePunctuationConfig,
    ) -> *const sherpa_rs_sys::SherpaOnnxOfflinePunctuation;
    pub fn SafeSherpaOnnxDestroyOfflinePunctuation(
        punct: *const sherpa_rs_sys::SherpaOnnxOfflinePunctuation,
    );
    pub fn SafeSherpaOfflinePunctuationAddPunct(
        punct: *const sherpa_rs_sys::SherpaOnnxOfflinePunctuation,
        text: *const c_char,
    ) -> *const c_char;
    pub fn SafeSherpaOfflinePunctuationFreeText(text: *const c_char);
}
