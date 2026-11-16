import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import { extname } from 'node:path';
import { Readable } from 'node:stream';
import { safePath } from './files.ts';

const mime: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.m4a': 'audio/mp4',
  '.ogg': 'audio/ogg',
  '.aac': 'audio/aac',
  '.flac': 'audio/flac',
  '.mp4': 'video/mp4',
  '.m4v': 'video/mp4',
  '.mov': 'video/quicktime',
  '.webm': 'video/webm',
};
/** Local media stays streamed in main; the renderer receives no file:// access. */
export async function mediaResponse(root: string, relative: string, request: Request) {
  if (!/^agents\/[a-zA-Z0-9_-]+\/output\/.+/.test(relative))
    return new Response(null, { status: 403 });
  return streamMedia(root, relative, request);
}
/** Callers validate their own output scope before using the common byte-range transport. */
export async function streamMedia(root: string, relative: string, request: Request) {
  if (!['GET', 'HEAD'].includes(request.method)) return new Response(null, { status: 405 });
  const type = mime[extname(relative).toLowerCase()];
  if (!type) return new Response(null, { status: 415 });
  const path = await safePath(root, relative);
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await file.stat();
    if (!stat.isFile()) {
      await file.close();
      return new Response(null, { status: 404 });
    }
    const headers = new Headers({
      'Content-Type': type,
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'no-store',
      'Access-Control-Allow-Origin': '*',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; sandbox",
    });
    let start = 0,
      end = stat.size - 1,
      status = 200;
    const range = request.headers.get('range');
    if (range) {
      const match = /^bytes=(\d*)-(\d*)$/.exec(range);
      if (!match || (!match[1] && !match[2])) {
        await file.close();
        return new Response(null, {
          status: 416,
          headers: { 'Content-Range': `bytes */${stat.size}` },
        });
      }
      if (match[1]) {
        start = Number(match[1]);
        if (match[2]) end = Math.min(Number(match[2]), end);
      } else {
        start = Math.max(0, stat.size - Number(match[2]));
      }
      if (
        !Number.isSafeInteger(start) ||
        !Number.isSafeInteger(end) ||
        start > end ||
        start >= stat.size
      ) {
        await file.close();
        return new Response(null, {
          status: 416,
          headers: { 'Content-Range': `bytes */${stat.size}` },
        });
      }
      status = 206;
      headers.set('Content-Range', `bytes ${start}-${end}/${stat.size}`);
    }
    headers.set('Content-Length', String(Math.max(0, end - start + 1)));
    if (request.method === 'HEAD' || !stat.size) {
      await file.close();
      return new Response(null, { status, headers });
    }
    const stream = file.createReadStream({ start, end, autoClose: true });
    return new Response(Readable.toWeb(stream) as ReadableStream<Uint8Array>, { status, headers });
  } catch (error) {
    await file.close();
    throw error;
  }
}
