local Players = game:GetService("Players")
local Debris = game:GetService("Debris")
local StarterGui = game:GetService("StarterGui")
local SoundService = game:GetService("SoundService")
local RunService = game:GetService("RunService")

local player = Players.LocalPlayer

local function notify(text)
	pcall(function()
		StarterGui:SetCore("SendNotification", { Title = "Dildo", Text = text, Duration = 4 })
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

local CLICK_SOUND = "rbxassetid://73512886589340"

local COLOUR = Color3.fromRGB(236, 148, 176)

local SCALE = 0.55

local SEG_HEIGHT = 0.62 * SCALE
local SEG_WIDTH = 0.85 * SCALE
local SEGMENTS = 5

local BALL_SIZE = 0.80 * SCALE
local BALL_SPREAD = 0.42 * SCALE

local MOUNT_DROP = 2.2

local PARTICLE_TEXTURE = "rbxasset://textures/particles/smoke_main.dds"
local PARTICLE_RATE = 5
local PARTICLE_BURST = 24

local tool, rig, emitter, follow

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

local function sphere(name, size)
	local s = Instance.new("Part")
	s.Name = name
	s.Shape = Enum.PartType.Ball
	s.Size = Vector3.new(size, size, size)
	s.Color = COLOUR
	s.Material = Enum.Material.SmoothPlastic
	return s
end

local function detach()
	if follow then
		follow:Disconnect()
		follow = nil
	end
	if rig then
		rig:Destroy()
		rig = nil
	end
	emitter = nil
end

local function attach()
	detach() -- never stack two of them

	local char = player.Character
	local root = char and char:FindFirstChild("HumanoidRootPart")
	if not root then
		notify("no HumanoidRootPart to mount to")
		return
	end

	rig = Instance.new("Model")
	rig.Name = "MountedRig"
	rig.Parent = char

	-- The base is an ordinary part driven by us, not a Tool Handle, which is the whole difference
	-- from the Edible: nothing here ever touches your hand. Anchored rather than welded to the
	-- root, because a weld would copy the root's motion exactly -- including vertical -- and we
	-- want to control the height ourselves. Everything else WeldConstraints to the base, so
	-- moving the base moves the whole assembly.
	local base = cylinder("Base", SEG_WIDTH, SEG_HEIGHT)
	base.CanCollide = false
	base.Anchored = true
	base.CFrame = CFrame.new(root.Position.X, root.Position.Y - MOUNT_DROP, root.Position.Z)
	base.Parent = rig

	local height = SEG_HEIGHT / 2 -- running offset from the base's centre

	local function weldTo(part)
		part.CanCollide = false
		part.Massless = true
		part.Parent = rig

		local weld = Instance.new("WeldConstraint")
		weld.Part0 = base
		weld.Part1 = part
		weld.Parent = part
	end

	local function stack(part)
		part.CFrame = base.CFrame * CFrame.new(0, height + part.Size.Y / 2, 0)
		weldTo(part)
		height = height + part.Size.Y
	end

	for i, side in ipairs({ -1, 1 }) do
		local b = sphere("Ball" .. i, BALL_SIZE)
		b.CFrame = base.CFrame * CFrame.new(side * BALL_SPREAD, -SEG_HEIGHT / 2 + 0.05, 0)
		weldTo(b)
	end

	for i = 2, SEGMENTS do -- 1 is the base, already placed
		stack(cylinder("Seg" .. i, SEG_WIDTH, SEG_HEIGHT))
	end
	stack(sphere("Tip", SEG_WIDTH))

	-- The emitter rides its own invisible part parked just above the tip, rather than sitting on
	-- the tip itself -- keeps the emission point independent of the geometry.
	local nozzle = Instance.new("Part")
	nozzle.Name = "Nozzle"
	nozzle.Size = Vector3.new(0.2, 0.2, 0.2)
	nozzle.Transparency = 1
	nozzle.CanCollide = false
	nozzle.Massless = true
	nozzle.CFrame = base.CFrame * CFrame.new(0, height + 0.15, 0)
	nozzle.Parent = rig

	local nozzleWeld = Instance.new("WeldConstraint")
	nozzleWeld.Part0 = base
	nozzleWeld.Part1 = nozzle
	nozzleWeld.Parent = nozzle

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
	emitter.Acceleration = Vector3.new(0, -20, 0) -- arc over instead of going straight up forever
	emitter.EmissionDirection = Enum.NormalId.Top
	emitter.Rate = PARTICLE_RATE
	emitter.Parent = nozzle

	-- X/Z track you every frame and it turns with you, but the height is only re-baselined while
	-- you're actually standing on something. So walking (including up stairs and slopes) carries
	-- it along, and jumping leaves it at the height it was -- it doesn't ride up with you.
	local lockedY = base.Position.Y

	follow = RunService.RenderStepped:Connect(function()
		local ch = player.Character
		local r = ch and ch:FindFirstChild("HumanoidRootPart")
		if not r or not base.Parent then
			return
		end
		local hum = ch:FindFirstChildOfClass("Humanoid")
		if hum and hum.FloorMaterial ~= Enum.Material.Air then
			lockedY = r.Position.Y - MOUNT_DROP
		end
		local _, yaw = r.CFrame:ToEulerAnglesYXZ() -- yaw only; no pitch/roll from the root
		base.CFrame = CFrame.new(r.Position.X, lockedY, r.Position.Z) * CFrame.Angles(0, yaw, 0)
	end)
end

local function clickSound()
	pcall(function()
		local s = Instance.new("Sound")
		s.SoundId = CLICK_SOUND
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
	clickSound()
end

local function build()
	tool = Instance.new("Tool")
	tool.Name = "Dildo"
	tool.ToolTip = "equip to strap on, click it"
	tool.CanBeDropped = true
	-- No Handle at all: the rig lives on the character, so there is nothing to put in your hand.
	-- Activated still fires on click with this off, which is the only bit of Tool we actually want.
	tool.RequiresHandle = false

	tool.Equipped:Connect(attach)
	tool.Unequipped:Connect(detach)
	tool.Activated:Connect(onClick)

	giveTool(tool)
	return tool
end

local function spawnDildo()
	detach()
	if tool then
		tool:Destroy()
	end
	build()
end

spawnDildo()
-- a fresh Backpack comes with every respawn, so hand yourself another one
player.CharacterAdded:Connect(function()
	task.wait(1)
	spawnDildo()
end)
