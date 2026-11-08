import { execa } from 'execa';
import ffprobe from 'ffprobe-static';

export async function probeDurationSec(localPath, { roundUp = false } = {}) {
  try {
    const { stdout } = await execa(ffprobe.path, [
      '-v', 'error',
      '-show_entries', 'format=duration',
      '-of', 'default=nw=1:nk=1',
      localPath,
    ]);
    const raw = parseFloat(stdout || '0');
    const sec = roundUp ? Math.ceil(raw) : Math.round(raw);
    return Number.isFinite(sec) ? sec : null;
  } catch {
    return null;
  }
}
