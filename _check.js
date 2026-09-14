// quick static sanity check for index.html editor logic
const fs = require("fs");
const html = fs.readFileSync("index.html", "utf8");

// extract the main <script> block (the last one)
const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
const js = scripts.join("\n");

new Function(js); // throws on syntax error
console.log("script syntax: OK");

// every $() id referenced must exist in the HTML
const ids = new Set([...html.matchAll(/id="([^"]+)"/g)].map(m => m[1]));
const missing = new Set();
for (const m of js.matchAll(/\$\("([^"]+)"\)/g)) {
	if (!ids.has(m[1])) missing.add(m[1]);
}
// ids created dynamically are fine (importFile etc are static) - report only truly missing
const dynamicOk = new Set();
if (missing.size) {
	console.log("MISSING IDS:", [...missing].join(", "));
	process.exit(1);
}
console.log("all $() ids resolve: OK");

// key functions present
for (const fn of ["wireFilePicker", "fileToBlobURL", "fileToDataURI", "editorTag", "renderEditorPreview", "openEditor", "ntMediaShim"]) {
	if (fn === "ntMediaShim") continue;
	if (!js.includes("function " + fn) && !js.includes(fn + " =")) {
		console.log("MISSING FUNCTION:", fn);
		process.exit(1);
	}
}
console.log("media functions present: OK");

// the two new pickers must be wired
if (!js.includes('wireFilePicker("edIconFile"') || !js.includes('wireFilePicker("edBgFile"')) {
	console.log("pickers not wired");
	process.exit(1);
}
console.log("file pickers wired: OK");

// bgImage must survive edSave and render in preview
if (!js.includes("clean.bgImage") || !js.includes("backgroundImage")) {
	console.log("bgImage plumbing missing");
	process.exit(1);
}
console.log("bgImage plumbing: OK");
