import { useEffect, useRef } from 'react';
import { pingDriverLocation } from '@/lib/api';

export function useLocationUpdater(enabled: boolean, onSuccess?: () => void) {
  const hasWarnedRef = useRef(false);

  async function sendLocation() {
    if (!enabled || !window.navigator.geolocation) return;

    return new Promise<void>((resolve) => {
      window.navigator.geolocation.getCurrentPosition(
        async (position) => {
          try {
            await pingDriverLocation({
              lat: position.coords.latitude,
              lng: position.coords.longitude,
              heading: position.coords.heading,
              speed_mph: position.coords.speed ? position.coords.speed * 2.23694 : 0,
            });
            onSuccess?.();
          } finally {
            resolve();
          }
        },
        () => {
          if (!hasWarnedRef.current) {
            hasWarnedRef.current = true;
          }
          resolve();
        },
        {
          enableHighAccuracy: true,
          maximumAge: 30000,
          timeout: 10000,
        }
      );
    });
  }

  useEffect(() => {
    if (!enabled) return;

    void sendLocation();
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') {
        void sendLocation();
      }
    }, 60000);

    return () => window.clearInterval(timer);
  }, [enabled]);

  return { sendLocation };
}
