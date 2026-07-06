import { useCallback, useEffect, useRef } from 'react';
import { pingDriverLocation } from '@/lib/api';

const LOCATION_UPDATE_MIN_INTERVAL_MS = 5000;
const LOCATION_UPDATE_INTERVAL_MS = 60000;
const LOCATION_UPDATE_IDLE_TIMEOUT_MS = 30 * 60 * 1000;

type SendLocationOptions = {
  userInitiated?: boolean;
};

export function useLocationUpdater(enabled: boolean, onSuccess?: () => void) {
  const hasWarnedRef = useRef(false);
  const lastSentAtRef = useRef(0);
  const lastActiveAtRef = useRef(Date.now());

  const sendLocation = useCallback(async (options: SendLocationOptions = {}) => {
    if (!enabled || !window.navigator.geolocation) return;
    const now = Date.now();
    if (options.userInitiated) {
      lastActiveAtRef.current = now;
    }
    if (now - lastActiveAtRef.current > LOCATION_UPDATE_IDLE_TIMEOUT_MS) return;
    if (now - lastSentAtRef.current < LOCATION_UPDATE_MIN_INTERVAL_MS) return;
    lastSentAtRef.current = now;

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
  }, [enabled, onSuccess]);

  useEffect(() => {
    if (!enabled) return;

    lastActiveAtRef.current = Date.now();
    void sendLocation({ userInitiated: true });
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') {
        void sendLocation();
      }
    }, LOCATION_UPDATE_INTERVAL_MS);

    return () => window.clearInterval(timer);
  }, [enabled, sendLocation]);

  return { sendLocation };
}
