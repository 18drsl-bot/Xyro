// test_seals.js - the verified seal artwork must match the rank colour tables in
// BOTH places that reference it, or a tag shows the wrong colour in game while
// the editor previews the right one (or vice versa):
//
//   * xyro.lua  NT_RANK_COLORS   rank -> tint      (the in-game seal)
//   * index.html RANK_SEALS      rank -> file name (the editor preview)
//   * index.html RANK_TINTS      rank -> tint      (the preview's contrast math)
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

/* ------------- the disc that fills the artwork's cut-out check -------------- */

/* The check is TRANSPARENT in every one of these files, so on a flat pill it has
   always shown the pill colour - and on a rule with a bgImage it shows the photo,
   which is how a black badge becomes a black blob with a smudge in it. The script
   and the editor therefore draw a disc of the contrasting ink BEHIND the seal, and
   that disc has two opposing constraints that only the pixels can settle:

     - big enough to cover the whole check (or its tips stay transparent), and
     - small enough never to reach the transparent region AROUND the badge (or it
       shows as a blob of its own at the scalloped edge).

   Both are measured here rather than assumed, so a redrawn seal with a different
   check cannot quietly invalidate the number both sides hardcode. */
function sealGeometry(img) {
	const opaque = (x, y) => x >= 0 && y >= 0 && x < img.w && y < img.h &&
		(img.bpp === 4 ? img.pixels[(y * img.w + x) * img.bpp + 3] >= 128 : true);
	/* flood the outside: whatever transparent pixels are unreachable from the
	   border are the check */
	const outside = Array.from({ length: img.h }, () => new Array(img.w).fill(false));
	const stack = [];
	for (let x = 0; x < img.w; x++) stack.push([x, 0], [x, img.h - 1]);
	for (let y = 0; y < img.h; y++) stack.push([0, y], [img.w - 1, y]);
	while (stack.length) {
		const [x, y] = stack.pop();
		if (x < 0 || y < 0 || x >= img.w || y >= img.h || outside[y][x] || opaque(x, y)) continue;
		outside[y][x] = true;
		stack.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
	}
	let minX = img.w, maxX = -1, minY = img.h, maxY = -1;
	const hole = [];
	for (let y = 0; y < img.h; y++) for (let x = 0; x < img.w; x++) {
		if (opaque(x, y)) {
			if (x < minX) minX = x;
			if (x > maxX) maxX = x;
			if (y < minY) minY = y;
			if (y > maxY) maxY = y;
		} else if (!outside[y][x]) hole.push([x, y]);
	}
	const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
	const dist = (x, y) => Math.hypot(x - cx, y - cy);
	let reach = 0; /* the furthest the check gets from the disc's centre */
	for (const [x, y] of hole) reach = Math.max(reach, dist(x, y));
	let safe = 0; /* how far a centred circle may reach without leaving the badge */
	for (let r = 0.25; r <= Math.max(img.w, img.h); r += 0.25) {
		let clean = true;
		for (let y = 0; y < img.h && clean; y++) for (let x = 0; x < img.w; x++) {
			if (dist(x, y) <= r && outside[y][x]) { clean = false; break; }
		}
		if (!clean) break;
		safe = r;
	}
	return { reach, safe, side: img.h, holes: hole.length };
}

const luaDisc = parseFloat((lua.match(/local NT_SEAL_CHECK_DISC = ([\d.]+)/) || [])[1]);
const htmlDisc = parseFloat((html.match(/checkDisc: ([\d.]+)/) || [])[1]);
ok("the script states how much of the badge the check's disc covers", isFinite(luaDisc), String(luaDisc));
ok("...and the editor hardcodes the same fraction", isFinite(htmlDisc) && htmlDisc === luaDisc, luaDisc + " in xyro.lua vs " + htmlDisc + " in index.html");

const checkFiles = [...new Set([...Object.values(seals), "verified_seal.png", "verified_seal_blue.png"])]
	.map(f => path.join(ROOT, "media", f))
	.filter(f => fs.existsSync(f));
let worstCover = Infinity, worstInside = -Infinity, geometrySeen = new Set();
for (const file of checkFiles) {
	const g = sealGeometry(decode(file));
	const radius = (luaDisc * g.side) / 2;
	worstCover = Math.min(worstCover, radius - g.reach);
	worstInside = Math.max(worstInside, radius - g.safe);
	geometrySeen.add(g.reach.toFixed(2) + "/" + g.safe.toFixed(2) + "/" + g.holes);
}
ok("every seal shares one check geometry", geometrySeen.size === 1, [...geometrySeen].join(" | "));
ok("the disc covers the whole check on every seal", worstCover >= 0,
	"tightest seal leaves " + worstCover.toFixed(2) + "px of the check uncovered");
ok("...and never reaches the transparent edge around the badge", worstInside <= 0,
	"the disc would show by " + worstInside.toFixed(2) + "px on the worst seal");

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

/* ------------------------------------ the contrast fallback --------------- */

/* A seal whose tint sits near the pill's lightness disappears into it - the white
   HR seal on a white pill, the navy partner seal on a black one. Both sides then
   draw the same mask flat black/white, and both decide it from three numbers:
   the rank tints, the blue seal's tint, and the contrast floor. Drift in any one
   of them and the site previews a coloured badge where a player gets a black one
   - silently, because both look fine on their own. */
const luaBlue = lua.match(/local NT_SEAL_BLUE = Color3\.fromRGB\((\d+),\s*(\d+),\s*(\d+)\)/);
const luaFloor = Number((lua.match(/local NT_BADGE_MIN_CONTRAST = ([\d.]+)/) || [])[1]);
const jsFloor = Number((html.match(/const BADGE_MIN_CONTRAST = ([\d.]+)/) || [])[1]);
const jsBlue = (html.match(/const SEAL_BLUE = "([^"]+)"/) || [])[1];
const jsTintBlock = html.match(/const RANK_TINTS = \{([\s\S]*?)\};/);
const jsTints = {};
for (const m of (jsTintBlock ? jsTintBlock[1] : "").matchAll(/(\w+):\s*"#([0-9a-fA-F]{6})"/g)) jsTints[m[1]] = m[2].toLowerCase();

ok("xyro.lua and index.html both define the contrast floor", luaFloor > 0 && luaFloor === jsFloor,
	"script " + luaFloor + " vs site " + jsFloor);
ok("...and the site's rank tints are the script's NT_RANK_COLORS",
	ranks.length > 0 && ranks.every(r => jsTints[r] === colors[r].map(v => v.toString(16).padStart(2, "0")).join("")),
	ranks.filter(r => jsTints[r] !== colors[r].map(v => v.toString(16).padStart(2, "0")).join("")).join(",") || "all agree");
const luaCheckFloor = Number((lua.match(/local NT_CHECK_MIN_CONTRAST = ([\d.]+)/) || [])[1]);
const jsCheckFloor = Number((html.match(/const CHECK_MIN_CONTRAST = ([\d.]+)/) || [])[1]);
ok("xyro.lua and index.html both define the check's floor, below the seal's",
	luaCheckFloor > 0 && luaCheckFloor === jsCheckFloor && luaCheckFloor < luaFloor,
	"script " + luaCheckFloor + " vs site " + jsCheckFloor + " (seal floor " + luaFloor + ")");
/* The mark this copies is a WHITE check on the blue seal. A floor above that
   ratio is how the blue badge came out black in game while the site previewed
   the real thing - the two numbers are the whole bug, so they are asserted
   rather than trusted. */
const relLumChannel = v => v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
const relLumHex = hex => {
	const n = parseInt(hex.replace("#", ""), 16);
	return 0.2126 * relLumChannel(((n >> 16) & 255) / 255) + 0.7152 * relLumChannel(((n >> 8) & 255) / 255) + 0.0722 * relLumChannel((n & 255) / 255);
};
const lumRatio = (a, b) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
const whiteCheckOn = hex => lumRatio(relLumHex(hex), 1) >= jsCheckFloor;
ok("...and the blue seal gets a WHITE check, which is the real badge's own colours",
	jsBlue && whiteCheckOn(jsBlue),
	jsBlue + " white ratio " + lumRatio(relLumHex(jsBlue), 1).toFixed(2) + " vs floor " + jsCheckFloor);
ok("...while a disc too light for white still gets a black check",
	jsTints.hr && jsTints.founder && !whiteCheckOn(jsTints.hr) && !whiteCheckOn(jsTints.founder),
	["hr " + lumRatio(relLumHex(jsTints.hr || "#ffffff"), 1).toFixed(2),
		"founder " + lumRatio(relLumHex(jsTints.founder || "#ffffff"), 1).toFixed(2)].join(", "));

ok("...and the rankless seal's tint is the blue the artwork actually paints",
	luaBlue && blue && jsBlue &&
		Math.abs(Number(luaBlue[1]) - blue.r) <= tol && Math.abs(Number(luaBlue[2]) - blue.g) <= tol && Math.abs(Number(luaBlue[3]) - blue.b) <= tol &&
		jsBlue.toLowerCase() === "#" + [blue.r, blue.g, blue.b].map(v => v.toString(16).padStart(2, "0")).join(""),
	[luaBlue && luaBlue.slice(1).join(","), jsBlue, blue && [blue.r, blue.g, blue.b].join(",")].join(" | "));

/* --------------------------------- an error body is not a seal --------------- */

/* The badge bug this guards: game:HttpGet returns the BODY whatever the status
   was, so a seal fetched before it was published (the red developer seal was
   added after the last buster bump) arrived as the API's error text and was
   written to Xyro/ntmedia/<url hash>.png as if it were pixels. Every session
   after that served that file from disk and set it as the badge's Image - and
   because the asset DID load, the load verifier saw a healthy image and never
   fell back, so the badge drew nothing at all. The script now refuses to save
   anything that is not a whole image.

   The predicate is mirrored here on purpose: the Lua half is pinned by
   test_contract.js, this half proves it accepts real seals and rejects the two
   ways a bad body arrives. */
function looksWhole(data) {
	const buf = Buffer.isBuffer(data) ? data : Buffer.from(data, "binary");
	if (buf.length < 24) return false;
	const last = buf.subarray(-16);
	if (buf.subarray(0, 8).equals(SIG)) return last.includes(Buffer.from("IEND"));
	if (buf[0] === 0xff && buf[1] === 0xd8) return last.includes(Buffer.from([0xff, 0xd9]));
	const gif = buf.subarray(0, 6).toString("ascii");
	if (gif === "GIF87a" || gif === "GIF89a") return last.includes(0x3b);
	if (buf.subarray(0, 4).toString("ascii") === "RIFF" && buf.subarray(8, 12).toString("ascii") === "WEBP") return true;
	return false;
}

/* the full buster line, parsed once: the version is part of the contract now */
const busterVersion = Number(((lua.match(/local sealBuster = "\?v=(\d+)"/) || [])[1]) || 0);
ok("...and the buster is recent enough to abandon a poisoned entry written before the red tier existed",
	busterVersion >= 15, "sealBuster v" + busterVersion);

for (const rank of ranks) {
	const file = path.join(ROOT, "media", seals[rank]);
	if (!fs.existsSync(file)) continue;
	const bytes = fs.readFileSync(file);
	ok("a real " + rank + " seal is recognised as a whole image", looksWhole(bytes), bytes.length + " bytes");
	ok("...and that stops being true when the download is truncated", !looksWhole(bytes.subarray(0, Math.floor(bytes.length / 2))), "");
}
ok("an error page is not mistaken for a shield",
	!looksWhole("<!DOCTYPE html><html><body>404 not found: no such repo file</body></html>") &&
	!looksWhole('{"error":"no such repo file: media/seal_developer.png"}') &&
	!looksWhole("") &&
	!looksWhole("PNG"), "");
ok("...and trailing bytes after a valid image do not make it invalid",
	looksWhole(Buffer.concat([fs.readFileSync(path.join(ROOT, "media", seals[ranks[0]])), Buffer.from("\n\n")])), "");

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
