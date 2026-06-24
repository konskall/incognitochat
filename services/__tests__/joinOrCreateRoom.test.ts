import { describe, it, expect, vi, beforeEach } from 'vitest';

const rpc = vi.hoisted(() => vi.fn());
vi.mock('../supabase', async (orig) => {
  const actual = await (orig as any)();
  actual.supabase.rpc = rpc;
  return actual;
});

import { joinOrCreateRoom } from '../supabase';

describe('joinOrCreateRoom', () => {
  beforeEach(() => rpc.mockReset());

  it('flags a pending response (locked room) without data', async () => {
    rpc.mockResolvedValue({ data: { pending: true, room_name: 'T' }, error: null });
    const r = await joinOrCreateRoom({ roomKey: 'k', roomName: 'T', pin: '1', username: 'u' });
    expect(r.pending).toBe(true);
    expect(r.data).toBeNull();
    expect(r.error).toBeNull();
  });

  it('returns full data (with approval_required) on a normal join', async () => {
    rpc.mockResolvedValue({ data: { room_key: 'k', room_name: 'T', created_by: 'o', is_new: false, approval_required: true }, error: null });
    const r = await joinOrCreateRoom({ roomKey: 'k', roomName: 'T', pin: '1', username: 'u' });
    expect(r.pending).toBe(false);
    expect(r.data?.approval_required).toBe(true);
  });
});
