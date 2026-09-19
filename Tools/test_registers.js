// test_registers.js - the 200-local ceiling, checked before a player finds it.
//
//   node Tools/test_registers.js [file]
//
// Luau allows 200 registers per function, and a local holds one from its line to
// the end of its block. A file whose locals are spread across many small
// functions is fine; one where a single scope accumulates them is not, and the
// failure is invisible until an executor refuses the whole script with
//   "Out of local registers when trying to allocate x: exceeded limit 200"
// - which is what happened to the main chunk of xyro.lua at line 13972.
//
// So this walks the file's real block structure (comments and strings out of the
// way, `if/while/for/do/repeat/function` on one stack) and reports the peak
// number of simultaneously live locals per scope, failing above a threshold that
// leaves room for what this cannot model: the compiler's own temporaries.
const fs = require("fs");
const path = require("path");

const LIMIT = 200;      // Luau's hard ceiling
const BUDGET = 175;     // what we hold ourselves to, so temporaries still fit

const KEYWORDS = new Set(["and", "break", "do", "else", "elseif", "end", "false",
	"for", "function", "if", "in", "local", "nil", "not", "or", "repeat",
	"return", "then", "true", "until", "while", "continue", "export"]);
const IDENT = /^[A-Za-z_][A-Za-z0-9_]*/;

/* Every token the compiler would see, with comments and string bodies consumed
   whole so nothing inside them can be read as code. */
function tokenize(src) {
	const out = [];
	let i = 0, line = 1;
	const n = src.length;
	while (i < n) {
		const c = src[i];
		if (c === "\n") { line++; i++; continue; }
		if (c === " " || c === "\t" || c === "\r") { i++; continue; }
		if (src.startsWith("--", i)) {
			const m = /^--\[(=*)\[/.exec(src.slice(i));
			if (m) {
				const close = "]" + m[1] + "]";
				const j = src.indexOf(close, i);
				if (j < 0) break;
				line += src.slice(i, j).split("\n").length - 1;
				i = j + close.length;
			} else {
				const j = src.indexOf("\n", i);
				i = j < 0 ? n : j;
			}
			continue;
		}
		if (c === '"' || c === "'") {
			let j = i + 1;
			while (j < n && src[j] !== c) {
				if (src[j] === "\\") { j += 2; continue; }
				if (src[j] === "\n") line++;
				j++;
			}
			i = j + 1;
			continue;
		}
		if (/^\[(=*)\[/.test(src.slice(i))) {
			const m = /^\[(=*)\[/.exec(src.slice(i));
			const close = "]" + m[1] + "]";
			const j = src.indexOf(close, i);
			if (j < 0) break;
			line += src.slice(i, j).split("\n").length - 1;
			i = j + close.length;
			continue;
		}
		if (IDENT.test(c)) {
			const m = IDENT.exec(src.slice(i))[0];
			out.push([m, line]);
			i += m.length;
			continue;
		}
		if (c >= "0" && c <= "9") {
			const m = /^0[xX][0-9a-fA-F]+|\d*\.?\d+([eE][-+]?\d+)?/.exec(src.slice(i))[0];
			i += m.length;
			continue;
		}
		out.push([c, line]);
		i++;
	}
	return out;
}

/* Every ( [ { has to have its match, with comments and strings already gone:
   the same token stream the scope walk uses, so a cut in the wrong place shows
   up here rather than in an executor. */
function brackets(src) {
	const stack = [];
	const close = { ")": "(", "]": "[", "}": "{" };
	for (const [t, line] of tokenize(src)) {
		if (t === "(" || t === "[" || t === "{") stack.push([t, line]);
		else if (close[t]) {
			const open = stack.pop();
			if (!open || open[0] !== close[t]) return "line " + line + ": " + t + " has no matching opener";
		}
	}
	return stack.length ? "line " + stack[stack.length - 1][1] + ": " + stack[stack.length - 1][0] + " is never closed" : "";
}

/* Walk the block structure. Returns every scope (the main chunk and each
   function) with its peak, and whether the whole file balanced. */
function scopes(src) {
	const toks = tokenize(src);
	const found = [];
	const enclosing = [];
	let frame = { name: "<main chunk>", line: 1, live: 0, peak: 0, blocks: [0] },
		pending = null, k = 0;
	while (k < toks.length) {
		const [tok, line] = toks[k];
		if (tok === "function") {
			let name = "<anonymous>";
			if (k > 0 && IDENT.test(toks[k - 1][0]) && toks[k - 1][0] !== "function") name = toks[k - 1][0];
			let j = k + 1;
			while (j < toks.length && toks[j][0] !== "(") j++;
			let depth = 0, params = 0, want = true;
			while (j < toks.length) {
				const t = toks[j][0];
				if (t === "(") depth++;
				else if (t === ")") { depth--; if (depth === 0) break; }
				else if (depth === 1) {
					if (t === ",") want = true;
					else if (t === "...") { params++; want = false; }
					else if (want && IDENT.test(t) && !KEYWORDS.has(t)) { params++; want = false; }
				}
				j++;
			}
			enclosing.push(frame);
			frame = { name: name, line: line, live: params, peak: params, blocks: [params] };
			pending = null;
			k = j + 1;
			continue;
		}
		if (tok === "local") {
			let count = 0;
			if (toks[k + 1] && toks[k + 1][0] === "function") count = 1;
			else {
				let j = k + 1;
				while (j < toks.length) {
					const t = toks[j][0];
					if (t === "=" || t === "end" || t === "until" || t === "return") break;
					if (KEYWORDS.has(t) && t !== "nil" && t !== "true" && t !== "false") break;
					if (IDENT.test(t)) count++;
					j++;
				}
			}
			frame.live += count;
			frame.blocks[frame.blocks.length - 1] += count;
			frame.peak = Math.max(frame.peak, frame.live);
			k++;
			continue;
		}
		if (tok === "if" || tok === "while" || tok === "for") { pending = tok; k++; continue; }
		if (tok === "then" || tok === "do") {
			/* `elseif ... then` re-opens a branch that the elseif already pushed:
			   pushing again here would leave one block per elseif unclosed. */
			if (pending === "elseif" || (tok === "then" && pending === null)) { k++; continue; }
			let alloc = 0;
			if (pending === "for") {
				let j = k - 1;
				while (j >= 0 && toks[j][0] !== "for") j--;
				j++;
				let names = 0;
				while (j < toks.length && toks[j][0] !== "do" && toks[j][0] !== "in") {
					if (IDENT.test(toks[j][0]) && !KEYWORDS.has(toks[j][0])) names++;
					j++;
				}
				alloc = Math.max(1, names);
			}
			frame.blocks.push(alloc);
			frame.live += alloc;
			frame.peak = Math.max(frame.peak, frame.live);
			pending = null;
			k++;
			continue;
		}
		if (tok === "repeat") { frame.blocks.push(0); k++; continue; }
		if (tok === "else" || tok === "elseif") {
			if (frame.blocks.length > 1) frame.live -= frame.blocks.pop();
			frame.blocks.push(0);
			pending = tok === "elseif" ? "elseif" : null;
			k++;
			continue;
		}
		if (tok === "end" || tok === "until") {
			if (frame.blocks.length > 1) {
				frame.live -= frame.blocks.pop();
			} else {
				// that `end` closed the scope itself: it is a finished function
				found.push(frame);
				frame = enclosing.length ? enclosing.pop() : frame;
			}
			k++;
			continue;
		}
		k++;
	}
	if (found.indexOf(frame) < 0) found.push(frame);   // the main chunk closes last
	return { found: found, unbalanced: enclosing.length };
}

/* --profile: every line where the running maximum of the main chunk grew, so a
   cut can be placed where it actually lowers a scope rather than guessed. */
function profile(src) {
	const toks = tokenize(src);
	let live = 0, peak = 0, pending = null, k = 0, depth = 0;
	const blocks = [];
	for (; k < toks.length; k++) {
		const [tok, line] = toks[k];
		if (tok === "function") { depth++; continue; }
		if (tok === "if" || tok === "while" || tok === "for") { pending = tok; continue; }
		if (tok === "then" || tok === "do") {
			if (pending === "elseif" || (tok === "then" && pending === null)) continue;
			let alloc = pending === "for" ? 1 : 0;
			blocks.push(alloc); live += alloc; pending = null; continue;
		}
		if (tok === "repeat") { blocks.push(0); continue; }
		if (tok === "else" || tok === "elseif") {
			if (blocks.length) live -= blocks.pop();
			blocks.push(0); pending = tok === "elseif" ? "elseif" : null; continue;
		}
		if (tok === "end" || tok === "until") { if (blocks.length) live -= blocks.pop(); continue; }
		if (tok === "local") {
			let count = 0, j = k + 1;
			if (toks[j] && toks[j][0] === "function") count = 1;
			else for (; j < toks.length; j++) {
				const t = toks[j][0];
				if (t === "=" || t === "end" || t === "until" || t === "return") break;
				if (KEYWORDS.has(t) && t !== "nil" && t !== "true" && t !== "false") break;
				if (IDENT.test(t)) count++;
			}
			live += count;
			if (live > peak) { peak = live; console.log("  line " + String(line).padStart(6) + "   live " + live); }
		}
	}
}

const file = process.argv.slice(2).find(a => !a.startsWith("--")) || "xyro.lua";
const src = fs.readFileSync(path.join(__dirname, "..", file), "utf8");
if (process.argv.indexOf("--profile") >= 0) {
	console.log("running maximum of live locals in the main chunk:");
	profile(src);
	process.exit(0);
}

const { found, unbalanced } = scopes(src);
const worst = found.slice().sort((a, b) => b.peak - a.peak).slice(0, 6);
console.log("scopes found: " + found.length + (unbalanced ? "  (UNBALANCED: " + unbalanced + " left open)" : "  (structure balances)"));
for (const f of worst) {
	console.log("  peak " + String(f.peak).padStart(4) + "  " + f.name.padEnd(22) +
		" declared line " + f.line + (f.peak > BUDGET ? "   <-- over budget" : ""));
}
const over = found.filter(f => f.peak > BUDGET);
console.log(over.length
	? over.length + " scope(s) over the " + BUDGET + " budget (Luau stops at " + LIMIT + ")"
	: "every scope is inside the " + BUDGET + " budget");

const badBracket = brackets(src);
if (badBracket) console.log("UNBALANCED BRACKETS: " + badBracket);
if (unbalanced) console.log("UNCLOSED SCOPES: " + unbalanced + " still open at the end of the file");
process.exit(over.length || unbalanced || badBracket ? 1 : 0);
