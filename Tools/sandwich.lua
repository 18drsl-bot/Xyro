local Players = game:GetService("Players")
local Debris = game:GetService("Debris")
local StarterGui = game:GetService("StarterGui")
local SoundService = game:GetService("SoundService")

local player = Players.LocalPlayer

local function notify(text)
	pcall(function()
		StarterGui:SetCore("SendNotification", { Title = "Sandwich", Text = text, Duration = 4 })
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

local BITE_SOUND = "rbxassetid://91209592691035"

local UGC_ID = 5461538290
local UGC_NAME = "SandwichUGC"

local LAYERS = {
	{ name = "Bread",   size = Vector3.new(2.0, 0.40, 2.0), colour = Color3.fromRGB(214, 168, 106) },
	{ name = "Lettuce", size = Vector3.new(1.9, 0.14, 1.9), colour = Color3.fromRGB(102, 190, 84) },
	{ name = "Tomato",  size = Vector3.new(1.7, 0.18, 1.7), colour = Color3.fromRGB(206, 62, 54) },
	{ name = "Cheese",  size = Vector3.new(1.9, 0.12, 1.9), colour = Color3.fromRGB(245, 197, 66) },
	{ name = "Ham",     size = Vector3.new(1.8, 0.20, 1.8), colour = Color3.fromRGB(232, 145, 158) },
	{ name = "Top",     size = Vector3.new(2.0, 0.50, 2.0), colour = Color3.fromRGB(214, 168, 106) },
}

local tool, layers

local function build()
	tool = Instance.new("Tool")
	tool.Name = "Sandwich"
	tool.ToolTip = "click to eat"
	tool.CanBeDropped = true
	tool.GripPos = Vector3.new(0, -0.3, 0)

	local handle = Instance.new("Part")
	handle.Name = "Handle"
	handle.Size = LAYERS[1].size
	handle.Color = LAYERS[1].colour
	handle.Material = Enum.Material.Sand
	handle.TopSurface = Enum.SurfaceType.Smooth
	handle.BottomSurface = Enum.SurfaceType.Smooth
	handle.Parent = tool

	layers = {}
	local height = LAYERS[1].size.Y / 2

	for i = 2, #LAYERS do
		local def = LAYERS[i]
		local part = Instance.new("Part")
		part.Name = def.name
		part.Size = def.size
		part.Color = def.colour
		part.Material = Enum.Material.SmoothPlastic
		part.CanCollide = false
		part.Massless = true
		part.TopSurface = Enum.SurfaceType.Smooth
		part.BottomSurface = Enum.SurfaceType.Smooth
		part.CFrame = handle.CFrame * CFrame.new(0, height + def.size.Y / 2, 0)
		part.Parent = tool

		local weld = Instance.new("WeldConstraint")
		weld.Part0 = handle
		weld.Part1 = part
		weld.Parent = part

		height = height + def.size.Y
		layers[#layers + 1] = part
	end

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

local function fetchAccessory()
	local objects
	local ok = pcall(function()
		objects = game:GetObjects("rbxassetid://" .. UGC_ID)
	end)
	if not ok or not objects or not objects[1] then
		objects = nil
		pcall(function()
			local model = game:GetService("InsertService"):LoadAsset(UGC_ID)
			objects = model and model:GetChildren()
		end)
	end
	if not objects then
		return nil
	end
	for _, inst in ipairs(objects) do
		if inst:IsA("Accessory") then
			return inst
		end
		local nested = inst:FindFirstChildWhichIsA("Accessory", true)
		if nested then
			return nested
		end
	end
	return nil
end

local warned = false

local function wearUGC()
	local char = player.Character
	local hum = char and char:FindFirstChildOfClass("Humanoid")
	if not char or not hum then
		return
	end
	if char:FindFirstChild(UGC_NAME) then
		return
	end

	local acc = fetchAccessory()
	if not acc then
		if not warned then
			warned = true
			notify("couldn't load UGC " .. UGC_ID)
		end
		return
	end

	acc.Name = UGC_NAME
	if not pcall(function()
		hum:AddAccessory(acc)
	end) then
		acc.Parent = char
	end
end

local eaten = 0

local function bite()
	wearUGC()

	local top = table.remove(layers)
	if not top then
		return
	end

	chomp()
	top:Destroy()
	eaten = eaten + 1

	if #layers > 0 then
		return
	end

	chomp()
	task.wait(0.25)
	if tool then
		tool:Destroy()
		tool = nil
	end
	notify(("gone. %d bites."):format(eaten))
end

local function spawnSandwich()
	if tool then
		tool:Destroy()
	end
	eaten = 0
	warned = false
	build().Activated:Connect(bite)
end

spawnSandwich()
player.CharacterAdded:Connect(function()
	task.wait(1)
	spawnSandwich()
end)
