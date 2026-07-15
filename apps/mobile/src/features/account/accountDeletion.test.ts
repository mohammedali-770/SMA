import { describe, expect, it } from 'vitest';

import {
  canSubmitDeletion,
  chooseReverifyMethod,
  deletionStatusMessageKey,
  isActiveDeletionStatus,
  isLikelyOffline,
  otpDeliverable,
  SUPPORT_EMAIL,
  SUPPORT_PHONE,
} from './accountDeletion';
import { STRINGS } from '../../i18n/strings';

describe('isActiveDeletionStatus', () => {
  it('treats in-flight statuses as active', () => {
    for (const s of ['queued', 'waiting_for_active_order', 'waiting_for_financial_process', 'processing', 'retry_scheduled', 'manual_review']) {
      expect(isActiveDeletionStatus(s)).toBe(true);
    }
  });
  it('treats terminal / unknown / empty as not active', () => {
    expect(isActiveDeletionStatus('completed')).toBe(false);
    expect(isActiveDeletionStatus('failed')).toBe(false);
    expect(isActiveDeletionStatus(null)).toBe(false);
    expect(isActiveDeletionStatus(undefined)).toBe(false);
    expect(isActiveDeletionStatus('something_else')).toBe(false);
  });
});

describe('deletionStatusMessageKey — raw status never surfaces', () => {
  it('maps internal statuses to friendly, existing keys', () => {
    expect(deletionStatusMessageKey('waiting_for_active_order')).toBe('delWaitingOrder');
    expect(deletionStatusMessageKey('waiting_for_financial_process')).toBe('delWaitingFinancial');
    expect(deletionStatusMessageKey('manual_review')).toBe('delManualReview');
    expect(deletionStatusMessageKey('completed')).toBe('delCompleted');
    expect(deletionStatusMessageKey('queued')).toBe('delReceived');
    expect(deletionStatusMessageKey('retry_scheduled')).toBe('delReceived');
    expect(deletionStatusMessageKey('anything_unknown')).toBe('delReceived');
  });
  it('every mapped key resolves to a real EN + AR string (never the raw status)', () => {
    for (const s of ['waiting_for_active_order', 'waiting_for_financial_process', 'manual_review', 'completed', 'queued']) {
      const key = deletionStatusMessageKey(s);
      expect(STRINGS.en[key]).toBeTruthy();
      expect(STRINGS.ar[key]).toBeTruthy();
      expect(STRINGS.en[key]).not.toContain(s); // the internal token is never shown
    }
  });
});

describe('canSubmitDeletion — acknowledgment + a valid factor required', () => {
  const base = { acknowledged: true, method: 'otp' as const, code: '', password: '' };

  it('requires acknowledgment', () => {
    expect(canSubmitDeletion({ ...base, acknowledged: false, code: '123456' })).toBe(false);
  });
  it('requires a chosen method', () => {
    expect(canSubmitDeletion({ ...base, method: null })).toBe(false);
  });
  it('otp: requires exactly 6 digits', () => {
    expect(canSubmitDeletion({ ...base, method: 'otp', code: '123456' })).toBe(true);
    expect(canSubmitDeletion({ ...base, method: 'otp', code: '12345' })).toBe(false);
    expect(canSubmitDeletion({ ...base, method: 'otp', code: 'abcdef' })).toBe(false);
  });
  it('reauth: requires a non-empty password', () => {
    expect(canSubmitDeletion({ ...base, method: 'reauth', password: 'pw' })).toBe(true);
    expect(canSubmitDeletion({ ...base, method: 'reauth', password: '' })).toBe(false);
  });
});

describe('chooseReverifyMethod / otpDeliverable — never present OTP when undeliverable', () => {
  it('prefers OTP only when deliverable', () => {
    expect(chooseReverifyMethod({ otp: true, reauth: true })).toBe('otp');
    expect(chooseReverifyMethod({ otp: true, reauth: false })).toBe('otp');
  });
  it('falls back to password reauth when OTP is unavailable', () => {
    expect(chooseReverifyMethod({ otp: false, reauth: true })).toBe('reauth');
  });
  it('reports unavailable when neither factor is usable (safe support state)', () => {
    expect(chooseReverifyMethod({ otp: false, reauth: false })).toBe('unavailable');
  });
  it('otpDeliverable only for sent/rate_limited, never disabled/no_phone/error', () => {
    expect(otpDeliverable('sent')).toBe(true);
    expect(otpDeliverable('rate_limited')).toBe(true);
    expect(otpDeliverable('disabled')).toBe(false);
    expect(otpDeliverable('no_phone')).toBe(false);
    expect(otpDeliverable('error')).toBe(false);
    expect(otpDeliverable(undefined)).toBe(false);
  });
});

describe('isLikelyOffline — safe offline handling for submission failures', () => {
  it('flags network / offline failures', () => {
    expect(isLikelyOffline(new Error('Network request failed'))).toBe(true);
    expect(isLikelyOffline(new Error('fetch failed: java.net.UnknownHostException'))).toBe(true);
    expect(isLikelyOffline('TypeError: Failed to fetch')).toBe(true);
  });
  it('does not flag ordinary server/validation errors', () => {
    expect(isLikelyOffline(new Error('verification_failed'))).toBe(false);
    expect(isLikelyOffline(new Error('request_failed'))).toBe(false);
    expect(isLikelyOffline(null)).toBe(false);
  });
});

describe('localization coverage — all delete-account strings exist EN + AR', () => {
  const KEYS = [
    'delAccount', 'delTitle', 'delSubtitle', 'delBulletAccess', 'delBulletAddresses',
    'delBulletProfile', 'delBulletLoyalty', 'delBulletSessions', 'delBulletDevices',
    'delBulletRetain', 'delBulletAnon', 'delBulletAppDelete', 'delBulletAuto', 'delBulletTimeline',
    'delAck', 'delContinue', 'delReverifyTitle', 'delReverifyOtpSub', 'delReverifyReauthSub',
    'delSendCode', 'delEnterCode', 'delPasswordLabel', 'delUsePassword', 'delOtpUnavailable',
    'delWrongPassword', 'delVerifyContinue', 'delFinalTitle', 'delFinalBody', 'delFinalConfirm',
    'delSubmitting', 'delSuccessTitle', 'delSuccessBody', 'delDone', 'delPendingTitle',
    'delReceived', 'delWaitingOrder', 'delWaitingFinancial', 'delManualReview', 'delCompleted',
    'delOffline', 'delError', 'delSupport', 'delUnavailable', 'delNoNotice',
  ] as const;

  it('has a non-empty EN and AR value for every key', () => {
    for (const k of KEYS) {
      expect(STRINGS.en[k], `en.${k}`).toBeTruthy();
      expect(STRINGS.ar[k], `ar.${k}`).toBeTruthy();
    }
  });

  it('uses the exact approved acknowledgment + success copy', () => {
    expect(STRINGS.en.delContinue).toBe('Continue account deletion');
    expect(STRINGS.ar.delContinue).toBe('متابعة حذف الحساب');
    expect(STRINGS.en.delSuccessBody).toContain('processed automatically and may take up to 30 days');
    expect(STRINGS.ar.delSuccessBody).toContain('تم استلام طلب حذف حسابك');
  });

  it('exposes the company support contacts', () => {
    expect(SUPPORT_EMAIL).toBe('info@spicymeal.com.sa');
    expect(SUPPORT_PHONE).toBe('920031495');
  });
});
