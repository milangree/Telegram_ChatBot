// functions/_shared/captcha.js
// Pure-JS PNG captcha generator — no Canvas, works in Cloudflare Workers.

// ── 5×7 pixel font ──────────────────────────────────────────────────────────
// Each entry = 7 rows; each row = 5 bits, bit-4 is leftmost pixel.
const FONT = {
  '0':[14,17,19,21,25,17,14], '1':[4,12,4,4,4,4,14],
  '2':[14,17,1,6,8,16,31],   '3':[30,1,1,14,1,1,30],
  '4':[3,5,9,17,31,1,1],     '5':[31,16,16,30,1,17,14],
  '6':[7,8,16,30,17,17,14],  '7':[31,1,2,4,8,8,8],
  '8':[14,17,17,14,17,17,14],'9':[14,17,17,15,1,2,12],
  'A':[14,17,17,31,17,17,17],'B':[30,17,17,30,17,17,30],
  'C':[14,17,16,16,16,17,14],'D':[30,17,17,17,17,17,30],
  'E':[31,16,16,30,16,16,31],'F':[31,16,16,30,16,16,16],
  'G':[14,17,16,23,17,17,15],'H':[17,17,17,31,17,17,17],
  'J':[7,1,1,1,17,17,14],   'K':[17,18,20,24,20,18,17],
  'L':[16,16,16,16,16,16,31],'M':[17,27,21,21,17,17,17],
  'N':[17,25,21,19,17,17,17],'P':[30,17,17,30,16,16,16],
  'Q':[14,17,17,17,21,19,15],'R':[30,17,17,30,20,18,17],
  'S':[14,17,16,14,1,17,14], 'T':[31,4,4,4,4,4,4],
  'U':[17,17,17,17,17,17,14],'V':[17,17,17,17,10,10,4],
  'W':[17,17,17,21,21,27,17],'X':[17,17,10,4,10,17,17],
  'Y':[17,17,10,4,4,4,4],   'Z':[31,1,2,4,8,16,31],
};

// Safe char pools (no O/I/0/1 confusion)
const NUMERIC_CHARS = '23456789';
const ALPHA_CHARS   = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';

// ── Code generation ──────────────────────────────────────────────────────────

export function generateCode(type) {
  const pool = type === 'image_alphanumeric' ? ALPHA_CHARS : NUMERIC_CHARS;
  const len  = type === 'image_alphanumeric' ? 5 : 4;
  const buf  = new Uint8Array(len);
  crypto.getRandomValues(buf);
  return Array.from(buf, b => pool[b % pool.length]).join('');
}

export function generateWrongOptions(correct, type) {
  const pool = type === 'image_alphanumeric' ? ALPHA_CHARS : NUMERIC_CHARS;
  const len  = correct.length;
  const wrongs = new Set();

  const seed = new Uint8Array(8);
  crypto.getRandomValues(seed);
  const rng = lcg(`${correct}:${type}:${Array.from(seed).join(',')}`);
  const rint = max => Math.floor(rng() * max);

  const similarity = (a, b) => {
    let same = 0;
    for (let i = 0; i < a.length; i++) if (a[i] === b[i]) same++;
    return same;
  };

  const mutateOne = (src) => {
    const arr = src.split('');
    const i = rint(len);
    const idx = pool.indexOf(arr[i]);
    if (idx >= 0) {
      const delta = rint(2) === 0 ? -1 : 1;
      arr[i] = pool[(idx + delta + pool.length) % pool.length];
    } else {
      arr[i] = pool[rint(pool.length)];
    }
    return arr.join('');
  };

  const mutateTwo = (src) => mutateOne(mutateOne(src));

  const swapAdj = (src) => {
    if (src.length < 2) return mutateOne(src);
    const i = rint(src.length - 1);
    const arr = src.split('');
    [arr[i], arr[i + 1]] = [arr[i + 1], arr[i]];
    return arr.join('');
  };

  const minSim = Math.max(2, len - 2);
  let tries = 0;
  while (wrongs.size < 3 && tries < 120) {
    tries++;
    let candidate;
    if (tries % 3 === 0) candidate = mutateTwo(correct);
    else if (tries % 5 === 0) candidate = swapAdj(correct);
    else candidate = mutateOne(correct);

    if (candidate === correct) continue;
    if (similarity(candidate, correct) < minSim) continue;
    wrongs.add(candidate);
  }

  while (wrongs.size < 3) {
    const buf = new Uint8Array(len);
    crypto.getRandomValues(buf);
    const w = Array.from(buf, b => pool[b % pool.length]).join('');
    if (w !== correct) wrongs.add(w);
  }

  return [...wrongs];
}

// ── PNG rendering ────────────────────────────────────────────────────────────

const SCALE   = 4;   // font-pixels → screen-pixels
const PADDING = 14;  // border padding
const SPACING = 4;   // gap between chars
const CW = 5, CH = 7;

export async function renderCaptchaPNG(text, seed = text) {
  const W = PADDING * 2 + text.length * (CW + SPACING) * SCALE - SPACING * SCALE;
  const H = PADDING * 2 + CH * SCALE + 10; // extra room for jitter/distortion

  const rgb = new Uint8Array(W * H * 3);
  const rng = lcg(seed);

  // Background: gradient + subtle texture
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 3;
      const tone = Math.floor(2 + 3 * Math.sin((x + y) * 0.08));
      rgb[i]   = 236 + Math.round((x / W) * 12) + tone;
      rgb[i+1] = 241 + Math.round((y / H) * 10) + tone;
      rgb[i+2] = 253 + tone;
    }
  }

  // Pre-text interference curves
  for (let n = 0; n < 5; n++) {
    const x1 = Math.floor(rng() * W), y1 = Math.floor(rng() * H);
    const x2 = Math.floor(rng() * W), y2 = Math.floor(rng() * H);
    const c = [150 + Math.floor(rng() * 40), 160 + Math.floor(rng() * 45), 185 + Math.floor(rng() * 45)];
    drawWavyLine(rgb, W, H, x1, y1, x2, y2, c, 1 + Math.floor(rng() * 3), 1 + Math.floor(rng() * 2), rng() * Math.PI * 2);
  }

  // Characters: jitter + skew + noisy strokes
  for (let ci = 0; ci < text.length; ci++) {
    const glyph = FONT[text[ci]];
    if (!glyph) continue;

    const baseX = PADDING + ci * (CW + SPACING) * SCALE;
    const xOff = Math.floor(rng() * 5) - 2;      // -2..2
    const yOff = Math.floor(rng() * 7) - 2;      // -2..4
    const skew = (rng() - 0.5) * 0.9;            // shear
    const color = [20 + Math.floor(rng() * 120), 25 + Math.floor(rng() * 95), 30 + Math.floor(rng() * 120)];

    for (let gy = 0; gy < CH; gy++) {
      const row = glyph[gy];
      const rowShift = Math.round((gy - CH / 2) * skew);
      for (let gx = 0; gx < CW; gx++) {
        if (!(row & (1 << (CW - 1 - gx)))) continue;
        if (rng() < 0.05) continue; // tiny dropout to hinder OCR templates

        for (let sy = 0; sy < SCALE; sy++) {
          for (let sx = 0; sx < SCALE; sx++) {
            const px = baseX + xOff + rowShift + gx * SCALE + sx;
            const py = PADDING + yOff + gy * SCALE + sy;
            if (px < 0 || px >= W || py < 0 || py >= H) continue;
            const idx = (py * W + px) * 3;
            const jitter = Math.floor(rng() * 26) - 13;
            rgb[idx]   = clamp8(color[0] + jitter);
            rgb[idx+1] = clamp8(color[1] + jitter);
            rgb[idx+2] = clamp8(color[2] + jitter);

            // occasional neighboring blur pixel
            if (rng() < 0.07 && px + 1 < W) {
              const nb = idx + 3;
              rgb[nb]   = clamp8(rgb[nb] + 18);
              rgb[nb+1] = clamp8(rgb[nb+1] + 18);
              rgb[nb+2] = clamp8(rgb[nb+2] + 18);
            }
          }
        }
      }
    }
  }

  // Post-text crossing lines
  for (let n = 0; n < 4; n++) {
    const x1 = Math.floor(rng() * W), y1 = Math.floor(rng() * H);
    const x2 = Math.floor(rng() * W), y2 = Math.floor(rng() * H);
    const c = [80 + Math.floor(rng() * 80), 70 + Math.floor(rng() * 90), 85 + Math.floor(rng() * 85)];
    drawLine(rgb, W, H, x1, y1, x2, y2, c);
  }

  // Global wave distortion
  const distorted = waveDistort(rgb, W, H, rng, 2, 1);

  // Dense salt-pepper noise
  const dots = Math.floor(W * H * 0.02);
  for (let n = 0; n < dots; n++) {
    const nx = Math.floor(rng() * W);
    const ny = Math.floor(rng() * H);
    const idx = (ny * W + nx) * 3;
    if (rng() < 0.55) {
      const d = 60 + Math.floor(rng() * 70);
      distorted[idx] = d; distorted[idx+1] = d; distorted[idx+2] = d;
    } else {
      const l = 200 + Math.floor(rng() * 45);
      distorted[idx] = l; distorted[idx+1] = l; distorted[idx+2] = l;
    }
  }

  return encodePNG(W, H, distorted);
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function lcg(seed) {
  // Linear-congruential PRNG seeded from string
  let s = 0xdeadbeef;
  for (let i = 0; i < seed.length; i++) s = (Math.imul(s, 31) + seed.charCodeAt(i)) | 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) | 0;
    return (s >>> 0) / 0x100000000;
  };
}

function drawLine(rgb, W, H, x1, y1, x2, y2, color) {
  const dx = Math.abs(x2 - x1), dy = Math.abs(y2 - y1);
  const sx = x1 < x2 ? 1 : -1, sy = y1 < y2 ? 1 : -1;
  let err = dx - dy, x = x1, y = y1;
  for (;;) {
    if (x >= 0 && x < W && y >= 0 && y < H) {
      const i = (y * W + x) * 3;
      rgb[i] = color[0]; rgb[i+1] = color[1]; rgb[i+2] = color[2];
    }
    if (x === x2 && y === y2) break;
    const e2 = 2 * err;
    if (e2 > -dy) { err -= dy; x += sx; }
    if (e2 <  dx) { err += dx; y += sy; }
  }
}

function drawWavyLine(rgb, W, H, x1, y1, x2, y2, color, amp = 2, thickness = 1, phase = 0) {
  const steps = Math.max(Math.abs(x2 - x1), Math.abs(y2 - y1)) * 2 + 1;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const bx = x1 + (x2 - x1) * t;
    const by = y1 + (y2 - y1) * t;
    const wobble = Math.sin(t * Math.PI * 6 + phase) * amp;
    const x = Math.round(bx + wobble);
    const y = Math.round(by + wobble * 0.5);
    for (let oy = -thickness; oy <= thickness; oy++) {
      for (let ox = -thickness; ox <= thickness; ox++) {
        const px = x + ox, py = y + oy;
        if (px < 0 || px >= W || py < 0 || py >= H) continue;
        const idx = (py * W + px) * 3;
        rgb[idx] = color[0]; rgb[idx+1] = color[1]; rgb[idx+2] = color[2];
      }
    }
  }
}

function waveDistort(rgb, W, H, rng, ampX = 2, ampY = 1) {
  const out = new Uint8Array(rgb.length);
  const p1 = rng() * Math.PI * 2;
  const p2 = rng() * Math.PI * 2;
  const fx = 6 + Math.floor(rng() * 4);
  const fy = 7 + Math.floor(rng() * 4);

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const sx = x + Math.round(Math.sin((y / fy) + p1) * ampX);
      const sy = y + Math.round(Math.sin((x / fx) + p2) * ampY);
      const dst = (y * W + x) * 3;
      if (sx >= 0 && sx < W && sy >= 0 && sy < H) {
        const src = (sy * W + sx) * 3;
        out[dst] = rgb[src];
        out[dst + 1] = rgb[src + 1];
        out[dst + 2] = rgb[src + 2];
      } else {
        out[dst] = rgb[dst];
        out[dst + 1] = rgb[dst + 1];
        out[dst + 2] = rgb[dst + 2];
      }
    }
  }

  return out;
}

function clamp8(v) {
  return v < 0 ? 0 : (v > 255 ? 255 : v | 0);
}

// ── PNG encoder ──────────────────────────────────────────────────────────────

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[i] = c;
  }
  return t;
})();

function crc32(data) {
  let c = 0xffffffff;
  for (const b of data) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function be32(n) {
  return [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];
}

function pngChunk(type, data) {
  const typeBytes = new TextEncoder().encode(type);
  const crcSrc   = new Uint8Array(4 + data.length);
  crcSrc.set(typeBytes); crcSrc.set(data, 4);
  const crc = crc32(crcSrc);
  const out = new Uint8Array(4 + 4 + data.length + 4);
  out.set(be32(data.length));
  out.set(typeBytes, 4);
  out.set(data, 8);
  out.set(be32(crc), 8 + data.length);
  return out;
}

async function compress(raw) {
  // CompressionStream('deflate') = zlib format (RFC 1950) — exactly what PNG needs
  const cs     = new CompressionStream('deflate');
  const writer = cs.writable.getWriter();
  const reader = cs.readable.getReader();

  // Write and read concurrently (streams require it)
  const writeP = writer.write(raw).then(() => writer.close());
  const chunks = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }
  await writeP;

  const total = chunks.reduce((n, c) => n + c.length, 0);
  const out   = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) { out.set(c, off); off += c.length; }
  return out;
}

async function encodePNG(W, H, rgb) {
  // Filter-0 (None) scanlines: 1 filter byte + W*3 rgb bytes per row
  const rowStride = 1 + W * 3;
  const scanlines = new Uint8Array(H * rowStride);
  for (let y = 0; y < H; y++) {
    scanlines[y * rowStride] = 0; // None filter
    for (let x = 0; x < W; x++) {
      const src = (y * W + x) * 3;
      const dst = y * rowStride + 1 + x * 3;
      scanlines[dst]   = rgb[src];
      scanlines[dst+1] = rgb[src+1];
      scanlines[dst+2] = rgb[src+2];
    }
  }

  const idat = await compress(scanlines);

  // IHDR: width(4) height(4) bitDepth(1) colorType(1=RGB=2) compress(1) filter(1) interlace(1)
  const ihdr = new Uint8Array(13);
  ihdr.set(be32(W)); ihdr.set(be32(H), 4);
  ihdr[8] = 8; ihdr[9] = 2; // 8-bit RGB

  const sig   = new Uint8Array([137,80,78,71,13,10,26,10]);
  const parts = [sig, pngChunk('IHDR', ihdr), pngChunk('IDAT', idat), pngChunk('IEND', new Uint8Array(0))];
  const total = parts.reduce((n, p) => n + p.length, 0);
  const png   = new Uint8Array(total);
  let off = 0;
  for (const p of parts) { png.set(p, off); off += p.length; }
  return png.buffer;
}
