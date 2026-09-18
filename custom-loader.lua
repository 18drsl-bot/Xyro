--[[
	Xyro - YOUR OWN loader (a template you can brand and hand out)

	This is the same five jobs the repo's loadstring.lua does, written short
	enough to read in one sitting. Copy it, change the four values below, and it
	is yours:

	  1. ASK PERMISSION    read the kill switch (staff/gate) before downloading
	                       anything, so a shutdown costs no bandwidth
	  2. DOWNLOAD          prefer the Xyro API (never CDN-cached, and it refuses
	                       while the switch is off), then fall back to the repo
	                       mirrors so an API outage is not fatal
	  3. VALIDATE          never run a truncated file: size + markers + compile
	  4. RUN               in a pcall, so an error cannot take the executor down
	  5. TELL THE USER     a notification instead of silence when anything fails

	Handing it out two ways:
	  * paste it directly, or
	  * host it (repo file, or a /loader route on the API) and share the line:
	    loadstring(game:HttpGet("<its url>"))()

	Serving it from your own API is the stronger option: the URL never changes
	(so nobody has to re-paste a new one when you edit the loader), and the gate
	can answer 403 to it, which no client-side check can guarantee.

	NEVER put the owner key (XYRO_ADMIN_KEY) in a loader. The key below is the
	public CLIENT key from api.json - it reads and heartbeats, nothing more.
]]

local BRAND = "Xyro" -- every message below is signed with this
local API = "https://xyro-api.xyroapi.workers.dev" -- api.url from api.json
local KEY = "xyroontop" -- api.key from api.json (public by design)
local FALLBACK = "https://raw.githubusercontent.com/vertxxy-1/Xyro/main/xyro.lua"
local MIN_BYTES = 100000 -- xyro.lua is ~440KB; anything this small is cut off
local MARKERS = { "H.Nametags", "RenderStepped" } -- must both be present

-- plain HTTP: game:HttpGet when it exists, request() as the fallback. Returns
-- nil instead of throwing, so every caller can decide what to do about it.
local function get(url)
	local ok, body = pcall(function()
		return game:HttpGet(url, true)
	end)
	if ok and type(body) == "string" and #body > 0 then
		return body
	end
	local req = (syn and syn.request) or http_request or request
	if req then
		local ok2, resp = pcall(req, { Url = url, Method = "GET" })
		if ok2 and resp and type(resp.Body) == "string" and #resp.Body > 0 then
			return resp.Body
		end
	end
	return nil
end

local function tell(text)
	pcall(function()
		game:GetService("StarterGui"):SetCore("SendNotification", {
			Title = BRAND,
			Text = tostring(text),
			Duration = 8,
		})
	end)
	warn("[" .. BRAND .. "] " .. tostring(text))
end

local function decode(text)
	local ok, data = pcall(function()
		return game:GetService("HttpService"):JSONDecode(text)
	end)
	return ok and data or nil
end

local function query(url)
	if KEY == "" then
		return url
	end
	return url .. (url:find("?", 1, true) and "&" or "?") .. "key=" .. game:GetService("HttpService"):UrlEncode(KEY)
end

-- 1. the switch first. One tiny request, and it is the whole point of routing
-- through the API: the answer can come from the server, not from this file.
if API ~= "" then
	local gate = decode(get(query(API .. "/gate")) or "")
	if type(gate) == "table" and gate.enabled == false then
		tell(gate.message ~= "" and gate.message or "Temporarily unavailable - try again later.")
		return
	end
	if type(gate) == "table" and type(gate.warn) == "string" and gate.warn ~= "" then
		tell(gate.warn)
	end
end

-- 2. download. API first (it 403s while the switch is off), mirrors second.
local src, via = nil, ""
if API ~= "" then
	src = get(query(API .. "/script"))
	if src then
		via = "api"
	end
end
if not src then
	src = get(FALLBACK .. (FALLBACK:find("?", 1, true) and "&" or "?") .. "t=" .. tostring(os.time()))
	via = "github"
end
if not src then
	tell("Could not download the script - check your connection, or paste xyro.lua directly.")
	return
end

-- 3. validate before trusting it
if #src < MIN_BYTES then
	tell("The download looks cut off (" .. #src .. " bytes). Not running it.")
	return
end
for _, marker in ipairs(MARKERS) do
	if not src:find(marker, 1, true) then
		tell("The download is missing " .. marker .. " - it is not a real build. Not running it.")
		return
	end
end

local chunk = loadstring or load
if type(chunk) ~= "function" then
	tell("This executor has no loadstring.")
	return
end
local fn, err = chunk(src, "=" .. BRAND:lower())
if not fn then
	tell("Compile error (a cut-off download looks like this): " .. tostring(err))
	return
end

-- 4. run it
print("[" .. BRAND .. "] source via " .. via .. " (" .. #src .. " bytes)")
local ran, runtimeErr = pcall(fn)

-- 5. say what happened
if not ran then
	tell("Runtime error: " .. tostring(runtimeErr))
end
