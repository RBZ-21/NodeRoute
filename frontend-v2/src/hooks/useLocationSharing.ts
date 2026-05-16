import { useRef, useState } from 'react';
import { sendWithAuth } from '../lib/api';
import type { LocationStatusTone } from '../pages/driver.types';

type LocationStatus = { text: string; tone: LocationStatusTone };

export function useLocationSharing() {
  const watchIdRef = useRef<number | null>(null);
  const [locationBusy, setLocationBusy]     = useState(false);
  const [locationStatus, setLocationStatus] = useState<LocationStatus>({ text: 'Location sync idle', tone: 'neutral' });

  function start() {
    if (!navigator.geolocation) {
      setLocationStatus({ text: 'Geolocation is not available on this device.', tone: 'error' });
      return;
    }
    if (watchIdRef.current != null) return;

    setLocationBusy(true);
    setLocationStatus({ text: 'Waiting for location access...', tone: 'warning' });

    const watchId = navigator.geolocation.watchPosition(
      async (position) => {
        try {
          await sendWithAuth('/api/driver/location', 'PATCH', {
            lat: position.coords.latitude,
            lng: position.coords.longitude,
            heading: position.coords.heading || 0,
            speed_mph: (position.coords.speed || 0) * 2.23694,
          });
          setLocationStatus({ text: `Location synced at ${new Date().toLocaleTimeString()}`, tone: 'success' });
          setLocationBusy(false);
        } catch (err) {
          setLocationStatus({ text: String((err as Error).message || 'Could not sync location.'), tone: 'error' });
          setLocationBusy(false);
        }
      },
      (geoError) => {
        setLocationStatus({ text: geoError.message || 'Location access was blocked.', tone: 'error' });
        watchIdRef.current = null;
        setLocationBusy(false);
      },
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 15_000 },
    );

    watchIdRef.current = watchId;
  }

  function stop() {
    if (watchIdRef.current != null) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }
    setLocationStatus({ text: 'Location sync idle', tone: 'neutral' });
    setLocationBusy(false);
  }

  return { watchIdRef, locationBusy, locationStatus, startLocationSharing: start, stopLocationSharing: stop };
}
