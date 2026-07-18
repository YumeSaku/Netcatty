#include <napi.h>

#include <cmath>
#include <cstdint>
#include <cstring>

#ifdef _WIN32
#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <imm.h>
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

HWND ResolveFocusedInputWindow(HWND root_window) {
  const DWORD thread_id = GetWindowThreadProcessId(root_window, nullptr);
  if (thread_id == 0) return root_window;

  GUITHREADINFO thread_info{};
  thread_info.cbSize = sizeof(thread_info);
  if (!GetGUIThreadInfo(thread_id, &thread_info) || !thread_info.hwndFocus) {
    return root_window;
  }
  if (thread_info.hwndFocus == root_window || IsChild(root_window, thread_info.hwndFocus)) {
    return thread_info.hwndFocus;
  }
  return root_window;
}

struct ImeContextState {
  bool available = false;
  bool open = false;
  bool conversion_available = false;
  DWORD conversion_mode = 0;
  DWORD sentence_mode = 0;
};

struct ImeContextHandle {
  HWND window = nullptr;
  HIMC context = nullptr;
};

ImeContextHandle AcquireImeContext(HWND input_window, HWND root_window) {
  HIMC context = ImmGetContext(input_window);
  if (context) return {input_window, context};
  if (input_window == root_window) return {};

  context = ImmGetContext(root_window);
  return context ? ImeContextHandle{root_window, context} : ImeContextHandle{};
}

ImeContextState ReadImeContextState(HWND input_window, HWND root_window) {
  ImeContextState state;
  const ImeContextHandle handle = AcquireImeContext(input_window, root_window);
  if (!handle.context) return state;

  state.available = true;
  state.open = ImmGetOpenStatus(handle.context) != FALSE;
  state.conversion_available =
      ImmGetConversionStatus(
          handle.context, &state.conversion_mode, &state.sentence_mode) != FALSE;
  ImmReleaseContext(handle.window, handle.context);
  return state;
}

bool ReadOptionalBool(const Napi::Object& object, const char* key, bool* value) {
  if (!object.Has(key)) return false;
  const Napi::Value property = object.Get(key);
  if (!property.IsBoolean()) return false;
  *value = property.As<Napi::Boolean>().Value();
  return true;
}

bool ReadOptionalDword(const Napi::Object& object, const char* key, DWORD* value) {
  if (!object.Has(key)) return false;
  const Napi::Value property = object.Get(key);
  if (!property.IsNumber()) return false;
  const double number = property.As<Napi::Number>().DoubleValue();
  if (!std::isfinite(number) || number < 0 || number > UINT32_MAX ||
      std::trunc(number) != number) {
    return false;
  }
  *value = static_cast<DWORD>(number);
  return true;
}

Napi::Value GetInputMethodStateForWindow(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  const HWND root_window = ReadWindowHandle(info, 0);
  if (env.IsExceptionPending()) return env.Null();

  const HWND input_window = ResolveFocusedInputWindow(root_window);

  const DWORD thread_id = GetWindowThreadProcessId(input_window, nullptr);
  if (thread_id == 0) {
    Napi::Error::New(env, "Could not resolve the window thread")
        .ThrowAsJavaScriptException();
    return env.Null();
  }

  const HKL layout = GetKeyboardLayout(thread_id);
  const auto value = static_cast<std::uint64_t>(
      reinterpret_cast<std::uintptr_t>(layout));

  Napi::Object result = Napi::Object::New(env);
  result.Set("layout", Napi::BigInt::New(env, value));

  const ImeContextState ime_state = ReadImeContextState(input_window, root_window);
  if (ime_state.available) {
    result.Set("imeOpen", Napi::Boolean::New(env, ime_state.open));
  }
  if (ime_state.conversion_available) {
    result.Set("conversionMode", Napi::Number::New(env, ime_state.conversion_mode));
    result.Set("sentenceMode", Napi::Number::New(env, ime_state.sentence_mode));
  }
  return result;
}

Napi::Value RequestInputMethodStateForWindow(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  const HWND root_window = ReadWindowHandle(info, 0);
  if (env.IsExceptionPending()) return Napi::Boolean::New(env, false);
  if (info.Length() < 2 || !info[1].IsObject()) {
    Napi::TypeError::New(env, "Expected an input method state object")
        .ThrowAsJavaScriptException();
    return Napi::Boolean::New(env, false);
  }

  const Napi::Object desired = info[1].As<Napi::Object>();
  if (!desired.Has("layout") || !desired.Get("layout").IsBigInt()) {
    Napi::TypeError::New(env, "Expected a keyboard layout bigint")
        .ThrowAsJavaScriptException();
    return Napi::Boolean::New(env, false);
  }
  bool lossless = false;
  const std::uint64_t value =
      desired.Get("layout").As<Napi::BigInt>().Uint64Value(&lossless);
  if (!lossless || value == 0) {
    Napi::RangeError::New(env, "Keyboard layout value is not valid")
        .ThrowAsJavaScriptException();
    return Napi::Boolean::New(env, false);
  }

  const HWND input_window = ResolveFocusedInputWindow(root_window);
  const DWORD thread_id = GetWindowThreadProcessId(input_window, nullptr);
  const auto layout = reinterpret_cast<HKL>(static_cast<std::uintptr_t>(value));
  bool applied = false;
  if (thread_id != 0 && GetKeyboardLayout(thread_id) != layout) {
    applied = PostMessageW(
        input_window,
        WM_INPUTLANGCHANGEREQUEST,
        0,
        reinterpret_cast<LPARAM>(layout)) != FALSE;
  }

  const ImeContextHandle context = AcquireImeContext(input_window, root_window);
  if (context.context) {
    DWORD conversion_mode = 0;
    DWORD sentence_mode = 0;
    const bool has_conversion_mode =
        ReadOptionalDword(desired, "conversionMode", &conversion_mode);
    const bool has_sentence_mode =
        ReadOptionalDword(desired, "sentenceMode", &sentence_mode);
    if (has_conversion_mode && has_sentence_mode) {
      DWORD current_conversion_mode = 0;
      DWORD current_sentence_mode = 0;
      if (!ImmGetConversionStatus(
              context.context, &current_conversion_mode, &current_sentence_mode) ||
          current_conversion_mode != conversion_mode ||
          current_sentence_mode != sentence_mode) {
        applied = ImmSetConversionStatus(
            context.context, conversion_mode, sentence_mode) != FALSE || applied;
      }
    }

    bool ime_open = false;
    if (ReadOptionalBool(desired, "imeOpen", &ime_open) &&
        (ImmGetOpenStatus(context.context) != FALSE) != ime_open) {
      applied = ImmSetOpenStatus(
          context.context, ime_open ? TRUE : FALSE) != FALSE || applied;
    }
    ImmReleaseContext(context.window, context.context);
  }

  return Napi::Boolean::New(env, applied);
}
#else
Napi::Value GetInputMethodStateForWindow(const Napi::CallbackInfo& info) {
  return info.Env().Null();
}

Napi::Value RequestInputMethodStateForWindow(const Napi::CallbackInfo& info) {
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
      "getInputMethodStateForWindow",
      Napi::Function::New(env, GetInputMethodStateForWindow));
  exports.Set(
      "requestInputMethodStateForWindow",
      Napi::Function::New(env, RequestInputMethodStateForWindow));
  return exports;
}

}  // namespace

NODE_API_MODULE(input_method_native, Init)
