local H = {}

do
local Players = game:GetService("Players")
local RunService = game:GetService("RunService")
local UIS = game:GetService("UserInputService")
local TweenService = game:GetService("TweenService")
local HttpService = game:GetService("HttpService")

local function checkForFile(file, text)
	if not (isfile and writefile) then
		return false
	end

	if isfile(file) then
		return true
	end

	return pcall(writefile, file, text)
end

if makefolder and isfolder and not isfolder("me") then
	pcall(makefolder, "me")
end

if readfile and checkForFile("Xyro/prefix.txt", "!") then
	local ok, value = pcall(readfile, "Xyro/prefix.txt")
	_G.prefix = ok and (value ~= "" and value or "!") or "!"
else
	_G.prefix = "!"
end

local player = Players.LocalPlayer
_G.CFrameSpeed = _G.CFrameSpeed or 0.09

if _G.ScriptHubCleanup then
	pcall(_G.ScriptHubCleanup)
end

-- kill leftovers from a previous execution: the staff panel lives in its
-- own protected ScreenGui (CoreGui/gethui, ResetOnSpawn=false) that no
-- other cleanup touches, so without this a re-execute leaves the OLD panel
-- on screen and mounts the new one behind it
pcall(function()
	local host = (gethui and gethui()) or game:GetService("Players").LocalPlayer:FindFirstChildOfClass("PlayerGui") or game:GetService("CoreGui")
	for _, name in { "XyroStaffPanelGui", "XyroStaffBlind" } do
		local stale = host:FindFirstChild(name)
		if stale then
			stale:Destroy()
		end
	end
end)

local conns = {}
local function connect(sig, fn)
	local c = sig:Connect(fn)
	conns[#conns + 1] = c
	return c
end

local VERSION = "Unknown"

local versionUrl = "https://raw.githubusercontent.com/vertxxy-1/Xyro/main/version.txt?t=" .. tostring(os.time())
local versionOk, versionBody = pcall(function()
	return game:HttpGet(versionUrl, true)
end)

if versionOk and type(versionBody) == "string" and versionBody ~= "" then
	VERSION = versionBody:gsub("%s+", "")
else
	local req = (syn and syn.request) or http_request or request
	if req then
		local ok, response = pcall(req, {
			Url = versionUrl,
			Method = "GET",
		})
		if ok and response and type(response.Body) == "string" and response.Body ~= "" then
			VERSION = response.Body:gsub("%s+", "")
		end
	end
end

print("Loaded Version:", VERSION)

local waitingForToggleKey = false
H.keyChangeCooldown = false

H.keyRefreshers = {}
H.refreshKeys = function()
	for _, f in ipairs(H.keyRefreshers) do
		pcall(f)
	end
end

H.keyFor = function(action)
	for keyName, boundCmd in pairs(H.Binds or {}) do
		if boundCmd == action then
			return keyName
		end
	end
	return "-"
end

-- "Custom gravity [G]" normally; when no key is bound, no dangling brackets
H.keySuffix = function(action)
	local k = H.keyFor(action)
	if k == "-" then
		return ""
	end
	return " [" .. k .. "]"
end

H.setBind = function(action, keyName)
	for k, v in pairs(H.Binds) do
		if v == action then
			H.Binds[k] = nil
		end
	end
	if keyName then
		H.Binds[keyName] = action
	end
	H.refreshKeys()
end

local COL = {
	-- carbon shell + near-black content card, Xyro-brand periwinkle accent
	-- (same #6C80FF as the nametag pill borders / tag editor)
	bg = Color3.fromRGB(20, 22, 31), -- #14161F window shell
	element = Color3.fromRGB(31, 34, 47), -- #1F222F rows / pills
	stroke = Color3.fromRGB(44, 48, 66), -- #2C3042 hairlines & outlines
	accent = Color3.fromRGB(108, 128, 255), -- #6C80FF Xyro brand
	on = Color3.fromRGB(235, 76, 76),
	text = Color3.fromRGB(240, 242, 250), -- #F0F2FA
	sub = Color3.fromRGB(148, 155, 178), -- #949BB2 secondary text
	off = Color3.fromRGB(52, 56, 74), -- #34384A disabled / hover fill
	contentBg = Color3.fromRGB(11, 12, 17), -- always re-derived from bg in applyTheme
}

local ESPCOL = {
	box = Color3.fromRGB(230, 68, 68),
	name = Color3.fromRGB(255, 255, 255),
	skeleton = Color3.fromRGB(230, 68, 68),
	tracer = Color3.fromRGB(230, 68, 68),
	chams = Color3.fromRGB(230, 68, 68),
}

local ClickTp = {
	enabled = false,
	modifier = Enum.KeyCode.LeftControl,
	key = Enum.KeyCode.R,
}

local Binds = {
	K = "menu",
	C = "cframe",
	G = "gravity",
	X = "fly",
}

local themedRefs = {}
local themeRefreshers = {}

local function make(class, props, parent)
	local o = Instance.new(class)
	for k, v in pairs(props) do
		o[k] = v
		if typeof(v) == "Color3" then
			for role, c in pairs(COL) do
				if c == v then
					themedRefs[#themedRefs + 1] = { obj = o, prop = k, role = role }
					break
				end
			end
		end
	end
	o.Parent = parent
	return o
end

local function round(o, r)
	make("UICorner", { CornerRadius = UDim.new(0, r) }, o)
end

local function tween(o, props)
	TweenService:Create(o, TweenInfo.new(0.15, Enum.EasingStyle.Quad, Enum.EasingDirection.Out), props):Play()
end

local function tweenE(o, time, style, dir, props)
	TweenService:Create(o, TweenInfo.new(time, style, dir), props):Play()
end

H.animate = function(btn)
	if not (btn:IsA("TextButton") or btn:IsA("ImageButton")) then
		return btn
	end
	if btn:FindFirstChild("HoverGlow") or btn:GetAttribute("NoAnim") then
		return btn
	end
	local glow = make("UIStroke", {
		Name = "HoverGlow",
		Color = Color3.new(1, 1, 1),
		Thickness = 0,
		Transparency = 0.35,
		ApplyStrokeMode = Enum.ApplyStrokeMode.Border,
	}, btn)
	local hovering = false
	connect(btn.MouseEnter, function()
		hovering = true
		tween(glow, { Thickness = 1.5 })
	end)
	connect(btn.MouseLeave, function()
		hovering = false
		tween(glow, { Thickness = 0 })
	end)
	connect(btn.MouseButton1Down, function()
		tween(glow, { Thickness = 3 })
	end)
	connect(btn.MouseButton1Up, function()
		tween(glow, { Thickness = hovering and 1.5 or 0 })
	end)
	return btn
end

H.animateAll = function(root)
	for _, b in ipairs(root:GetDescendants()) do
		if b:IsA("TextButton") or b:IsA("ImageButton") then
			H.animate(b)
		end
	end
end

local function shiftedPos(rest, w, h, base, s)
	local k = (base - s) * 0.5
	return UDim2.new(rest.X.Scale, rest.X.Offset + w * k, rest.Y.Scale, rest.Y.Offset + h * k)
end

H.popIn = function(frame)
	local sc = frame:FindFirstChildOfClass("UIScale")
	if not sc then
		return
	end
	local base = H.scales[frame.Name] or 1
	local rest = frame.Position
	local w, h = frame.Size.X.Offset, frame.Size.Y.Offset
	local startS = base * 0.7
	sc.Scale = startS
	frame.Position = shiftedPos(rest, w, h, base, startS)
	local info = TweenInfo.new(0.22, Enum.EasingStyle.Back, Enum.EasingDirection.Out)
	TweenService:Create(sc, info, { Scale = base }):Play()
	TweenService:Create(frame, info, { Position = rest }):Play()
end

H.popOut = function(frame, done)
	if frame:GetAttribute("Closing") then
		return
	end
	frame:SetAttribute("Closing", true)
	local sc = frame:FindFirstChildOfClass("UIScale")
	if not sc then
		frame:SetAttribute("Closing", false)
		if done then
			done()
		end
		return
	end
	local base = H.scales[frame.Name] or sc.Scale or 1
	local rest = frame.Position
	local w, h = frame.Size.X.Offset, frame.Size.Y.Offset
	local target = base * 0.01
	local info = TweenInfo.new(0.16, Enum.EasingStyle.Quad, Enum.EasingDirection.In)
	TweenService:Create(sc, info, { Scale = target }):Play()
	local tw = TweenService:Create(frame, info, { Position = shiftedPos(rest, w, h, base, target) })
	tw:Play()
	tw.Completed:Connect(function()
		frame.Position = rest
		frame:SetAttribute("Closing", false)
		if done then
			done()
		end
	end)
end

local guiHost = player:WaitForChild("PlayerGui")
do
	local getHidden = gethui or get_hidden_gui
	local ok, hidden = false, nil
	if getHidden then
		ok, hidden = pcall(getHidden)
	end
	if ok and typeof(hidden) == "Instance" then
		guiHost = hidden
	elseif pcall(function()
		local probe = Instance.new("Folder")
		probe.Parent = game:GetService("CoreGui")
		probe:Destroy()
	end) then
		guiHost = game:GetService("CoreGui")
	end
end

local DISPLAY_ORDER = 2147483647

local gui = make("ScreenGui", {
	Name = "ScriptHub",
	ResetOnSpawn = false,
	DisplayOrder = DISPLAY_ORDER,
}, guiHost)

pcall(function()
	if syn and syn.protect_gui then
		syn.protect_gui(gui)
	end
end)

local clickSound = make("Sound", { SoundId = "rbxassetid://88442833509532", Volume = 0.6 }, gui)
local function click()
	clickSound:Play()
end

local main = make("Frame", {
	Size = UDim2.new(0, 540, 0, 340), -- wide shell: pill sidebar left, dark content card right
	Position = UDim2.new(0, 16, 0.5, -170),
	BackgroundColor3 = COL.bg,
	BorderSizePixel = 0,
	Active = true,
}, gui)
round(main, 14)
-- Rayfield-depth window outline: tinted hairline instead of pure stroke-gray
make("UIStroke", { Color = COL.stroke, Thickness = 1, Transparency = 0.15 }, main)

-- faint brand glow down the shell (barely-there vertical depth; the dark
-- theme already carries contrast, this just stops it feeling flat)
make("UIGradient", {
	Color = ColorSequence.new(Color3.fromRGB(255, 255, 255), Color3.fromRGB(219, 222, 236)),
	Rotation = 90,
}, main)

-- dark content card inset on the right (pages render on top of this)
local contentCard = make("Frame", {
	Name = "ContentCard",
	Position = UDim2.new(1, -352, 0, 10),
	Size = UDim2.new(0, 342, 1, -20),
	BackgroundColor3 = COL.bg,
	BackgroundTransparency = 0,
	BorderSizePixel = 0,
}, main)
round(contentCard, 10)
contentCard.ZIndex = 0
-- its color tracks the shell via the theme system, with a hairline outline
-- so the card reads as a raised surface against the shell
local contentStroke = make("UIStroke", { Color = COL.stroke, Thickness = 1, Transparency = 0.3 }, contentCard)
themeRefreshers[#themeRefreshers + 1] = function()
	if contentCard then
		contentCard.BackgroundColor3 = COL.contentBg
	end
	if contentStroke then
		contentStroke.Color = COL.stroke
	end
end
contentCard.BackgroundColor3 = COL.contentBg

H.scales = {}
local liveScales = {}

H.setScale = function(name, v)
	v = math.clamp(tonumber(v) or 1, 0.6, 2.5)
	H.scales[name] = v
	local s = liveScales[name]
	if s and s.Parent then
		s.Scale = v
	end
	return v
end

H.makeResizable = function(frame, baseW, baseH)
	local name = frame.Name
	local scale = Instance.new("UIScale")
	scale.Scale = H.scales[name] or 1
	scale.Parent = frame
	liveScales[name] = scale

	local grip = make("Frame", {
		Name = "ResizeGrip",
		Size = UDim2.new(0, 14, 0, 14),
		Position = UDim2.new(1, -15, 1, -15),
		BackgroundTransparency = 1,
		Active = true,
		ZIndex = 50,
	}, frame)

	for _, d in ipairs({ { 9, 3 }, { 9, 6 }, { 6, 6 }, { 9, 9 }, { 6, 9 }, { 3, 9 } }) do
		make("Frame", {
			Size = UDim2.new(0, 2, 0, 2),
			Position = UDim2.new(0, d[1], 0, d[2]),
			BackgroundColor3 = COL.sub,
			BorderSizePixel = 0,
			ZIndex = 51,
		}, grip)
	end

	local dragging, startPos, startScale
	connect(grip.InputBegan, function(i)
		if i.UserInputType == Enum.UserInputType.MouseButton1 then
			dragging, startPos, startScale = true, i.Position, scale.Scale
		end
	end)
	connect(UIS.InputChanged, function(i)
		if not dragging or i.UserInputType ~= Enum.UserInputType.MouseMovement then
			return
		end
		local d = i.Position - startPos

		H.setScale(name, startScale + ((d.X / baseW) + (d.Y / baseH)) / 2)
	end)
	connect(UIS.InputEnded, function(i)
		if i.UserInputType == Enum.UserInputType.MouseButton1 and dragging then
			dragging = false
			if H.saveConfig then
				pcall(H.saveConfig)
			end
		end
	end)
	return scale
end

H.scaleOf = function(obj)

	local s = 1
	local o = obj
	while o do
		for _, ch in ipairs(o:GetChildren()) do
			if ch:IsA("UIScale") then
				s *= ch.Scale
			end
		end
		o = o.Parent
	end
	return s
end

main.Name = "Main"
H.makeResizable(main, 540, 340)

H.makeDraggable = function(frame, handle, conn)
	handle = handle or frame
	conn = conn or connect
	handle.Active = true
	local dragging, startPos, framePos

	local function isDrag(i)
		return i.UserInputType == Enum.UserInputType.MouseButton1
			or i.UserInputType == Enum.UserInputType.Touch
	end

	conn(handle.InputBegan, function(i)
		if isDrag(i) then
			dragging, startPos, framePos = true, i.Position, frame.Position
		end
	end)
	conn(UIS.InputChanged, function(i)
		if not dragging then
			return
		end
		if i.UserInputType == Enum.UserInputType.MouseMovement
			or i.UserInputType == Enum.UserInputType.Touch
		then
			local d = i.Position - startPos
			frame.Position = UDim2.new(
				framePos.X.Scale,
				framePos.X.Offset + d.X,
				framePos.Y.Scale,
				framePos.Y.Offset + d.Y
			)
		end
	end)
	conn(UIS.InputEnded, function(i)
		if isDrag(i) then
			dragging = false
		end
	end)
	return frame
end

H.chrome = function(frame, opts)
	opts = opts or {}
	local headerH = opts.header or 38

	local closeBtn = make("TextButton", {
		Name = "Close",
		Size = UDim2.new(0, 18, 0, 18),
		Position = UDim2.new(1, -27, 0, 9),
		BackgroundColor3 = Color3.fromRGB(225, 65, 65),
		Text = "",
		AutoButtonColor = false,
		BorderSizePixel = 0,
		ZIndex = 10,
	}, frame)
	round(closeBtn, 9)
	H.animate(closeBtn)
	connect(closeBtn.MouseButton1Click, function()
		click()
		H.popOut(frame, function()
			if opts.onClose then
				opts.onClose()
			else
				frame:Destroy()
			end
		end)
	end)

	local minBtn
	if opts.minimize ~= false then
		minBtn = make("TextButton", {
			Name = "Minimize",
			Size = UDim2.new(0, 18, 0, 18),
			Position = UDim2.new(1, -49, 0, 9),
			BackgroundColor3 = Color3.fromRGB(235, 190, 45),
			Text = "",
			AutoButtonColor = false,
			BorderSizePixel = 0,
			ZIndex = 10,
		}, frame)
		round(minBtn, 9)
		H.animate(minBtn)

		local collapsed, saved, hidden = false, nil, {}
		connect(minBtn.MouseButton1Click, function()
			click()
			collapsed = not collapsed
			if collapsed then
				saved = frame.Size
				hidden = {}

				for _, ch in ipairs(frame:GetChildren()) do
					if ch ~= minBtn and ch ~= closeBtn and ch ~= opts.title
						and ch:IsA("GuiObject") and ch.Visible
					then
						hidden[#hidden + 1] = ch
						ch.Visible = false
					end
				end
				frame.Size = UDim2.new(frame.Size.X.Scale, frame.Size.X.Offset, 0, headerH)
			else
				for _, ch in ipairs(hidden) do
					ch.Visible = true
				end
				hidden = {}
				frame.Size = saved
			end
		end)
	end

	return minBtn, closeBtn
end

local titleBar = make("Frame", { Size = UDim2.new(1, -50, 0, 40), BackgroundTransparency = 1 }, main) -- full-width drag handle (clears the search button)

round(make("Frame", {
	Size = UDim2.new(0, 7, 0, 7),
	Position = UDim2.new(0, 13, 0, 15),
	BackgroundColor3 = COL.accent,
	BorderSizePixel = 0,
}, titleBar), 4)

make("TextLabel", {
	Size = UDim2.new(1, -40, 1, 0),
	Position = UDim2.new(0, 30, 0, 0),
	BackgroundTransparency = 1,
	Font = Enum.Font.GothamBold,
	TextSize = 17,
	TextColor3 = COL.text,
	Text = "Xyro",
	TextXAlignment = Enum.TextXAlignment.Left,
}, titleBar)

-- circular search button, top-right of the shell like the reference UI:
-- opens the command list (the built-in "cmds"-style help window)
-- paintbrush = Themes: opens Settings scrolled to the Themes section
local searchBtn = make("TextButton", {
	Size = UDim2.new(0, 34, 0, 34),
	Position = UDim2.new(1, -44, 0, 3),
	BackgroundTransparency = 1, -- no box behind the brush
	Text = "🎨",
	TextSize = 20,
	Font = Enum.Font.GothamBold,
	TextColor3 = COL.text,
	AutoButtonColor = false,
	BorderSizePixel = 0,
}, main)
connect(searchBtn.MouseButton1Click, function()
	click()
	if H.openThemes then
		H.openThemes()
	end
end)

local keyChip = make("TextButton", {
	Size = UDim2.new(0, 28, 0, 20),
	Position = UDim2.new(0, 158, 0, 10), -- under the title, right edge of the sidebar column
	BackgroundColor3 = COL.element, -- raised keycap chip on the dark shell
	Font = Enum.Font.Gotham,
	TextSize = 11,
	TextColor3 = COL.sub,
	Text = "K",
	BorderSizePixel = 0,
	AutoButtonColor = false,
}, titleBar)

round(keyChip, 6)
make("UIStroke", { Color = COL.off, Thickness = 1, Transparency = 0.25 }, keyChip)

H.keyRefreshers[#H.keyRefreshers + 1] = function()
	if not waitingForToggleKey then
		keyChip.Text = H.keyFor("menu")
	end
end

connect(keyChip.MouseButton1Click, function()
	if waitingForToggleKey then
		return
	end

	waitingForToggleKey = true
	keyChip.Text = "..."

	local bind
	bind = UIS.InputBegan:Connect(function(input, processed)
		if processed then
			return
		end

		if input.UserInputType == Enum.UserInputType.Keyboard then
			H.setBind("menu", input.KeyCode.Name)

			waitingForToggleKey = false
			H.keyChangeCooldown = true

			bind:Disconnect()

			task.delay(0.25, function()
				H.keyChangeCooldown = false
			end)
		end
	end)
end)

make("Frame", {
	Size = UDim2.new(0, 176, 0, 1),
	Position = UDim2.new(0, 7, 0, 44),
	BackgroundColor3 = COL.stroke,
	BorderSizePixel = 0,
}, main)

local pages, tabs = {}, {}
local selectTab
local currentTab

local TAB_WIDTH = 178

-- vertical pill sidebar on the left (each tab a full-width pill)
local tabStrip = make("ScrollingFrame", {
	Size = UDim2.new(0, 188, 1, -124),
	Position = UDim2.new(0, 7, 0, 52),
	BackgroundTransparency = 1,
	BorderSizePixel = 0,
	ScrollBarThickness = 2,
	ScrollBarImageColor3 = COL.off,
	ScrollingDirection = Enum.ScrollingDirection.Y,
	CanvasSize = UDim2.new(0, 0, 0, 0),
}, main)

local tabLayout = make("UIListLayout", {
	FillDirection = Enum.FillDirection.Vertical,
	Padding = UDim.new(0, 4),
	SortOrder = Enum.SortOrder.LayoutOrder,
}, tabStrip)
make("UIPadding", { PaddingLeft = UDim.new(0, 2), PaddingRight = UDim.new(0, 4), PaddingTop = UDim.new(0, 2) }, tabStrip)

local tabOrder = 0

local function makeTab(name, onClick, display)
	tabOrder += 1
	local btn = make("TextButton", {
		Size = UDim2.new(0, TAB_WIDTH, 0, 30),
		BackgroundColor3 = COL.element,
		Font = Enum.Font.GothamMedium,
		TextSize = 12,
		TextColor3 = COL.sub,
		Text = display or name,
		TextXAlignment = Enum.TextXAlignment.Left,
		AutoButtonColor = false,
		BorderSizePixel = 0,
		LayoutOrder = tabOrder,
	}, tabStrip)
	make("UIPadding", { PaddingLeft = UDim.new(0, 12) }, btn)
	round(btn, 9)
	btn:SetAttribute("NoAnim", true)
	-- quiet hairline under idle pills so the column reads as structured
	-- rows instead of floating bubbles (active tab keeps its accent fill)
	make("UIStroke", { Color = COL.off, Thickness = 1, Transparency = 0.35 }, btn)

	-- Fluent-style selection notch on the pill's LEFT edge; grows when active.
	-- x = -6 lands just inside the pill's visual edge (UIPadding shifts children,
	-- which is why an inset bar previously collided with the label)
	local underline = make("Frame", {
		Name = "Underline",
		AnchorPoint = Vector2.new(0, 0.5),
		Position = UDim2.new(0, -6, 0.5, 0),
		Size = UDim2.new(0, 3, 0, 0),
		BackgroundColor3 = Color3.new(1, 1, 1),
		BorderSizePixel = 0,
		ZIndex = 2,
	}, btn)
	round(underline, 2)
	local page = make("Frame", {
		Size = UDim2.new(0, 326, 1, -70),
		Position = UDim2.new(0, 200, 0, 44),
		BackgroundTransparency = 1,
		Visible = false,
		ZIndex = 5,
	}, main)
	pages[name], tabs[name] = page, btn

	connect(btn.MouseEnter, function()
		if currentTab ~= name then
			tween(btn, { BackgroundColor3 = COL.off, TextColor3 = COL.text })
			tween(underline, { Size = UDim2.new(0, 3, 0, 10) })
		end
	end)
	connect(btn.MouseLeave, function()
		if currentTab ~= name then
			tween(btn, { BackgroundColor3 = COL.element, TextColor3 = COL.sub })
			tween(underline, { Size = UDim2.new(0, 3, 0, 0) })
		end
	end)

	connect(btn.MouseButton1Click, function()
		click()
		if onClick then
			onClick(name)
		else
			selectTab(name)
		end
	end)
	return page
end

local speedPage = makeTab("Speed") -- gravity controls live on this tab too (no separate Gravity tab)
local espPage = makeTab("ESP")
local hitboxPage = makeTab("Hitbox")
local playerPage = makeTab("Player")
local flyPage = makeTab("Fly")
local movePage = makeTab("Movement")

local world = {}
world.page = makeTab("World")
local toolsPage = makeTab("Tools")

----------------------------------------------------------------------------
-- Staff list (UI admin + nametag verified badge)
--
-- Two sources, merged:
--   1. ADMIN_IDS hardcoded below (always works, no setup)
--   2. a Firebase Realtime Database "staff" node (edit-and-live, no re-push)
--
-- Firebase setup: see FIREBASE.md (or the README "Firebase staff list"
-- section). Staff comes ONLY from the Firebase database (repo firebase.json
-- points at it) - there is no hardcoded admin list anymore. The boot fetch
-- is synchronous so admin-only tabs exist from frame one; re-fetch in
-- game with !staffrefresh. If Firebase is unreachable everyone is a
-- regular member until it comes back (!staffrefresh retries).
----------------------------------------------------------------------------
local ADMIN_IDS = {} -- filled ONLY from Firebase (fbAddIdentity)
local ADMIN_NAMES = {} -- lowercase username -> true (filled from Firebase)

H.HS = game:GetService("HttpService")

-- === EDIT THESE TWO LINES to enable Firebase (OPTIONAL) ===
-- You normally DON'T edit these: the script reads firebase.json in the repo
-- root instead (see fbLoadRepoConfig below). Only set them here to override
-- the repo config, e.g. for a private test database.
H.FIREBASE_URL = "" -- e.g. "https://your-db-default-rtdb.firebaseio.com"
H.FIREBASE_AUTH = "" -- optional: database secret (only if rules require auth)
H.NT_RANKS = H.NT_RANKS or {} -- nametag rank tiers (filled from staff.json "ranks")
-- ===========================================================

-- Repo-hosted Firebase config: firebase.json in the repo root turns the
-- staff list over to Firebase with ZERO script edits:
--   { "firebase": { "url": "https://your-db-default-rtdb.firebaseio.com" } }
-- (optional "auth": "<database secret>" when reads are locked; a bare
-- "https://..." body also works). Fetched once at boot, fresh sources first
-- (GitHub API is never CDN-cached; raw gets a cache-buster). A URL set right
-- here in the script still wins over the repo file.

-- fetch helpers for the repo config (kept separate from the script's own
-- ntHttpGet, which is declared much later in the nametag section)
local function fbHttpGet(url)
	local ok, body = pcall(function()
		return game:HttpGet(url, true)
	end)
	if ok and type(body) == "string" and body ~= "" then
		return body
	end
	local req = (syn and syn.request) or http_request or request
	if req then
		local ok2, resp = pcall(req, { Url = url, Method = "GET" })
		if ok2 and resp and type(resp.Body) == "string" and resp.Body ~= "" then
			return resp.Body
		end
	end
	return nil
end

-- read firebase.json from the repo (GitHub API first - never cached - then
-- raw with a cache-buster, then jsDelivr edge). Returns url + optional auth.
local function fbLoadRepoConfig()
	if H.FIREBASE_URL ~= "" then
		return -- an explicit script-level URL always wins
	end
	local busters = "?t=" .. tostring(os.time())
	local sources = {
		"https://api.github.com/repos/vertxxy-1/Xyro/contents/firebase.json",
		"https://raw.githubusercontent.com/vertxxy-1/Xyro/main/firebase.json" .. busters,
		"https://cdn.jsdelivr.net/gh/vertxxy-1/Xyro@main/firebase.json",
	}
	for _, url in ipairs(sources) do
		local body = fbHttpGet(url)
		if type(body) == "string" and body ~= "" then
			-- GitHub API wraps the file in JSON: pull out the base64 content.
			-- JSON-DECODE the wrapper FIRST (never regex the raw payload): the
			-- API's newlines inside the content string are escaped as literal
			-- backslash-n runs, and 'n' is a legal base64 char - strip-then-decode
			-- silently corrupts the data. Decoding turns those into real newlines
			-- that the base64 cleaners then handle. Same lesson loadstring.lua
			-- already learned.
			local apiMeta = nil
			if body:find('"content"', 1, true) then
				local okA, parsed = pcall(H.HS.JSONDecode, H.HS, body)
				if okA and type(parsed) == "table" and type(parsed.content) == "string" and #parsed.content > 8 then
					apiMeta = parsed
				end
			end
			if apiMeta then
				local b64 = apiMeta.content:gsub("%s", "")
				local decoded = nil
				pcall(function()
					if syn and syn.crypt and syn.crypt.base64decode then
						decoded = syn.crypt.base64decode(b64)
					elseif type(crypt) == "table" and crypt.base64decode then
						decoded = crypt.base64decode(b64)
					else
						decoded = H.HS:Base64Decode(b64)
					end
				end)
				if type(decoded) == "string" and decoded ~= "" then
					body = decoded
				end
			end
			local okJ, data = pcall(H.HS.JSONDecode, H.HS, body)
			if okJ and type(data) == "table" then
				local fb = data.firebase or data -- accept both {"firebase":{...}} and flat
				if type(fb) == "table" and type(fb.url) == "string" and fb.url ~= "" then
					H.FIREBASE_URL = fb.url
					if type(fb.auth) == "string" then
						H.FIREBASE_AUTH = fb.auth
					end
					return
				end
			elseif okJ == false and body:sub(1, 8) == "https://" then
				-- bare URL body: the whole file is just the database URL
				H.FIREBASE_URL = (body:gsub("%s+", ""))
				return
			end
			-- a real firebase.json exists (we fetched a 200): stop after the
			-- first source that answers, even if its JSON was unusable, so a
			-- stale mirror can't be second-guessed by a fresher one
			return
		end
	end
end

local function fbStaffUrl()
	local base = tostring(H.FIREBASE_URL or ""):gsub("/+$", "")
	if base == "" then
		return nil
	end
	return base .. "/staff.json" .. (H.FIREBASE_AUTH ~= "" and ("?auth=" .. H.FIREBASE_AUTH) or "")
end

-- accepts {"ids":{"8579040069":true}, "usernames":{"x9ksa":true}}
-- or flat arrays {"admins":["8579040069","x9ksa"]} — values of false remove
-- (additive: entries deleted from Firebase stay admin until script reload).
local function fbAddIdentity(raw)
	if type(raw) ~= "string" and type(raw) ~= "number" then
		return
	end
	local s = tostring(raw)
	if s == "" then
		return
	end
	local id = tonumber(s)
	if id then
		ADMIN_IDS[id] = true
	else
		ADMIN_NAMES[s:lower()] = true
	end
end

local function fbApplyStaff(body)
	local ok, data = pcall(H.HS.JSONDecode, H.HS, body)
	if not ok or type(data) ~= "table" then
		return false
	end
	for _, list in pairs({ data.ids, data.usernames }) do
		if type(list) == "table" then
			for key, value in pairs(list) do
				if type(value) == "string" or type(value) == "number" then
					fbAddIdentity(value) -- array form
				elseif value == nil or value == true then
					fbAddIdentity(key) -- map form: key is the id/username
				end
			end
		end
	end
	if type(data.admins) == "table" then
		for _, name in ipairs(data.admins) do
			fbAddIdentity(name)
		end
	end
	-- rank tiers: {"ranks":{"founder":["x9ksa","8579040069"],"hr":[...],
	-- "support":[...],"trial":[...]}} - sets each person's badge color
	-- (tier names are normalized later, in the nametag rank resolver)
	if type(data.ranks) == "table" then
		for tier, list in pairs(data.ranks) do
			if type(list) == "table" then
				for _, who in pairs(list) do
					if type(who) == "string" or type(who) == "number" then
						local s = tostring(who)
						if s ~= "" then
							H.NT_RANKS[s] = tier
						end
					end
				end
			end
		end
	end
	return true
end

local function fbFetchStaffOnce()
	local url = fbStaffUrl()
	if not url then
		return false
	end
	local body
	pcall(function()
		body = game:HttpGet(url, true)
	end)
	if type(body) ~= "string" or body == "" or body == "null" then
		return false
	end
	return fbApplyStaff(body)
end

pcall(fbLoadRepoConfig) -- repo firebase.json -> FIREBASE_URL (no script edits needed)
pcall(fbFetchStaffOnce) -- boot-time sync fetch; failing just means offline defaults
local isAdmin = ADMIN_IDS[player.UserId] == true or ADMIN_NAMES[tostring(player.Name):lower()] == true
H.fbRefreshStaff = function()
	if not fbStaffUrl() then
		return "Firebase not configured (add firebase.json to the repo, or set H.FIREBASE_URL in the script)"
	end
	if fbFetchStaffOnce() then
		return "Firebase staff list applied"
	end
	return "Firebase fetch failed (check URL/auth, or the DB is offline)"
end
local debugPage
if isAdmin then
	debugPage = makeTab("Debug")
end

local function sizeTabCanvas()
	tabStrip.CanvasSize = UDim2.new(0, 0, 0, tabLayout.AbsoluteContentSize.Y / H.scaleOf(tabStrip) + 8)
end
connect(tabLayout:GetPropertyChangedSignal("AbsoluteContentSize"), sizeTabCanvas)
sizeTabCanvas()

connect(tabStrip.InputChanged, function(i)
	if i.UserInputType == Enum.UserInputType.MouseWheel then
		local maxY = math.max(tabStrip.CanvasSize.Y.Offset - tabStrip.AbsoluteSize.Y, 0)
		local y = math.clamp(tabStrip.CanvasPosition.Y - i.Position.Z * 40, 0, maxY)
		tabStrip.CanvasPosition = Vector2.new(0, y)
	end
end)

-- user card, bottom-left of the shell (avatar + name + role, like the reference)
local userCard = make("Frame", {
	Name = "UserCard",
	Position = UDim2.new(0, 7, 1, -54),
	Size = UDim2.new(0, 188, 0, 46),
	BackgroundColor3 = COL.element,
	BorderSizePixel = 0,
}, main)
round(userCard, 10)
make("UIStroke", { Color = COL.stroke, Thickness = 1 }, userCard)
local userAvatar = make("ImageLabel", {
	Size = UDim2.new(0, 34, 0, 34),
	Position = UDim2.new(0, 6, 0.5, -17),
	BackgroundColor3 = COL.contentBg,
	BorderSizePixel = 0,
	Image = "rbxthumb://type=AvatarHeadShot&id=" .. tostring(player.UserId) .. "&w=150&h=150",
	ScaleType = Enum.ScaleType.Crop,
}, userCard)
round(userAvatar, 17)
make("TextLabel", {
	Size = UDim2.new(1, -54, 0, 16),
	Position = UDim2.new(0, 46, 0, 6),
	BackgroundTransparency = 1,
	Font = Enum.Font.GothamBold,
	TextSize = 12,
	TextColor3 = COL.text,
	Text = player.DisplayName,
	TextXAlignment = Enum.TextXAlignment.Left,
	TextTruncate = Enum.TextTruncate.AtEnd,
}, userCard)
make("TextLabel", {
	Size = UDim2.new(1, -54, 0, 13),
	Position = UDim2.new(0, 46, 0, 23),
	BackgroundTransparency = 1,
	Font = Enum.Font.Gotham,
	TextSize = 10,
	TextColor3 = COL.sub,
	Text = isAdmin and "Administrator" or "Member",
	TextXAlignment = Enum.TextXAlignment.Left,
	TextTruncate = Enum.TextTruncate.AtEnd,
}, userCard)

function selectTab(name)
	currentTab = name
	for n, page in pairs(pages) do
		local active = n == name
		page.Visible = active
		if active then

			page.Position = UDim2.new(0, 200, 0, 52)
			tween(page, { Position = UDim2.new(0, 200, 0, 44) })
		end
		tween(tabs[n], {
			BackgroundColor3 = active and COL.accent or COL.element,
			TextColor3 = active and Color3.new(1, 1, 1) or COL.sub,
		})
		local ul = tabs[n]:FindFirstChild("Underline")
		if ul then
			tween(ul, { Size = UDim2.new(0, 3, 0, active and 16 or 0) })
		end
	end
end

local function row(parent, y, text)
	return make("TextLabel", {
		Size = UDim2.new(1, -60, 0, 22),
		Position = UDim2.new(0, 0, 0, y),
		BackgroundTransparency = 1,
		Font = Enum.Font.Gotham,
		TextSize = 13,
		TextColor3 = COL.text,
		Text = text,
		TextXAlignment = Enum.TextXAlignment.Left,
	}, parent)
end

local function makeSwitch(parent, y, initial, onChanged)
	local btn = make("TextButton", {
		Size = UDim2.new(0, 44, 0, 22),
		Position = UDim2.new(1, -44, 0, y),
		BackgroundColor3 = initial and COL.accent or COL.contentBg,
		Text = "",
		AutoButtonColor = false,
		BorderSizePixel = 0,
	}, parent)
	round(btn, 11)
	H.animate(btn)
	-- Fluent-style two-tone track: faint vertical sheen so the switch reads
	-- as a physical control instead of a flat pill
	make("UIGradient", {
		Color = ColorSequence.new(Color3.fromRGB(255, 255, 255), Color3.fromRGB(226, 229, 243)),
		Rotation = 90,
	}, btn)
	-- accent glow ring that appears while the switch is live
	local glow = make("UIStroke", {
		Color = COL.accent,
		Thickness = initial and 1.5 or 0,
		Transparency = 0.35,
		ApplyStrokeMode = Enum.ApplyStrokeMode.Border,
	}, btn)
	local knob = make("Frame", {
		Size = UDim2.new(0, 16, 0, 16),
		Position = initial and UDim2.new(1, -19, 0.5, -8) or UDim2.new(0, 3, 0.5, -8),
		BackgroundColor3 = Color3.new(1, 1, 1),
		BorderSizePixel = 0,
	}, btn)
	round(knob, 8)
	make("UIStroke", { Color = Color3.fromRGB(186, 191, 212), Thickness = 1, Transparency = 0.55 }, knob)
	local state = initial
	local function render()
		tween(btn, { BackgroundColor3 = state and COL.accent or COL.contentBg })
		tween(knob, { Position = state and UDim2.new(1, -19, 0.5, -8) or UDim2.new(0, 3, 0.5, -8) })
		tween(glow, { Thickness = state and 1.5 or 0 })
	end
	themeRefreshers[#themeRefreshers + 1] = render
	local function toggle()
		click()
		state = not state
		render()
		onChanged(state)
	end
	connect(btn.MouseButton1Click, toggle)

	return function(newState)
		if newState ~= state then
			state = newState
			render()
		end
	end, toggle
end

-- Linoria-style focus glow for text fields: an accent ring while editing.
-- Apply to any TextBox; fully themed (ring recolors with the palette).
H.bindFocusGlow = function(box)
	local ring = make("UIStroke", {
		Color = COL.accent,
		Thickness = 0,
		Transparency = 0.25,
		ApplyStrokeMode = Enum.ApplyStrokeMode.Border,
	}, box)
	connect(box.Focused, function()
		tween(ring, { Thickness = 1.5 })
	end)
	connect(box.FocusLost, function()
		tween(ring, { Thickness = 0 })
	end)
	return box
end

-- Linoria-style section header: small-caps label with an accent tick
H.sectionHeader = function(parent, y, text)
	local tick = make("Frame", {
		Size = UDim2.new(0, 3, 0, 12),
		Position = UDim2.new(0, 0, 0, y + 4),
		BackgroundColor3 = COL.accent,
		BorderSizePixel = 0,
	}, parent)
	round(tick, 2)
	make("TextLabel", {
		Size = UDim2.new(1, -12, 0, 20),
		Position = UDim2.new(0, 9, 0, y),
		BackgroundTransparency = 1,
		Font = Enum.Font.GothamBold,
		TextSize = 11,
		TextColor3 = COL.sub,
		Text = string.upper(text),
		TextXAlignment = Enum.TextXAlignment.Left,
	}, parent)
end

-- Linoria-style slider: thin accent track, draggable knob, live value readout
H.makeSlider = function(parent, y, minV, maxV, initial, format, onChanged)
	minV, maxV = tonumber(minV) or 0, tonumber(maxV) or 100
	local value = math.clamp(tonumber(initial) or minV, minV, maxV)
	local track = make("TextButton", {
		Size = UDim2.new(1, -56, 0, 6),
		Position = UDim2.new(0, 0, 0, y + 14),
		BackgroundColor3 = COL.contentBg,
		Text = "",
		AutoButtonColor = false,
		BorderSizePixel = 0,
	}, parent)
	round(track, 3)
	make("UIStroke", { Color = COL.stroke, Thickness = 1, Transparency = 0.4 }, track)
	local fill = make("Frame", {
		BackgroundColor3 = COL.accent,
		BorderSizePixel = 0,
	}, track)
	round(fill, 3)
	local knob = make("Frame", {
		Size = UDim2.new(0, 10, 0, 10),
		AnchorPoint = Vector2.new(0.5, 0.5),
		BackgroundColor3 = Color3.new(1, 1, 1),
		BorderSizePixel = 0,
	}, track)
	round(knob, 5)
	local valLbl = make("TextLabel", {
		Size = UDim2.new(0, 52, 0, 18),
		Position = UDim2.new(1, -52, 0, y + 3),
		BackgroundTransparency = 1,
		Font = Enum.Font.GothamMedium,
		TextSize = 12,
		TextColor3 = COL.text,
		TextXAlignment = Enum.TextXAlignment.Right,
	}, parent)
	local function render()
		local a = (maxV > minV) and (value - minV) / (maxV - minV) or 0
		fill.Size = UDim2.new(a, 0, 1, 0)
		knob.Position = UDim2.new(a, 0, 0.5, 0)
		valLbl.Text = format(value)
	end
	local dragging = false
	local function apply(x)
		local w = track.AbsoluteSize.X
		if w <= 0 then
			return
		end
		local a = math.clamp((x - track.AbsolutePosition.X) / w, 0, 1)
		value = math.floor(minV + a * (maxV - minV) + 0.5)
		render()
		onChanged(value)
	end
	local function isDrag(i)
		return i.UserInputType == Enum.UserInputType.MouseButton1
			or i.UserInputType == Enum.UserInputType.Touch
	end
	local function begin(i)
		dragging = true
		apply(i.Position.X)
	end
	connect(track.InputBegan, function(i)
		if isDrag(i) then begin(i) end
	end)
	connect(knob.InputBegan, function(i)
		if isDrag(i) then begin(i) end
	end)
	connect(UIS.InputChanged, function(i)
		if dragging and (i.UserInputType == Enum.UserInputType.MouseMovement
			or i.UserInputType == Enum.UserInputType.Touch) then
			apply(i.Position.X)
		end
	end)
	connect(UIS.InputEnded, function(i)
		if isDrag(i) then dragging = false end
	end)
	render()
	return function(v)
		value = math.clamp(tonumber(v) or minV, minV, maxV)
		render()
	end
end

-- Linoria-style dropdown: closed pill with chevron, animated expanding list
H.makeDropdown = function(parent, y, options, initial, onChanged)
	local current = initial
	local list, chev
	local btn = make("TextButton", {
		Size = UDim2.new(1, -56, 0, 26),
		Position = UDim2.new(0, 0, 0, y),
		BackgroundColor3 = COL.element,
		Font = Enum.Font.Gotham,
		TextSize = 12,
		TextColor3 = COL.text,
		Text = tostring(initial or "select..."),
		TextXAlignment = Enum.TextXAlignment.Left,
		AutoButtonColor = false,
		BorderSizePixel = 0,
	}, parent)
	make("UIPadding", { PaddingLeft = UDim.new(0, 8) }, btn)
	round(btn, 6)
	make("UIStroke", { Color = COL.stroke, Thickness = 1, Transparency = 0.4 }, btn)
	chev = make("TextLabel", {
		Size = UDim2.new(0, 20, 1, 0),
		Position = UDim2.new(1, -24, 0, 0),
		BackgroundTransparency = 1,
		Font = Enum.Font.GothamBold,
		TextSize = 10,
		TextColor3 = COL.sub,
		Text = "▼",
		TextXAlignment = Enum.TextXAlignment.Center,
	}, btn)
	list = make("Frame", {
		Size = UDim2.new(1, -56, 0, 0),
		Position = UDim2.new(0, 0, 0, y + 28),
		BackgroundColor3 = COL.element,
		BorderSizePixel = 0,
		ClipsDescendants = true,
		Visible = false,
		ZIndex = 15,
	}, parent)
	round(list, 6)
	make("UIStroke", { Color = COL.stroke, Thickness = 1, Transparency = 0.4 }, list)
	local layout = make("UIListLayout", { Padding = UDim.new(0, 2), SortOrder = Enum.SortOrder.LayoutOrder }, list)
	make("UIPadding", {
		PaddingTop = UDim.new(0, 3),
		PaddingLeft = UDim.new(0, 3),
		PaddingRight = UDim.new(0, 3),
	}, list)
	local open = false
	local function rebuild()
		for _, c in ipairs(list:GetChildren()) do
			if c:IsA("TextButton") then
				c:Destroy()
			end
		end
		for i, opt in ipairs(options) do
			local b = make("TextButton", {
				Size = UDim2.new(1, -6, 0, 22),
				BackgroundColor3 = COL.bg,
				Font = Enum.Font.Gotham,
				TextSize = 12,
				TextColor3 = (opt == current) and COL.accent or COL.sub,
				Text = tostring(opt),
				TextXAlignment = Enum.TextXAlignment.Left,
				AutoButtonColor = false,
				BorderSizePixel = 0,
				LayoutOrder = i,
				ZIndex = 16,
			}, list)
			round(b, 4)
			connect(b.MouseButton1Click, function()
				click()
				current = opt
				btn.Text = tostring(opt)
				onChanged(opt)
				open = false
				chev.Text = "▼"
				tween(list, { Size = UDim2.new(1, -56, 0, 0) })
				task.delay(0.16, function()
					list.Visible = false
				end)
				rebuild()
			end)
		end
		return layout.AbsoluteContentSize.Y + 6
	end
	connect(btn.MouseButton1Click, function()
		click()
		open = not open
		if open then
			local h = rebuild()
			list.Visible = true
			tween(list, { Size = UDim2.new(1, -56, 0, math.min(h, 144)) })
			chev.Text = "▲"
		else
			tween(list, { Size = UDim2.new(1, -56, 0, 0) })
			task.delay(0.16, function()
				if not open then
					list.Visible = false
				end
			end)
			chev.Text = "▼"
		end
	end)
	return function(v)
		current = v
		btn.Text = tostring(v or "select...")
		rebuild()
	end
end

do
	local Games = { default = {}, tabs = {} }

	for n in pairs(pages) do
		Games.default[n] = true
	end

	local function showTab(name, vis)
		local b = tabs[name]
		if b then
			b.Visible = vis
		end
	end

	function Games.enter()
		for n in pairs(Games.default) do
			showTab(n, false)
		end
		showTab("Back", true)
		for _, n in ipairs(Games.tabs) do
			showTab(n, true)
		end
		if Games.tabs[1] then
			selectTab(Games.tabs[1])
		end
		tabStrip.CanvasPosition = Vector2.new(0, 0)
	end

	function Games.exit()
		showTab("Back", false)
		for _, n in ipairs(Games.tabs) do
			showTab(n, false)
		end
		for n in pairs(Games.default) do
			showTab(n, true)
		end
		selectTab("Speed")
		tabStrip.CanvasPosition = Vector2.new(0, 0)
	end

	makeTab("Back", function()
		Games.exit()
	end)
	tabs["Back"].Visible = false
	tabs["Back"].LayoutOrder = -1

	makeTab("Games", function()
		Games.enter()
	end)
	Games.default["Games"] = true

	function Games.add(placeId, fallback)
		local key = tostring(placeId)
		local page = makeTab(key, nil, fallback or ("Game " .. key))
		tabs[key].Visible = false
		tabs[key].TextTruncate = Enum.TextTruncate.AtEnd
		Games.tabs[#Games.tabs + 1] = key
		if tonumber(placeId) and tonumber(placeId) > 0 then
			task.spawn(function()
				local ok, info = pcall(function()
					return game:GetService("MarketplaceService"):GetProductInfo(placeId)
				end)
				if ok and type(info) == "table" and info.Name and tabs[key] then
					tabs[key].Text = info.Name
				end
			end)
		end
		return page
	end

	local function sectioned(page)
		local scroll = make("ScrollingFrame", {
			Size = UDim2.new(1, 0, 1, 0),
			BackgroundTransparency = 1,
			BorderSizePixel = 0,
			ScrollBarThickness = 4,
			ScrollBarImageColor3 = COL.sub,
			CanvasSize = UDim2.new(0, 0, 0, 0),
		}, page)
		local layout = make("UIListLayout", {
			Padding = UDim.new(0, 6),
			SortOrder = Enum.SortOrder.LayoutOrder,
		}, scroll)
		make("UIPadding", {
			PaddingTop = UDim.new(0, 4),
			PaddingLeft = UDim.new(0, 4),
			PaddingRight = UDim.new(0, 4),
		}, scroll)
		connect(layout:GetPropertyChangedSignal("AbsoluteContentSize"), function()
			scroll.CanvasSize = UDim2.new(0, 0, 0, layout.AbsoluteContentSize.Y / H.scaleOf(scroll) + 6)
		end)
		local ord = 0
		local function sec(text)
			ord += 1
			make("TextLabel", {
				Size = UDim2.new(1, -6, 0, 18),
				BackgroundTransparency = 1,
				Font = Enum.Font.GothamBold,
				TextSize = 11,
				TextColor3 = COL.sub,
				Text = string.upper(text),
				TextXAlignment = Enum.TextXAlignment.Left,
				LayoutOrder = ord,
			}, scroll)
		end
		local function btn(text, fn)
			ord += 1
			local b = make("TextButton", {
				Size = UDim2.new(1, -6, 0, 28),
				BackgroundColor3 = COL.element,
				Font = Enum.Font.GothamMedium,
				TextSize = 13,
				TextColor3 = COL.text,
				Text = text,
				AutoButtonColor = true,
				BorderSizePixel = 0,
				LayoutOrder = ord,
			}, scroll)
			round(b, 6)
			connect(b.MouseButton1Click, function()
				click()
				if fn then
					local ok, err = pcall(fn)
					if not ok then
						warn("[MicUp] " .. tostring(err))
					end
				end
			end)
			return b
		end
		return sec, btn
	end

	local MICUP_PLACE_ID = 6884319169
	do
		local sec, btn = sectioned(Games.add(MICUP_PLACE_ID, "MicUp"))

		sec("Misc")
		btn("Board Watcher", function()
			H.runCommand("boardnotifier")
		end)

		sec("Main")
		btn("Example button", function()
			H.notify({ title = "MicUp", text = "Example button pressed", kind = "success" })
		end)
	end

	H.Games = Games
end

H.Players, H.RunService, H.UIS = Players, RunService, UIS
H.TweenService, H.HttpService = TweenService, HttpService
H.player, H.conns, H.connect = player, conns, connect
H.VERSION = VERSION
H.COL, H.ESPCOL, H.ClickTp, H.Binds = COL, ESPCOL, ClickTp, Binds
H.themedRefs, H.themeRefreshers = themedRefs, themeRefreshers
H.make, H.round, H.tween = make, round, tween
H.gui, H.click, H.main, H.titleBar, H.keyChip = gui, click, main, titleBar, keyChip

H.guiHost, H.DISPLAY_ORDER = guiHost, DISPLAY_ORDER	H.pages, H.tabs, H.selectTab, H.makeTab = pages, tabs, selectTab, makeTab
	H.isAdmin, H.ADMIN_IDS, H.ADMIN_NAMES = isAdmin, ADMIN_IDS, ADMIN_NAMES
H.debugPage = debugPage
H.row, H.makeSwitch = row, makeSwitch

H.unlockValues = false
H.clampV = function(v, lo, hi)
	if H.unlockValues then
		return v
	end
	return math.clamp(v, lo, hi)
end
H.titleBar, H.conns = titleBar, conns
H.speedPage, H.gravPage, H.espPage, H.hitboxPage = speedPage, speedPage, espPage, hitboxPage -- gravPage aliases Speed (merged tab)
H.playerPage, H.flyPage, H.movePage, H.toolsPage = playerPage, flyPage, movePage, toolsPage
H.world = world

H.reselectTab = function()
	if currentTab then
		selectTab(currentTab)
	end
end
end

do
local gui, COL, make, round, connect = H.gui, H.COL, H.make, H.round, H.connect
local TweenService = H.TweenService
local TextService = game:GetService("TextService")

local WIDTH, LEFT, RIGHT = 250, 12, 12
local BODY_W = WIDTH - LEFT - RIGHT
local MAX = 6

local host = make("Frame", {
	Name = "Toasts",
	Size = UDim2.new(0, WIDTH, 1, -20),
	Position = UDim2.new(1, -(WIDTH + 12), 0, 10),
	BackgroundTransparency = 1,
	BorderSizePixel = 0,
	ZIndex = 50,
}, gui)
make("UIListLayout", {
	Padding = UDim.new(0, 8),
	HorizontalAlignment = Enum.HorizontalAlignment.Right,
	VerticalAlignment = Enum.VerticalAlignment.Top,
	SortOrder = Enum.SortOrder.LayoutOrder,
}, host)

local KIND = {
	info = function() return COL.accent end,
	success = function() return Color3.fromRGB(60, 190, 110) end,
	warn = function() return Color3.fromRGB(232, 178, 58) end,
	error = function() return COL.on end,
}

local live = {}
local seq = 0

local function measure(text)
	if text == "" then
		return 0
	end
	local ok, v = pcall(function()
		return TextService:GetTextSize(text, 12, Enum.Font.Gotham, Vector2.new(BODY_W, 100000)).Y
	end)
	return ok and v or 14
end

local function notify(a, b, c)
	local o = type(a) == "table" and a or { title = a, text = b, duration = c }
	local title = tostring(o.title or "")
	local text = tostring(o.text or "")
	local duration = tonumber(o.duration) or 4
	local accent = (KIND[o.kind] or KIND.info)()

	local titleH = title ~= "" and 16 or 0
	local gap = (title ~= "" and text ~= "") and 3 or 0
	local bodyH = measure(text)
	local height = 8 + titleH + gap + bodyH + 8

	seq += 1
	local slot = make("Frame", {
		Name = "ToastSlot",
		Size = UDim2.new(1, 0, 0, height),
		BackgroundTransparency = 1,
		BorderSizePixel = 0,
		LayoutOrder = seq,
		ZIndex = 50,
	}, host)

	local card = make("CanvasGroup", {
		Size = UDim2.new(1, 0, 1, 0),
		Position = UDim2.new(0, 14, 0, 0),
		BackgroundColor3 = COL.bg,
		GroupTransparency = 1,
		BorderSizePixel = 0,
		ZIndex = 50,
	}, slot)
	round(card, 8)
	make("UIStroke", { Color = COL.stroke, Thickness = 1, Transparency = 0.2 }, card)

	make("Frame", {
		Size = UDim2.new(0, 4, 1, -12),
		Position = UDim2.new(0, 5, 0, 6),
		BackgroundColor3 = accent,
		BorderSizePixel = 0,
		ZIndex = 51,
	}, card)

	if title ~= "" then
		make("TextLabel", {
			Size = UDim2.new(1, -(LEFT + RIGHT), 0, 16),
			Position = UDim2.new(0, LEFT, 0, 8),
			BackgroundTransparency = 1,
			Font = Enum.Font.GothamBold,
			TextSize = 13,
			TextColor3 = COL.text,
			Text = title,
			TextXAlignment = Enum.TextXAlignment.Left,
			TextTruncate = Enum.TextTruncate.AtEnd,
			ZIndex = 51,
		}, card)
	end
	if text ~= "" then
		make("TextLabel", {
			Size = UDim2.new(1, -(LEFT + RIGHT), 0, bodyH),
			Position = UDim2.new(0, LEFT, 0, 8 + titleH + gap),
			BackgroundTransparency = 1,
			Font = Enum.Font.Gotham,
			TextSize = 12,
			TextColor3 = COL.sub,
			Text = text,
			TextWrapped = true,
			TextXAlignment = Enum.TextXAlignment.Left,
			TextYAlignment = Enum.TextYAlignment.Top,
			ZIndex = 51,
		}, card)
	end

	local closeBtn = make("TextButton", {
		Size = UDim2.new(1, 0, 1, 0),
		BackgroundTransparency = 1,
		Text = "",
		ZIndex = 52,
	}, card)

	TweenService:Create(card, TweenInfo.new(0.22, Enum.EasingStyle.Quad, Enum.EasingDirection.Out), {
		Position = UDim2.new(0, 0, 0, 0),
		GroupTransparency = 0,
	}):Play()

	local entry = {}
	local dismissed = false
	local function dismiss()
		if dismissed then
			return
		end
		dismissed = true
		for i, e in ipairs(live) do
			if e == entry then
				table.remove(live, i)
				break
			end
		end
		TweenService:Create(card, TweenInfo.new(0.2, Enum.EasingStyle.Quad, Enum.EasingDirection.In), {
			Position = UDim2.new(0, 24, 0, 0),
			GroupTransparency = 1,
		}):Play()
		TweenService:Create(slot, TweenInfo.new(0.2), { Size = UDim2.new(1, 0, 0, 0) }):Play()
		task.delay(0.24, function()
			slot:Destroy()
		end)
	end
	entry.dismiss = dismiss

	connect(closeBtn.MouseButton1Click, dismiss)
	live[#live + 1] = entry
	while #live > MAX do
		live[1].dismiss()
	end
	if duration > 0 then
		task.delay(duration, dismiss)
	end
	return entry
end

H.notify = notify
end

do
local gui, COL, make, round, connect = H.gui, H.COL, H.make, H.round, H.connect
local TweenService = H.TweenService
local VERSION = H.VERSION

local current

local function credits(duration)
	duration = tonumber(duration) or 5
	if current then
		current:Destroy()
		current = nil
	end

	local W, HT = 440, 178

	local card = make("CanvasGroup", {
		Name = "Credits",
		AnchorPoint = Vector2.new(0.5, 0.5),
		Position = UDim2.new(0.5, 0, 0.5, 0),
		Size = UDim2.new(0, W, 0, HT),
		BackgroundColor3 = COL.bg,
		GroupTransparency = 1,
		BorderSizePixel = 0,
		ZIndex = 60,
	}, gui)
	current = card
	round(card, 14)
	make("UIStroke", { Color = COL.accent, Thickness = 1.5 }, card)
	local scale = make("UIScale", { Scale = 0.9 }, card)

	make("TextLabel", {
		Size = UDim2.new(1, -24, 0, 30),
		Position = UDim2.new(0, 12, 0, 26),
		BackgroundTransparency = 1,
		Font = Enum.Font.GothamBold,
		TextSize = 23,
		TextColor3 = COL.text,
		Text = "Xyro",
		TextXAlignment = Enum.TextXAlignment.Center,
		ZIndex = 61,
	}, card)

	make("Frame", {
		Size = UDim2.new(1, -180, 0, 1),
		Position = UDim2.new(0, 90, 0, 66),
		BackgroundColor3 = COL.stroke,
		BorderSizePixel = 0,
		ZIndex = 61,
	}, card)

	make("TextLabel", {
		Size = UDim2.new(1, -24, 0, 20),
		Position = UDim2.new(0, 12, 0, 78),
		BackgroundTransparency = 1,
		Font = Enum.Font.GothamMedium,
		TextSize = 15,
		TextColor3 = COL.accent,
		Text = "Made by Vertxxy & X9K",
		TextXAlignment = Enum.TextXAlignment.Center,
		ZIndex = 61,
	}, card)
	make("TextLabel", {
		Size = UDim2.new(1, -16, 0, 18),
		Position = UDim2.new(0, 8, 0, 104),
		BackgroundTransparency = 1,
		Font = Enum.Font.Gotham,
		TextSize = 12,
		TextColor3 = COL.sub,
		Text = "Discord: @vertxxy / @x9kzx",
		TextXAlignment = Enum.TextXAlignment.Center,
		ZIndex = 61,
	}, card)
	make("TextLabel", {
		Size = UDim2.new(1, -24, 0, 16),
		Position = UDim2.new(0, 12, 1, -26),
		BackgroundTransparency = 1,
		Font = Enum.Font.Gotham,
		TextSize = 11,
		TextColor3 = COL.sub,
		Text = VERSION,
		TextXAlignment = Enum.TextXAlignment.Center,
		ZIndex = 61,
	}, card)

	local btn = make("TextButton", {
		Size = UDim2.new(1, 0, 1, 0),
		BackgroundTransparency = 1,
		Text = "",
		ZIndex = 62,
	}, card)

	TweenService:Create(card, TweenInfo.new(0.3, Enum.EasingStyle.Quad, Enum.EasingDirection.Out), {
		GroupTransparency = 0,
	}):Play()
	TweenService:Create(scale, TweenInfo.new(0.35, Enum.EasingStyle.Back, Enum.EasingDirection.Out), {
		Scale = 1,
	}):Play()

	local dismissed = false
	local function dismiss()
		if dismissed then
			return
		end
		dismissed = true
		if current == card then
			current = nil
		end
		TweenService:Create(card, TweenInfo.new(0.25, Enum.EasingStyle.Quad, Enum.EasingDirection.In), {
			GroupTransparency = 1,
		}):Play()
		TweenService:Create(scale, TweenInfo.new(0.25), { Scale = 0.92 }):Play()
		task.delay(0.28, function()
			card:Destroy()
		end)
	end

	connect(btn.MouseButton1Click, dismiss)
	if duration > 0 then
		task.delay(duration, dismiss)
	end
	return card
end

H.credits = credits
end

do

local RunService, player, connect, COL, make = H.RunService, H.player, H.connect, H.COL, H.make
local round, row, makeSwitch, speedPage = H.round, H.row, H.makeSwitch, H.speedPage

local char = player.Character or player.CharacterAdded:Wait()
local hrp = char:WaitForChild("HumanoidRootPart")

local speedEnabled = false

H.sectionHeader(speedPage, 96, "Quick set")
H.makeSlider(speedPage, 118, 16, 500, 16, function(v)
	return tostring(v)
end, function(v)
	_G.CFrameSpeed = v
	if H.Speed and H.Speed.updateUI then
		H.Speed.updateUI()
	end
end)

local speedRow = row(speedPage, 0, "CFrame movement")
H.keyRefreshers[#H.keyRefreshers + 1] = function()
	speedRow.Text = "CFrame movement" .. H.keySuffix("cframe")
end
local toggleSpeed = select(2, makeSwitch(speedPage, 0, false, function(on)
	speedEnabled = on
end))

row(speedPage, 36, "Speed (0-1000000)")
local speedBox = make("TextBox", {
	Size = UDim2.new(0, 78, 0, 26),
	Position = UDim2.new(1, -78, 0, 34),
	BackgroundColor3 = COL.element,
	Font = Enum.Font.Gotham,
	TextSize = 13,
	TextColor3 = COL.text,
	PlaceholderText = "speed",
	PlaceholderColor3 = COL.sub,
	ClearTextOnFocus = false,
	BorderSizePixel = 0,
}, speedPage)
round(speedBox, 6)
H.bindFocusGlow(speedBox)
local currentLbl = make("TextLabel", {
	Size = UDim2.new(1, 0, 0, 18),
	Position = UDim2.new(0, 0, 0, 72),
	BackgroundTransparency = 1,
	Font = Enum.Font.Gotham,
	TextSize = 12,
	TextColor3 = COL.sub,
	TextXAlignment = Enum.TextXAlignment.Left,
}, speedPage)

local function updateSpeedUI()
	currentLbl.Text = "Current: " .. _G.CFrameSpeed
	if not speedBox:IsFocused() then
		speedBox.Text = tostring(_G.CFrameSpeed)
	end
end
updateSpeedUI()

connect(speedBox.FocusLost, function()
	local n = tonumber(speedBox.Text)
	if n then
		_G.CFrameSpeed = H.clampV(n, 0, 1000000)
	end
	updateSpeedUI()
end)

connect(player.CharacterAdded, function(c)
	char = c
	hrp = c:WaitForChild("HumanoidRootPart")
	updateSpeedUI()
end)

connect(RunService.Stepped, function()
	if not speedEnabled then
		return
	end
	if not hrp or not hrp.Parent then
		char = player.Character or player.CharacterAdded:Wait()
		hrp = char:WaitForChild("HumanoidRootPart")
	end
	local hum = char and char:FindFirstChildOfClass("Humanoid")
	if hum and hrp then

		hrp.CFrame = hrp.CFrame + hum.MoveDirection * _G.CFrameSpeed * 0.1
	end
end)

H.Speed = { toggle = toggleSpeed, updateUI = updateSpeedUI }
end

do

local connect, COL, make, round, row, makeSwitch = H.connect, H.COL, H.make, H.round, H.row, H.makeSwitch
local gravPage = H.gravPage

local normalGravity = workspace.Gravity
if normalGravity == 0 then
	normalGravity = 196.2
end

local customGravity = normalGravity
local gravEnabled = false
local applyingGravity = false

H.sectionHeader(gravPage, 212, "Quick set")
H.makeSlider(gravPage, 234, 0, 500, 196, function(v)
	return tostring(v)
end, function(v)
	customGravity = v
	workspace.Gravity = v
end)

local gravRow = row(gravPage, 110, "Custom gravity")
H.keyRefreshers[#H.keyRefreshers + 1] = function()
	gravRow.Text = "Custom gravity" .. H.keySuffix("gravity")
end

row(gravPage, 146, "Gravity (0-500)")
local gravBox = make("TextBox", {
	Size = UDim2.new(0, 78, 0, 26),
	Position = UDim2.new(1, -78, 0, 144),
	BackgroundColor3 = COL.element,
	Font = Enum.Font.Gotham,
	TextSize = 13,
	TextColor3 = COL.text,
	PlaceholderText = "gravity",
	PlaceholderColor3 = COL.sub,
	ClearTextOnFocus = false,
	BorderSizePixel = 0,
}, gravPage)
round(gravBox, 6)
H.bindFocusGlow(gravBox)

local gravLbl = make("TextLabel", {
	Size = UDim2.new(1, 0, 0, 18),
	Position = UDim2.new(0, 0, 0, 182),
	BackgroundTransparency = 1,
	Font = Enum.Font.Gotham,
	TextSize = 12,
	TextColor3 = COL.sub,
	TextXAlignment = Enum.TextXAlignment.Left,
}, gravPage)

local function updateGravUI()
	gravLbl.Text = ("Current: %.1f"):format(workspace.Gravity)
	if not gravBox:IsFocused() then
		gravBox.Text = ("%g"):format(customGravity)
	end
end

local function applyGravity(value)
	applyingGravity = true
	workspace.Gravity = value
	applyingGravity = false
end

local toggleGrav = select(2, makeSwitch(gravPage, 110, false, function(on)
	gravEnabled = on
	applyGravity(on and customGravity or normalGravity)
	updateGravUI()
end))

connect(gravBox.FocusLost, function()
	local n = tonumber(gravBox.Text)
	if n then
		customGravity = H.clampV(n, 0, 500)
		if gravEnabled then
			applyGravity(customGravity)
		end
	end
	updateGravUI()
end)

connect(workspace:GetPropertyChangedSignal("Gravity"), function()

	if not applyingGravity and not gravEnabled then
		normalGravity = workspace.Gravity
	end
	updateGravUI()
end)
updateGravUI()

H.Grav = {
	toggle = toggleGrav,
	getCustom = function()
		return customGravity
	end,
	setCustom = function(v)
		customGravity = H.clampV(v, 0, 500)
		if gravEnabled then
			applyGravity(customGravity)
		end
		updateGravUI()
	end,
}
end

do

local Players, RunService, player, connect, ESPCOL, row = H.Players, H.RunService, H.player, H.connect, H.ESPCOL, H.row
local makeSwitch, espPage, make, COL = H.makeSwitch, H.espPage, H.make, H.COL

local espEnabled = false
local espBox = true
local espDistance = false
local espHealth = false
local espSkeleton = false
local espTracer = false
local espChams = false
local espMaxDistance = 0 -- 0 = unlimited; Linoria slider on the ESP tab sets this
local drawingOk = (Drawing ~= nil)
local espObjects = {}

local SKELETON_R6 = {
	{ "Head", "Torso" },
	{ "Torso", "Left Arm" },
	{ "Torso", "Right Arm" },
	{ "Torso", "Left Leg" },
	{ "Torso", "Right Leg" },
}
local SKELETON_R15 = {
	{ "Head", "UpperTorso" },
	{ "UpperTorso", "LowerTorso" },
	{ "UpperTorso", "LeftUpperArm" },
	{ "LeftUpperArm", "LeftLowerArm" },
	{ "LeftLowerArm", "LeftHand" },
	{ "UpperTorso", "RightUpperArm" },
	{ "RightUpperArm", "RightLowerArm" },
	{ "RightLowerArm", "RightHand" },
	{ "LowerTorso", "LeftUpperLeg" },
	{ "LeftUpperLeg", "LeftLowerLeg" },
	{ "LeftLowerLeg", "LeftFoot" },
	{ "LowerTorso", "RightUpperLeg" },
	{ "RightUpperLeg", "RightLowerLeg" },
	{ "RightLowerLeg", "RightFoot" },
}
local SKELETON_POOL = 16

local espHost = make("ScrollingFrame", {
	Size = UDim2.new(1, 0, 1, 0),
	BackgroundTransparency = 1,
	BorderSizePixel = 0,
	ScrollBarThickness = 3,
	ScrollBarImageColor3 = COL.sub,
	CanvasSize = UDim2.new(0, 0, 0, 252),
}, espPage)

row(espHost, 0, "Enabled")
row(espHost, 24, "Distance")
row(espHost, 48, "Health")
row(espHost, 72, "Skeleton")
row(espHost, 96, "Box")
row(espHost, 120, "Tracers")
row(espHost, 144, "Chams")

local function newDrawing(class, props)
	local d = Drawing.new(class)
	for k, v in pairs(props) do
		d[k] = v
	end
	return d
end

local function espHide(o)
	o.box.Visible = false
	o.name.Visible = false
	o.hpBg.Visible = false
	o.hpFill.Visible = false
	for _, ln in ipairs(o.bones) do
		ln.Visible = false
	end
end

local function espAdd(plr)
	if not drawingOk or plr == player or espObjects[plr] then
		return
	end
	local bones = {}
	for i = 1, SKELETON_POOL do
		bones[i] = newDrawing("Line", { Thickness = 1, Color = Color3.new(1, 1, 1), Visible = false })
	end
	espObjects[plr] = {
		box = newDrawing("Square", { Thickness = 1.5, Color = ESPCOL.box, Filled = false, Visible = false }),
		name = newDrawing(
			"Text",
			{ Size = 13, Center = true, Outline = true, Color = Color3.new(1, 1, 1), Visible = false }
		),
		hpBg = newDrawing("Square", { Thickness = 1, Color = Color3.new(0, 0, 0), Filled = true, Visible = false }),
		hpFill = newDrawing(
			"Square",
			{ Thickness = 1, Color = Color3.fromRGB(70, 210, 110), Filled = true, Visible = false }
		),
		bones = bones,
		tracer = newDrawing("Line", { Thickness = 1, Color = ESPCOL.tracer, Visible = false }),
		highlight = nil,
	}
end

local function espRemove(plr)
	local o = espObjects[plr]
	if not o then
		return
	end
	o.box:Remove()
	o.name:Remove()
	o.hpBg:Remove()
	o.hpFill:Remove()
	for _, ln in ipairs(o.bones) do
		ln:Remove()
	end
	o.tracer:Remove()
	if o.highlight then
		o.highlight:Destroy()
	end
	espObjects[plr] = nil
end

for _, plr in ipairs(Players:GetPlayers()) do
	espAdd(plr)
end
connect(Players.PlayerAdded, espAdd)
connect(Players.PlayerRemoving, espRemove)

local toggleEspMain = select(2, makeSwitch(espHost, 0, false, function(on)
	espEnabled = on and drawingOk
	if not espEnabled then
		for _, o in pairs(espObjects) do
			espHide(o)
		end
	end
end))

local espSetters, espToggles = {}, {}

espSetters.distance, espToggles.distance = makeSwitch(espHost, 24, espDistance, function(on)
	espDistance = on
end)

espSetters.health, espToggles.health = makeSwitch(espHost, 48, espHealth, function(on)
	espHealth = on
end)

espSetters.skeleton, espToggles.skeleton = makeSwitch(espHost, 72, espSkeleton, function(on)
	espSkeleton = on
end)

espSetters.box, espToggles.box = makeSwitch(espHost, 96, espBox, function(on)
	espBox = on
	if not on then
		for _, o in pairs(espObjects) do
			o.box.Visible = false
		end
	end
end)

espSetters.tracer, espToggles.tracer = makeSwitch(espHost, 120, espTracer, function(on)
	espTracer = on
	if not on then
		for _, o in pairs(espObjects) do
			o.tracer.Visible = false
		end
	end
end)

espSetters.chams, espToggles.chams = makeSwitch(espHost, 144, espChams, function(on)
	espChams = on
	if not on then
		for _, o in pairs(espObjects) do
			if o.highlight then
				o.highlight.Enabled = false
			end
		end
	end
end)

-- Linoria-style section header + detection-range slider
H.sectionHeader(espHost, 168, "Detection")
row(espHost, 190, "Max distance  (0 = unlimited)")
H.makeSlider(espHost, 214, 0, 1000, 0, function(v)
	return v == 0 and "OFF" or (v .. " studs")
end, function(v)
	espMaxDistance = v
end)

connect(RunService.RenderStepped, function()
	if not espEnabled then
		return
	end
	local camera = workspace.CurrentCamera
	for plr, o in pairs(espObjects) do
		local ch = plr.Character
		local rootPart = ch and ch:FindFirstChild("HumanoidRootPart")
		local head = ch and ch:FindFirstChild("Head")
		local hum = ch and ch:FindFirstChildOfClass("Humanoid")
		if rootPart and head and hum and hum.Health > 0 then
			local inRange = espMaxDistance <= 0
				or (camera.CFrame.Position - rootPart.Position).Magnitude <= espMaxDistance
			local topPos = head.Position + Vector3.new(0, 0.5, 0)
			local botPos = rootPart.Position - Vector3.new(0, 3, 0)
			local top, onTop = camera:WorldToViewportPoint(topPos)
			local bot = camera:WorldToViewportPoint(botPos)
			if onTop and inRange then
				local height = math.abs(bot.Y - top.Y)
				local width = height * 0.5
				local boxX = top.X - width / 2
				if espBox then
					o.box.Color = ESPCOL.box
					o.box.Size = Vector2.new(width, height)
					o.box.Position = Vector2.new(boxX, top.Y)
					o.box.Visible = true
				else
					o.box.Visible = false
				end

				local label = plr.Name
				if espDistance then
					local dist = (camera.CFrame.Position - rootPart.Position).Magnitude
					label = string.format("%s [%dm]", label, math.floor(dist))
				end
				if espHealth then
					label = string.format("%s (%d)", label, math.floor(hum.Health))
				end
				o.name.Text = label
				o.name.Color = ESPCOL.name
				o.name.Position = Vector2.new(top.X, top.Y - 16)
				o.name.Visible = true

				if espHealth then
					local pct = math.clamp(hum.Health / math.max(hum.MaxHealth, 1), 0, 1)
					local barW = 3
					local barX = boxX - barW - 3
					o.hpBg.Size = Vector2.new(barW, height)
					o.hpBg.Position = Vector2.new(barX, top.Y)
					o.hpBg.Visible = true
					local fillH = height * pct
					o.hpFill.Size = Vector2.new(barW, fillH)
					o.hpFill.Position = Vector2.new(barX, top.Y + (height - fillH))
					o.hpFill.Color = Color3.fromRGB(math.floor(255 * (1 - pct)), math.floor(210 * pct), 90)
					o.hpFill.Visible = true
				else
					o.hpBg.Visible = false
					o.hpFill.Visible = false
				end

				if espSkeleton then
					local rig = hum.RigType == Enum.HumanoidRigType.R15 and SKELETON_R15 or SKELETON_R6
					local used = 0
					for _, pair in ipairs(rig) do
						local a = ch:FindFirstChild(pair[1])
						local b = ch:FindFirstChild(pair[2])
						if a and b then
							local pa, va = camera:WorldToViewportPoint(a.Position)
							local pb, vb = camera:WorldToViewportPoint(b.Position)
							if va and vb then
								used += 1
								local ln = o.bones[used]
								if ln then
									ln.Color = ESPCOL.skeleton
									ln.From = Vector2.new(pa.X, pa.Y)
									ln.To = Vector2.new(pb.X, pb.Y)
									ln.Visible = true
								end
							end
						end
					end
					for j = used + 1, #o.bones do
						o.bones[j].Visible = false
					end
				else
					for _, ln in ipairs(o.bones) do
						ln.Visible = false
					end
				end
			else
				espHide(o)
			end
		else
			espHide(o)
		end
	end
end)

connect(RunService.RenderStepped, function()
	if not espEnabled then
		for _, o in pairs(espObjects) do
			o.tracer.Visible = false
			if o.highlight then
				o.highlight.Enabled = false
			end
		end
		return
	end
	local camera = workspace.CurrentCamera
	local vp = camera.ViewportSize
	for plr, o in pairs(espObjects) do
		local ch = plr.Character
		local root = ch and ch:FindFirstChild("HumanoidRootPart")
		local hum = ch and ch:FindFirstChildOfClass("Humanoid")
		local alive = root and hum and hum.Health > 0

		if espTracer and alive then
			local feet, onScreen = camera:WorldToViewportPoint(root.Position - Vector3.new(0, 3, 0))
			if onScreen then
				o.tracer.Color = ESPCOL.tracer
				o.tracer.From = Vector2.new(vp.X / 2, vp.Y)
				o.tracer.To = Vector2.new(feet.X, feet.Y)
				o.tracer.Visible = true
			else
				o.tracer.Visible = false
			end
		else
			o.tracer.Visible = false
		end

		if espChams and alive then

			if not (o.highlight and o.highlight.Parent == ch) then
				o.highlight = Instance.new("Highlight")
				o.highlight.DepthMode = Enum.HighlightDepthMode.AlwaysOnTop
				o.highlight.FillTransparency = 0.5
				o.highlight.OutlineTransparency = 0
				o.highlight.Parent = ch
			end
			o.highlight.FillColor = ESPCOL.chams
			o.highlight.OutlineColor = ESPCOL.name
			o.highlight.Enabled = true
		elseif o.highlight then
			o.highlight.Enabled = false
		end
	end
end)

H.Esp = {
	remove = espRemove,
	objects = espObjects,
	toggle = function()
		toggleEspMain()
		return espEnabled
	end,
	isOn = function()
		return espEnabled
	end,
	hasDrawing = function()
		return drawingOk
	end,

	toggleType = function(name)
		if not espToggles[name] then
			return nil
		end
		espToggles[name]()
		return ({ box = espBox, distance = espDistance, health = espHealth, skeleton = espSkeleton, tracer = espTracer, chams = espChams })[name]
	end,
	get = function()
		return { box = espBox, distance = espDistance, health = espHealth, skeleton = espSkeleton, tracer = espTracer, chams = espChams }
	end,

	set = function(t)
		if type(t.box) == "boolean" then
			espBox = t.box
			espSetters.box(espBox)
		end
		if type(t.distance) == "boolean" then
			espDistance = t.distance
			espSetters.distance(espDistance)
		end
		if type(t.health) == "boolean" then
			espHealth = t.health
			espSetters.health(espHealth)
		end
		if type(t.skeleton) == "boolean" then
			espSkeleton = t.skeleton
			espSetters.skeleton(espSkeleton)
		end
		if type(t.tracer) == "boolean" then
			espTracer = t.tracer
			espSetters.tracer(espTracer)
		end
		if type(t.chams) == "boolean" then
			espChams = t.chams
			espSetters.chams(espChams)
		end
	end,
}
end

do

local Players, RunService, player, connect, COL, make = H.Players, H.RunService, H.player, H.connect, H.COL, H.make
local round, row, makeSwitch, hitboxPage = H.round, H.row, H.makeSwitch, H.hitboxPage

local hitboxEnabled = false
local hitboxVisible = true
local hitboxSize = 5
local HITBOX_COLOR = Color3.fromRGB(255, 40, 40)
local hbOriginals = {}

local function hbStore(hrp)
	if hbOriginals[hrp] then
		return
	end
	hbOriginals[hrp] = {
		Size = hrp.Size,
		Transparency = hrp.Transparency,
		Color = hrp.Color,
		CanCollide = hrp.CanCollide,
		Massless = hrp.Massless,
	}
end

local function hbRestoreAll()
	for hrp, o in pairs(hbOriginals) do
		if hrp and hrp.Parent then
			hrp.Size = o.Size
			hrp.Transparency = o.Transparency
			hrp.Color = o.Color
			hrp.CanCollide = o.CanCollide
			hrp.Massless = o.Massless
		end
	end
	hbOriginals = {}
end

row(hitboxPage, 0, "Hitbox extender")
makeSwitch(hitboxPage, 0, false, function(on)
	hitboxEnabled = on
	if not on then
		hbRestoreAll()
	end
end)

row(hitboxPage, 36, "Show box (25%)")
makeSwitch(hitboxPage, 36, true, function(on)
	hitboxVisible = on
end)

row(hitboxPage, 72, "Size (1-10)")
local hbBox = make("TextBox", {
	Size = UDim2.new(0, 78, 0, 26),
	Position = UDim2.new(1, -78, 0, 70),
	BackgroundColor3 = COL.element,
	Font = Enum.Font.Gotham,
	TextSize = 13,
	TextColor3 = COL.text,
	Text = tostring(hitboxSize),
	PlaceholderText = "size",
	PlaceholderColor3 = COL.sub,
	ClearTextOnFocus = false,
	BorderSizePixel = 0,
}, hitboxPage)
round(hbBox, 6)

connect(hbBox.FocusLost, function()
	local n = tonumber(hbBox.Text)
	if n then
		hitboxSize = H.clampV(n, 1, 70)
	end
	hbBox.Text = tostring(hitboxSize)
end)

connect(RunService.Heartbeat, function()
	if not hitboxEnabled then
		return
	end
	local sizeVec = Vector3.new(hitboxSize, hitboxSize, hitboxSize)
	local tp = hitboxVisible and 0.75 or 1
	for _, plr in ipairs(Players:GetPlayers()) do
		if plr ~= player then
			local ch = plr.Character
			local hrp = ch and ch:FindFirstChild("HumanoidRootPart")
			if hrp then
				hbStore(hrp)

				if hrp.Size ~= sizeVec then
					hrp.Size = sizeVec
				end
				if hrp.CanCollide then
					hrp.CanCollide = false
				end
				hrp.Transparency = tp
				hrp.Color = HITBOX_COLOR
			end
		end
	end
end)

H.Hitbox = {
	restore = hbRestoreAll,
	getSize = function()
		return hitboxSize
	end,
	setSize = function(v)
		hitboxSize = H.clampV(v, 1, 10)
		hbBox.Text = tostring(hitboxSize)
	end,
}
end

do

local Players, player, connect, COL, make, round = H.Players, H.player, H.connect, H.COL, H.make, H.round
local click, playerPage = H.click, H.playerPage
local RunService = H.RunService

local playerScroll = make("ScrollingFrame", {
	Size = UDim2.new(1, 0, 1, 0),
	BackgroundTransparency = 1,
	BorderSizePixel = 0,
	ScrollBarThickness = 3,
	ScrollBarImageColor3 = COL.sub,
	CanvasSize = UDim2.new(0, 0, 0, 272),
}, playerPage)

local function findPlayer(txt)
	txt = (txt or ""):lower()
	if txt == "" then
		return nil
	end

	for _, p in ipairs(Players:GetPlayers()) do
		if p ~= player and (p.Name:lower():sub(1, #txt) == txt or p.DisplayName:lower():sub(1, #txt) == txt) then
			return p
		end
	end
end

local playerMainRow = make("TextLabel", {
	Size = UDim2.new(1, -10, 0, 28),
	Position = UDim2.new(0, 5, 0, 0),
	BackgroundTransparency = 1,
	Font = Enum.Font.Gotham,
	TextSize = 13,
	TextColor3 = COL.text,
	Text = "Player name",
	TextXAlignment = Enum.TextXAlignment.Center,
	TextYAlignment = Enum.TextYAlignment.Center,
	TextScaled = true,
	TextWrapped = false,
}, playerScroll)

make("UITextSizeConstraint", { MaxTextSize = 13, MinTextSize = 7 }, playerMainRow)

local playerBox = make("TextBox", {
	Size = UDim2.new(1, 0, 0, 28),
	Position = UDim2.new(0, 0, 0, 26),
	BackgroundColor3 = COL.element,
	Font = Enum.Font.Gotham,
	TextSize = 13,
	TextColor3 = COL.text,
	PlaceholderText = "name or display name",
	PlaceholderColor3 = COL.sub,
	ClearTextOnFocus = false,
	BorderSizePixel = 0,
	Text = "",
}, playerScroll)

round(playerBox, 6)

local selectedPlayer = nil

playerBox.FocusLost:Connect(function(enterPressed)
	if not enterPressed then
		return
	end

	local found = findPlayer(playerBox.Text)

	if found then
		selectedPlayer = found

		playerMainRow.Text =
			string.format("Player: %s, Username: %s, ID: %s", found.DisplayName, found.Name, found.UserId)

		playerBox.Text = found.Name
	else
		selectedPlayer = nil
		playerMainRow.Text = "Player: Not found"
	end
end)

local tpBtn = make("TextButton", {
	Size = UDim2.new(0.5, -4, 0, 28),
	Position = UDim2.new(0, 0, 0, 62),
	BackgroundColor3 = COL.accent,
	Font = Enum.Font.GothamMedium,
	TextSize = 13,
	TextColor3 = Color3.new(1, 1, 1),
	Text = "Teleport",
	AutoButtonColor = false,
	BorderSizePixel = 0,
}, playerScroll)
round(tpBtn, 6)

local specBtn = make("TextButton", {
	Size = UDim2.new(0.5, -4, 0, 28),
	Position = UDim2.new(0.5, 4, 0, 62),
	BackgroundColor3 = COL.accent,
	Font = Enum.Font.GothamMedium,
	TextSize = 13,
	TextColor3 = Color3.new(1, 1, 1),
	Text = "Spectate",
	AutoButtonColor = false,
	BorderSizePixel = 0,
}, playerScroll)
round(specBtn, 6)

local playerStatus = make("TextLabel", {
	Size = UDim2.new(1, 0, 0, 18),
	Position = UDim2.new(0, 0, 0, 162),
	BackgroundTransparency = 1,
	Font = Enum.Font.Gotham,
	TextSize = 12,
	TextColor3 = COL.sub,
	Text = "",
	TextXAlignment = Enum.TextXAlignment.Left,
}, playerScroll)

connect(tpBtn.MouseButton1Click, function()
	click()
	local target = findPlayer(playerBox.Text)
	if not target then
		playerStatus.Text = "Player not found"
		return
	end
	local thrp = target.Character and target.Character:FindFirstChild("HumanoidRootPart")
	local mychar = player.Character
	local myhrp = mychar and mychar:FindFirstChild("HumanoidRootPart")
	if thrp and myhrp then
		myhrp.CFrame = thrp.CFrame + Vector3.new(0, 0, 3)
		playerStatus.Text = "Teleported to " .. target.Name
	else
		playerStatus.Text = "No character to teleport to"
	end
end)

local spectating = nil
connect(specBtn.MouseButton1Click, function()
	click()
	local cam = workspace.CurrentCamera
	if spectating then
		local myhum = player.Character and player.Character:FindFirstChildOfClass("Humanoid")
		if myhum then
			cam.CameraSubject = myhum
		end
		spectating = nil
		specBtn.Text = "Spectate"
		playerStatus.Text = "Stopped spectating"
	else
		local target = findPlayer(playerBox.Text)
		if not target then
			playerStatus.Text = "Player not found"
			return
		end
		local thum = target.Character and target.Character:FindFirstChildOfClass("Humanoid")
		if thum then
			cam.CameraSubject = thum
			spectating = target
			specBtn.Text = "Stop Spec"
			playerStatus.Text = "Spectating " .. target.Name
		else
			playerStatus.Text = "No character to spectate"
		end
	end
end)

local headBtn = make("TextButton", {
	Size = UDim2.new(0.5, -4, 0, 28),
	Position = UDim2.new(0, 0, 0, 96),
	BackgroundColor3 = COL.accent,
	Font = Enum.Font.GothamMedium,
	TextSize = 13,
	TextColor3 = Color3.new(1, 1, 1),
	Text = "Head Sit",
	AutoButtonColor = false,
	BorderSizePixel = 0,
}, playerScroll)
round(headBtn, 6)

local backBtn = make("TextButton", {
	Size = UDim2.new(0.5, -4, 0, 28),
	Position = UDim2.new(0.5, 4, 0, 96),
	BackgroundColor3 = COL.accent,
	Font = Enum.Font.GothamMedium,
	TextSize = 13,
	TextColor3 = Color3.new(1, 1, 1),
	Text = "Backpack",
	AutoButtonColor = false,
	BorderSizePixel = 0,
}, playerScroll)
round(backBtn, 6)

local focusBtn = make("TextButton", {
	Size = UDim2.new(0.5, -4, 0, 28),
	Position = UDim2.new(0, 0, 0, 128),
	BackgroundColor3 = COL.accent,
	Font = Enum.Font.GothamMedium,
	TextSize = 13,
	TextColor3 = Color3.new(1, 1, 1),
	Text = "Focus TP",
	AutoButtonColor = false,
	BorderSizePixel = 0,
}, playerScroll)
round(focusBtn, 6)

local behindBtn = make("TextButton", {
	Size = UDim2.new(0.5, -4, 0, 28),
	Position = UDim2.new(0.5, 4, 0, 128),
	BackgroundColor3 = COL.accent,
	Font = Enum.Font.GothamMedium,
	TextSize = 13,
	TextColor3 = Color3.new(1, 1, 1),
	Text = "Behind",
	AutoButtonColor = false,
	BorderSizePixel = 0,
}, playerScroll)
round(behindBtn, 6)

local carryMode, carryTarget = nil, nil

local CARRY_ANIM = "rbxassetid://10714347256"
local carryTrack
local function ensureCarryAnim(on)
	if on then
		local hum = player.Character and player.Character:FindFirstChildOfClass("Humanoid")
		if not hum then
			return
		end
		if carryTrack and carryTrack.IsPlaying then
			return
		end
		carryTrack = nil
		local anim = Instance.new("Animation")
		anim.AnimationId = CARRY_ANIM
		local ok, track = pcall(function()
			return hum:LoadAnimation(anim)
		end)
		if ok and track then
			track.Looped = true
			track.Priority = Enum.AnimationPriority.Action
			track:Play(0.15)
			carryTrack = track
		end
	elseif carryTrack then
		pcall(function()
			carryTrack:Stop(0.15)
		end)
		carryTrack = nil
	end
end

connect(player.CharacterAdded, function()
	if carryMode then
		task.wait(0.3)
		if carryMode then
			ensureCarryAnim(true)
		end
	end
end)

local function updateCarryLabels()
	headBtn.Text = carryMode == "head" and "Stop Head" or "Head Sit"
	backBtn.Text = carryMode == "back" and "Stop Back" or "Backpack"
	focusBtn.Text = carryMode == "focus" and "Stop Focus" or "Focus TP"
end

local function setCarry(mode)
	local target = findPlayer(playerBox.Text) or selectedPlayer
	if not target then
		playerStatus.Text = "Player not found"
		return
	end
	if carryMode == mode then
		carryMode, carryTarget = nil, nil
		ensureCarryAnim(false)
		playerStatus.Text = "Stopped"
	else
		carryMode, carryTarget = mode, target
		ensureCarryAnim(true)
		playerStatus.Text = mode .. " -> " .. target.Name
	end
	updateCarryLabels()
end

connect(RunService.RenderStepped, function()
	if not carryMode then
		return
	end
	local target = carryTarget
	local thrp = target and target.Character and target.Character:FindFirstChild("HumanoidRootPart")
	local mhrp = player.Character and player.Character:FindFirstChild("HumanoidRootPart")
	if not thrp or not mhrp or target.Parent ~= Players then
		carryMode, carryTarget = nil, nil
		ensureCarryAnim(false)
		updateCarryLabels()
		return
	end
	local off
	if carryMode == "head" then
		off = CFrame.new(0, 3.2, 0)
	elseif carryMode == "back" then
		off = CFrame.new(0, 0.4, 1.6)
	else
		off = CFrame.new(0, 0, 4)
	end

	local vel = thrp.AssemblyLinearVelocity
	mhrp.CFrame = (thrp.CFrame * off) + vel * 0.03
	mhrp.AssemblyLinearVelocity = vel
end)

connect(headBtn.MouseButton1Click, function()
	click()
	setCarry("head")
end)
connect(backBtn.MouseButton1Click, function()
	click()
	setCarry("back")
end)
connect(focusBtn.MouseButton1Click, function()
	click()
	setCarry("focus")
end)
connect(behindBtn.MouseButton1Click, function()
	click()
	local target = findPlayer(playerBox.Text) or selectedPlayer
	local thrp = target and target.Character and target.Character:FindFirstChild("HumanoidRootPart")
	local mhrp = player.Character and player.Character:FindFirstChild("HumanoidRootPart")
	if thrp and mhrp then
		mhrp.CFrame = thrp.CFrame * CFrame.new(0, 0, 2.5)
		playerStatus.Text = "Behind " .. target.Name
	else
		playerStatus.Text = "Player not found"
	end
end)

make("TextLabel", {
	Size = UDim2.new(1, 0, 0, 16),
	Position = UDim2.new(0, 0, 0, 186),
	BackgroundTransparency = 1,
	Font = Enum.Font.GothamMedium,
	TextSize = 12,
	TextColor3 = COL.sub,
	Text = "Teleport to coords",
	TextXAlignment = Enum.TextXAlignment.Left,
}, playerScroll)

local function coordBox(xScale, xOff, placeholder)
	local b = make("TextBox", {
		Size = UDim2.new(0.333, -4, 0, 26),
		Position = UDim2.new(xScale, xOff, 0, 206),
		BackgroundColor3 = COL.element,
		Font = Enum.Font.Gotham,
		TextSize = 13,
		TextColor3 = COL.text,
		PlaceholderText = placeholder,
		PlaceholderColor3 = COL.sub,
		ClearTextOnFocus = false,
		BorderSizePixel = 0,
		Text = "",
	}, playerScroll)
	round(b, 6)
	return b
end
local xBox = coordBox(0, 0, "X")
local yBox = coordBox(0.333, 2, "Y")
local zBox = coordBox(0.666, 4, "Z")

local coordTpBtn = make("TextButton", {
	Size = UDim2.new(0.62, -4, 0, 28),
	Position = UDim2.new(0, 0, 0, 238),
	BackgroundColor3 = COL.accent,
	Font = Enum.Font.GothamMedium,
	TextSize = 13,
	TextColor3 = Color3.new(1, 1, 1),
	Text = "TP to Coords",
	AutoButtonColor = false,
	BorderSizePixel = 0,
}, playerScroll)
round(coordTpBtn, 6)

local getPosBtn = make("TextButton", {
	Size = UDim2.new(0.38, -4, 0, 28),
	Position = UDim2.new(0.62, 4, 0, 238),
	BackgroundColor3 = COL.element,
	Font = Enum.Font.GothamMedium,
	TextSize = 13,
	TextColor3 = COL.text,
	Text = "Get",
	AutoButtonColor = false,
	BorderSizePixel = 0,
}, playerScroll)
round(getPosBtn, 6)

connect(getPosBtn.MouseButton1Click, function()
	click()
	local hrp = player.Character and player.Character:FindFirstChild("HumanoidRootPart")
	if not hrp then
		playerStatus.Text = "No character"
		return
	end
	local p = hrp.Position
	xBox.Text = string.format("%.1f", p.X)
	yBox.Text = string.format("%.1f", p.Y)
	zBox.Text = string.format("%.1f", p.Z)
	playerStatus.Text = "Filled current pos"
end)

connect(coordTpBtn.MouseButton1Click, function()
	click()
	local hrp = player.Character and player.Character:FindFirstChild("HumanoidRootPart")
	if not hrp then
		playerStatus.Text = "No character"
		return
	end
	local x, y, z = tonumber(xBox.Text), tonumber(yBox.Text), tonumber(zBox.Text)
	if not (x and y and z) then
		playerStatus.Text = "Enter X, Y and Z"
		return
	end
	hrp.CFrame = CFrame.new(x, y, z)
	playerStatus.Text = string.format("TP'd to %.0f, %.0f, %.0f", x, y, z)
end)

H.findPlayer = findPlayer
end

do

local RunService, UIS, player, connect, COL, make = H.RunService, H.UIS, H.player, H.connect, H.COL, H.make
local round, click, row, makeSwitch, flyPage = H.round, H.click, H.row, H.makeSwitch, H.flyPage

local flyEnabled = false
local flightSpeed = 50
local FLY_MAX_SPEED = 1000000
local awaitingFlyKey = false
local flyConns = {}
local flyGyro, flyVel
local flyMove = { forward = 0, backward = 0, left = 0, right = 0 }
local flyCurrentVel = Vector3.zero
local flyCurrentCF = nil
local flyRoll = 0
local flyLerp = 0.1
local flyBobFreq, flyBobAmp = 1, 0.5
local flyAnimTrack = nil
local FLY_IDLE_ANIM = 10714347256
local FLY_FWD_ANIM = 10714177846

local function flySetAnimate(disabled)
	local ch = player.Character
	local a = ch and ch:FindFirstChild("Animate")
	if a then
		a.Disabled = disabled
	end
end

local function flyPlayAnim(animId, startTime, spd)
	local ch = player.Character
	local hum = ch and ch:FindFirstChildOfClass("Humanoid")
	if not hum then
		return
	end
	if flyAnimTrack then
		flyAnimTrack:Stop(0.1)
		flyAnimTrack = nil
	end
	flySetAnimate(true)
	for _, tr in ipairs(hum:GetPlayingAnimationTracks()) do
		tr:Stop()
	end
	local anim = Instance.new("Animation")
	anim.AnimationId = "rbxassetid://" .. tostring(animId)
	local ok, track = pcall(function()
		return hum:LoadAnimation(anim)
	end)
	if ok and track then
		flyAnimTrack = track
		track:Play()
		track.TimePosition = startTime
		track:AdjustSpeed(spd)
	end
end

local function flyStopAnim()
	if flyAnimTrack then
		flyAnimTrack:Stop(0.1)
		flyAnimTrack = nil
	end
	flySetAnimate(false)
	local ch = player.Character
	local hum = ch and ch:FindFirstChildOfClass("Humanoid")
	if hum then
		for _, tr in ipairs(hum:GetPlayingAnimationTracks()) do
			tr:Stop()
		end
	end
end

local function startFly()
	local ch = player.Character
	local root = ch and ch:FindFirstChild("HumanoidRootPart")
	local hum = ch and ch:FindFirstChildOfClass("Humanoid")
	if not root or not hum then
		return
	end
	hum.PlatformStand = true
	flyPlayAnim(FLY_IDLE_ANIM, 4, 0)

	flyGyro = Instance.new("BodyGyro")
	flyGyro.Name = "FlyGyro"
	flyGyro.P = 90000
	flyGyro.MaxTorque = Vector3.new(9e9, 9e9, 9e9)
	flyGyro.CFrame = root.CFrame
	flyGyro.Parent = root

	flyVel = Instance.new("BodyVelocity")
	flyVel.Name = "FlyVelocity"
	flyVel.MaxForce = Vector3.new(9e9, 9e9, 9e9)
	flyVel.Velocity = Vector3.new(0, 0.1, 0)
	flyVel.Parent = root

	flyCurrentVel = Vector3.zero
	flyCurrentCF = nil

	local upd = RunService.RenderStepped:Connect(function()
		if not flyGyro or not flyVel then
			return
		end
		local cam = workspace.CurrentCamera
		local fwd = flyMove.forward - flyMove.backward
		local side = flyMove.right - flyMove.left
		local inputVec = (cam.CFrame.LookVector * fwd) + (cam.CFrame.RightVector * side)
		if fwd ~= 0 then
			inputVec = inputVec + Vector3.new(0, 0.2 * fwd, 0)
		end
		local bobbing = math.sin(tick() * flyBobFreq) * flyBobAmp
		local desired = Vector3.zero
		if inputVec.Magnitude > 0 then
			desired = inputVec.Unit * flightSpeed
		else
			desired = Vector3.new(0, bobbing, 0)
		end
		flyCurrentVel = flyCurrentVel:Lerp(desired, 0.1)
		flyVel.Velocity = flyCurrentVel
		local desiredCF
		if fwd > 0 then
			desiredCF = cam.CFrame * CFrame.Angles(math.rad(-90), 0, math.rad(flyRoll))
		else
			desiredCF = cam.CFrame * CFrame.Angles(math.rad(-45 * fwd), 0, math.rad(flyRoll))
		end
		if flyCurrentCF then
			flyCurrentCF = flyCurrentCF:Lerp(desiredCF, flyLerp)
		else
			flyCurrentCF = desiredCF
		end
		flyGyro.CFrame = flyCurrentCF
	end)
	table.insert(flyConns, upd)

	local began = UIS.InputBegan:Connect(function(i, gp)
		if gp then
			return
		end
		if i.UserInputType ~= Enum.UserInputType.Keyboard then
			return
		end
		local k = i.KeyCode
		if k == Enum.KeyCode.W then
			flyMove.forward = 1
			flyPlayAnim(FLY_FWD_ANIM, 4.65, 0)
		elseif k == Enum.KeyCode.S then
			flyMove.backward = 1
			flyPlayAnim(FLY_IDLE_ANIM, 4, 0)
		elseif k == Enum.KeyCode.A then
			flyMove.left = 1
			if flyMove.forward > 0 then
				flyPlayAnim(FLY_FWD_ANIM, 4.65, 0)
			end
		elseif k == Enum.KeyCode.D then
			flyMove.right = 1
			if flyMove.forward > 0 then
				flyPlayAnim(FLY_FWD_ANIM, 4.65, 0)
			end
		end
	end)
	table.insert(flyConns, began)

	local ended = UIS.InputEnded:Connect(function(i)
		if i.UserInputType ~= Enum.UserInputType.Keyboard then
			return
		end
		local k = i.KeyCode
		if k == Enum.KeyCode.W then
			flyMove.forward = 0
			flyPlayAnim(FLY_IDLE_ANIM, 4, 0)
		elseif k == Enum.KeyCode.S then
			flyMove.backward = 0
			flyPlayAnim(FLY_IDLE_ANIM, 4, 0)
		elseif k == Enum.KeyCode.A then
			flyMove.left = 0
			if flyMove.forward > 0 then
				flyPlayAnim(FLY_FWD_ANIM, 4.65, 0)
			end
		elseif k == Enum.KeyCode.D then
			flyMove.right = 0
			if flyMove.forward > 0 then
				flyPlayAnim(FLY_FWD_ANIM, 4.65, 0)
			end
		end
	end)
	table.insert(flyConns, ended)
end

local function stopFly()
	local ch = player.Character
	local hum = ch and ch:FindFirstChildOfClass("Humanoid")
	if hum then
		hum.PlatformStand = false
	end
	flyStopAnim()
	local root = ch and ch:FindFirstChild("HumanoidRootPart")
	if root then
		local g = root:FindFirstChild("FlyGyro")
		if g then
			g:Destroy()
		end
		local v = root:FindFirstChild("FlyVelocity")
		if v then
			v:Destroy()
		end
	end
	flyGyro, flyVel = nil, nil
	for _, c in ipairs(flyConns) do
		if c.Connected then
			c:Disconnect()
		end
	end
	flyConns = {}
	flyMove = { forward = 0, backward = 0, left = 0, right = 0 }
end

row(flyPage, 0, "Fly")
local setFlySwitch, toggleFly = makeSwitch(flyPage, 0, false, function(on)
	flyEnabled = on
	if on then
		startFly()
	else
		stopFly()
	end
end)

row(flyPage, 36, "Speed (0-1000000)")
local flyBox = make("TextBox", {
	Size = UDim2.new(0, 90, 0, 26),
	Position = UDim2.new(1, -90, 0, 34),
	BackgroundColor3 = COL.element,
	Font = Enum.Font.Gotham,
	TextSize = 13,
	TextColor3 = COL.text,
	Text = tostring(flightSpeed),
	PlaceholderText = "speed",
	PlaceholderColor3 = COL.sub,
	ClearTextOnFocus = false,
	BorderSizePixel = 0,
}, flyPage)
round(flyBox, 6)
connect(flyBox.FocusLost, function()
	local n = tonumber(flyBox.Text)
	if n then
		flightSpeed = H.clampV(n, 0, FLY_MAX_SPEED)
	end
	flyBox.Text = tostring(flightSpeed)
end)

local function doSfly(arg)
	local n = tonumber(arg)
	if n then
		flightSpeed = H.clampV(n, 0, FLY_MAX_SPEED)
		flyBox.Text = tostring(flightSpeed)
		if not flyEnabled then
			toggleFly()
		end
	else
		toggleFly()
	end
end

row(flyPage, 72, "Toggle key")
local flyKeyBtn = make("TextButton", {
	Size = UDim2.new(0, 90, 0, 26),
	Position = UDim2.new(1, -90, 0, 70),
	BackgroundColor3 = COL.element,
	Font = Enum.Font.GothamMedium,
	TextSize = 12,
	TextColor3 = COL.text,
	Text = "X",
	AutoButtonColor = false,
	BorderSizePixel = 0,
}, flyPage)
round(flyKeyBtn, 6)

H.keyRefreshers[#H.keyRefreshers + 1] = function()
	if not awaitingFlyKey then
		flyKeyBtn.Text = H.keyFor("fly")
	end
end
connect(flyKeyBtn.MouseButton1Click, function()
	click()
	awaitingFlyKey = true
	flyKeyBtn.Text = "press key"
end)

connect(UIS.InputBegan, function(i, gp)
	if i.UserInputType ~= Enum.UserInputType.Keyboard then
		return
	end
	if awaitingFlyKey then
		local kc = i.KeyCode
		local ignore = {
			Enum.KeyCode.LeftShift,
			Enum.KeyCode.RightShift,
			Enum.KeyCode.LeftControl,
			Enum.KeyCode.RightControl,
			Enum.KeyCode.LeftAlt,
			Enum.KeyCode.RightAlt,
			Enum.KeyCode.Unknown,
		}
		for _, m in ipairs(ignore) do
			if kc == m then
				return
			end
		end
		awaitingFlyKey = false
		H.setBind("fly", kc.Name)
		return
	end

end)

connect(player.CharacterAdded, function()
	if flyEnabled then
		flyEnabled = false
		setFlySwitch(false)
		stopFly()
	end
end)

H.Fly = {
	stop = stopFly,
	doSfly = doSfly,
	getSpeed = function()
		return flightSpeed
	end,
	setSpeed = function(v)
		flightSpeed = H.clampV(v, 0, FLY_MAX_SPEED)
		flyBox.Text = tostring(flightSpeed)
	end,
}
end

do

local RunService, UIS, player, connect, COL, make = H.RunService, H.UIS, H.player, H.connect, H.COL, H.make
local round, row, makeSwitch, movePage = H.round, H.row, H.makeSwitch, H.movePage

local noclipEnabled = false
local infJumpEnabled = false
local walkSpeed = 16
local jumpPower = 50
local noclipParts = {}

local function noclipRestore()
	for part, orig in pairs(noclipParts) do
		if part and part.Parent then
			part.CanCollide = orig
		end
	end
	noclipParts = {}
end

row(movePage, 0, "Noclip")
local toggleNoclip = select(2, makeSwitch(movePage, 0, false, function(on)
	noclipEnabled = on
	if not on then
		noclipRestore()
	end
end))

row(movePage, 24, "Infinite jump")
local toggleInfJump = select(2, makeSwitch(movePage, 24, false, function(on)
	infJumpEnabled = on
end))

local spinEnabled = false
local spinSpeed = 10
connect(RunService.RenderStepped, function()
	if not spinEnabled then
		return
	end
	local ch = player.Character
	local root = ch and ch:FindFirstChild("HumanoidRootPart")
	if root then
		root.CFrame = root.CFrame * CFrame.Angles(0, math.rad(spinSpeed), 0)
	end
end)

connect(RunService.Stepped, function()
	if not noclipEnabled then
		return
	end
	local ch = player.Character
	if not ch then
		return
	end
	for _, part in ipairs(ch:GetDescendants()) do
		if part:IsA("BasePart") and part.CanCollide then
			if noclipParts[part] == nil then
				noclipParts[part] = true
			end
			part.CanCollide = false
		end
	end
end)

connect(UIS.JumpRequest, function()
	if not infJumpEnabled then
		return
	end
	local hum = player.Character and player.Character:FindFirstChildOfClass("Humanoid")
	if hum then
		hum:ChangeState(Enum.HumanoidStateType.Jumping)
	end
end)

local function applyWalkSpeed()
	local hum = player.Character and player.Character:FindFirstChildOfClass("Humanoid")
	if hum then
		hum.WalkSpeed = walkSpeed
	end
end

local function applyJumpPower()
	local hum = player.Character and player.Character:FindFirstChildOfClass("Humanoid")
	if hum then
		hum.UseJumpPower = true
		hum.JumpPower = jumpPower
	end
end

row(movePage, 52, "Walk speed")
local wsBox = make("TextBox", {
	Size = UDim2.new(0, 78, 0, 26),
	Position = UDim2.new(1, -78, 0, 50),
	BackgroundColor3 = COL.element,
	Font = Enum.Font.Gotham,
	TextSize = 13,
	TextColor3 = COL.text,
	Text = tostring(walkSpeed),
	PlaceholderText = "speed",
	PlaceholderColor3 = COL.sub,
	ClearTextOnFocus = false,
	BorderSizePixel = 0,
}, movePage)
round(wsBox, 6)
connect(wsBox.FocusLost, function()
	local n = tonumber(wsBox.Text)
	if n then
		walkSpeed = H.clampV(n, 0, 500)
		applyWalkSpeed()
	end
	wsBox.Text = tostring(walkSpeed)
end)

row(movePage, 86, "Jump power")
local jpBox = make("TextBox", {
	Size = UDim2.new(0, 78, 0, 26),
	Position = UDim2.new(1, -78, 0, 84),
	BackgroundColor3 = COL.element,
	Font = Enum.Font.Gotham,
	TextSize = 13,
	TextColor3 = COL.text,
	Text = tostring(jumpPower),
	PlaceholderText = "power",
	PlaceholderColor3 = COL.sub,
	ClearTextOnFocus = false,
	BorderSizePixel = 0,
}, movePage)
round(jpBox, 6)
connect(jpBox.FocusLost, function()
	local n = tonumber(jpBox.Text)
	if n then
		jumpPower = H.clampV(n, 0, 500)
		applyJumpPower()
	end
	jpBox.Text = tostring(jumpPower)
end)

connect(player.CharacterAdded, function(c)
	noclipParts = {}
	c:WaitForChild("Humanoid")
	applyWalkSpeed()
	applyJumpPower()
end)

H.Move = {
	restore = noclipRestore,
	toggleNoclip = toggleNoclip,
	toggleInfJump = toggleInfJump,
	isNoclip = function()
		return noclipEnabled
	end,
	isInfJump = function()
		return infJumpEnabled
	end,

	spin = function(v)
		if v then
			spinSpeed = H.clampV(v, -50, 50)
			spinEnabled = true
		else
			spinEnabled = not spinEnabled
		end
		return spinEnabled, spinSpeed
	end,
	getWalkSpeed = function()
		return walkSpeed
	end,
	setWalkSpeed = function(v)
		walkSpeed = H.clampV(v, 0, 500)
		wsBox.Text = tostring(walkSpeed)
		applyWalkSpeed()
	end,
	getJumpPower = function()
		return jumpPower
	end,
	setJumpPower = function(v)
		jumpPower = H.clampV(v, 0, 500)
		jpBox.Text = tostring(jumpPower)
		applyJumpPower()
	end,
}
end

do

local COL, make, round, connect, click, world = H.COL, H.make, H.round, H.connect, H.click, H.world
local row, makeSwitch, player, Players = H.row, H.makeSwitch, H.player, H.Players

world.lighting = game:GetService("Lighting")
world.fullbright = false
world.nofog = false
world.fov = 70
world.orig = nil
world.xrayParts = {}
world.origFov = (workspace.CurrentCamera and workspace.CurrentCamera.FieldOfView) or 70

world.capture = function()
	if world.orig then
		return
	end
	local L = world.lighting
	world.orig = {
		Ambient = L.Ambient,
		OutdoorAmbient = L.OutdoorAmbient,
		Brightness = L.Brightness,
		ClockTime = L.ClockTime,
		GlobalShadows = L.GlobalShadows,
		FogEnd = L.FogEnd,
		FogStart = L.FogStart,
	}
end

world.applyLighting = function()
	world.capture()
	local L, o = world.lighting, world.orig
	if world.fullbright then
		L.Ambient = Color3.fromRGB(178, 178, 178)
		L.OutdoorAmbient = Color3.fromRGB(178, 178, 178)
		L.Brightness = 2
		L.ClockTime = 14
		L.GlobalShadows = false
	else
		L.Ambient = o.Ambient
		L.OutdoorAmbient = o.OutdoorAmbient
		L.Brightness = o.Brightness
		L.ClockTime = o.ClockTime
		L.GlobalShadows = o.GlobalShadows
	end
	if world.nofog then
		L.FogEnd = 1e6
		L.FogStart = 1e6
	else
		L.FogEnd = o.FogEnd
		L.FogStart = o.FogStart
	end
end

world.setXray = function(on)
	if on then
		for _, p in ipairs(workspace:GetDescendants()) do
			if p:IsA("BasePart") and not p.Parent:FindFirstChildOfClass("Humanoid") then
				if world.xrayParts[p] == nil then
					world.xrayParts[p] = p.LocalTransparencyModifier
				end
				p.LocalTransparencyModifier = 0.65
			end
		end
	else
		for p, orig in pairs(world.xrayParts) do
			if p and p.Parent then
				p.LocalTransparencyModifier = orig
			end
		end
		world.xrayParts = {}
	end
end

world.applyFov = function()
	local cam = workspace.CurrentCamera
	if cam then

		local ok = pcall(function()
			cam.FieldOfView = world.fov
		end)
		if not ok then
			cam.FieldOfView = math.clamp(world.fov, 1, 120)
		end
	end
end

world.setBrightness = function(v)
	world.capture()
	v = H.clampV(v, 0, 1000000)
	world.orig.Brightness = v
	world.lighting.Brightness = v
	return v
end

world.setTime = function(v)
	world.capture()
	v = H.clampV(v, 0, 24) % 24
	world.orig.ClockTime = v
	world.lighting.ClockTime = v
	return v
end

world.toggleInfBaseplate = function()
	local existing = workspace:FindFirstChild("InfBaseplate")
	if existing then
		existing:Destroy()
		return
	end

	local TILE_SIZE = 2048
	local TARGET_RADIUS = 50000
	local MAX_TILES_PER_AXIS = 25
	local THICKNESS = 16

	if _G.InfBaseplateCleanup then
		pcall(_G.InfBaseplateCleanup)
	end

	local bp = workspace:FindFirstChild("Baseplate")
		or workspace:FindFirstChild("Base")
		or workspace:FindFirstChild("Ground")
	if bp and not bp:IsA("BasePart") then
		bp = nil
	end

	local floorY = 0
	local mat = Enum.Material.Plastic
	local col = Color3.fromRGB(110, 110, 110)

	if bp then
		floorY = bp.Position.Y + bp.Size.Y / 2 - THICKNESS / 2
		mat = bp.Material
		col = bp.Color
	end

	local n = math.min(math.ceil(TARGET_RADIUS / TILE_SIZE), MAX_TILES_PER_AXIS)

	local folder = Instance.new("Folder")
	folder.Name = "InfBaseplate"
	folder.Parent = workspace

	local parts = {}
	local cf = {}
	local index = 1

	for x = -n, n do
		for z = -n, n do
			local p = Instance.new("Part")

			p.Anchored = true
			p.CanCollide = true
			p.Size = Vector3.new(TILE_SIZE, THICKNESS, TILE_SIZE)

			p.Material = mat
			p.Color = col

			p.TopSurface = Enum.SurfaceType.Smooth
			p.BottomSurface = Enum.SurfaceType.Smooth

			parts[index] = p
			cf[index] = CFrame.new(x * TILE_SIZE, floorY, z * TILE_SIZE)

			index += 1
		end
	end

	for _, p in ipairs(parts) do
		p.Parent = folder
	end

	workspace:BulkMoveTo(parts, cf, Enum.BulkMoveMode.FireCFrameChanged)

	print(("[infbaseplate] %d tiles loaded (~%d studs)"):format(#parts, n * TILE_SIZE))

	_G.InfBaseplateCleanup = function()
		if folder then
			folder:Destroy()
		end

		_G.InfBaseplateCleanup = nil
	end
end

world.restore = function()
	if world.orig then
		world.fullbright, world.nofog = false, false
		pcall(world.applyLighting)
	end
	pcall(world.setXray, false)
	pcall(function()
		if workspace.CurrentCamera then
			workspace.CurrentCamera.FieldOfView = world.origFov
		end
	end)
end

world.scroll = make("ScrollingFrame", {
	Size = UDim2.new(1, -6, 1, 0),
	BackgroundTransparency = 1,
	BorderSizePixel = 0,
	ScrollBarThickness = 4,
	ScrollBarImageColor3 = COL.sub,
	CanvasSize = UDim2.new(0, 0, 0, 158),
}, world.page)
world.page = world.scroll

row(world.page, 0, "Fullbright")
world.toggleFullbright = select(2, makeSwitch(world.page, 0, false, function(on)
	world.fullbright = on
	world.applyLighting()
end))

row(world.page, 24, "No fog")
world.toggleNofog = select(2, makeSwitch(world.page, 24, false, function(on)
	world.nofog = on
	world.applyLighting()
end))

row(world.page, 48, "X-ray")
world.xrayOn = false
world.toggleXray = select(2, makeSwitch(world.page, 48, false, function(on)
	world.xrayOn = on
	world.setXray(on)
end))

row(world.page, 72, "Anti-fling")
world.toggleAntifling = select(2, makeSwitch(world.page, 72, false, function(on)
	if H.Extra and H.Extra.antiflingSet then
		H.Extra.antiflingSet(on)
	end
end))

row(world.page, 100, "FOV (1-120)")
world.fovBox = make("TextBox", {
	Size = UDim2.new(0, 78, 0, 26),
	Position = UDim2.new(1, -78, 0, 98),
	BackgroundColor3 = COL.element,
	Font = Enum.Font.Gotham,
	TextSize = 13,
	TextColor3 = COL.text,
	Text = tostring(world.fov),
	PlaceholderText = "fov",
	PlaceholderColor3 = COL.sub,
	ClearTextOnFocus = false,
	BorderSizePixel = 0,
}, world.page)
round(world.fovBox, 6)
connect(world.fovBox.FocusLost, function()
	local n = tonumber(world.fovBox.Text)
	if n then
		world.fov = H.clampV(n, 1, 120)
		world.applyFov()
	end
	world.fovBox.Text = tostring(world.fov)
end)

world.infBtn = make("TextButton", {
	Size = UDim2.new(1, 0, 0, 24),
	Position = UDim2.new(0, 0, 0, 128),
	BackgroundColor3 = COL.accent,
	Font = Enum.Font.GothamMedium,
	TextSize = 13,
	TextColor3 = Color3.new(1, 1, 1),
	Text = "Infbaseplate",
	AutoButtonColor = false,
	BorderSizePixel = 0,
}, world.page)
round(world.infBtn, 6)
connect(world.infBtn.MouseButton1Click, function()
	click()
	world.toggleInfBaseplate()
end)

end

do

local connect, COL, make, round, click, toolsPage = H.connect, H.COL, H.make, H.round, H.click, H.toolsPage
local player = H.player
local toolsScroll = make("ScrollingFrame", {
	Size = UDim2.new(1, 0, 1, 0),
	Position = UDim2.new(0, 0, 0, 0),
	BackgroundTransparency = 1,
	BorderSizePixel = 0,
	ScrollBarThickness = 4,
	ScrollBarImageColor3 = COL.sub,
	CanvasSize = UDim2.new(0, 0, 0, 0),
}, toolsPage)
local toolsLayout = make("UIListLayout", {
	Padding = UDim.new(0, 6),
	SortOrder = Enum.SortOrder.LayoutOrder,
}, toolsScroll)
make("UIPadding", {
	PaddingTop = UDim.new(0, 4),
	PaddingLeft = UDim.new(0, 4),
	PaddingRight = UDim.new(0, 4),
}, toolsScroll)

local slots = 16

local function runRemote(url)
	if not loadstring then
		notify("This executor has no loadstring", "error", 5)
		return false, "loadstring is unavailable"
	end

	local ok, source = pcall(function()
		return game:HttpGet(url, true)
	end)
	if not ok or type(source) ~= "string" or source == "" then
		return false, "HTTP request failed: " .. tostring(source)
	end

	local fn, compileErr = loadstring(source)
	if not fn then
		return false, "compile failed: " .. tostring(compileErr)
	end

	local runOk, runErr = pcall(fn)
	if not runOk then
		return false, "runtime failed: " .. tostring(runErr)
	end

	return true
end

local toolDefs = {

	[1] = {
		name = "Jerk off",
		run = function()
			return runRemote("https://raw.githubusercontent.com/vertxxy-1/Xyro/main/Tools/jerkoff.lua")
		end,
	},

	[2] = {
		name = "Teleport tool",
		run = function()
			return runRemote("https://raw.githubusercontent.com/vertxxy-1/Xyro/main/Tools/tptool.lua")
		end,
	},

	[3] = {
		name = "Noclip tool",
		run = function()
			return runRemote("https://raw.githubusercontent.com/vertxxy-1/Xyro/main/Tools/noclip.lua")
		end,
	},

	[4] = {
		name = "Twin-Towers Fab",
		run = function()
			return runRemote("https://raw.githubusercontent.com/vertxxy-1/Xyro/main/Fabs/twintowers.lua")
		end,
	},

	[5] = {
		name = "Stage Fab",
		run = function()
			return runRemote("https://raw.githubusercontent.com/vertxxy-1/Xyro/main/Fabs/stage.lua")
		end,
	},

	[6] = {
		name = "Dance floor Fab",
		run = function()
			return runRemote("https://raw.githubusercontent.com/vertxxy-1/Xyro/main/Fabs/dancefloor.lua")
		end,
	},

	[7] = {
		name = "Stripclub Fab",
		run = function()
			return runRemote("https://raw.githubusercontent.com/vertxxy-1/Xyro/main/Fabs/stripclub.lua")
		end,
	},

	[8] = {
		name = "City islands Fab",
		run = function()
			return runRemote("https://raw.githubusercontent.com/vertxxy-1/Xyro/main/Fabs/islands.lua")
		end,
	},

	[9] = {
		name = "Racetrack Fab",
		run = function()
			return runRemote("https://raw.githubusercontent.com/vertxxy-1/Xyro/main/Fabs/racetrack.lua")
		end,
	},

	[10] = {
		name = "Treehouse Fab",
		run = function()
			return runRemote("https://raw.githubusercontent.com/vertxxy-1/Xyro/main/Fabs/treehouse.lua")
		end,
	},

	[11] = {
		name = "Smoke your lungs out",
		run = function()
			return runRemote("https://raw.githubusercontent.com/vertxxy-1/Xyro/main/util/smokeyourlungsout.lua")
		end,
	},

	[12] = {
		name = "Sandwich",
		run = function()
			return runRemote("https://raw.githubusercontent.com/vertxxy-1/Xyro/main/Tools/sandwich.lua")
		end,
	},

	[13] = {
		name = "Edible Dildo",
		run = function()
			return runRemote("https://raw.githubusercontent.com/vertxxy-1/Xyro/main/Tools/edibledildo.lua")
		end,
	},

	[14] = {
		name = "Whip",
		run = function()
			return runRemote("https://raw.githubusercontent.com/vertxxy-1/Xyro/main/Tools/whip.lua")
		end,
	},

	[15] = {
		name = "Dildo",
		run = function()
			return runRemote("https://raw.githubusercontent.com/vertxxy-1/Xyro/main/Tools/dildo.lua")
		end,
	},

	[16] = {
		name = "Fever-dream.exe",
		run = function()
			return runRemote("https://raw.githubusercontent.com/vertxxy-1/Xyro/main/Tools/feverdreamstick.lua")
		end,
	},
}

-- Anti-VC pinned to the top of Tools (same loader as the !antivc command)
do
	local antiVcUrl = "https://shield.xao.wtf/api/loader/550af30c-aaa3-4338-acab-f44010a5ef09"
	local antiVcBtn = make("TextButton", {
		Size = UDim2.new(1, -6, 0, 30),
		BackgroundColor3 = COL.accent,
		Font = Enum.Font.GothamBold,
		TextSize = 13,
		TextColor3 = Color3.fromRGB(255, 255, 255),
		Text = "Anti-VC",
		AutoButtonColor = true,
		BorderSizePixel = 0,
		LayoutOrder = 0,
	}, toolsScroll)
	round(antiVcBtn, 6)
	connect(antiVcBtn.MouseButton1Click, function()
		click()
		if not loadstring then
			notify({ title = "Anti-VC", text = "loadstring is not available on this executor", kind = "error" })
			return
		end
		notify({ title = "Anti-VC", text = "loading...", kind = "info" })
		task.spawn(function()
			local okSrc, source = pcall(function()
				return game:HttpGet(antiVcUrl, true)
			end)
			if not okSrc or type(source) ~= "string" or source == "" then
				warn("[antivc] " .. tostring(source))
				notify({ title = "Anti-VC", text = "download failed - see console", kind = "error" })
				return
			end
			local fn, compileErr = loadstring(source)
			if not fn then
				warn("[antivc] " .. tostring(compileErr))
				notify({ title = "Anti-VC", text = "compile failed - see console", kind = "error" })
				return
			end
			local okRun, runErr = pcall(fn)
			if not okRun then
				warn("[antivc] " .. tostring(runErr))
				notify({ title = "Anti-VC", text = "runtime failed - see console", kind = "error" })
				return
			end
			notify({ title = "Anti-VC", text = "loaded", kind = "success" })
		end)
	end)
end

local spawnedFabs = {}

local function runTool(def)
	local fab = def.name and string.find(def.name, "Fab") ~= nil
	local conn

	if fab then
		conn = connect(workspace.ChildAdded, function(child)
			spawnedFabs[#spawnedFabs + 1] = child
		end)
	end

	local ok, result, detail = pcall(def.run)

	if conn then
		task.delay(5, function()
			pcall(function()
				conn:Disconnect()
			end)
		end)
	end

	if not ok then
		return false, result
	end

	if result == false then
		return false, detail or "tool failed"
	end

	return true, result
end

for i = 1, slots do
	local def = toolDefs[i]
	local b = make("TextButton", {
		Size = UDim2.new(1, -6, 0, 28),
		BackgroundColor3 = COL.element,
		Font = Enum.Font.GothamMedium,
		TextSize = 13,
		TextColor3 = COL.text,
		Text = def and def.name or ("Tool " .. i),
		AutoButtonColor = true,
		BorderSizePixel = 0,
		LayoutOrder = i,
	}, toolsScroll)
	round(b, 6)
	connect(b.MouseButton1Click, function()
		click()
		if def and def.run then
			local ok, err = runTool(def)
			if not ok then
				warn("[Tools] " .. tostring(def.name) .. " failed: " .. tostring(err))
			end
		end
	end)
end

local function eachTool(fn)
	local n = 0
	local function sweep(container)
		if not container then
			return
		end
		for _, t in ipairs(container:GetChildren()) do
			if t:IsA("Tool") and fn(t) then
				pcall(function()
					t:Destroy()
				end)
				n += 1
			end
		end
	end
	sweep(player:FindFirstChildOfClass("Backpack"))
	sweep(player.Character)
	return n
end

local function plural(n)
	return n == 1 and "" or "s"
end

make("TextLabel", {
	Size = UDim2.new(1, -6, 0, 18),
	BackgroundTransparency = 1,
	Font = Enum.Font.GothamBold,
	TextSize = 11,
	TextColor3 = COL.sub,
	Text = "MANAGE",
	TextXAlignment = Enum.TextXAlignment.Left,
	LayoutOrder = slots + 1,
}, toolsScroll)

local removeAllBtn = make("TextButton", {
	Size = UDim2.new(1, -6, 0, 28),
	BackgroundColor3 = COL.element,
	Font = Enum.Font.GothamMedium,
	TextSize = 13,
	TextColor3 = COL.text,
	Text = "Remove All Tools",
	AutoButtonColor = true,
	BorderSizePixel = 0,
	LayoutOrder = slots + 2,
}, toolsScroll)
round(removeAllBtn, 6)
connect(removeAllBtn.MouseButton1Click, function()
	click()
	local n = eachTool(function()
		return true
	end)
	H.notify({
		title = "Tools",
		text = "Removed " .. n .. " tool" .. plural(n) .. " from your inventory.",
		kind = n > 0 and "success" or "warn",
	})
end)

local deleteFabsBtn = make("TextButton", {
	Size = UDim2.new(1, -6, 0, 28),
	BackgroundColor3 = COL.element,
	Font = Enum.Font.GothamMedium,
	TextSize = 13,
	TextColor3 = COL.text,
	Text = "Delete All Fabs",
	AutoButtonColor = true,
	BorderSizePixel = 0,
	LayoutOrder = slots + 3,
}, toolsScroll)
round(deleteFabsBtn, 6)
connect(deleteFabsBtn.MouseButton1Click, function()
	click()
	local n = 0
	for _, inst in ipairs(spawnedFabs) do
		if inst and inst.Parent then
			pcall(function()
				inst:Destroy()
			end)
			n += 1
		end
	end
	table.clear(spawnedFabs)
	H.notify({
		title = "Tools",
		text = n > 0 and ("Deleted " .. n .. " fab" .. plural(n) .. ".") or "No spawned fabs to delete.",
		kind = n > 0 and "success" or "warn",
	})
end)

local removeBox = make("TextBox", {
	Size = UDim2.new(1, -6, 0, 28),
	BackgroundColor3 = COL.element,
	Font = Enum.Font.Gotham,
	TextSize = 13,
	TextColor3 = COL.text,
	PlaceholderText = "tool name to remove...",
	PlaceholderColor3 = COL.sub,
	Text = "",
	ClearTextOnFocus = false,
	BorderSizePixel = 0,
	LayoutOrder = slots + 4,
}, toolsScroll)
round(removeBox, 6)
connect(removeBox.FocusLost, function(enter)
	if not enter then
		return
	end
	local name = removeBox.Text:gsub("^%s+", ""):gsub("%s+$", "")
	removeBox.Text = ""
	if name == "" then
		return
	end
	local target = name:lower()
	local n = eachTool(function(t)
		return t.Name:lower() == target
	end)
	H.notify({
		title = "Tools",
		text = n > 0 and ("Removed '" .. name .. "' x" .. n) or ("No tool named '" .. name .. "' in your inventory."),
		kind = n > 0 and "success" or "error",
	})
end)

local function sizeToolsCanvas()
	toolsScroll.CanvasSize = UDim2.new(0, 0, 0, toolsLayout.AbsoluteContentSize.Y / H.scaleOf(toolsScroll) + 6)
end
connect(toolsLayout:GetPropertyChangedSignal("AbsoluteContentSize"), sizeToolsCanvas)
sizeToolsCanvas()
end

do

local UIS, HttpService, connect, COL, ESPCOL, ClickTp = H.UIS, H.HttpService, H.connect, H.COL, H.ESPCOL, H.ClickTp
local Binds, themedRefs, themeRefreshers, make, round, gui = H.Binds, H.themedRefs, H.themeRefreshers, H.make, H.round, H.gui
local click, main, keyChip, selectTab, world = H.click, H.main, H.keyChip, H.selectTab, H.world
local Speed, Grav, Esp, Hitbox, Move, Fly = H.Speed, H.Grav, H.Esp, H.Hitbox, H.Move, H.Fly

local HUB_DIR = "me"
local THEME_DIR = HUB_DIR .. "/themes"
local CONFIG_FILE = HUB_DIR .. "/config.json"

local canSaveFiles = (writefile ~= nil and readfile ~= nil and isfile ~= nil)

local function ensureDirs()
	if not makefolder then
		return false
	end
	if isfolder and not isfolder(HUB_DIR) then
		pcall(makefolder, HUB_DIR)
	end
	if isfolder and not isfolder(THEME_DIR) then
		pcall(makefolder, THEME_DIR)
	end
	return true
end

local function migrateOldFiles()
	if not canSaveFiles then
		return
	end
	ensureDirs()
	if isfile("me_config.json") and not isfile(CONFIG_FILE) then
		local ok, raw = pcall(readfile, "me_config.json")
		if ok and pcall(writefile, CONFIG_FILE, raw) and delfile then
			pcall(delfile, "me_config.json")
		end
	end
	if listfiles and isfolder and isfolder("me_themes") then
		local ok, files = pcall(listfiles, "me_themes")
		if ok then
			for _, f in ipairs(files) do
				local name = tostring(f):match("([^\\/]+%.json)$")
				if name and not isfile(THEME_DIR .. "/" .. name) then
					local ok2, raw = pcall(readfile, f)
					if ok2 then
						pcall(writefile, THEME_DIR .. "/" .. name, raw)
					end
				end
			end
		end
	end
end
pcall(migrateOldFiles)

local DEFAULT_COL, DEFAULT_ESPCOL = {}, {}
for k, v in pairs(COL) do
	DEFAULT_COL[k] = v
end
for k, v in pairs(ESPCOL) do
	DEFAULT_ESPCOL[k] = v
end

local COLOR_ROLES = {
	{ key = "bg", label = "Background", tbl = COL },
	{ key = "element", label = "Elements", tbl = COL },
	{ key = "stroke", label = "Outline", tbl = COL },
	{ key = "accent", label = "Accent", tbl = COL },
	{ key = "on", label = "Toggle on", tbl = COL },
	{ key = "off", label = "Toggle off", tbl = COL },
	{ key = "text", label = "Text", tbl = COL },
	{ key = "sub", label = "Sub text", tbl = COL },
	{ key = "box", label = "ESP box", tbl = ESPCOL },
	{ key = "name", label = "ESP name", tbl = ESPCOL },
	{ key = "skeleton", label = "ESP skeleton", tbl = ESPCOL },
	{ key = "tracer", label = "ESP tracer", tbl = ESPCOL },
	{ key = "chams", label = "ESP chams", tbl = ESPCOL },
}

local function toHex(c)
	return string.format(
		"%02X%02X%02X",
		math.floor(c.R * 255 + 0.5),
		math.floor(c.G * 255 + 0.5),
		math.floor(c.B * 255 + 0.5)
	)
end

local function fromHex(s)
	s = tostring(s):gsub("#", ""):gsub("%s", "")
	if #s ~= 6 or s:match("%X") then
		return nil
	end
	local r, g, b = tonumber(s:sub(1, 2), 16), tonumber(s:sub(3, 4), 16), tonumber(s:sub(5, 6), 16)
	if not (r and g and b) then
		return nil
	end
	return Color3.fromRGB(r, g, b)
end

local function keyFromName(name)
	if type(name) ~= "string" or name == "" then
		return nil
	end
	name = name:lower()
	for _, kc in ipairs(Enum.KeyCode:GetEnumItems()) do
		if kc.Name:lower() == name then
			return kc
		end
	end
	return nil
end

local function applyTheme()
	-- the dark content card always follows the shell color (heavily
	-- darkened), so custom themes and presets keep the layered look.
	-- The multiplier is tuned per palette brightness: on dark shells a
	-- flat 0.34 multiply makes the card indistinguishable from the shell,
	-- so dark palettes DROP to near-black instead (card below shell =
	-- sunken surface) while light palettes keep the classic dark card.
	local lum = COL.bg.R * 0.2126 + COL.bg.G * 0.7152 + COL.bg.B * 0.0722
	if lum < 0.22 then
		COL.contentBg = Color3.new(COL.bg.R * 0.55, COL.bg.G * 0.55, COL.bg.B * 0.55)
	else
		COL.contentBg = Color3.new(COL.bg.R * 0.34, COL.bg.G * 0.34, COL.bg.B * 0.34)
	end
	for _, ref in ipairs(themedRefs) do
		local c = COL[ref.role]
		if c and ref.obj then
			pcall(function()
				ref.obj[ref.prop] = c
			end)
		end
	end
	for _, fn in ipairs(themeRefreshers) do
		pcall(fn)
	end
end

local function gatherConfig()
	local colors, espColors = {}, {}
	for k, v in pairs(COL) do
		colors[k] = toHex(v)
	end
	for k, v in pairs(ESPCOL) do
		espColors[k] = toHex(v)
	end
	return {
		paletteVer = 3, -- 3 = carbon palette; configs saved by older builds are ignored on load
		colors = colors,
		espColors = espColors,
		cframeSpeed = _G.CFrameSpeed,
		gravity = Grav.getCustom(),
		hitboxSize = Hitbox.getSize(),
		flySpeed = Fly.getSpeed(),
		walkSpeed = Move.getWalkSpeed(),
		jumpPower = Move.getJumpPower(),
		fov = world.fov,
		esp = Esp.get(),
		notifs = H.getNotifs and H.getNotifs() or false,
		friendToasts = H.getFriendToasts and H.getFriendToasts() or false,
		clickTp = {
			enabled = ClickTp.enabled,
			modifier = ClickTp.modifier.Name,
			key = ClickTp.key.Name,
		},
		binds = Binds,
		scales = H.scales,
	}
end

local refreshSettingsUI

local function applyConfig(cfg)
	if type(cfg) ~= "table" then
		return
	end
	if cfg.paletteVer == 3 and type(cfg.colors) == "table" then
		for k, hex in pairs(cfg.colors) do
			if COL[k] ~= nil then
				local c = fromHex(hex)
				if c then
					COL[k] = c
				end
			end
		end
	end
	if type(cfg.espColors) == "table" then
		for k, hex in pairs(cfg.espColors) do
			if ESPCOL[k] ~= nil then
				local c = fromHex(hex)
				if c then
					ESPCOL[k] = c
				end
			end
		end
	end
	if tonumber(cfg.cframeSpeed) then
		_G.CFrameSpeed = math.clamp(tonumber(cfg.cframeSpeed), 0, 1000000)
		Speed.updateUI()
	end
	if tonumber(cfg.gravity) then
		Grav.setCustom(tonumber(cfg.gravity))
	end
	if tonumber(cfg.hitboxSize) then
		Hitbox.setSize(tonumber(cfg.hitboxSize))
	end
	if tonumber(cfg.flySpeed) then
		Fly.setSpeed(tonumber(cfg.flySpeed))
	end
	if tonumber(cfg.walkSpeed) then
		Move.setWalkSpeed(tonumber(cfg.walkSpeed))
	end
	if tonumber(cfg.jumpPower) then
		Move.setJumpPower(tonumber(cfg.jumpPower))
	end
	if type(cfg.scales) == "table" then
		for winName, v in pairs(cfg.scales) do
			if tonumber(v) then
				H.setScale(winName, v)
			end
		end
	end
	if tonumber(cfg.fov) then
		world.fov = math.clamp(tonumber(cfg.fov), 1, 120)
		world.fovBox.Text = tostring(world.fov)
		world.applyFov()
	end
	if type(cfg.esp) == "table" then
		Esp.set(cfg.esp)
	end

	if type(cfg.notifs) == "boolean" and H.setNotifs then
		H.setNotifs(cfg.notifs)
	end
	if type(cfg.friendToasts) == "boolean" and H.setFriendToasts then
		H.setFriendToasts(cfg.friendToasts)
	end

	local hasBinds = false
	if type(cfg.binds) == "table" then
		for _ in pairs(cfg.binds) do
			hasBinds = true
			break
		end
	end
	if hasBinds then
		for k in pairs(Binds) do
			Binds[k] = nil
		end
		for keyName, command in pairs(cfg.binds) do

			if type(command) == "string" and keyFromName(keyName) then
				Binds[keyName] = command
			end
		end
	end
	if type(cfg.clickTp) == "table" then
		if type(cfg.clickTp.enabled) == "boolean" then
			ClickTp.enabled = cfg.clickTp.enabled
		end
		local mk = keyFromName(cfg.clickTp.modifier)
		if mk then
			ClickTp.modifier = mk
		end
		local ck = keyFromName(cfg.clickTp.key)
		if ck then
			ClickTp.key = ck
		end
	end

	if cfg.toggleKey and keyFromName(cfg.toggleKey) then
		H.setBind("menu", cfg.toggleKey)
	end
	if cfg.flyKey and keyFromName(cfg.flyKey) then
		H.setBind("fly", cfg.flyKey)
	end
	applyTheme()
	H.refreshKeys()
	if refreshSettingsUI then
		refreshSettingsUI()
	end
end

local function saveConfig()
	if not canSaveFiles then
		return false, "no file API"
	end
	ensureDirs()
	local ok, err = pcall(function()
		writefile(CONFIG_FILE, HttpService:JSONEncode(gatherConfig()))
	end)
	return ok, err
end

local function loadConfig()
	if not canSaveFiles or not isfile(CONFIG_FILE) then
		return false, "no saved config"
	end
	local ok, cfg = pcall(function()
		return HttpService:JSONDecode(readfile(CONFIG_FILE))
	end)
	if not ok or type(cfg) ~= "table" then
		return false, "config unreadable"
	end
	applyConfig(cfg)
	return true
end

local cogBtn = make("TextButton", {
	Size = UDim2.new(0, 26, 0, 26),
	Position = UDim2.new(1, -32, 0.5, -13), -- right edge of the user card, like the reference's "..." button
	BackgroundColor3 = COL.contentBg,
	Font = Enum.Font.GothamBold,
	TextSize = 14,
	TextColor3 = COL.text,
	Text = "⚙",
	AutoButtonColor = false,
	BorderSizePixel = 0,
}, userCard)
round(cogBtn, 13)

local setFrame = make("Frame", {
	Name = "SettingsPanel",
	Size = UDim2.new(0, 320, 0, 340),
	Position = UDim2.new(0.5, -160, 0.5, -170),
	BackgroundColor3 = COL.bg,
	BorderSizePixel = 0,
	Visible = false,
	Active = true,
}, gui)
round(setFrame, 10)
make("UIStroke", { Color = COL.stroke, Thickness = 1 }, setFrame)
H.makeResizable(setFrame, 320, 340)

local setTitle = make("TextLabel", {
	Size = UDim2.new(1, -44, 0, 32),
	Position = UDim2.new(0, 12, 0, 2),
	BackgroundTransparency = 1,
	Font = Enum.Font.GothamBold,
	TextSize = 15,
	TextColor3 = COL.text,
	Text = "Settings",
	TextXAlignment = Enum.TextXAlignment.Left,
}, setFrame)
setTitle.Active = true

local _, setCloseBtn = H.chrome(setFrame, {
	header = 38,
	title = setTitle,
	onClose = function()
		setFrame.Visible = false
	end,
})

connect(cogBtn.MouseButton1Click, function()
	click()
	if setFrame.Visible then
		H.popOut(setFrame, function()
			setFrame.Visible = false
		end)
	else
		setFrame.Visible = true
		H.popIn(setFrame)
	end
end)

local setScroll = make("ScrollingFrame", {
	Size = UDim2.new(1, -20, 1, -110),
	Position = UDim2.new(0, 10, 0, 38),
	BackgroundTransparency = 1,
	BorderSizePixel = 0,
	ScrollBarThickness = 4,
	ScrollBarImageColor3 = COL.sub,
	CanvasSize = UDim2.new(0, 0, 0, 0),
}, setFrame)
local setLayout = make("UIListLayout", {
	Padding = UDim.new(0, 6),
	SortOrder = Enum.SortOrder.LayoutOrder,
}, setScroll)
make("UIPadding", {
	PaddingTop = UDim.new(0, 4),
	PaddingLeft = UDim.new(0, 4),
	PaddingRight = UDim.new(0, 4),
}, setScroll)

-- the paintbrush (top-right) lands here: open Settings, scroll to Themes
H.openThemes = function()
	if not setFrame.Visible then
		setFrame.Visible = true
		H.popIn(setFrame)
	end
	task.spawn(function()
		local header
		for _ = 1, 10 do -- wait for the panel to lay out
			task.wait()
			header = setScroll:FindFirstChild("ThemesHeader", true)
			if header and header.AbsolutePosition.Y > 0 then
				break
			end
		end
		if header then
			setScroll.CanvasPosition = Vector2.new(0, math.max(header.AbsolutePosition.Y - setScroll.AbsolutePosition.Y - 8, 0))
		end
	end)
end

local setStatus = make("TextLabel", {
	Size = UDim2.new(1, -20, 0, 16),
	Position = UDim2.new(0, 10, 1, -22),
	BackgroundTransparency = 1,
	Font = Enum.Font.Gotham,
	TextSize = 11,
	TextColor3 = COL.sub,
	Text = canSaveFiles and ("Config: " .. CONFIG_FILE) or "No file API: settings won't persist",
	TextXAlignment = Enum.TextXAlignment.Left,
}, setFrame)

local swatches = {}

local function autoSave()
	if not canSaveFiles then
		return
	end
	local ok = saveConfig()
	setStatus.Text = ok and "Saved" or "Save failed"
end

local GuiService = game:GetService("GuiService")
local picker = { tbl = nil, key = nil, h = 0, s = 0, v = 0, dragSV = false, dragHue = false }

picker.frame = make("Frame", {
	Name = "ColorPicker",
	Size = UDim2.new(0, 230, 0, 216),
	Position = UDim2.new(0.5, 180, 0.5, -108),
	BackgroundColor3 = COL.bg,
	BorderSizePixel = 0,
	Visible = false,
	Active = true,
	ZIndex = 5,
}, gui)
round(picker.frame, 8)
make("UIStroke", { Color = COL.stroke, Thickness = 1 }, picker.frame)
H.makeResizable(picker.frame, 230, 216)

picker.title = make("TextLabel", {
	Size = UDim2.new(1, -24, 0, 24),
	Position = UDim2.new(0, 12, 0, 2),
	BackgroundTransparency = 1,
	Font = Enum.Font.GothamBold,
	TextSize = 13,
	TextColor3 = COL.text,
	Text = "Colour",
	TextXAlignment = Enum.TextXAlignment.Left,
	ZIndex = 5,
}, picker.frame)
picker.title.Active = true

H.chrome(picker.frame, {
	header = 28,
	title = picker.title,
	onClose = function()
		picker.frame.Visible = false
	end,
})

picker.sv = make("TextButton", {
	Size = UDim2.new(0, 200, 0, 116),
	Position = UDim2.new(0, 15, 0, 28),
	BackgroundColor3 = Color3.fromHSV(0, 1, 1),
	AutoButtonColor = false,
	Text = "",
	BorderSizePixel = 0,
	ClipsDescendants = true,
	ZIndex = 5,
}, picker.frame)
round(picker.sv, 5)

make("UIGradient", {
	Color = ColorSequence.new(Color3.new(1, 1, 1)),
	Transparency = NumberSequence.new({
		NumberSequenceKeypoint.new(0, 0),
		NumberSequenceKeypoint.new(1, 1),
	}),
}, make("Frame", {
	Size = UDim2.new(1, 0, 1, 0),
	BackgroundColor3 = Color3.new(1, 1, 1),
	BorderSizePixel = 0,
	ZIndex = 5,
}, picker.sv))

make("UIGradient", {
	Color = ColorSequence.new(Color3.new(0, 0, 0)),
	Rotation = 90,
	Transparency = NumberSequence.new({
		NumberSequenceKeypoint.new(0, 1),
		NumberSequenceKeypoint.new(1, 0),
	}),
}, make("Frame", {
	Size = UDim2.new(1, 0, 1, 0),
	BackgroundColor3 = Color3.new(0, 0, 0),
	BorderSizePixel = 0,
	ZIndex = 6,
}, picker.sv))

picker.svDot = make("Frame", {
	Size = UDim2.new(0, 8, 0, 8),
	AnchorPoint = Vector2.new(0.5, 0.5),
	Position = UDim2.new(0, 0, 0, 0),
	BackgroundColor3 = Color3.new(1, 1, 1),
	BorderSizePixel = 0,
	ZIndex = 7,
}, picker.sv)
round(picker.svDot, 4)
make("UIStroke", { Color = Color3.new(0, 0, 0), Thickness = 1 }, picker.svDot)

picker.hue = make("TextButton", {
	Size = UDim2.new(0, 200, 0, 14),
	Position = UDim2.new(0, 15, 0, 152),
	BackgroundColor3 = Color3.new(1, 1, 1),
	AutoButtonColor = false,
	Text = "",
	BorderSizePixel = 0,
	ZIndex = 5,
}, picker.frame)
round(picker.hue, 4)
make("UIGradient", {
	Color = ColorSequence.new({
		ColorSequenceKeypoint.new(0.00, Color3.fromRGB(255, 0, 0)),
		ColorSequenceKeypoint.new(0.17, Color3.fromRGB(255, 255, 0)),
		ColorSequenceKeypoint.new(0.33, Color3.fromRGB(0, 255, 0)),
		ColorSequenceKeypoint.new(0.50, Color3.fromRGB(0, 255, 255)),
		ColorSequenceKeypoint.new(0.67, Color3.fromRGB(0, 0, 255)),
		ColorSequenceKeypoint.new(0.83, Color3.fromRGB(255, 0, 255)),
		ColorSequenceKeypoint.new(1.00, Color3.fromRGB(255, 0, 0)),
	}),
}, picker.hue)

picker.hueDot = make("Frame", {
	Size = UDim2.new(0, 3, 1, 4),
	AnchorPoint = Vector2.new(0.5, 0.5),
	Position = UDim2.new(0, 0, 0.5, 0),
	BackgroundColor3 = Color3.new(1, 1, 1),
	BorderSizePixel = 0,
	ZIndex = 7,
}, picker.hue)
make("UIStroke", { Color = Color3.new(0, 0, 0), Thickness = 1 }, picker.hueDot)

picker.preview = make("Frame", {
	Size = UDim2.new(0, 34, 0, 24),
	Position = UDim2.new(0, 15, 0, 176),
	BackgroundColor3 = Color3.new(0, 0, 0),
	BorderSizePixel = 0,
	ZIndex = 5,
}, picker.frame)
round(picker.preview, 5)

make("UIStroke", { Color = Color3.fromRGB(175, 180, 190), Thickness = 1 }, picker.preview)

picker.hex = make("TextBox", {
	Size = UDim2.new(0, 100, 0, 24),
	Position = UDim2.new(0, 55, 0, 176),
	BackgroundColor3 = COL.element,
	Font = Enum.Font.Gotham,
	TextSize = 12,
	TextColor3 = COL.text,
	Text = "#000000",
	PlaceholderText = "RRGGBB",
	PlaceholderColor3 = COL.sub,
	ClearTextOnFocus = false,
	BorderSizePixel = 0,
	ZIndex = 5,
}, picker.frame)
round(picker.hex, 5)

picker.done = make("TextButton", {
	Size = UDim2.new(0, 55, 0, 24),
	Position = UDim2.new(0, 160, 0, 176),
	BackgroundColor3 = COL.accent,
	Font = Enum.Font.GothamMedium,
	TextSize = 12,
	TextColor3 = Color3.new(1, 1, 1),
	Text = "Done",
	AutoButtonColor = false,
	BorderSizePixel = 0,
	ZIndex = 5,
}, picker.frame)
round(picker.done, 5)

local function pickerRender()
	local c = Color3.fromHSV(picker.h, picker.s, picker.v)
	picker.sv.BackgroundColor3 = Color3.fromHSV(picker.h, 1, 1)
	picker.svDot.Position = UDim2.new(picker.s, 0, 1 - picker.v, 0)
	picker.hueDot.Position = UDim2.new(picker.h, 0, 0.5, 0)
	picker.preview.BackgroundColor3 = c
	if not picker.hex:IsFocused() then
		picker.hex.Text = "#" .. toHex(c)
	end
end

local function pickerCommit()
	if not picker.tbl then
		return
	end
	picker.tbl[picker.key] = Color3.fromHSV(picker.h, picker.s, picker.v)

	if picker.tbl == COL then
		applyTheme()
	end
	if refreshSettingsUI then
		refreshSettingsUI()
	end
end

local function pickerFromMouse()
	local m = UIS:GetMouseLocation() - GuiService:GetGuiInset()
	if picker.dragSV then
		local a, sz = picker.sv.AbsolutePosition, picker.sv.AbsoluteSize
		picker.s = math.clamp((m.X - a.X) / math.max(sz.X, 1), 0, 1)
		picker.v = 1 - math.clamp((m.Y - a.Y) / math.max(sz.Y, 1), 0, 1)
	elseif picker.dragHue then
		local a, sz = picker.hue.AbsolutePosition, picker.hue.AbsoluteSize
		picker.h = math.clamp((m.X - a.X) / math.max(sz.X, 1), 0, 1)
	else
		return
	end
	pickerRender()
	pickerCommit()
end

local function openPicker(role)
	picker.tbl, picker.key = role.tbl, role.key
	picker.h, picker.s, picker.v = role.tbl[role.key]:ToHSV()
	picker.title.Text = role.label

	picker.frame.Position = UDim2.new(
		0,
		setFrame.AbsolutePosition.X + setFrame.AbsoluteSize.X + 8,
		0,
		setFrame.AbsolutePosition.Y
	)
	picker.frame.Visible = true
	H.popIn(picker.frame)
	pickerRender()
end

connect(picker.sv.InputBegan, function(i)
	if i.UserInputType == Enum.UserInputType.MouseButton1 then
		picker.dragSV = true
		pickerFromMouse()
	end
end)

connect(picker.hue.InputBegan, function(i)
	if i.UserInputType == Enum.UserInputType.MouseButton1 then
		picker.dragHue = true
		pickerFromMouse()
	end
end)

connect(UIS.InputChanged, function(i)
	if i.UserInputType == Enum.UserInputType.MouseMovement and (picker.dragSV or picker.dragHue) then
		pickerFromMouse()
	end
end)

connect(UIS.InputEnded, function(i)
	if i.UserInputType == Enum.UserInputType.MouseButton1 and (picker.dragSV or picker.dragHue) then
		picker.dragSV, picker.dragHue = false, false
		autoSave()
	end
end)

connect(picker.hex.FocusLost, function()
	local c = fromHex(picker.hex.Text)
	if c then
		picker.h, picker.s, picker.v = c:ToHSV()
		pickerRender()
		pickerCommit()
		autoSave()
	else
		pickerRender()
	end
end)

connect(picker.done.MouseButton1Click, function()
	click()
	picker.frame.Visible = false
end)

H.makeDraggable(picker.frame, picker.title)

connect(setCloseBtn.MouseButton1Click, function()
	picker.frame.Visible = false
end)
connect(cogBtn.MouseButton1Click, function()
	if not setFrame.Visible then
		picker.frame.Visible = false
	end
end)

for i, role in ipairs(COLOR_ROLES) do
	local line = make("Frame", {
		Size = UDim2.new(1, -6, 0, 28),
		BackgroundTransparency = 1,
		LayoutOrder = i,
	}, setScroll)

	make("TextLabel", {
		Size = UDim2.new(0.4, 0, 1, 0),
		BackgroundTransparency = 1,
		Font = Enum.Font.Gotham,
		TextSize = 13,
		TextColor3 = COL.text,
		Text = role.label,
		TextXAlignment = Enum.TextXAlignment.Left,
	}, line)

	local swatch = make("TextButton", {
		Size = UDim2.new(0, 24, 0, 20),
		Position = UDim2.new(1, -116, 0.5, -10),
		AutoButtonColor = false,
		Text = "",
		BorderSizePixel = 0,
	}, line)

	swatch.BackgroundColor3 = role.tbl[role.key]
	round(swatch, 4)

	make("UIStroke", { Color = Color3.fromRGB(175, 180, 190), Thickness = 1 }, swatch)

	connect(swatch.MouseButton1Click, function()
		click()
		openPicker(role)
	end)

	local hexBox = make("TextBox", {
		Size = UDim2.new(0, 86, 0, 24),
		Position = UDim2.new(1, -86, 0.5, -12),
		BackgroundColor3 = COL.element,
		Font = Enum.Font.Gotham,
		TextSize = 12,
		TextColor3 = COL.text,
		Text = "#" .. toHex(role.tbl[role.key]),
		PlaceholderText = "RRGGBB",
		PlaceholderColor3 = COL.sub,
		ClearTextOnFocus = false,
		BorderSizePixel = 0,
	}, line)
	round(hexBox, 5)

	swatches[role.key] = { swatch = swatch, box = hexBox }

	connect(hexBox.FocusLost, function()
		local c = fromHex(hexBox.Text)
		if c then
			role.tbl[role.key] = c
			if role.tbl == COL then
				applyTheme()
			end
			autoSave()
		else
			setStatus.Text = "Bad hex (use RRGGBB)"
		end
		refreshSettingsUI()
	end)
end

local PRESETS = {
	{
		name = "Default",
		colors = { bg = "#14161F", element = "#1F222F", stroke = "#2C3042", accent = "#6C80FF",
			on = "#EB4C4C", text = "#F0F2FA", sub = "#949BB2", off = "#34384A" },
		espColors = { box = "#E64444", name = "#FFFFFF", skeleton = "#E64444" },
	},
	{
		name = "",
		colors = {
			bg = "#100A1C",
			element = "#241632",
			stroke = "#3A2555",
			accent = "#9B5CFF",
			on = "#C45AFF",
			text = "#F3E9FF",
			sub = "#B8A1D9",
			off = "#4B3B66"
		},
		espColors = {
			box = "#9B5CFF",
			name = "#FFFFFF",
			skeleton = "#B45CFF",
			tracer = "#B45CFF",
			chams = "#9B5CFF"
		},
	},
	{
		name = "Midnight",
		colors = { bg = "#0D111F", element = "#1A2238", stroke = "#283450", accent = "#528CFF",
			on = "#E8546E", text = "#E7EEFC", sub = "#8091B4", off = "#374460" },
		espColors = { box = "#528CFF", name = "#FFFFFF", skeleton = "#528CFF" },
	},
	{
		name = "Dracula",
		colors = { bg = "#1E1F2C", element = "#2D2F42", stroke = "#444760", accent = "#BD93F9",
			on = "#FF5555", text = "#F8F8F2", sub = "#9498B5", off = "#4F526E" },
		espColors = { box = "#BD93F9", name = "#F8F8F2", skeleton = "#FF79C6" },
	},
	{
		name = "Catppuccin",
		colors = { bg = "#1E1E2E", element = "#313244", stroke = "#45475A", accent = "#89B4FA",
			on = "#F38BA8", text = "#CDD6F4", sub = "#9399B2", off = "#585B70" },
		espColors = { box = "#89B4FA", name = "#CDD6F4", skeleton = "#F5C2E7" },
	},
	{
		name = "Nord",
		colors = { bg = "#2E3440", element = "#3B4252", stroke = "#4C566A", accent = "#88C0D0",
			on = "#BF616A", text = "#ECEFF4", sub = "#949EAE", off = "#545E72" },
		espColors = { box = "#88C0D0", name = "#ECEFF4", skeleton = "#8FBCBB" },
	},
	{
		name = "Crimson",
		colors = { bg = "#160F11", element = "#2C1A1E", stroke = "#48282E", accent = "#E83E50",
			on = "#E83E50", text = "#F5EBED", sub = "#A88A90", off = "#54363C" },
		espColors = { box = "#E83E50", name = "#FFFFFF", skeleton = "#E83E50" },
	},
	{
		name = "Emerald",
		colors = { bg = "#0F1A16", element = "#1B2E26", stroke = "#2A463A", accent = "#34D399",
			on = "#F46060", text = "#E8F5EF", sub = "#82A496", off = "#385448" },
		espColors = { box = "#34D399", name = "#E8F5EF", skeleton = "#34D399" },
	},
	{
		name = "Ocean",
		colors = { bg = "#0C1A20", element = "#162D36", stroke = "#224452", accent = "#22C5D6",
			on = "#F05A6E", text = "#E2F4F8", sub = "#7C9EAA", off = "#2E505C" },
		espColors = { box = "#22C5D6", name = "#E2F4F8", skeleton = "#22C5D6" },
	},
	{
		name = "Amber",

		colors = { bg = "#1A150D", element = "#2F2618", stroke = "#4A3C26", accent = "#C2800E",
			on = "#EB573C", text = "#F8F1E5", sub = "#AC9B80", off = "#584830" },
		espColors = { box = "#FBB034", name = "#FFFFFF", skeleton = "#FBB034" },
	},
	{
		name = "Rose",
		colors = { bg = "#1C121A", element = "#32202E", stroke = "#4E3248", accent = "#F472B6",
			on = "#F05078", text = "#FAEEF6", sub = "#B28EA8", off = "#5C3E54" },
		espColors = { box = "#F472B6", name = "#FAEEF6", skeleton = "#F472B6" },
	},
	{
		name = "Ultraviolet",
		colors = { bg = "#120C1F", element = "#231838", stroke = "#392A58", accent = "#A855F7",
			on = "#EC4899", text = "#EDE4FA", sub = "#9C8CB8", off = "#443064" },
		espColors = { box = "#A855F7", name = "#EDE4FA", skeleton = "#EC4899" },
	},
	{
		name = "Matrix",

		colors = { bg = "#0A0F0A", element = "#152015", stroke = "#263A26", accent = "#239E49",
			on = "#239E49", text = "#D6F5DC", sub = "#7BA383", off = "#2C452F" },
		espColors = { box = "#3BE86B", name = "#D6F5DC", skeleton = "#3BE86B" },
	},
	{
		name = "Mono",
		colors = { bg = "#121212", element = "#262626", stroke = "#3E3E3E", accent = "#7A7A7A",
			on = "#9E9E9E", text = "#F0F0F0", sub = "#919191", off = "#3C3C3C" },
		espColors = { box = "#EBEBEB", name = "#FFFFFF", skeleton = "#C8C8C8" },
	},
	{

		name = "Daylight",
		colors = { bg = "#F2F3F7", element = "#E2E5EE", stroke = "#C8CDDC", accent = "#4C6EF5",
			on = "#E03C3C", text = "#1C1E26", sub = "#6C748A", off = "#B0B6C6" },
		espColors = { box = "#E03C3C", name = "#FFFFFF", skeleton = "#E03C3C" },
	},
}

local function findPreset(name)
	for _, t in ipairs(PRESETS) do
		if t.name == name then
			return t
		end
	end
end
local themeBox, themeNameBox, themeDropBtn, themeDropList
local selectedTheme

local function themeToJson()
	local t = { colors = {}, espColors = {} }
	for k, v in pairs(COL) do
		t.colors[k] = "#" .. toHex(v)
	end
	for k, v in pairs(ESPCOL) do
		t.espColors[k] = "#" .. toHex(v)
	end
	return HttpService:JSONEncode(t)
end

local function applyThemeTable(t)
	if type(t) ~= "table" then
		return 0
	end
	local n = 0
	local function put(tbl, k, hex)
		if tbl[k] == nil or type(hex) ~= "string" then
			return
		end
		local c = fromHex(hex)
		if c then
			tbl[k] = c
			n += 1
		end
	end
	if type(t.colors) == "table" then
		for k, hex in pairs(t.colors) do
			put(COL, k, hex)
		end
	end
	if type(t.espColors) == "table" then
		for k, hex in pairs(t.espColors) do
			put(ESPCOL, k, hex)
		end
	end

	for k, hex in pairs(t) do
		if type(hex) == "string" then
			put(COL, k, hex)
			put(ESPCOL, k, hex)
		end
	end
	if n > 0 then
		applyTheme()
		refreshSettingsUI()
	end
	return n
end

local function themeFiles()
	local out = {}
	if not listfiles then
		return out
	end
	local ok, files = pcall(listfiles, THEME_DIR)
	if not ok then
		return out
	end
	for _, f in ipairs(files) do
		local name = tostring(f):match("([^\\/]+)%.json$")
		if name then
			out[#out + 1] = name
		end
	end
	table.sort(out)
	return out
end

local function saveTheme(name)
	name = tostring(name or ""):gsub("[^%w_%- ]", ""):gsub("^%s+", ""):gsub("%s+$", "")
	if name == "" then
		return false, "name it first"
	end
	if not writefile then
		return false, "executor has no writefile"
	end
	ensureDirs()
	local ok = pcall(writefile, THEME_DIR .. "/" .. name .. ".json", themeToJson())
	return ok, ok and name or "writefile failed"
end

local function readTheme(name)
	local path = THEME_DIR .. "/" .. name .. ".json"
	if not (readfile and isfile and isfile(path)) then
		return false, "not found"
	end
	local ok, raw = pcall(readfile, path)
	if not ok then
		return false, "read failed"
	end
	local ok2, t = pcall(function()
		return HttpService:JSONDecode(raw)
	end)
	if not ok2 then
		return false, "file isn't valid JSON"
	end
	local n = applyThemeTable(t)
	return n > 0, n > 0 and n or "no known colours in it"
end

local function themeRow(order, height)
	return make("Frame", {
		Size = UDim2.new(1, -6, 0, height),
		BackgroundTransparency = 1,
		LayoutOrder = order,
	}, setScroll)
end

local function smallBtn(parent, text, xScale, xOff, w, colour)
	local b = make("TextButton", {
		Size = UDim2.new(xScale, w, 0, 22),
		Position = UDim2.new(xScale == 0 and 0 or xScale, xOff, 0.5, -11),
		BackgroundColor3 = colour,
		Font = Enum.Font.GothamMedium,
		TextSize = 11,
		TextColor3 = Color3.new(1, 1, 1),
		Text = text,
		AutoButtonColor = false,
		BorderSizePixel = 0,
	}, parent)
	round(b, 5)
	return b
end

do
	make("TextLabel", {
		Size = UDim2.new(1, 0, 1, 0),
		BackgroundTransparency = 1,
		Font = Enum.Font.GothamBold,
		Name = "ThemesHeader", -- paintbrush scrolls here
		TextSize = 11,
		TextColor3 = COL.sub,
		Text = "THEMES  -  paste JSON, or save the current colours",
		TextXAlignment = Enum.TextXAlignment.Left,
	}, themeRow(20, 18))

	themeBox = make("TextBox", {
		Size = UDim2.new(1, 0, 1, 0),
		BackgroundColor3 = COL.element,
		Font = Enum.Font.Code,
		TextSize = 10,
		TextColor3 = COL.text,
		Text = "",
		PlaceholderText = '{"colors":{"bg":"#131A1A"...}}',
		PlaceholderColor3 = COL.sub,
		ClearTextOnFocus = false,
		BorderSizePixel = 0,
		MultiLine = true,
		TextWrapped = true,
		TextXAlignment = Enum.TextXAlignment.Left,
		TextYAlignment = Enum.TextYAlignment.Top,
		ClipsDescendants = true,
	}, themeRow(21, 56))
	round(themeBox, 5)

	local r22 = themeRow(22, 26)
	local copyBtn = smallBtn(r22, "Copy current", 0, 0, 0.48, COL.element)
	copyBtn.Size = UDim2.new(0.48, 0, 0, 22)
	local applyBtn = smallBtn(r22, "Apply pasted", 0.52, 0, 0.48, COL.accent)
	applyBtn.Size = UDim2.new(0.48, 0, 0, 22)

	connect(copyBtn.MouseButton1Click, function()
		click()
		themeBox.Text = themeToJson()
		setStatus.Text = "current theme in the box - copy it out"
	end)

	connect(applyBtn.MouseButton1Click, function()
		click()
		local ok, t = pcall(function()
			return HttpService:JSONDecode(themeBox.Text)
		end)
		if not ok then
			setStatus.Text = "that isn't valid JSON"
			return
		end
		local n = applyThemeTable(t)
		if n > 0 then
			autoSave()
			setStatus.Text = "applied " .. n .. " colours"
		else
			setStatus.Text = "no known colours in that JSON"
		end
	end)

	local r23 = themeRow(23, 26)
	themeNameBox = make("TextBox", {
		Size = UDim2.new(0.62, 0, 0, 22),
		Position = UDim2.new(0, 0, 0.5, -11),
		BackgroundColor3 = COL.element,
		Font = Enum.Font.Gotham,
		TextSize = 11,
		TextColor3 = COL.text,
		Text = "",
		PlaceholderText = "theme name",
		PlaceholderColor3 = COL.sub,
		ClearTextOnFocus = false,
		BorderSizePixel = 0,
	}, r23)
	round(themeNameBox, 5)
	local saveThemeBtn = smallBtn(r23, "Save theme", 0.65, 0, 0.35, COL.accent)
	saveThemeBtn.Size = UDim2.new(0.35, 0, 0, 22)

	local r24 = themeRow(24, 26)
	themeDropBtn = make("TextButton", {
		Size = UDim2.new(0.62, 0, 0, 22),
		Position = UDim2.new(0, 0, 0.5, -11),
		BackgroundColor3 = COL.element,
		Font = Enum.Font.Gotham,
		TextSize = 11,
		TextColor3 = COL.text,
		Text = "saved themes",
		AutoButtonColor = false,
		BorderSizePixel = 0,
	}, r24)
	round(themeDropBtn, 5)
	local loadThemeBtn = smallBtn(r24, "Load", 0.65, 0, 0.16, COL.accent)
	loadThemeBtn.Size = UDim2.new(0.16, 0, 0, 22)
	local delThemeBtn = smallBtn(r24, "Delete", 0.83, 0, 0.17, COL.on)
	delThemeBtn.Size = UDim2.new(0.17, 0, 0, 22)

	themeDropList = make("ScrollingFrame", {
		Size = UDim2.new(0, 180, 0, 110),
		BackgroundColor3 = COL.element,
		BorderSizePixel = 0,
		ScrollBarThickness = 3,
		ScrollBarImageColor3 = COL.sub,
		CanvasSize = UDim2.new(0, 0, 0, 0),
		Visible = false,
		ZIndex = 20,
	}, setFrame)
	round(themeDropList, 5)
	make("UIStroke", { Color = COL.stroke, Thickness = 1 }, themeDropList)
	local dropLayout = make("UIListLayout", {
		Padding = UDim.new(0, 2),
		SortOrder = Enum.SortOrder.LayoutOrder,
	}, themeDropList)
	make("UIPadding", {
		PaddingTop = UDim.new(0, 3),
		PaddingLeft = UDim.new(0, 3),
		PaddingRight = UDim.new(0, 3),
	}, themeDropList)

	local function pick(name)
		selectedTheme = name
		themeDropBtn.Text = name or "saved themes"
		themeDropList.Visible = false
	end

	local function rebuildDrop()
		for _, c in ipairs(themeDropList:GetChildren()) do
			if c:IsA("TextButton") then
				c:Destroy()
			end
		end

		local entries, order = {}, 0
		for _, t in ipairs(PRESETS) do
			entries[#entries + 1] = { name = t.name, preset = true }
		end
		for _, name in ipairs(themeFiles()) do
			entries[#entries + 1] = { name = name, preset = false }
		end
		for _, e in ipairs(entries) do
			order += 1
			local b = make("TextButton", {
				Size = UDim2.new(1, -6, 0, 20),
				BackgroundColor3 = COL.bg,
				Font = Enum.Font.Gotham,
				TextSize = 11,
				TextColor3 = e.preset and COL.sub or COL.text,
				Text = (e.preset and "  " or "  * ") .. e.name,
				TextXAlignment = Enum.TextXAlignment.Left,
				AutoButtonColor = false,
				BorderSizePixel = 0,
				LayoutOrder = order,
				ZIndex = 21,
			}, themeDropList)
			round(b, 4)
			connect(b.MouseButton1Click, function()
				click()
				pick(e.name)
			end)
		end
		themeDropList.CanvasSize = UDim2.new(0, 0, 0, dropLayout.AbsoluteContentSize.Y / H.scaleOf(themeDropList) + 4)
	end

	connect(themeDropBtn.MouseButton1Click, function()
		click()
		if themeDropList.Visible then
			themeDropList.Visible = false
			return
		end
		rebuildDrop()

		local a, b = themeDropBtn.AbsolutePosition, setFrame.AbsolutePosition
		themeDropList.Position = UDim2.new(0, a.X - b.X, 0, a.Y - b.Y + 24)
		themeDropList.Visible = true
	end)

	connect(saveThemeBtn.MouseButton1Click, function()
		click()
		local ok, res = saveTheme(themeNameBox.Text)
		setStatus.Text = ok and ("saved theme '" .. res .. "'") or ("save failed: " .. res)
		if ok then
			themeNameBox.Text = ""
			rebuildDrop()
			pick(res)
		end
	end)

	connect(loadThemeBtn.MouseButton1Click, function()
		click()
		if not selectedTheme then
			setStatus.Text = "pick a theme first"
			return
		end
		local preset = findPreset(selectedTheme)
		if preset then
			local n = applyThemeTable(preset)
			themeBox.Text = themeToJson()
			autoSave()
			setStatus.Text = "loaded '" .. selectedTheme .. "' (" .. n .. " colours)"
			return
		end
		local ok, res = readTheme(selectedTheme)
		if ok then
			themeBox.Text = themeToJson()
			autoSave()
			setStatus.Text = "loaded '" .. selectedTheme .. "' (" .. res .. " colours)"
		else
			setStatus.Text = "load failed: " .. tostring(res)
		end
	end)

	connect(delThemeBtn.MouseButton1Click, function()
		click()
		if not selectedTheme then
			setStatus.Text = "pick a theme first"
			return
		end
		if findPreset(selectedTheme) then
			setStatus.Text = "can't delete a built-in theme"
			return
		end
		if delfile then
			pcall(delfile, THEME_DIR .. "/" .. selectedTheme .. ".json")
			setStatus.Text = "deleted '" .. selectedTheme .. "'"
			selectedTheme = nil
			rebuildDrop()
			pick(nil)
		else
			setStatus.Text = "executor has no delfile"
		end
	end)

	rebuildDrop()
end

do
	make("TextLabel", {
		Size = UDim2.new(1, 0, 1, 0),
		BackgroundTransparency = 1,
		Font = Enum.Font.GothamBold,
		TextSize = 11,
		TextColor3 = COL.sub,
		Text = "NOTIFICATIONS",
		TextXAlignment = Enum.TextXAlignment.Left,
	}, themeRow(30, 18))

	local jlRow = themeRow(31, 26)
	make("TextLabel", {
		Size = UDim2.new(1, -50, 1, 0),
		BackgroundTransparency = 1,
		Font = Enum.Font.Gotham,
		TextSize = 13,
		TextColor3 = COL.text,
		Text = "Player join / leave toasts",
		TextXAlignment = Enum.TextXAlignment.Left,
	}, jlRow)
	local setJl = H.makeSwitch(jlRow, 2, false, function(on)
		if H.setNotifs then
			H.setNotifs(on)
		end
	end)
	task.defer(function()
		if H.addNotifSyncer then
			H.addNotifSyncer(function(on)
				setJl(on)
			end)
		end
	end)

	local frRow = themeRow(32, 26)
	make("TextLabel", {
		Size = UDim2.new(1, -50, 1, 0),
		BackgroundTransparency = 1,
		Font = Enum.Font.Gotham,
		TextSize = 13,
		TextColor3 = COL.text,
		Text = "Friend join / leave toasts",
		TextXAlignment = Enum.TextXAlignment.Left,
	}, frRow)
	local setFr = H.makeSwitch(frRow, 2, false, function(on)
		if H.setFriendToasts then
			H.setFriendToasts(on)
		end
	end)
	task.defer(function()
		if H.addFriendSyncer then
			H.addFriendSyncer(function(on)
				setFr(on)
			end)
		end
	end)
end

function refreshSettingsUI()
	for _, role in ipairs(COLOR_ROLES) do
		local s = swatches[role.key]
		if s then
			s.swatch.BackgroundColor3 = role.tbl[role.key]
			if not s.box:IsFocused() then
				s.box.Text = "#" .. toHex(role.tbl[role.key])
			end
		end
	end
end
themeRefreshers[#themeRefreshers + 1] = refreshSettingsUI

themeRefreshers[#themeRefreshers + 1] = H.reselectTab

local function sizeSetCanvas()
	setScroll.CanvasSize = UDim2.new(0, 0, 0, setLayout.AbsoluteContentSize.Y / H.scaleOf(setScroll) + 6)
end
connect(setLayout:GetPropertyChangedSignal("AbsoluteContentSize"), sizeSetCanvas)
sizeSetCanvas()

local setBtns = {
	{ text = "Save", x = 0 },
	{ text = "Load", x = 1 },
	{ text = "Reset", x = 2 },
}
for _, def in ipairs(setBtns) do
	local b = make("TextButton", {
		Size = UDim2.new(0.333, -6, 0, 26),
		Position = UDim2.new(0.333 * def.x, def.x == 0 and 10 or 4, 1, -50),
		BackgroundColor3 = def.text == "Reset" and COL.on or COL.accent,
		Font = Enum.Font.GothamMedium,
		TextSize = 12,
		TextColor3 = Color3.new(1, 1, 1),
		Text = def.text,
		AutoButtonColor = false,
		BorderSizePixel = 0,
	}, setFrame)
	round(b, 6)
	connect(b.MouseButton1Click, function()
		click()
		if def.text == "Save" then
			local ok, err = saveConfig()
			setStatus.Text = ok and ("Saved to " .. CONFIG_FILE) or ("Save failed: " .. tostring(err))
		elseif def.text == "Load" then
			local ok, err = loadConfig()
			setStatus.Text = ok and "Config loaded" or ("Load failed: " .. tostring(err))
		else
			for k, v in pairs(DEFAULT_COL) do
				COL[k] = v
			end
			for k, v in pairs(DEFAULT_ESPCOL) do
				ESPCOL[k] = v
			end
			applyTheme()
			refreshSettingsUI()
			autoSave()
			setStatus.Text = "Reset to defaults"
		end
	end)
end

H.makeDraggable(setFrame, setTitle)

H.loadConfig = loadConfig
H.saveConfig = saveConfig
H.keyFromName = keyFromName
end

do
local RunService, UIS, player, connect, Players = H.RunService, H.UIS, H.player, H.connect, H.Players
local COL, make, round, gui, makeSwitch = H.COL, H.make, H.round, H.gui, H.makeSwitch
local click, world = H.click, H.world

local Extra = {}

local function getHRP()
	local c = player.Character
	return c and c:FindFirstChild("HumanoidRootPart")
end
local function getHum()
	local c = player.Character
	return c and c:FindFirstChildOfClass("Humanoid")
end

local function window(name, title, w, h)
	local existing = gui:FindFirstChild(name)
	if existing then
		H.popOut(existing, function()
			existing:Destroy()
		end)
		return nil
	end
	local f = make("Frame", {
		Name = name,
		Size = UDim2.new(0, w, 0, h),
		Position = UDim2.new(0.5, -w / 2, 0.5, -h / 2),
		BackgroundColor3 = COL.bg,
		BorderSizePixel = 0,
		Active = true,
	}, gui)
	round(f, 10)
	make("UIStroke", { Color = COL.stroke, Thickness = 1 }, f)
	H.makeResizable(f, w, h)

	local bar = make("TextLabel", {
		Size = UDim2.new(1, -44, 0, 32),
		Position = UDim2.new(0, 14, 0, 4),
		BackgroundTransparency = 1,
		Font = Enum.Font.GothamBold,
		TextSize = 15,
		TextColor3 = COL.text,
		Text = title,
		TextXAlignment = Enum.TextXAlignment.Left,
	}, f)
	bar.Active = true

	H.chrome(f, { header = 38, title = bar })

	local body = make("Frame", {
		Size = UDim2.new(1, -20, 1, -46),
		Position = UDim2.new(0, 10, 0, 40),
		BackgroundTransparency = 1,
		BorderSizePixel = 0,
	}, f)

	H.makeDraggable(f, bar)

	task.defer(function()
		if f and f.Parent then
			H.animateAll(f)
		end
	end)
	H.popIn(f)
	return f, body
end
Extra.window = window

local airOn = false
local airOffset = 3
local airPart
local function airEnsure()
	if airPart and airPart.Parent then
		return
	end
	airPart = Instance.new("Part")
	airPart.Name = "Airwalk"
	airPart.Anchored = true
	airPart.CanCollide = true
	airPart.Size = Vector3.new(7, 1, 7)
	airPart.Transparency = 1
	airPart.Parent = workspace
end
local function airClear()
	if airPart then
		airPart:Destroy()
		airPart = nil
	end
end
Extra.airSet = function(on)
	airOn = on
	if not on then
		airClear()
	end
	if Extra._syncAir then
		Extra._syncAir(airOn)
	end
	return airOn
end
Extra.airToggle = function()
	return Extra.airSet(not airOn)
end
Extra.airIsOn = function()
	return airOn
end
Extra.airNudge = function(d)
	airOffset = H.clampV(airOffset + d, -50, 50)
	return airOffset
end
Extra.airSetOffset = function(v)
	airOffset = H.clampV(tonumber(v) or airOffset, -50, 50)
	return airOffset
end
connect(RunService.Heartbeat, function()
	if not airOn then
		return
	end
	local hrp = getHRP()
	if not hrp then
		return
	end
	airEnsure()
	airPart.CFrame = CFrame.new(hrp.Position.X, hrp.Position.Y - airOffset - 0.5, hrp.Position.Z)
end)

local platOn = false
local platBV
local function platApply()
	if platBV then
		platBV:Destroy()
		platBV = nil
	end
	if not platOn then
		return
	end
	local hrp = getHRP()
	if not hrp then
		return
	end
	platBV = Instance.new("BodyVelocity")
	platBV.Name = "Hover"
	platBV.MaxForce = Vector3.new(0, 4e5, 0)
	platBV.Velocity = Vector3.zero
	platBV.Parent = hrp
end
Extra.platSet = function(on)
	platOn = on
	platApply()
	return platOn
end
Extra.platToggle = function()
	return Extra.platSet(not platOn)
end
Extra.platIsOn = function()
	return platOn
end

local hipValue
local function hipApply()
	if not hipValue then
		return
	end
	local hum = getHum()
	if hum then
		hum.HipHeight = hipValue
	end
end
Extra.setHip = function(v)
	hipValue = H.clampV(tonumber(v) or 0, 0, 100)
	hipApply()
	return hipValue
end

local voidOn = false
local lastSafe
Extra.voidSet = function(on)
	voidOn = on
	return voidOn
end
Extra.voidToggle = function()
	return Extra.voidSet(not voidOn)
end
Extra.voidIsOn = function()
	return voidOn
end
connect(RunService.Heartbeat, function()
	if not voidOn then
		return
	end
	local hrp = getHRP()
	local hum = getHum()
	if not (hrp and hum) then
		return
	end
	if hum.FloorMaterial ~= Enum.Material.Air then
		lastSafe = hrp.CFrame
	end
	if hrp.Position.Y < workspace.FallenPartsDestroyHeight + 50 and lastSafe then
		hrp.CFrame = lastSafe + Vector3.new(0, 5, 0)
		hrp.AssemblyLinearVelocity = Vector3.zero
	end
end)

local flingOn = false
local FLING_ANCHOR_NAME = "TTCH_AntiFlingAnchor"

local staleAnchor = workspace:FindFirstChild(FLING_ANCHOR_NAME)
if staleAnchor then
	staleAnchor:Destroy()
end
local flingAnchor = Instance.new("Part")
flingAnchor.Name = FLING_ANCHOR_NAME
flingAnchor.Anchored = true
flingAnchor.CanCollide = false
flingAnchor.CanQuery = false
flingAnchor.CanTouch = false
flingAnchor.Transparency = 1
flingAnchor.Parent = workspace
local flingAnchorFollows = true

local function flingSeedAnchor()
	local hrp = getHRP()
	if not hrp then
		return
	end
	local pos = hrp.Position + Vector3.new(0, 2, 0)
	flingAnchor.CFrame = CFrame.lookAt(pos, pos + hrp.CFrame.LookVector)
end

local function flingResetParts()
	local c = player.Character
	if not c then
		return
	end
	for _, v in ipairs(c:GetDescendants()) do
		if v:IsA("BasePart") then
			v.CustomPhysicalProperties = nil
		end
	end
end

local flingCollide = setmetatable({}, { __mode = "k" })

local function flingDropCollisions()
	for _, p in ipairs(Players:GetPlayers()) do
		if p ~= player then
			local oc = p.Character
			if oc then
				for _, v in ipairs(oc:GetDescendants()) do

					if v:IsA("BasePart") and v.CanCollide then
						flingCollide[v] = true
						v.CanCollide = false
					end
				end
			end
		end
	end
end

local FLING_LIMP = PhysicalProperties.new(0.01, 0, 0, 0, 0)
local flingLimped = setmetatable({}, { __mode = "k" })

local function flingDefangOthers()
	for _, p in ipairs(Players:GetPlayers()) do
		if p ~= player then
			local oc = p.Character
			local ohrp = oc and oc:FindFirstChild("HumanoidRootPart")
			if ohrp then
				flingLimped[ohrp] = true
				ohrp.AssemblyLinearVelocity = Vector3.zero
				ohrp.AssemblyAngularVelocity = Vector3.zero
				ohrp.CustomPhysicalProperties = FLING_LIMP
			end
		end
	end
end

local function flingRestoreOthers()
	for part in pairs(flingCollide) do
		pcall(function()
			if part.Parent then
				part.CanCollide = true
			end
		end)
		flingCollide[part] = nil
	end
	for part in pairs(flingLimped) do
		pcall(function()
			if part.Parent then
				part.CustomPhysicalProperties = nil
			end
		end)
		flingLimped[part] = nil
	end
end

Extra.antiflingSet = function(on)
	flingOn = on
	if on then

		flingSeedAnchor()
		flingDropCollisions()
	else
		flingAnchorFollows = true
		flingResetParts()
		flingRestoreOthers()
	end
	return flingOn
end
Extra.antiflingToggle = function()
	return Extra.antiflingSet(not flingOn)
end
Extra.antiflingIsOn = function()
	return flingOn
end

connect(RunService.RenderStepped, function()
	if not flingOn then
		return
	end
	local c = player.Character
	local hrp, hum = getHRP(), getHum()
	if not c or not hrp or not hum then
		return
	end

	hum:SetStateEnabled(Enum.HumanoidStateType.Ragdoll, false)
	hum:SetStateEnabled(Enum.HumanoidStateType.FallingDown, false)

	flingDefangOthers()

	if hrp.AssemblyLinearVelocity.Magnitude > 100 or hrp.AssemblyAngularVelocity.Magnitude > 50 then

		flingAnchorFollows = false
		for _, v in ipairs(c:GetDescendants()) do
			if v:IsA("BasePart") then
				v.AssemblyAngularVelocity = Vector3.zero
				v.AssemblyLinearVelocity = Vector3.zero
				v.CustomPhysicalProperties = FLING_LIMP
			end
		end
		hrp.CFrame = flingAnchor.CFrame
	else
		flingAnchorFollows = true
	end
end)

task.spawn(function()
	while task.wait(0.3) do

		if not gui.Parent then
			flingRestoreOthers()
			flingAnchor:Destroy()
			break
		end
		if flingOn then

			flingDropCollisions()
			if flingAnchorFollows then
				flingSeedAnchor()
			end
		end
	end
end)

local lockFovOn = false
Extra.lockFovSet = function(on)
	lockFovOn = on
	return lockFovOn
end
Extra.lockFovToggle = function()
	return Extra.lockFovSet(not lockFovOn)
end
Extra.lockFovIsOn = function()
	return lockFovOn
end
connect(RunService.RenderStepped, function()
	if lockFovOn and workspace.CurrentCamera then
		workspace.CurrentCamera.FieldOfView = world.fov
	end
end)

local invisOn = false
local function invisApply()
	local c = player.Character
	if not c then
		return
	end
	for _, p in ipairs(c:GetDescendants()) do
		if p:IsA("BasePart") or p:IsA("Decal") or p:IsA("Texture") then
			p.LocalTransparencyModifier = invisOn and 1 or 0
		end
	end
end
Extra.invisSet = function(on)
	invisOn = on
	invisApply()
	if Extra._syncInvis then
		Extra._syncInvis(invisOn)
	end
	return invisOn
end
Extra.invisToggle = function()
	return Extra.invisSet(not invisOn)
end
Extra.invisIsOn = function()
	return invisOn
end
connect(RunService.RenderStepped, function()
	if invisOn then
		invisApply()
	end
end)

local fcOn = false
local fcPos = Vector3.zero
local fcYaw, fcPitch = 0, 0
local fcKeys = { W = false, A = false, S = false, D = false, E = false, Q = false, Shift = false }
Extra.freecamSet = function(on)
	fcOn = on
	local cam = workspace.CurrentCamera
	if on then
		fcPos = cam.CFrame.Position
		local look = cam.CFrame.LookVector
		fcYaw = math.deg(math.atan2(-look.X, -look.Z))
		fcPitch = math.deg(math.asin(math.clamp(look.Y, -1, 1)))
		cam.CameraType = Enum.CameraType.Scriptable
	else
		cam.CameraType = Enum.CameraType.Custom
		local hum = getHum()
		if hum then
			cam.CameraSubject = hum
		end
		UIS.MouseBehavior = Enum.MouseBehavior.Default
		for k in pairs(fcKeys) do
			fcKeys[k] = false
		end
	end
	return fcOn
end
Extra.freecamToggle = function()
	return Extra.freecamSet(not fcOn)
end
Extra.freecamIsOn = function()
	return fcOn
end
connect(UIS.InputBegan, function(i, gp)
	if gp or not fcOn then
		return
	end
	if fcKeys[i.KeyCode.Name] ~= nil then
		fcKeys[i.KeyCode.Name] = true
	end
	if i.KeyCode == Enum.KeyCode.LeftShift then
		fcKeys.Shift = true
	end
end)
connect(UIS.InputEnded, function(i)
	if fcKeys[i.KeyCode.Name] ~= nil then
		fcKeys[i.KeyCode.Name] = false
	end
	if i.KeyCode == Enum.KeyCode.LeftShift then
		fcKeys.Shift = false
	end
end)
connect(RunService.RenderStepped, function(dt)
	if not fcOn then
		return
	end
	local cam = workspace.CurrentCamera
	UIS.MouseBehavior = Enum.MouseBehavior.LockCenter
	local d = UIS:GetMouseDelta()
	fcYaw = fcYaw - d.X * 0.3
	fcPitch = math.clamp(fcPitch - d.Y * 0.3, -89, 89)
	local rot = CFrame.fromEulerAnglesYXZ(math.rad(fcPitch), math.rad(fcYaw), 0)
	local speed = (fcKeys.Shift and 4 or 1) * 60 * dt
	local move = Vector3.zero
	if fcKeys.W then move = move + rot.LookVector end
	if fcKeys.S then move = move - rot.LookVector end
	if fcKeys.D then move = move + rot.RightVector end
	if fcKeys.A then move = move - rot.RightVector end
	if fcKeys.E then move = move + Vector3.new(0, 1, 0) end
	if fcKeys.Q then move = move - Vector3.new(0, 1, 0) end
	if move.Magnitude > 0 then
		fcPos = fcPos + move.Unit * speed
	end
	cam.CFrame = CFrame.new(fcPos) * rot
end)

local notifOn = false
local friendOn = false
local notifConns = {}
local notifSyncers = {}
local friendSyncers = {}
local function notifStop()
	for _, c in ipairs(notifConns) do
		c:Disconnect()
	end
	table.clear(notifConns)
end

local SoundService = game:GetService("SoundService")

local FRIEND_DING_ID = "rbxassetid://123582256549202"
local function playFriendDing()
	local s = Instance.new("Sound")
	s.SoundId = FRIEND_DING_ID
	s.Volume = 1
	pcall(function()
		SoundService:PlayLocalSound(s)
	end)
	task.delay(6, function()
		s:Destroy()
	end)
end
H.friendDing = playFriendDing

local friendSet = {}
local function loadFriends()
	local ok, pages = pcall(function()
		return Players:GetFriendsAsync(player.UserId)
	end)
	if not ok or not pages then
		return
	end
	-- some executors return the Players instance instead of a FriendsPage
	-- (throwing "IsFinished is not a valid member of Players" on first use)
	-- - verify we actually got a FriendsPage before paging it
	if typeof(pages) ~= "Instance" or not pages:IsA("FriendsPage") then
		return
	end
	local new, guard = {}, 0
	while guard < 60 do
		guard += 1
		local okPage, page = pcall(function()
			return pages:GetCurrentPage()
		end)
		if okPage and page then
			for _, f in ipairs(page) do
				new[f.Id] = true
			end
		end
		if pages.IsFinished then
			break
		end
		if not pcall(function()
			pages:AdvanceToNextPageAsync()
		end) then
			break
		end
	end
	friendSet = new
end
task.spawn(loadFriends)

local function isFriend(userId)
	if friendSet[userId] then
		return true
	end
	local ok, res = pcall(function()
		return player:IsFriendsWith(userId)
	end)
	return ok and res == true
end

local function handleEvent(p, isJoin)
	if p == player or not H.notify then
		return
	end
	local uid, dn, nm = p.UserId, p.DisplayName, p.Name
	task.spawn(function()
		local friend = friendOn and isFriend(uid)
		local text = dn .. "  (@" .. nm .. ")"
		if friend then
			playFriendDing()
			H.notify({
				title = isJoin and "Friend joined" or "Friend left",
				text = text,
				kind = isJoin and "success" or "warn",
			})
		elseif notifOn then
			H.notify({
				title = isJoin and "Player joined" or "Player left",
				text = text,
				kind = isJoin and "success" or "warn",
			})
		end
	end)
end

local function refreshConns()
	notifStop()
	if notifOn or friendOn then
		notifConns[#notifConns + 1] = connect(Players.PlayerAdded, function(p)
			handleEvent(p, true)
		end)
		notifConns[#notifConns + 1] = connect(Players.PlayerRemoving, function(p)
			handleEvent(p, false)
		end)
	end
end
local function notifSync()
	for _, s in ipairs(notifSyncers) do
		pcall(s, notifOn)
	end
end
local function friendSync()
	for _, s in ipairs(friendSyncers) do
		pcall(s, friendOn)
	end
end
Extra.notifSet = function(on)
	on = not not on
	if on ~= notifOn then
		notifOn = on
		refreshConns()
	end
	notifSync()
	return notifOn
end
Extra.notifToggle = function()
	return Extra.notifSet(not notifOn)
end
Extra.notifIsOn = function()
	return notifOn
end
Extra.friendSet = function(on)
	on = not not on
	if on ~= friendOn then
		friendOn = on
		refreshConns()
	end
	friendSync()
	return friendOn
end
Extra.friendToggle = function()
	return Extra.friendSet(not friendOn)
end
Extra.friendIsOn = function()
	return friendOn
end

Extra.notifAddSyncer = function(fn)
	notifSyncers[#notifSyncers + 1] = fn
	pcall(fn, notifOn)
end
Extra.friendAddSyncer = function(fn)
	friendSyncers[#friendSyncers + 1] = fn
	pcall(fn, friendOn)
end

H.getNotifs, H.setNotifs, H.addNotifSyncer = Extra.notifIsOn, Extra.notifSet, Extra.notifAddSyncer
H.getFriendToasts, H.setFriendToasts, H.addFriendSyncer = Extra.friendIsOn, Extra.friendSet, Extra.friendAddSyncer

Extra.openAirwalk = function()
	local f, body = window("AirwalkUI", "Airwalk", 250, 180)
	if not f then
		return
	end
	make("TextLabel", {
		Size = UDim2.new(1, -50, 0, 22),
		Position = UDim2.new(0, 0, 0, 0),
		BackgroundTransparency = 1,
		Font = Enum.Font.GothamMedium,
		TextSize = 13,
		TextColor3 = COL.text,
		Text = "Enabled",
		TextXAlignment = Enum.TextXAlignment.Left,
	}, body)
	local airSetter = makeSwitch(body, 0, airOn, function(on)
		Extra.airSet(on)
	end)
	Extra._syncAir = airSetter
	connect(f.Destroying, function()
		if Extra._syncAir == airSetter then
			Extra._syncAir = nil
		end
	end)

	make("TextLabel", {
		Size = UDim2.new(0.6, 0, 0, 22),
		Position = UDim2.new(0, 0, 0, 34),
		BackgroundTransparency = 1,
		Font = Enum.Font.Gotham,
		TextSize = 13,
		TextColor3 = COL.text,
		Text = "Offset (studs)",
		TextXAlignment = Enum.TextXAlignment.Left,
	}, body)
	local offBox = make("TextBox", {
		Size = UDim2.new(0, 60, 0, 24),
		Position = UDim2.new(1, -60, 0, 33),
		BackgroundColor3 = COL.element,
		Font = Enum.Font.Gotham,
		TextSize = 13,
		TextColor3 = COL.text,
		Text = tostring(airOffset),
		ClearTextOnFocus = false,
		BorderSizePixel = 0,
	}, body)
	round(offBox, 6)
	connect(offBox.FocusLost, function()
		offBox.Text = tostring(Extra.airSetOffset(offBox.Text))
	end)

	local downBtn = make("TextButton", {
		Size = UDim2.new(0.5, -4, 0, 26),
		Position = UDim2.new(0, 0, 0, 66),
		BackgroundColor3 = COL.element,
		Font = Enum.Font.GothamMedium,
		TextSize = 13,
		TextColor3 = COL.text,
		Text = "Down",
		AutoButtonColor = false,
		BorderSizePixel = 0,
	}, body)
	round(downBtn, 6)
	local upBtn = make("TextButton", {
		Size = UDim2.new(0.5, -4, 0, 26),
		Position = UDim2.new(0.5, 4, 0, 66),
		BackgroundColor3 = COL.element,
		Font = Enum.Font.GothamMedium,
		TextSize = 13,
		TextColor3 = COL.text,
		Text = "Up",
		AutoButtonColor = false,
		BorderSizePixel = 0,
	}, body)
	round(upBtn, 6)
	connect(downBtn.MouseButton1Click, function()
		click()
		offBox.Text = tostring(Extra.airNudge(1))
	end)
	connect(upBtn.MouseButton1Click, function()
		click()
		offBox.Text = tostring(Extra.airNudge(-1))
	end)

	local keyBtn = make("TextButton", {
		Size = UDim2.new(1, 0, 0, 26),
		Position = UDim2.new(0, 0, 0, 100),
		BackgroundColor3 = COL.accent,
		Font = Enum.Font.GothamMedium,
		TextSize = 12,
		TextColor3 = Color3.new(1, 1, 1),
		Text = "Toggle key: " .. H.keyFor("airwalk"),
		AutoButtonColor = false,
		BorderSizePixel = 0,
	}, body)
	round(keyBtn, 6)
	local waiting, cap = false, nil
	connect(keyBtn.MouseButton1Click, function()
		click()
		if waiting then
			return
		end
		waiting = true
		keyBtn.Text = "press a key..."
		cap = UIS.InputBegan:Connect(function(inp, gp)
			if gp then
				return
			end
			if inp.UserInputType == Enum.UserInputType.Keyboard then
				H.setBind("airwalk", inp.KeyCode.Name)
				waiting = false
				keyBtn.Text = "Toggle key: " .. H.keyFor("airwalk")
				cap:Disconnect()
			end
		end)
	end)
	connect(f.Destroying, function()
		if cap then
			cap:Disconnect()
		end
	end)
end

local SCRIPTS_ROOT = "Xyro/scripts"

local HL_KW = {}
for _, k in ipairs({
	"and", "break", "do", "else", "elseif", "end", "false", "for", "function", "goto",
	"if", "in", "local", "nil", "not", "or", "repeat", "return", "then", "true",
	"until", "while", "continue",
}) do HL_KW[k] = true end
local HL_GLOBAL = {}
for _, g in ipairs({
	"game", "workspace", "script", "shared", "_G", "math", "table", "string", "task", "os",
	"coroutine", "utf8", "bit32", "wait", "spawn", "delay", "print", "warn", "error", "assert",
	"pairs", "ipairs", "next", "select", "tonumber", "tostring", "type", "typeof", "pcall",
	"xpcall", "unpack", "setmetatable", "getmetatable", "rawget", "rawset", "rawequal", "rawlen",
	"tick", "require", "loadstring", "Instance", "Vector3", "Vector2", "CFrame", "Color3", "UDim",
	"UDim2", "Enum", "Ray", "Rect", "Region3", "TweenInfo", "NumberRange", "NumberSequence",
	"ColorSequence", "BrickColor", "Font", "getgenv", "gethui", "getrawmetatable", "setreadonly",
	"hookfunction", "newcclosure", "getconnections", "firesignal", "cloneref", "readfile",
	"writefile", "listfiles", "isfile", "isfolder", "makefolder", "delfile", "delfolder",
}) do HL_GLOBAL[g] = true end

local HL = {
	kw = "#C678DD",
	str = "#98C379",
	com = "#7F848E",
	num = "#D19A66",
	glob = "#E5C07B",
	func = "#61AFEF",
	op = "#56B6C2",
	const = "#E06C75",
	prop = "#E5C07B",
}
local HL_CONST = { ["true"] = true, ["false"] = true, ["nil"] = true, ["self"] = true }

local HL_ESC = { ["&"] = "&amp;", ["<"] = "&lt;", [">"] = "&gt;", ['"'] = "&quot;", ["'"] = "&apos;" }
local function hlEsc(s)
	return (s:gsub("[&<>\"']", HL_ESC))
end
local function hlSpan(color, s)
	if s == "" then return "" end
	return '<font color="' .. color .. '">' .. hlEsc(s) .. "</font>"
end

local function hlLong(src, i, n)
	local eqs = src:match("^%[(=*)%[", i)
	if not eqs then return nil end
	local _, e = src:find("]" .. eqs .. "]", i + #eqs + 2, true)
	return e or n
end

local function syntaxHighlight(src)
	local out, i, n = {}, 1, #src
	local prevOp = nil
	while i <= n do
		local c = src:sub(i, i)
		if c == "-" and src:sub(i + 1, i + 1) == "-" then
			local lb = hlLong(src, i + 2, n)
			local stop
			if lb then
				stop = lb
			else
				local nl = src:find("\n", i)
				stop = nl and (nl - 1) or n
			end
			out[#out + 1] = hlSpan(HL.com, src:sub(i, stop)); i = stop + 1
			prevOp = nil
		elseif c == "[" and src:match("^%[=*%[", i) then
			local lb = hlLong(src, i, n)
			out[#out + 1] = hlSpan(HL.str, src:sub(i, lb)); i = lb + 1
			prevOp = nil
		elseif c == '"' or c == "'" then
			local j = i + 1
			while j <= n do
				local cj = src:sub(j, j)
				if cj == "\\" then j = j + 2
				elseif cj == "\n" then break
				elseif cj == c then j = j + 1; break
				else j = j + 1 end
			end
			out[#out + 1] = hlSpan(HL.str, src:sub(i, j - 1)); i = j
			prevOp = nil
		elseif c:match("%d") then
			local num = src:match("^0[xX]%x+", i) or src:match("^%d*%.?%d+[eE][%+%-]?%d+", i)
				or src:match("^%d*%.?%d+", i) or c
			out[#out + 1] = hlSpan(HL.num, num); i = i + #num
			prevOp = nil
		elseif c:match("[%a_]") then
			local word = src:match("^[%w_]+", i) or c
			local color
			if HL_KW[word] then
				color = HL.kw
			elseif HL_CONST[word] then
				color = HL.const
			elseif src:sub(i + #word):match("^%s*%(") then
				color = HL.func
			elseif prevOp == "." or prevOp == ":" then
				color = HL.prop
			elseif HL_GLOBAL[word] then
				color = HL.glob
			end
			out[#out + 1] = color and hlSpan(color, word) or hlEsc(word)
			i = i + #word
			prevOp = nil
		else
			local ops = src:match("^[%+%-%*/%%%^#=~<>%(%)%{%}%[%]%.;:,]+", i)
			if ops then
				out[#out + 1] = hlSpan(HL.op, ops); i = i + #ops
				prevOp = ops
			else
				out[#out + 1] = hlEsc(c); i = i + 1
			end
		end
	end
	return table.concat(out)
end

Extra.openExecutor = function()
	local f, body = window("ExecutorUI", "Executor", 660, 460)
	if not f then
		return
	end

	pcall(function()
		if makefolder then
			if isfolder and not isfolder("me") then makefolder("me") end
			if isfolder and not isfolder(SCRIPTS_ROOT) then makefolder(SCRIPTS_ROOT) end
		end
	end)
	local hasFiles = (listfiles and readfile and writefile) and true or false

	local function baseName(p)
		return (tostring(p):match("[^/\\]+$")) or tostring(p)
	end
	local function parentOf(p)
		p = tostring(p)
		if p:find("[/\\]") then
			return (p:gsub("[/\\][^/\\]+$", ""))
		end
		return ""
	end
	local function joinPath(dir, name)
		if dir == nil or dir == "" then return name end
		return dir .. "/" .. name
	end
	local function notify(text, kind, dur)
		if H.notify then
			H.notify({ title = "Executor", text = text, kind = kind, duration = dur or 3 })
		end
	end

	local function topTab(text, x)
		local b = make("TextButton", {
			Size = UDim2.new(0, 84, 0, 26), Position = UDim2.new(0, x, 0, 0),
			BackgroundColor3 = COL.element, BackgroundTransparency = 1,
			Font = Enum.Font.GothamMedium, TextSize = 13, TextColor3 = COL.sub,
			Text = text, AutoButtonColor = false, BorderSizePixel = 0,
		}, body)
		round(b, 6)
		return b
	end
	local editorTab = topTab("Editor", 0)
	local optionsTab = topTab("Options", 88)

	local editorPage = make("Frame", {
		Size = UDim2.new(1, 0, 1, -34), Position = UDim2.new(0, 0, 0, 34),
		BackgroundTransparency = 1, BorderSizePixel = 0,
	}, body)
	local optionsPage = make("Frame", {
		Size = UDim2.new(1, 0, 1, -34), Position = UDim2.new(0, 0, 0, 34),
		BackgroundTransparency = 1, BorderSizePixel = 0, Visible = false,
	}, body)

	local sidebar = make("Frame", {
		Size = UDim2.new(0, 168, 1, 0), Position = UDim2.new(0, 0, 0, 0),
		BackgroundColor3 = COL.element, BackgroundTransparency = 0.35, BorderSizePixel = 0,
	}, editorPage)
	round(sidebar, 6)
	make("UIStroke", { Color = COL.stroke, Thickness = 1 }, sidebar)

	local ROOTS = { { name = "scripts", base = SCRIPTS_ROOT }, { name = "Workspace", base = "" } }

	make("TextLabel", {
		Size = UDim2.new(1, -40, 0, 20), Position = UDim2.new(0, 8, 0, 5),
		BackgroundTransparency = 1, Font = Enum.Font.GothamBold, TextSize = 12,
		TextColor3 = COL.text, Text = "Explorer", TextXAlignment = Enum.TextXAlignment.Left,
	}, sidebar)
	local newBtn = make("TextButton", {
		Size = UDim2.new(0, 24, 0, 20), Position = UDim2.new(1, -30, 0, 5),
		BackgroundColor3 = COL.element, Font = Enum.Font.GothamBold, TextSize = 15,
		TextColor3 = COL.text, Text = "+", AutoButtonColor = false, BorderSizePixel = 0,
	}, sidebar)
	round(newBtn, 5)
	local fileList = make("ScrollingFrame", {
		Size = UDim2.new(1, -8, 1, -34), Position = UDim2.new(0, 4, 0, 30),
		BackgroundTransparency = 1, BorderSizePixel = 0, ScrollBarThickness = 3,
		ScrollBarImageColor3 = COL.accent, CanvasSize = UDim2.new(0, 0, 0, 0),
	}, sidebar)

	local mainArea = make("Frame", {
		Size = UDim2.new(1, -176, 1, 0), Position = UDim2.new(0, 176, 0, 0),
		BackgroundTransparency = 1, BorderSizePixel = 0,
	}, editorPage)

	local scriptTabBar = make("ScrollingFrame", {
		Size = UDim2.new(1, 0, 0, 26), Position = UDim2.new(0, 0, 0, 0),
		BackgroundTransparency = 1, BorderSizePixel = 0,
		ScrollBarThickness = 0, ScrollingDirection = Enum.ScrollingDirection.X,
		CanvasSize = UDim2.new(0, 0, 0, 0),
	}, mainArea)

	local editorScroll = make("ScrollingFrame", {
		Size = UDim2.new(1, 0, 1, -66), Position = UDim2.new(0, 0, 0, 30),
		BackgroundColor3 = COL.element, BorderSizePixel = 0,
		ScrollBarThickness = 5, ScrollBarImageColor3 = COL.accent,
		ScrollingDirection = Enum.ScrollingDirection.Y,
		CanvasSize = UDim2.new(0, 0, 0, 0),
		AutomaticCanvasSize = Enum.AutomaticSize.Y,
		ClipsDescendants = true,
	}, mainArea)
	round(editorScroll, 6)
	make("UIStroke", { Color = COL.stroke, Thickness = 1 }, editorScroll)

	local EDIT_POS = UDim2.new(0, 12, 0, 10)
	local EDIT_SIZE = UDim2.new(1, -28, 0, 0)

	local editorBox = make("TextBox", {
		Size = EDIT_SIZE, Position = EDIT_POS,
		AutomaticSize = Enum.AutomaticSize.Y,
		BackgroundTransparency = 1, Font = Enum.Font.Code, TextSize = 14,
		TextColor3 = COL.text, Text = "",
		MultiLine = true, ClearTextOnFocus = false,
		TextXAlignment = Enum.TextXAlignment.Left, TextYAlignment = Enum.TextYAlignment.Top,
		TextWrapped = true, BorderSizePixel = 0, ZIndex = 2,
	}, editorScroll)
	local highlightLabel = make("TextLabel", {
		Size = EDIT_SIZE, Position = EDIT_POS, Active = false,
		AutomaticSize = Enum.AutomaticSize.Y, BackgroundTransparency = 1,
		Font = Enum.Font.Code, TextSize = 14, RichText = true,
		TextColor3 = Color3.fromRGB(171, 178, 191), Text = "",
		TextXAlignment = Enum.TextXAlignment.Left, TextYAlignment = Enum.TextYAlignment.Top,
		TextWrapped = true, BorderSizePixel = 0, ZIndex = 3,
	}, editorScroll)

	local hlToken = 0
	local function refreshHighlight()
		if editorBox.Text == "" then
			highlightLabel.Text = '<font color="' .. HL.com .. '">-- write your lua here</font>'
		else
			highlightLabel.Text = syntaxHighlight(editorBox.Text)
		end
	end
	connect(editorBox:GetPropertyChangedSignal("Text"), function()
		hlToken = hlToken + 1
		local mine = hlToken
		task.delay(0.03, function()
			if mine == hlToken and highlightLabel.Parent then refreshHighlight() end
		end)
	end)
	refreshHighlight()

	local runBtn = make("TextButton", {
		Size = UDim2.new(0, 120, 0, 30), Position = UDim2.new(0, 0, 1, -32),
		BackgroundColor3 = COL.accent, Font = Enum.Font.GothamBold, TextSize = 13,
		TextColor3 = Color3.new(1, 1, 1), Text = "Run script", AutoButtonColor = false,
		BorderSizePixel = 0,
	}, mainArea)
	round(runBtn, 6)
	local clearBtn = make("TextButton", {
		Size = UDim2.new(0, 84, 0, 30), Position = UDim2.new(0, 128, 1, -32),
		BackgroundColor3 = COL.element, Font = Enum.Font.GothamMedium, TextSize = 13,
		TextColor3 = COL.text, Text = "Clear", AutoButtonColor = false, BorderSizePixel = 0,
	}, mainArea)
	round(clearBtn, 6)
	local saveBtn = make("TextButton", {
		Size = UDim2.new(0, 84, 0, 30), Position = UDim2.new(0, 220, 1, -32),
		BackgroundColor3 = COL.element, Font = Enum.Font.GothamMedium, TextSize = 13,
		TextColor3 = COL.text, Text = "Save", AutoButtonColor = false, BorderSizePixel = 0,
	}, mainArea)
	round(saveBtn, 6)

	local tabsData = {}
	local curIdx = 0
	local expanded = {}
	local menuFrame, menuCatcher

	local renderTabs, selectTab, newTab, closeTab
	local refreshFiles, openFile, showMenu, closeMenu, promptName
	local createFile, createFolder, deleteEntry, renameEntry

	local function syncBuf()
		if curIdx > 0 and tabsData[curIdx] then
			tabsData[curIdx].buf = editorBox.Text
		end
	end

	renderTabs = function()
		for _, ch in ipairs(scriptTabBar:GetChildren()) do
			if ch:IsA("TextButton") then ch:Destroy() end
		end
		local x = 0
		for i, t in ipairs(tabsData) do
			local active = (i == curIdx)
			local tb = make("TextButton", {
				Size = UDim2.new(0, 104, 1, -4), Position = UDim2.new(0, x, 0, 2),
				BackgroundColor3 = active and COL.element or COL.bg,
				BackgroundTransparency = active and 0 or 0.4,
				Font = Enum.Font.Gotham, TextSize = 12,
				TextColor3 = active and COL.text or COL.sub,
				Text = "  " .. t.title, TextXAlignment = Enum.TextXAlignment.Left,
				TextTruncate = Enum.TextTruncate.AtEnd, AutoButtonColor = false, BorderSizePixel = 0,
			}, scriptTabBar)
			round(tb, 5)
			connect(tb.MouseButton1Click, function() click(); selectTab(i) end)
			local xb = make("TextButton", {
				Size = UDim2.new(0, 16, 0, 16), Position = UDim2.new(1, -18, 0.5, -8),
				BackgroundTransparency = 1, Font = Enum.Font.GothamBold, TextSize = 12,
				TextColor3 = COL.sub, Text = "x", ZIndex = 3, AutoButtonColor = false,
			}, tb)
			connect(xb.MouseButton1Click, function() click(); closeTab(i) end)
			x = x + 108
		end
		local addb = make("TextButton", {
			Size = UDim2.new(0, 26, 1, -4), Position = UDim2.new(0, x, 0, 2),
			BackgroundColor3 = COL.element, BackgroundTransparency = 0.3,
			Font = Enum.Font.GothamBold, TextSize = 16, TextColor3 = COL.text,
			Text = "+", AutoButtonColor = false, BorderSizePixel = 0,
		}, scriptTabBar)
		round(addb, 5)
		connect(addb.MouseButton1Click, function() click(); newTab("untitled", nil, "") end)
		scriptTabBar.CanvasSize = UDim2.new(0, x + 30, 0, 0)
	end

	selectTab = function(i)
		syncBuf()
		curIdx = i
		editorBox.Text = tabsData[i] and tabsData[i].buf or ""
		renderTabs()
	end
	newTab = function(title, path, content)
		syncBuf()
		tabsData[#tabsData + 1] = { title = title or "untitled", path = path, buf = content or "" }
		curIdx = #tabsData
		editorBox.Text = content or ""
		renderTabs()
	end
	closeTab = function(i)
		table.remove(tabsData, i)
		if #tabsData == 0 then
			tabsData[1] = { title = "untitled", path = nil, buf = "" }
			curIdx = 1
		elseif curIdx >= i then
			curIdx = math.max(1, curIdx - 1)
		end
		editorBox.Text = tabsData[curIdx].buf
		renderTabs()
	end

	openFile = function(path)
		for i, t in ipairs(tabsData) do
			if t.path == path then selectTab(i); return end
		end
		local content = ""
		pcall(function()
			if readfile then content = readfile(path) or "" end
		end)
		newTab(baseName(path), path, content)
	end

	connect(editorBox.FocusLost, function()
		syncBuf()
		local t = tabsData[curIdx]
		if t and t.path then
			pcall(function()
				if writefile then writefile(t.path, editorBox.Text) end
			end)
		end
	end)

	refreshFiles = function()
		for _, ch in ipairs(fileList:GetChildren()) do
			if ch:IsA("TextButton") then ch:Destroy() end
		end
		local y = 0

		local function addRow(label, icon, depth, bold, onLeft, target, isFolder)
			local row = make("TextButton", {
				Size = UDim2.new(1, -4, 0, 22), Position = UDim2.new(0, 2, 0, y),
				BackgroundColor3 = COL.bg, BackgroundTransparency = bold and 0.1 or 0.25,
				Font = bold and Enum.Font.GothamBold or Enum.Font.Gotham, TextSize = 12,
				TextColor3 = bold and COL.text or COL.sub,
				Text = icon .. "  " .. label, TextXAlignment = Enum.TextXAlignment.Left,
				TextTruncate = Enum.TextTruncate.AtEnd, AutoButtonColor = false, BorderSizePixel = 0,
			}, fileList)
			round(row, 4)
			make("UIPadding", { PaddingLeft = UDim.new(0, 6 + depth * 13) }, row)
			H.animate(row)
			connect(row.MouseButton1Click, function() click(); if onLeft then onLeft() end end)
			connect(row.MouseButton2Click, function()
				local m = UIS:GetMouseLocation()
				showMenu(m.X, m.Y, target, isFolder)
			end)
			y = y + 24
		end

		local renderDir
		renderDir = function(dir, depth)
			if not hasFiles then return end
			local ok, entries = pcall(listfiles, dir)
			if not ok or type(entries) ~= "table" then return end
			local folders, files = {}, {}
			for _, p in ipairs(entries) do
				if isfolder and isfolder(p) then folders[#folders + 1] = p else files[#files + 1] = p end
			end
			table.sort(folders)
			table.sort(files)
			for _, p in ipairs(folders) do
				local isOpen = expanded[p] == true
				addRow(baseName(p), isOpen and "\u{1F4C2}" or "\u{1F4C1}", depth, false,
					function() expanded[p] = not isOpen; refreshFiles() end, p, true)
				if isOpen then renderDir(p, depth + 1) end
			end
			for _, p in ipairs(files) do
				addRow(baseName(p), "\u{1F4C4}", depth, false, function() openFile(p) end, p, false)
			end
		end

		for _, root in ipairs(ROOTS) do
			local isOpen = expanded[root.base] ~= false
			addRow(root.name, isOpen and "\u{1F4C2}" or "\u{1F4C1}", 0, true,
				function() expanded[root.base] = not isOpen; refreshFiles() end, root.base, true)
			if isOpen then renderDir(root.base, 1) end
		end
		if not hasFiles then
			addRow("no file API", "\u{26A0}\u{FE0F}", 0, false, function() end, nil, false)
		end
		fileList.CanvasSize = UDim2.new(0, 0, 0, y + 4)
	end

	createFile = function(dir, name)
		if name == "" then return end
		if not name:match("%.%w+$") then name = name .. ".lua" end
		local path = joinPath(dir, name)
		pcall(function() if writefile then writefile(path, "") end end)
		expanded[dir] = true
		refreshFiles()
		openFile(path)
	end
	createFolder = function(dir, name)
		if name == "" then return end
		pcall(function() if makefolder then makefolder(joinPath(dir, name)) end end)
		expanded[dir] = true
		refreshFiles()
	end
	deleteEntry = function(path, isFolder)
		pcall(function()
			if isFolder then
				if delfolder then delfolder(path) end
			else
				if delfile then delfile(path) end
			end
		end)

		for i = #tabsData, 1, -1 do
			if tabsData[i].path == path then closeTab(i) end
		end
		refreshFiles()
		notify(baseName(path) .. " deleted", "success", 2)
	end
	renameEntry = function(path, newName)
		if newName == "" then return end
		local newPath = (path:gsub("[^/\\]+$", newName))
		pcall(function()
			if readfile and writefile then
				local c = readfile(path) or ""
				writefile(newPath, c)
				if delfile then delfile(path) end
			end
		end)
		for _, t in ipairs(tabsData) do
			if t.path == path then t.path = newPath; t.title = baseName(newPath) end
		end
		refreshFiles()
		renderTabs()
	end

	promptName = function(titleText, default, cb)
		local overlay = make("Frame", {
			Name = "Prompt", Size = UDim2.new(1, 0, 1, 0), Position = UDim2.new(0, 0, 0, 0),
			BackgroundColor3 = Color3.new(0, 0, 0), BackgroundTransparency = 0.5,
			BorderSizePixel = 0, ZIndex = 50,
		}, f)
		local boxf = make("Frame", {
			Size = UDim2.new(0, 300, 0, 128), Position = UDim2.new(0.5, -150, 0.5, -64),
			BackgroundColor3 = COL.bg, BorderSizePixel = 0, ZIndex = 51,
		}, overlay)
		round(boxf, 8)
		make("UIStroke", { Color = COL.stroke, Thickness = 1 }, boxf)
		make("TextLabel", {
			Size = UDim2.new(1, -20, 0, 24), Position = UDim2.new(0, 12, 0, 10),
			BackgroundTransparency = 1, Font = Enum.Font.GothamBold, TextSize = 13,
			TextColor3 = COL.text, Text = titleText, TextXAlignment = Enum.TextXAlignment.Left,
			ZIndex = 52,
		}, boxf)
		local input = make("TextBox", {
			Size = UDim2.new(1, -24, 0, 30), Position = UDim2.new(0, 12, 0, 42),
			BackgroundColor3 = COL.element, Font = Enum.Font.Gotham, TextSize = 13,
			TextColor3 = COL.text, Text = default or "", ClearTextOnFocus = false,
			BorderSizePixel = 0, ZIndex = 52,
		}, boxf)
		round(input, 6)
		local okB = make("TextButton", {
			Size = UDim2.new(0, 80, 0, 28), Position = UDim2.new(1, -92, 1, -38),
			BackgroundColor3 = COL.accent, Font = Enum.Font.GothamBold, TextSize = 13,
			TextColor3 = Color3.new(1, 1, 1), Text = "OK", AutoButtonColor = false,
			BorderSizePixel = 0, ZIndex = 52,
		}, boxf)
		round(okB, 6)
		H.animate(okB)
		local caB = make("TextButton", {
			Size = UDim2.new(0, 80, 0, 28), Position = UDim2.new(1, -178, 1, -38),
			BackgroundColor3 = COL.element, Font = Enum.Font.GothamMedium, TextSize = 13,
			TextColor3 = COL.text, Text = "Cancel", AutoButtonColor = false,
			BorderSizePixel = 0, ZIndex = 52,
		}, boxf)
		round(caB, 6)
		H.animate(caB)
		local done = false
		local function finish(val)
			if done then return end
			done = true
			overlay:Destroy()
			if cb then cb(val) end
		end
		connect(okB.MouseButton1Click, function() click(); finish(input.Text) end)
		connect(caB.MouseButton1Click, function() click(); finish(nil) end)
		connect(input.FocusLost, function(enter) if enter then finish(input.Text) end end)
		task.defer(function() pcall(function() input:CaptureFocus() end) end)
	end

	closeMenu = function()
		if menuFrame then menuFrame:Destroy(); menuFrame = nil end
		if menuCatcher then menuCatcher:Destroy(); menuCatcher = nil end
	end
	showMenu = function(mx, my, target, isFolder)
		closeMenu()

		local dir = isFolder and target or parentOf(target or "")
		local isRoot = (target == SCRIPTS_ROOT or target == "")
		local items = {}
		items[#items + 1] = { "New file", function()
			promptName("New file name", "script.lua", function(n) if n then createFile(dir, n) end end)
		end }
		items[#items + 1] = { "New folder", function()
			promptName("New folder name", "folder", function(n) if n then createFolder(dir, n) end end)
		end }
		if target and not isFolder then
			items[#items + 1] = { "Rename", function()
				promptName("Rename", baseName(target), function(n) if n then renameEntry(target, n) end end)
			end }
		end
		if target and not isRoot then
			items[#items + 1] = { "Delete", function() deleteEntry(target, isFolder) end }
		end
		items[#items + 1] = { "Refresh", function() refreshFiles() end }

		menuCatcher = make("Frame", {
			Name = "MenuCatcher", Size = UDim2.new(1, 0, 1, 0), Position = UDim2.new(0, 0, 0, 0),
			BackgroundTransparency = 1, BorderSizePixel = 0, ZIndex = 58, Active = true,
		}, f)
		local catchBtn = make("TextButton", {
			Size = UDim2.new(1, 0, 1, 0), BackgroundTransparency = 1, Text = "", ZIndex = 58,
		}, menuCatcher)
		connect(catchBtn.MouseButton1Click, closeMenu)

		local h = #items * 24 + 8
		menuFrame = make("Frame", {
			Name = "Menu", Size = UDim2.new(0, 148, 0, h),
			Position = UDim2.new(0, mx - f.AbsolutePosition.X, 0, my - f.AbsolutePosition.Y),
			BackgroundColor3 = COL.bg, BorderSizePixel = 0, ZIndex = 60,
		}, f)
		round(menuFrame, 6)
		make("UIStroke", { Color = COL.stroke, Thickness = 1 }, menuFrame)
		for i, it in ipairs(items) do
			local mb = make("TextButton", {
				Size = UDim2.new(1, -8, 0, 22), Position = UDim2.new(0, 4, 0, 4 + (i - 1) * 24),
				BackgroundColor3 = COL.element, BackgroundTransparency = 1,
				Font = Enum.Font.Gotham, TextSize = 12, TextColor3 = COL.text,
				Text = "  " .. it[1], TextXAlignment = Enum.TextXAlignment.Left,
				AutoButtonColor = false, BorderSizePixel = 0, ZIndex = 61,
			}, menuFrame)
			round(mb, 4)
			connect(mb.MouseEnter, function() mb.BackgroundTransparency = 0 end)
			connect(mb.MouseLeave, function() mb.BackgroundTransparency = 1 end)
			connect(mb.MouseButton1Click, function()
				click()
				closeMenu()
				it[2]()
			end)
		end
	end

	connect(newBtn.MouseButton1Click, function()
		local p = newBtn.AbsolutePosition
		click()
		showMenu(p.X, p.Y + 22, SCRIPTS_ROOT, true)
	end)

	local clearAfterRun = false
	local function doRun()
		click()
		syncBuf()
		local src = editorBox.Text
		if (src:gsub("%s", "")) == "" then
			notify("Nothing to run", "warn", 2)
			return
		end
		local t = tabsData[curIdx]
		if t and t.path then
			pcall(function() if writefile then writefile(t.path, src) end end)
		end
		if not loadstring then
			notify("This executor has no loadstring", "error", 5)
			return
		end
		local fn, cerr = loadstring(src)
		if not fn then
			notify("Compile error: " .. tostring(cerr), "error", 6)
			return
		end
		local ok, rerr = pcall(fn)
		if not ok then
			notify("Runtime error: " .. tostring(rerr), "error", 6)
			return
		end
		notify("Script ran", "success", 2)
		if clearAfterRun then
			editorBox.Text = ""
			syncBuf()
		end
	end
	connect(runBtn.MouseButton1Click, doRun)
	connect(clearBtn.MouseButton1Click, function()
		click()
		editorBox.Text = ""
		syncBuf()
	end)

	local function doSave()
		click()
		syncBuf()
		local t = tabsData[curIdx]
		if not t then return end
		if t.path then
			pcall(function() if writefile then writefile(t.path, editorBox.Text) end end)
			notify(baseName(t.path) .. " saved", "success", 2)
			return
		end
		promptName("Save as", "script.lua", function(n)
			if not n or n == "" then return end
			if not n:match("%.%w+$") then n = n .. ".lua" end
			local path = joinPath(SCRIPTS_ROOT, n)
			pcall(function() if writefile then writefile(path, editorBox.Text) end end)
			t.path = path
			t.title = baseName(path)
			expanded[SCRIPTS_ROOT] = true
			renderTabs()
			refreshFiles()
			notify(n .. " saved", "success", 2)
		end)
	end
	connect(saveBtn.MouseButton1Click, doSave)

	local function optRow(label, y, initial, onChanged)
		make("TextLabel", {
			Size = UDim2.new(1, -56, 0, 22), Position = UDim2.new(0, 0, 0, y),
			BackgroundTransparency = 1, Font = Enum.Font.GothamMedium, TextSize = 13,
			TextColor3 = COL.text, Text = label, TextXAlignment = Enum.TextXAlignment.Left,
		}, optionsPage)
		makeSwitch(optionsPage, y, initial, onChanged)
	end

	make("TextLabel", {
		Size = UDim2.new(1, -140, 0, 22), Position = UDim2.new(0, 0, 0, 0),
		BackgroundTransparency = 1, Font = Enum.Font.GothamMedium, TextSize = 13,
		TextColor3 = COL.text, Text = "Open / close key", TextXAlignment = Enum.TextXAlignment.Left,
	}, optionsPage)
	local keyBtn = make("TextButton", {
		Size = UDim2.new(0, 130, 0, 26), Position = UDim2.new(1, -130, 0, 0),
		BackgroundColor3 = COL.element, Font = Enum.Font.GothamMedium, TextSize = 12,
		TextColor3 = COL.accent, Text = "Key: " .. H.keyFor("executor"),
		AutoButtonColor = false, BorderSizePixel = 0,
	}, optionsPage)
	round(keyBtn, 6)
	local waitingKey, keyCap = false, nil
	connect(keyBtn.MouseButton1Click, function()
		click()
		if waitingKey then return end
		waitingKey = true
		keyBtn.Text = "press a key..."
		keyCap = UIS.InputBegan:Connect(function(inp, gp)
			if gp then return end
			if inp.UserInputType == Enum.UserInputType.Keyboard then
				H.setBind("executor", inp.KeyCode.Name)
				H.keyChangeCooldown = true
				task.delay(0.3, function() H.keyChangeCooldown = false end)
				waitingKey = false
				keyBtn.Text = "Key: " .. H.keyFor("executor")
				if keyCap then keyCap:Disconnect(); keyCap = nil end
			end
		end)
	end)

	optRow("Clear editor after running", 34, false, function(on) clearAfterRun = on end)
	make("TextLabel", {
		Size = UDim2.new(1, 0, 0, 40), Position = UDim2.new(0, 0, 1, -40),
		BackgroundTransparency = 1, Font = Enum.Font.Gotham, TextSize = 11,
		TextColor3 = COL.sub,
		Text = "me executor  -  files live in workspace/Xyro/scripts",
		TextXAlignment = Enum.TextXAlignment.Left, TextYAlignment = Enum.TextYAlignment.Bottom,
		TextWrapped = true,
	}, optionsPage)

	local function selectPage(which)
		local onEditor = which == "editor"
		editorPage.Visible = onEditor
		optionsPage.Visible = not onEditor
		editorTab.BackgroundTransparency = onEditor and 0 or 1
		editorTab.TextColor3 = onEditor and COL.text or COL.sub
		optionsTab.BackgroundTransparency = onEditor and 1 or 0
		optionsTab.TextColor3 = onEditor and COL.sub or COL.text
		closeMenu()
	end
	connect(editorTab.MouseButton1Click, function() click(); selectPage("editor") end)
	connect(optionsTab.MouseButton1Click, function() click(); selectPage("options") end)

	connect(f.Destroying, function()
		if keyCap then keyCap:Disconnect() end
		closeMenu()
	end)

	selectPage("editor")
	newTab("untitled", nil, "")
	expanded[SCRIPTS_ROOT] = true
	refreshFiles()
end

Extra.openInvis = function()
	local f, body = window("InvisUI", "Invisible", 250, 120)
	if not f then
		return
	end
	make("TextLabel", {
		Size = UDim2.new(1, 0, 0, 32),
		Position = UDim2.new(0, 0, 0, 0),
		BackgroundTransparency = 1,
		Font = Enum.Font.Gotham,
		TextSize = 12,
		TextColor3 = COL.sub,
		Text = "Client-side: hides you on your own screen.",
		TextWrapped = true,
		TextXAlignment = Enum.TextXAlignment.Left,
		TextYAlignment = Enum.TextYAlignment.Top,
	}, body)
	make("TextLabel", {
		Size = UDim2.new(1, -50, 0, 22),
		Position = UDim2.new(0, 0, 0, 40),
		BackgroundTransparency = 1,
		Font = Enum.Font.GothamMedium,
		TextSize = 13,
		TextColor3 = COL.text,
		Text = "Invisible",
		TextXAlignment = Enum.TextXAlignment.Left,
	}, body)
	local setSw = makeSwitch(body, 40, invisOn, function(on)
		Extra.invisSet(on)
	end)
	Extra._syncInvis = setSw
	connect(f.Destroying, function()
		if Extra._syncInvis == setSw then
			Extra._syncInvis = nil
		end
	end)
end

Extra.openPlayers = function()
	local f, body = window("PlayersUI", "Players", 340, 380)
	if not f then
		return
	end
	local sc = make("ScrollingFrame", {
		Size = UDim2.new(1, 0, 1, 0),
		BackgroundTransparency = 1,
		BorderSizePixel = 0,
		ScrollBarThickness = 4,
		ScrollBarImageColor3 = COL.sub,
		CanvasSize = UDim2.new(0, 0, 0, 0),
	}, body)
	local layout = make("UIListLayout", {
		Padding = UDim.new(0, 6),
		SortOrder = Enum.SortOrder.LayoutOrder,
	}, sc)
	make("UIPadding", {
		PaddingTop = UDim.new(0, 4),
		PaddingLeft = UDim.new(0, 4),
		PaddingRight = UDim.new(0, 4),
	}, sc)

	local function addRow(p, i)
		local rf = make("Frame", {

			Size = UDim2.new(1, -6, 0, 60),
			BackgroundColor3 = COL.element,
			BorderSizePixel = 0,
			LayoutOrder = i,
		}, sc)
		round(rf, 6)
		make("TextLabel", {
			Size = UDim2.new(1, -12, 0, 18),
			Position = UDim2.new(0, 8, 0, 4),
			BackgroundTransparency = 1,
			Font = Enum.Font.GothamMedium,
			TextSize = 13,
			TextColor3 = COL.text,
			Text = p.DisplayName .. "  (@" .. p.Name .. ")",
			TextXAlignment = Enum.TextXAlignment.Left,
			TextTruncate = Enum.TextTruncate.AtEnd,
		}, rf)
		make("TextLabel", {
			Size = UDim2.new(1, -12, 0, 14),
			Position = UDim2.new(0, 8, 0, 22),
			BackgroundTransparency = 1,
			Font = Enum.Font.Gotham,
			TextSize = 11,
			TextColor3 = COL.sub,
			Text = "ID " .. p.UserId,
			TextXAlignment = Enum.TextXAlignment.Left,
		}, rf)
		local function mini(text, xoff, col, fn)
			local b = make("TextButton", {
				Size = UDim2.new(0, 62, 0, 20),
				Position = UDim2.new(0, xoff, 1, -24),
				BackgroundColor3 = col,
				Font = Enum.Font.GothamMedium,
				TextSize = 11,
				TextColor3 = Color3.new(1, 1, 1),
				Text = text,
				AutoButtonColor = false,
				BorderSizePixel = 0,
			}, rf)
			round(b, 5)
			connect(b.MouseButton1Click, function()
				click()
				fn()
			end)
		end
		mini("TP", 8, COL.accent, function()
			local thrp = p.Character and p.Character:FindFirstChild("HumanoidRootPart")
			local myhrp = getHRP()
			if thrp and myhrp then
				myhrp.CFrame = thrp.CFrame + Vector3.new(0, 0, 3)
			end
		end)
		mini("Spectate", 76, COL.accent, function()
			local thum = p.Character and p.Character:FindFirstChildOfClass("Humanoid")
			if thum then
				workspace.CurrentCamera.CameraSubject = thum
			end
		end)
		mini("Copy ID", 150, COL.stroke, function()
			if setclipboard then
				setclipboard(tostring(p.UserId))
			end
		end)
	end

	for i, p in ipairs(Players:GetPlayers()) do
		addRow(p, i)
	end
	local function sz()
		sc.CanvasSize = UDim2.new(0, 0, 0, layout.AbsoluteContentSize.Y / H.scaleOf(sc) + 6)
	end
	connect(layout:GetPropertyChangedSignal("AbsoluteContentSize"), sz)
	sz()
end

Extra.openPlayerInfo = function(query)

	if query and query ~= "" and Extra._piLookup then
		Extra._piLookup(query)
		return
	end

	local f, body = window("PlayerInfoUI", "Player Info", 320, 430)
	if not f then
		return
	end

	local target = player

	local searchBox = make("TextBox", {
		Size = UDim2.new(1, -70, 0, 26),
		Position = UDim2.new(0, 0, 0, 0),
		BackgroundColor3 = COL.element,
		Font = Enum.Font.Gotham,
		TextSize = 12,
		TextColor3 = COL.text,
		Text = "",
		PlaceholderText = "name / display name  (blank = you)",
		PlaceholderColor3 = COL.sub,
		ClearTextOnFocus = false,
		BorderSizePixel = 0,
	}, body)
	round(searchBox, 6)
	H.bindFocusGlow(searchBox)

	local findBtn = make("TextButton", {
		Size = UDim2.new(0, 66, 0, 26),
		Position = UDim2.new(1, -66, 0, 0),
		BackgroundColor3 = COL.accent,
		Font = Enum.Font.GothamMedium,
		TextSize = 12,
		TextColor3 = Color3.new(1, 1, 1),
		Text = "Look up",
		AutoButtonColor = false,
		BorderSizePixel = 0,
	}, body)
	round(findBtn, 6)

	local shot = make("ImageLabel", {
		Size = UDim2.new(0, 60, 0, 60),
		Position = UDim2.new(0, 0, 0, 34),
		BackgroundColor3 = COL.element,
		BorderSizePixel = 0,
		Image = "",
	}, body)
	round(shot, 8)

	local nameLbl = make("TextLabel", {
		Size = UDim2.new(1, -68, 0, 22),
		Position = UDim2.new(0, 68, 0, 34),
		BackgroundTransparency = 1,
		Font = Enum.Font.GothamBold,
		TextSize = 15,
		TextColor3 = COL.text,
		Text = "-",
		TextXAlignment = Enum.TextXAlignment.Left,
		TextTruncate = Enum.TextTruncate.AtEnd,
	}, body)

	local userLbl = make("TextLabel", {
		Size = UDim2.new(1, -68, 0, 16),
		Position = UDim2.new(0, 68, 0, 56),
		BackgroundTransparency = 1,
		Font = Enum.Font.Gotham,
		TextSize = 12,
		TextColor3 = COL.sub,
		Text = "-",
		TextXAlignment = Enum.TextXAlignment.Left,
		TextTruncate = Enum.TextTruncate.AtEnd,
	}, body)

	local idLbl = make("TextLabel", {
		Size = UDim2.new(1, -68, 0, 16),
		Position = UDim2.new(0, 68, 0, 74),
		BackgroundTransparency = 1,
		Font = Enum.Font.Gotham,
		TextSize = 11,
		TextColor3 = COL.sub,
		Text = "-",
		TextXAlignment = Enum.TextXAlignment.Left,
	}, body)

	local sc = make("ScrollingFrame", {
		Size = UDim2.new(1, 0, 1, -136),
		Position = UDim2.new(0, 0, 0, 102),
		BackgroundTransparency = 1,
		BorderSizePixel = 0,
		ScrollBarThickness = 3,
		ScrollBarImageColor3 = COL.sub,
		CanvasSize = UDim2.new(0, 0, 0, 0),
	}, body)
	local layout = make("UIListLayout", {
		Padding = UDim.new(0, 2),
		SortOrder = Enum.SortOrder.LayoutOrder,
	}, sc)
	make("UIPadding", {
		PaddingTop = UDim.new(0, 4),
		PaddingLeft = UDim.new(0, 4),
		PaddingRight = UDim.new(0, 4),
	}, sc)

	local function stat(name, order)
		local rf = make("Frame", {
			Size = UDim2.new(1, -6, 0, 20),
			BackgroundTransparency = 1,
			LayoutOrder = order,
		}, sc)
		make("TextLabel", {
			Size = UDim2.new(0.45, 0, 1, 0),
			BackgroundTransparency = 1,
			Font = Enum.Font.Gotham,
			TextSize = 12,
			TextColor3 = COL.sub,
			Text = name,
			TextXAlignment = Enum.TextXAlignment.Left,
		}, rf)
		return make("TextLabel", {
			Size = UDim2.new(0.55, 0, 1, 0),
			Position = UDim2.new(0.45, 0, 0, 0),
			BackgroundTransparency = 1,
			Font = Enum.Font.GothamMedium,
			TextSize = 12,
			TextColor3 = COL.text,
			Text = "-",
			TextXAlignment = Enum.TextXAlignment.Left,
			TextTruncate = Enum.TextTruncate.AtEnd,
		}, rf)
	end

	local ROWS = {
		"Account age", "Created", "Membership", "Team",
		"Health", "Walk speed", "Jump", "Speed", "Hip height",
		"Rig type", "State", "Floor", "Tool",
		"Position", "Distance", "Ping", "Appearance",
	}
	local val = {}
	for i, n in ipairs(ROWS) do
		val[n] = stat(n, i)
	end

	local function sz()
		sc.CanvasSize = UDim2.new(0, 0, 0, layout.AbsoluteContentSize.Y / H.scaleOf(sc) + 6)
	end
	connect(layout:GetPropertyChangedSignal("AbsoluteContentSize"), sz)
	sz()

	local dynRows = {}
	local dynVals = {}
	local dynSig
	local function clearDyn()
		for _, fr in ipairs(dynRows) do
			fr:Destroy()
		end
		dynRows = {}
		dynVals = {}
	end
	local function header(text, order)
		local rf = make("Frame", {
			Size = UDim2.new(1, -6, 0, 20),
			BackgroundTransparency = 1,
			LayoutOrder = order,
		}, sc)
		make("TextLabel", {
			Size = UDim2.new(1, 0, 1, 0),
			BackgroundTransparency = 1,
			Font = Enum.Font.GothamBold,
			TextSize = 12,
			TextColor3 = COL.accent,
			Text = text,
			TextXAlignment = Enum.TextXAlignment.Left,
		}, rf)
		dynRows[#dynRows + 1] = rf
	end
	local function dynStat(name, order)
		local vl = stat(name, order)
		dynRows[#dynRows + 1] = vl.Parent
		return vl
	end
	local function ensureDyn()
		local ls = target and target.Parent == Players and target:FindFirstChild("leaderstats")
		local sig = tostring(target and target.UserId)
		if ls then
			for _, v in ipairs(ls:GetChildren()) do
				sig = sig .. "|" .. v.Name
			end
		end
		if sig == dynSig then
			return
		end
		dynSig = sig
		clearDyn()
		if ls then
			header("Leaderstats", 100)
			local order = 101
			for _, v in ipairs(ls:GetChildren()) do
				if v:IsA("ValueBase") then
					dynVals[#dynVals + 1] = { obj = v, label = dynStat(v.Name, order) }
					order += 1
				end
			end
		end
	end

	local function blankStats(why)
		for _, n in ipairs(ROWS) do
			val[n].Text = "-"
		end
		clearDyn()
		dynSig = nil
		if why then
			val.Team.Text = why
		end
	end

	local shownId

	local function paint()
		if not target then
			return
		end
		if target.UserId ~= shownId then
			shownId = target.UserId
			shot.Image = "rbxthumb://type=AvatarHeadShot&id=" .. target.UserId .. "&w=150&h=150"
			nameLbl.Text = target.DisplayName
			userLbl.Text = "@" .. target.Name
			idLbl.Text = "ID " .. target.UserId .. (target == player and "   (you)" or "")
		end
		if target.Parent ~= Players then
			blankStats("left the game")
			return
		end
		val["Account age"].Text = target.AccountAge .. " days"

		val.Created.Text = target.AccountAge > 0
			and os.date("!%Y-%m-%d", os.time() - target.AccountAge * 86400)
			or "-"
		val.Membership.Text = (target.MembershipType == Enum.MembershipType.Premium) and "Premium" or "None"
		val.Team.Text = target.Team and target.Team.Name or "none"
		val.Appearance.Text = tostring(target.CharacterAppearanceId)

		local ch = target.Character
		local hum = ch and ch:FindFirstChildOfClass("Humanoid")
		local hrp = ch and ch:FindFirstChild("HumanoidRootPart")

		if hum then
			val.Health.Text = ("%d / %d"):format(math.floor(hum.Health), math.floor(hum.MaxHealth))
			val["Walk speed"].Text = ("%g"):format(hum.WalkSpeed)

			val.Jump.Text = hum.UseJumpPower and ("%g"):format(hum.JumpPower)
				or (("%g"):format(hum.JumpHeight) .. " (height)")
			val["Hip height"].Text = ("%g"):format(hum.HipHeight)
			val["Rig type"].Text = hum.RigType.Name
			local okState, st = pcall(function()
				return hum:GetState().Name
			end)
			val.State.Text = okState and st or "-"
			val.Floor.Text = hum.FloorMaterial.Name
			local tool = ch:FindFirstChildOfClass("Tool")
			val.Tool.Text = tool and tool.Name or "none"
		else
			for _, n in ipairs({ "Health", "Walk speed", "Jump", "Hip height", "Rig type", "State", "Floor", "Tool" }) do
				val[n].Text = "-"
			end
		end

		if hrp then
			local p = hrp.Position
			val.Position.Text = ("%d, %d, %d"):format(math.floor(p.X), math.floor(p.Y), math.floor(p.Z))
			local me = getHRP()
			val.Distance.Text = me and (math.floor((me.Position - p).Magnitude) .. " studs") or "-"

			local v = hrp.AssemblyLinearVelocity
			val.Speed.Text = ("%d studs/s"):format(math.floor(Vector3.new(v.X, 0, v.Z).Magnitude + 0.5))
		else
			val.Position.Text, val.Distance.Text, val.Speed.Text = "no character", "-", "-"
		end

		val.Ping.Text = (target == player)
			and (math.floor(player:GetNetworkPing() * 1000 + 0.5) .. " ms")
			or "-"

		ensureDyn()
		for _, d in ipairs(dynVals) do
			if d.obj.Parent then
				d.label.Text = tostring(d.obj.Value)
			end
		end
	end

	local IDLE_HINT = "name / display name  (blank = you)"
	local function hint(msg)
		searchBox.PlaceholderText = msg
		task.delay(2.5, function()
			if searchBox.Parent and searchBox.PlaceholderText == msg then
				searchBox.PlaceholderText = IDLE_HINT
			end
		end)
	end

	local function lookup(txt)
		txt = tostring(txt or ""):gsub("^%s+", ""):gsub("%s+$", "")
		searchBox.Text = ""
		local low = txt:lower()

		if txt == "" or low == "me" or low == "self"
			or player.Name:lower():sub(1, #low) == low
			or player.DisplayName:lower():sub(1, #low) == low
		then
			target = player
			paint()
			return
		end
		local found = H.findPlayer(txt)
		if not found then
			hint("no such player")
			return
		end
		target = found
		paint()
	end

	connect(findBtn.MouseButton1Click, function()
		click()
		lookup(searchBox.Text)
	end)
	connect(searchBox.FocusLost, function(enter)
		if enter then
			lookup(searchBox.Text)
		end
	end)

	local btnRow = make("Frame", {
		Size = UDim2.new(1, -18, 0, 26),
		Position = UDim2.new(0, 0, 1, -26),
		BackgroundTransparency = 1,
	}, body)

	local function act(text, i, colour, fn)
		local b = make("TextButton", {
			Size = UDim2.new(0.333, -4, 1, 0),
			Position = UDim2.new(0.333 * i, 4 * i, 0, 0),
			BackgroundColor3 = colour,
			Font = Enum.Font.GothamMedium,
			TextSize = 12,
			TextColor3 = Color3.new(1, 1, 1),
			Text = text,
			AutoButtonColor = false,
			BorderSizePixel = 0,
		}, btnRow)
		round(b, 6)
		connect(b.MouseButton1Click, function()
			click()
			fn()
		end)
	end

	act("Teleport", 0, COL.accent, function()
		local thrp = target and target.Character and target.Character:FindFirstChild("HumanoidRootPart")
		local myhrp = getHRP()
		if thrp and myhrp then
			myhrp.CFrame = thrp.CFrame + Vector3.new(0, 0, 3)
		else
			hint("nothing to teleport to")
		end
	end)
	act("Spectate", 1, COL.accent, function()
		local thum = target and target.Character and target.Character:FindFirstChildOfClass("Humanoid")
		if thum then
			workspace.CurrentCamera.CameraSubject = thum
		else
			hint("nothing to spectate")
		end
	end)
	act("Copy ID", 2, COL.stroke, function()
		if setclipboard and target then
			pcall(setclipboard, tostring(target.UserId))
			hint("copied " .. target.UserId)
		else
			hint("no setclipboard")
		end
	end)

	local acc = 0
	local refresh = RunService.Heartbeat:Connect(function(dt)
		acc += dt
		if acc < 0.25 then
			return
		end
		acc = 0
		paint()
	end)

	Extra._piLookup = lookup
	connect(f.Destroying, function()
		refresh:Disconnect()
		if Extra._piLookup == lookup then
			Extra._piLookup = nil
		end
	end)

	if query and query ~= "" then
		lookup(query)
	else
		paint()
	end
end

Extra.openServerInfo = function()
	local f, body = window("ServerInfoUI", "Server Info", 300, 210)
	if not f then
		return
	end
	local info = {
		{ "Place ID", tostring(game.PlaceId) },
		{ "Job ID", tostring(game.JobId) },
		{ "Players", #Players:GetPlayers() .. " / " .. Players.MaxPlayers },
		{ "Your ID", tostring(player.UserId) },
		{ "Ping", math.floor(player:GetNetworkPing() * 1000 + 0.5) .. " ms" },
	}
	for i, kv in ipairs(info) do
		make("TextLabel", {
			Size = UDim2.new(0.4, 0, 0, 22),
			Position = UDim2.new(0, 0, 0, (i - 1) * 26),
			BackgroundTransparency = 1,
			Font = Enum.Font.GothamMedium,
			TextSize = 13,
			TextColor3 = COL.sub,
			Text = kv[1],
			TextXAlignment = Enum.TextXAlignment.Left,
		}, body)
		make("TextLabel", {
			Size = UDim2.new(0.6, 0, 0, 22),
			Position = UDim2.new(0.4, 0, 0, (i - 1) * 26),
			BackgroundTransparency = 1,
			Font = Enum.Font.Gotham,
			TextSize = 13,
			TextColor3 = COL.text,
			Text = kv[2],
			TextXAlignment = Enum.TextXAlignment.Left,
			TextTruncate = Enum.TextTruncate.AtEnd,
		}, body)
	end
	local copyBtn = make("TextButton", {
		Size = UDim2.new(1, 0, 0, 26),
		Position = UDim2.new(0, 0, 0, 5 * 26 + 6),
		BackgroundColor3 = COL.accent,
		Font = Enum.Font.GothamMedium,
		TextSize = 12,
		TextColor3 = Color3.new(1, 1, 1),
		Text = "Copy Job ID",
		AutoButtonColor = false,
		BorderSizePixel = 0,
	}, body)
	round(copyBtn, 6)
	connect(copyBtn.MouseButton1Click, function()
		click()
		if setclipboard then
			setclipboard(tostring(game.JobId))
		end
	end)
end

connect(player.CharacterAdded, function(c)
	c:WaitForChild("Humanoid")
	task.wait(0.2)
	hipApply()
	if platOn then
		platApply()
	end
	if invisOn then
		invisApply()
	end
end)

H.Extra = Extra
end

do

local Players, UIS, player, connect, COL, ClickTp = H.Players, H.UIS, H.player, H.connect, H.COL, H.ClickTp
local Binds, make, round, gui, click, main = H.Binds, H.make, H.round, H.gui, H.click, H.main
local world = H.world
local Speed, Grav, Esp, Hitbox, Move, Fly, hubFindPlayer, hubSaveConfig, hubKeyFromName = H.Speed, H.Grav, H.Esp, H.Hitbox, H.Move, H.Fly, H.findPlayer, H.saveConfig, H.keyFromName
local Extra = H.Extra
local isAdmin = H.isAdmin
local hubRunCommand

local cmdBox = make("TextBox", {
	Size = UDim2.new(0, 190, 0, 26),
	Position = UDim2.new(1, -342, 1, -32), -- beside the Unload button (which sits at -146..-88), not behind it
	BackgroundColor3 = COL.contentBg, -- themed dark field (default gray without this)
	Font = Enum.Font.Gotham,
	TextSize = 12,
	TextColor3 = COL.text,
	Text = "",
	PlaceholderText = "command...  (type help)",
	ClipsDescendants = true,
	PlaceholderColor3 = COL.sub,
	ClearTextOnFocus = false,
	BorderSizePixel = 0,
}, main)
round(cmdBox, 6)
H.bindFocusGlow(cmdBox)

-- Linoria-style command history: focuses pops a dropdown of recent commands
local cmdHistory = {}
local cmdHistoryList = make("Frame", {
	Size = UDim2.new(0, 190, 0, 0),
	Position = UDim2.new(1, -342, 1, -36),
	AnchorPoint = Vector2.new(0, 1), -- grows upward, above the command bar
	BackgroundColor3 = COL.element,
	BorderSizePixel = 0,
	ClipsDescendants = true,
	Visible = false,
	ZIndex = 40,
}, main)
round(cmdHistoryList, 6)
make("UIStroke", { Color = COL.stroke, Thickness = 1, Transparency = 0.3 }, cmdHistoryList)
local cmdHistoryLayout = make("UIListLayout", {
	Padding = UDim.new(0, 2),
	SortOrder = Enum.SortOrder.LayoutOrder,
}, cmdHistoryList)
make("UIPadding", {
	PaddingTop = UDim.new(0, 3),
	PaddingLeft = UDim.new(0, 3),
	PaddingRight = UDim.new(0, 3),
}, cmdHistoryList)

local function hideCmdHistory()
	tween(cmdHistoryList, { Size = UDim2.new(0, 190, 0, 0) })
	task.delay(0.16, function()
		cmdHistoryList.Visible = false
	end)
end

connect(cmdBox.Focused, function()
	if #cmdHistory == 0 then
		return
	end
	for _, c in ipairs(cmdHistoryList:GetChildren()) do
		if c:IsA("TextButton") then
			c:Destroy()
		end
	end
	for i, entry in ipairs(cmdHistory) do
		local b = make("TextButton", {
			Size = UDim2.new(1, -6, 0, 22),
			BackgroundColor3 = COL.bg,
			Font = Enum.Font.Gotham,
			TextSize = 12,
			TextColor3 = COL.sub,
			Text = tostring(entry),
			TextXAlignment = Enum.TextXAlignment.Left,
			TextTruncate = Enum.TextTruncate.AtEnd,
			AutoButtonColor = false,
			BorderSizePixel = 0,
			LayoutOrder = i,
			ZIndex = 41,
		}, cmdHistoryList)
		round(b, 4)
		connect(b.MouseButton1Click, function()
			click()
			cmdHistoryList.Visible = false
			cmdHistoryList.Size = UDim2.new(0, 190, 0, 0)
			pcall(hubRunCommand, entry)
		end)
	end
	local h = math.min(cmdHistoryLayout.AbsoluteContentSize.Y + 6, 160)
	cmdHistoryList.Visible = true
	tween(cmdHistoryList, { Size = UDim2.new(0, 190, 0, h) })
end)

connect(cmdBox.FocusLost, function(enter)
	-- delay so clicking a history row (which steals focus) still registers
	task.delay(0.15, hideCmdHistory)
	local input = cmdBox.Text
	if enter and input ~= "" then
		table.insert(cmdHistory, 1, input)
		if #cmdHistory > 8 then
			table.remove(cmdHistory)
		end
	end
end)

local IDLE = "command...  (type help)"

local function say(msg)
	cmdBox.Text = ""
	cmdBox.PlaceholderText = msg
	task.delay(2.5, function()
		if cmdBox and cmdBox.Parent and cmdBox.PlaceholderText == msg then
			cmdBox.PlaceholderText = IDLE
		end
	end)
end

local HttpService = H.HttpService
local ALIAS_FILE = "Xyro/alias.json"
local UserAliases = {}

local function loadAliases()
	if not (readfile and isfile) or not isfile(ALIAS_FILE) then
		return
	end
	local ok, raw = pcall(readfile, ALIAS_FILE)
	if not ok then
		return
	end
	local ok2, data = pcall(function()
		return HttpService:JSONDecode(raw)
	end)
	if not (ok2 and type(data) == "table") then
		return
	end
	if data[1] ~= nil or next(data) == nil then

		for _, entry in ipairs(data) do
			if type(entry) == "table" and type(entry.command) == "string" and type(entry.aliases) == "table" then
				for _, n in ipairs(entry.aliases) do
					if type(n) == "string" then
						UserAliases[n:lower()] = entry.command:lower()
					end
				end
			end
		end
	elseif type(data.aliases) == "table" then

		for _, entry in ipairs(data.aliases) do
			if type(entry) == "table" and type(entry.command) == "string" and type(entry.names) == "table" then
				for _, n in ipairs(entry.names) do
					if type(n) == "string" then
						UserAliases[n:lower()] = entry.command:lower()
					end
				end
			end
		end
	else

		for a, cmd in pairs(data) do
			if type(a) == "string" and type(cmd) == "string" then
				UserAliases[a:lower()] = cmd:lower()
			end
		end
	end
end

local function serializeAliases()
	local byCommand = {}
	for aliasName, cmdName in pairs(UserAliases) do
		byCommand[cmdName] = byCommand[cmdName] or {}
		table.insert(byCommand[cmdName], aliasName)
	end
	local commands = {}
	for cmdName in pairs(byCommand) do
		table.insert(commands, cmdName)
	end
	table.sort(commands)

	local lines = { "[" }
	for ci, cmdName in ipairs(commands) do
		local names = byCommand[cmdName]
		table.sort(names)
		lines[#lines + 1] = "    {"
		lines[#lines + 1] = "        \"command\": " .. HttpService:JSONEncode(cmdName) .. ","
		lines[#lines + 1] = "        \"aliases\": ["
		for ni, n in ipairs(names) do
			lines[#lines + 1] = "            " .. HttpService:JSONEncode(n) .. (ni < #names and "," or "")
		end
		lines[#lines + 1] = "        ]"
		lines[#lines + 1] = "    }" .. (ci < #commands and "," or "")
	end
	lines[#lines + 1] = "]"
	return table.concat(lines, "\n")
end

local function saveAliases()
	if not writefile then
		return false
	end

	if makefolder and isfolder and not isfolder("me") then
		pcall(makefolder, "me")
	end
	return pcall(writefile, ALIAS_FILE, serializeAliases())
end

pcall(loadAliases)

local CMDS, ORDER = {}, {}

local function add(spec)
	ORDER[#ORDER + 1] = spec
	CMDS[spec.name] = spec
	for _, a in ipairs(spec.alias or {}) do
		CMDS[a] = spec
	end
end

local function onoff(b)
	return b and "on" or "off"
end

local function signature(s)
	local out = s.name
	for _, a in ipairs(s.alias or {}) do
		out = out .. " / " .. a
	end
	return s.args and (out .. " " .. s.args) or out
end

local function commandLabel(spec)
	local best = spec.name
	for _, a in ipairs(spec.alias or {}) do
		if #a > #best then
			best = a
		end
	end
	return best
end

local function capitalize(s)
	s = tostring(s or "")
	return s == "" and s or (s:sub(1, 1):upper() .. s:sub(2))
end

-- Website nametags: rules live in nametags.json in this repo (vertxxy-1/Xyro),
-- edited on github.com or the tag-editor site and fetched live by the game.
-- Two-line pill design: avatar icon + display name + @username, custom fonts,
-- colors, backgrounds and badge. Only drawn over confirmed script users.
local Players = Players or game:GetService("Players")
local RunService = RunService or game:GetService("RunService")
local NT_FALLBACK_URL = "https://raw.githubusercontent.com/vertxxy-1/Xyro/main/nametags.json" -- PRIMARY periodic source: raw GitHub is fresh within seconds of a push
local NT_RAW_URL = "https://cdn.jsdelivr.net/gh/vertxxy-1/Xyro@main/nametags.json" -- LAST RESORT only: jsDelivr's edge can serve a stale copy for days - its purge API reports success without fully clearing the Cloudflare layer in front of it (verified live)
-- (no local server: the editor is GitHub-hosted only now)
local NT_API_URL = "https://api.github.com/repos/vertxxy-1/Xyro/contents/nametags.json"
local NT_ACCENT = Color3.fromRGB(108, 128, 255)

-- The REAL Roblox verified checkmark (blue scalloped seal + white check),
-- served from the repo for EVERY badge:true rule - not just staff. Rank
-- tints still override the color for staff tiers; without a rank everyone
-- gets the official-blue seal. Tinted builds (via getcustomasset) and the
-- rank PNGs stay as the colored path; this is the always-works fallback.
local NT_BADGE_URL = "https://cdn.jsdelivr.net/gh/vertxxy-1/Xyro@main/media/verified_seal_blue.png"
local NT_BADGE_GLYPH = ""
pcall(function()
	NT_BADGE_GLYPH = utf8.char(0xE000)
end)

-- Xyro staff. Add Roblox userids (preferred) or exact usernames here.
local NT_STAFF_IDS = {
	-- [123456789] = true, -- add userids like this
}
local NT_STAFF_NAMES = {
	["x9ksa"] = true,
	["vertxxy2"] = true,
	["x9k_alt"] = true,
	["stellarpalladium"] = true,
}
local function ntIsStaff(plr)
	if NT_STAFF_IDS[plr.UserId] then
		return true
	end
	-- script admins (Firebase-loaded; no hardcoded list anymore) count as nametag staff too
	local adminIds = H.ADMIN_IDS
	if type(adminIds) == "table" and adminIds[plr.UserId] then
		return true
	end
	local adminNames = H.ADMIN_NAMES
	if type(adminNames) == "table" and adminNames[tostring(plr.Name):lower()] then
		return true
	end
	return NT_STAFF_NAMES[tostring(plr.Name):lower()] == true
end

----------------------------------------------------------------------------
-- Staff RANKS - they set the verified badge color on nametags:
--   founder -> silver | hr -> white | support -> green | trial -> teal
--   purple -> custom purple | partner -> custom dark blue (partners)
-- Precedence: rule.rank (nametags.json / tag editor) beats the Firebase
-- "ranks" node (staff.json), which beats NT_STAFF_RANKS here; staff without
-- any explicit rank default to hr (white). Non-staff players with an
-- explicit rule.rank get the seal too (e.g. a green support tag).
----------------------------------------------------------------------------
H.NT_RANKS = H.NT_RANKS or {} -- filled from Firebase staff.json (see fbApplyStaff)
local NT_RANK_COLORS = {
	founder = Color3.fromRGB(210, 214, 222), -- silver
	hr = Color3.fromRGB(255, 255, 255),
	support = Color3.fromRGB(66, 216, 120), -- green
	trial = Color3.fromRGB(70, 205, 200), -- teal
	purple = Color3.fromRGB(176, 102, 255), -- custom purple
	partner = Color3.fromRGB(36, 82, 220), -- custom dark blue (partners)
}
local NT_RANK_ALIASES = {
	founder = { founder = true, owner = true, dev = true, developer = true },
	hr = { hr = true, staff = true, admin = true, admins = true, mod = true, moderator = true, management = true },
	support = { support = true, helper = true, supports = true },
	trial = { trial = true, trials = true, trialstaff = true, trialsupport = true, trialmod = true, trialhelper = true, trialadmin = true },
	purple = { purple = true, custom = true, violet = true },
	partner = { partner = true, partners = true, darkblue = true, darkbluecustom = true, navy = true },
}
local NT_STAFF_RANKS = {
	-- [123456789] = "founder", -- by userid...
	-- x9ksa = "founder", -- ...or by exact username
}

local function ntNormalizeRank(v)
	if type(v) ~= "string" then
		return nil
	end
	local k = v:lower():gsub("[^%w]", "")
	if k == "" then
		return nil
	end
	for rank, names in pairs(NT_RANK_ALIASES) do
		if names[k] then
			return rank
		end
	end
	return nil
end

-- returns rank (string) + tint (Color3) for a player's badge, or nil, nil
-- when the plain check / fallback glyph behavior applies
local function ntBadgeRankColor(plr, rule)
	local rank = ntNormalizeRank(type(rule) == "table" and rule.rank or nil)
	if not rank then
		local ranks = H.NT_RANKS
		if type(ranks) == "table" then
			rank = ntNormalizeRank(ranks[tostring(plr.UserId)] or ranks[tostring(plr.Name):lower()])
		end
	end
	if not rank then
		rank = ntNormalizeRank(NT_STAFF_RANKS[plr.UserId] or NT_STAFF_RANKS[tostring(plr.Name):lower()])
	end
	if not rank and ntIsStaff(plr) then
		rank = "hr" -- every staff member without an explicit rank shows white
	end
	if not rank then
		return nil, nil
	end
	return rank, NT_RANK_COLORS[rank]
end

-- safe HTTP helpers. IMPORTANT: declared before anything that uses them,
-- and safe member reads because indexing a Roblox member the executor
-- didn't add THROWS ("HttpPost is not a valid member of DataModel")
local function ntMember(name)
	local ok, v = pcall(function()
		return game[name]
	end)
	return ok and v or nil
end

local function ntHttpGet(url)
	if ntMember("HttpGet") then
		local ok, body = pcall(function()
			return game:HttpGet(url, true)
		end)
		if ok and type(body) == "string" then
			return body
		end
	end
	local req = (syn and syn.request) or http_request or request
	if req then
		local ok, resp = pcall(req, { Url = url, Method = "GET" })
		if ok and resp and type(resp.Body) == "string" then
			return resp.Body
		end
	end
	return nil
end

local function ntHttpPost(url, body)
	if ntMember("HttpPost") then
		local ok = pcall(function()
			game:HttpPost(url, body)
		end)
		if ok then
			return true
		end
	end
	local req = (syn and syn.request) or http_request or request
	if req then
		local ok = pcall(req, { Url = url, Method = "POST", Body = body })
		if ok then
			return true
		end
	end
	return false
end

local ntEnabled = false
	local ntRules = nil
	local ntTags = {}
	local ntMouse = player and player.GetMouse and player:GetMouse() or nil -- hover-expand reads this in the render loop
local ntFetchAcc = 0
local NT_FETCH_EVERY = 15 -- tag rules re-check; editor-tunable via options.refreshSeconds (10-300)
local NT_API_EVERY_N = 4 -- every Nth periodic fetch double-checks via the GitHub API (never cached anywhere); 4 x 15s = 60s staleness ceiling, ~15 req/hr per client - well under the 60 req/hr unauthenticated budget
local ntFetchN = 0
local NT_TOPIC = "xyro-presence-k2m9x7q" -- anonymous presence DB: every script user heartbeats here
local NT_BEAT_EVERY = 25 -- presence heartbeat; used to be 45s, which made newly-joined players wait up to ~75s for their tag
local ntBeatAcc = 0
local NT_BEAT_WINDOW = 75 -- beats every 45s, so a stopped script drops out within ~75s (no ghost tags)
local ntOnline = {} -- lowercase username -> true for everyone seen in the last few minutes
local ntLastSource = "none" -- where the current rules came from: api | local | cdn | raw
local ntOpts = {
	size = 15,
	userSize = 10,
	height = 48,
	imageSize = 44,
	maxDistance = 0,
	showDistance = true,
	showHealth = true,
	showBox = true,
	onlyScriptUsers = true,
	pillColor = "#0C0C10",
	pillTransparency = 0.12,
	font = "GothamBlack",
	textColor = "#FFFFFF",
	userColor = "#8B92A5",
	clickTeleport = true,
	seeThroughWalls = true,
	staffOnly = false,
	userBox = false,
	userBoxColor = "#1A1F2E",
	userBoxTransparency = 0.25,
	userBoxRadius = 8,
	userBoxStroke = "",
	collapseDistance = 40, -- closer than this the full pill shows; 0 = never collapse
	collapsedIcon = 40, -- avatar-only size while collapsed (still click-teleports)
	-- FPS governors (seconds): the per-tag @info strings and the collapse/
	-- hover checks re-run at most this often instead of every single frame
	infoEvery = 0.15,
	collapseEvery = 0.1,
	gifMaxFrames = 24, -- GIFs keep their first N frames (282-frame GIFs took MINUTES to encode and strobed at 30fps forever)
}

local function ntNormalize(s)
	return (tostring(s or ""):lower())
end

local function ntColor(hex, fallback)
	hex = ntNormalize(hex):gsub("#", "")
	if #hex ~= 6 or hex:match("%X") then
		return fallback
	end
	local r, g, b = tonumber(hex:sub(1, 2), 16), tonumber(hex:sub(3, 4), 16), tonumber(hex:sub(5, 6), 16)
	if not (r and g and b) then
		return fallback
	end
	return Color3.fromRGB(r, g, b)
end

local NT_FONTS = {
	GothamBlack = Enum.Font.GothamBlack,
	GothamBold = Enum.Font.GothamBold,
	Gotham = Enum.Font.Gotham,
	GothamMedium = Enum.Font.GothamMedium,
	Bangers = Enum.Font.Bangers,
	SourceSansBold = Enum.Font.SourceSansBold,
	FredokaOne = Enum.Font.FredokaOne,
	Arcade = Enum.Font.Arcade,
	Pixel = Enum.Font.Arcade,
}
local function ntFont(name)
	return NT_FONTS[ntNormalize(name)] or Enum.Font.GothamBlack
end

local function ntTextWidth(text, size, font)
	-- measure in an effectively infinite frame: GetTextSize WRAPS text at
	-- the given frame width, so a small frame made long labels measure as
	-- multi-line blobs (under-measured -> pill too small -> text truncated
	-- with "..." even when it easily fit)
	local ok, bounds = pcall(function()
		return H.TextService:GetTextSize(text, size, font, Vector2.new(10000, 10000))
	end)
	if ok and typeof(bounds) == "Vector2" then
		return bounds.X
	end
	return math.max(24, #text * size * 0.55)
end

local function ntApplyOptions(o)
	ntOpts.size = math.clamp(tonumber(o.size) or 15, 8, 48)
	ntOpts.userSize = math.clamp(tonumber(o.userSize) or 10, 8, 24)
	ntOpts.height = math.clamp(tonumber(o.height) or 48, 28, 96)
	ntOpts.imageSize = math.clamp(tonumber(o.imageSize) or 44, 8, 128)
	ntOpts.maxDistance = math.max(tonumber(o.maxDistance) or 0, 0)
	ntOpts.showDistance = o.showDistance ~= false
	ntOpts.showHealth = o.showHealth ~= false
	ntOpts.showBox = o.showBox ~= false
	ntOpts.onlyScriptUsers = o.onlyScriptUsers ~= false
	ntOpts.pillColor = tostring(o.pillColor or ntOpts.pillColor)
	ntOpts.pillTransparency = math.clamp(tonumber(o.pillTransparency) or 0.12, 0, 1)
	ntOpts.font = tostring(o.font or ntOpts.font)
	ntOpts.textColor = tostring(o.textColor or ntOpts.textColor)
	ntOpts.userColor = tostring(o.userColor or ntOpts.userColor)
	ntOpts.clickTeleport = o.clickTeleport ~= false
	ntOpts.seeThroughWalls = o.seeThroughWalls ~= false
	ntOpts.staffOnly = o.staffOnly == true
	ntOpts.userBox = o.userBox == true
	ntOpts.userBoxColor = tostring(o.userBoxColor or ntOpts.userBoxColor)
	ntOpts.userBoxTransparency = math.clamp(tonumber(o.userBoxTransparency) or 0.25, 0, 1)
	ntOpts.userBoxRadius = math.clamp(tonumber(o.userBoxRadius) or 8, 0, 24)
	ntOpts.userBoxStroke = tostring(o.userBoxStroke or "")
	ntOpts.collapseDistance = math.max(tonumber(o.collapseDistance) or 40, 0)
	ntOpts.collapsedIcon = math.clamp(tonumber(o.collapsedIcon) or 40, 16, 128)
	ntOpts.infoEvery = math.clamp(tonumber(o.infoEvery) or ntOpts.infoEvery, 0.05, 1)
	ntOpts.collapseEvery = math.clamp(tonumber(o.collapseEvery) or ntOpts.collapseEvery, 0.05, 1)
	ntOpts.gifMaxFrames = math.clamp(tonumber(o.gifMaxFrames) or 24, 2, 60)
	ntOpts.collapseFar = o.collapseFar ~= false
	if not ntOpts.collapseFar then
		ntOpts.collapseDistance = 0
	end
	-- how often rules are re-checked, seconds (floor of 10 keeps the
	-- fetch chain polite even if someone publishes a silly value)
	NT_FETCH_EVERY = math.clamp(tonumber(o.refreshSeconds) or 15, 10, 300)
end

-- your tag is saved to disk after every successful fetch and re-applied
-- instantly on the next execute - no waiting for the network
local NT_CACHE = "Xyro/nametags_cache.json"

local function ntSaveCache(text)
	pcall(function()
		if makefolder then
			makefolder("Xyro")
		end
		writefile(NT_CACHE, text)
	end)
end

local function ntLoadCache()
	if not (readfile and isfile and isfile(NT_CACHE)) then
		return nil
	end
	local ok, text = pcall(readfile, NT_CACHE)
	if not (ok and type(text) == "string" and #text > 2) then
		return nil
	end
	local okD, wrapper = pcall(function()
		return H.HttpService:JSONDecode(text)
	end)
	-- v2 wrapper only: a pre-v2 cache predates the fetch-crash fixes and is
	-- stale by definition - drop it so the first successful fetch replaces it
	if okD and type(wrapper) == "table" and wrapper.v == 2
		and type(wrapper.cfg) == "table" and type(wrapper.cfg.tags) == "table" then
		return wrapper.cfg
	end
	return nil
end

-- decode a GitHub contents-API response into raw file text. The API is
-- NEVER CDN-cached, so a publish lands for everyone immediately -
-- raw.githubusercontent.com serves stale copies for minutes after a
-- push, which is exactly why staff kept seeing old tags.
local function ntFromAPI(jsonBody)
	local ok, data = pcall(function()
		return H.HttpService:JSONDecode(jsonBody)
	end)
	if not (ok and type(data) == "table" and type(data.content) == "string" and #data.content > 16) then
		return nil
	end
	local b64 = data.content:gsub("\n", "")
	local crypt = (syn and syn.crypt and syn.crypt.base64decode)
		or (type(crypt) == "table" and crypt.base64decode)
		or (syn and syn.base64decode)
	if crypt then
		local okD, out = pcall(crypt, b64)
		if okD and type(out) == "string" and #out > 0 then
			return out
		end
	end
	-- pure-Lua base64 fallback for executors without a crypt lib
	local CH = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"
	local INV = {}
	for i = 1, #CH do
		INV[CH:sub(i, i)] = i - 1
	end
	local bits = ""
	for c in b64:gmatch("[^=]") do
		local f = INV[c] or 0
		for i = 6, 1, -1 do
			bits = bits .. ((math.floor(f / 2 ^ (i - 1)) % 2 == 1) and "1" or "0")
		end
	end
	local out = {}
	for i = 1, #bits - 7, 8 do
		local v = 0
		for j = 1, 8 do
			if bits:sub(i + j - 1, i + j - 1) == "1" then
				v = v + 2 ^ (8 - j)
			end
		end
		out[#out + 1] = string.char(math.floor(v % 256))
	end
	return table.concat(out)
end

local function ntFetch(manual)
	-- priority: GitHub API on manual fetches (never stale, always the
	-- published truth). Periodic fetches go raw.githubusercontent FIRST
	-- (fresh within seconds of a push) and double-check via the API every
	-- NT_API_EVERY_Nth round. jsDelivr is LAST RESORT only: its edge has
	-- served a days-stale copy even after a "successful" purge, so the
	-- CDN must never be trusted as the primary source again.
	local text = nil
	if manual then
		text = ntFromAPI(ntHttpGet(NT_API_URL) or "")
		if text then
			ntLastSource = "api"
		end
	end
	if not text then
		ntFetchN += 1
		local apiRound = not manual and NT_API_EVERY_N > 0 and (ntFetchN % NT_API_EVERY_N == 0)
		if apiRound then
			text = ntFromAPI(ntHttpGet(NT_API_URL) or "")
			if text then
				ntLastSource = "api"
			end
		end
	end
	if not text then
		text = ntHttpGet(NT_FALLBACK_URL .. "?t=" .. tostring(os.time()))
		if text then
			ntLastSource = "raw"
		end
	end
	if not text then
		text = ntHttpGet(NT_RAW_URL .. "?t=" .. tostring(os.time()))
		if text then
			ntLastSource = "cdn"
		end
	end
	if not text or #text == 0 then
		return manual and "fetch failed (no HttpGet on this executor?)" or nil
	end
	local decoded, cfg = pcall(function()
		return H.HttpService:JSONDecode(text)
	end)
	if not decoded or type(cfg) ~= "table" or type(cfg.tags) ~= "table" then
		return manual and "nametags.json isn't valid (needs {\"tags\":[...]})" or nil
	end
	local n = 0
	for _, t in ipairs(cfg.tags) do
		if type(t) == "table" and type(t.match) == "string" and t.match ~= ""
			and type(t.label) == "string" and t.label ~= ""
		then
			n += 1
		end
	end
	if type(cfg.options) == "table" then
		ntApplyOptions(cfg.options)
	end
	-- staff-only mode: non-staff get nothing at all (config not even cached)
	if ntOpts.staffOnly and not ntIsStaff(player) then
		ntRules = nil
		ntSaveCache("{}")
		if manual and H.notify then
			H.notify({
				title = "Nametags",
				text = "staff only - you are not staff",
				kind = "error",
			})
		end
		return "staff only"
	end
	ntRules = cfg
	-- v2 wrapper: schema bump invalidates ancient disk caches exactly once,
	-- then every later save carries the same marker
	pcall(function()
		ntSaveCache(H.HttpService:JSONEncode({ v = 2, cfg = cfg }))
	end)
	if manual and H.notify then
		H.notify({
			title = "Nametags",
			text = "loaded " .. n .. " tag rule" .. (n == 1 and "" or "s"),
			kind = "success",
		})
	end
	return "loaded " .. n .. " tag rule" .. (n == 1 and "" or "s")
end

local function ntRuleFor(plr)
	if not (ntRules and type(ntRules.tags) == "table") then
		return nil
	end
	local nm, dn = ntNormalize(plr.Name), ntNormalize(plr.DisplayName)
	for _, t in ipairs(ntRules.tags) do
		if type(t) == "table" and type(t.label) == "string" and t.label ~= "" then
			local m = ntNormalize(t.match)
			if m == "*" or (m ~= "" and (nm:sub(1, #m) == m or dn:sub(1, #m) == m)) then
				return t
			end
		end
	end
	return nil
end

-- rule lookup. Tags come ONLY from the published nametags.json rules -
-- no built-in fallback tag for yourself (it used to auto-tag you with your
-- display name when no rule matched, ignoring the website config)
local function ntRuleForPlayer(plr)
	return ntRuleFor(plr)
end

local function ntHideAll()
	for _, o in pairs(ntTags) do
		if o.gui then
			o.gui.Enabled = false
		end
	end
end

local ICON_LEFT, TEXT_GAP, PAD_RIGHT = 8, 10, 12
local NT_MAX_PILL_W = 4000 -- pure safety valve for absurd labels; pills grow to fit any realistic text
local NAME_H, USER_H = 17, 12

-- signature of everything that forces a rebuild when it changes
-- shared attach-part priority (Head preferred, then torso variants), with
-- an any-BasePart fallback for weird rigs (ported from the v2 client)
local NT_ATTACH_PRIORITY = { "Head", "UpperTorso", "Torso", "LowerTorso", "HumanoidRootPart" }
local function ntAttachPart(character)
	if not character then
		return nil
	end
	for _, name in ipairs(NT_ATTACH_PRIORITY) do
		local part = character:FindFirstChild(name)
		if part and part:IsA("BasePart") then
			return part
		end
	end
	for _, child in ipairs(character:GetChildren()) do
		if child:IsA("BasePart") then
			return child
		end
	end
	return nil
end

-- head mounts higher than torso parts so the tag never clips the body
local function ntStudsOffsetForPart(part)
	if not part then
		return Vector3.new(0, 2.4, 0)
	end
	if part.Name == "Head" then
		return Vector3.new(0, 2.4, 0)
	elseif part.Name == "HumanoidRootPart" or part.Name == "Torso" or part.Name == "UpperTorso" then
		return Vector3.new(0, 2.9, 0)
	end
	return Vector3.new(0, 2.2, 0)
end

-- distance-scaled billboard: between the limits the tag grows/shrinks with
-- zoom instead of holding a constant pixel size (pcall: older executors may
-- not know these properties)
local function ntApplyDistanceScale(bb)
	pcall(function()
		bb.DistanceLowerLimit = 10
		bb.DistanceUpperLimit = 60
	end)
end

-- click-teleport: land IN FRONT of the target (their facing direction) so
-- you don't spawn inside them, and only when they're far enough to be worth it
local function ntTeleportTo(plr)
	local ch = plr and plr.Character
	local me = player.Character
	local target = ch and (ch:FindFirstChild("HumanoidRootPart") or ch:FindFirstChild("Torso"))
	local hrp = me and (me:FindFirstChild("HumanoidRootPart") or me:FindFirstChild("Torso"))
	if not (target and hrp) then
		return
	end
	if (target.Position - hrp.Position).Magnitude < 12 then
		return
	end
	hrp.CFrame = target.CFrame * CFrame.new(0, 0, 4)
end

local function ntShapeRadius(shape)
	if shape == "Square" then
		return UDim.new(0, 0)
	elseif shape == "Rounded" then
		return UDim.new(0, 10)
	elseif shape == "Circle" then
		return UDim.new(0.5, 0)
	end
	return UDim.new(0.5, 0) -- Pill (default)
end

local function ntSignature(plr, rule)
	rule = rule or {}
	return table.concat({
		tostring(rule.label or ""),
		tostring(rule.color or ""),
		tostring(rule.textColor or ""),
		tostring(rule.bg or ntOpts.pillColor),
		tostring(rule.bgTransparency or ntOpts.pillTransparency),
		tostring(rule.image or ""),
		tostring(rule.bgImage or ""),
		tostring(rule.userText or ""),
		tostring((rule.userBox == nil and ntOpts.userBox or rule.userBox) and 1 or 0),
		tostring(rule.userBoxColor or ntOpts.userBoxColor),
		tostring(rule.userBoxTransparency or ntOpts.userBoxTransparency),
		tostring(rule.userBoxRadius or ntOpts.userBoxRadius),
		tostring(rule.userBoxStroke or ntOpts.userBoxStroke),
		tostring(rule.font or ntOpts.font),
		tostring(rule.shape or ""),
		tostring(rule.size or ntOpts.size),
		tostring(rule.userSize or ntOpts.userSize),
		tostring(rule.imageSize or ntOpts.imageSize),
		tostring(rule.height or ntOpts.height),
		tostring(rule.badge and 1 or 0),
		tostring(rule.rank or ""),
		tostring(ntOpts.showBox and 1 or 0),
		tostring(ntIsStaff(plr) and 1 or 0),
		tostring(ntBadgeRankColor(plr, rule)),
		tostring(ntOpts.seeThroughWalls and 1 or 0),
		tostring(plr.UserId),
		tostring(plr.DisplayName),
		tostring(plr.Name),
	}, "|")
end

local ntEnsureDirDone = false
local function ntEnsureDir()
	if ntEnsureDirDone or not makefolder then
		return
	end
	pcall(makefolder, "Xyro")
	pcall(makefolder, "Xyro/ntmedia")
	ntEnsureDirDone = true
end

-- GIF87a/89a decoder -> frames of RGBA rows + per-frame delays.
-- Roblox can only show a GIF's FIRST frame, so animated tags need this.
local function ntDecodeGIF(data)
	if #data < 13 or data:sub(1, 3) ~= "GIF" then
		return nil
	end
	local w = data:byte(7) + data:byte(8) * 256
	local h = data:byte(9) + data:byte(10) * 256
	local flags = data:byte(11)
	local bgIndex = data:byte(12)
	if w < 1 or h < 1 or w > 512 or h > 512 or #data < 13 + 3 * 2 ^ (flags % 8 + 1) then
		return nil
	end
	local pos = 14
	local gct = {}
	if math.floor(flags / 128) % 2 == 1 then
		for i = 0, 2 ^ (flags % 8 + 1) - 1 do
			gct[i] = { data:byte(pos + i * 3, pos + i * 3 + 2) }
		end
		pos += 3 * 2 ^ (flags % 8 + 1)
	end
	local frames = {}
	local canvas = table.create(w * h, 0)
	local delay = 0
	local transparent = -1
	local disposal = 0
	local function readBlock()
		local chunks = {}
		while true do
			local n = data:byte(pos)
			pos += 1
			if not n or n == 0 then
				break
			end
			chunks[#chunks + 1] = data:sub(pos, pos + n - 1)
			pos += n
			if pos > #data then
				break
			end
		end
		return table.concat(chunks)
	end
	local function lzw(minCode)
		local blob = readBlock()
		local clear, endCode = 2 ^ minCode, 2 ^ minCode + 1
		local size = minCode + 1
		local dict, nextCode = {}, endCode + 1
		for i = 0, clear - 1 do
			dict[i] = { i }
		end
		-- byte-exact LSB-first bit reader (verified against a reference
		-- encoder on the real published GIF: perfect lockstep at 137,946 px)
		local out, buf, cnt, prev, pos2 = {}, 0, 0, nil, 1
		while true do
			while cnt < size do
				local byte = blob:byte(pos2)
				if not byte then
					return out
				end
				buf = buf + byte * 2 ^ cnt
				pos2 += 1
				cnt += 8
			end
			local mask = 2 ^ size - 1
			local code = buf % (mask + 1)
			buf = math.floor(buf / (mask + 1))
			cnt -= size
			if code == clear then
				dict, nextCode, size = {}, endCode + 1, minCode + 1
				for j = 0, clear - 1 do
					dict[j] = { j }
				end
				prev = nil
			elseif code == endCode then
				return out
			elseif dict[code] then
				local seq = dict[code]
				if prev ~= nil and nextCode < 4096 then
					local pseq = dict[prev]
					local entry = table.create(#pseq + 1)
					for k = 1, #pseq do
						entry[k] = pseq[k]
					end
					entry[#pseq + 1] = seq[1]
					dict[nextCode] = entry
					nextCode += 1
					if nextCode >= 2 ^ size and size < 12 then
						size += 1
					end
				end
				for _, idx in ipairs(seq) do
					out[#out + 1] = idx
				end
				prev = code
			elseif prev ~= nil then
				local pseq = dict[prev]
				local entry = table.create(#pseq + 1)
				for k = 1, #pseq do
					entry[k] = pseq[k]
				end
				entry[#pseq + 1] = pseq[1]
				if nextCode < 4096 then
					dict[nextCode] = entry
					nextCode += 1
					if nextCode >= 2 ^ size and size < 12 then
						size += 1
					end
				end
				for _, idx in ipairs(entry) do
					out[#out + 1] = idx
				end
				prev = code
			else
				break
			end
		end
		return out
	end
	while pos < #data do
		-- one yield per frame: ntDecodeGIF only ever runs in spawned threads
		-- (the media queue), so this spreads a multi-frame decode across
		-- rendered frames instead of stalling the main thread for seconds
		task.wait()
		local b = data:byte(pos)
		pos += 1
		if b == 0x21 then
			local label = data:byte(pos)
			pos += 1
			if label == 0xF9 then
				pos += 1
				local pf = data:byte(pos)
				delay = (data:byte(pos + 1) + data:byte(pos + 2) * 256) * 10
				transparent = pf % 2 == 1 and data:byte(pos + 3) or -1
				disposal = math.floor(pf / 4) % 8 or 0
				pos += 4
				pos += 1
			elseif label == 0xFF then
				-- pos already sits on the first sub-block length byte; the
				-- stray skip here read 'N' of NETSCAPE2.0 as a length and
				-- derailed the whole block walk (0 frames -> no image)
				readBlock()
			else
				readBlock()
			end
		elseif b == 0x2C then
			-- frame cap: a 282-frame GIF meant 282 PNG encodes+writes per tag
			-- (minutes of queue) and 30 texture swaps/sec forever after. Keep
			-- the first N frames - the loop below just stops reading further
			if #frames >= ntOpts.gifMaxFrames then
				break
			end
			local fx = data:byte(pos) + data:byte(pos + 1) * 256
			local fy = data:byte(pos + 2) + data:byte(pos + 3) * 256
			local fw = data:byte(pos + 4) + data:byte(pos + 5) * 256
			local fh = data:byte(pos + 6) + data:byte(pos + 7) * 256
			local lf = data:byte(pos + 8)
			pos += 9
			local lct
			if math.floor(lf / 128) % 2 == 1 then
				lct = {}
				for i = 0, 2 ^ (lf % 8 + 1) - 1 do
					lct[i] = { data:byte(pos + i * 3, pos + i * 3 + 2) }
				end
				pos += 3 * 2 ^ (lf % 8 + 1)
			end
			local pal = lct or gct
			-- the LZW min code size is its own byte here (NOT the palette size
			-- field) - using lf%8+1 was decoding pure garbage
			local mcs = data:byte(pos)
			pos += 1				-- floor the frame delay at 50ms (20fps): 30ms GIFs slip past a
				-- 100ms-clamp check and strobe faster than Roblox UI can render
				if delay < 50 then
					delay = 50
				end
			local snap = (disposal == 3 or #frames == 0) and table.clone(canvas) or nil
			local idxs = mcs and lzw(mcs) or nil
			-- interlaced GIFs store rows in 4 shuffled passes; map each source
			-- row to its real on-screen row (PIL/browsers do this silently)
			local rowMap = nil
			if math.floor(lf / 64) % 2 == 1 then
				rowMap = table.create(fh, 0)
				local ri = 0
				-- interlace passes: rows 0,8,16.. then 4,12.. then 2,6.. then 1,3..
				local passes = { { 0, 8 }, { 4, 8 }, { 2, 4 }, { 1, 2 } }
				for _, pass in ipairs(passes) do
					local start, step = pass[1], pass[2]
					local p = start
					while p < fh do
						ri += 1
						rowMap[ri] = p
						p += step
					end
				end
			end
			for i = 0, #idxs - 1 do
				local cx = i % fw
				local cy = rowMap and rowMap[math.floor(i / fw) + 1] or math.floor(i / fw)
				if cx < fw and cy < fh and fx + cx < w and fy + cy < h then
					local ci = idxs[i + 1]
					local cell = (fy + cy) * w + fx + cx + 1
					if ci == transparent then
						if disposal == 3 then
							canvas[cell] = 0
						end
					else
						canvas[cell] = ci
					end
				end
			end
			-- build the row as a STRING: the PNG encoder reads rgba:sub()
			local pix = table.create(w * h, "")
				local n = 0
				for i = 1, w * h do
					local ci = canvas[i]
					local c = pal and (pal[ci] or pal[0]) or nil
					if ci == transparent then
						c = nil
					end
					n += 1
					if c then
						pix[n] = string.char(c[1] or 0, c[2] or 0, c[3] or 0, 255)
					else
						pix[n] = "\x00\x00\x00\x00"
					end
				end
				local rgba = table.concat(pix)
				table.insert(frames, { w = w, h = h, rgba = rgba, delay = delay / 1000 })
			if disposal == 3 and snap then
				canvas = snap
			elseif disposal == 2 then
				for yy = fy, math.min(fy + fh - 1, h - 1) do
					for xx = fx, math.min(fx + fw - 1, w - 1) do
						canvas[yy * w + xx + 1] = 0					end
				end
			end
		elseif b == 0x3B then
			break
		end
	end
	if #frames == 0 then
		return nil
	end
	return { w = w, h = h, frames = frames }
end

-- minimal PNG encoder (zlib stored blocks + CRC32/Adler32) so decoded
-- GIF frames become image assets Roblox can actually load
local function ntEncodePNG(w, h, rgba)
	local function be32(v)
		return string.char(math.floor(v / 16777216) % 256, math.floor(v / 65536) % 256, math.floor(v / 256) % 256, v % 256)
	end
	local function adler(s)
		local a, b = 1, 0
		for i = 1, #s do
			a = (a + s:byte(i)) % 65521
			b = (b + a) % 65521
		end
		return b * 65536 + a
	end
	local crcTable = {}
	for n = 0, 255 do
		local c = n
		for _ = 1, 8 do
			c = (c % 2 == 1) and bit32.bxor(0xEDB88320, bit32.rshift(c, 1)) or bit32.rshift(c, 1)
		end
		crcTable[n] = c
	end
	local function crc32(s)
		local c = 0xFFFFFFFF
		for i = 1, #s do
			c = bit32.bxor(crcTable[bit32.band(bit32.bxor(c, s:byte(i)), 255)], bit32.rshift(c, 8))
		end
		return bit32.bxor(c, 0xFFFFFFFF)
	end
	local function chunk(tag, payload)
		local body = tag .. payload
		return be32(#payload) .. body .. be32(crc32(body))
	end
	-- filter byte 0 + raw RGBA rows
	local rowBytes = w * 4
	local parts = table.create(h, 0)
	for y = 1, h do
		parts[y] = "\x00" .. rgba:sub((y - 1) * rowBytes + 1, y * rowBytes)
	end
	local raw = table.concat(parts)
	-- zlib header + stored (uncompressed) deflate blocks, each capped at 65535
	local z = table.create(2 + math.ceil(#raw / 65535), 0)
	z[1] = "\x78\x01"
	local zi = 2
	local off = 1
	while off <= #raw do
		local piece = raw:sub(off, off + 65534) -- 65535 bytes max per stored block (sub is inclusive!)
		off += #piece
		local fin = off > #raw
		z[zi] = string.char(fin and 1 or 0, #piece % 256, math.floor(#piece / 256) % 256, bit32.bnot(#piece) % 256, bit32.bnot(math.floor(#piece / 256)) % 256) .. piece
		zi += 1
	end
	z[zi] = be32(adler(raw))
	local ihdr = be32(w) .. be32(h) .. "\x08\x06\x00\x00\x00"
	return "\137PNG\r\n\26\n" .. chunk("IHDR", ihdr) .. chunk("IDAT", table.concat(z)) .. chunk("IEND", "")
end

-- load a GIF/PNG/JPG from URL or base64 data URI into an ImageLabel.
-- returns true if something was applied. GIFs animate frame by frame.
local ntImgCache = {}
local ntAnims = {}

local function ntStopAnim(img)
	local a = ntAnims[img]
	if a then
		a.dead = true
		ntAnims[img] = nil
	end
end

-- drive a decoded frame list on one ImageLabel (shared by fresh decodes
-- and cache hits so a rebuilt tag resumes animating without re-decoding)
local function ntStartFrames(img, frames)
	ntStopAnim(img)
	img.Image = frames[1].asset
	if #frames < 2 then
		return true
	end
	local anim = { i = 1, dead = false }
	ntAnims[img] = anim
	task.spawn(function()
		while not anim.dead and img.Parent do
			-- playback floor 50ms (20fps): cached pre-cap frames can carry
			-- 30ms delays that strobe faster than the UI pipeline renders
			local d = frames[anim.i].delay or 0.1
			if d < 0.05 then
				d = 0.05
			end
			task.wait(d)
			if anim.dead or not img.Parent then
				break
			end
			anim.i = anim.i % #frames + 1
			img.Image = frames[anim.i].asset
		end
		ntAnims[img] = nil
	end)
	return true
end

-- MEDIA QUEUE: downloads and pure-Lua decodes run ONE AT A TIME (with a
-- yield between jobs). On boot, a fetch used to fire every tag's images in
-- parallel - ~10 simultaneous GIF decodes, each an unyielded multi-second
-- main-thread chunk, froze the game solid right after execute. Serialized,
-- the game keeps rendering while media loads one piece per beat.
-- getcustomasset ERRORS on any file rewritten after an earlier read (executor
-- dependent - Solara/Xeno class). Every cache path re-writes the same
-- filenames, so second sessions/rebuilds silently got zero frames (GIFs and
-- backgrounds stopped showing). Resolver: try the direct read first (fresh or
-- untouched files are fine), then fall back to a NEVER-BEFORE-USED copy.
local ntCopyN = 0
local function ntAssetFor(path)
	if not getcustomasset then
		return nil
	end
	local ok, asset = pcall(getcustomasset, path)
	if ok and type(asset) == "string" and asset ~= "" then
		return asset
	end
	local okR, bytes = pcall(readfile, path)
	if not (okR and type(bytes) == "string" and #bytes > 0) then
		return nil
	end
	ntCopyN += 1
	local ext = path:match("%.(%w+)$") or "png"
	local copy = path:gsub("%.", "_") .. "_x" .. ntCopyN .. "." .. ext
	pcall(writefile, copy, bytes)
	local ok2, asset2 = pcall(getcustomasset, copy)
	if ok2 and type(asset2) == "string" and asset2 ~= "" then
		return asset2
	end
	return nil
end

----------------------------------------------------------------------------
-- Rank seal artwork: a white verified plate with a punched-out check,
-- embedded as a 16-level alpha mask (4px per char) and rasterized once per
-- rank through ntEncodePNG, tinted to the rank color. Same silhouette as
-- media/verified_seal.png (the full-res source committed to the repo).
----------------------------------------------------------------------------
local NT_SEAL_MASK = {
	"0123456789ABCDEF",
	"0000000000000000000000000000",
	"0000000000111111110000000000",
	"000000049CEEEEEEEEC940000000",
	"000002BFFFFFFFFFFFFFFB200000",
	"00004EFFFFFFFFFFFFFFFFE40000",
	"0002EFFFFFFFFFFFFFFFFFFE2000",
	"000BFFFFFFFFFFFFFFFEDFFFB000",
	"004FFFFFFFFFFFFFFFB205FFF400",
	"00AFFFFFFFFFFFFFFD10009FFA00",
	"00DFFFFFFFFFFFFFF300007FFD00",
	"01EFFFFFFFFFFFFF700001DFFE10",
	"01EFFFFFFFFFFFFA00000BFFFE10",
	"01EFFFD77DFFFFD100008FFFFE10",
	"01EFFE2002DFFF300005FFFFFE10",
	"01EFFB00002EF600002EFFFFFE10",
	"01EFFD100004900000CFFFFFFE10",
	"01EFFFB10000000009FFFFFFFE10",
	"01EFFFFB000000005FFFFFFFFE10",
	"00DFFFFFA0000002EFFFFFFFFD00",
	"00AFFFFFF800000CFFFFFFFFFA00",
	"004FFFFFFF70009FFFFFFFFFF400",
	"000BFFFFFFFB8CFFFFFFFFFFB000",
	"0002EFFFFFFFFFFFFFFFFFFE2000",
	"00004EFFFFFFFFFFFFFFFFE40000",
	"000002BFFFFFFFFFFFFFFB200000",
	"000000049CEEEEEEEEC940000000",
	"0000000000111111110000000000",
	"0000000000000000000000000000",
}
local NT_SEAL_TINTS = {} -- [rank] = asset uri (false = build failed)
-- pre-tinted seals served from the repo (jsDelivr edge). The in-engine tint
-- stays as backup; on executors where getcustomasset refuses rewritten files
-- the fallback keeps the real verified-seal artwork instead of a plain check.
local NT_SEAL_URL_BASE = "https://cdn.jsdelivr.net/gh/vertxxy-1/Xyro@main/media/seal_"
local function ntSealAsset(rank)
	if NT_SEAL_TINTS[rank] ~= nil then
		return NT_SEAL_TINTS[rank] or nil
	end
	local tint = NT_RANK_COLORS[rank]
	local function build()
		if not tint or not ntEncodePNG or not writefile or not getcustomasset then
			return nil
		end
		if isfolder and not isfolder("Xyro") and makefolder then
			pcall(makefolder, "Xyro")
		end
		local pal = NT_SEAL_MASK[1]
		local w = #NT_SEAL_MASK[2]
		local h = #NT_SEAL_MASK - 1
		local r = math.floor(tint.R * 255 + 0.5)
		local g = math.floor(tint.G * 255 + 0.5)
		local b = math.floor(tint.B * 255 + 0.5)
		local px = table.create(w * h, "\0\0\0\0")
		local i = 0
		for y = 2, #NT_SEAL_MASK do
			local row = NT_SEAL_MASK[y]
			for x = 1, #row do
				i += 1
				local idx = pal:find(row:sub(x, x), 1, true) or 1
				local a = (idx - 1) * 17
				if a > 0 then
					px[i] = string.char(r, g, b, a)
				end
			end
		end
		local png = ntEncodePNG(w, h, table.concat(px))
		if type(png) ~= "string" or #png < 24 then
			return nil
		end
		local path = "Xyro/seal_" .. rank .. ".png"
		pcall(writefile, path, png)
		return ntAssetFor(path)
	end
	local ok, asset = pcall(build)
	asset = (ok and type(asset) == "string" and asset ~= "") and asset or nil
	NT_SEAL_TINTS[rank] = asset or false
	return asset
end
task.spawn(function() -- prewarm every tint off the boot path
	for rank in pairs(NT_RANK_COLORS) do
		pcall(ntSealAsset, rank)
	end
end)

local ntMediaQueue = {}
local ntMediaBusy = false
local ntMediaPending = {} -- [url] = true while queued/running
local ntMediaWaiters = {} -- [url] = { img, ... } awaiting the result
local function ntResolveWaiters(url)
	ntMediaPending[url] = nil
	local imgs = ntMediaWaiters[url]
	ntMediaWaiters[url] = nil
	if not imgs then
		return
	end
	local res = ntImgCache[url]
	if res == nil then
		return
	end
	for _, w in ipairs(imgs) do
		if w.Parent then
			if type(res) == "string" then
				w.Image = res
			elseif type(res) == "table" then
				pcall(ntStartFrames, w, res)
			end
		end
	end
end
local function ntQueueMedia(job)
	table.insert(ntMediaQueue, job)
	if ntMediaBusy then
		return
	end
	ntMediaBusy = true
	task.spawn(function()
		while true do
			local j = table.remove(ntMediaQueue, 1)
			if not j then
				break
			end
			pcall(j.run)
			if j.done then
				pcall(j.done)
			end
			task.wait() -- a beat between heavy jobs keeps frames rendering
		end
		ntMediaBusy = false
	end)
end

local function ntApplyData(img, data, key)
	if type(data) ~= "string" or #data < 24 then
		return false
	end
	local sig = data:sub(1, 4)
	if sig == "GIF8" then
		if not (getcustomasset and writefile) then
			return false
		end
		-- cache hit: replay frames without re-decoding (also resurrects
			-- animation after the asset files were wiped by a re-exec)
		local cached = ntImgCache[key]
		if type(cached) == "table" and #cached > 0 then
			local alive = true
			for _, fr in ipairs(cached) do
				if type(fr.asset) ~= "string" or fr.asset == "" then
					alive = false
					break
				end
			end
			if alive then
				return ntStartFrames(img, cached)
			end
			ntImgCache[key] = nil -- frames reference deleted files: re-decode
		end
		local stem = "Xyro/ntmedia/" .. tostring((key:gsub("%W", "")):sub(-16))
		-- DISK frame cache: the encoded PNGs from a previous session survive
		-- re-execs, and a tiny meta file (frame count + delays) lets a rebuild
		-- skip the pure-Lua GIF decode ENTIRELY - that decode is the
		-- multi-second freeze that used to kill the game on every fetch
		local frames = nil
		if readfile and isfile and isfile(stem .. ".meta") then
			local okM, meta = pcall(function()
				return H.HttpService:JSONDecode(readfile(stem .. ".meta"))
			end)
			if okM and type(meta) == "table" and meta.v == 1 and type(meta.n) == "number" and meta.n > 0 then
				-- poisoned-meta guard: a crashed decode once saved meta with 1
				-- frame and every later session froze on it. Meta now records the
				-- GIF's byte length; no match (old/partial meta) = full re-decode
				local glen = tonumber(meta.gl) or -1
				local diskGif = -2
				if isfile(stem .. ".gif") then
					local okG, gbytes = pcall(readfile, stem .. ".gif")
					if okG and type(gbytes) == "string" then
						diskGif = #gbytes
					end
				end
				local fromDisk = nil
				if glen == diskGif then
					fromDisk = {}
				-- the cap applies to cached frames too: a pre-cap session may
				-- have stored hundreds - truncate so playback stays smooth
				for fi = 1, math.min(meta.n, ntOpts.gifMaxFrames) do
					local fname = stem .. "_" .. fi .. ".png"
					if not isfile(fname) then
						fromDisk = nil
						break
					end
					local asset = ntAssetFor(fname)
					if type(asset) ~= "string" or asset == "" then
						fromDisk = nil
						break
					end
					fromDisk[fi] = { asset = asset, delay = tonumber(meta.d and meta.d[fi]) or 0.1 }
				end
				end -- glen == diskGif (bytes match: trust the frame cache)
				frames = fromDisk
			end
		end
		if not frames then
			local gif = ntDecodeGIF(data)
			if not gif or #gif.frames == 0 then
				return false
			end
			ntEnsureDir()
			frames = {}
			local delays = {}
			for fi, fr in ipairs(gif.frames) do
				local fname = stem .. "_" .. fi .. ".png"
				local encoded = ntEncodePNG(fr.w, fr.h, fr.rgba)
				if not encoded then
					break
				end
				local okW = pcall(writefile, fname, encoded)
				local asset = okW and ntAssetFor(fname) or nil
				if type(asset) ~= "string" or asset == "" then
					break
				end
				frames[fi] = { asset = asset, delay = fr.delay }
				delays[fi] = fr.delay
				-- yield between frames: a long GIF encodes across many rendered
				-- frames instead of stalling the main thread for the whole job
				task.wait()
			end
		if #frames == 0 then
			return false
		end
		-- keep the raw GIF bytes too: the NEXT session loads locally with no
		-- download at all (frames+meta already skip the decode)
		pcall(function()
			writefile(stem .. ".gif", data)
		end)
		pcall(function()
			writefile(stem .. ".meta", H.HttpService:JSONEncode({ v = 1, n = #frames, d = delays, gl = #data }))
		end)
		end
		ntImgCache[key] = frames
		return ntStartFrames(img, frames)
	end
	local head = data:sub(1, 8)
	if head == "\137PNG\r\n\26\n" or (data:byte(1) == 0xFF and data:byte(2) == 0xD8) then
		if getcustomasset and writefile then
			ntEnsureDir()
			local fname = "Xyro/ntmedia/" .. tostring((key:gsub("%W", "")):sub(-16)) .. (data:byte(1) == 0xFF and ".jpg" or ".png")
			-- disk hit: the bytes are already saved - skip the re-download and
			-- rewrite entirely (this fires on EVERY tag rebuild after a re-exec)
			if readfile and isfile and isfile(fname) then
				local cached = ntAssetFor(fname)
				if type(cached) == "string" and cached ~= "" then
					img.Image = cached
					return true
				end
			end
			local okW = pcall(writefile, fname, data)
			local asset = okW and ntAssetFor(fname) or nil
			if type(asset) == "string" and asset ~= "" then
				img.Image = asset
				return true
			end
		end
		return false
	end
	return false
end

local function ntDataFromUri(url)
	local b64 = url:match("^data:image/%w+;base64,(.+)$")
	if not b64 then
		return nil
	end
	b64 = b64:gsub("%s", "")
	local ok, out = pcall(function()
		if syn and syn.crypt and syn.crypt.base64decode then
			return syn.crypt.base64decode(b64)
		end
		if type(crypt) == "table" and crypt.base64decode then
			return crypt.base64decode(b64)
		end
		if H and H.HttpService and H.HttpService.Base64Decode then
			return H.HttpService:Base64Decode(b64)
		end
		return nil
	end)
	if ok and type(out) == "string" and #out > 0 then
		return out
	end
	return nil
end

local function ntApplyImage(img, url)
	-- serve repo media from jsDelivr's edge instead of raw.githubusercontent
	-- (faster worldwide, same file)
	url = url:gsub("^https://raw%.githubusercontent%.com/([%w%-%_%.]+)/([%w%-%_%.]+)/main/", "https://cdn.jsdelivr.net/gh/%1/%2@main/")
	if url:match("^%d+$") then
		url = "rbxassetid://" .. url
	end
	if url:sub(1, 12) == "rbxassetid://" then
		img.Image = url
		return true
	end
	local b64 = ntDataFromUri(url)
	if b64 then
		return ntApplyData(img, b64, url:sub(1, 120))
	end
	local cached = ntImgCache[url]
	if type(cached) == "string" then
		img.Image = cached
		return true
	end
	if type(cached) == "table" then
		return ntStartFrames(img, cached)
	end
	if not (getcustomasset and writefile and ntMember("HttpGet")) then
		return false
	end
	local stem = "Xyro/ntmedia/" .. tostring((url:gsub("%W", "")):sub(-16))
	local function queueJob(run)
		-- one at a time; a URL already queued hands its result to every
		-- waiter when it finishes (avatar + collapsed icon request the same
		-- image on every rebuild - used to download/decode it TWICE)
		if ntMediaPending[url] then
			local list = ntMediaWaiters[url]
			if not list then
				list = {}
				ntMediaWaiters[url] = list
			end
			list[#list + 1] = img
			return
		end
		ntMediaPending[url] = true
		ntQueueMedia({
			run = run,
			done = function()
				ntResolveWaiters(url)
			end,
		})
	end
	-- DISK-FIRST static: saved by any previous session - serve straight from
	-- disk, zero download (this fires on EVERY rebuild after a re-exec)
	ntEnsureDir()
	for _, ext in ipairs({ ".png", ".jpg" }) do
		if isfile(stem .. ext) then
			local asset = ntAssetFor(stem .. ext)
			if type(asset) == "string" and asset ~= "" then
				ntImgCache[url] = asset
				img.Image = asset
				return true
			end
		end
	end
	-- GIF saved by a previous session: decode from the LOCAL bytes (still
	-- queued - the pure-Lua LZW decode is the heavy part)
	if isfile(stem .. ".gif") then
		queueJob(function()
			return ntApplyData(img, readfile(stem .. ".gif"), url) ~= false
		end)
		return true
	end
	-- fresh: download + decode ONE AT A TIME in the background queue so ten
	-- simultaneous image jobs can never collide into a game freeze
	queueJob(function()
		local data = ntHttpGet(url)
		assert(type(data) == "string" and #data > 0, "empty download")
		if ntApplyData(img, data, url) then
			return true -- GIF: decoded, disk-cached, animating
		end
		-- static: save under the right extension, then serve from disk
		local ext = ".png"
		if data:byte(1) == 0xFF and data:byte(2) == 0xD8 then
			ext = ".jpg"
		end
		ntEnsureDir()
		-- extension matters: getcustomasset only accepts known media types
		local fname = stem .. ext
		local okW = pcall(writefile, fname, data)
		local okA, asset = pcall(getcustomasset, fname)
		if okW and okA and type(asset) == "string" and asset ~= "" then
			ntImgCache[url] = asset
			img.Image = asset
			return true
		end
		return false
	end)
	return true -- queued: the tag fills in when its turn arrives
end

local function ntBuild(plr, rule)
	local ch = plr.Character
	local head = ntAttachPart(ch)
	if not (head and head:IsA("BasePart")) then
		return nil
	end

	-- hide the game's default overhead name so only our pill shows
	pcall(function()
		local hum = ch:FindFirstChildOfClass("Humanoid")
		if hum then
			hum.DisplayDistanceType = Enum.HumanoidDisplayDistanceType.None
		end
	end)

	local shownName = tostring(rule.label or plr.DisplayName)
	local font = ntFont(rule.font or ntOpts.font)
	local nameSize = math.clamp(tonumber(rule.size) or ntOpts.size, 8, 48)
	local userSize = math.clamp(tonumber(rule.userSize) or ntOpts.userSize, 8, 24)
	local iconSize = math.clamp(tonumber(rule.imageSize) or ntOpts.imageSize, 8, 128)
	local height = math.clamp(tonumber(rule.height) or ntOpts.height, 28, 96)
	-- a big icon grows the pill automatically so it never gets clipped
	if iconSize + 8 > height then
		height = math.min(iconSize + 8, 160)
	end

	-- custom @line: rule.userText replaces the real @username (a leading @
	-- is optional); blank/absent keeps the genuine @username
	local userText0 = "@" .. plr.Name
	if type(rule.userText) == "string" and rule.userText ~= "" then
		userText0 = rule.userText:sub(1, 1) == "@" and rule.userText or ("@" .. rule.userText)
	end
	-- tags GROW with their text: the pill always stretches to fit the
	-- longest line (name or @username), so long labels/usernames never
	-- truncate and never spill past the pill / its bgImage. Truncation is
	-- only a far safety valve past 4000px (absurd labels).
	local nameW = ntTextWidth(shownName, nameSize, font)
	local userW = ntTextWidth(userText0, userSize, Enum.Font.Gotham)
	local badgeRank, badgeTint = ntBadgeRankColor(plr, rule)
	local badgeW = rule.badge and (nameSize + 6) or 0
	local contentW = math.ceil(ICON_LEFT + iconSize + TEXT_GAP + math.max(nameW + badgeW, userW) + PAD_RIGHT)
	local over = contentW > NT_MAX_PILL_W
	local width = math.clamp(contentW, 120, NT_MAX_PILL_W)

	local bb = Instance.new("BillboardGui")
	bb.Name = "XyroTag_" .. tostring(plr.UserId)
	bb.Adornee = head
	bb.Size = UDim2.fromOffset(width, height)
	bb.StudsOffset = ntStudsOffsetForPart(head)
	-- AlwaysOnTop = visible through walls; Active = REQUIRED for the pill
	-- to receive clicks (without it TP-on-click silently does nothing)
	bb.AlwaysOnTop = ntOpts.seeThroughWalls
	bb.Active = ntOpts.clickTeleport and plr ~= player
	bb.LightInfluence = 0
	bb.MaxDistance = ntOpts.maxDistance > 0 and ntOpts.maxDistance or 10000
	bb.Enabled = false
	ntApplyDistanceScale(bb)

	-- soft drop shadow so the pill lifts off the world
	local shadow = Instance.new("Frame")
	shadow.Name = "Shadow"
	shadow.Position = UDim2.fromOffset(0, 4)
	shadow.Size = UDim2.new(1, 0, 1, 0)
	shadow.BackgroundColor3 = Color3.new(0, 0, 0)
	shadow.BackgroundTransparency = 0.55
	shadow.BorderSizePixel = 0
	shadow.ZIndex = 0

	local pill = Instance.new("Frame")
	pill.ZIndex = 1
	pill.Name = "Pill"
	pill.Size = UDim2.fromScale(1, 1)
	pill.BackgroundColor3 = ntColor(rule.bg, ntColor(ntOpts.pillColor, Color3.fromRGB(12, 12, 16)))
	pill.BackgroundTransparency = math.clamp(tonumber(rule.bgTransparency) or ntOpts.pillTransparency, 0, 1)
	pill.BorderSizePixel = 0
	if not ntOpts.showBox then
		pill.BackgroundTransparency = 1
	end
	pill.Parent = bb
	shadow.Parent = bb
	local shCorner = Instance.new("UICorner")
	shCorner.CornerRadius = UDim.new(0.5, 0)
	shCorner.Parent = shadow

	local corner = Instance.new("UICorner")
	corner.CornerRadius = ntShapeRadius(rule.shape)
	corner.Parent = pill

	-- faint top-lit gradient so flat pill colors get a little depth
	local grad = Instance.new("UIGradient")
	grad.Color = ColorSequence.new(Color3.new(1, 1, 1), Color3.fromRGB(198, 203, 218))
	grad.Rotation = 90
	grad.Parent = pill

	local stroke = Instance.new("UIStroke")
	stroke.Color = ntColor(rule.color, NT_ACCENT)
	stroke.Transparency = 0.15
	stroke.Thickness = 1.5
	stroke.Parent = pill

	-- optional custom background image behind the text (URL or base64 data
	-- URI, GIFs animate). ZIndex 0 keeps it under avatar/name/user layers
	local bgImg = nil
	local bgUrl = type(rule.bgImage) == "string" and rule.bgImage or ""
	if bgUrl ~= "" then
		pill.BackgroundTransparency = 1
		bgImg = Instance.new("ImageLabel")
		bgImg.Name = "BgImage"
		bgImg.BackgroundTransparency = 1
		bgImg.Size = UDim2.fromScale(1, 1)
		bgImg.ScaleType = Enum.ScaleType.Crop
		bgImg.ZIndex = 0
		bgImg.Parent = pill
		local bgCorner = Instance.new("UICorner")
		bgCorner.CornerRadius = ntShapeRadius(rule.shape)
		bgCorner.Parent = bgImg
		task.spawn(function()
			pcall(ntApplyImage, bgImg, bgUrl)
		end)
	end

	local avatar = Instance.new("ImageLabel")
	avatar.Name = "Avatar"
	avatar.BackgroundColor3 = pill.BackgroundColor3
	avatar.Size = UDim2.fromOffset(iconSize, iconSize)
	avatar.Position = UDim2.new(0, ICON_LEFT, 0.5, 0)
	avatar.AnchorPoint = Vector2.new(0, 0.5)
	avatar.Image = "rbxthumb://type=AvatarHeadShot&id=" .. tostring(plr.UserId) .. "&w=420&h=420"
	-- Crop (not Fit) fills the whole circle edge to edge - Fit letterboxes
	-- the headshot's built-in margins and makes the face look tiny
	avatar.ScaleType = Enum.ScaleType.Crop
	avatar.ResampleMode = Enum.ResamplerMode.Default
	avatar.Parent = pill
	local avCorner = Instance.new("UICorner")
	avCorner.CornerRadius = rule.shape == "Square" and UDim.new(0, 0) or UDim.new(0.36, 0)
	avCorner.Parent = avatar
	-- ring around the pfp in the rule's accent color
	local avRing = Instance.new("UIStroke")
	avRing.Color = ntColor(rule.color, NT_ACCENT)
	avRing.Thickness = 2
	avRing.Transparency = 0.2
	avRing.Parent = avatar

	local nameTop = math.floor((height - (NAME_H + USER_H)) / 2)
	local textLeft = ICON_LEFT + iconSize + TEXT_GAP

	local nameRow = Instance.new("Frame")
	nameRow.Name = "NameRow"
	nameRow.BackgroundTransparency = 1
	nameRow.Position = UDim2.fromOffset(textLeft, nameTop)
	nameRow.Size = UDim2.new(1, -(textLeft + PAD_RIGHT), 0, NAME_H)
	nameRow.Parent = pill

	local name = Instance.new("TextLabel")
	name.Name = "Name"
	name.BackgroundTransparency = 1
	if over then
		-- safety valve reached (absurdly long label): fill the row (minus
		-- badge) and truncate at the pill edge - the background always spans
		-- exactly what the text shows
		name.AutomaticSize = Enum.AutomaticSize.None
		name.Size = UDim2.new(1, badgeW > 0 and -(badgeW + 8) or 0, 0, NAME_H)
	else
		name.AutomaticSize = Enum.AutomaticSize.X
		name.Size = UDim2.fromOffset(math.ceil(nameW + 4), NAME_H)
	end
	name.Font = font
	name.TextSize = nameSize
	name.TextXAlignment = Enum.TextXAlignment.Left
	name.TextYAlignment = Enum.TextYAlignment.Center
	name.TextColor3 = ntColor(rule.textColor, ntColor(ntOpts.textColor, Color3.new(1, 1, 1)))
	name.TextTruncate = Enum.TextTruncate.AtEnd -- bites only past the 4000px safety valve
	name.Text = shownName
	name.Parent = nameRow

	if rule.badge then
		local b = Instance.new("TextLabel")
		b.Name = "Badge"
		b.BackgroundTransparency = 1
		b.AnchorPoint = Vector2.new(0, 0.5)
		b.Size = UDim2.fromOffset(badgeW, NAME_H)
		b.Font = Enum.Font.GothamBold
		b.TextSize = 12
		-- EVERYONE with badge:true gets the REAL Roblox verified seal artwork
		-- (blue scalloped disc + white check) from the repo. Staff with a rank
		-- get it recolored to their tier (founder silver / hr white / support
		-- green / trial teal / purple / partner dark blue).
		if over then
			-- truncated name: pin the badge to the row's right edge instead
			-- of the untruncated text width
			b.AnchorPoint = Vector2.new(1, 0.5)
			b.Position = UDim2.new(1, -2, 0.5, 0)
		else
			b.Position = UDim2.new(0, math.ceil(nameW + 6), 0.5, 0)
		end
		local img = Instance.new("ImageLabel")
		img.Name = "Seal"
		img.BackgroundTransparency = 1
		img.AnchorPoint = Vector2.new(0.5, 0.5)
		img.Position = UDim2.fromScale(0.5, 0.5)
		img.Size = UDim2.fromOffset(math.max(nameSize + 5, 15), math.max(nameSize + 5, 15))
		img.ScaleType = Enum.ScaleType.Fit
		img.Parent = b

		-- last-resort text glyph, tinted to the rank so even the fallback
		-- matches what the tag editor previews
		local function badgeGlyphFallback()
			if img.Parent then
				img:Destroy()
			end
			b.Text = (badgeRank or ntIsStaff(plr)) and (NT_BADGE_GLYPH ~= "" and NT_BADGE_GLYPH or "\xE2\x9C\x93") or "\xE2\x9C\x93"
			b.TextSize = math.max(nameSize + 5, 15)
			b.TextColor3 = badgeTint or ntColor(rule.color, Color3.fromRGB(0, 170, 255))
			if over then
				b.AnchorPoint = Vector2.new(1, 0.5)
				b.Position = UDim2.new(1, -2, 0.5, 1)
			else
				b.Position = UDim2.new(0, math.ceil(nameW + 6), 0.5, 1)
			end
		end

		-- cache-buster: a bumped version gives every seal URL a fresh
		-- ntmedia disk stem, so a poisoned/broken cache file from an older
		-- build can never blank the badge again
		local sealBuster = "?v=14"
		local sealUrl = nil
		if badgeRank and badgeTint then
			-- RANK TINT: the repo's pre-tinted PNG first - the same network
			-- pipeline that renders the blue seal everywhere - so in-game
			-- colors always match the tag editor preview. (The in-engine
			-- tinted build stays as the stage-2 backup below.)
			sealUrl = NT_SEAL_URL_BASE .. badgeRank .. ".png" .. sealBuster
		else
			sealUrl = NT_BADGE_URL .. sealBuster
		end
		b.Text = ""
		task.spawn(function()
			pcall(ntApplyImage, img, sealUrl)
			-- NOTE: a fresh URL returns true immediately (queued) and fills
			-- the Seal ImageLabel in later; an outright refusal (no
			-- getcustomasset / no http) lands here synchronously and the
			-- verifier below catches it - either way the badge never vanishes.
		end)

		-- LOAD VERIFIER: the async pipeline can fail invisibly (queued 404,
		-- poisoned old disk cache, getcustomasset refusing a rewritten file)
		-- and leave an ImageLabel that renders nothing. Check shortly after
		-- mount: not loaded = try the in-engine tinted build once (ranked
		-- badges only), then give up to the glyph. Runs on the tag's own
		-- closure; every step re-checks parenting so re-ghosted tags are safe.
		task.delay(6, function()
			if not (img.Parent and b.Parent) then
				return
			end
			local loaded = img.Image ~= "" and img.IsLoaded
			if loaded then
				return
			end
			local triedEngine = img:GetAttribute("EngineSeal") == true
			if badgeRank and badgeTint and not triedEngine then
				local seal = ntSealAsset(badgeRank)
				if seal then
					img:SetAttribute("EngineSeal", true)
					img.Image = seal
					task.delay(4, function()
						if img.Parent and b.Parent and not (img.Image ~= "" and img.IsLoaded) then
							badgeGlyphFallback()
						end
					end)
					return
				end
			end
			badgeGlyphFallback()
		end)
		b.Parent = nameRow
	end

	-- optional customizable box/chip behind the @username line (per-rule
	-- userBox/userBoxColor/userBoxTransparency/userBoxRadius/userBoxStroke
	-- override the global options)
	local ubOn = rule.userBox == nil and ntOpts.userBox or rule.userBox
	local userBox = nil
	if ubOn then
		userBox = Instance.new("Frame")
		userBox.Name = "UserBox"
		userBox.Position = UDim2.fromOffset(textLeft, nameTop + NAME_H - 2)
		userBox.Size = UDim2.new(1, -(textLeft + PAD_RIGHT), 0, USER_H + 4)
		userBox.BackgroundColor3 = ntColor(rule.userBoxColor, ntColor(ntOpts.userBoxColor, Color3.fromRGB(26, 31, 46)))
		userBox.BackgroundTransparency = math.clamp(tonumber(rule.userBoxTransparency) or ntOpts.userBoxTransparency, 0, 1)
		userBox.BorderSizePixel = 0
		userBox.Parent = pill
		local ubCorner = Instance.new("UICorner")
		ubCorner.CornerRadius = UDim.new(0, math.clamp(tonumber(rule.userBoxRadius) or ntOpts.userBoxRadius, 0, 24))
		ubCorner.Parent = userBox
		local strokeHex = rule.userBoxStroke or ntOpts.userBoxStroke
		if type(strokeHex) == "string" and strokeHex ~= "" and strokeHex ~= "none" then
			local ubStroke = Instance.new("UIStroke")
			ubStroke.Color = ntColor(strokeHex, NT_ACCENT)
			ubStroke.Transparency = 0.35
			ubStroke.Thickness = 1
			ubStroke.Parent = userBox
		end
	end

	local user = Instance.new("TextLabel")
	user.Name = "User"
	user.BackgroundTransparency = 1
	user.Font = Enum.Font.Gotham
	user.TextSize = userSize
	user.TextTransparency = 0.25
	user.TextXAlignment = Enum.TextXAlignment.Left
	user.TextYAlignment = Enum.TextYAlignment.Center
	user.TextColor3 = ntColor(rule.userColor, ntColor(ntOpts.userColor, Color3.fromRGB(139, 146, 165)))
	user.TextTruncate = Enum.TextTruncate.AtEnd
	user.Text = userText0
	if userBox then
		user.Position = UDim2.fromOffset(6, 0)
		user.Size = UDim2.new(1, -12, 0, USER_H)
		user.Parent = userBox
	else
		user.Position = UDim2.fromOffset(textLeft, nameTop + NAME_H)
		user.Size = UDim2.new(1, -(textLeft + PAD_RIGHT), 0, USER_H)
		user.Parent = pill
	end

	-- click the pill to teleport to that player (off by default for self)
	if ntOpts.clickTeleport and plr ~= player then
		local click = Instance.new("TextButton")
		click.Name = "ClickTp"
		click.Size = UDim2.fromScale(1, 1)
		click.BackgroundTransparency = 1
		click.Text = ""
		click.AutoButtonColor = false
		click.Active = true
		click.ZIndex = 10
		click.Parent = pill
		click.MouseButton1Click:Connect(function()
			ntTeleportTo(plr)
		end)
	end

	local o = { gui = bb, head = head, pill = pill, stroke = stroke, shadow = shadow, name = name, user = user, avatar = avatar, bgImg = bgImg, fullName = shownName }

	-- distance collapse: beyond collapseDistance the pill shrinks to the
	-- avatar alone (name/user rows hidden) - zooming out triggers it too,
	-- and it applies to YOUR OWN tag as well. Others' icons stay click-
	-- teleportable; openObject keeps the pill full-size while interacting.
	if ntOpts.collapseDistance > 0 then
		o.openObject = Instance.new("BoolValue")
		o.openObject.Name = "XyroTagOpen"
		o.openObject.Value = true
		o.openObject.Parent = bb
		local collapsed = Instance.new("ImageButton")
		collapsed.Name = "Collapsed"
		collapsed.AnchorPoint = Vector2.new(0.5, 0.5)
		collapsed.Position = UDim2.fromScale(0.5, 0.5)
		collapsed.Size = UDim2.fromOffset(ntOpts.collapsedIcon, ntOpts.collapsedIcon)
		-- box style: solid tag-colored tile behind the icon so it pops at
		-- distance instead of floating headshot-in-a-circle
		collapsed.BackgroundColor3 = ntColor(rule.bg, ntColor(ntOpts.pillColor, Color3.fromRGB(12, 12, 16)))
		collapsed.BackgroundTransparency = 0.15
		-- show the TAG's icon (custom image/GIF when the rule has one),
		-- falling back to the player headshot
		collapsed.Image = "rbxthumb://type=AvatarHeadShot&id=" .. tostring(plr.UserId) .. "&w=420&h=420"
		collapsed.ScaleType = Enum.ScaleType.Fit
		collapsed.Visible = false
		collapsed.ZIndex = 10
		collapsed.Parent = bb
		local cCorner = Instance.new("UICorner")
		cCorner.CornerRadius = UDim.new(0, 6) -- rounded-corner box, not a circle
		cCorner.Parent = collapsed
		local cStroke = Instance.new("UIStroke")
		cStroke.Color = ntColor(rule.color, NT_ACCENT)
		cStroke.Thickness = 2
		cStroke.Transparency = 0.25
		cStroke.Parent = collapsed
		collapsed.ImageTransparency = 1
		if type(rule.image) == "string" and rule.image ~= "" then
			task.spawn(function()
				pcall(ntApplyImage, collapsed, rule.image)
			end)
		end
		task.spawn(function()
			task.wait()
			if collapsed.Parent then
				collapsed.ImageTransparency = 0
			end
		end)
		o.collapsed = collapsed
		o.baseSize = bb.Size
		o.collapsedIconSize = ntOpts.collapsedIcon
		if plr ~= player then -- no teleporting to yourself
			collapsed.MouseButton1Click:Connect(function()
				ntTeleportTo(plr)
			end)
		end
	end

	-- avatar: custom icon, else Roblox headshot thumbnail
	local url = type(rule.image) == "string" and rule.image or ""
	if url ~= "" then
		task.spawn(function()
			local ok2, applied = pcall(ntApplyImage, avatar, url)
			if ok2 and applied then
				avatar.Visible = true
			end
		end)
	else
		task.spawn(function()
			pcall(function()
				local content = Players:GetUserThumbnailAsync(plr.UserId, Enum.ThumbnailType.HeadShot, Enum.ThumbnailSize.Size150x150)
				if avatar.Parent and content then
					avatar.Image = content
				end
			end)
		end)
	end

	-- mount out of the character: hidden UI (gethui) first, then PlayerGui,
	-- and only parent to the part itself as a last resort. Adornee keeps the
	-- tag following the head either way; keeping the Gui out of the character
	-- means anti-cheats/game scripts that scan characters never see it
	local mounted = false
	if type(gethui) == "function" then
		local okH, hui = pcall(gethui)
		if okH and typeof(hui) == "Instance" then
			bb.Parent = hui
			mounted = bb.Parent == hui
		end
	end
	if not mounted then
		local pg = player:FindFirstChild("PlayerGui")
		if pg then
			bb.Parent = pg
			mounted = bb.Parent == pg
		end
	end
	if not mounted then
		bb.Parent = head
	end
	return o
end



local function ntRemove(plr)
	local o = ntTags[plr]
	if o then
		if o.gui then
			o.gui:Destroy()
		end
		ntTags[plr] = nil
	end
	-- bring back the game's overhead name once our tag is gone
	pcall(function()
		local ch = plr.Character
		local hum = ch and ch:FindFirstChildOfClass("Humanoid")
		if hum then
			hum.DisplayDistanceType = Enum.HumanoidDisplayDistanceType.Viewer
		end
	end)
end

-- flip a tag between full pill and icon-only collapsed mode. Cheap: only
-- writes when the state actually changes (runs every frame otherwise).
local function ntSetCollapsed(o, on)
	if o.collapsedState == on and o.collapsed and o.collapsed.Visible == on then
		return -- nothing drifted: zero work on the hot path
	end
	o.collapsedState = on
	local bb = o.gui
	if not (bb and bb.Parent) then
		return
	end
	if o.openObject then
		o.openObject.Value = not on
	end
	o.pill.Visible = not on
	if o.shadow then
		o.shadow.Visible = not on
	end
	if o.collapsed then
		o.collapsed.Visible = on
	end
	bb.Size = on and UDim2.fromOffset(o.collapsedIconSize, o.collapsedIconSize) or o.baseSize
end

local function ntCleanup()
	for plr in pairs(ntTags) do
		ntRemove(plr)
	end
	ntTags = {}
	ntEnabled = false
end

connect(Players.PlayerRemoving, ntRemove)

-- heartbeat: announce self, then rebuild the online set from everyone's
-- recent beats. Only players present in ntOnline get tags drawn.
local function ntBeat(manual)
	if not ntMember("HttpGet") then
		return manual and "no HttpGet on this executor" or nil
	end
	local sent = ntHttpPost("https://ntfy.sh/" .. NT_TOPIC, player.Name)
	local text = ntHttpGet("https://ntfy.sh/" .. NT_TOPIC .. "/json?poll=1&since=" .. NT_BEAT_WINDOW .. "s")
	if text and #text > 0 then
		local seen = {}
		for line in text:gmatch("[^\r\n]+") do
			local okD, msg = pcall(function()
				return H.HttpService:JSONDecode(line).message
			end)
			if okD and type(msg) == "string" and #msg > 0 and #msg < 40 then
				seen[ntNormalize(msg)] = true
			end
		end
		-- ntfy is load-balanced: our own POST can land on a different edge
		-- server than this poll reads, so the echo can miss self - the rebuild
		-- must never drop the local player (this executor IS running the
		-- script, which is the only fact presence needs for your own tag)
		seen[ntNormalize(player.Name)] = true
		ntOnline = seen
	end
	if not sent then
		-- couldn't announce ourselves (no POST path on this executor):
		-- at least count self as online so tags aren't dead silent
		ntOnline[ntNormalize(player.Name)] = true
	end
	if manual and H.notify then
		local n = 0
		for _ in pairs(ntOnline) do
			n += 1
		end
		H.notify({
			title = "Nametags",
			text = n .. " script user" .. (n == 1 and "" or "s") .. " online",
			kind = "success",
		})
	end
	return manual and "heartbeat sent" or nil
end

-- saved tag: apply the last fetched config from disk so your pill shows
-- instantly on execute, before the network fetch lands
do
	local cached = ntLoadCache()
	if cached and not (ntOpts.staffOnly and not ntIsStaff(player)) then
		ntRules = cached
		if type(cached.options) == "table" then
			ntApplyOptions(cached.options)
		end
	end
end

-- count yourself online immediately (and send the first heartbeat now,
-- not 45s in) so your own tag can render right away
ntOnline[ntNormalize(player.Name)] = true
-- tags auto-enable on execute: the whole point is your pill shows on
-- your head the moment the script runs (!nametags still toggles it off)
ntEnabled = true
task.spawn(ntBeat, false)

-- background refresh from the repo
task.spawn(ntFetch, false)

-- update watcher: compare against the live version.txt (via the
-- never-cached API) and toast staff/players when their build is old
-- - no more silently running yesterday's script
task.spawn(function()
	local first = true
	while true do
		task.wait(first and 20 or 600)
		first = false
		if VERSION ~= "Unknown" then
			local body = ntHttpGet("https://api.github.com/repos/vertxxy-1/Xyro/contents/version.txt")
			local txt = body and ntFromAPI(body)
			if txt then
				local latest = txt:gsub("%s+", "")
				if latest ~= "" and latest ~= VERSION and H.notify then
					H.notify({
						title = "Xyro",
						text = "update available: " .. latest .. " (running " .. VERSION .. ") - re-execute the loadstring",
						kind = "info",
					})
				end
			end
		end
	end
end)

-- shared per-frame state for the render loop below (allocated ONCE, not
-- per frame - per-frame table/Vector3 churn showed up as real frame loss)
local ntCamPos = Vector3.new()
local ntPlayersTick = 0
local ntPlayers = {}
local ntCamTick = 0
local ntInfoTick = 0
local ntHoverTick = 0
local ntPlayers = {}

connect(RunService.RenderStepped, function(dt)
	ntBeatAcc += dt
	if ntBeatAcc >= NT_BEAT_EVERY then
		ntBeatAcc = 0
		task.spawn(ntBeat, false) -- blocking HTTP never runs on the render thread
	end
	if not ntEnabled then
		return
	end
	ntFetchAcc += dt
	if ntFetchAcc >= NT_FETCH_EVERY then
		ntFetchAcc = 0
		-- HTTP must NEVER run on the render thread: a slow request here
		-- freezes the whole game for its duration (the periodic stutter)
		task.spawn(ntFetch, false)
	end
	local cam = workspace.CurrentCamera
	if not cam then
		ntHideAll()
		return
	end
	ntCamPos = cam.CFrame.Position -- read once per frame, not once per player
	-- ONE tag rebuild per frame: a fetch that changes every rule used to
	-- rebuild all tags inside a single frame, colliding several pure-Lua
	-- GIF decodes into one game-killing freeze
	local ntBuildLeft = 1
	-- player list cached (refreshed at most every 2s) instead of allocating
	-- a fresh GetPlayers() array every single frame
	local nowC = os.clock()
	if nowC - ntPlayersTick >= 2 then
		ntPlayersTick = nowC
		table.clear(ntPlayers)
		for _, p in ipairs(Players:GetPlayers()) do
			ntPlayers[#ntPlayers + 1] = p
		end
	end
	for _, plr in ipairs(ntPlayers) do
		do -- includes self: your own pill renders above your head too
			local ch = plr.Character
			local head = ntAttachPart(ch)
			local rule = ntRuleForPlayer(plr)
			local known = (not ntOpts.onlyScriptUsers) or ntOnline[ntNormalize(plr.Name)] ~= nil
			local want = rule ~= nil and known
			local o = ntTags[plr]

			-- (re)build when missing, on respawn, after game cleanup, or when the
			-- rule changed. Rebuilds past the per-frame budget wait for a later
			-- frame; the old pill stays visible until its replacement is ready
			local fresh = o and o.gui and o.gui.Parent and o.head == head
			local dirty = want and head ~= nil and not (fresh and o.sig == ntSignature(plr, rule))
			if dirty and ntBuildLeft > 0 then
				ntBuildLeft -= 1
				ntRemove(plr)
				o = ntBuild(plr, rule)
				if o then
					o.sig = ntSignature(plr, rule)
				end
				ntTags[plr] = o
			end

			if o and o.gui then
				if want and head then
					-- per-tag info + collapse math runs on a tick (defaults 10x/s
					-- and 15x/s) instead of every frame - the single biggest
					-- per-frame CPU saver here
					local doInfo = nowC - (o.infoT or 0) >= ntOpts.infoEvery
					local doCol = nowC - (o.colT or 0) >= ntOpts.collapseEvery
					if doCol then
						o.colT = nowC
					end
					local dist = o.lastDist
					if doInfo then
						o.infoT = nowC
						dist = (ntCamPos - head.Position).Magnitude
						o.lastDist = dist
					end
					dist = dist or (ntCamPos - head.Position).Magnitude
					local tooFar = ntOpts.maxDistance > 0 and dist > ntOpts.maxDistance
					-- distance collapse: far away the pill shrinks to just the avatar
					-- icon - still click-teleports. Hover the mouse near the icon and
					-- the full pill expands again until the mouse moves off it
					-- (screen-space check: a raycast would false-positive on sky).
					-- Includes self: zoom out and your pill collapses to the icon too
					local wantCollapsed = ntOpts.collapseDistance > 0 and o.collapsed ~= nil and dist > ntOpts.collapseDistance
					local hoverOpen = false
					-- HOVER FIX: the check used to run only while COLLAPSED, so the
					-- tick after it expanded the guard skipped the check, the pill
					-- re-collapsed, the next tick expanded it again -> rapid flicker
					-- whenever the mouse sat near the tag. Now it runs while
					-- wantCollapsed regardless of the current state, with a 48px
					-- open radius and a 64px close radius (hysteresis band: a mouse
					-- parked between the two holds the current state instead of
					-- flip-flopping at collapse-tick rate).
					if wantCollapsed and ntMouse then
						local okPt, sp = pcall(cam.WorldToViewportPoint, cam, head.Position)
						if okPt and typeof(sp) == "Vector3" and sp.Z > 0 then -- was type(sp)=="table": never true for a Vector3, hover-expand never fired
						local dx, dy = ntMouse.X - sp.X, ntMouse.Y - sp.Y
						local d2 = dx * dx + dy * dy
						if o.collapsedState then
							hoverOpen = d2 <= 2304 -- 48px radius squared: open
						else
							hoverOpen = d2 <= 4096 -- 64px: stay open until clearly away
						end
						end
					end
					if doCol and o.collapsed then
						ntSetCollapsed(o, wantCollapsed and not hoverOpen)
					end
					if not tooFar then
						-- live info rides on the @username line (name row is fixed-width).
						-- Built WITHOUT per-frame tables: string concats only, and only
						-- on info ticks (was: 2 allocations + 3 concats per player per frame)
						local info = ""
						if doInfo then
							if ntOpts.showHealth then
								local hum = ch:FindFirstChildOfClass("Humanoid")
								if hum then
									info = math.floor(hum.Health + 0.5) .. "hp"
								end
							end
							if ntOpts.showDistance then
								dist = dist or (ntCamPos - head.Position).Magnitude
								local d = math.floor(dist + 0.5) .. "m"
								info = info == "" and d or (info .. " | " .. d)
							end
							o.lastInfo = info
						end
						info = o.lastInfo or ""
						if info ~= "" then
							info = "   " .. info
						end
						local userBase = o.userBase
						if doInfo then
							if type(rule.userText) == "string" and rule.userText ~= "" then
								userBase = rule.userText:sub(1, 1) == "@" and rule.userText or ("@" .. rule.userText)
							else
								userBase = "@" .. plr.Name
							end
							o.userBase = userBase
						end
						userBase = userBase or ("@" .. plr.Name)
						local newText = userBase .. info
						if o.user.Text ~= newText then
							o.user.Text = newText
						end
						-- typewriter reveal: name fills in character by character,
						-- holds, then restarts (per-rule opt-in)
						if rule.typewriter then
							o.twT = (o.twT or 0) + dt
							local per = 0.07
							local total = #o.fullName * per + 1.4
							if o.twT > total then
								o.twT = 0
							end
							local shown = string.sub(o.fullName, 1, math.min(#o.fullName, math.floor(o.twT / per)))
							if o.name.Text ~= shown then
								o.name.Text = shown
							end
						elseif o.name.Text ~= o.fullName then
							o.name.Text = o.fullName
						end
						o.gui.Enabled = true
					else
						o.gui.Enabled = false
					end
				else
					o.gui.Enabled = false
				end
			end
		end
	end
end)

add{
	name = "nametags",
	alias = { "tags" },
	group = "Visuals",
	help = "Website nametags - toggle on/off",
	bindable = true,
	run = function()
		ntEnabled = not ntEnabled
		if ntEnabled and not ntRules then
			task.spawn(ntFetch, true) -- blocking HTTP never runs inline
		end
		if not ntEnabled then
			ntHideAll()
		end
		return "nametags " .. (ntEnabled and "on" or "off")
	end,
}
add{
	name = "nametagsfetch",
	alias = { "tagsfetch" },
	group = "Visuals",
	help = "Refetch nametags.json from the repo now",
	run = function()
		-- fully off the main thread: the fetch chain (API -> CDN -> raw) and the
		-- heartbeat are blocking HTTP; inline here they froze the game solid
		-- until every request returned (the tagsfetch freeze-and-crash)
		task.spawn(function()
			local msg = ntFetch(true)
			local beat = ntBeat(true)
			if msg and msg:sub(1, 6) ~= "loaded" and H.notify then
				H.notify({
					title = "Nametags",
					text = msg,
					kind = "error",
				})
			end
		end)
		return "fetching in background..."
	end,
}
add{
	name = "tagdebug",
	alias = { "tagsdebug" },
	group = "Visuals",
	help = "Show why each player does or doesn't have a nametag",
	run = function()
		local lines = {}
		for _, plr in ipairs(Players:GetPlayers()) do
			local rule = ntRuleForPlayer(plr)
			local online = ntOnline[ntNormalize(plr.Name)] ~= nil
			local built = ntTags[plr] ~= nil
			local status = "NO TAG"
			if built then
				status = "tag shown" .. (plr == player and " (you)" or "")
			elseif not rule then
				status = "NO MATCHING RULE"
			elseif ntOpts.staffOnly and not ntIsStaff(plr) then
				status = "blocked: staff-only mode"
			elseif not online and ntOpts.onlyScriptUsers then
				status = "not running Xyro (presence gate)"
			end
			local staffMark = ntIsStaff(plr) and " [staff]" or ""
			lines[#lines + 1] = ("%s%s | display: %s | %s | rule: %s"):format(
				plr.Name,
				staffMark,
				plr.DisplayName,
				status,
				rule and ("[" .. rule.label .. "]") or "none"
			)
		end
		print("[Xyro tagdebug] " .. #lines .. " player(s):")
		for _, l in ipairs(lines) do
			print("  " .. l)
		end
		print("  rules source: " .. ntLastSource)
		return #lines .. " player(s) checked - details in console (F9)"
	end,
}

H.Nametags = {
	toggle = function()
		ntEnabled = not ntEnabled
		if ntEnabled and not ntRules then
			ntFetch(true)
		end
		if not ntEnabled then
			ntHideAll()
		end
		return ntEnabled
	end,
	isOn = function()
		return ntEnabled
	end,
	fetch = ntFetch,
	beat = ntBeat,
	online = function()
		return ntOnline
	end,
	cleanup = ntCleanup,
	url = NT_FALLBACK_URL,
}

local function listWindow(name, title, rows)
	local existing = gui:FindFirstChild(name)
	if existing then
		H.popOut(existing, function()
			existing:Destroy()
		end)
		return
	end
	local f = make("Frame", {
		Name = name,
		Size = UDim2.new(0, 380, 0, 420),
		Position = UDim2.new(0.5, -190, 0.5, -210),
		BackgroundColor3 = COL.bg,
		BorderSizePixel = 0,
		Active = true,
	}, gui)
	round(f, 10)
	make("UIStroke", { Color = COL.stroke, Thickness = 1 }, f)
	H.makeResizable(f, 380, 420)

	local bar = make("TextLabel", {
		Size = UDim2.new(1, -44, 0, 34),
		Position = UDim2.new(0, 14, 0, 2),
		BackgroundTransparency = 1,
		Font = Enum.Font.GothamBold,
		TextSize = 15,
		TextColor3 = COL.text,
		Text = title,
		TextXAlignment = Enum.TextXAlignment.Left,
	}, f)
	bar.Active = true

	H.chrome(f, { header = 38, title = bar })

	local sc = make("ScrollingFrame", {
		Size = UDim2.new(1, -20, 1, -48),
		Position = UDim2.new(0, 10, 0, 40),
		BackgroundTransparency = 1,
		BorderSizePixel = 0,
		ScrollBarThickness = 4,
		ScrollBarImageColor3 = COL.sub,
		CanvasSize = UDim2.new(0, 0, 0, 0),
	}, f)
	local layout = make("UIListLayout", {
		Padding = UDim.new(0, 4),
		SortOrder = Enum.SortOrder.LayoutOrder,
	}, sc)
	make("UIPadding", {
		PaddingTop = UDim.new(0, 4),
		PaddingLeft = UDim.new(0, 4),
		PaddingRight = UDim.new(0, 4),
	}, sc)

	for i, r in ipairs(rows) do
		local isHeader = r.header
		local lbl = make("TextLabel", {
			Size = UDim2.new(1, -6, 0, isHeader and 20 or 24),
			BackgroundTransparency = isHeader and 1 or 0,
			Font = isHeader and Enum.Font.GothamBold or Enum.Font.Gotham,
			TextSize = isHeader and 11 or 12,
			TextColor3 = isHeader and COL.sub or COL.text,
			Text = isHeader and r.text or ("  " .. r.text),
			TextXAlignment = Enum.TextXAlignment.Left,
			BorderSizePixel = 0,
			LayoutOrder = i,
		}, sc)
		if not isHeader then
			lbl.BackgroundColor3 = COL.element
			round(lbl, 5)
		end
	end

	local function size()
		sc.CanvasSize = UDim2.new(0, 0, 0, layout.AbsoluteContentSize.Y / H.scaleOf(sc) + 6)
	end
	connect(layout:GetPropertyChangedSignal("AbsoluteContentSize"), size)
	size()

	H.makeDraggable(f, bar)
	H.animateAll(f)
	H.popIn(f)
end

local GROUP_ORDER = {
	"Movement", "Combat", "Visuals", "World", "Camera",
	"Players", "Self", "Server", "Chat", "Binds", "Scripts", "Hub",
}

local function openHelp()
	H.openCommandList = openHelp -- the title-bar search button (created earlier) routes here
	local rows = {}
	local seen = {}
	local function emit(group)
		local first = true
		for _, s in ipairs(ORDER) do
			if s.group == group and not s.debug then
				if first then
					rows[#rows + 1] = { text = string.upper(group), header = true }
					first = false
				end
				rows[#rows + 1] = { text = _G.prefix .. signature(s) .. "   -   " .. s.help }
			end
		end
		seen[group] = true
	end
	for _, g in ipairs(GROUP_ORDER) do
		emit(g)
	end
	for _, s in ipairs(ORDER) do
		if not seen[s.group] then
			emit(s.group)
		end
	end
	listWindow("HelpUI", "Xyro", rows)
end

local function openBindHelp()
	local rows = { { text = "bind <action> <key>   e.g.  bind fly x", header = true } }
	for _, s in ipairs(ORDER) do
		if s.bindable then
			local bound
			for k, c in pairs(Binds) do
				if c == s.name then
					bound = k
					break
				end
			end
			rows[#rows + 1] = { text = s.name .. (bound and ("   [" .. bound .. "]") or "") .. "   -   " .. s.help }
		end
	end
	listWindow("BindHelp", "Bindable actions", rows)
end

local function openAliasList()
	local byCommand = {}
	for aliasName, cmdName in pairs(UserAliases) do

		local spec = CMDS[cmdName]
		local mainName = spec and commandLabel(spec) or cmdName
		byCommand[mainName] = byCommand[mainName] or {}
		table.insert(byCommand[mainName], aliasName)
	end
	local commands = {}
	for cmdName in pairs(byCommand) do
		commands[#commands + 1] = cmdName
	end
	table.sort(commands)

	local rows = {}
	if #commands == 0 then
		rows[#rows + 1] = { text = "no aliases yet - try  alias <command> <name>", header = true }
	else
		for _, cmdName in ipairs(commands) do
			rows[#rows + 1] = { text = cmdName, header = true }
			local names = byCommand[cmdName]
			table.sort(names)
			for _, n in ipairs(names) do
				rows[#rows + 1] = { text = n }
			end
		end
	end
	listWindow("AliasList", "Aliases", rows)
end

local function openCmdBar()
	local existing = gui:FindFirstChild("CmdBar")
	if existing then
		H.popOut(existing, function()
			existing:Destroy()
		end)
		return
	end

	local cmdGui = make("Frame", {
		Name = "CmdBar",
		Size = UDim2.new(0, 420, 0, 45),
		Position = UDim2.new(0.5, -210, 1, -80),
		BackgroundColor3 = COL.bg,
		BorderSizePixel = 0,
	}, gui)

	round(cmdGui, 10)

	make("UIStroke", {
		Color = COL.stroke,
		Thickness = 1,
	}, cmdGui)
	H.makeResizable(cmdGui, 420, 45)

	H.makeDraggable(cmdGui)
	H.popIn(cmdGui)

	local box = make("TextBox", {

		Size = UDim2.new(1, -34, 1, -10),
		Position = UDim2.new(0, 10, 0, 5),

		BackgroundColor3 = COL.element,

		Font = Enum.Font.Gotham,
		TextSize = 14,

		Text = "",
		TextColor3 = COL.text,

		PlaceholderText = "Enter command here",
		PlaceholderColor3 = COL.sub,

		ClearTextOnFocus = false,

		BorderSizePixel = 0,
	}, cmdGui)

	round(box, 7)

	box.FocusLost:Connect(function(enter)
		if not enter then
			return
		end

		local input = box.Text
		box.Text = ""

		if input == "" then
			return
		end

		hubRunCommand(input)
	end)
	box:CaptureFocus()

end

local function openClickTp()
	if _G.ClickTpCleanup then
		pcall(_G.ClickTpCleanup)
		task.wait()
	end

	local Players = game:GetService("Players")
	local UIS = game:GetService("UserInputService")

	local player = Players.LocalPlayer
	local mouse = player:GetMouse()

	if _G.ClickTpCleanup then
		pcall(_G.ClickTpCleanup)
	end

	local clickConns = {}

	local function clickConnect(signal, func)
		local c = signal:Connect(func)
		table.insert(clickConns, c)
		return c
	end

	local waitingModifier = false
	local waitingKey = false

	local clickGui = gui:FindFirstChild("ClickTpUI")

	if clickGui then
		clickGui:Destroy()
	end

	clickGui = make("ScreenGui", {
		Name = "ClickTpUI",
		ResetOnSpawn = false,
	}, gui)

	local frame = make("Frame", {
		Name = "ClickTpFrame",

		Size = UDim2.new(0, 220, 0, 162),
		Position = UDim2.new(0, 20, 0, 250),
		BackgroundColor3 = COL.bg,
		BorderSizePixel = 0,
		Active = true,
	}, clickGui)

	round(frame, 10)

	make("UIStroke", {
		Color = COL.stroke,
		Thickness = 1,
	}, frame)
	H.makeResizable(frame, 220, 162)

	local title = make("TextLabel", {
		Size = UDim2.new(1, -40, 0, 30),
		Position = UDim2.new(0, 10, 0, 5),
		BackgroundTransparency = 1,
		Font = Enum.Font.GothamBold,
		TextSize = 15,
		TextColor3 = COL.text,
		Text = "Click TP",
		TextXAlignment = Enum.TextXAlignment.Left,
	}, frame)

	title.Active = true

	H.chrome(frame, {
		header = 38,
		title = title,
		onClose = function()

			pcall(hubSaveConfig)

			if _G.ClickTpCleanup then
				_G.ClickTpCleanup()
			else
				clickGui:Destroy()
			end
		end,
	})

	local toggle = make("TextButton", {
		Size = UDim2.new(1, -20, 0, 28),
		Position = UDim2.new(0, 10, 0, 40),
		BackgroundColor3 = COL.off,
		Text = "Enabled: " .. (ClickTp.enabled and "ON" or "OFF"),
		TextColor3 = COL.text,
		BorderSizePixel = 0,
	}, frame)

	round(toggle, 6)
	toggle.BackgroundColor3 = ClickTp.enabled and COL.on or COL.off

	local mod = make("TextButton", {
		Size = UDim2.new(1, -20, 0, 28),
		Position = UDim2.new(0, 10, 0, 75),
		BackgroundColor3 = COL.element,
		Text = "Modifier: " .. ClickTp.modifier.Name,
		TextColor3 = COL.text,
		BorderSizePixel = 0,
	}, frame)

	round(mod, 6)

	local key = make("TextButton", {
		Size = UDim2.new(1, -20, 0, 28),
		Position = UDim2.new(0, 10, 0, 110),
		BackgroundColor3 = COL.element,
		Text = "Key: " .. ClickTp.key.Name,
		TextColor3 = COL.text,
		BorderSizePixel = 0,
	}, frame)

	round(key, 6)

	toggle.MouseButton1Click:Connect(function()
		ClickTp.enabled = not ClickTp.enabled

		toggle.Text = "Enabled: " .. (ClickTp.enabled and "ON" or "OFF")
		toggle.BackgroundColor3 = ClickTp.enabled and COL.on or COL.off
	end)

	mod.MouseButton1Click:Connect(function()
		waitingModifier = true
		mod.Text = "Modifier: press key"
	end)

	key.MouseButton1Click:Connect(function()
		waitingKey = true
		key.Text = "Key: press key"
	end)

	clickConnect(UIS.InputBegan, function(input, gp)
		if input.UserInputType ~= Enum.UserInputType.Keyboard then
			return
		end

		if waitingModifier then
			ClickTp.modifier = input.KeyCode
			waitingModifier = false

			mod.Text = "Modifier: " .. ClickTp.modifier.Name

			return
		end

		if waitingKey then
			ClickTp.key = input.KeyCode
			waitingKey = false

			key.Text = "Key: " .. ClickTp.key.Name

			return
		end

		if gp or not ClickTp.enabled then
			return
		end

		if input.KeyCode == ClickTp.key then
			if UIS:IsKeyDown(ClickTp.modifier) then
				local root = player.Character and player.Character:FindFirstChild("HumanoidRootPart")

				if root and mouse.Hit then
					root.CFrame = CFrame.new(mouse.Hit.Position + Vector3.new(0, 3, 0))
				end
			end
		end
	end)

	H.makeDraggable(frame, title, clickConnect)
	H.animateAll(frame)
	H.popIn(frame)

	_G.ClickTpToggle = function()
		frame.Visible = not frame.Visible
	end

	_G.ClickTpCleanup = function()
		for _, c in ipairs(clickConns) do
			pcall(function()
				c:Disconnect()
			end)
		end

		if clickGui then
			clickGui:Destroy()
		end

		_G.ClickTpToggle = nil
		_G.ClickTpCleanup = nil
	end

end

add{
	name = "fly",
	alias = { "sfly" },
	args = "<speed>",
	group = "Movement",
	help = "Fly. A number sets the speed",
	bindable = true,
	run = function(c)
		Fly.doSfly(c.arg)
	end,
}
add{
	name = "cframe",
	alias = { "speed" },
	args = "<speed>",
	group = "Movement",
	help = "CFrame movement. A number sets the speed",
	bindable = true,
	run = function(c)
		if c.n then
			_G.CFrameSpeed = H.clampV(c.n, 0, 1000000)
			Speed.updateUI()
			return "cframe speed " .. _G.CFrameSpeed
		end
		Speed.toggle()
		return "cframe toggled"
	end,
}
add{
	name = "gravity",
	alias = { "grav" },
	args = "<n>",
	group = "World",
	help = "Custom gravity. A number sets the value",
	bindable = true,
	run = function(c)
		if c.n then
			Grav.setCustom(c.n)
			return "gravity set to " .. Grav.getCustom()
		end
		Grav.toggle()
		return "gravity toggled"
	end,
}
add{
	name = "noclip",
	group = "Movement",
	help = "Walk through walls",
	bindable = true,
	run = function()
		Move.toggleNoclip()
		return "noclip " .. onoff(Move.isNoclip())
	end,
}
add{
	name = "infjump",
	group = "Movement",
	help = "Jump again in mid-air, forever",
	bindable = true,
	run = function()
		Move.toggleInfJump()
		return "infinite jump " .. onoff(Move.isInfJump())
	end,
}
add{
	name = "spin",
	args = "<speed>",
	group = "Movement",
	help = "Spin your character. A number sets the speed",
	bindable = true,
	run = function(c)
		local on, sp = Move.spin(c.n)
		return on and ("spin on @ " .. sp) or "spin off"
	end,
}
add{
	name = "esp",
	args = "<box|skeleton|health|distance|tracer|chams>",
	group = "Visuals",
	help = "Master ESP, or one type with an argument",
	bindable = true,
	run = function(c)
		if not Esp.hasDrawing() then
			return "no Drawing API"
		end
		if c.arg == "" then
			Esp.toggle()
			return "esp " .. onoff(Esp.isOn())
		end
		local state = Esp.toggleType(c.arg:lower())
		if state == nil then
			return "esp: box | skeleton | health | distance | tracer | chams"
		end
		return "esp " .. c.arg:lower() .. " " .. onoff(state)
	end,
}
add{
	name = "fullbright",
	alias = { "fb" },
	group = "World",
	help = "Remove all darkness",
	bindable = true,
	run = function()
		world.toggleFullbright()
		return "fullbright " .. onoff(world.fullbright)
	end,
}
add{
	name = "nofog",
	group = "World",
	help = "Remove fog",
	bindable = true,
	run = function()
		world.toggleNofog()
		return "fog removal " .. onoff(world.nofog)
	end,
}
add{
	name = "xray",
	group = "Visuals",
	help = "See through the map",
	bindable = true,
	run = function()
		world.toggleXray()
		return "x-ray " .. onoff(world.xrayOn)
	end,
}
add{
	name = "infbaseplate",
	alias = { "infinitebaseplate" },
	group = "World",
	help = "Infinite baseplate",
	bindable = true,
	run = function()
		world.toggleInfBaseplate()
	end,
}
add{
	name = "menu",
	group = "Hub",
	help = "Show / hide the hub",
	bindable = true,
	run = function()
		if main.Visible then
			H.popOut(main, function()
				main.Visible = false
			end)
		else
			main.Visible = true
			H.popIn(main)
		end
	end,
}
add{
	name = "prefix",
	alias = { "setprefix" },
	args = "<string>",
	group = "Hub",
	help = "Change the command prefix",
	run = function(c)
		if not c.arg or c.arg == "" then
			return "Please enter a proper prefix."
		end

		_G.prefix = c.arg
		writefile("Xyro/prefix.txt", tostring(c.arg))
		return "Prefix changed to '" .. c.arg .. "'"
	end,
}
add{
	name = "alias",
	args = "<command> <name>",
	group = "Hub",
	help = "Make your own name for a command. Also: alias list / alias remove <name|command> / alias clear",
	run = function(c)
		local first, rest = c.arg:match("^(%S*)%s*(.-)$")
		first = first:lower()

		if first == "" or first == "help" or first == "list" then
			openAliasList()
			return
		end

		if first == "clear" then
			for a in pairs(UserAliases) do
				UserAliases[a] = nil
			end
			saveAliases()
			return "aliases cleared"
		end

		if first == "remove" or first == "rm" or first == "del" then
			local target = (rest:match("^(%S+)") or ""):lower()
			if target == "" then
				return "usage: alias remove <name|command>"
			end

			if UserAliases[target] then
				UserAliases[target] = nil
				saveAliases()
				return "removed alias '" .. target .. "'"
			end

			local spec = CMDS[target]
			local wantLabel = spec and commandLabel(spec) or target
			local removed = 0
			for aliasName, cmdName in pairs(UserAliases) do
				local label = CMDS[cmdName] and commandLabel(CMDS[cmdName]) or cmdName
				if label == wantLabel then
					UserAliases[aliasName] = nil
					removed = removed + 1
				end
			end
			if removed > 0 then
				saveAliases()
				return "removed " .. removed .. " alias" .. (removed == 1 and "" or "es") .. " for '" .. wantLabel .. "'"
			end
			return "no alias '" .. target .. "'"
		end

		local cmdName = first
		local aliasName = (rest:match("^(%S+)") or ""):lower()
		if aliasName == "" then
			return "usage: alias <command> <name>"
		end
		local spec = CMDS[cmdName]
		if not spec then
			return "unknown command: " .. cmdName
		end
		if CMDS[aliasName] then
			return "'" .. aliasName .. "' is already a command"
		end

		local label = commandLabel(spec)
		UserAliases[aliasName] = label
		saveAliases()
		return "alias '" .. aliasName .. "' -> " .. label
	end,
}
add{
	name = "credits",
	alias = { "cred" },
	group = "Hub",
	help = "Show the credits splash",
	run = function()
		if H.credits then
			H.credits(5)
		end
	end,
}

add{
	name = "ws",
	alias = { "walkspeed" },
	args = "<n>",
	group = "Movement",
	help = "Walk speed (0-500)",
	run = function(c)
		if not c.n then
			return "needs a number"
		end
		Move.setWalkSpeed(c.n)
		return "Set walkspeed to " .. Move.getWalkSpeed()
	end,
}
add{
	name = "jp",
	alias = { "jumppower" },
	args = "<n>",
	group = "Movement",
	help = "Jump power (0-500)",
	run = function(c)
		if not c.n then
			return "needs a number"
		end
		Move.setJumpPower(c.n)
		return "Set jumppower to " .. Move.getJumpPower()
	end,
}
add{
	name = "fov",
	args = "<n|reset>",
	group = "Camera",
	help = "Field of view (1-120), or reset",
	run = function(c)
		if c.arg:lower() == "reset" or c.arg == "" then
			world.fov = 70
			world.fovBox.Text = "70"
			world.applyFov()
			return "fov reset"
		end
		if not c.n then
			return "needs a number or 'reset'"
		end
		world.fov = H.clampV(c.n, 1, 120)
		world.fovBox.Text = tostring(world.fov)
		world.applyFov()
		return "fov " .. world.fov
	end,
}
add{
	name = "hitbox",
	args = "<n>",
	group = "Combat",
	help = "Hitbox size (1-10)",
	run = function(c)
		if not c.n then
			return "needs a number"
		end
		Hitbox.setSize(c.n)
		return "hitbox " .. Hitbox.getSize()
	end,
}
add{
	name = "brightness",
	args = "<n>",
	group = "World",
	help = "Lighting brightness (0-lots)",
	run = function(c)
		if not c.n then
			return "needs a number"
		end
		return "brightness " .. world.setBrightness(c.n)
	end,
}
add{
	name = "time",
	args = "<0-24>",
	group = "World",
	help = "Time of day, 24hr clock",
	run = function(c)
		if not c.n then
			return "needs an hour"
		end
		return "time " .. world.setTime(c.n)
	end,
}

add{
	name = "tp",
	alias = { "goto" },
	args = "<player>",
	group = "Players",
	help = "Teleport to a player",
	run = function(c)
		local t = hubFindPlayer(c.arg)
		local thrp = t and t.Character and t.Character:FindFirstChild("HumanoidRootPart")
		local myhrp = player.Character and player.Character:FindFirstChild("HumanoidRootPart")
		if not (thrp and myhrp) then
			return "player not found"
		end
		myhrp.CFrame = thrp.CFrame + Vector3.new(0, 0, 3)
		return "teleported to " .. t.Name
	end,
}
add{
	name = "sp",
	args = "<player>",
	group = "Players",
	help = "Spectate a player",
	run = function(c)
		local t = hubFindPlayer(c.arg)
		local thum = t and t.Character and t.Character:FindFirstChildOfClass("Humanoid")
		if not thum then
			return "player not found"
		end
		workspace.CurrentCamera.CameraSubject = thum
		return "spectating " .. t.Name
	end,
}
add{
	name = "unsp",
	group = "Players",
	help = "Stop spectating",
	run = function()
		local hum = player.Character and player.Character:FindFirstChildOfClass("Humanoid")
		if hum then
			workspace.CurrentCamera.CameraSubject = hum
		end
		return "stopped spectating"
	end,
}
add{
	name = "clicktp",
	group = "Players",
	help = "Open the Click TP window",
	bindable = true,
	run = openClickTp,
}
add{
	name = "vcmute",
	alias = { "mute" },
	args = "<player>",
	group = "Players",
	help = "Mute a player's VC audio",
	run = function(c)
		local t = hubFindPlayer(c.arg)
		if not t then
			return "player not found"
		end

		local n = 0
		for _, root in ipairs({ t.Character, t }) do
			if root then
				for _, v in ipairs(root:GetDescendants()) do
					if v:IsA("AudioDeviceInput") then
						pcall(function()
							v.Muted = true
						end)
						n = n + 1
					end
				end
			end
		end
		if n == 0 then
			return t.Name .. " has no VC audio (not in voice?)"
		end
		return "muted " .. t.Name
	end,
}
add{
	name = "vcunmute",
	alias = { "unmute" },
	args = "<player>",
	group = "Players",
	help = "Unmute a player's VC audio",
	run = function(c)
		local t = hubFindPlayer(c.arg)
		if not t then
			return "player not found"
		end
		local n = 0
		for _, root in ipairs({ t.Character, t }) do
			if root then
				for _, v in ipairs(root:GetDescendants()) do
					if v:IsA("AudioDeviceInput") then
						pcall(function()
							v.Muted = false
						end)
						n = n + 1
					end
				end
			end
		end
		if n == 0 then
			return t.Name .. " has no VC audio (not in voice?)"
		end
		return "unmuted " .. t.Name
	end,
}

add{
	name = "bind",
	args = "<action> <key>",
	group = "Binds",
	help = "Bind a key. Also: bind help / bind list / bind clear",
	run = function(c)
		local action, keyName = c.arg:match("^(%S*)%s*(.-)$")
		action = action:lower()
		if action == "" or action == "help" then
			openBindHelp()
			return
		end
		if action == "list" then
			local out = {}
			for k, cmdName in pairs(Binds) do
				out[#out + 1] = k .. "=" .. cmdName
			end
			return #out > 0 and table.concat(out, " ") or "no binds set"
		end
		if action == "clear" then
			for k in pairs(Binds) do
				Binds[k] = nil
			end
			H.refreshKeys()
			pcall(hubSaveConfig)
			return "binds cleared"
		end
		local spec = CMDS[action]
		if not (spec and spec.bindable) then
			return "can't bind that - try: bind help"
		end
		if keyName == "" then
			return "usage: bind " .. action .. " <key>"
		end
		local kc = hubKeyFromName(keyName)
		if not kc then
			return "unknown key: " .. keyName
		end
		H.setBind(spec.name, kc.Name)
		pcall(hubSaveConfig)
		return "bound " .. kc.Name .. " -> " .. spec.name
	end,
}
add{
	name = "unbind",
	args = "<key>",
	group = "Binds",
	help = "Remove one bind",
	run = function(c)
		local kc = hubKeyFromName(c.arg)
		if not (kc and Binds[kc.Name]) then
			return "nothing bound to that key"
		end
		Binds[kc.Name] = nil
		H.refreshKeys()
		pcall(hubSaveConfig)
		return "unbound " .. kc.Name
	end,
}

add{
    name = "reset",
    alias = { "respawn", "re", "die" },
    group = "Self",
    help = "Respawn your character",
    bindable = true,

    run = function()
        local character = player.Character
        local root = character and character:FindFirstChild("HumanoidRootPart")
        local hum = character and character:FindFirstChildOfClass("Humanoid")

        if not hum or not root then
            return "no character"
        end

        local oldCFrame = root.CFrame

        hum.Health = 0

        local newCharacter = player.CharacterAdded:Wait()
        local newRoot = newCharacter:WaitForChild("HumanoidRootPart", 10)

        if not newRoot then
            return "respawned, but no root"
        end

        newRoot.CFrame = oldCFrame

        return "respawning"
    end,
}
add{
	name = "print",
	args = "<text>",
	group = "Scripts",
	help = "Echo text back in the bar",
	run = function(c)
		if c.arg == "" then
			return "needs some text"
		end
		print("[hub] " .. c.arg)
		return c.arg
	end,
}
add{
    name = "antivc",
	alias = { "antivcb", "vcbypass" },
    group = "Scripts",
    help = "Load the anti-VC script",
    run = function()
        if not loadstring then
            return "loadstring is not available"
        end
        local ok, err = pcall(function()
            loadstring(game:HttpGet("https://shield.xao.wtf/api/loader/550af30c-aaa3-4338-acab-f44010a5ef09"))()
        end)
        if not ok then
            warn("[antivc] " .. tostring(err))
            return "antivc failed - see console"
        end
        return "antivc loaded"
    end,
}add{
	name = "tptool",
	alias = { "tp tool" },
	group = "Tools",
	help = "Get a clickable TP Tool (teleports where you point)",
	run = function()
		local backpack = player:FindFirstChildOfClass("Backpack")
		if not backpack then
			return "no backpack"
		end
		local function makeTool()
			local tool = Instance.new("Tool")
			tool.Name = "TP Tool"
			tool.RequiresHandle = false
			tool.ToolTip = "Click to teleport to the aimed position"
			tool.Activated:Connect(function()
				pcall(function()
					local hit = player:GetMouse().Hit
					if hit then
						local pos = hit + Vector3.new(0, 2.5, 0)
						local ch = player.Character
						local hrp = ch and (ch:FindFirstChild("HumanoidRootPart") or ch:FindFirstChild("Torso"))
						if hrp then
							hrp.CFrame = CFrame.new(pos.X, pos.Y, pos.Z)
						end
					end
				end)
			end)
			return tool
		end
		-- fresh tool now, and re-give after every respawn
		local function give()
			local bp = player:FindFirstChildOfClass("Backpack")
			if bp and not bp:FindFirstChild("TP Tool") then
				makeTool().Parent = bp
			end
		end
		for _, t in ipairs(backpack:GetChildren()) do
			if t:IsA("Tool") and t.Name == "TP Tool" then
				t:Destroy()
			end
		end
		give()
		if not ntTpToolConn then
			ntTpToolConn = player.CharacterAdded:Connect(function()
				task.wait(0.5)
				give()
			end)
			local unload = _G.ScriptHubCleanup
			_G.ScriptHubCleanup = function()
				if ntTpToolConn then
					ntTpToolConn:Disconnect()
					ntTpToolConn = nil
				end
				local bp = player:FindFirstChildOfClass("Backpack")
				local t = bp and bp:FindFirstChild("TP Tool")
				if t then
					t:Destroy()
				end
				local ch = player.Character
				local t2 = ch and ch:FindFirstChild("TP Tool")
				if t2 then
					t2:Destroy()
				end
				if unload then
					pcall(unload)
				end
			end
		end
		return "TP Tool given - click to teleport to your cursor"
	end,
}
add{
	name = "rejoin",
	group = "Server",
	help = "Rejoin the same server",
	bindable = true,
	run = function()
		local ts = game:GetService("TeleportService")
		local ok = pcall(function()
			if #Players:GetPlayers() <= 1 then
				ts:Teleport(game.PlaceId, player)
			else
				ts:TeleportToPlaceInstance(game.PlaceId, game.JobId, player)
			end
		end)
		return ok and "rejoining..." or "rejoin failed"
	end,
}
add{
	name = "runcode",
	alias = { "lua" },
	args = "<code>",
	group = "Scripts",
	help = "Execute Lua",
	run = function(c)
		if c.arg == "" then
			return "needs code"
		end
		local fn, err = loadstring(c.arg)
		if not fn then
			return "load error: " .. tostring(err)
		end
		local ok, res = pcall(fn)
		return ok and "ran ok" or ("error: " .. tostring(res))
	end,
}
add{
	name = "cmdbar",
	group = "Scripts",
	help = "Open the floating command bar",
	bindable = true,
	run = openCmdBar,
}
add{
	name = "help",
	group = "Scripts",
	help = "Open this menu",
	bindable = true,
	run = openHelp,
}
add{
	name = "unload",
	group = "Server",
	help = "Remove the hub",
	bindable = true,
	run = function()
		if _G.ScriptHubCleanup then
			_G.ScriptHubCleanup()
		end
	end,
}

local function loadUrl(url)
	if not loadstring then
		return "no loadstring"
	end
	local ok, err = pcall(function()
		loadstring(game:HttpGet(url))()
	end)
	return ok and "loaded" or ("failed: " .. tostring(err))
end

local function sendChat(msg)
	local TCS = game:GetService("TextChatService")
	if TCS.ChatVersion == Enum.ChatVersion.TextChatService then
		local channels = TCS:FindFirstChild("TextChannels")
		local ch = channels and channels:FindFirstChild("RBXGeneral")
		if ch then
			ch:SendAsync(msg)
			return true
		end
		return false
	end
	local ev = game:GetService("ReplicatedStorage"):FindFirstChild("DefaultChatSystemChatEvents")
	local say = ev and ev:FindFirstChild("SayMessageRequest")
	if say then
		say:FireServer(msg, "All")
		return true
	end
	return false
end

local function hopTo(wantSmall)
	local TS = game:GetService("TeleportService")
	local HS = game:GetService("HttpService")
	local ok, data = pcall(function()
		return HS:JSONDecode(game:HttpGet(
			"https://games.roblox.com/v1/games/" .. game.PlaceId .. "/servers/Public?sortOrder=Asc&limit=100"
		))
	end)
	if not ok or type(data) ~= "table" or type(data.data) ~= "table" then
		return "server list unavailable"
	end
	local best
	for _, s in ipairs(data.data) do
		if s.id ~= game.JobId and s.playing and s.maxPlayers and s.playing < s.maxPlayers then
			if wantSmall then
				if not best or s.playing < best.playing then
					best = s
				end
			else
				best = s
				break
			end
		end
	end
	if not best then
		return "no other servers found"
	end
	pcall(function()
		TS:TeleportToPlaceInstance(game.PlaceId, best.id, player)
	end)
	return "teleporting..."
end

local function openBoardNotifier()

	local existing = gui:FindFirstChild("BoardNotifier")
	if existing then
		H.popOut(existing, function()
			existing:Destroy()
		end)
		return "Board Notifier closed"
	end

	local function findText()
		local node = workspace
		for _, part in ipairs({ "map", "school", "input", "activate", "title", "thing" }) do
			node = node and node:FindFirstChild(part)
		end
		return node
	end

	local function findAdjust()
		local pg = player:FindFirstChildOfClass("PlayerGui")
		local node = pg
		for _, part in ipairs({ "map", "object", "hub", "bg", "adjust" }) do
			node = node and node:FindFirstChild(part)
		end
		return node
	end

	local thing = findText()
	if not thing then
		H.notify({ title = "Board Notifier", text = "Board not found in this game.", kind = "error" })
		return "board not found"
	end

	local toggled = true
	local logsShown = false
	local lastText = tostring(thing.Text)
	local logOrder = 0
	local localConns = {}

	local function track(sig, fn)
		local c = fn and connect(sig, fn) or sig
		localConns[#localConns + 1] = c
		return c
	end

	local win = make("Frame", {
		Name = "BoardNotifier",
		Size = UDim2.new(0, 340, 0, 250),
		Position = UDim2.new(0.5, -170, 0.5, -125),
		BackgroundColor3 = COL.bg,
		BorderSizePixel = 0,
		Active = true,
	}, gui)
	round(win, 10)
	make("UIStroke", { Color = COL.stroke, Thickness = 1 }, win)
	make("UIScale", { Scale = 1 }, win)

	local bar = make("TextLabel", {
		Size = UDim2.new(1, -44, 0, 34),
		Position = UDim2.new(0, 14, 0, 2),
		BackgroundTransparency = 1,
		Font = Enum.Font.GothamBold,
		TextSize = 15,
		TextColor3 = COL.text,
		Text = "Board Notifier",
		TextXAlignment = Enum.TextXAlignment.Left,
	}, win)
	bar.Active = true

	H.chrome(win, {
		header = 40,
		title = bar,
	})

	local currentLabel = make("TextLabel", {
		Size = UDim2.new(1, -20, 0, 48),
		Position = UDim2.new(0, 10, 0, 44),
		BackgroundColor3 = COL.element,
		BorderSizePixel = 0,
		Font = Enum.Font.Gotham,
		TextSize = 13,
		TextColor3 = COL.text,
		Text = "Current: " .. lastText,
		TextWrapped = true,
		TextXAlignment = Enum.TextXAlignment.Left,
		TextYAlignment = Enum.TextYAlignment.Center,
	}, win)
	round(currentLabel, 6)

	local toggleBtn = make("TextButton", {
		Size = UDim2.new(0, 155, 0, 36),
		Position = UDim2.new(0, 10, 0, 102),
		BackgroundColor3 = COL.accent,
		BorderSizePixel = 0,
		Font = Enum.Font.GothamBold,
		TextSize = 13,
		TextColor3 = Color3.new(1, 1, 1),
		Text = "Watcher: ON",
		AutoButtonColor = false,
	}, win)
	round(toggleBtn, 6)

	local getBtn = make("TextButton", {
		Size = UDim2.new(0, 155, 0, 36),
		Position = UDim2.new(1, -165, 0, 102),
		BackgroundColor3 = COL.element,
		BorderSizePixel = 0,
		Font = Enum.Font.GothamBold,
		TextSize = 13,
		TextColor3 = COL.text,
		Text = "Get Current Text",
		AutoButtonColor = false,
	}, win)
	round(getBtn, 6)

	local changeBtn = make("TextButton", {
		Size = UDim2.new(1, -20, 0, 36),
		Position = UDim2.new(0, 10, 0, 146),
		BackgroundColor3 = COL.element,
		BorderSizePixel = 0,
		Font = Enum.Font.GothamBold,
		TextSize = 13,
		TextColor3 = COL.text,
		Text = "Change Board Text",
		AutoButtonColor = false,
	}, win)
	round(changeBtn, 6)

	local logsBtn = make("TextButton", {
		Size = UDim2.new(1, -20, 0, 36),
		Position = UDim2.new(0, 10, 0, 190),
		BackgroundColor3 = COL.element,
		BorderSizePixel = 0,
		Font = Enum.Font.GothamBold,
		TextSize = 13,
		TextColor3 = COL.text,
		Text = "Logs",
		AutoButtonColor = false,
	}, win)
	round(logsBtn, 6)

	local logsWin, logScroll
	local function buildLogs()
		logsWin = make("Frame", {
			Name = "BoardNotifierLogs",
			Size = UDim2.new(0, 420, 0, 320),
			Position = UDim2.new(0.5, -210, 0.5, -160),
			BackgroundColor3 = COL.bg,
			BorderSizePixel = 0,
			Active = true,
			Visible = false,
		}, gui)
		round(logsWin, 10)
		make("UIStroke", { Color = COL.stroke, Thickness = 1 }, logsWin)
		make("UIScale", { Scale = 1 }, logsWin)

		local logsBar = make("TextLabel", {
			Size = UDim2.new(1, -44, 0, 34),
			Position = UDim2.new(0, 14, 0, 2),
			BackgroundTransparency = 1,
			Font = Enum.Font.GothamBold,
			TextSize = 15,
			TextColor3 = COL.text,
			Text = "Board Logs",
			TextXAlignment = Enum.TextXAlignment.Left,
		}, logsWin)
		logsBar.Active = true

		H.chrome(logsWin, {
			header = 40,
			title = logsBar,
			onClose = function()
				logsShown = false
				logsWin.Visible = false
			end,
		})

		logScroll = make("ScrollingFrame", {
			Size = UDim2.new(1, -20, 1, -44),
			Position = UDim2.new(0, 10, 0, 40),
			BackgroundColor3 = COL.element,
			BorderSizePixel = 0,
			ScrollBarThickness = 4,
			ScrollBarImageColor3 = COL.sub,
			CanvasSize = UDim2.new(0, 0, 0, 0),
			AutomaticCanvasSize = Enum.AutomaticSize.Y,
		}, logsWin)
		round(logScroll, 6)
		make("UIListLayout", {
			Padding = UDim.new(0, 4),
			SortOrder = Enum.SortOrder.LayoutOrder,
		}, logScroll)
		make("UIPadding", {
			PaddingTop = UDim.new(0, 8),
			PaddingBottom = UDim.new(0, 20),
			PaddingLeft = UDim.new(0, 8),
			PaddingRight = UDim.new(0, 8),
		}, logScroll)

		H.makeDraggable(logsWin, logsBar, track)
	end

	local function addLog(text)
		if not logsWin then
			buildLogs()
		end
		logOrder += 1
		make("TextLabel", {
			Name = "Log_" .. logOrder,
			Size = UDim2.new(1, -5, 0, 32),
			BackgroundTransparency = 1,
			Font = Enum.Font.Code,
			TextSize = 12,
			TextColor3 = COL.sub,
			Text = "[" .. os.date("%I:%M:%S %p") .. "] -- " .. tostring(text),
			TextWrapped = true,
			TextXAlignment = Enum.TextXAlignment.Left,
			TextYAlignment = Enum.TextYAlignment.Center,
			LayoutOrder = logOrder,
		}, logScroll)
	end

	track(connect(toggleBtn.MouseButton1Click, function()
		click()
		toggled = not toggled
		if toggled then
			toggleBtn.Text = "Watcher: ON"
			toggleBtn.BackgroundColor3 = COL.accent
			lastText = tostring(thing.Text)
			H.notify({ title = "Board Notifier", text = "Watcher enabled", kind = "success" })
		else
			toggleBtn.Text = "Watcher: OFF"
			toggleBtn.BackgroundColor3 = COL.off
			H.notify({ title = "Board Notifier", text = "Watcher disabled", kind = "warn" })
		end
	end))

	track(connect(getBtn.MouseButton1Click, function()
		click()
		local text = tostring(thing.Text)
		currentLabel.Text = "Current: " .. text
		H.notify({ title = "Board Notifier", text = "Current: " .. text })
	end))

	track(connect(changeBtn.MouseButton1Click, function()
		click()
		local adjust = findAdjust()
		if not adjust then
			H.notify({ title = "Board Notifier", text = "Change input not found.", kind = "error" })
			return
		end

		local node = adjust
		while node do
			if node:IsA("GuiObject") then
				node.Visible = true
			elseif node:IsA("LayerCollector") then
				node.Enabled = true
			end
			node = node.Parent
		end
		task.wait()
		local box
		for _, o in ipairs(adjust:GetDescendants()) do
			if o:IsA("TextBox") then
				box = o
				break
			end
		end
		if box then
			box.Visible = true
			box.TextEditable = true
			box:CaptureFocus()
		else
			H.notify({ title = "Board Notifier", text = "No input box found.", kind = "error" })
		end
	end))

	track(connect(logsBtn.MouseButton1Click, function()
		click()
		if not logsWin then
			buildLogs()
		end
		logsShown = not logsShown
		if logsShown then
			logsWin.Visible = true
			H.popIn(logsWin)
		else
			H.popOut(logsWin, function()
				logsWin.Visible = false
			end)
		end
	end))

	track(connect(thing:GetPropertyChangedSignal("Text"), function()
		local newText = tostring(thing.Text)
		currentLabel.Text = "Current: " .. newText
		if newText ~= lastText then
			addLog(newText)
			if toggled then
				H.notify({ title = "Board Notifier", text = "New text: " .. newText })
			end
		end
		lastText = newText
	end))

	track(connect(win.AncestryChanged, function(_, parent)
		if not parent then
			for _, c in ipairs(localConns) do
				pcall(function()
					c:Disconnect()
				end)
			end
			if logsWin then
				logsWin:Destroy()
			end
		end
	end))

	H.makeDraggable(win, bar, track)
	H.animateAll(win)
	H.popIn(win)
	H.notify({ title = "Board Notifier", text = "Loaded successfully.", kind = "success" })
	return "Board Notifier opened"
end

add{
	name = "boardnotifier",
	alias = { "boardnotis", "boardnoti" },
	group = "World",
	help = "Watch, log & change the school board text",
	bindable = true,
	run = openBoardNotifier,
}

add{
	name = "airwalk",
	args = "<offset>",
	group = "Movement",
	help = "Walk on air. A number sets the drop below your feet",
	bindable = true,
	run = function(c)
		if c.n then
			Extra.airSetOffset(c.n)
			if not Extra.airIsOn() then
				Extra.airSet(true)
			end
			return "airwalk offset " .. c.n
		end
		Extra.airToggle()
		return "airwalk " .. onoff(Extra.airIsOn())
	end,
}
add{
	name = "airwalkgui",
	alias = { "awgui" },
	group = "Movement",
	help = "Open the airwalk window (toggle, offset, keybind)",
	run = function()
		Extra.openAirwalk()
	end,
}
add{
	name = "executor",
	alias = { "exec" },
	group = "Tools",
	help = "Open the in-game Lua script executor",
	bindable = true,
	run = function()
		Extra.openExecutor()
	end,
}
add{
	name = "platform",
	alias = { "hover" },
	group = "Movement",
	help = "Hang at your current height, don't fall",
	bindable = true,
	run = function()
		Extra.platToggle()
		return "platform hover " .. onoff(Extra.platIsOn())
	end,
}
add{
	name = "hipheight",
	alias = { "hip" },
	args = "<n>",
	group = "Movement",
	help = "Float this many studs above the ground",
	run = function(c)
		if not c.n then
			return "needs a number"
		end
		return "hip height " .. Extra.setHip(c.n)
	end,
}
add{
	name = "antivoid",
	group = "Movement",
	help = "Teleport back up if you fall out of the map",
	bindable = true,
	run = function()
		Extra.voidToggle()
		return "anti-void " .. onoff(Extra.voidIsOn())
	end,
}

add{
	name = "day",
	group = "World",
	help = "Set the time to midday",
	bindable = true,
	run = function()
		return "time " .. world.setTime(14)
	end,
}
add{
	name = "night",
	group = "World",
	help = "Set the time to midnight",
	bindable = true,
	run = function()
		return "time " .. world.setTime(0)
	end,
}
add{
	name = "ambient",
	args = "<RRGGBB>",
	group = "World",
	help = "Set the ambient light colour",
	run = function(c)
		local hex = (c.arg or ""):gsub("#", ""):gsub("%s", "")
		if #hex ~= 6 or hex:match("%X") then
			return "usage: ambient RRGGBB"
		end
		local r, g, b = tonumber(hex:sub(1, 2), 16), tonumber(hex:sub(3, 4), 16), tonumber(hex:sub(5, 6), 16)
		local L = game:GetService("Lighting")
		local col = Color3.fromRGB(r, g, b)
		L.Ambient = col
		L.OutdoorAmbient = col
		return "ambient set"
	end,
}

add{
	name = "freecam",
	alias = { "fc" },
	group = "Camera",
	help = "Detached free camera (WASD, E/Q up-down, Shift faster)",
	bindable = true,
	run = function()
		Extra.freecamToggle()
		return "freecam " .. onoff(Extra.freecamIsOn())
	end,
}
add{
	name = "firstperson",
	alias = { "fp" },
	group = "Camera",
	help = "Lock to first person",
	bindable = true,
	run = function()
		player.CameraMode = Enum.CameraMode.LockFirstPerson
		return "first person"
	end,
}
add{
	name = "thirdperson",
	alias = { "tp3" },
	group = "Camera",
	help = "Unlock third person and max the zoom",
	bindable = true,
	run = function()
		player.CameraMode = Enum.CameraMode.Classic
		player.CameraMaxZoomDistance = 128
		return "third person"
	end,
}
add{
	name = "fixcam",
	group = "Camera",
	help = "Reset the camera to normal",
	bindable = true,
	run = function()
		local cam = workspace.CurrentCamera
		cam.CameraType = Enum.CameraType.Custom
		local hum = player.Character and player.Character:FindFirstChildOfClass("Humanoid")
		if hum then
			cam.CameraSubject = hum
		end
		return "camera reset"
	end,
}
add{
	name = "lockfov",
	group = "Camera",
	help = "Hold the FOV against game changes",
	bindable = true,
	run = function()
		Extra.lockFovToggle()
		return "lock fov " .. onoff(Extra.lockFovIsOn())
	end,
}

add{
	name = "tppos",
	args = "<x,y,z>",
	group = "Players",
	help = "Teleport to raw coordinates",
	run = function(c)
		local x, y, z = c.arg:match("(-?%d+%.?%d*)[, ]+(-?%d+%.?%d*)[, ]+(-?%d+%.?%d*)")
		local hrp = player.Character and player.Character:FindFirstChild("HumanoidRootPart")
		if not (x and hrp) then
			return "usage: tppos x,y,z"
		end
		hrp.CFrame = CFrame.new(tonumber(x), tonumber(y), tonumber(z))
		return "teleported"
	end,
}
add{
	name = "getpos",
	alias = { "pos" },
	group = "Players",
	help = "Print + copy your position",
	run = function()
		local hrp = player.Character and player.Character:FindFirstChild("HumanoidRootPart")
		if not hrp then
			return "no character"
		end
		local p = hrp.Position
		local s = string.format("%.1f, %.1f, %.1f", p.X, p.Y, p.Z)
		if setclipboard then
			pcall(setclipboard, s)
		end
		return s
	end,
}
add{
	name = "players",
	alias = { "plist" },
	group = "Players",
	help = "Open the players window",
	run = function()
		Extra.openPlayers()
	end,
}
add{
	name = "playerinfo",
	alias = { "plrinfo" },
	args = "<player>",
	group = "Players",
	help = "Live info window for a player (blank = you)",
	bindable = true,
	run = function(c)
		Extra.openPlayerInfo(c.arg)
	end,
}
add{
	name = "notifs",
	alias = { "joinleave", "jl" },
	args = "<on/off>",
	group = "Players",
	help = "Toast when players join or leave the server",
	bindable = true,
	run = function(c)
		local a = (c.arg or ""):lower()
		if a == "on" or a == "1" or a == "true" then
			Extra.notifSet(true)
		elseif a == "off" or a == "0" or a == "false" then
			Extra.notifSet(false)
		else
			Extra.notifToggle()
		end
		return "join/leave notifications " .. onoff(Extra.notifIsOn())
	end,
}
add{
	name = "friendtoasts",
	alias = { "friendnotifs", "ft" },
	args = "<on/off>",
	group = "Players",
	help = "Toast + ding only when a friend joins or leaves",
	bindable = true,
	run = function(c)
		local a = (c.arg or ""):lower()
		if a == "on" or a == "1" or a == "true" then
			Extra.friendSet(true)
		elseif a == "off" or a == "0" or a == "false" then
			Extra.friendSet(false)
		else
			Extra.friendToggle()
		end
		return "friend toasts " .. onoff(Extra.friendIsOn())
	end,
}

add{
	name = "refresh",
	alias = { "re" },
	group = "Self",
	help = "Respawn but keep your position",
	bindable = true,
	run = function()
		local ch = player.Character
		local hrp = ch and ch:FindFirstChild("HumanoidRootPart")
		if not hrp then
			return "no character"
		end
		local cf = hrp.CFrame
		player.CharacterAdded:Once(function(c)
			local h = c:WaitForChild("HumanoidRootPart")
			task.wait(0.15)
			h.CFrame = cf
		end)
		local hum = ch:FindFirstChildOfClass("Humanoid")
		if hum then
			hum.Health = 0
		end
		return "refreshing"
	end,
}
add{
	name = "invisible",
	alias = { "inv" },
	group = "Self",
	help = "Open the invisibility window",
	run = function()
		Extra.openInvis()
	end,
}
add{
	name = "antifling",
	group = "Self",
	help = "Resist fling attacks",
	bindable = true,
	run = function()
		world.toggleAntifling()
		return "anti-fling " .. onoff(Extra.antiflingIsOn())
	end,
}

add{
	name = "serverhop",
	alias = { "shop" },
	group = "Server",
	help = "Hop to a different server",
	run = function()
		return hopTo(false)
	end,
}
add{
	name = "smallserver",
	group = "Server",
	help = "Join the emptiest available server",
	run = function()
		return hopTo(true)
	end,
}
add{
	name = "serverinfo",
	group = "Server",
	help = "Open the server info window",
	run = function()
		Extra.openServerInfo()
	end,
}
add{
	name = "copyid",
	args = "<player>",
	group = "Server",
	help = "Copy a player's user id",
	run = function(c)
		local t = hubFindPlayer(c.arg)
		if not t then
			return "player not found"
		end
		if setclipboard then
			pcall(setclipboard, tostring(t.UserId))
		end
		return "copied " .. t.UserId
	end,
}
add{
	name = "antiafk",
	alias = { "afk" },
	group = "Server",
	help = "Block the 20-minute idle kick",
	bindable = true,
	run = function()
		if _G.HubAntiAfk then
			_G.HubAntiAfk:Disconnect()
			_G.HubAntiAfk = nil
			return "anti-afk off"
		end
		local vu = game:GetService("VirtualUser")
		_G.HubAntiAfk = player.Idled:Connect(function()
			vu:CaptureController()
			vu:ClickButton2(Vector2.new())
		end)
		return "anti-afk on"
	end,
}
add{
	name = "fpscap",
	args = "<n>",
	group = "Server",
	help = "Cap your FPS (executor feature)",
	run = function(c)
		if not c.n then
			return "needs a number"
		end
		if not setfpscap then
			return "no setfpscap on this executor"
		end
		setfpscap(c.n)
		return "fps cap " .. c.n
	end,
}
add{
	name = "fps",
	group = "Server",
	help = "Show / hide the FPS + ping overlay",
	bindable = true,
	run = function()
		local g = H.guiHost:FindFirstChild("FpsPingGui")
		if not g then
			return "no fps overlay"
		end
		g.Enabled = not g.Enabled
		return "fps overlay " .. onoff(g.Enabled)
	end,
}
add{
	name = "ping",
	group = "Server",
	help = "Print your ping",
	run = function()
		return "ping " .. math.floor(player:GetNetworkPing() * 1000 + 0.5) .. "ms"
	end,
}

add{
	name = "chat",
	args = "<msg>",
	group = "Chat",
	help = "Send a chat message",
	run = function(c)
		if c.arg == "" then
			return "needs a message"
		end
		return sendChat(c.arg) and "sent" or "chat failed"
	end,
}
add{
	name = "spam",
	args = "<msg>",
	group = "Chat",
	help = "Repeat a message every second (run again to stop)",
	run = function(c)
		if _G.HubSpam then
			_G.HubSpam = false
			return "spam off"
		end
		if c.arg == "" then
			return "needs a message"
		end
		_G.HubSpam = true
		task.spawn(function()
			while _G.HubSpam do
				pcall(sendChat, c.arg)
				task.wait(1)
			end
		end)
		return "spamming (run spam again to stop)"
	end,
}
add{
	name = "clearchat",
	group = "Chat",
	help = "Push your chat history off-screen",
	run = function()
		for _ = 1, 40 do
			pcall(function()
				game:GetService("StarterGui"):SetCore("ChatMakeSystemMessage", { Text = " " })
			end)
		end
		return "chat cleared"
	end,
}

add{
	name = "run",
	args = "<url>",
	group = "Scripts",
	help = "HttpGet + run a remote script",
	run = function(c)
		if c.arg == "" then
			return "needs a url"
		end
		return loadUrl(c.arg)
	end,
}
add{
	name = "dex",
	group = "Scripts",
	help = "Load the DEX explorer",
	run = function()
		return loadUrl("https://raw.githubusercontent.com/infyiff/backup/main/dex.lua")
	end,
}
add{
	name = "dex++",
	group = "Scripts",
	help = "Load the DEX++ explorer",
	run = function()
		return loadUrl("https://github.com/AZYsGithub/DexPlusPlus/releases/latest/download/out.lua")
	end,
}
add{
	name = "infyield",
	alias = { "iy" },
	group = "Scripts",
	help = "Load Infinite Yield",
	run = function()
		return loadUrl("https://raw.githubusercontent.com/EdgeIY/infiniteyield/master/source")
	end,
}
add{
	name = "remotespy",
	group = "Scripts",
	help = "Load a remote-event logger",
	run = function()
		return loadUrl("https://raw.githubusercontent.com/78n/SimpleSpy/master/SimpleSpySource.lua")
	end,
}
add{
	name = "fecheck",
	group = "Scripts",
	help = "Report whether the game is FilteringEnabled",
	run = function()
		return workspace.FilteringEnabled and "FE is ON (filtering enabled)" or "FE is OFF"
	end,
}
add{
	name = "staffrefresh",
	group = "Server",
	help = "Re-fetch the staff list from Firebase (so new staff don't need a script update)",
	run = function()
		if H.fbRefreshStaff then
			local msg = H.fbRefreshStaff()
			-- rank colors may have changed -> refresh live tags too
			pcall(ntFetch, true)
			return msg
		end
		return "staff system unavailable"
	end,
}

if isAdmin then
	local Stats = game:GetService("Stats")
	local dbgFrozen = false

	local function copyOut(v)
		if setclipboard then
			pcall(setclipboard, tostring(v))
			return "copied: " .. tostring(v)
		end
		return "no setclipboard"
	end
	local function myHRP()
		return player.Character and player.Character:FindFirstChild("HumanoidRootPart")
	end
	local function myHum()
		return player.Character and player.Character:FindFirstChildOfClass("Humanoid")
	end

	add{
		name = "debughelp",
		alias = { "dhelp" },
		group = "Debug",
		debug = true,
		help = "List debug commands",
		run = function()
			local rows = { { text = "DEBUG COMMANDS", header = true } }
			for _, s in ipairs(ORDER) do
				if s.debug then
					rows[#rows + 1] = { text = _G.prefix .. signature(s) .. "   -   " .. s.help }
				end
			end
			listWindow("DebugHelp", "Debug Commands", rows)
		end,
	}
	add{
		name = "testtoast",
		args = "<info/success/warn/error>",
		group = "Debug",
		debug = true,
		help = "Fire a test toast of the given kind",
		run = function(c)
			local kind = (c.arg or "info"):lower()
			if kind ~= "success" and kind ~= "warn" and kind ~= "error" then
				kind = "info"
			end
			H.notify({ title = "Test", text = kind .. " toast test", kind = kind })
		end,
	}
	add{
		name = "stats",
		group = "Debug",
		debug = true,
		help = "Show FPS / ping / memory / position",
		run = function()
			local fps = math.floor(1 / H.RunService.RenderStepped:Wait() + 0.5)
			local ping = math.floor(player:GetNetworkPing() * 1000 + 0.5)
			local mem = 0
			pcall(function()
				mem = Stats:GetTotalMemoryUsageMb()
			end)
			local hrp = myHRP()
			local pos = hrp and string.format("%.0f, %.0f, %.0f", hrp.Position.X, hrp.Position.Y, hrp.Position.Z) or "--"
			H.notify({
				title = "Stats",
				text = string.format("FPS %d  |  Ping %dms  |  Mem %.0fMB  |  Pos %s", fps, ping, mem, pos),
			})
		end,
	}
	add{
		name = "gameinfo",
		group = "Debug",
		debug = true,
		help = "Print place / job / FE / player count",
		run = function()
			print("[Debug] PlaceId", game.PlaceId, "JobId", game.JobId, "FE", workspace.FilteringEnabled)
			print("[Debug] Players", #Players:GetPlayers(), "/", Players.MaxPlayers)
			H.notify({ title = "Debug", text = "game info printed to console", kind = "success" })
		end,
	}
	add{
		name = "printplayers",
		group = "Debug",
		debug = true,
		help = "Print every player to the console",
		run = function()
			for _, p in ipairs(Players:GetPlayers()) do
				print("[Debug]", p.Name, p.DisplayName, p.UserId)
			end
			return "players printed"
		end,
	}
	add{
		name = "executorname",
		group = "Debug",
		debug = true,
		help = "Show the executor name",
		run = function()
			local exec = (identifyexecutor and identifyexecutor()) or (getexecutorname and getexecutorname()) or "unknown"
			H.notify({ title = "Executor", text = tostring(exec) })
		end,
	}
	add{
		name = "copyplace",
		group = "Debug",
		debug = true,
		help = "Copy the PlaceId",
		run = function()
			return copyOut(game.PlaceId)
		end,
	}
	add{
		name = "copyjob",
		group = "Debug",
		debug = true,
		help = "Copy the JobId",
		run = function()
			return copyOut(game.JobId)
		end,
	}
	add{
		name = "servertime",
		group = "Debug",
		debug = true,
		help = "Copy the server time",
		run = function()
			return copyOut(workspace:GetServerTimeNow())
		end,
	}
	add{
		name = "heal",
		group = "Debug",
		debug = true,
		help = "Heal yourself to full",
		run = function()
			local hum = myHum()
			if hum then
				hum.Health = hum.MaxHealth
				return "healed"
			end
			return "no character"
		end,
	}
	add{
		name = "respawn",
		group = "Debug",
		debug = true,
		help = "Reload your character",
		run = function()
			pcall(function()
				player:LoadCharacter()
			end)
			return "respawning"
		end,
	}
	add{
		name = "tospawn",
		group = "Debug",
		debug = true,
		help = "Teleport to a SpawnLocation",
		run = function()
			local hrp = myHRP()
			local spawn = workspace:FindFirstChildOfClass("SpawnLocation")
			if hrp and spawn then
				hrp.CFrame = spawn.CFrame + Vector3.new(0, 5, 0)
				return "at spawn"
			end
			return "no spawn found"
		end,
	}
	add{
		name = "freeze",
		group = "Debug",
		debug = true,
		bindable = true,
		help = "Anchor / unanchor yourself",
		run = function()
			local hrp = myHRP()
			if not hrp then
				return "no character"
			end
			dbgFrozen = not dbgFrozen
			hrp.Anchored = dbgFrozen
			return dbgFrozen and "frozen" or "unfrozen"
		end,
	}
	add{
		name = "highlightall",
		group = "Debug",
		debug = true,
		help = "Highlight every other player",
		run = function()
			for _, p in ipairs(Players:GetPlayers()) do
				if p ~= player and p.Character and not p.Character:FindFirstChild("DbgHL") then
					local hl = Instance.new("Highlight")
					hl.Name = "DbgHL"
					hl.FillColor = Color3.fromRGB(255, 80, 80)
					hl.Parent = p.Character
				end
			end
			return "highlighted players"
		end,
	}
	add{
		name = "clearhl",
		group = "Debug",
		debug = true,
		help = "Remove debug highlights",
		run = function()
			for _, d in ipairs(workspace:GetDescendants()) do
				if d.Name == "DbgHL" and d:IsA("Highlight") then
					d:Destroy()
				end
			end
			return "highlights cleared"
		end,
	}
	add{
		name = "gc",
		group = "Debug",
		debug = true,
		help = "Run the garbage collector + show Lua memory",
		run = function()
			local before = collectgarbage("count")
			collectgarbage("collect")
			return string.format("GC ran (%.0f KB -> %.0f KB)", before, collectgarbage("count"))
		end,
	}
	add{
		name = "testding",
		group = "Debug",
		debug = true,
		help = "Preview the friend ding + toast",
		run = function()
			if H.friendDing then
				H.friendDing()
			end
			H.notify({ title = "Friend joined", text = "test preview", kind = "success" })
		end,
	}

	-- ===== staff panel + targeted staff commands (Firebase admins only) =====
	add{
		name = "staffpanel",
		alias = { "spanel" },
		group = "Debug",
		debug = true,
		help = "Toggle the staff tools panel",
		run = function()
			if H.staffPanelToggle then
				return H.staffPanelToggle() and "staff panel opened" or "staff panel closed"
			end
			return "staff panel unavailable"
		end,
	}

	local STAFF_TARGETED = {
		stafffw = "fw", staffspn = "spn", staffusp = "usp",
		stafffrz = "frz", staffthw = "thw", staffflg = "flg",
		staffsit = "sit", staffjmp = "jmp", staffbld = "bld",
		staffubl = "ubl", staffbrg = "brg", staffvod = "vod",
		staffrst = "rst", staffkick = "kck",
	}
	local function staffFindTarget(q)
		q = (q or ""):gsub("^@", ""):lower()
		if q == "" then
			return nil
		end
		for _, p in ipairs(Players:GetPlayers()) do
			if p ~= player and (p.Name:lower() == q or p.DisplayName:lower() == q) then
				return p
			end
		end
		for _, p in ipairs(Players:GetPlayers()) do
			if p ~= player and (p.Name:lower():find(q, 1, true) or p.DisplayName:lower():find(q, 1, true)) then
				return p
			end
		end
		return nil
	end
	for cmdName, wire in pairs(STAFF_TARGETED) do
		add{
			name = cmdName,
			group = "Debug",
			debug = true,
			args = "<player>",
			help = "Staff: " .. wire .. " a target script user",
			run = function(c)
				if not (H.staffSend and H.staffIsAdmin) then
					return "staff transport unavailable"
				end
				local t = staffFindTarget(c.arg)
				if not t then
					return "no player matched '" .. tostring(c.arg or "") .. "'"
				end
				local ok, msg = H.staffSend(wire, tostring(t.UserId))
				if not ok then
					return msg
				end
				return wire .. " sent to " .. t.Name
			end,
		}
	end
end

hubRunCommand = function(input)
	input = (input or ""):gsub("^%s+", ""):gsub("%s+$", "")
	if input:sub(1, 1) == _G.prefix then
		input = input:sub(2)
	end
	local name, arg = input:match("^(%S+)%s*(.-)$")
	if not name then
		return
	end
	local spec = CMDS[name:lower()]
	if not spec then

		local aliased = UserAliases[name:lower()]
		if aliased then
			spec = CMDS[aliased]
		end
	end
	if not spec then
		say("unknown: " .. name .. " (type help)")
		if H.notify then
			H.notify({ title = "Unknown command", text = name .. "  -  type help", kind = "warn", duration = 3 })
		end
		return
	end

	local title = capitalize(commandLabel(spec))

	local ok, msg = pcall(spec.run, { arg = arg, n = tonumber(arg), raw = input })
	if not ok then
		say("error: " .. tostring(msg))
		if H.notify then
			H.notify({ title = title, text = "Error: " .. tostring(msg), kind = "error" })
		end
		return
	end
	if msg then
		say(msg)
	end
	if H.notify then

		H.notify({ title = title, text = capitalize(msg or spec.help or "Ran"), kind = "success", duration = 3 })
	end
end

connect(UIS.InputBegan, function(i, gp)
	if gp or i.UserInputType ~= Enum.UserInputType.Keyboard then
		return
	end

	if UIS:GetFocusedTextBox() then
		return
	end

	if H.keyChangeCooldown then
		return
	end
	local name = Binds[i.KeyCode.Name]
	if name then
		pcall(hubRunCommand, name)
	end
end)

connect(cmdBox.FocusLost, function(enter)
	if not enter then
		return
	end
	local input = cmdBox.Text
	cmdBox.Text = ""
	local ok, err = pcall(hubRunCommand, input)
	if not ok then
		say("error: " .. tostring(err))
	end
end)

-- ===== Keybinds tab: view / change / remove every bindable command =====
do
	local make, round, connect, click, COL = H.make, H.round, H.connect, H.click, H.COL
	local row = H.row
	local UIS = H.UIS
	local hubSaveConfig, hubKeyFromName = H.saveConfig, H.keyFromName
	local Binds = H.Binds
	local waitingAction = nil

	local bindsPage = H.makeTab("Keys")
	-- hide the tab while inside a game's custom tab set
	if H.Games and H.Games.default then
		H.Games.default["Keys"] = true
	end

	local scroll = make("ScrollingFrame", {
		Size = UDim2.new(1, 0, 1, 0),
		BackgroundTransparency = 1,
		BorderSizePixel = 0,
		ScrollBarThickness = 4,
		ScrollBarImageColor3 = COL.sub,
		CanvasSize = UDim2.new(0, 0, 0, 0),
	}, bindsPage)
	local layout = make("UIListLayout", {
		Padding = UDim.new(0, 6),
		SortOrder = Enum.SortOrder.LayoutOrder,
	}, scroll)
	make("UIPadding", {
		PaddingTop = UDim.new(0, 4),
		PaddingLeft = UDim.new(0, 4),
		PaddingRight = UDim.new(0, 4),
	}, scroll)
	connect(layout:GetPropertyChangedSignal("AbsoluteContentSize"), function()
		scroll.CanvasSize = UDim2.new(0, 0, 0, layout.AbsoluteContentSize.Y / H.scaleOf(scroll) + 6)
	end)

	local ord = 0
	local keyBtns = {} -- action -> { btn, get }

	local function keyLabelFor(action)
		return H.keyFor(action)
	end

	local function stopWaiting()
		waitingAction = nil
		for _, e in pairs(keyBtns) do
			e.btn.Text = e.get()
			e.btn.TextColor3 = COL.text
		end
	end

	local function startWaiting(action)
		waitingAction = action
		for a, e in pairs(keyBtns) do
			if a == action then
				e.btn.Text = "press a key..."
				e.btn.TextColor3 = COL.accent
			else
				e.btn.Text = e.get()
				e.btn.TextColor3 = COL.text
			end
		end
	end

	-- one row per bindable command
	for _, spec in ipairs(ORDER) do
		if spec.bindable then
			ord += 1
			local action = spec.name
			local r = row(scroll, 0, spec.name)
			r.Size = UDim2.new(1, -160, 0, 22)
			r.LayoutOrder = ord
			local keyBtn = make("TextButton", {
				Size = UDim2.new(0, 66, 0, 22),
				Position = UDim2.new(1, -150, 0, 0),
				BackgroundColor3 = COL.element,
				Font = Enum.Font.GothamMedium,
				TextSize = 11,
				TextColor3 = COL.text,
				Text = keyLabelFor(action),
				AutoButtonColor = false,
				BorderSizePixel = 0,
				LayoutOrder = ord,
			}, scroll)
			round(keyBtn, 6)
			local xBtn = make("TextButton", {
				Size = UDim2.new(0, 22, 0, 22),
				Position = UDim2.new(1, -26, 0, 0),
				BackgroundColor3 = COL.bg,
				Font = Enum.Font.GothamBold,
				TextSize = 12,
				TextColor3 = COL.sub,
				Text = "x",
				AutoButtonColor = false,
				BorderSizePixel = 0,
				LayoutOrder = ord,
			}, scroll)
			round(xBtn, 6)
			local entry = {
				btn = keyBtn,
				get = function()
					return keyLabelFor(action)
				end,
			}
			keyBtns[action] = entry

			connect(keyBtn.MouseButton1Click, function()
				click()
				if waitingAction == action then
					stopWaiting()
				else
					startWaiting(action)
				end
			end)
			connect(xBtn.MouseButton1Click, function()
				click()
				local kc = hubKeyFromName(H.keyFor(action))
				if kc then
					Binds[kc.Name] = nil
				end
				H.refreshKeys()
				pcall(hubSaveConfig)
				stopWaiting()
			end)
		end
	end

	-- one capture listener for the whole tab
	connect(UIS.InputBegan, function(input, gp)
		if not waitingAction or gp then
			return
		end
		if input.UserInputType ~= Enum.UserInputType.Keyboard then
			return
		end
		local action = waitingAction
		stopWaiting()
		H.setBind(action, input.KeyCode.Name)
		pcall(hubSaveConfig)
	end)

	-- stay in sync when binds change elsewhere (key chip, fly/airwalk/executor buttons)
	H.keyRefreshers[#H.keyRefreshers + 1] = function()
		for a, e in pairs(keyBtns) do
			if waitingAction ~= a then
				e.btn.Text = e.get()
			end
		end
	end
end

add{
	name = "keybinds",
	alias = { "keys", "binds" },
	group = "Binds",
	help = "Open the Keybinds tab",
	run = function()
		if H.selectTab then
			H.selectTab("Keys")
		end
		if H.reselectTab then
			H.reselectTab()
		end
		return "keybinds tab opened"
	end,
}

H.runCommand = hubRunCommand
end

do
if H.isAdmin then
local make, round, connect, click, COL = H.make, H.round, H.connect, H.click, H.COL
local player, Players, RunService = H.player, H.Players, H.RunService

local function sectioned(page)
	local scroll = make("ScrollingFrame", {
		Size = UDim2.new(1, 0, 1, 0),
		BackgroundTransparency = 1,
		BorderSizePixel = 0,
		ScrollBarThickness = 4,
		ScrollBarImageColor3 = COL.sub,
		CanvasSize = UDim2.new(0, 0, 0, 0),
	}, page)
	local layout = make("UIListLayout", {
		Padding = UDim.new(0, 5),
		SortOrder = Enum.SortOrder.LayoutOrder,
	}, scroll)
	make("UIPadding", {
		PaddingTop = UDim.new(0, 4),
		PaddingLeft = UDim.new(0, 4),
		PaddingRight = UDim.new(0, 4),
	}, scroll)
	connect(layout:GetPropertyChangedSignal("AbsoluteContentSize"), function()
		scroll.CanvasSize = UDim2.new(0, 0, 0, layout.AbsoluteContentSize.Y / H.scaleOf(scroll) + 6)
	end)
	local ord = 0
	local function sec(text)
		ord += 1
		make("TextLabel", {
			Size = UDim2.new(1, -6, 0, 18),
			BackgroundTransparency = 1,
			Font = Enum.Font.GothamBold,
			TextSize = 11,
			TextColor3 = COL.sub,
			Text = string.upper(text),
			TextXAlignment = Enum.TextXAlignment.Left,
			LayoutOrder = ord,
		}, scroll)
	end
	local function btn(text, fn)
		ord += 1
		local b = make("TextButton", {
			Size = UDim2.new(1, -6, 0, 26),
			BackgroundColor3 = COL.element,
			Font = Enum.Font.GothamMedium,
			TextSize = 12,
			TextColor3 = COL.text,
			Text = text,
			AutoButtonColor = true,
			BorderSizePixel = 0,
			LayoutOrder = ord,
		}, scroll)
		round(b, 6)
		connect(b.MouseButton1Click, function()
			click()
			local ok, err = pcall(fn)
			if not ok then
				H.notify({ title = "Debug", text = tostring(err), kind = "error" })
			end
		end)
		return b
	end
	local function stat(initial)
		ord += 1
		local l = make("TextLabel", {
			Size = UDim2.new(1, -6, 0, 20),
			BackgroundColor3 = COL.element,
			Font = Enum.Font.Code,
			TextSize = 12,
			TextColor3 = COL.text,
			Text = initial or "",
			TextXAlignment = Enum.TextXAlignment.Left,
			BorderSizePixel = 0,
			LayoutOrder = ord,
		}, scroll)
		round(l, 5)
		make("UIPadding", { PaddingLeft = UDim.new(0, 8) }, l)
		return l
	end
	return sec, btn, stat, scroll
end

local Stats = game:GetService("Stats")
local function copy(v)
	if setclipboard then
		pcall(setclipboard, tostring(v))
		H.notify({ title = "Debug", text = "copied: " .. tostring(v), kind = "success" })
	else
		H.notify({ title = "Debug", text = "no setclipboard", kind = "error" })
	end
end
local function myHRP()
	return player.Character and player.Character:FindFirstChild("HumanoidRootPart")
end

if H.debugPage then
	local sec, btn, stat = sectioned(H.debugPage)

	sec("Live stats")
	local fpsL = stat("FPS: --")
	local pingL = stat("Ping: --")
	local memL = stat("Mem: --")
	local posL = stat("Pos: --")
	local cntL = stat("Players / Instances: --")

	local frames, fps, last = 0, 0, tick()
	connect(RunService.RenderStepped, function()
		frames += 1
		local now = tick()
		if now - last >= 1 then
			fps = frames
			frames, last = 0, now
		end
	end)
	local acc = 0
	connect(RunService.Heartbeat, function(dt)
		acc += dt
		if acc < 0.25 then
			return
		end
		acc = 0
		fpsL.Text = "FPS: " .. fps
		local ping = "--"
		pcall(function()
			ping = math.floor(Stats.Network.ServerStatsItem["Data Ping"]:GetValue()) .. " ms"
		end)
		pingL.Text = "Ping: " .. ping
		local mem = "--"
		pcall(function()
			mem = string.format("%.0f MB", Stats:GetTotalMemoryUsageMb())
		end)
		memL.Text = "Mem: " .. mem
		local hrp = myHRP()
		if hrp then
			local p = hrp.Position
			posL.Text = string.format("Pos: %.1f, %.1f, %.1f", p.X, p.Y, p.Z)
		end
		cntL.Text = "Players: " .. #Players:GetPlayers() .. "  |  wsChildren: " .. #workspace:GetChildren()
	end)

	sec("Limits")

	local unlockBtn
	local function unlockLabel()
		return "unlock all values: " .. (H.unlockValues and "ON" or "off")
	end
	unlockBtn = btn(unlockLabel(), function()
		H.unlockValues = not H.unlockValues
		unlockBtn.Text = unlockLabel()
		unlockBtn.BackgroundColor3 = H.unlockValues and COL.on or COL.element
		H.notify({
			title = "Debug",
			text = H.unlockValues and "limits off - boxes take any number" or "limits restored",
			kind = H.unlockValues and "warn" or "info",
		})
	end)
	btn("print clamped ranges", function()
		print("[Debug] unlockValues =", H.unlockValues)
		print("[Debug] cframe speed 0-1e6 | gravity 0-500 | hitbox 1-10 | fly 0-FLY_MAX")
		print("[Debug] walkspeed 0-500 | jump 0-500 | spin -50..50 | fov 1-120")
		print("[Debug] brightness 0-1e6 | time 0-24 | airwalk -50..50 | hip 0-100")
		H.notify({ title = "Debug", text = "ranges printed to console" })
	end)

	sec("Toasts")
	btn("info toast", function()
		H.notify({ title = "Info", text = "info toast test", kind = "info" })
	end)
	btn("success toast", function()
		H.notify({ title = "Success", text = "success toast test", kind = "success" })
	end)
	btn("warn toast", function()
		H.notify({ title = "Warn", text = "warn toast test", kind = "warn" })
	end)
	btn("error toast", function()
		H.notify({ title = "Error", text = "error toast test", kind = "error" })
	end)
	btn("long toast", function()
		H.notify({ title = "Long", text = string.rep("wordy ", 40), kind = "info" })
	end)
	btn("5x toast spam", function()
		for i = 1, 5 do
			H.notify({ title = "Spam " .. i, text = "toast #" .. i })
		end
	end)

	sec("Copy / print")
	btn("copy PlaceId", function()
		copy(game.PlaceId)
	end)
	btn("copy JobId", function()
		copy(game.JobId)
	end)
	btn("copy your UserId", function()
		copy(player.UserId)
	end)
	btn("copy position", function()
		local hrp = myHRP()
		copy(hrp and tostring(hrp.Position) or "no character")
	end)
	btn("print game info", function()
		print("[Debug] PlaceId", game.PlaceId, "JobId", game.JobId, "FE", workspace.FilteringEnabled)
		print("[Debug] Players", #Players:GetPlayers(), "/", Players.MaxPlayers)
		H.notify({ title = "Debug", text = "printed to console", kind = "success" })
	end)
	btn("print all players", function()
		for _, p in ipairs(Players:GetPlayers()) do
			print("[Debug]", p.Name, p.DisplayName, p.UserId)
		end
		H.notify({ title = "Debug", text = "players printed", kind = "success" })
	end)
	btn("print executor", function()
		local exec = (identifyexecutor and identifyexecutor()) or (getexecutorname and getexecutorname()) or "unknown"
		print("[Debug] executor:", exec)
		H.notify({ title = "Executor", text = tostring(exec) })
	end)

	sec("Character")
	btn("reset character", function()
		local hum = player.Character and player.Character:FindFirstChildOfClass("Humanoid")
		if hum then
			hum.Health = 0
		end
	end)
	btn("respawn (LoadCharacter)", function()
		pcall(function()
			player:LoadCharacter()
		end)
	end)
	btn("to spawn", function()
		local hrp = myHRP()
		local spawn = workspace:FindFirstChildOfClass("SpawnLocation")
		if hrp and spawn then
			hrp.CFrame = spawn.CFrame + Vector3.new(0, 5, 0)
		end
	end)
	local frozen = false
	btn("freeze / unfreeze", function()
		local hrp = myHRP()
		if not hrp then
			return
		end
		frozen = not frozen
		hrp.Anchored = frozen
		H.notify({ title = "Debug", text = frozen and "frozen" or "unfrozen" })
	end)
	btn("heal to full", function()
		local hum = player.Character and player.Character:FindFirstChildOfClass("Humanoid")
		if hum then
			hum.Health = hum.MaxHealth
		end
	end)

	sec("Highlight")
	btn("highlight all players", function()
		for _, p in ipairs(Players:GetPlayers()) do
			if p ~= player and p.Character and not p.Character:FindFirstChild("DbgHL") then
				local hl = Instance.new("Highlight")
				hl.Name = "DbgHL"
				hl.FillColor = Color3.fromRGB(255, 80, 80)
				hl.Parent = p.Character
			end
		end
		H.notify({ title = "Debug", text = "highlighted players", kind = "success" })
	end)
	btn("clear highlights", function()
		for _, d in ipairs(workspace:GetDescendants()) do
			if d.Name == "DbgHL" and d:IsA("Highlight") then
				d:Destroy()
			end
		end
		H.notify({ title = "Debug", text = "highlights cleared" })
	end)

	sec("Memory / errors")
	btn("collectgarbage count", function()
		H.notify({ title = "Lua mem", text = string.format("%.1f KB", collectgarbage("count")) })
	end)
	btn("force GC", function()
		collectgarbage("collect")
		H.notify({ title = "Debug", text = "GC ran", kind = "success" })
	end)
	btn("throw test error", function()
		error("intentional debug error")
	end)
	btn("test friend ding + toast", function()
		if H.friendDing then
			H.friendDing()
		end
		H.notify({ title = "Friend joined", text = "test preview", kind = "success" })
	end)

	sec("Server")
	btn("rejoin", function()
		game:GetService("TeleportService"):Teleport(game.PlaceId, player)
	end)
	btn("server hop (smallest)", function()
		H.runCommand("smallserver")
	end)
	btn("copy server time", function()
		copy(workspace:GetServerTimeNow())
	end)
end

end
end

do

local Players, RunService, UIS, player, conns, connect =
	H.Players, H.RunService, H.UIS, H.player, H.conns, H.connect
local COL, make, round, gui = H.COL, H.make, H.round, H.gui
local VERSION, click, main, titleBar = H.VERSION, H.click, H.main, H.titleBar
local selectTab, world = H.selectTab, H.world
local Speed, Grav, Esp, Hitbox, Move, Fly, hubLoadConfig, hubRunCommand = H.Speed, H.Grav, H.Esp, H.Hitbox, H.Move, H.Fly, H.loadConfig, H.runCommand

H.makeDraggable(main, titleBar)

selectTab("Speed")

pcall(hubLoadConfig)

H.refreshKeys()

H.animateAll(gui)

H.popIn(main)

make("TextLabel", {
	Size = UDim2.new(0, 60, 0, 12),
	Position = UDim2.new(1, -84, 1, -25),
	BackgroundTransparency = 1,
	Font = Enum.Font.Gotham,
	TextSize = 10,
	TextColor3 = COL.sub,
	Text = VERSION,
	TextXAlignment = Enum.TextXAlignment.Right,
}, main)

local unloadBtn = make("TextButton", {
	Size = UDim2.new(0, 58, 0, 18),
	Position = UDim2.new(1, -146, 1, -28),
	BackgroundColor3 = COL.on,
	Font = Enum.Font.GothamMedium,
	TextSize = 11,
	TextColor3 = Color3.new(1, 1, 1),
	Text = "Unload",
	AutoButtonColor = false,
	BorderSizePixel = 0,
}, main)
round(unloadBtn, 5)
connect(unloadBtn.MouseButton1Click, function()
	click()

	H.popOut(main, function()
		if _G.ScriptHubCleanup then
			_G.ScriptHubCleanup()
		end
		local folder = workspace:FindFirstChild("InfBaseplate")
		if folder then
			folder:Destroy()
		end
	end)
end)

local chatActive = true
local lastCmd, lastCmdAt = "", 0
local function runChatCommand(msg)
	local now = os.clock()
	if msg == lastCmd and now - lastCmdAt < 0.3 then
		return
	end
	lastCmd, lastCmdAt = msg, now
	local ok, err = pcall(hubRunCommand, msg)
	if not ok then
		warn("[cmd] " .. tostring(err))
	end
end

_G.XyroChatRemotes = _G.XyroChatRemotes or {}
do
	local canHook = hookmetamethod and getnamecallmethod and checkcaller
	if not canHook then
		warn("[me] chat-hide off: this executor is missing hookmetamethod/getnamecallmethod/checkcaller")
	else
		local told = false
		pcall(function()
			local old
			old = hookmetamethod(game, "__namecall", function(self, ...)

				if chatActive and not checkcaller() and typeof(self) == "Instance" then
					local method = getnamecallmethod()
					if method == "FireServer" or method == "SendAsync" then
						local msg = ...
						if type(msg) == "string" and msg:sub(1, 1) == _G.prefix then

							if not told then
								told = true
								print(
									"[me] outgoing '<prefix>' chat seen -> method:", method,
									"| class:", self.ClassName, "| name:", self.Name
								)
							end
							local hide = false
							if method == "SendAsync" then
								hide = true
							elseif method == "FireServer" then
								if self.Name == "SayMessageRequest" then
									hide = true
								else
									for _, rn in ipairs(_G.ChatRemotes) do
										if self.Name == rn then
											hide = true
											break
										end
									end
								end
							end
							if hide then
								task.spawn(runChatCommand, msg)
								return
							end
						end
					end
				end
				return old(self, ...)
			end)
		end)
	end
end

connect(player.Chatted, function(msg)
	if msg:sub(1, 1) ~= _G.prefix then
		return
	end
	runChatCommand(msg)
end)

_G.ScriptHubCleanup = function()
	chatActive = false
	for _, c in ipairs(conns) do
		c:Disconnect()
	end
	for plr in pairs(Esp.objects) do
		Esp.remove(plr)
	end
	Hitbox.restore()
	Move.restore()
	world.restore()
	Fly.stop()
	pcall(function()
		if H.Nametags then
			H.Nametags.cleanup()
		end
	end)

	pcall(function()
		local myhum = player.Character and player.Character:FindFirstChildOfClass("Humanoid")
		if myhum then
			workspace.CurrentCamera.CameraSubject = myhum
		end
	end)
	gui:Destroy()
	local FpsPingGui = H.guiHost:FindFirstChild("FpsPingGui")

	if FpsPingGui then
		FpsPingGui:Destroy()
	end
	_G.ScriptHubCleanup = nil
end

pcall(function()
	H.notify({
		title = "Xyro",
		text = VERSION .. " loaded  |  K hide  |  C speed  |  G gravity",
		kind = "success",
		duration = 5,
	})
end)

pcall(function()
	H.credits(5)
end)

local Players = game:GetService("Players")
local RunService = game:GetService("RunService")
local UIS = game:GetService("UserInputService")

local player = Players.LocalPlayer

if _G.FpsPingCleanup then
	pcall(_G.FpsPingCleanup)
end

local conns = {}

local function connect(sig, fn)
	local c = sig:Connect(fn)
	conns[#conns + 1] = c
	return c
end

local COL = {
	bg = Color3.fromRGB(24, 25, 31),
	stroke = Color3.fromRGB(58, 62, 75),

	green = Color3.fromRGB(80, 220, 130),
	yellow = Color3.fromRGB(240, 200, 80),
	red = Color3.fromRGB(230, 68, 68),

	text = Color3.fromRGB(235, 238, 245),
	sub = Color3.fromRGB(142, 148, 165),
}

local function make(class, props, parent)
	local o = Instance.new(class)

	for k, v in pairs(props) do
		o[k] = v
	end

	o.Parent = parent
	return o
end

local function round(obj, size)
	make("UICorner", {
		CornerRadius = UDim.new(0, size),
	}, obj)
end

local guiHost = H.guiHost

local old = guiHost:FindFirstChild("FpsPingGui")

if old then
	old:Destroy()
end

local gui = make("ScreenGui", {
	Name = "FpsPingGui",
	ResetOnSpawn = false,
	DisplayOrder = H.DISPLAY_ORDER,
}, guiHost)

local bar = make("Frame", {
	AnchorPoint = Vector2.new(0, 1),

	Position = UDim2.new(0, 12, 1, -12),

	Size = UDim2.new(0, 0, 0, 30),

	AutomaticSize = Enum.AutomaticSize.X,

	BackgroundColor3 = COL.bg,

	BorderSizePixel = 0,

	Active = true,
}, gui)

round(bar, 8)

make("UIStroke", {
	Color = COL.stroke,
	Thickness = 1,
}, bar)

make("UIPadding", {
	PaddingLeft = UDim.new(0, 12),
	PaddingRight = UDim.new(0, 12),
}, bar)

make("UIListLayout", {
	FillDirection = Enum.FillDirection.Horizontal,
	VerticalAlignment = Enum.VerticalAlignment.Center,
	Padding = UDim.new(0, 6),
	SortOrder = Enum.SortOrder.LayoutOrder,
}, bar)

local function label(text, color, font, order)
	return make("TextLabel", {
		Size = UDim2.new(0, 0, 1, 0),

		AutomaticSize = Enum.AutomaticSize.X,

		BackgroundTransparency = 1,

		Font = font,

		TextSize = 14,

		TextColor3 = color,

		Text = text,

		LayoutOrder = order,
	}, bar)
end

label("FPS", COL.red, Enum.Font.GothamBold, 1)

local fpsValue = label("--", COL.red, Enum.Font.GothamSemibold, 2)

make("Frame", {
	Size = UDim2.new(0, 1, 0, 16),

	BackgroundColor3 = COL.stroke,

	BorderSizePixel = 0,

	LayoutOrder = 3,
}, bar)

label("PING", COL.red, Enum.Font.GothamBold, 4)

local pingValue = label("--", COL.red, Enum.Font.GothamSemibold, 5)

local function fpsColor(fps)
	if fps >= 50 then
		return COL.green
	elseif fps >= 30 then
		return COL.yellow
	else
		return COL.red
	end
end

local function pingColor(ms)
	if ms <= 50 then
		return COL.green
	elseif ms <= 100 then
		return COL.yellow
	else
		return COL.red
	end
end

local frames = 0
local elapsed = 0

connect(RunService.RenderStepped, function(dt)
	frames = frames + 1
	elapsed = elapsed + dt

	if elapsed >= 0.5 then
		local fps = math.floor(frames / elapsed + 0.5)

		fpsValue.Text = tostring(fps)

		fpsValue.TextColor3 = fpsColor(fps)

		frames = 0
		elapsed = 0
	end
end)

local pingTimer = 0

local function getPing()
	return math.floor(player:GetNetworkPing() * 1000 + 0.5)
end

connect(RunService.Heartbeat, function(dt)
	pingTimer = pingTimer + dt

	if pingTimer >= 1 then
		local ms = getPing()

		pingValue.Text = tostring(ms) .. "ms"

		pingValue.TextColor3 = pingColor(ms)

		pingTimer = 0
	end
end)

H.makeDraggable(bar, nil, connect)

_G.FpsPingCleanup = function()
	for _, c in ipairs(conns) do
		pcall(function()
			c:Disconnect()
		end)
	end

	if gui then
		gui:Destroy()
	end

	_G.FpsPingCleanup = nil
end

end
-- ============================================================================
-- STAFF TAB - Firebase-admin-only tab under Keys
-- Quick actions + live server view; complements the floating staff panel.
-- ============================================================================
do
if H.isAdmin then -- Firebase admins only (same gate as the Debug tab); wrapped, NOT an early return - the staff-panel block below must still run for non-admins (it starts their command listener)

	local make, round, connect, click, COL = H.make, H.round, H.connect, H.click, H.COL
	local player, Players = H.player, H.Players

	local staffPage = H.makeTab("Staff", nil, "Staff")
	-- hide the tab while inside a game's custom tab set (same as Keys)
	if H.Games and H.Games.default then
		H.Games.default["Staff"] = true
	end

	local scroll = make("ScrollingFrame", {
		Size = UDim2.new(1, 0, 1, 0),
		BackgroundTransparency = 1,
		BorderSizePixel = 0,
		ScrollBarThickness = 4,
		ScrollBarImageColor3 = COL.sub,
		CanvasSize = UDim2.new(0, 0, 0, 0),
	}, staffPage)
	local layout = make("UIListLayout", {
		Padding = UDim.new(0, 6),
		SortOrder = Enum.SortOrder.LayoutOrder,
	}, scroll)
	make("UIPadding", {
		PaddingTop = UDim.new(0, 4),
		PaddingLeft = UDim.new(0, 4),
		PaddingRight = UDim.new(0, 4),
	}, scroll)
	connect(layout:GetPropertyChangedSignal("AbsoluteContentSize"), function()
		scroll.CanvasSize = UDim2.new(0, 0, 0, layout.AbsoluteContentSize.Y / H.scaleOf(scroll) + 6)
	end)

	local ord = 0
	local function header(text)
		ord += 1
		local f = make("Frame", {
			Size = UDim2.new(1, -6, 0, 18),
			BackgroundTransparency = 1,
			LayoutOrder = ord,
		}, scroll)
		H.sectionHeader(f, 0, text)
	end

	local function label(text, sub)
		ord += 1
		make("TextLabel", {
			Size = UDim2.new(1, -6, 0, sub and 30 or 20),
			BackgroundTransparency = 1,
			Font = Enum.Font.Gotham,
			TextSize = 12,
			TextColor3 = COL.text,
			Text = text,
			TextXAlignment = Enum.TextXAlignment.Left,
			TextWrapped = true,
			LayoutOrder = ord,
		}, scroll)
	end

	local function actionRow(text, note, fn)
		ord += 1
		local rowF = make("Frame", {
			Size = UDim2.new(1, -6, 0, 30),
			BackgroundTransparency = 1,
			LayoutOrder = ord,
		}, scroll)
		local b = make("TextButton", {
			Size = UDim2.new(1, -6, 0, 26),
			BackgroundColor3 = COL.element,
			Font = Enum.Font.GothamMedium,
			TextSize = 12,
			TextColor3 = COL.text,
			Text = text,
			TextXAlignment = Enum.TextXAlignment.Left,
			AutoButtonColor = true,
			BorderSizePixel = 0,
		}, rowF)
		round(b, 6)
		make("UIPadding", { PaddingLeft = UDim.new(0, 8) }, b)
		connect(b.MouseButton1Click, function()
			click()
			local ok, msg = pcall(fn)
			if H.notify then
				H.notify({
					title = "Staff",
					text = ok and tostring(msg or text) or tostring(msg),
					kind = ok and "success" or "error",
				})
			end
		end)
	end

	-- ===== tools =====
	header("Tools")
	actionRow("Open / close staff panel", nil, function()
		if not H.staffPanelToggle then
			return false, "staff panel unavailable"
		end
		return H.staffPanelToggle() and "staff panel opened" or "staff panel closed"
	end)

	-- ===== quick actions (name -> targeted ntfy command) =====
	header("Quick actions")
	label("Type a username, then press an action. Blank = everyone.")

	ord += 1
	local targetBox = make("TextBox", {
		Size = UDim2.new(1, -6, 0, 26),
		BackgroundColor3 = COL.element,
		Font = Enum.Font.Gotham,
		TextSize = 12,
		TextColor3 = COL.text,
		PlaceholderText = "target username (blank = all)",
		PlaceholderColor3 = COL.sub,
		ClearTextOnFocus = false,
		BorderSizePixel = 0,
		LayoutOrder = ord,
	}, scroll)
	round(targetBox, 6)
	make("UIPadding", { PaddingLeft = UDim.new(0, 8) }, targetBox)
	H.bindFocusGlow(targetBox)

	local function resolveTarget(q)
		q = (q or ""):gsub("^@", ""):gsub("%s+$", "")
		if q == "" then
			return "", "everyone"
		end
		local ql = q:lower()
		for _, p in ipairs(Players:GetPlayers()) do
			if p ~= player and (p.Name:lower() == ql or p.DisplayName:lower() == ql) then
				return tostring(p.UserId), p.Name
			end
		end
		for _, p in ipairs(Players:GetPlayers()) do
			if p ~= player and (p.Name:lower():find(ql, 1, true) or p.DisplayName:lower():find(ql, 1, true)) then
				return tostring(p.UserId), p.Name
			end
		end
		return nil, nil
	end

	local function quickAction(wire, verb)
		if not H.staffSend then
			return false, "staff transport unavailable"
		end
		local id, name = resolveTarget(targetBox.Text)
		if id == nil then
			return false, "no player matched '" .. tostring(targetBox.Text) .. "'"
		end
		local ok, msg = H.staffSend(wire, id)
		if not ok then
			return false, msg
		end
		return true, verb .. " -> " .. name
	end

	actionRow("Flywheel", nil, function() return quickAction("fw", "flywheel") end)
	local frzOn = false
	actionRow("Freeze on / off", nil, function()
		frzOn = not frzOn
		return quickAction(frzOn and "frz" or "thw", frzOn and "freeze on" or "thaw")
	end)
	actionRow("Fling", nil, function() return quickAction("flg", "fling") end)
	actionRow("Sit", nil, function() return quickAction("sit", "sit") end)
	actionRow("Bring to me", nil, function()
		local id, name = resolveTarget(targetBox.Text)
		if id == "" or id == nil then
			return false, "bring needs a specific player"
		end
		local ok, msg = H.staffSend("brg", id)
		if not ok then
			return false, msg
		end
		return true, "bring -> " .. name
	end)
	actionRow("Void", nil, function() return quickAction("vod", "void") end)
	actionRow("Reset", nil, function() return quickAction("rst", "reset") end)
	actionRow("Kick", nil, function() return quickAction("kck", "kick") end)
	local bldOn = false
	actionRow("Blind on / off", nil, function()
		bldOn = not bldOn
		return quickAction(bldOn and "bld" or "ubl", bldOn and "blind on" or "unblind")
	end)

	-- ===== firebase staff =====
	header("Firebase staff")
	local staffListLbl = make("TextLabel", {
		Size = UDim2.new(1, -6, 0, 20),
		BackgroundTransparency = 1,
		Font = Enum.Font.Gotham,
		TextSize = 12,
		TextColor3 = COL.sub,
		Text = "admins: --",
		TextXAlignment = Enum.TextXAlignment.Left,
		TextTruncate = Enum.TextTruncate.AtEnd,
		LayoutOrder = ord + 1,
	}, scroll)
	ord += 1

	local function refreshStaffList()
		local parts = {}
		for id in pairs(H.ADMIN_IDS or {}) do
			parts[#parts + 1] = tostring(id)
		end
		for name in pairs(H.ADMIN_NAMES or {}) do
			parts[#parts + 1] = tostring(name)
		end
		table.sort(parts)
		staffListLbl.Text = "admins: " .. (#parts > 0 and table.concat(parts, ", ") or "none loaded")
	end
	refreshStaffList()

	actionRow("Refresh staff from Firebase", nil, function()
		if not H.fbRefreshStaff then
			return false, "staff system unavailable"
		end
		local msg = H.fbRefreshStaff()
		pcall(function()
			if H.Nametags and H.Nametags.fetch then
				H.Nametags.fetch(true)
			end
		end)
		refreshStaffList()
		return msg
	end)

	-- ===== server =====
	header("Server")
	local serverLbl = make("TextLabel", {
		Size = UDim2.new(1, -6, 0, 20),
		BackgroundTransparency = 1,
		Font = Enum.Font.Gotham,
		TextSize = 12,
		TextColor3 = COL.sub,
		Text = "script users online: --",
		TextXAlignment = Enum.TextXAlignment.Left,
		TextTruncate = Enum.TextTruncate.AtEnd,
		LayoutOrder = ord + 1,
	}, scroll)
	ord += 1

	local function refreshServer()
		local online = H.Nametags and H.Nametags.online() or {}
		local names = {}
		for _, p in ipairs(Players:GetPlayers()) do
			if online[tostring(p.Name):lower()] ~= nil then
				names[#names + 1] = p.Name .. (H.staffIsAdmin and H.staffIsAdmin(p.UserId, p.Name) and " *" or "")
			end
		end
		table.sort(names)
		serverLbl.Text = #names > 0 and ("online: " .. table.concat(names, ", ")) or "no script users online"
	end
	refreshServer()

	actionRow("Refresh server list", nil, function()
		if H.Nametags and H.Nametags.beat then
			task.spawn(H.Nametags.beat, true)
		end
		task.delay(1, refreshServer)
		return "refreshing presence..."
	end)

	-- keep the online list fresh while the tab is visible
	connect(staffPage:GetPropertyChangedSignal("Visible"), function()
		if staffPage.Visible then
			task.spawn(function()
				while staffPage.Visible and staffPage.Parent do
					refreshServer()
					task.wait(5)
				end
			end)
		end
	end)
end
end

--Xyro appended staff panel block (do not delete this marker line)

-- ============================================================================
-- STAFF PANEL - ported from Scythe's staff tools, rebuilt natively for Xyro
-- Access: Firebase admins only (the same staff.json that powers the Debug tab)
-- Transport: ntfy command topic; receivers verify the ISSUER against Firebase
-- staff, so only real admins can ever command another script user.
-- ============================================================================
do
	local make, round, connect, click = H.make, H.round, H.connect, H.click
	local COL, player, Players = H.COL, H.player, H.Players
	local RunService = H.RunService
	local TweenService = H.TweenService or game:GetService("TweenService")
	local ntHttpPost, ntHttpGet = H.ntHttpPost, H.ntHttpGet

	local PANEL_TITLE = "Staff"
	local CMD_TOPIC = "xyro-cmd-k8q3v1m"

	-- issuer must be a CURRENT Firebase admin for receivers to accept commands
	local function staffIsAdmin(userId, userName)
		if H.ADMIN_IDS[userId] == true then
			return true
		end
		if type(userName) == "string" and H.ADMIN_NAMES[tostring(userName):lower()] == true then
			return true
		end
		return false
	end

	local function amStaff()
		return staffIsAdmin(player.UserId, player.Name)
	end

	-- ---------------------------------------------------------------
	-- executor-side effects (run on the RECEIVER)
	-- ---------------------------------------------------------------
	local function getChar()
		return player.Character
	end
	local function getHRP()
		local c = getChar()
		return c and c:FindFirstChild("HumanoidRootPart")
	end
	local function getHum()
		local c = getChar()
		return c and c:FindFirstChildOfClass("Humanoid")
	end

	local spinConn = nil
	local function fxSpin(on)
		if spinConn then
			spinConn:Disconnect()
			spinConn = nil
		end
		if on then
			spinConn = connect(RunService.Heartbeat, function(dt)
				local hrp = getHRP()
				if hrp then
					hrp.CFrame = hrp.CFrame * CFrame.Angles(0, dt * 16, 0)
				end
			end)
		end
	end

	local function fxFlywheel()
		local hrp, hum = getHRP(), getHum()
		if not (hrp and hum) then
			return
		end
		local lift = Instance.new("BodyVelocity")
		lift.Name = "XyroFlyWheel"
		lift.MaxForce = Vector3.new(0, math.huge, 0)
		lift.Velocity = Vector3.new(0, 130, 0)
		lift.Parent = hrp
		task.wait(1.15)
		if lift.Parent then
			lift:Destroy()
		end
		for _, p in ipairs(getChar():GetDescendants()) do
			if p:IsA("BasePart") then
				p.AssemblyLinearVelocity = Vector3.new(math.random(-80, 80), math.random(40, 110), math.random(-80, 80))
			end
		end
		hum:ChangeState(Enum.HumanoidStateType.Physics)
	end

	local function fxFreeze(on)
		local hrp, hum = getHRP(), getHum()
		if hrp then
			hrp.Anchored = on
		end
		if hum then
			hum.PlatformStand = on
			if not on then
				hum:ChangeState(Enum.HumanoidStateType.GettingUp)
			end
		end
	end

	local function fxFling()
		local hrp, hum = getHRP(), getHum()
		if hum then
			hum:ChangeState(Enum.HumanoidStateType.Physics)
		end
		if hrp then
			hrp.AssemblyLinearVelocity = Vector3.new(math.random(-160, 160), math.random(90, 180), math.random(-160, 160))
			hrp.AssemblyAngularVelocity = Vector3.new(math.random(-20, 20), math.random(-40, 40), math.random(-20, 20))
		end
	end

	local function fxSit()
		local hum = getHum()
		if hum then
			hum.Sit = true
		end
	end

	local function fxJump()
		local hum = getHum()
		if hum then
			hum:ChangeState(Enum.HumanoidStateType.Jumping)
		end
	end

	local function fxVoid()
		local hrp = getHRP()
		if hrp then
			hrp.CFrame = CFrame.new(hrp.Position.X, -400, hrp.Position.Z)
		end
	end

	local function fxReset()
		local hum = getHum()
		if hum then
			hum.Health = 0
		end
	end

	local function fxKick()
		pcall(function()
			player:Kick("Kicked by Xyro staff")
		end)
		task.delay(0.15, function()
			pcall(function()
				game:GetService("TeleportService"):Teleport(game.PlaceId, player)
			end)
		end)
	end

	local blindGui = nil
	local function fxBlind(on)
		if blindGui then
			blindGui:Destroy()
			blindGui = nil
		end
		if not on then
			return
		end
		-- ScreenGuis cannot render nested inside other ScreenGuis - parent to
		-- the gui host (PlayerGui/gethui), not H.gui
		local g = Instance.new("ScreenGui")
		g.Name = "XyroStaffBlind"
		g.IgnoreGuiInset = true
		g.ResetOnSpawn = false
		g.DisplayOrder = 100000
		local cover = Instance.new("Frame")
		cover.BackgroundColor3 = Color3.new(0, 0, 0)
		cover.BorderSizePixel = 0
		cover.Size = UDim2.fromScale(1, 1)
		cover.Parent = g
		g.Parent = H.guiHost or game:GetService("Players").LocalPlayer:WaitForChild("PlayerGui")
		blindGui = g
	end

	-- ---------------------------------------------------------------
	-- command execution (receiver side)
	-- ---------------------------------------------------------------
	-- short Scythe-style codes ride the wire; self-safe ones never apply
	-- to the issuer (a broadcast can't knock the staff member who sent it)
	local SELF_SAFE = {
		fw = true, spn = true, frz = true, flg = true, sit = true,
		jmp = true, brg = true, vod = true, rst = true, bld = true, kck = true,
	}
	-- destructive actions a staff member's client never applies to itself
	-- (matches Scythe: staff can't be voided/reset/kicked by other staff)
	local PROTECTED = { vod = true, rst = true, kck = true }

	local function applyCmd(cmd, issuerId, issuerName)
		if not staffIsAdmin(issuerId, issuerName) then
			return -- forged/unknown sender: ignore
		end
		cmd = tostring(cmd or ""):lower()
		if issuerId == player.UserId and SELF_SAFE[cmd] then
			return
		end
		if PROTECTED[cmd] and amStaff() then
			return -- staff clients are off-limits for the destructive ones
		end
		if cmd == "fw" then
			task.spawn(fxFlywheel)
		elseif cmd == "spn" then
			task.spawn(fxSpin, true)
		elseif cmd == "usp" then
			task.spawn(fxSpin, false)
		elseif cmd == "frz" then
			task.spawn(fxFreeze, true)
		elseif cmd == "thw" then
			task.spawn(fxFreeze, false)
		elseif cmd == "flg" then
			task.spawn(fxFling)
		elseif cmd == "sit" then
			task.spawn(fxSit)
		elseif cmd == "jmp" then
			task.spawn(fxJump)
		elseif cmd == "brg" then
			task.spawn(function()
				if not issuerId or issuerId == player.UserId then
					return
				end
				local issuer = Players:GetPlayerByUserId(issuerId)
				local target = issuer and issuer.Character and issuer.Character:FindFirstChild("HumanoidRootPart")
				local hrp = getHRP()
				if target and target:IsA("BasePart") and hrp then
					hrp.CFrame = target.CFrame * CFrame.new(0, 0, 3)
				end
			end)
		elseif cmd == "vod" then
			task.spawn(fxVoid)
		elseif cmd == "rst" then
			task.spawn(fxReset)
		elseif cmd == "bld" then
			task.spawn(fxBlind, true)
		elseif cmd == "ubl" then
			task.spawn(fxBlind, false)
		elseif cmd == "kck" then
			task.spawn(fxKick)
		end
	end

	local function targetsMe(payload)
		for idText in string.gmatch(payload or "", "%d+") do
			if tonumber(idText) == player.UserId then
				return true
			end
		end
		return false
	end

	-- ---------------------------------------------------------------
	-- command transport over ntfy (same pipe + helpers as presence)
	-- ---------------------------------------------------------------
	local function staffPoll()
		local text = ntHttpGet("https://ntfy.sh/" .. CMD_TOPIC .. "/json?poll=1&since=30s")
		if not (text and #text > 0) then
			return
		end
		for line in text:gmatch("[^\r\n]+") do
			local okD, msg = pcall(function()
				return H.HttpService:JSONDecode(line).message
			end)
			if okD and type(msg) == "string" and #msg > 0 and #msg < 120 then
				local issuerId, issuerName, rest = msg:match("^(%d+)|([^|]+)|(.+)$")
				if issuerId and rest then
					local cmd, targets = rest:match("^([%a]+):?(.*)$")
					if cmd and cmd ~= "" then
						if targets == nil or targets == "" or targetsMe(targets) then
							applyCmd(cmd, tonumber(issuerId), issuerName)
						end
					end
				end
			end
		end
	end

	-- everyone listens (receivers must hear commands); staff poll faster
	task.spawn(function()
		while true do
			pcall(staffPoll)
			task.wait(amStaff() and 2 or 30)
		end
	end)

	local function staffSend(cmd, targets)
		if not amStaff() then
			return false, "staff panel is admin-only"
		end
		local body = tostring(player.UserId) .. "|" .. player.Name .. "|" .. tostring(cmd) .. ":" .. tostring(targets or "")
		local ok = ntHttpPost("https://ntfy.sh/" .. CMD_TOPIC, body)
		if ok then
			return true
		end
		return false, "command failed to send (no HTTP path?)"
	end

	H.staffSend = staffSend -- reused by !-commands (stafffw, staffvod, ...)
	H.staffIsAdmin = staffIsAdmin -- target filtering for the !-commands

	-- non-staff never mounts the panel; keep the transport alive though
	if not amStaff() then
		return
	end

	-- ---------------------------------------------------------------
	-- panel UI - mounted in its OWN ScreenGui (a frame inside H.gui can
	-- end up behind main's surfaces depending on gui host/executor, and
	-- when that happened the panel rendered as an empty black box).
	-- Explicit ZIndexes + hand-rolled chrome; no H.chrome dependence.
	-- ---------------------------------------------------------------
	local staffPanel, staffBody, statusLbl
	local bodyVisible = true

	local mountOk, mountErr = pcall(function()
		local pgui = Instance.new("ScreenGui")
		pgui.Name = "XyroStaffPanelGui"
		pgui.ResetOnSpawn = false
		-- same max DisplayOrder as the main gui (2^31-1); added later, so as a
		-- sibling it draws above main. Do NOT arithmetic on it - int32 max + anything wraps.
		pgui.DisplayOrder = H.DISPLAY_ORDER or 2147483647
		pgui.Parent = H.guiHost or game:GetService("Players").LocalPlayer:WaitForChild("PlayerGui")
		pcall(function()
			if syn and syn.protect_gui then
				syn.protect_gui(pgui)
			end
		end)

		staffPanel = Instance.new("Frame")
		staffPanel.Name = "XyroStaffPanel"
		staffPanel.Size = UDim2.new(0, 300, 0, 430)
		staffPanel.Position = UDim2.new(0.5, 340, 0.5, -210)
		staffPanel.BackgroundColor3 = COL.bg
		staffPanel.BorderSizePixel = 0
		staffPanel.Active = true
		staffPanel.Visible = false
		staffPanel.ZIndex = 1
		staffPanel.Parent = pgui

		local corner = Instance.new("UICorner")
		corner.CornerRadius = UDim.new(0, 10)
		corner.Parent = staffPanel
		local stroke = Instance.new("UIStroke")
		stroke.Color = COL.off
		stroke.Thickness = 1
		stroke.Transparency = 0.2
		stroke.Parent = staffPanel

		-- header (drag handle) + close/min, ZIndex 2 so nothing can cover them
		local bar = Instance.new("TextButton")
		bar.Name = "Header"
		bar.Size = UDim2.new(1, 0, 0, 38)
		bar.BackgroundTransparency = 1
		bar.Text = ""
		bar.AutoButtonColor = false
		bar.ZIndex = 2
		bar.Parent = staffPanel
		local title = Instance.new("TextLabel")
		title.Size = UDim2.new(1, -70, 1, 0)
		title.Position = UDim2.new(0, 14, 0, 0)
		title.BackgroundTransparency = 1
		title.Font = Enum.Font.GothamBold
		title.TextSize = 14
		title.TextColor3 = COL.text
		title.Text = "Staff"
		title.TextXAlignment = Enum.TextXAlignment.Left
		title.ZIndex = 3
		title.Parent = bar
		local closeBtn = Instance.new("TextButton")
		closeBtn.Size = UDim2.new(0, 18, 0, 18)
		closeBtn.Position = UDim2.new(1, -27, 0, 10)
		closeBtn.BackgroundColor3 = Color3.fromRGB(225, 65, 65)
		closeBtn.Text = ""
		closeBtn.AutoButtonColor = false
		closeBtn.BorderSizePixel = 0
		closeBtn.ZIndex = 3
		closeBtn.Parent = bar
		local cc = Instance.new("UICorner")
		cc.CornerRadius = UDim.new(0, 9)
		cc.Parent = closeBtn
		local minBtn = Instance.new("TextButton")
		minBtn.Size = UDim2.new(0, 18, 0, 18)
		minBtn.Position = UDim2.new(1, -49, 0, 10)
		minBtn.BackgroundColor3 = Color3.fromRGB(235, 190, 45)
		minBtn.Text = ""
		minBtn.AutoButtonColor = false
		minBtn.BorderSizePixel = 0
		minBtn.ZIndex = 3
		minBtn.Parent = bar
		local mc = Instance.new("UICorner")
		mc.CornerRadius = UDim.new(0, 9)
		mc.Parent = minBtn

		staffBody = Instance.new("ScrollingFrame")
		staffBody.Name = "Body"
		staffBody.Size = UDim2.new(1, -20, 1, -66)
		staffBody.Position = UDim2.new(0, 10, 0, 40)
		staffBody.BackgroundTransparency = 1
		staffBody.BorderSizePixel = 0
		staffBody.ScrollBarThickness = 4
		staffBody.ScrollBarImageColor3 = COL.sub
		staffBody.CanvasSize = UDim2.new(0, 0, 0, 0)
		staffBody.ZIndex = 2
		staffBody.Parent = staffPanel

		statusLbl = Instance.new("TextLabel")
		statusLbl.Size = UDim2.new(1, -20, 0, 16)
		statusLbl.Position = UDim2.new(0, 10, 1, -22)
		statusLbl.BackgroundTransparency = 1
		statusLbl.Font = Enum.Font.Code
		statusLbl.TextSize = 10
		statusLbl.TextColor3 = COL.sub
		statusLbl.Text = "panel ready - transport live"
		statusLbl.TextXAlignment = Enum.TextXAlignment.Left
		statusLbl.ZIndex = 2
		statusLbl.Parent = staffPanel

		local layout = Instance.new("UIListLayout")
		layout.Padding = UDim.new(0, 5)
		layout.SortOrder = Enum.SortOrder.LayoutOrder
		layout.Parent = staffBody
		local pad = Instance.new("UIPadding")
		pad.PaddingTop = UDim.new(0, 4)
		pad.PaddingLeft = UDim.new(0, 4)
		pad.PaddingRight = UDim.new(0, 4)
		pad.Parent = staffBody
		layout:GetPropertyChangedSignal("AbsoluteContentSize"):Connect(function()
			staffBody.CanvasSize = UDim2.new(0, 0, 0, layout.AbsoluteContentSize.Y + 10)
		end)

		closeBtn.MouseButton1Click:Connect(function()
			click()
			staffPanel.Visible = false
		end)
		minBtn.MouseButton1Click:Connect(function()
			click()
			bodyVisible = not bodyVisible
			staffBody.Visible = bodyVisible
			statusLbl.Visible = bodyVisible
			staffPanel.Size = bodyVisible and UDim2.new(0, 300, 0, 430) or UDim2.new(0, 300, 0, 38)
		end)
		H.makeDraggable(staffPanel, bar)
	end)

	if not mountOk then
		warn("[Xyro] staff panel mount failed: " .. tostring(mountErr))
		if H.notify then
			H.notify({ title = "Staff", text = "panel mount failed: " .. tostring(mountErr), kind = "error" })
		end
		return
	end
	-- (body layout lives inside the pcall above; rows added below inherit
	-- the body's ZIndex 2 baseline)

	local ord = 0
	local function sec(text)
		ord += 1
		make("TextLabel", {
			Size = UDim2.new(1, -6, 0, 18),
			BackgroundTransparency = 1,
			Font = Enum.Font.GothamBold,
			TextSize = 11,
			TextColor3 = COL.sub,
			Text = string.upper(text),
			TextXAlignment = Enum.TextXAlignment.Left,
			LayoutOrder = ord,
		}, staffBody)
	end

	-- multi-select: userId -> true; empty set = broadcast to everyone
	local selSet = {}

	-- send one command either broadcast (ids empty) or chunked to id groups
	-- (6 per message keeps the ntfy payload comfortably under the length cap)
	local function sendTo(cmd, label, ids)
		ids = ids or {}
		local ok, msg
		if #ids == 0 then
			ok, msg = staffSend(cmd, "")
		else
			for i = 1, #ids, 6 do
				ok, msg = staffSend(cmd, table.concat(ids, ",", i, math.min(i + 5, #ids)))
				if not ok then
					break
				end
			end
		end
		if H.notify then
			H.notify({
				title = PANEL_TITLE,
				text = ok and (label .. " sent") or tostring(msg),
				kind = ok and "success" or "error",
			})
		end
		return ok
	end

	local function tpTo(plr)
		local c = plr.Character
		local target = c and c:FindFirstChild("HumanoidRootPart")
		local my = getHRP()
		if target and target:IsA("BasePart") and my then
			my.CFrame = target.CFrame * CFrame.new(0, 0, 3)
			return true
		end
		return false
	end

	-- Scythe-style card: rounded elevated surface with a title and a
	-- 2-column button grid, all in Xyro's palette
	local function makeCard(titleText)
		ord += 1
		local cardF = make("Frame", {
			Size = UDim2.new(1, -8, 0, 0),
			AutomaticSize = Enum.AutomaticSize.Y,
			BackgroundColor3 = COL.element,
			LayoutOrder = ord,
		}, staffBody)
		round(cardF, 8)
		make("UIStroke", { Color = COL.stroke, Thickness = 1, Transparency = 0.35 }, cardF)
		make("UIPadding", {
			PaddingTop = UDim.new(0, 8),
			PaddingLeft = UDim.new(0, 8),
			PaddingRight = UDim.new(0, 8),
			PaddingBottom = UDim.new(0, 8),
		}, cardF)
		local head = make("TextLabel", {
			Size = UDim2.new(1, 0, 0, 20),
			BackgroundTransparency = 1,
			Font = Enum.Font.GothamBold,
			TextSize = 12,
			TextColor3 = COL.sub,
			Text = titleText,
			TextXAlignment = Enum.TextXAlignment.Left,
		}, cardF)
		return cardF, head
	end

	local function gridButtons(cardF, defs, onPick)
		local inner = make("Frame", {
			Size = UDim2.new(1, 0, 0, 0),
			AutomaticSize = Enum.AutomaticSize.Y,
			BackgroundTransparency = 1,
			Position = UDim2.new(0, 0, 0, 26),
		}, cardF)
		make("UIGridLayout", {
			CellSize = UDim2.new(0.5, -3, 0, 26),
			CellPadding = UDim2.new(0, 4, 0, 5),
			SortOrder = Enum.SortOrder.LayoutOrder,
		}, inner)
		for i, d in ipairs(defs) do
			local b = make("TextButton", {
				BackgroundColor3 = COL.contentBg,
				Font = Enum.Font.GothamMedium,
				TextSize = 12,
				TextColor3 = COL.text,
				Text = d[1],
				AutoButtonColor = true,
				BorderSizePixel = 0,
				LayoutOrder = i,
			}, inner)
			round(b, 6)
			make("UIStroke", { Color = COL.stroke, Thickness = 1, Transparency = 0.5 }, b)
			connect(b.MouseButton1Click, function()
				click()
				onPick(d)
			end)
		end
	end

	-- ===== card 1: everyone (broadcast) =====
	local everyoneCard = makeCard("Everyone")
	gridButtons(everyoneCard, {
		{ "Fly Wheel", "fw" }, { "Jump", "jmp" },
		{ "Spin", "spn" }, { "Unspin", "usp" },
		{ "Freeze", "frz" }, { "Unfreeze", "thw" },
		{ "Fling", "flg" }, { "Sit", "sit" },
		{ "Blind", "bld" }, { "Unblind", "ubl" },
		{ "Bring", "brg" }, { "Void", "vod" },
		{ "Reset", "rst" }, { "Kick all", "kck" },
	}, function(d)
		sendTo(d[2], d[1], {})
	end)

	-- ===== card 2: selected users =====
	local selCard = makeCard("Selected users")
	gridButtons(selCard, {
		{ "Fly Wheel", "fw" }, { "Kick", "kck" },
		{ "Spin", "spn" }, { "Freeze", "frz" },
		{ "Fling", "flg" }, { "Sit", "sit" },
		{ "Bring", "brg" }, { "Void", "vod" },
		{ "Reset", "rst" }, { "Blind", "bld" },
		{ "Unspin", "usp" }, { "Unfreeze", "thw" },
		{ "Unblind", "ubl" }, { "Jump", "jmp" },
	}, function(d)
		local ids = {}
		for uid in pairs(selSet) do
			ids[#ids + 1] = tostring(uid)
		end
		if #ids == 0 then
			if H.notify then
				H.notify({ title = PANEL_TITLE, text = "select users below first (or use the Everyone card)", kind = "warn" })
			end
			return
		end
		table.sort(ids)
		sendTo(d[2], d[1], ids)
	end)

	-- ===== card 3: script users (multi-select + TP/FW) =====
	local usersCard = makeCard("Script users")
	local selAllBtn = make("TextButton", {
		Size = UDim2.new(0, 56, 0, 18),
		Position = UDim2.new(1, -124, 0, 1),
		BackgroundTransparency = 1,
		Font = Enum.Font.GothamMedium,
		TextSize = 11,
		TextColor3 = COL.accent,
		Text = "Select all",
		AutoButtonColor = false,
		BorderSizePixel = 0,
	}, usersCard)
	local clearBtn = make("TextButton", {
		Size = UDim2.new(0, 44, 0, 18),
		Position = UDim2.new(1, -50, 0, 1),
		BackgroundTransparency = 1,
		Font = Enum.Font.GothamMedium,
		TextSize = 11,
		TextColor3 = COL.sub,
		Text = "Clear",
		AutoButtonColor = false,
		BorderSizePixel = 0,
	}, usersCard)
	connect(selAllBtn.MouseButton1Click, function()
		click()
		local ntOnline = H.Nametags and H.Nametags.online() or {}
		for _, plr in ipairs(Players:GetPlayers()) do
			if plr ~= player and ntOnline[tostring(plr.Name):lower()] ~= nil then
				selSet[plr.UserId] = true
			end
		end
		refreshPlayerList()
	end)
	connect(clearBtn.MouseButton1Click, function()
		click()
		selSet = {}
		refreshPlayerList()
	end)

	local rowsHolder = make("Frame", {
		Size = UDim2.new(1, 0, 0, 0),
		AutomaticSize = Enum.AutomaticSize.Y,
		BackgroundTransparency = 1,
		Position = UDim2.new(0, 0, 0, 26),
	}, usersCard)
	make("UIListLayout", { Padding = UDim.new(0, 4), SortOrder = Enum.SortOrder.LayoutOrder }, rowsHolder)

	refreshPlayerList = function()
		for _, ch in ipairs(rowsHolder:GetChildren()) do
			if ch:IsA("Frame") then
				ch:Destroy()
			end
		end
		local ntOnline = H.Nametags and H.Nametags.online() or {}
		local guys = {}
		for _, plr in ipairs(Players:GetPlayers()) do
			if ntOnline[tostring(plr.Name):lower()] ~= nil then
				guys[#guys + 1] = plr
			end
		end
		table.sort(guys, function(p, q)
			return p.Name:lower() < q.Name:lower()
		end)
		for i, plr in ipairs(guys) do
			local isMe = plr == player
			local isSel = selSet[plr.UserId] == true
			local rowF = make("Frame", {
				Size = UDim2.new(1, 0, 0, 26),
				BackgroundColor3 = isSel and COL.accent or COL.contentBg,
				BackgroundTransparency = isSel and 0.55 or 0,
				BorderSizePixel = 0,
				LayoutOrder = i,
			}, rowsHolder)
			round(rowF, 6)
			make("UIStroke", {
				Color = isSel and COL.accent or COL.stroke,
				Thickness = 1,
				Transparency = isSel and 0.2 or 0.5,
			}, rowF)
			local nameBtn = make("TextButton", {
				Size = UDim2.new(1, -88, 1, 0),
				BackgroundTransparency = 1,
				Font = Enum.Font.Gotham,
				TextSize = 12,
				TextColor3 = isMe and COL.sub or COL.text,
				Text = "  " .. plr.Name .. (isMe and "  (you)" or ""),
				TextXAlignment = Enum.TextXAlignment.Left,
				TextTruncate = Enum.TextTruncate.AtEnd,
				AutoButtonColor = not isMe,
				BorderSizePixel = 0,
			}, rowF)
			if not isMe then
				connect(nameBtn.MouseButton1Click, function()
					click()
					if selSet[plr.UserId] then
						selSet[plr.UserId] = nil
					else
						selSet[plr.UserId] = true
					end
					refreshPlayerList()
				end)
				local tpBtn = make("TextButton", {
					Size = UDim2.new(0, 38, 1, -6),
					Position = UDim2.new(1, -84, 0.5, -10),
					BackgroundColor3 = COL.element,
					Font = Enum.Font.GothamMedium,
					TextSize = 11,
					TextColor3 = COL.text,
					Text = "TP",
					AutoButtonColor = true,
					BorderSizePixel = 0,
				}, rowF)
				round(tpBtn, 5)
				connect(tpBtn.MouseButton1Click, function()
					click()
					if not tpTo(plr) and H.notify then
						H.notify({ title = PANEL_TITLE, text = "teleport failed (no character?)", kind = "error" })
					end
				end)
				local fwBtn = make("TextButton", {
					Size = UDim2.new(0, 38, 1, -6),
					Position = UDim2.new(1, -42, 0.5, -10),
					BackgroundColor3 = COL.element,
					Font = Enum.Font.GothamMedium,
					TextSize = 11,
					TextColor3 = COL.on,
					Text = "FW",
					AutoButtonColor = true,
					BorderSizePixel = 0,
				}, rowF)
				round(fwBtn, 5)
				connect(fwBtn.MouseButton1Click, function()
					click()
					sendTo("fw", "flywheel -> " .. plr.Name, { tostring(plr.UserId) })
				end)
			end
		end
		if #guys == 0 then
			make("TextLabel", {
				Size = UDim2.new(1, 0, 0, 26),
				BackgroundTransparency = 1,
				Font = Enum.Font.Gotham,
				TextSize = 12,
				TextColor3 = COL.sub,
				Text = "no script users online",
				LayoutOrder = 9999,
			}, rowsHolder)
		end
	end
	refreshPlayerList()

	-- refresh the player list as presence changes
	task.spawn(function()
		while staffPanel.Parent do
			task.wait(5)
			pcall(refreshPlayerList)
		end
	end)

	H.staffPanelToggle = function()
		staffPanel.Visible = not staffPanel.Visible
		if staffPanel.Visible then
			-- re-open resets minimize + H.popIn-style scale animation
			bodyVisible = true
			staffBody.Visible = true
			statusLbl.Visible = true
			staffPanel.Size = UDim2.new(0, 300, 0, 430)
			local sc = staffPanel:FindFirstChildOfClass("UIScale") or Instance.new("UIScale")
			sc.Parent = staffPanel
			local base = H.scales and H.scales["XyroStaffPanel"] or 1
			sc.Scale = base * 0.8
			local info = TweenInfo.new(0.2, Enum.EasingStyle.Back, Enum.EasingDirection.Out)
			TweenService:Create(sc, info, { Scale = base }):Play()
		end
		return staffPanel.Visible
	end

	-- Debug tab launcher button (top of the debug page)
	if H.debugPage then
		local sc = H.debugPage:FindFirstChildOfClass("ScrollingFrame")
		if sc then
			local b = make("TextButton", {
				Size = UDim2.new(1, -6, 0, 28),
				BackgroundColor3 = COL.element,
				Font = Enum.Font.GothamMedium,
				TextSize = 12,
				TextColor3 = COL.text,
				Text = "Staff Panel",
				AutoButtonColor = true,
				BorderSizePixel = 0,
				LayoutOrder = -1,
			}, sc)
			round(b, 6)
			connect(b.MouseButton1Click, function()
				click()
				H.staffPanelToggle()
			end)
		end
	end
end
