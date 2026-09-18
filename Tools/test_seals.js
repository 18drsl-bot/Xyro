// test_seals.js - the verified seal artwork must match the rank colour tables in
// BOTH places that reference it, or a tag shows the wrong colour in game while
// the editor previews the right one (or vice versa):
//
//   * xyro.lua  NT_RANK_COLORS   rank -> tint      (the in-game seal)
//   * index.html RANK_SEALS      rank -> file name (the editor preview)
//   * media/seal_<rank>.png      the actual pixels
//
//   node Tools/test_seals.js
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

let pass = 0;
const failures = [];
function ok(name, cond, extra) {
	if (cond) pass++;
	else {
		failures.push(name + (extra ? " -> " + extra : ""));
		console.log("FAIL " + name + (extra ? " -> " + extra : ""));
	}
}

const ROOT = path.join(__dirname, "..");
const SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/* ------------------------------------------------------- minimal PNG read */

function decode(file) {
	const buf = Buffer.isBuffer(file) ? file : fs.readFileSync(file);
	if (!buf.subarray(0, 8).equals(SIG)) throw new Error("not a PNG (" + buf.subarray(0, 4).toString("hex") + ")");
	let off = 8, w = 0, h = 0, depth = 0, colorType = 0, interlace = 0;
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
	if (depth !== 8) throw new Error("bit depth " + depth);
	if (interlace !== 0) throw new Error("interlaced");
	const raw = zlib.inflateSync(Buffer.concat(idat));
	const bpp = colorType === 6 ? 4 : colorType === 2 ? 3 : colorType === 0 ? 1 : 0;
	if (!bpp) throw new Error("colour type " + colorType);
	const stride = w * bpp;
	const out = Buffer.alloc(h * stride);
	let pos = 0;
	for (let y = 0; y < h; y++) {
		const filter = raw[pos++];
		const line = raw.subarray(pos, pos + stride);
		pos += stride;
		const prev = y === 0 ? Buffer.alloc(stride) : out.subarray((y - 1) * stride, y * stride);
		const cur = out.subarray(y * stride, (y + 1) * stride);
		for (let x = 0; x < stride; x++) {
			const rawByte = line[x];
			const a = x >= bpp ? cur[x - bpp] : 0;
			const b = prev[x];
			const c = x >= bpp ? prev[x - bpp] : 0;
			let v;
			if (filter === 0) v = rawByte;
			else if (filter === 1) v = rawByte + a;
			else if (filter === 2) v = rawByte + b;
			else if (filter === 3) v = rawByte + ((a + b) >> 1);
			else {
				const p = a + b - c;
				const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
				v = rawByte + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
			}
			cur[x] = v & 0xff;
		}
	}
	return { w, h, bpp, pixels: out };
}

/** The colour of the disc: the most common opaque pixel, ignoring the white
 *  check - except when white IS the expected tint (the hr seal), where the
 *  check is told apart by being fully opaque over a hairline outline. */
function dominantTint(img, keepWhite) {
	const counts = new Map();
	for (let i = 0; i < img.pixels.length; i += img.bpp) {
		const r = img.pixels[i], g = img.pixels[i + 1], b = img.pixels[i + 2];
		const a = img.bpp === 4 ? img.pixels[i + 3] : 255;
		if (a < 200) continue;
		if (!keepWhite && r > 235 && g > 235 && b > 235) continue; // the white check
		if (r < 20 && g < 20 && b < 20) continue; // outline
		const key = (r << 16) | (g << 8) | b;
		counts.set(key, (counts.get(key) || 0) + 1);
	}
	let best = null, bestN = 0;
	for (const [key, n] of counts) if (n > bestN) { bestN = n; best = key; }
	return best === null ? null : { r: (best >> 16) & 255, g: (best >> 8) & 255, b: best & 255, n: bestN, total: img.w * img.h };
}

/* ------------------------------------------- the two tables being compared */

const lua = fs.readFileSync(path.join(ROOT, "xyro.lua"), "utf8");
const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");

const colors = {}; // rank -> [r,g,b] from NT_RANK_COLORS
const colorBlock = lua.match(/local NT_RANK_COLORS = \{([\s\S]*?)\n\}/);
ok("xyro.lua has NT_RANK_COLORS", !!colorBlock);
for (const m of (colorBlock ? colorBlock[1] : "").matchAll(/(\w+)\s*=\s*Color3\.fromRGB\((\d+),\s*(\d+),\s*(\d+)\)/g)) {
	colors[m[1]] = [Number(m[2]), Number(m[3]), Number(m[4])];
}

const seals = {}; // rank -> file name from the editor
const sealBlock = html.match(/const RANK_SEALS = \{([\s\S]*?)\};/);
ok("index.html has RANK_SEALS", !!sealBlock);
for (const m of (sealBlock ? sealBlock[1] : "").matchAll(/(\w+):\s*"([^"]+)"/g)) {
	seals[m[1]] = m[2];
}

const ranks = Object.keys(colors);
ok("both tables cover the same ranks", ranks.length > 0 && ranks.every(r => seals[r]) && Object.keys(seals).length === ranks.length,
	"script " + ranks.join(",") + " | editor " + Object.keys(seals).join(","));

/* ---------------------------------------------------- the pixels themselves */

const tol = 18; // the seal artwork is antialiased; the flat disc is exact
for (const rank of ranks) {
	const file = path.join(ROOT, "media", seals[rank] || "seal_" + rank + ".png");
	if (!fs.existsSync(file)) {
		ok("media/" + path.basename(file) + " exists", false, "missing file for rank " + rank);
		continue;
	}
	let tint = null;
	try {
		const want = colors[rank];
		tint = dominantTint(decode(file), want[0] > 235 && want[1] > 235 && want[2] > 235);
	} catch (e) {
		ok("media/" + path.basename(file) + " decodes", false, e.message);
		continue;
	}
	const want = colors[rank];
	const close = tint && Math.abs(tint.r - want[0]) <= tol && Math.abs(tint.g - want[1]) <= tol && Math.abs(tint.b - want[2]) <= tol;
	ok("seal for " + rank + " paints " + want.join(","), close,
		tint ? "file paints " + tint.r + "," + tint.g + "," + tint.b + " (" + Math.round((tint.n / tint.total) * 100) + "% of pixels)" : "no opaque pixels");
}

// the plain check everyone without a rank gets
const blue = dominantTint(decode(path.join(ROOT, "media", "verified_seal_blue.png")));
ok("the default seal is the Roblox blue", blue && Math.abs(blue.r - 0) <= tol && Math.abs(blue.g - 0xa2) <= 26 && Math.abs(blue.b - 0xff) <= 26,
	blue ? blue.r + "," + blue.g + "," + blue.b : "unreadable");

/* ------------------------------- the ranks the script will actually resolve */

const aliases = lua.match(/local NT_RANK_ALIASES = \{([\s\S]*?)\n\}/);
const aliasRanks = new Set();
// one leading tab = a TIER; the keys inside each tier's set are aliases
for (const m of (aliases ? aliases[1] : "").matchAll(/^\t(\w+)\s*=\s*\{/gm)) aliasRanks.add(m[1]);
ok("every alias tier has a colour", [...aliasRanks].every(r => colors[r]), [...aliasRanks].join(","));
ok("every colour tier has an alias (so it can be typed in a rule)", ranks.every(r => aliasRanks.has(r)),
	ranks.filter(r => !aliasRanks.has(r)).join(","));

/* --------------------------- the DEPLOYED artwork (node Tools/test_seals.js --remote) */

/* A seal that is right in the repo but wrong through the CDN renders the wrong
   colour in game forever: the URL carries ?v=<buster>, so a stale edge copy is
   pinned to that key until the buster changes. That is why this half exists. */
async function remote() {
	const BUSTER = (lua.match(/local sealBuster = "([^"]+)"/) || [])[1] || "";
	ok("the script's seal buster was found", BUSTER !== "", "no sealBuster in xyro.lua");
	const bases = {
		jsdelivr: "https://cdn.jsdelivr.net/gh/vertxxy-1/Xyro@main/media/",
		raw: "https://raw.githubusercontent.com/vertxxy-1/Xyro/main/media/",
	};
	for (const rank of ranks) {
		const file = seals[rank];
		const want = colors[rank];
		const seen = new Map();
		for (const [name, base] of Object.entries(bases)) {
			const url = base + file + (name === "jsdelivr" ? BUSTER : "");
			let tint = null, err = "";
			try {
				const res = await fetch(url, { cache: "no-store" });
				if (!res.ok) err = "http " + res.status;
				else tint = dominantTint(decode(Buffer.from(await res.arrayBuffer())), want[0] > 235 && want[1] > 235 && want[2] > 235);
			} catch (e) { err = e.message; }
			const close = tint && Math.abs(tint.r - want[0]) <= tol && Math.abs(tint.g - want[1]) <= tol && Math.abs(tint.b - want[2]) <= tol;
			ok(name + " serves the right " + rank + " seal" + (name === "jsdelivr" ? " (" + BUSTER + ")" : ""), close,
				tint ? "serves " + tint.r + "," + tint.g + "," + tint.b : err);
			if (tint) seen.set(name, [tint.r, tint.g, tint.b].join(","));
		}
		if (seen.size === 2) ok("both CDNs agree on the " + rank + " seal", new Set(seen.values()).size === 1, [...seen].map(([k, v]) => k + "=" + v).join(" "));
	}
}

if (process.argv.includes("--remote")) remote().then(finish);
else finish();

function finish() {
	console.log("\n" + (failures.length ? failures.length + " FAILED (" + pass + " passed)" : pass + " checks passed"));
	process.exit(failures.length ? 1 : 0);
}
