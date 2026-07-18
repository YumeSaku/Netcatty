import { useCallback, useEffect, useRef, useState } from 'react';

import { netcattyBridge } from '../../infrastructure/services/netcattyBridge';

export type InputMethodMemorySupportStatus = 'checking' | 'supported' | 'unsupported';

export interface InputMethodMemorySupportState {
  status: InputMethodMemorySupportStatus;
  supported: boolean;
  platform?: string;
  errorCode?: string;
  error?: string;
}

interface InputMethodMemorySupportResult {
  supported: boolean;
  platform: string;
  errorCode?: string;
  error?: string;
}

export const INPUT_METHOD_SUPPORT_CHECKING: InputMethodMemorySupportState = {
  status: 'checking',
  supported: false,
};

export function resolveInputMethodMemorySupport(
  result: InputMethodMemorySupportResult,
): InputMethodMemorySupportState {
  return {
    status: result.supported === true ? 'supported' : 'unsupported',
    supported: result.supported === true,
    platform: result.platform,
    ...(result.errorCode ? { errorCode: result.errorCode } : {}),
    ...(result.error ? { error: result.error } : {}),
  };
}

export function inputMethodMemorySupportFailure(
  errorCode = 'support-check-failed',
): InputMethodMemorySupportState {
  return {
    status: 'unsupported',
    supported: false,
    errorCode,
  };
}

export function useInputMethodMemorySupport(): InputMethodMemorySupportState & {
  refresh: () => void;
} {
  const [support, setSupport] = useState<InputMethodMemorySupportState>(
    INPUT_METHOD_SUPPORT_CHECKING,
  );
  const requestIdRef = useRef(0);

  const refresh = useCallback(() => {
    const requestId = ++requestIdRef.current;
    setSupport(INPUT_METHOD_SUPPORT_CHECKING);

    const bridge = netcattyBridge.get();
    if (!bridge?.getInputMethodMemorySupport) {
      setSupport(inputMethodMemorySupportFailure('bridge-unavailable'));
      return;
    }

    void bridge.getInputMethodMemorySupport()
      .then((result) => {
        if (requestIdRef.current === requestId) {
          setSupport(resolveInputMethodMemorySupport(result));
        }
      })
      .catch(() => {
        if (requestIdRef.current === requestId) {
          setSupport(inputMethodMemorySupportFailure());
        }
      });
  }, []);

  useEffect(() => {
    refresh();

    return () => {
      requestIdRef.current += 1;
    };
  }, [refresh]);

  return { ...support, refresh };
}
