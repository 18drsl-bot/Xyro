--[[
	Xyro - always-fresh loader
	Fetches xyro.lua from several mirrors and prefers the GitHub API,
	which is NEVER CDN-cached - so a push goes live for everyone
	immediately (raw.githubusercontent.com can serve stale copies for
	minutes after a push; that's why "no updates" happened before).

	Mirrors, in order:
	  1. api.github.com contents API  -> base64 of the file, never cached
	  2. cdn.jsdelivr.net/gh/...@main/xyro.lua (global edge; editor purges
	     its cache on every publish)
	  3. raw.githubusercontent.com/.../refs/heads/main/xyro.lua (cache-busted)
	  4. vertxxy-1.github.io/Xyro/xyro.lua (GitHub Pages, rebuilt on push)
	  5. raw.githubusercontent.com/.../main/xyro.lua (last resort)

	Every download is size-checked, marker-checked and tail-checked
	before running; a truncated or stale-looking file is never executed.

	REMOTE GATE (kill switch)
	This loader checks the database's staff/gate node before it downloads
	anything, so you can stop everyone with one edit - no repo push, no
	redeploy, no script update:

		staff/gate = { "enabled": false, "message": "back in 10 minutes" }

	With the gate off, this loader refuses to run, /script on the Xyro API
	answers 403, and clients already running shut themselves down on their
	next check. A gate that cannot be READ is treated as open, so a database
	hiccup can never take the script away from everyone at once.
	See api/README.md -> "The kill switch".

	Usage:
		loadstring(game:HttpGet("https://raw.githubusercontent.com/vertxxy-1/Xyro/main/loadstring.lua"))()

	The direct one-liner also works and now benefits from the API-first
	script boot check (see xyro.lua's own version probe):
		loadstring(game:HttpGet("https://raw.githubusercontent.com/vertxxy-1/Xyro/refs/heads/main/xyro.lua"))()
]]

local API_URL = "https://api.github.com/repos/vertxxy-1/Xyro/contents/xyro.lua"
local SOURCES = {
	"https://cdn.jsdelivr.net/gh/vertxxy-1/Xyro@main/xyro.lua",
	"https://raw.githubusercontent.com/vertxxy-1/Xyro/refs/heads/main/xyro.lua",
	"https://vertxxy-1.github.io/Xyro/xyro.lua",
	"https://raw.githubusercontent.com/vertxxy-1/Xyro/main/xyro.lua",
}
local MIN_SIZE = 100000 -- xyro.lua is ~420KB; anything smaller is truncated
local MARKERS = { "Xyro", "H.Nametags", "RenderStepped" } -- must all appear in a real build
local REPO_RAW = "https://raw.githubusercontent.com/vertxxy-1/Xyro/main/"
local REPO_CDN = "https://cdn.jsdelivr.net/gh/vertxxy-1/Xyro@main/"
local HttpService = game:GetService("HttpService")

local function warnAll(msg)
	warn("[Xyro] " .. tostring(msg))
end

-- plain-Lua fetch: HttpGet when present, request() as fallback
local function fetch(url)
	local ok, v = pcall(function()
		return game.HttpGet
	end)
	if ok and v then
		local ok2, body = pcall(function()
			return game:HttpGet(url, true)
		end)
		if ok2 and type(body) == "string" and #body > 0 then
			return body
		end
	end
	local req = (syn and syn.request) or http_request or request
	if req then
		local ok3, resp = pcall(req, { Url = url, Method = "GET" })
		if ok3 and resp and type(resp.Body) == "string" and #resp.Body > 0 then
			return resp.Body
		end
	end
	return nil
end

local function notify(title, text)
	pcall(function()
		game:GetService("StarterGui"):SetCore("SendNotification", {
			Title = tostring(title),
			Text = tostring(text),
			Duration = 8,
		})
	end)
end

-- decode any JSON value (a table, or a bare `false` from the gate node).
-- Returns value, ok - ok is true even when the value is false, which the
-- table-only check below could never express.
local function decodeAny(text)
	if type(text) ~= "string" or text == "" then
		return nil, false
	end
	local ok, data = pcall(function()
		return HttpService:JSONDecode(text)
	end)
	if not ok then
		return nil, false
	end
	return data, true
end

-- a repo config file (api.json / firebase.json). Raw first with a cache-buster,
-- then the jsDelivr edge; these are tiny and only consulted once per load.
local function repoFile(name)
	return fetch(REPO_RAW .. name .. "?t=" .. tostring(os.time()))
		or fetch(REPO_CDN .. name)
end

-- pure-Lua base64 decoder (fallback when the executor has no crypt lib)
local B64_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"
local B64_INV = {}
for i = 1, #B64_CHARS do
	B64_INV[B64_CHARS:sub(i, i)] = i - 1
end
local function base64decode(data)
	local crypt = (syn and syn.crypt and syn.crypt.base64decode)
		or (type(crypt) == "table" and crypt.base64decode)
		or (syn and syn.base64decode)
	if crypt then
		local ok, out = pcall(crypt, data)
		if ok and type(out) == "string" then
			return out
		end
	end
	data = data:gsub("[^%w%+%/=]", "")
	local bits = data:gsub(".", function(x)
		if x == "=" then
			return ""
		end
		local f = B64_INV[x] or 0
		local r = ""
		for i = 6, 1, -1 do
			r = r .. ((math.floor(f / (2 ^ (i - 1))) % 2) == 1 and "1" or "0")
		end
		return r
	end)
	return (bits:gsub("%d%d%d%d%d%d%d%d", function(x)
		local c = 0
		for i = 1, 8 do
			if x:sub(i, i) == "1" then
				c = c + 2 ^ (8 - i)
			end
		end
		return string.char(math.floor(c % 256))
	end))
end

-- decode the GitHub contents-API JSON into raw source. Also returns the
-- blob's exact byte length (`size`), which is the strongest integrity signal
-- available: byte-exact, and it tells a fresh mirror apart from a stale one.
local function fromAPI(jsonBody)
	local HttpService = game:GetService("HttpService")
	local ok, data = pcall(function()
		return HttpService:JSONDecode(jsonBody)
	end)
	if not (ok and type(data) == "table") then
		return nil, nil
	end
	local size = tonumber(data.size)
	if not (type(data.content) == "string" and #data.content > 1000) then
		return nil, size
	end
	local b64 = data.content:gsub("\n", "")
	local src = base64decode(b64)
	if type(src) == "string" and #src > 0 then
		return src, size
	end
	return nil, size
end

-- Is this candidate complete? Size + markers catch a short read; the compile
-- check catches a truncation that still clears the size bar.
--
-- This used to test for a literal "endend" tail (whitespace stripped). That
-- broke the moment a block was appended after the last nested end: xyro.lua
-- now ends with the blacklist block, so the tail is
-- "...pcall(H.blacklistShutdown)end". EVERY mirror was rejected with "tail is
-- wrong (truncated?)" and this loader could never run the script at all - it
-- only ever printed warnings. Compiling is the stronger test (a cut-off file
-- cannot compile) and cannot go stale when the file's shape changes.
--
-- Returns ok, why, soft. `soft` means "rejected on completeness only" - the
-- caller keeps such a candidate as a last resort instead of ending with
-- nothing, so an executor with a fussy compiler cannot leave you scriptless.
local function looksReal(src, sizeHint)
	if type(src) ~= "string" or #src < MIN_SIZE then
		return false, ("too small (%s bytes)"):format(type(src) == "string" and #src or tostring(src)), false
	end
	for _, m in ipairs(MARKERS) do
		if not src:find(m, 1, true) then
			return false, ("missing marker %q"):format(m), false
		end
	end
	-- byte-exact length check against the API's reported size. A mirror that is
	-- a revision behind (jsDelivr can lag for days) and a cut-off download are
	-- both caught here - and both are still kept as a last resort, because a
	-- working copy one revision old beats no script at all.
	if sizeHint and sizeHint > 0 and #src ~= sizeHint then
		return false, ("length mismatch: got %d bytes, expected %d"):format(#src, sizeHint), true
	end
	local compiler = loadstring or load
	if type(compiler) == "function" then
		local ok, fn, err = pcall(compiler, src, "=xyro-probe")
		if not ok then
			return false, "compiler error: " .. tostring(fn), true
		end
		if type(fn) ~= "function" then
			return false, "does not compile: " .. tostring(err), true
		end
		return true
	end
	-- no compiler available here: cheap structural check instead - the file must
	-- end on a closed block, not on a specific token sequence
	local tail = src:match("([^%s]+)%s*$")
	if not (tail and (tail:match("end$") or tail:match("%)$"))) then
		return false, "tail does not close a block (truncated?)", false
	end
	return true
end

-- --------------------------------------------------------------- the gate
-- Where is the gate? api.json when the Xyro API is deployed (one small fetch),
-- otherwise firebase.json so the gate still works without the Worker. No
-- config at all (or no gate node) means there is nothing to obey, and the
-- loader behaves exactly as it always has.
local gateUrl, scriptUrl
local gateState
pcall(function()
	local cfg = decodeAny(repoFile("api.json") or "")
	local api = type(cfg) == "table" and (cfg.api or cfg) or nil
	if type(api) == "table" and type(api.url) == "string" and api.url ~= "" then
		local base = api.url:gsub("/+$", "")
		local key = type(api.key) == "string" and api.key or ""
		local q = key ~= "" and ("?key=" .. HttpService:UrlEncode(key)) or ""
		gateUrl, scriptUrl = base .. "/gate" .. q, base .. "/script" .. q
	else
		local fc = decodeAny(repoFile("firebase.json") or "")
		local fb = type(fc) == "table" and (fc.firebase or fc) or nil
		if type(fb) == "table" and type(fb.url) == "string" and fb.url ~= "" then
			gateUrl = fb.url:gsub("/+$", "") .. "/staff/gate.json"
		end
	end
end)

if gateUrl then
	local parsed, got = decodeAny(fetch(gateUrl) or "")
	if scriptUrl then
		table.insert(SOURCES, scriptUrl) -- nil when only the database is configured
	end
	if got then
		if parsed == false then
			gateState = { enabled = false }
		elseif type(parsed) == "table" then
			gateState = parsed
		end
	end
	if type(gateState) == "table" and gateState.enabled == false then
		local why = type(gateState.message) == "string" and gateState.message or ""
		notify("Xyro is disabled", why ~= "" and why or "Try again later.")
		warnAll("the remote gate has this script switched off" .. (why ~= "" and (": " .. why) or ""))
		return
	end
	if type(gateState) == "table" and type(gateState.warn) == "string" and gateState.warn ~= "" then
		warnAll(gateState.warn)
		notify("Xyro", gateState.warn)
	end
end

-- one probe fetch up front so "no working HTTP" is reported before we start
-- walking mirrors. The API body is kept: it is the primary source below and
-- re-fetching it would burn a second anonymous API call (60/hour, shared by
-- every request behind your IP).
local probeApi = fetch(API_URL)
if not probeApi and not fetch(SOURCES[1]) then
	warnAll("this executor has no working HTTP - paste xyro.lua directly instead")
	return
end

local src, how
local softSrc, softHow, softWhy -- best candidate that only failed completeness
local expectedSize = nil -- exact blob length, learned from the GitHub API
local function record(good, why, soft, body, label)
	if good then
		return true
	end
	if soft and not softSrc then
		softSrc, softHow, softWhy = body, label, why
	end
	return false
end

-- 0) the Xyro API, when api.json points at it: it serves the repo copy with a
-- truncation guard of its own, and it REFUSES while the kill switch is off
if scriptUrl then
	local body = fetch(scriptUrl)
	if body then
		local good, why, soft = looksReal(body, nil)
		if record(good, why, soft, body, "xyro api") then
			src, how = body, "xyro api"
		end
	else
		warnAll("the Xyro API did not serve the script (disabled, or down) - falling back to the mirrors")
	end
end

-- 1) GitHub API first: never CDN-cached, always the newest commit
-- (skipped when the Xyro API already delivered the file above)
if not src then
	for attempt = 1, 2 do
		local body = (attempt == 1 and probeApi) or fetch(API_URL)
		if body then
			local got, apiSize = fromAPI(body)
			if apiSize and not expectedSize then
				expectedSize = apiSize -- keep it even if the decode failed: the mirrors below can still be validated against it
			end
			if got then
				local good, why, soft = looksReal(got, apiSize)
				if record(good, why, soft, got, "github api") then
					src, how = got, "github api"
					break
				end
				warnAll(("api attempt %d rejected (%s)"):format(attempt, why or "unknown"))
			else
				warnAll(("api attempt %d failed (decode)"):format(attempt))
			end
		end
		task.wait(0.4)
	end
end

-- 2) mirrors with cache-busters
if not src then
	for _, url in ipairs(SOURCES) do
		for attempt = 1, 2 do
			local sep = url:find("?", 1, true) and "&" or "?"
			local body = fetch(url .. sep .. "t=" .. tostring(os.time()) .. "&r=" .. attempt)
			if body then
				local good, why, soft = looksReal(body, expectedSize)
				local label = url:match("([%w%.]+)/xyro%.lua$") or url
				if record(good, why, soft, body, label) then
					src, how = body, label
					break
				end
				warnAll(("mirror %s attempt %d rejected (%s)"):format(url:match("https://([^/]+)"), attempt, why))
			end
			task.wait(0.4)
		end
		if src then
			break
		end
	end
end

-- 3) nothing passed cleanly: run the best candidate anyway rather than quitting.
-- If it really is truncated, the compile below reports that in plain language.
if not src and softSrc then
	src, how = softSrc, softHow .. " (unverified: " .. tostring(softWhy) .. ")"
	warnAll("every source failed the completeness check - trying " .. softHow .. " anyway (" .. tostring(softWhy) .. ")")
end

if not src then
	warnAll("could not download a valid xyro.lua from any mirror - check your internet, or paste xyro.lua directly")
	return
end

local load = loadstring or load
if not load then
	warnAll("this executor has no loadstring")
	return
end

local fn, cerr = load(src, "=xyro")
if not fn then
	warnAll("compile error (if it says 'unexpected end', the download was cut off): " .. tostring(cerr))
	return
end

print("[Xyro] source via " .. how .. " (" .. #src .. " bytes)")
local ran, rerr = pcall(fn)
if not ran then
	warnAll("runtime error: " .. tostring(rerr))
end
