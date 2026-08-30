import { listDriveBackups, getDriveBackupContent, restorePharmacyBackup } from '../adminApi';

const realFetch = global.fetch;
afterEach(() => { global.fetch = realFetch; jest.clearAllMocks(); });

function mockFetchOnce({ ok = true, status = 200, body = '', statusText = '' }) {
  global.fetch = jest.fn().mockResolvedValue({
    ok,
    status,
    statusText,
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
  });
}

describe('adminApi — response parsing', () => {
  it('returns the backups array on a normal JSON 200', async () => {
    mockFetchOnce({ body: { backups: [{ id: 'a' }, { id: 'b' }] } });
    await expect(listDriveBackups('tok')).resolves.toEqual([{ id: 'a' }, { id: 'b' }]);
  });

  it('coerces a missing backups field to []', async () => {
    mockFetchOnce({ body: {} });
    await expect(listDriveBackups('tok')).resolves.toEqual([]);
  });

  it('returns {} for a 200 with an empty body (no throw)', async () => {
    mockFetchOnce({ body: '' });
    await expect(getDriveBackupContent('tok', 'file1')).resolves.toEqual({});
  });

  it('throws "HTTP <status>: <detail>" from a JSON error body', async () => {
    mockFetchOnce({ ok: false, status: 403, body: { error: 'Admin role required' } });
    await expect(listDriveBackups('tok')).rejects.toThrow('HTTP 403: Admin role required');
  });

  it('throws with the status even when the error body is an HTML page', async () => {
    mockFetchOnce({ ok: false, status: 500, body: '<html>500 Internal Server Error</html>' });
    await expect(restorePharmacyBackup('tok', 'f')).rejects.toThrow(/^HTTP 500:/);
  });

  it('surfaces a 401 distinctly from a 500', async () => {
    mockFetchOnce({ ok: false, status: 401, body: { error: 'Invalid or expired session' } });
    const err = await restorePharmacyBackup('tok', 'f').catch((e) => e);
    expect(err.status).toBe(401);
  });

  it('maps a network failure to a readable message', async () => {
    global.fetch = jest.fn().mockRejectedValue(Object.assign(new Error('Network down'), { name: 'TypeError' }));
    await expect(listDriveBackups('tok')).rejects.toThrow('Network down');
  });
});
