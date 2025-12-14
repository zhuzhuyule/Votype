#include <cstdint>
#include <cstdio>
#include <exception>
// This file intentionally avoids including sherpa-onnx headers to keep the build
// resilient to upstream include path changes. We only need pointer types.

extern "C" {
struct SherpaOnnxOnlineRecognizerConfig;
struct SherpaOnnxOnlineRecognizer;
struct SherpaOnnxOnlineStream;
struct SherpaOnnxOnlineRecognizerResult;

struct SherpaOnnxOfflineRecognizerConfig;
struct SherpaOnnxOfflineRecognizer;
struct SherpaOnnxOfflineStream;
struct SherpaOnnxOfflineRecognizerResult;

struct SherpaOnnxOfflinePunctuationConfig;
struct SherpaOnnxOfflinePunctuation;

// ---- Upstream sherpa-onnx C API (linked via sherpa-rs-sys) ------------------
const SherpaOnnxOnlineRecognizer *SherpaOnnxCreateOnlineRecognizer(
    const SherpaOnnxOnlineRecognizerConfig *config);
void SherpaOnnxDestroyOnlineRecognizer(const SherpaOnnxOnlineRecognizer *recognizer);
const SherpaOnnxOnlineStream *SherpaOnnxCreateOnlineStream(
    const SherpaOnnxOnlineRecognizer *recognizer);
void SherpaOnnxDestroyOnlineStream(const SherpaOnnxOnlineStream *stream);
void SherpaOnnxOnlineStreamAcceptWaveform(const SherpaOnnxOnlineStream *stream,
                                          int32_t sample_rate,
                                          const float *samples, int32_t n);
void SherpaOnnxOnlineStreamInputFinished(const SherpaOnnxOnlineStream *stream);
int32_t SherpaOnnxIsOnlineStreamReady(const SherpaOnnxOnlineRecognizer *recognizer,
                                      const SherpaOnnxOnlineStream *stream);
void SherpaOnnxDecodeOnlineStream(const SherpaOnnxOnlineRecognizer *recognizer,
                                  const SherpaOnnxOnlineStream *stream);
const SherpaOnnxOnlineRecognizerResult *SherpaOnnxGetOnlineStreamResult(
    const SherpaOnnxOnlineRecognizer *recognizer, const SherpaOnnxOnlineStream *stream);
void SherpaOnnxDestroyOnlineRecognizerResult(const SherpaOnnxOnlineRecognizerResult *r);
int32_t SherpaOnnxOnlineStreamIsEndpoint(const SherpaOnnxOnlineRecognizer *recognizer,
                                        const SherpaOnnxOnlineStream *stream);
void SherpaOnnxOnlineStreamReset(const SherpaOnnxOnlineRecognizer *recognizer,
                                 const SherpaOnnxOnlineStream *stream);

const SherpaOnnxOfflineRecognizer *SherpaOnnxCreateOfflineRecognizer(
    const SherpaOnnxOfflineRecognizerConfig *config);
void SherpaOnnxDestroyOfflineRecognizer(const SherpaOnnxOfflineRecognizer *recognizer);
const SherpaOnnxOfflineStream *SherpaOnnxCreateOfflineStream(
    const SherpaOnnxOfflineRecognizer *recognizer);
void SherpaOnnxDestroyOfflineStream(const SherpaOnnxOfflineStream *stream);
void SherpaOnnxAcceptWaveformOffline(const SherpaOnnxOfflineStream *stream,
                                     int32_t sample_rate, const float *samples, int32_t n);
void SherpaOnnxDecodeOfflineStream(const SherpaOnnxOfflineRecognizer *recognizer,
                                  const SherpaOnnxOfflineStream *stream);
const SherpaOnnxOfflineRecognizerResult *SherpaOnnxGetOfflineStreamResult(
    const SherpaOnnxOfflineStream *stream);
void SherpaOnnxDestroyOfflineRecognizerResult(const SherpaOnnxOfflineRecognizerResult *r);

const SherpaOnnxOfflinePunctuation *SherpaOnnxCreateOfflinePunctuation(
    const SherpaOnnxOfflinePunctuationConfig *config);
void SherpaOnnxDestroyOfflinePunctuation(const SherpaOnnxOfflinePunctuation *punct);
const char *SherpaOfflinePunctuationAddPunct(const SherpaOnnxOfflinePunctuation *punct,
                                             const char *text);
void SherpaOfflinePunctuationFreeText(const char *text);
}

static void log_exception(const char *where, const std::exception &e) {
  std::fprintf(stderr, "[sherpa_safe] %s: %s\n", where, e.what());
}

static void log_unknown(const char *where) {
  std::fprintf(stderr, "[sherpa_safe] %s: unknown exception\n", where);
}

extern "C" {
// ---- Safe wrappers (never allow C++ exceptions to cross into Rust) ---------
const SherpaOnnxOnlineRecognizer *SafeSherpaOnnxCreateOnlineRecognizer(
    const SherpaOnnxOnlineRecognizerConfig *config) {
  try {
    return SherpaOnnxCreateOnlineRecognizer(config);
  } catch (const std::exception &e) {
    log_exception("SafeSherpaOnnxCreateOnlineRecognizer", e);
    return nullptr;
  } catch (...) {
    log_unknown("SafeSherpaOnnxCreateOnlineRecognizer");
    return nullptr;
  }
}

void SafeSherpaOnnxDestroyOnlineRecognizer(const SherpaOnnxOnlineRecognizer *recognizer) {
  try {
    SherpaOnnxDestroyOnlineRecognizer(recognizer);
  } catch (const std::exception &e) {
    log_exception("SafeSherpaOnnxDestroyOnlineRecognizer", e);
  } catch (...) {
    log_unknown("SafeSherpaOnnxDestroyOnlineRecognizer");
  }
}

const SherpaOnnxOnlineStream *SafeSherpaOnnxCreateOnlineStream(
    const SherpaOnnxOnlineRecognizer *recognizer) {
  try {
    return SherpaOnnxCreateOnlineStream(recognizer);
  } catch (const std::exception &e) {
    log_exception("SafeSherpaOnnxCreateOnlineStream", e);
    return nullptr;
  } catch (...) {
    log_unknown("SafeSherpaOnnxCreateOnlineStream");
    return nullptr;
  }
}

void SafeSherpaOnnxDestroyOnlineStream(const SherpaOnnxOnlineStream *stream) {
  try {
    SherpaOnnxDestroyOnlineStream(stream);
  } catch (const std::exception &e) {
    log_exception("SafeSherpaOnnxDestroyOnlineStream", e);
  } catch (...) {
    log_unknown("SafeSherpaOnnxDestroyOnlineStream");
  }
}

int32_t SafeSherpaOnnxOnlineStreamAcceptWaveform(const SherpaOnnxOnlineStream *stream,
                                                 int32_t sample_rate,
                                                 const float *samples, int32_t n) {
  try {
    SherpaOnnxOnlineStreamAcceptWaveform(stream, sample_rate, samples, n);
    return 1;
  } catch (const std::exception &e) {
    log_exception("SafeSherpaOnnxOnlineStreamAcceptWaveform", e);
    return 0;
  } catch (...) {
    log_unknown("SafeSherpaOnnxOnlineStreamAcceptWaveform");
    return 0;
  }
}

int32_t SafeSherpaOnnxOnlineStreamInputFinished(const SherpaOnnxOnlineStream *stream) {
  try {
    SherpaOnnxOnlineStreamInputFinished(stream);
    return 1;
  } catch (const std::exception &e) {
    log_exception("SafeSherpaOnnxOnlineStreamInputFinished", e);
    return 0;
  } catch (...) {
    log_unknown("SafeSherpaOnnxOnlineStreamInputFinished");
    return 0;
  }
}

int32_t SafeSherpaOnnxIsOnlineStreamReady(const SherpaOnnxOnlineRecognizer *recognizer,
                                         const SherpaOnnxOnlineStream *stream) {
  try {
    return SherpaOnnxIsOnlineStreamReady(recognizer, stream);
  } catch (const std::exception &e) {
    log_exception("SafeSherpaOnnxIsOnlineStreamReady", e);
    return 0;
  } catch (...) {
    log_unknown("SafeSherpaOnnxIsOnlineStreamReady");
    return 0;
  }
}

int32_t SafeSherpaOnnxDecodeOnlineStream(const SherpaOnnxOnlineRecognizer *recognizer,
                                        const SherpaOnnxOnlineStream *stream) {
  try {
    SherpaOnnxDecodeOnlineStream(recognizer, stream);
    return 1;
  } catch (const std::exception &e) {
    log_exception("SafeSherpaOnnxDecodeOnlineStream", e);
    return 0;
  } catch (...) {
    log_unknown("SafeSherpaOnnxDecodeOnlineStream");
    return 0;
  }
}

const SherpaOnnxOnlineRecognizerResult *SafeSherpaOnnxGetOnlineStreamResult(
    const SherpaOnnxOnlineRecognizer *recognizer, const SherpaOnnxOnlineStream *stream) {
  try {
    return SherpaOnnxGetOnlineStreamResult(recognizer, stream);
  } catch (const std::exception &e) {
    log_exception("SafeSherpaOnnxGetOnlineStreamResult", e);
    return nullptr;
  } catch (...) {
    log_unknown("SafeSherpaOnnxGetOnlineStreamResult");
    return nullptr;
  }
}

void SafeSherpaOnnxDestroyOnlineRecognizerResult(const SherpaOnnxOnlineRecognizerResult *r) {
  try {
    SherpaOnnxDestroyOnlineRecognizerResult(r);
  } catch (const std::exception &e) {
    log_exception("SafeSherpaOnnxDestroyOnlineRecognizerResult", e);
  } catch (...) {
    log_unknown("SafeSherpaOnnxDestroyOnlineRecognizerResult");
  }
}

int32_t SafeSherpaOnnxOnlineStreamIsEndpoint(const SherpaOnnxOnlineRecognizer *recognizer,
                                            const SherpaOnnxOnlineStream *stream) {
  try {
    return SherpaOnnxOnlineStreamIsEndpoint(recognizer, stream);
  } catch (const std::exception &e) {
    log_exception("SafeSherpaOnnxOnlineStreamIsEndpoint", e);
    return 0;
  } catch (...) {
    log_unknown("SafeSherpaOnnxOnlineStreamIsEndpoint");
    return 0;
  }
}

int32_t SafeSherpaOnnxOnlineStreamReset(const SherpaOnnxOnlineRecognizer *recognizer,
                                       const SherpaOnnxOnlineStream *stream) {
  try {
    SherpaOnnxOnlineStreamReset(recognizer, stream);
    return 1;
  } catch (const std::exception &e) {
    log_exception("SafeSherpaOnnxOnlineStreamReset", e);
    return 0;
  } catch (...) {
    log_unknown("SafeSherpaOnnxOnlineStreamReset");
    return 0;
  }
}

const SherpaOnnxOfflineRecognizer *SafeSherpaOnnxCreateOfflineRecognizer(
    const SherpaOnnxOfflineRecognizerConfig *config) {
  try {
    return SherpaOnnxCreateOfflineRecognizer(config);
  } catch (const std::exception &e) {
    log_exception("SafeSherpaOnnxCreateOfflineRecognizer", e);
    return nullptr;
  } catch (...) {
    log_unknown("SafeSherpaOnnxCreateOfflineRecognizer");
    return nullptr;
  }
}

void SafeSherpaOnnxDestroyOfflineRecognizer(const SherpaOnnxOfflineRecognizer *recognizer) {
  try {
    SherpaOnnxDestroyOfflineRecognizer(recognizer);
  } catch (const std::exception &e) {
    log_exception("SafeSherpaOnnxDestroyOfflineRecognizer", e);
  } catch (...) {
    log_unknown("SafeSherpaOnnxDestroyOfflineRecognizer");
  }
}

const SherpaOnnxOfflineStream *SafeSherpaOnnxCreateOfflineStream(
    const SherpaOnnxOfflineRecognizer *recognizer) {
  try {
    return SherpaOnnxCreateOfflineStream(recognizer);
  } catch (const std::exception &e) {
    log_exception("SafeSherpaOnnxCreateOfflineStream", e);
    return nullptr;
  } catch (...) {
    log_unknown("SafeSherpaOnnxCreateOfflineStream");
    return nullptr;
  }
}

void SafeSherpaOnnxDestroyOfflineStream(const SherpaOnnxOfflineStream *stream) {
  try {
    SherpaOnnxDestroyOfflineStream(stream);
  } catch (const std::exception &e) {
    log_exception("SafeSherpaOnnxDestroyOfflineStream", e);
  } catch (...) {
    log_unknown("SafeSherpaOnnxDestroyOfflineStream");
  }
}

int32_t SafeSherpaOnnxAcceptWaveformOffline(const SherpaOnnxOfflineStream *stream,
                                           int32_t sample_rate, const float *samples,
                                           int32_t n) {
  try {
    SherpaOnnxAcceptWaveformOffline(stream, sample_rate, samples, n);
    return 1;
  } catch (const std::exception &e) {
    log_exception("SafeSherpaOnnxAcceptWaveformOffline", e);
    return 0;
  } catch (...) {
    log_unknown("SafeSherpaOnnxAcceptWaveformOffline");
    return 0;
  }
}

int32_t SafeSherpaOnnxDecodeOfflineStream(const SherpaOnnxOfflineRecognizer *recognizer,
                                         const SherpaOnnxOfflineStream *stream) {
  try {
    SherpaOnnxDecodeOfflineStream(recognizer, stream);
    return 1;
  } catch (const std::exception &e) {
    log_exception("SafeSherpaOnnxDecodeOfflineStream", e);
    return 0;
  } catch (...) {
    log_unknown("SafeSherpaOnnxDecodeOfflineStream");
    return 0;
  }
}

const SherpaOnnxOfflineRecognizerResult *SafeSherpaOnnxGetOfflineStreamResult(
    const SherpaOnnxOfflineStream *stream) {
  try {
    return SherpaOnnxGetOfflineStreamResult(stream);
  } catch (const std::exception &e) {
    log_exception("SafeSherpaOnnxGetOfflineStreamResult", e);
    return nullptr;
  } catch (...) {
    log_unknown("SafeSherpaOnnxGetOfflineStreamResult");
    return nullptr;
  }
}

void SafeSherpaOnnxDestroyOfflineRecognizerResult(const SherpaOnnxOfflineRecognizerResult *r) {
  try {
    SherpaOnnxDestroyOfflineRecognizerResult(r);
  } catch (const std::exception &e) {
    log_exception("SafeSherpaOnnxDestroyOfflineRecognizerResult", e);
  } catch (...) {
    log_unknown("SafeSherpaOnnxDestroyOfflineRecognizerResult");
  }
}

const SherpaOnnxOfflinePunctuation *SafeSherpaOnnxCreateOfflinePunctuation(
    const SherpaOnnxOfflinePunctuationConfig *config) {
  try {
    return SherpaOnnxCreateOfflinePunctuation(config);
  } catch (const std::exception &e) {
    log_exception("SafeSherpaOnnxCreateOfflinePunctuation", e);
    return nullptr;
  } catch (...) {
    log_unknown("SafeSherpaOnnxCreateOfflinePunctuation");
    return nullptr;
  }
}

void SafeSherpaOnnxDestroyOfflinePunctuation(const SherpaOnnxOfflinePunctuation *punct) {
  try {
    SherpaOnnxDestroyOfflinePunctuation(punct);
  } catch (const std::exception &e) {
    log_exception("SafeSherpaOnnxDestroyOfflinePunctuation", e);
  } catch (...) {
    log_unknown("SafeSherpaOnnxDestroyOfflinePunctuation");
  }
}

const char *SafeSherpaOfflinePunctuationAddPunct(const SherpaOnnxOfflinePunctuation *punct,
                                                 const char *text) {
  try {
    return SherpaOfflinePunctuationAddPunct(punct, text);
  } catch (const std::exception &e) {
    log_exception("SafeSherpaOfflinePunctuationAddPunct", e);
    return nullptr;
  } catch (...) {
    log_unknown("SafeSherpaOfflinePunctuationAddPunct");
    return nullptr;
  }
}

void SafeSherpaOfflinePunctuationFreeText(const char *text) {
  try {
    SherpaOfflinePunctuationFreeText(text);
  } catch (const std::exception &e) {
    log_exception("SafeSherpaOfflinePunctuationFreeText", e);
  } catch (...) {
    log_unknown("SafeSherpaOfflinePunctuationFreeText");
  }
}
}

