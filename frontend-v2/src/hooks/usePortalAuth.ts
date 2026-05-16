import { useState } from 'react';
import { clearPortalSession, getPortalToken, setPortalToken } from '../lib/portalApi';
import type { PortalAuthStart, PortalMe } from '../pages/portal.types';

export function usePortalAuth() {
  const [token, setToken] = useState(() => getPortalToken());
  const [authStep, setAuthStep] = useState<'email' | 'code'>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [challengeId, setChallengeId] = useState('');
  const [authMessage, setAuthMessage] = useState('');
  const [authError, setAuthError] = useState('');
  const [authSubmitting, setAuthSubmitting] = useState(false);
  const [me, setMe] = useState<PortalMe | null>(null);

  async function requestCode() {
    setAuthSubmitting(true);
    setAuthError('');
    setAuthMessage('');
    try {
      const response = await fetch('/api/portal/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim() }),
      });
      const payload = (await response.json()) as Partial<PortalAuthStart> & { error?: string };
      if (!response.ok || !payload.challengeId) {
        throw new Error(payload.error || 'Could not email a verification code.');
      }
      setChallengeId(payload.challengeId);
      setAuthStep('code');
      setAuthMessage(
        payload.maskedEmail
          ? `We sent a secure verification code to ${payload.maskedEmail}.`
          : 'We sent a secure verification code to your inbox.'
      );
    } catch (err) {
      setAuthError(String((err as Error).message || 'Could not email a verification code.'));
    } finally {
      setAuthSubmitting(false);
    }
  }

  async function verifyCode() {
    setAuthSubmitting(true);
    setAuthError('');
    try {
      const response = await fetch('/api/portal/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ challengeId, code: code.trim() }),
      });
      const payload = (await response.json()) as { token?: string; name?: string; email?: string; error?: string };
      if (!response.ok || !payload.token) {
        throw new Error(payload.error || 'Verification failed.');
      }
      setPortalToken(payload.token);
      setToken(payload.token);
      setMe({ name: payload.name || email.trim(), email: payload.email || email.trim() });
      setAuthStep('email');
      setChallengeId('');
      setCode('');
      setAuthMessage('');
    } catch (err) {
      setAuthError(String((err as Error).message || 'Verification failed.'));
    } finally {
      setAuthSubmitting(false);
    }
  }

  function resetLoginFlow() {
    setAuthStep('email');
    setChallengeId('');
    setCode('');
    setAuthMessage('');
    setAuthError('');
  }

  function logout() {
    clearPortalSession();
    setToken('');
    setMe(null);
    setAuthStep('email');
    setCode('');
    setChallengeId('');
    setAuthMessage('');
    setAuthError('');
  }

  return {
    token, setToken,
    me, setMe,
    authStep,
    email, setEmail,
    code, setCode,
    authMessage, authError, authSubmitting,
    requestCode, verifyCode, resetLoginFlow, logout,
  };
}
