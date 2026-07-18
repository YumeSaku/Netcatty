import { useEffect, useState } from 'react';

import { netcattyBridge } from '../../infrastructure/services/netcattyBridge';

export function useInputMethodMemorySupport(): boolean {
  const [supported, setSupported] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const bridge = netcattyBridge.get();
    if (!bridge?.getInputMethodMemorySupport) return;

    void bridge.getInputMethodMemorySupport()
      .then((result) => {
        if (!cancelled) setSupported(result.supported === true);
      })
      .catch(() => {
        if (!cancelled) setSupported(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return supported;
}
