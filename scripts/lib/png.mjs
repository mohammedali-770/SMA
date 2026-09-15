/**
 * Minimal 8-bit RGBA PNG codec — decode, encode, and the CRC/chunk helpers.
 *
 * EXTRACTED from `scripts/build-logo-mark.mjs` on 2026-09-15 by line span
 * rather than retyped, then Prettier-formatted as a new file — so it is the
 * same code, not the same bytes. What proves the extraction was lossless is
 * `npm run logo:check`: it regenerates all three brand-mark assets through this
 * codec and compares them byte-for-byte against the committed files, and it
 * passed unchanged before and after both the move and the reformat. Behaviour
 * is asserted; the byte-for-byte claim would have been about the wrong thing.
 *
 * Deliberately narrow. It handles exactly the shape every image asset in this
 * repository already is — 8-bit, colour type 6 (RGBA), non-interlaced — and
 * throws on anything else rather than guessing. Pure Node, no dependency.
 */
import { deflateSync, inflateSync } from 'node:zlib';

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function decodePng(buffer) {
  if (!buffer.subarray(0, 8).equals(PNG_SIGNATURE)) throw new Error('not a PNG');

  let width = 0;
  let height = 0;
  const idat = [];

  for (let offset = 8; offset < buffer.length;) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString('ascii', offset + 4, offset + 8);
    const data = buffer.subarray(offset + 8, offset + 8 + length);

    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      const [depth, colorType, , , interlace] = [data[8], data[9], data[10], data[11], data[12]];
      if (depth !== 8 || colorType !== 6 || interlace !== 0) {
        throw new Error(`unsupported PNG: depth ${depth}, colour type ${colorType}, interlace ${interlace}`);
      }
    } else if (type === 'IDAT') {
      idat.push(data);
    } else if (type === 'IEND') {
      break;
    }

    offset += 12 + length;
  }

  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * 4;
  const pixels = Buffer.alloc(stride * height);

  // Undo the per-scanline filter. Each row is prefixed with its filter byte and
  // predicts from the pixel to the left (a), above (b) and above-left (c).
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const src = y * (stride + 1) + 1;
    const dst = y * stride;

    for (let i = 0; i < stride; i++) {
      const x = raw[src + i];
      const a = i >= 4 ? pixels[dst + i - 4] : 0;
      const b = y > 0 ? pixels[dst - stride + i] : 0;
      const c = y > 0 && i >= 4 ? pixels[dst - stride + i - 4] : 0;

      let value;
      switch (filter) {
        case 0:
          value = x;
          break;
        case 1:
          value = x + a;
          break;
        case 2:
          value = x + b;
          break;
        case 3:
          value = x + ((a + b) >> 1);
          break;
        case 4: {
          const p = a + b - c;
          const pa = Math.abs(p - a);
          const pb = Math.abs(p - b);
          const pc = Math.abs(p - c);
          value = x + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
          break;
        }
        default:
          throw new Error(`unknown PNG filter ${filter}`);
      }
      pixels[dst + i] = value & 0xff;
    }
  }

  return { width, height, pixels };
}

function chunk(type, data) {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, 'ascii');

  const crcInput = Buffer.concat([head.subarray(4), data]);
  const tail = Buffer.alloc(4);
  tail.writeUInt32BE(crc32(crcInput) >>> 0, 0);

  return Buffer.concat([head, data, tail]);
}

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buffer) {
  let c = -1;
  for (let i = 0; i < buffer.length; i++) c = CRC_TABLE[(c ^ buffer[i]) & 0xff] ^ (c >>> 8);
  return c ^ -1;
}

function encodePng({ width, height, pixels }) {
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);

  // Filter 0 (none) keeps the encoder trivial; deflate still compresses the
  // large flat transparent regions down well.
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    pixels.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0; // deflate
  ihdr[11] = 0; // adaptive filtering
  ihdr[12] = 0; // no interlace

  return Buffer.concat([
    PNG_SIGNATURE,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

export { PNG_SIGNATURE, decodePng, encodePng, chunk, crc32 };
