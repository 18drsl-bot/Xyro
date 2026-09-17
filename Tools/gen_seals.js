// gen_seals.js - regenerate every repo-hosted verified seal PNG from the
// white source (media/verified_seal.png), dependency-free (node:zlib).
//
//   node Tools/gen_seals.js            -> build all seals listed in SEALS
//   node Tools/gen_seals.js --dry      -> just print target colors
//
// Colors MUST match NT_RANK_COLORS in xyro.lua:
//   founder silver d2d6de | hr white ffffff | support green 42d878
//   trial teal 46cdc8 | purple b066ff | partner dark blue 2452dc
// (make_blue_seal.js is the standalone origin of this tool; gen_seals is
// the one-stop regenerator for all variants.)

const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

const SRC = path.join(__dirname, "..", "media", "verified_seal.png");
const OUT_DIR = path.join(__dirname, "..", "media");

// keep in sync with xyro.lua NT_RANK_COLORS + index.html RANK_SEALS
const SEALS = {
	verified_seal_blue: [0x00, 0xa2, 0xff], // Roblox official verified blue
	seal_founder: [0xd2, 0xd6, 0xde], // silver
	seal_hr: [0xff, 0xff, 0xff], // white
	seal_support: [0x42, 0xd8, 0x78], // green
	seal_trial: [0x46, 0xcd, 0xc8], // teal
	seal_purple: [0xb0, 0x66, 0xff], // custom purple
	seal_partner: [0x24, 0x52, 0xdc], // custom dark blue (partners)
};

const SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

// ---------- minimal PNG decode (8-bit depth) ----------
function decode(file) {
	const buf = fs.readFileSync(file);
	if (!buf.subarray(0, 8).equals(SIG)) throw new Error("not a PNG");
	let off = 8;
	let w = 0,
		h = 0,
		depth = 0,
		colorType = 0,
		interlace = 0;
	const idat = [];
	while (off + 8 <= buf.length) {
		const len = buf.readUInt32BE(off);
		const type = buf.toString("ascii", off + 4, off + 8);
		const data = buf.subarray(off + 8, off + 8 + len);
		if (type === "IHDR") {
			w = data.readUInt32BE(0);
			h = data.readUInt32BE(4);
			depth = data[8];
			colorType = data[9];
			interlace = data[12];
		} else if (type === "IDAT") idat.push(data);
		else if (type === "IEND") break;
		off += 12 + len;
	}
	if (depth !== 8) throw new Error("bit depth " + depth + " not supported");
	if (interlace !== 0) throw new Error("interlaced PNG not supported");
	const raw = zlib.inflateSync(Buffer.concat(idat));
	const ch = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[colorType];
	if (!ch) throw new Error("color type " + colorType + " not supported");
	const stride = w * ch;
	const img = Buffer.alloc(w * h * 4);
	const prev = Buffer.alloc(stride);
	const cur = Buffer.alloc(stride);
	let p = 0;
	for (let y = 0; y < h; y++) {
		const ft = raw[p++];
		raw.copy(cur, 0, p, p + stride);
		p += stride;
		for (let x = 0; x < stride; x++) {
			const a = x >= ch ? cur[x - ch] : 0;
			const b = prev[x];
			const c = x >= ch ? prev[x - ch] : 0;
			if (ft === 1) cur[x] = (cur[x] + a) & 0xff;
			else if (ft === 2) cur[x] = (cur[x] + b) & 0xff;
			else if (ft === 3) cur[x] = (cur[x] + ((a + b) >> 1)) & 0xff;
			else if (ft === 4) {
				const pa = Math.abs(b - c),
					pb = Math.abs(a - c),
					pc = Math.abs(a + b - 2 * c);
				cur[x] = (cur[x] + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 0xff;
			}
		}
		cur.copy(prev);
		for (let x = 0; x < w; x++) {
			const o = (y * w + x) * 4;
			if (colorType === 6) {
				cur.copy(img, o, x * 4, x * 4 + 4);
			} else if (colorType === 2) {
				img[o] = cur[x * 3];
				img[o + 1] = cur[x * 3 + 1];
				img[o + 2] = cur[x * 3 + 2];
				img[o + 3] = 255;
			} else if (colorType === 3) {
				throw new Error("palette PNGs not supported here");
			} else if (colorType === 0) {
				img[o] = img[o + 1] = img[o + 2] = cur[x];
				img[o + 3] = 255;
			} else if (colorType === 4) {
				img[o] = img[o + 1] = img[o + 2] = cur[x * 2];
				img[o + 3] = cur[x * 2 + 1];
			}
		}
	}
	return { w, h, rgba: img };
}

// ---------- minimal PNG encode (RGBA, filter 0) ----------
const CRC_TABLE = (() => {
	const t = new Int32Array(256);
	for (let n = 0; n < 256; n++) {
		let c = n;
		for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
		t[n] = c;
	}
	return t;
})();
function crc32(buf) {
	let c = -1;
	for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
	return (c ^ -1) >>> 0;
}
function chunk(type, data) {
	const out = Buffer.alloc(12 + data.length);
	out.writeUInt32BE(data.length, 0);
	out.write(type, 4, "ascii");
	data.copy(out, 8);
	out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
	return out;
}
function encode(w, h, rgba) {
	const stride = w * 4;
	const raw = Buffer.alloc((stride + 1) * h);
	for (let y = 0; y < h; y++) {
		raw[y * (stride + 1)] = 0;
		rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
	}
	const ihdr = Buffer.alloc(13);
	ihdr.writeUInt32BE(w, 0);
	ihdr.writeUInt32BE(h, 4);
	ihdr[8] = 8;
	ihdr[9] = 6;
	return Buffer.concat([
		SIG,
		chunk("IHDR", ihdr),
		chunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
		chunk("IEND", Buffer.alloc(0)),
	]);
}

// ---------- build ----------
const img = decode(SRC);
if (process.argv[2] === "--dry") {
	for (const [name, [r, g, b]] of Object.entries(SEALS)) {
		console.log(name + ".png -> #" + [r, g, b].map((v) => v.toString(16).padStart(2, "0")).join(""));
	}
	process.exit(0);
}
for (const [name, [r, g, b]] of Object.entries(SEALS)) {
	const out = Buffer.from(img.rgba);
	for (let i = 0; i < img.w * img.h; i++) {
		if (out[i * 4 + 3] > 0) {
			out[i * 4] = r;
			out[i * 4 + 1] = g;
			out[i * 4 + 2] = b;
		}
	}
	const dst = path.join(OUT_DIR, name + ".png");
	fs.writeFileSync(dst, encode(img.w, img.h, out));
	console.log("wrote media/" + name + ".png (" + img.w + "x" + img.h + ", #" + [r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("") + ")");
}
