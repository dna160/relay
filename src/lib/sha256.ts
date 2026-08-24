/**
 * An incremental SHA-256, because the platform's one cannot do this job.
 *
 * `crypto.subtle.digest` takes a whole buffer. Relay accepts files to 5 GB
 * (ARCHITECTURE), and reading 5 GB into an `ArrayBuffer` to hash it is how a
 * browser tab dies on the deadline it was opened to meet. `SubtleCrypto` has no
 * streaming interface and there is no incremental digest in the platform, so
 * the choice is: hash in chunks with an implementation like this one, or do not
 * hash large files at all.
 *
 * Not hashing them is not available. INV-3 says an approval stores the version's
 * sha256 at decision time, and ADR-009/INV-10 say the bytes never reach the app
 * server — so the server *cannot* compute the hash and the uploader is the only
 * party that can. That trade is made deliberately and this file is the other
 * side of it.
 *
 * FIPS 180-4. Written out rather than pulled in: round 1 added zero
 * dependencies across four agents and a 90-line well-specified algorithm is not
 * where that line should break. Verified against `crypto.subtle.digest` and
 * against the published test vectors, including the multi-block and
 * length-extension edge cases (empty input, 55/56/64/119/120 bytes — the
 * lengths either side of each padding boundary).
 *
 * `hashBlob` below is what callers actually want: it slices, yields to the
 * event loop between chunks so a 5 GB hash does not freeze the tab, and reports
 * progress. For small inputs it hands off to `crypto.subtle` instead, which is
 * native and an order of magnitude faster.
 */

const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

function rotr(x: number, n: number): number {
  return (x >>> n) | (x << (32 - n));
}

/**
 * One SHA-256 state. `update` may be called any number of times with chunks of
 * any size; `digest` may be called once.
 */
export class Sha256 {
  private readonly h = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ]);
  private readonly block = new Uint8Array(64);
  private readonly w = new Uint32Array(64);
  private blockLength = 0;
  /** Total bytes consumed. Stays exact to 2^53, which is 9 PB. */
  private totalBytes = 0;
  private finished = false;

  update(chunk: Uint8Array): this {
    if (this.finished) throw new Error('Sha256: update after digest');
    this.totalBytes += chunk.length;

    let offset = 0;

    // Top up a partial block first, so the fast path below is always aligned.
    if (this.blockLength > 0) {
      const need = 64 - this.blockLength;
      const take = Math.min(need, chunk.length);
      this.block.set(chunk.subarray(0, take), this.blockLength);
      this.blockLength += take;
      offset = take;
      if (this.blockLength < 64) return this;
      this.compress(this.block, 0);
      this.blockLength = 0;
    }

    while (offset + 64 <= chunk.length) {
      this.compress(chunk, offset);
      offset += 64;
    }

    if (offset < chunk.length) {
      this.block.set(chunk.subarray(offset), 0);
      this.blockLength = chunk.length - offset;
    }
    return this;
  }

  digest(): Uint8Array {
    if (this.finished) throw new Error('Sha256: digest called twice');
    this.finished = true;

    const bits = this.totalBytes * 8;
    // 0x80, then zeroes, then the 64-bit big-endian length. Two blocks when the
    // length no longer fits after the terminator — the 55/56-byte boundary.
    const padLength = this.blockLength < 56 ? 56 - this.blockLength : 120 - this.blockLength;
    const tail = new Uint8Array(padLength + 8);
    tail[0] = 0x80;
    const view = new DataView(tail.buffer);
    view.setUint32(padLength, Math.floor(bits / 0x100000000), false);
    view.setUint32(padLength + 4, bits >>> 0, false);

    // `update` would refuse now that `finished` is set, so drive it directly.
    this.finished = false;
    this.update(tail);
    this.finished = true;

    const out = new Uint8Array(32);
    const outView = new DataView(out.buffer);
    for (let i = 0; i < 8; i += 1) outView.setUint32(i * 4, this.h[i] ?? 0, false);
    return out;
  }

  private compress(bytes: Uint8Array, offset: number): void {
    const w = this.w;
    for (let i = 0; i < 16; i += 1) {
      const j = offset + i * 4;
      w[i] =
        ((bytes[j] ?? 0) << 24) |
        ((bytes[j + 1] ?? 0) << 16) |
        ((bytes[j + 2] ?? 0) << 8) |
        (bytes[j + 3] ?? 0);
    }
    for (let i = 16; i < 64; i += 1) {
      const w15 = w[i - 15] ?? 0;
      const w2 = w[i - 2] ?? 0;
      const s0 = rotr(w15, 7) ^ rotr(w15, 18) ^ (w15 >>> 3);
      const s1 = rotr(w2, 17) ^ rotr(w2, 19) ^ (w2 >>> 10);
      w[i] = ((w[i - 16] ?? 0) + s0 + (w[i - 7] ?? 0) + s1) | 0;
    }

    let a = this.h[0] ?? 0;
    let b = this.h[1] ?? 0;
    let c = this.h[2] ?? 0;
    let d = this.h[3] ?? 0;
    let e = this.h[4] ?? 0;
    let f = this.h[5] ?? 0;
    let g = this.h[6] ?? 0;
    let hh = this.h[7] ?? 0;

    for (let i = 0; i < 64; i += 1) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (hh + S1 + ch + (K[i] ?? 0) + (w[i] ?? 0)) | 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) | 0;

      hh = g;
      g = f;
      f = e;
      e = (d + t1) | 0;
      d = c;
      c = b;
      b = a;
      a = (t1 + t2) | 0;
    }

    this.h[0] = ((this.h[0] ?? 0) + a) | 0;
    this.h[1] = ((this.h[1] ?? 0) + b) | 0;
    this.h[2] = ((this.h[2] ?? 0) + c) | 0;
    this.h[3] = ((this.h[3] ?? 0) + d) | 0;
    this.h[4] = ((this.h[4] ?? 0) + e) | 0;
    this.h[5] = ((this.h[5] ?? 0) + f) | 0;
    this.h[6] = ((this.h[6] ?? 0) + g) | 0;
    this.h[7] = ((this.h[7] ?? 0) + hh) | 0;
  }
}

export function toHex(bytes: Uint8Array): string {
  let out = '';
  for (const b of bytes) out += b.toString(16).padStart(2, '0');
  return out;
}

/** Above this, chunk it. Below, `crypto.subtle` is native and much faster. */
const SUBTLE_MAX_BYTES = 32 * 1024 * 1024;

/** Big enough that the per-chunk overhead disappears, small enough that a
 *  progress bar moves and the main thread gets a turn. */
const HASH_CHUNK_BYTES = 8 * 1024 * 1024;

/**
 * sha256 of a `Blob`, as lowercase hex — the form `POST /api/versions` accepts
 * (`/^[0-9a-f]{64}$/`).
 *
 * `onProgress` is called with bytes read so far. `signal` aborts between
 * chunks, which is the only place it can: a chunk is 8 MB and the algorithm
 * does not have a resumable middle.
 */
export async function hashBlob(
  blob: Blob,
  options: { onProgress?: (bytesRead: number) => void; signal?: AbortSignal } = {},
): Promise<string> {
  const { onProgress, signal } = options;

  if (blob.size <= SUBTLE_MAX_BYTES && typeof crypto !== 'undefined' && crypto.subtle) {
    const buffer = await blob.arrayBuffer();
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    const digest = await crypto.subtle.digest('SHA-256', buffer);
    onProgress?.(blob.size);
    return toHex(new Uint8Array(digest));
  }

  const hash = new Sha256();
  let read = 0;
  while (read < blob.size) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    const end = Math.min(read + HASH_CHUNK_BYTES, blob.size);
    const chunk = new Uint8Array(await blob.slice(read, end).arrayBuffer());
    hash.update(chunk);
    read = end;
    onProgress?.(read);
    // Hand the main thread back between chunks. Without this the tab is frozen
    // for the whole hash and the progress the caller is reporting never paints.
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  return toHex(hash.digest());
}
