/* ===========================================================================
   qr.js  (classic script)
   A small, dependency-free QR Code encoder — just enough for "scan to
   install on your phone": byte mode, error correction level M, versions
   1–10 (up to 213 bytes, which covers any download or store URL).

     QR.matrix(text) → { size, dark: boolean[][] } | null
     QR.svg(text, { label }) → '<svg …>' | ''   (currentColor on transparent)

   Follows ISO/IEC 18004: Reed–Solomon over GF(256) with 0x11D, the eight
   data masks scored with the standard penalty rules, BCH-coded format and
   version information. No canvas, no images — the SVG scales crisply and
   inherits the theme's ink.
   =========================================================================== */

(() => {
    /* ---- GF(256) arithmetic ------------------------------------------- */
    const EXP = new Array(512);
    const LOG = new Array(256);
    {
        let x = 1;
        for (let i = 0; i < 255; i++) {
            EXP[i] = x;
            LOG[x] = i;
            x <<= 1;
            if (x & 0x100) x ^= 0x11d;
        }
        for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
    }
    const mul = (a, b) => (a && b ? EXP[LOG[a] + LOG[b]] : 0);

    /* Generator polynomial coefficients after the leading 1, highest first. */
    function generator(n) {
        let g = [1];
        for (let i = 0; i < n; i++) {
            const next = new Array(g.length + 1).fill(0);
            for (let j = 0; j < g.length; j++) {
                next[j] ^= g[j];
                next[j + 1] ^= mul(g[j], EXP[i]);
            }
            g = next;
        }
        return g.slice(1);
    }

    function remainder(data, n) {
        const gen = generator(n);
        const out = new Array(n).fill(0);
        data.forEach((byte) => {
            const factor = byte ^ out.shift();
            out.push(0);
            for (let i = 0; i < n; i++) out[i] ^= mul(gen[i], factor);
        });
        return out;
    }

    /* ---- Version tables (level M only) ------------------------------- */
    // [ec codewords per block, [[block count, data codewords per block], …]]
    const BLOCKS = {
        1: [10, [[1, 16]]],  2: [16, [[1, 28]]],  3: [26, [[1, 44]]],
        4: [18, [[2, 32]]],  5: [24, [[2, 43]]],  6: [16, [[4, 27]]],
        7: [18, [[4, 31]]],  8: [22, [[2, 38], [2, 39]]],
        9: [22, [[3, 36], [2, 37]]], 10: [26, [[4, 43], [1, 44]]]
    };
    const ALIGN = {
        1: [], 2: [6, 18], 3: [6, 22], 4: [6, 26], 5: [6, 30],
        6: [6, 34], 7: [6, 22, 38], 8: [6, 24, 42], 9: [6, 26, 46], 10: [6, 28, 50]
    };
    const dataCodewords = (v) => BLOCKS[v][1].reduce((n, [count, size]) => n + count * size, 0);

    /* ---- Encoding ----------------------------------------------------- */

    function codewords(bytes, version) {
        const total = dataCodewords(version);
        const bits = [];
        const push = (value, len) => { for (let i = len - 1; i >= 0; i--) bits.push((value >>> i) & 1); };

        push(0b0100, 4);                                  // byte mode
        push(bytes.length, version < 10 ? 8 : 16);       // character count
        bytes.forEach((b) => push(b, 8));
        push(0, Math.min(4, total * 8 - bits.length));    // terminator
        while (bits.length % 8) bits.push(0);

        const data = [];
        for (let i = 0; i < bits.length; i += 8) {
            data.push(bits.slice(i, i + 8).reduce((n, b) => (n << 1) | b, 0));
        }
        for (let pad = 0xec; data.length < total; pad ^= 0xec ^ 0x11) data.push(pad);

        // Split into blocks, append each block's error correction, interleave.
        const [ecLen, groups] = BLOCKS[version];
        const blocks = [];
        let at = 0;
        groups.forEach(([count, size]) => {
            for (let i = 0; i < count; i++) {
                const chunk = data.slice(at, at + size);
                at += size;
                blocks.push({ data: chunk, ec: remainder(chunk, ecLen) });
            }
        });

        const out = [];
        const maxData = Math.max(...blocks.map((b) => b.data.length));
        for (let i = 0; i < maxData; i++) blocks.forEach((b) => { if (i < b.data.length) out.push(b.data[i]); });
        for (let i = 0; i < ecLen; i++) blocks.forEach((b) => out.push(b.ec[i]));
        return out;
    }

    /* ---- Matrix construction ----------------------------------------- */

    function build(version, words, maskChoice) {
        const size = version * 4 + 17;
        const dark = Array.from({ length: size }, () => new Array(size).fill(false));
        const fixed = Array.from({ length: size }, () => new Array(size).fill(false));
        const set = (x, y, on) => { dark[y][x] = on; fixed[y][x] = true; };

        // Timing patterns, then finders over them, then alignment patterns.
        for (let i = 0; i < size; i++) { set(6, i, i % 2 === 0); set(i, 6, i % 2 === 0); }

        const finder = (cx, cy) => {
            for (let dy = -4; dy <= 4; dy++) {
                for (let dx = -4; dx <= 4; dx++) {
                    const x = cx + dx, y = cy + dy;
                    if (x < 0 || y < 0 || x >= size || y >= size) continue;
                    const d = Math.max(Math.abs(dx), Math.abs(dy));
                    set(x, y, d !== 2 && d !== 4);
                }
            }
        };
        finder(3, 3); finder(size - 4, 3); finder(3, size - 4);

        const pos = ALIGN[version];
        const last = pos.length - 1;
        pos.forEach((ay, i) => pos.forEach((ax, j) => {
            if ((i === 0 && j === 0) || (i === 0 && j === last) || (i === last && j === 0)) return;
            for (let dy = -2; dy <= 2; dy++) {
                for (let dx = -2; dx <= 2; dx++) set(ax + dx, ay + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
            }
        }));

        const drawFormat = (mask) => {
            const data = (0b00 << 3) | mask;              // level M = 00
            let rem = data;
            for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
            const bits = ((data << 10) | rem) ^ 0x5412;
            const bit = (i) => ((bits >>> i) & 1) === 1;

            for (let i = 0; i <= 5; i++) set(8, i, bit(i));
            set(8, 7, bit(6)); set(8, 8, bit(7)); set(7, 8, bit(8));
            for (let i = 9; i < 15; i++) set(14 - i, 8, bit(i));
            for (let i = 0; i < 8; i++) set(size - 1 - i, 8, bit(i));
            for (let i = 8; i < 15; i++) set(8, size - 15 + i, bit(i));
            set(8, size - 8, true);                      // the always-dark module
        };
        drawFormat(0);                                    // reserve the area

        if (version >= 7) {
            let rem = version;
            for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
            const bits = (version << 12) | rem;
            for (let i = 0; i < 18; i++) {
                const on = ((bits >>> i) & 1) === 1;
                const a = size - 11 + (i % 3), b = Math.floor(i / 3);
                set(a, b, on); set(b, a, on);
            }
        }

        // Codewords zig-zag up and down two-module columns, right to left.
        const total = words.length * 8;
        let k = 0;
        for (let right = size - 1; right >= 1; right -= 2) {
            if (right === 6) right = 5;
            for (let vert = 0; vert < size; vert++) {
                for (let j = 0; j < 2; j++) {
                    const x = right - j;
                    const upward = ((right + 1) & 2) === 0;
                    const y = upward ? size - 1 - vert : vert;
                    if (fixed[y][x]) continue;
                    if (k < total) dark[y][x] = ((words[k >>> 3] >>> (7 - (k & 7))) & 1) === 1;
                    k++;
                }
            }
        }

        const MASKS = [
            (x, y) => (x + y) % 2 === 0,
            (x, y) => y % 2 === 0,
            (x) => x % 3 === 0,
            (x, y) => (x + y) % 3 === 0,
            (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0,
            (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
            (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
            (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0
        ];
        const applyMask = (m) => {
            for (let y = 0; y < size; y++) {
                for (let x = 0; x < size; x++) if (!fixed[y][x] && MASKS[m](x, y)) dark[y][x] = !dark[y][x];
            }
        };

        let mask = maskChoice;
        if (mask === undefined) {
            let best = Infinity;
            for (let m = 0; m < 8; m++) {
                applyMask(m);
                drawFormat(m);
                const score = penalty(dark, size);
                if (score < best) { best = score; mask = m; }
                applyMask(m);                             // XOR again to undo
            }
        }
        applyMask(mask);
        drawFormat(mask);
        return { size, dark, mask };
    }

    /* Standard penalty rules: long runs, 2×2 blocks, finder look-alikes,
       and an unbalanced dark/light ratio. */
    function penalty(dark, size) {
        let score = 0;
        const line = (get) => {
            let runColor = null, run = 0;
            for (let i = 0; i < size; i++) {
                const c = get(i);
                if (c === runColor) { run++; if (run === 5) score += 3; else if (run > 5) score++; }
                else { runColor = c; run = 1; }
            }
            // 1:1:3:1:1 with four light modules on one side.
            for (let i = 0; i + 10 < size; i++) {
                const seq = [];
                for (let j = 0; j < 11; j++) seq.push(get(i + j) ? 1 : 0);
                const s = seq.join('');
                if (s === '10111010000' || s === '00001011101') score += 40;
            }
        };
        for (let y = 0; y < size; y++) line((x) => dark[y][x]);
        for (let x = 0; x < size; x++) line((y) => dark[y][x]);

        let count = 0;
        for (let y = 0; y < size; y++) {
            for (let x = 0; x < size; x++) {
                if (dark[y][x]) count++;
                if (x < size - 1 && y < size - 1) {
                    const c = dark[y][x];
                    if (c === dark[y][x + 1] && c === dark[y + 1][x] && c === dark[y + 1][x + 1]) score += 3;
                }
            }
        }
        score += Math.floor(Math.abs((count * 100) / (size * size) - 50) / 5) * 10;
        return score;
    }

    /* ---- Public surface ---------------------------------------------- */

    function matrix(text, { mask } = {}) {
        const bytes = Array.from(new TextEncoder().encode(String(text || '')));
        let version = 0;
        for (let v = 1; v <= 10; v++) {
            const capacityBits = dataCodewords(v) * 8 - 4 - (v < 10 ? 8 : 16);
            if (bytes.length * 8 <= capacityBits) { version = v; break; }
        }
        if (!version) return null;
        return build(version, codewords(bytes, version), mask);
    }

    function svg(text, { label = 'QR code' } = {}) {
        const m = matrix(text);
        if (!m) return '';
        const q = 4;                                      // quiet zone, in modules
        let d = '';
        for (let y = 0; y < m.size; y++) {
            for (let x = 0; x < m.size; x++) if (m.dark[y][x]) d += `M${x + q} ${y + q}h1v1h-1z`;
        }
        const span = m.size + q * 2;
        const safeLabel = String(label).replace(/[&<>"']/g, '');
        return `<svg class="qr" viewBox="0 0 ${span} ${span}" role="img" aria-label="${safeLabel}" `
             + `shape-rendering="crispEdges"><path d="${d}" fill="currentColor"/></svg>`;
    }

    window.QR = { matrix, svg };
})();
