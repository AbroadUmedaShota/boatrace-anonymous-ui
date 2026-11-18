import {open, unlink} from 'node:fs/promises';
import path from 'node:path';
import {randomBytes} from 'node:crypto';
import {privateState} from './runtime';
export const LOCK_NAME = '.phase2-operation.lock';
type LockOwner = {schema_version: string; pid: number; state_dir: string; operation: string; generation: string; control_origin?: string};
export async function acquireOperationLock(state: string, operation: string) {
  state = await privateState(state);
  const filename = path.join(state, LOCK_NAME);
  let handle: Awaited<ReturnType<typeof open>>;
  try { handle = await open(filename, 'wx', 0o600); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new Error('STATE_BUSY_OR_STALE_LOCK: stop the app; after a crash confirm every process has exited before manually removing ' + filename);
    throw error;
  }
  const owner: LockOwner = {schema_version: 'boatrace-phase2-lock/1', pid: process.pid, state_dir: state,
    operation, generation: randomBytes(16).toString('hex')};
  async function save() {
    const raw = Buffer.from(JSON.stringify(owner) + '\n');
    let offset = 0;
    while (offset < raw.length) {
      const {bytesWritten} = await handle.write(raw, offset, raw.length - offset, offset);
      if (!bytesWritten) throw new Error('LOCK_WRITE_FAILED'); offset += bytesWritten;
    }
    await handle.truncate(raw.length); await handle.sync();
  }
  await save();
  let released = false;
  const release = async () => { if (!released) { released = true; await handle.close(); await unlink(filename); } };
  return Object.assign(release, {owner, publishControl: async (origin: string) => { owner.control_origin = origin; await save(); }});
}
export async function withOperationLock<T>(state: string, operation: string, action: () => Promise<T>) {
  const release = await acquireOperationLock(state, operation);
  try { return await action(); } finally { await release(); }
}
