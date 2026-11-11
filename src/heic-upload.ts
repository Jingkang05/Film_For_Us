const maxBytes = 20 * 1024 * 1024;
const brands = new Set(['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'hevm', 'hevs', 'mif1', 'msf1']);
export function isHeifContent(bytes: Uint8Array): boolean {
  if (bytes.length < 16) return false;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const size = view.getUint32(0);
  const tag = (offset: number) => String.fromCharCode(...bytes.subarray(offset, offset + 4));
  if (tag(4) !== 'ftyp' || size < 16 || size > bytes.length || size > 4096 || size % 4) return false;
  if (brands.has(tag(8))) return true;
  for (let i = 16; i < size; i += 4) if (brands.has(tag(i))) return true;
  return false;
}
type Decoder = (file: File) => Promise<Blob>;
async function decode(file: File): Promise<Blob> {
  const { heicTo } = await import('./heic-decoder.js');
  return heicTo({ blob: file, type: 'image/jpeg', quality: 0.92 });
}
// Also serialize callers outside the editor queue: never decode several large photos at once.
let queue: Promise<unknown> = Promise.resolve();
export async function prepareUpload(file: File, processing: () => void = () => {}, decoder: Decoder = decode): Promise<File> {
  if (file.size > maxBytes) throw new Error('The file exceeds the size limit.');
  const header = new Uint8Array(await file.slice(0, 4096).arrayBuffer());
  if (!isHeifContent(header)) {
    // Actual JPEG/PNG/WebP takes precedence over a misleading name/MIME.
    const jpeg = header[0] === 255 && header[1] === 216 && header[2] === 255;
    const png = [137,80,78,71,13,10,26,10].every((value, i) => header[i] === value);
    const webp = String.fromCharCode(...header.slice(0,4)) === 'RIFF' && String.fromCharCode(...header.slice(8,12)) === 'WEBP';
    if (jpeg || png || webp) return file;
    throw new Error('This file is not a supported image. Choose JPEG, PNG, WebP, HEIC or HEIF.');
  }
  processing();
  const work = queue.then(async () => {
    try {
      const jpeg = await decoder(file);
      const signature = new Uint8Array(await jpeg.slice(0, 3).arrayBuffer());
      if (jpeg.type !== 'image/jpeg' || signature[0] !== 255 || signature[1] !== 216 || signature[2] !== 255) throw new Error();
      if (jpeg.size > maxBytes) throw new Error('The converted photo exceeds 20 MB. Export a smaller JPEG and try again.');
      return new File([jpeg], `${file.name.replace(/\.[^.]*$/, '') || 'photo'}.jpg`, { type: 'image/jpeg', lastModified: file.lastModified });
    } catch (error) {
      if (error instanceof Error && error.message.startsWith('The converted photo')) throw error;
      throw new Error('This HEIC/HEIF photo could not be converted. Export it as JPEG and try again.');
    }
  });
  queue = work.catch(() => {});
  return work;
}
