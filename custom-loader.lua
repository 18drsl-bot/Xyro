--[[
	Xyro - YOUR OWN loader (a template you can brand and hand out)

	Five jobs, in this order, and the whole file is short enough to read:

	  1. ASK PERMISSION    read the kill switch before downloading anything, so a
	                       shutdown costs no bandwidth and no waiting
	  2. DOWNLOAD          through the Xyro API only - this loader deliberately
	                       never touches GitHub, so there is nothing to block,
	                       nothing to rate-limit and nothing to cache
	  3. VALIDATE          never run a truncated file: size + markers + compile
	  4. RUN               inside a pcall, so an error cannot take the executor down
	  5. TELL THE USER     a notification instead of silence when anything fails

	Hand it out two ways:

	  * the one-liner, served by your own API (nothing to edit, no key in the URL,
	    and the API rewrites the two lines below so it always matches itself):

	      loadstring(game:HttpGet("https://xyro-api.xyroapi.workers.dev/loader"))()

	  * or paste this file straight into an executor, in which case set API and
	    KEY by hand from api.json.

	Serving it from the API is the stronger option: the URL never changes, and
	the gate answers 403 to it, so a shutdown stops the loader before it is even
	delivered. A client-side check alone could never promise that.

	NEVER put the owner key (XYRO_ADMIN_KEY) in a loader. The key here is the
	public CLIENT key from api.json - it reads, heartbeats and downloads,
	nothing more.
]]

-- These two lines are rewritten by /loader from the request it is served on, so
-- a rotation of XYRO_KEY cannot break a loader anyone already has.
local API = "https://xyro-api.xyroapi.workers.dev"
local KEY = "xyroontop"

local BRAND = "Xyro" -- every message below is signed with this
local RETRIES = 2 -- attempts against the API before giving up
local MIN_BYTES = 100000 -- xyro.lua is ~440KB; anything this small is cut off
local MARKERS = { "H.Nametags", "RenderStepped" } -- must both be present

-- --------------------------------------------------------------- plumbing

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

-- ----------------------------------------------------------------- 1. gate

-- The switch first: one tiny request, and it is the whole reason to load through
-- the API - the answer comes from the server, not from this file.
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

-- ------------------------------------------------------------- 2. download

-- The API answers 403 while the switch is off, and it is the only source this
-- loader has: if it is unreachable the client has nowhere else to go, so the
-- attempt is simply retried rather than failing on the first blip.
local src, attempts = nil, 0
while not src and attempts < RETRIES do
	attempts = attempts + 1
	src = get(query(API .. "/script") .. (attempts > 1 and "&fresh=1" or ""))
	if not src and attempts < RETRIES then
		task.wait(1)
	end
end
if not src then
	tell("Could not reach the script service (" .. attempts .. " tries). Try again in a moment.")
	return
end

-- -------------------------------------------------------------- 3. validate

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

-- ------------------------------------------------------------------- 4. run

print("[" .. BRAND .. "] " .. #src .. " bytes via " .. API)
local ran, runtimeErr = pcall(fn)

-- ---------------------------------------------------------------- 5. report

if not ran then
	tell("Runtime error: " .. tostring(runtimeErr))
end
