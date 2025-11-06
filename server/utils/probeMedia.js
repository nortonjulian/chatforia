import { execa } from 'execa';
import ffprobe from 'ffprobe-static';

export async function probeDurationSec(localPath) {
  try {
    const { stdout } = await execa(ffprobe.path, [
      '-v', 'error',
      '-show_entries', 'format=duration',
      '-of', 'default=nw=1:nk=1',
      localPath,
    ]);
    const sec = Math.round(parseFloat(stdout || '0'));
    return Number.isFinite(sec) ? sec : null;
  } catch {
    return null;
  }
}
