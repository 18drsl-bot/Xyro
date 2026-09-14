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
local MIN_SIZE = 100000 -- xyro.lua is ~260KB; anything smaller is truncated
local MARKERS = { "Xyro", "H.Nametags", "RenderStepped" } -- must all appear in a real build

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

-- decode the GitHub contents-API JSON into raw source
local function fromAPI(jsonBody)
	local HttpService = game:GetService("HttpService")
	local ok, data = pcall(function()
		return HttpService:JSONDecode(jsonBody)
	end)
	if not (ok and type(data) == "table" and type(data.content) == "string" and #data.content > 1000) then
		return nil
	end
	local b64 = data.content:gsub("\n", "")
	local src = base64decode(b64)
	if type(src) == "string" then
		return src
	end
	return nil
end

local function looksReal(src)
	if #src < MIN_SIZE then
		return false, ("too small (%d bytes)"):format(#src)
	end
	for _, m in ipairs(MARKERS) do
		if not src:find(m, 1, true) then
			return false, ("missing marker %q"):format(m)
		end
	end
	local tail = src:sub(-400):gsub("%s+", "")
	if not tail:match("endend$") then
		return false, "tail is wrong (truncated?)"
	end
	return true
end

if not fetch(API_URL) and not fetch(SOURCES[1]) then
	warnAll("this executor has no working HTTP - paste xyro.lua directly instead")
	return
end

local src, how
-- 1) GitHub API first: never CDN-cached, always the newest commit
do
	for attempt = 1, 2 do
		local body = fetch(API_URL)
		if body then
			local got = fromAPI(body)
			local good, why = got and looksReal(got) or false, got and select(2, looksReal(got))
			if got and good then
				src, how = got, "github api"
				break
			end
			warnAll(("api attempt %d failed (%s)"):format(attempt, why or "decode failed"))
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
				local good, why = looksReal(body)
				if good then
					src, how = body, url:match("([%w%.]+)/xyro%.lua$") or url
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
