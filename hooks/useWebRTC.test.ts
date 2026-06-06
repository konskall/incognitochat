import { describe, it, expect } from 'vitest';
import { mediaErrorMessage } from './useWebRTC';

// The user-facing notice when a call can't get the mic/camera. These cover the
// real DOMException names getUserMedia throws (e.g. a desktop with no camera).
describe('mediaErrorMessage', () => {
  it('explains blocked permissions', () => {
    expect(mediaErrorMessage({ name: 'NotAllowedError' })).toMatch(/blocked/i);
    expect(mediaErrorMessage({ name: 'SecurityError' })).toMatch(/blocked/i);
  });

  it('explains a missing device (no mic/camera)', () => {
    expect(mediaErrorMessage({ name: 'NotFoundError' })).toMatch(/no microphone or camera/i);
    expect(mediaErrorMessage({ name: 'OverconstrainedError' })).toMatch(/no microphone or camera/i);
  });

  it('explains a device that is busy', () => {
    expect(mediaErrorMessage({ name: 'NotReadableError' })).toMatch(/already in use/i);
  });

  it('falls back to a generic message', () => {
    expect(mediaErrorMessage({ name: 'WeirdError' })).toMatch(/could not start the call/i);
    expect(mediaErrorMessage(null)).toMatch(/could not start the call/i);
  });
});
