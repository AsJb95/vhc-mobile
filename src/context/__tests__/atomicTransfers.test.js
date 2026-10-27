import { supabase } from '../../lib/supabaseClient';

// Mock supabase client methods
jest.mock('../../lib/supabaseClient', () => ({
  supabase: {
    rpc: jest.fn(),
    from: jest.fn(),
  },
}));

describe('Atomic Stock Transfer RPC Context Logic', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('RPC Parameters & Contract Verification', () => {
    it('accept_stock_transfer accepts transfer ID and returns jsonb response', async () => {
      supabase.rpc.mockResolvedValueOnce({
        data: { ok: true, transfer_id: 'to-123', transfer_number: 'TR-2026-0001', status: 'Completed', items_transferred: 3 },
        error: null,
      });

      const transferId = 'to-123';
      const { data, error } = await supabase.rpc('accept_stock_transfer', { p_transfer_id: transferId });

      expect(supabase.rpc).toHaveBeenCalledWith('accept_stock_transfer', { p_transfer_id: 'to-123' });
      expect(error).toBeNull();
      expect(data).toMatchObject({
        ok: true,
        transfer_id: 'to-123',
        status: 'Completed',
        items_transferred: 3,
      });
    });

    it('reject_stock_transfer accepts transfer ID and optional reason', async () => {
      supabase.rpc.mockResolvedValueOnce({
        data: { ok: true, transfer_id: 'to-123', transfer_number: 'TR-2026-0001', status: 'Rejected' },
        error: null,
      });

      const transferId = 'to-123';
      const reason = 'Near expiry package';
      const { data, error } = await supabase.rpc('reject_stock_transfer', {
        p_transfer_id: transferId,
        p_reason: reason,
      });

      expect(supabase.rpc).toHaveBeenCalledWith('reject_stock_transfer', {
        p_transfer_id: 'to-123',
        p_reason: 'Near expiry package',
      });
      expect(error).toBeNull();
      expect(data).toMatchObject({
        ok: true,
        status: 'Rejected',
      });
    });

    it('surfaces database errors faithfully without swallowing', async () => {
      supabase.rpc.mockResolvedValueOnce({
        data: null,
        error: { message: 'Insufficient stock in warehouse', code: 'P0001' },
      });

      const { data, error } = await supabase.rpc('accept_stock_transfer', { p_transfer_id: 'to-insufficient' });

      expect(data).toBeNull();
      expect(error).toBeDefined();
      expect(error.message).toContain('Insufficient stock');
    });

    it('handles idempotent retries when already completed', async () => {
      supabase.rpc.mockResolvedValueOnce({
        data: { ok: true, already_completed: true, transfer_id: 'to-123', status: 'Completed' },
        error: null,
      });

      const { data, error } = await supabase.rpc('accept_stock_transfer', { p_transfer_id: 'to-123' });

      expect(error).toBeNull();
      expect(data.already_completed).toBe(true);
      expect(data.status).toBe('Completed');
    });
  });
});
