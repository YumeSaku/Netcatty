#include <napi.h>

#include <cstdint>
#include <cstring>

#ifdef _WIN32
#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#endif

namespace {

#ifdef _WIN32
HWND ReadWindowHandle(const Napi::CallbackInfo& info, std::size_t index) {
  Napi::Env env = info.Env();
  if (info.Length() <= index || !info[index].IsBuffer()) {
    Napi::TypeError::New(env, "Expected a native window handle buffer")
        .ThrowAsJavaScriptException();
    return nullptr;
  }

  const auto buffer = info[index].As<Napi::Buffer<std::uint8_t>>();
  if (buffer.Length() < sizeof(HWND)) {
    Napi::RangeError::New(env, "Native window handle buffer is too small")
        .ThrowAsJavaScriptException();
    return nullptr;
  }

  HWND window = nullptr;
  std::memcpy(&window, buffer.Data(), sizeof(HWND));
  if (!IsWindow(window)) {
    Napi::RangeError::New(env, "Native window handle is not valid")
        .ThrowAsJavaScriptException();
    return nullptr;
  }
  return window;
}

Napi::Value GetKeyboardLayoutForWindow(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  HWND window = ReadWindowHandle(info, 0);
  if (env.IsExceptionPending()) return env.Null();

  const DWORD thread_id = GetWindowThreadProcessId(window, nullptr);
  if (thread_id == 0) {
    Napi::Error::New(env, "Could not resolve the window thread")
        .ThrowAsJavaScriptException();
    return env.Null();
  }

  const HKL layout = GetKeyboardLayout(thread_id);
  const auto value = static_cast<std::uint64_t>(
      reinterpret_cast<std::uintptr_t>(layout));
  return Napi::BigInt::New(env, value);
}

Napi::Value RequestKeyboardLayoutForWindow(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  HWND window = ReadWindowHandle(info, 0);
  if (env.IsExceptionPending()) return Napi::Boolean::New(env, false);
  if (info.Length() < 2 || !info[1].IsBigInt()) {
    Napi::TypeError::New(env, "Expected a keyboard layout bigint")
        .ThrowAsJavaScriptException();
    return Napi::Boolean::New(env, false);
  }

  bool lossless = false;
  const std::uint64_t value = info[1].As<Napi::BigInt>().Uint64Value(&lossless);
  if (!lossless || value == 0) {
    Napi::RangeError::New(env, "Keyboard layout value is not valid")
        .ThrowAsJavaScriptException();
    return Napi::Boolean::New(env, false);
  }

  const auto layout = reinterpret_cast<HKL>(static_cast<std::uintptr_t>(value));
  const BOOL posted = PostMessageW(
      window,
      WM_INPUTLANGCHANGEREQUEST,
      0,
      reinterpret_cast<LPARAM>(layout));
  return Napi::Boolean::New(env, posted != FALSE);
}
#else
Napi::Value GetKeyboardLayoutForWindow(const Napi::CallbackInfo& info) {
  return info.Env().Null();
}

Napi::Value RequestKeyboardLayoutForWindow(const Napi::CallbackInfo& info) {
  return Napi::Boolean::New(info.Env(), false);
}
#endif

Napi::Object Init(Napi::Env env, Napi::Object exports) {
#ifdef _WIN32
  constexpr bool supported = true;
#else
  constexpr bool supported = false;
#endif
  exports.Set("supported", Napi::Boolean::New(env, supported));
  exports.Set(
      "getKeyboardLayoutForWindow",
      Napi::Function::New(env, GetKeyboardLayoutForWindow));
  exports.Set(
      "requestKeyboardLayoutForWindow",
      Napi::Function::New(env, RequestKeyboardLayoutForWindow));
  return exports;
}

}  // namespace

NODE_API_MODULE(input_method_native, Init)
