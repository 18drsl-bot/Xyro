--[[
	Xyro - loader
	Fetches xyro.lua from the public repo over a plain raw URL - no tokens,
	no auth. Reports errors instead of failing silently.

	Run it with:
		loadstring(game:HttpGet("https://raw.githubusercontent.com/vertxxy-1/Xyro/main/loadstring.lua"))()
]]

local RAW_URL = "https://raw.githubusercontent.com/vertxxy-1/Xyro/main/xyro.lua"

local function warnAll(msg)
	warn("[Xyro] " .. tostring(msg))
end

if not game.HttpGet then
	warnAll("this executor has no HttpGet - paste xyro.lua directly instead")
	return
end

local src
local ok, err = pcall(function()
	src = game:HttpGet(RAW_URL .. "?t=" .. tostring(os.time()))
end)
if not ok or type(src) ~= "string" or #src == 0 then
	warnAll("failed to fetch script: " .. tostring(err or "empty response"))
	return
end

local load = loadstring or load
if not load then
	warnAll("this executor has no loadstring")
	return
end

local fn, cerr = load(src, "=xyro")
if not fn then
	warnAll("compile error: " .. tostring(cerr))
	return
end

local ran, rerr = pcall(fn)
if not ran then
	warnAll("runtime error: " .. tostring(rerr))
end
