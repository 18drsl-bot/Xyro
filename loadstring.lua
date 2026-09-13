--[[
	Xyro - loader
	Fetches xyro.lua from the public repo over a plain raw URL - no tokens,
	no auth. Verifies the download (truncation produces exactly the
	"empty window" bug), retries, and reports errors instead of failing
	silently.

	Run it with:
		loadstring(game:HttpGet("https://raw.githubusercontent.com/vertxxy-1/Xyro/main/loadstring.lua"))()
]]

local RAW_URL = "https://raw.githubusercontent.com/vertxxy-1/Xyro/main/xyro.lua"
local MIN_SIZE = 100000 -- xyro.lua is ~260KB; anything smaller is a truncated download

local function warnAll(msg)
	warn("[Xyro] " .. tostring(msg))
end

if not game.HttpGet then
	warnAll("this executor has no HttpGet - paste xyro.lua directly instead")
	return
end

local src
for attempt = 1, 3 do
	local ok, got = pcall(function()
		return game:HttpGet(RAW_URL .. "?t=" .. tostring(os.time()) .. "&r=" .. attempt, true)
	end)
	if ok and type(got) == "string" and #got >= MIN_SIZE then
		src = got
		break
	end
	warnAll(("download attempt %d/3 failed (%s) - retrying..."):format(
		attempt,
		not ok and tostring(got) or ("got " .. #got .. " bytes, expected ~260000")
	))
	task.wait(0.5)
end

if not src then
	warnAll("could not download xyro.lua after 3 tries - check your internet, or paste xyro.lua directly")
	return
end

-- integrity: the script's final tokens are "end\n" closing the outer do-block
local tail = src:sub(-400):gsub("%s+", "")
if not tail:match("endend$") then
	warnAll(("download looks truncated (%d bytes, tail is wrong) - NOT running it"):format(#src))
	return
end

local load = loadstring or load
if not load then
	warnAll("this executor has no loadstring")
	return
end

local fn, cerr = load(src, "=xyro")
if not fn then
	warnAll("compile error (if this says 'unexpected end', the download was cut off): " .. tostring(cerr))
	return
end

local ran, rerr = pcall(fn)
if not ran then
	warnAll("runtime error: " .. tostring(rerr))
end
