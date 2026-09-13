
local Players = game:GetService("Players")
local Debris = game:GetService("Debris")
local StarterGui = game:GetService("StarterGui")
local SoundService = game:GetService("SoundService")
local RunService = game:GetService("RunService")

local player = Players.LocalPlayer
local mouse = player:GetMouse()

local function notify(text)
	pcall(function()
		StarterGui:SetCore("SendNotification", { Title = "Whip", Text = text, Duration = 4 })
	end)
end

local function giveTool(t)
	pcall(function()
		StarterGui:SetCoreGuiEnabled(Enum.CoreGuiType.Backpack, true)
	end)

	local backpack = player:FindFirstChildOfClass("Backpack") or player:WaitForChild("Backpack", 5)
	if backpack then
		t.Parent = backpack
	else
		local char = player.Character
		if not char then
			notify("no Backpack and no character - respawn and retry")
			return false
		end
		t.Parent = char
	end

	local hum = player.Character and player.Character:FindFirstChildOfClass("Humanoid")
	if hum then
		pcall(function()
			hum:EquipTool(t)
		end)
	end
	return true
end

local CRACK_SOUND = "rbxassetid://5801257793"

local GRIP_LEN = 1.10
local GRIP_WIDTH = 0.26
local GRIP_COLOUR = Color3.fromRGB(64, 42, 30)

local LINKS = 16
local LINK_LEN = 0.34
local LINK_HEAD_W = 0.17
local LINK_TAIL_W = 0.055
local LINK_COLOUR = Color3.fromRGB(38, 26, 20)

local GRAVITY = Vector3.new(0, -85, 0)
local DAMPING = 0.90
local ITERATIONS = 8
local MAX_DT = 1 / 30
local CRACK_STRENGTH = 26

local tool, links, points, prev, stepConn

local function crackSound()
	pcall(function()
		local s = Instance.new("Sound")
		s.SoundId = CRACK_SOUND
		s.Volume = 1
		s.Parent = SoundService
		s:Play()
		Debris:AddItem(s, 4)
	end)
end

local function tipOfGrip(handle)
	return handle.CFrame * CFrame.new(0, GRIP_LEN / 2, 0)
end

local function build()
	tool = Instance.new("Tool")
	tool.Name = "Whip"
	tool.ToolTip = "click to crack"
	tool.CanBeDropped = true
	tool.GripPos = Vector3.new(0, -0.35, 0)

	local handle = Instance.new("Part")
	handle.Name = "Handle"
	handle.Size = Vector3.new(GRIP_WIDTH, GRIP_LEN, GRIP_WIDTH)
	handle.Color = GRIP_COLOUR
	handle.Material = Enum.Material.Wood
	handle.TopSurface = Enum.SurfaceType.Smooth
	handle.BottomSurface = Enum.SurfaceType.Smooth
	Instance.new("CylinderMesh").Parent = handle
	handle.Parent = tool

	links, points, prev = {}, {}, {}
	local start = tipOfGrip(handle).Position
	for i = 1, LINKS + 1 do
		points[i] = start + Vector3.new(0, -(i - 1) * LINK_LEN, 0)
		prev[i] = points[i]
	end

	for i = 1, LINKS do
		local t = (i - 1) / math.max(LINKS - 1, 1)
		local width = LINK_HEAD_W + (LINK_TAIL_W - LINK_HEAD_W) * t

		local seg = Instance.new("Part")
		seg.Name = "Link" .. i
		seg.Size = Vector3.new(width, LINK_LEN, width)
		seg.Color = LINK_COLOUR
		seg.Material = Enum.Material.SmoothPlastic
		seg.Anchored = true
		seg.CanCollide = false
		seg.CanQuery = false
		seg.CanTouch = false
		seg.TopSurface = Enum.SurfaceType.Smooth
		seg.BottomSurface = Enum.SurfaceType.Smooth
		Instance.new("CylinderMesh").Parent = seg
		seg.Parent = tool
		links[i] = seg
	end

	local tip = links[#links]
	if tip then
		local a0 = Instance.new("Attachment")
		a0.Position = Vector3.new(0, LINK_LEN / 2, 0)
		a0.Parent = tip
		local a1 = Instance.new("Attachment")
		a1.Position = Vector3.new(0, -LINK_LEN / 2, 0)
		a1.Parent = tip

		local trail = Instance.new("Trail")
		trail.Attachment0 = a0
		trail.Attachment1 = a1
		trail.Lifetime = 0.28
		trail.MinLength = 0.1
		trail.LightEmission = 0.2
		trail.Color = ColorSequence.new(Color3.fromRGB(210, 200, 190))
		trail.Transparency = NumberSequence.new({
			NumberSequenceKeypoint.new(0, 0.35),
			NumberSequenceKeypoint.new(1, 1),
		})
		trail.Parent = tip
	end

	giveTool(tool)
	return tool, handle
end

local function simulate(handle, dt)
	local anchor = tipOfGrip(handle).Position

	for i = 2, #points do
		local p = points[i]
		local velocity = (p - prev[i]) * DAMPING
		prev[i] = p
		points[i] = p + velocity + GRAVITY * dt * dt
	end

	for _ = 1, ITERATIONS do
		points[1] = anchor
		for i = 2, #points do
			local delta = points[i] - points[i - 1]
			local dist = delta.Magnitude
			if dist > 1e-4 then
				points[i] = points[i - 1] + delta * (LINK_LEN / dist)
			end
		end
	end

	for i = 1, #links do
		local a, b = points[i], points[i + 1]
		local span = b - a
		if span.Magnitude > 1e-4 then
			links[i].CFrame = CFrame.lookAt(a + span * 0.5, b) * CFrame.Angles(-math.pi / 2, 0, 0)
		end
	end
end

local function aimFrom(origin)
	local hit = mouse.Hit
	if hit then
		local delta = hit.Position - origin
		if delta.Magnitude > 1e-4 then
			return delta.Unit
		end
	end
	local cam = workspace.CurrentCamera
	return cam and cam.CFrame.LookVector or Vector3.new(0, 0, -1)
end

local function crack()
	crackSound()
	if not points then
		return
	end
	local dir = aimFrom(points[1])
	for i = 2, #points do
		prev[i] = prev[i] - dir * CRACK_STRENGTH * (i / #points)
	end
end

local function stop()
	if stepConn then
		stepConn:Disconnect()
		stepConn = nil
	end
end

local function spawnWhip()
	stop()
	if tool then
		tool:Destroy()
	end

	local t, handle = build()

	t.Equipped:Connect(function()
		stop()
		local start = tipOfGrip(handle).Position
		for i = 1, #points do
			points[i] = start + Vector3.new(0, -(i - 1) * LINK_LEN, 0)
			prev[i] = points[i]
		end
		stepConn = RunService.RenderStepped:Connect(function(dt)
			if handle.Parent then
				simulate(handle, math.min(dt, MAX_DT))
			end
		end)
	end)

	t.Unequipped:Connect(stop)
	t.Activated:Connect(crack)
end

spawnWhip()
player.CharacterAdded:Connect(function()
	task.wait(1)
	spawnWhip()
end)
