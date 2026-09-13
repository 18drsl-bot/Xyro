local Players = game:GetService("Players")
local Debris = game:GetService("Debris")
local StarterGui = game:GetService("StarterGui")
local SoundService = game:GetService("SoundService")

local player = Players.LocalPlayer

local function notify(text)
	pcall(function()
		StarterGui:SetCore("SendNotification", { Title = "Edible Dildo", Text = text, Duration = 4 })
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

local BITE_SOUND = "rbxassetid://73512886589340"

local COLOUR = Color3.fromRGB(236, 148, 176)

local SEG_HEIGHT = 0.62
local SEG_WIDTH = 0.85
local SEGMENTS = 5

local BALL_SIZE = 0.80
local BALL_SPREAD = 0.42

local PARTICLE_TEXTURE = "rbxasset://textures/particles/smoke_main.dds"
local PARTICLE_RATE = 5
local PARTICLE_BURST = 24

local tool, emitter

local function cylinder(name, width, height)
	local p = Instance.new("Part")
	p.Name = name
	p.Size = Vector3.new(width, height, width)
	p.Color = COLOUR
	p.Material = Enum.Material.SmoothPlastic
	p.TopSurface = Enum.SurfaceType.Smooth
	p.BottomSurface = Enum.SurfaceType.Smooth
	Instance.new("CylinderMesh").Parent = p
	return p
end

local function build()
	tool = Instance.new("Tool")
	tool.Name = "Edible Dildo"
	tool.ToolTip = "click to eat"
	tool.CanBeDropped = true
	tool.GripPos = Vector3.new(0, -0.2, 0)

	local handle = cylinder("Handle", SEG_WIDTH, SEG_HEIGHT)
	handle.Parent = tool

	local height = SEG_HEIGHT / 2

	local function weldTo(part)
		part.CanCollide = false
		part.Massless = true
		part.Parent = tool

		local weld = Instance.new("WeldConstraint")
		weld.Part0 = handle
		weld.Part1 = part
		weld.Parent = part
	end

	local function stack(part)
		part.CFrame = handle.CFrame * CFrame.new(0, height + part.Size.Y / 2, 0)
		weldTo(part)
		height = height + part.Size.Y
	end

	local function sphere(name, size)
		local s = Instance.new("Part")
		s.Name = name
		s.Shape = Enum.PartType.Ball
		s.Size = Vector3.new(size, size, size)
		s.Color = COLOUR
		s.Material = Enum.Material.SmoothPlastic
		return s
	end

	for i, side in ipairs({ -1, 1 }) do
		local b = sphere("Ball" .. i, BALL_SIZE)
		b.CFrame = handle.CFrame * CFrame.new(side * BALL_SPREAD, -SEG_HEIGHT / 2 + 0.05, 0)
		weldTo(b)
	end

	for i = 2, SEGMENTS do
		stack(cylinder("Seg" .. i, SEG_WIDTH, SEG_HEIGHT))
	end
	stack(sphere("Tip", SEG_WIDTH))

	local nozzle = Instance.new("Part")
	nozzle.Name = "Nozzle"
	nozzle.Size = Vector3.new(0.2, 0.2, 0.2)
	nozzle.Transparency = 1
	nozzle.CanCollide = false
	nozzle.Massless = true
	nozzle.Parent = tool

	local nozzleWeld = Instance.new("Weld")
	nozzleWeld.Part0 = handle
	nozzleWeld.Part1 = nozzle
	nozzleWeld.C0 = CFrame.new(0, height + 0.15, 0)
	nozzleWeld.Parent = handle

	emitter = Instance.new("ParticleEmitter")
	emitter.Texture = PARTICLE_TEXTURE
	emitter.Color = ColorSequence.new(Color3.new(1, 1, 1))
	emitter.Size = NumberSequence.new({
		NumberSequenceKeypoint.new(0, 0.30),
		NumberSequenceKeypoint.new(1, 0),
	})
	emitter.Transparency = NumberSequence.new({
		NumberSequenceKeypoint.new(0, 0.15),
		NumberSequenceKeypoint.new(1, 1),
	})
	emitter.Lifetime = NumberRange.new(0.5, 1.0)
	emitter.Speed = NumberRange.new(5, 9)
	emitter.SpreadAngle = Vector2.new(14, 14)
	emitter.Acceleration = Vector3.new(0, -20, 0)
	emitter.EmissionDirection = Enum.NormalId.Top
	emitter.Rate = PARTICLE_RATE
	emitter.Parent = nozzle

	giveTool(tool)
	return tool
end

local function chomp()
	pcall(function()
		local s = Instance.new("Sound")
		s.SoundId = BITE_SOUND
		s.Volume = 1
		s.Parent = SoundService
		s:Play()
		Debris:AddItem(s, 3)
	end)
end

local function onClick()
	if emitter then
		emitter:Emit(PARTICLE_BURST)
	end
	chomp()
end

local function spawnEdible()
	if tool then
		tool:Destroy()
	end
	build().Activated:Connect(onClick)
end

spawnEdible()
player.CharacterAdded:Connect(function()
	task.wait(1)
	spawnEdible()
end)
