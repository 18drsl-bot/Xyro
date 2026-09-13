local Players = game:GetService("Players")

local player = Players.LocalPlayer
local character = player.Character or player.CharacterAdded:Wait()

player.CharacterAdded:Connect(function(c)
    character = c
end)

local currentModel = nil
local guiVisible = true

local function getSafePosition()
    local parts = {}
    for _,v in pairs(workspace:GetDescendants()) do
        if v:IsA("BasePart") then
            table.insert(parts,v)
        end
    end

    local spawnPart = nil
    for _,v in pairs(workspace:GetDescendants()) do
        if v:IsA("BasePart") and string.find(string.lower(v.Name),"spawn") then
            spawnPart = v
            break
        end
    end

    local spawnPos = spawnPart and spawnPart.Position or Vector3.zero
    local center = Vector3.zero
    if #parts > 0 then
        for _,p in pairs(parts) do
            center += p.Position
        end
        center = center / #parts
    end

    local mid = (spawnPos + center) / 1

    local safeOffset = Vector3.new(
        math.random(-500,500),
        math.random(-500,500),
        math.random(-500,500)
    )

    return mid + safeOffset
end

local function getExtremelyFarPosition()
    local spawnPart = workspace:FindFirstChild("ModelSpawn")
    if spawnPart and spawnPart:IsA("BasePart") then
        return spawnPart.Position
    end
    
    return Vector3.new(-410.25, 100.5, -75.46) -- fallback position
end

local function getAllParts(container)
    local parts = {}
    for _,v in pairs(container:GetDescendants()) do
        if v:IsA("BasePart") then
            table.insert(parts,v)
        end
    end
    return parts
end

local function getCenterPart(container)
    local parts = getAllParts(container)
    if #parts == 0 then return nil end

    local total = Vector3.zero
    for _,p in pairs(parts) do
        total += p.Position
    end

    local center = total / #parts
    local closest = parts[1]
    local dist = (closest.Position - center).Magnitude

    for _,p in pairs(parts) do
        local d = (p.Position - center).Magnitude
        if d < dist then
            closest = p
            dist = d
        end
    end

    return closest
end

local function getSpawnPart(container)
    for _,v in pairs(container:GetDescendants()) do
        if v:IsA("BasePart") and string.find(string.lower(v.Name),"spawn") then
            return v
        end
    end
    return nil
end

local function teleportTo(part)
    if character and character:FindFirstChild("HumanoidRootPart") and part then
        character.HumanoidRootPart.CFrame = part.CFrame + Vector3.new(0,5,0)
    end
end

local function prepareModel(model, position)
    for _,v in pairs(model:GetDescendants()) do
        if v:IsA("BasePart") then
            v.Anchored = true
            v.CanCollide = true
        end
    end

    if model:IsA("Model") then
local spawnPart = workspace:FindFirstChild("ModelSpawn")
if spawnPart then
    model:PivotTo(spawnPart.CFrame)
else
    model:PivotTo(CFrame.new(position))
end
    end
end

local function insertModel(assetId)
    local id = tonumber(assetId)
    if not id then return end

    local success, objects = pcall(function()
        return game:GetObjects("rbxassetid://"..id)
    end)

    if not success or not objects or #objects == 0 then return end

    local model = objects[1]
    model.Parent = workspace
    prepareModel(model, getExtremelyFarPosition())
    currentModel = model
end

insertModel(7860328354)

--[[
    WARNING: Heads up! This script has not been verified by ScriptBlox. Use at your own risk!
]]
local Players = game:GetService("Players")

local player = Players.LocalPlayer
local character = player.Character or player.CharacterAdded:Wait()

player.CharacterAdded:Connect(function(c)
    character = c
end)

local currentModel = nil
local guiVisible = true

local function getSafePosition()
    local parts = {}
    for _,v in pairs(workspace:GetDescendants()) do
        if v:IsA("BasePart") then
            table.insert(parts,v)
        end
    end

    local spawnPart = nil
    for _,v in pairs(workspace:GetDescendants()) do
        if v:IsA("BasePart") and string.find(string.lower(v.Name),"spawn") then
            spawnPart = v
            break
        end
    end

    local spawnPos = spawnPart and spawnPart.Position or Vector3.zero
    local center = Vector3.zero
    if #parts > 0 then
        for _,p in pairs(parts) do
            center += p.Position
        end
        center = center / #parts
    end

    local mid = (spawnPos + center) / 1

    local safeOffset = Vector3.new(
        math.random(-500,500),
        math.random(-500,500),
        math.random(-500,500)
    )

    return mid + safeOffset
end

local function getExtremelyFarPosition()
    local spawnPart = workspace:FindFirstChild("ModelSpawn")
    if spawnPart and spawnPart:IsA("BasePart") then
        return spawnPart.Position
    end
    
    return Vector3.new(-434.56, 85.30, -62.31) -- fallback position
end

local function getAllParts(container)
    local parts = {}
    for _,v in pairs(container:GetDescendants()) do
        if v:IsA("BasePart") then
            table.insert(parts,v)
        end
    end
    return parts
end

local function getCenterPart(container)
    local parts = getAllParts(container)
    if #parts == 0 then return nil end

    local total = Vector3.zero
    for _,p in pairs(parts) do
        total += p.Position
    end

    local center = total / #parts
    local closest = parts[1]
    local dist = (closest.Position - center).Magnitude

    for _,p in pairs(parts) do
        local d = (p.Position - center).Magnitude
        if d < dist then
            closest = p
            dist = d
        end
    end

    return closest
end

local function getSpawnPart(container)
    for _,v in pairs(container:GetDescendants()) do
        if v:IsA("BasePart") and string.find(string.lower(v.Name),"spawn") then
            return v
        end
    end
    return nil
end

local function teleportTo(part)
    if character and character:FindFirstChild("HumanoidRootPart") and part then
        character.HumanoidRootPart.CFrame = part.CFrame + Vector3.new(0,5,0)
    end
end

local function prepareModel(model, position)
    for _,v in pairs(model:GetDescendants()) do
        if v:IsA("BasePart") then
            v.Anchored = true
            v.CanCollide = true
        end
    end

    if model:IsA("Model") then
local spawnPart = workspace:FindFirstChild("ModelSpawn")
if spawnPart then
    model:PivotTo(spawnPart.CFrame)
else
    model:PivotTo(CFrame.new(position))
end
    end
end

local function insertModel(assetId)
    local id = tonumber(assetId)
    if not id then return end

    local success, objects = pcall(function()
        return game:GetObjects("rbxassetid://"..id)
    end)

    if not success or not objects or #objects == 0 then return end

    local model = objects[1]
    model.Parent = workspace
    prepareModel(model, getExtremelyFarPosition())
    currentModel = model
end

insertModel(8148059102)

--[[
    WARNING: Heads up! This script has not been verified by ScriptBlox. Use at your own risk!
]]
local Players = game:GetService("Players")

local player = Players.LocalPlayer
local character = player.Character or player.CharacterAdded:Wait()

player.CharacterAdded:Connect(function(c)
    character = c
end)

local currentModel = nil
local guiVisible = true

local function getSafePosition()
    local parts = {}
    for _,v in pairs(workspace:GetDescendants()) do
        if v:IsA("BasePart") then
            table.insert(parts,v)
        end
    end

    local spawnPart = nil
    for _,v in pairs(workspace:GetDescendants()) do
        if v:IsA("BasePart") and string.find(string.lower(v.Name),"spawn") then
            spawnPart = v
            break
        end
    end

    local spawnPos = spawnPart and spawnPart.Position or Vector3.zero
    local center = Vector3.zero
    if #parts > 0 then
        for _,p in pairs(parts) do
            center += p.Position
        end
        center = center / #parts
    end

    local mid = (spawnPos + center) / 1

    local safeOffset = Vector3.new(
        math.random(-500,500),
        math.random(-500,500),
        math.random(-500,500)
    )

    return mid + safeOffset
end

local function getExtremelyFarPosition()
    local spawnPart = workspace:FindFirstChild("ModelSpawn")
    if spawnPart and spawnPart:IsA("BasePart") then
        return spawnPart.Position
    end
    
    return Vector3.new(-434.56, 85.30, -63.31) -- fallback position
end

local function getAllParts(container)
    local parts = {}
    for _,v in pairs(container:GetDescendants()) do
        if v:IsA("BasePart") then
            table.insert(parts,v)
        end
    end
    return parts
end

local function getCenterPart(container)
    local parts = getAllParts(container)
    if #parts == 0 then return nil end

    local total = Vector3.zero
    for _,p in pairs(parts) do
        total += p.Position
    end

    local center = total / #parts
    local closest = parts[1]
    local dist = (closest.Position - center).Magnitude

    for _,p in pairs(parts) do
        local d = (p.Position - center).Magnitude
        if d < dist then
            closest = p
            dist = d
        end
    end

    return closest
end

local function getSpawnPart(container)
    for _,v in pairs(container:GetDescendants()) do
        if v:IsA("BasePart") and string.find(string.lower(v.Name),"spawn") then
            return v
        end
    end
    return nil
end

local function teleportTo(part)
    if character and character:FindFirstChild("HumanoidRootPart") and part then
        character.HumanoidRootPart.CFrame = part.CFrame + Vector3.new(0,5,0)
    end
end

local function prepareModel(model, position)
    for _,v in pairs(model:GetDescendants()) do
        if v:IsA("BasePart") then
            v.Anchored = true
            v.CanCollide = true
        end
    end

    if model:IsA("Model") then
local spawnPart = workspace:FindFirstChild("ModelSpawn")
if spawnPart then
    model:PivotTo(spawnPart.CFrame)
else
    model:PivotTo(CFrame.new(position))
end
    end
end

local function insertModel(assetId)
    local id = tonumber(assetId)
    if not id then return end

    local success, objects = pcall(function()
        return game:GetObjects("rbxassetid://"..id)
    end)

    if not success or not objects or #objects == 0 then return end

    local model = objects[1]
    model.Parent = workspace
    prepareModel(model, getExtremelyFarPosition())
    currentModel = model
end

insertModel(8148059102)

--[[
    WARNING: Heads up! This script has not been verified by ScriptBlox. Use at your own risk!
]]
local Players = game:GetService("Players")

local player = Players.LocalPlayer
local character = player.Character or player.CharacterAdded:Wait()

player.CharacterAdded:Connect(function(c)
    character = c
end)

local currentModel = nil
local guiVisible = true

local function getSafePosition()
    local parts = {}
    for _,v in pairs(workspace:GetDescendants()) do
        if v:IsA("BasePart") then
            table.insert(parts,v)
        end
    end

    local spawnPart = nil
    for _,v in pairs(workspace:GetDescendants()) do
        if v:IsA("BasePart") and string.find(string.lower(v.Name),"spawn") then
            spawnPart = v
            break
        end
    end

    local spawnPos = spawnPart and spawnPart.Position or Vector3.zero
    local center = Vector3.zero
    if #parts > 0 then
        for _,p in pairs(parts) do
            center += p.Position
        end
        center = center / #parts
    end

    local mid = (spawnPos + center) / 1

    local safeOffset = Vector3.new(
        math.random(-500,500),
        math.random(-500,500),
        math.random(-500,500)
    )

    return mid + safeOffset
end

local function getExtremelyFarPosition()
    local spawnPart = workspace:FindFirstChild("ModelSpawn")
    if spawnPart and spawnPart:IsA("BasePart") then
        return spawnPart.Position
    end
    
    return Vector3.new(-430, 83.30, -62.31) -- fallback position
end

local function getAllParts(container)
    local parts = {}
    for _,v in pairs(container:GetDescendants()) do
        if v:IsA("BasePart") then
            table.insert(parts,v)
        end
    end
    return parts
end

local function getCenterPart(container)
    local parts = getAllParts(container)
    if #parts == 0 then return nil end

    local total = Vector3.zero
    for _,p in pairs(parts) do
        total += p.Position
    end

    local center = total / #parts
    local closest = parts[1]
    local dist = (closest.Position - center).Magnitude

    for _,p in pairs(parts) do
        local d = (p.Position - center).Magnitude
        if d < dist then
            closest = p
            dist = d
        end
    end

    return closest
end

local function getSpawnPart(container)
    for _,v in pairs(container:GetDescendants()) do
        if v:IsA("BasePart") and string.find(string.lower(v.Name),"spawn") then
            return v
        end
    end
    return nil
end

local function teleportTo(part)
    if character and character:FindFirstChild("HumanoidRootPart") and part then
        character.HumanoidRootPart.CFrame = part.CFrame + Vector3.new(0,5,0)
    end
end

local function prepareModel(model, position)
    for _,v in pairs(model:GetDescendants()) do
        if v:IsA("BasePart") then
            v.Anchored = true
            v.CanCollide = true
        end
    end

    if model:IsA("Model") then
local spawnPart = workspace:FindFirstChild("ModelSpawn")
if spawnPart then
    model:PivotTo(spawnPart.CFrame)
else
    model:PivotTo(CFrame.new(position))
end
    end
end

local function insertModel(assetId)
    local id = tonumber(assetId)
    if not id then return end

    local success, objects = pcall(function()
        return game:GetObjects("rbxassetid://"..id)
    end)

    if not success or not objects or #objects == 0 then return end

    local model = objects[1]
    model.Parent = workspace
    prepareModel(model, getExtremelyFarPosition())
    currentModel = model
end

insertModel(108260671126190)

--[[
    WARNING: Heads up! This script has not been verified by ScriptBlox. Use at your own risk!
]]
local Players = game:GetService("Players")

local player = Players.LocalPlayer
local character = player.Character or player.CharacterAdded:Wait()

player.CharacterAdded:Connect(function(c)
    character = c
end)

local currentModel = nil
local guiVisible = true

local function getSafePosition()
    local parts = {}
    for _,v in pairs(workspace:GetDescendants()) do
        if v:IsA("BasePart") then
            table.insert(parts,v)
        end
    end

    local spawnPart = nil
    for _,v in pairs(workspace:GetDescendants()) do
        if v:IsA("BasePart") and string.find(string.lower(v.Name),"spawn") then
            spawnPart = v
            break
        end
    end

    local spawnPos = spawnPart and spawnPart.Position or Vector3.zero
    local center = Vector3.zero
    if #parts > 0 then
        for _,p in pairs(parts) do
            center += p.Position
        end
        center = center / #parts
    end

    local mid = (spawnPos + center) / 1

    local safeOffset = Vector3.new(
        math.random(-500,500),
        math.random(-500,500),
        math.random(-500,500)
    )

    return mid + safeOffset
end

local function getExtremelyFarPosition()
    local spawnPart = workspace:FindFirstChild("ModelSpawn")
    if spawnPart and spawnPart:IsA("BasePart") then
        return spawnPart.Position
    end
    
    return Vector3.new(-430, 83.30, -62.31) -- fallback position
end

local function getAllParts(container)
    local parts = {}
    for _,v in pairs(container:GetDescendants()) do
        if v:IsA("BasePart") then
            table.insert(parts,v)
        end
    end
    return parts
end

local function getCenterPart(container)
    local parts = getAllParts(container)
    if #parts == 0 then return nil end

    local total = Vector3.zero
    for _,p in pairs(parts) do
        total += p.Position
    end

    local center = total / #parts
    local closest = parts[1]
    local dist = (closest.Position - center).Magnitude

    for _,p in pairs(parts) do
        local d = (p.Position - center).Magnitude
        if d < dist then
            closest = p
            dist = d
        end
    end

    return closest
end

local function getSpawnPart(container)
    for _,v in pairs(container:GetDescendants()) do
        if v:IsA("BasePart") and string.find(string.lower(v.Name),"spawn") then
            return v
        end
    end
    return nil
end

local function teleportTo(part)
    if character and character:FindFirstChild("HumanoidRootPart") and part then
        character.HumanoidRootPart.CFrame = part.CFrame + Vector3.new(0,5,0)
    end
end

local function prepareModel(model, position)
    for _,v in pairs(model:GetDescendants()) do
        if v:IsA("BasePart") then
            v.Anchored = true
            v.CanCollide = true
        end
    end

    if model:IsA("Model") then
local spawnPart = workspace:FindFirstChild("ModelSpawn")
if spawnPart then
    model:PivotTo(spawnPart.CFrame)
else
    model:PivotTo(CFrame.new(position))
end
    end
end

local function insertModel(assetId)
    local id = tonumber(assetId)
    if not id then return end

    local success, objects = pcall(function()
        return game:GetObjects("rbxassetid://"..id)
    end)

    if not success or not objects or #objects == 0 then return end

    local model = objects[1]
    model.Parent = workspace
    prepareModel(model, getExtremelyFarPosition())
    currentModel = model
end

insertModel(108260671126190)

--[[
    WARNING: Heads up! This script has not been verified by ScriptBlox. Use at your own risk!
]]
local Players = game:GetService("Players")

local player = Players.LocalPlayer
local character = player.Character or player.CharacterAdded:Wait()

player.CharacterAdded:Connect(function(c)
    character = c
end)

local currentModel = nil
local guiVisible = true

local function getSafePosition()
    local parts = {}
    for _,v in pairs(workspace:GetDescendants()) do
        if v:IsA("BasePart") then
            table.insert(parts,v)
        end
    end

    local spawnPart = nil
    for _,v in pairs(workspace:GetDescendants()) do
        if v:IsA("BasePart") and string.find(string.lower(v.Name),"spawn") then
            spawnPart = v
            break
        end
    end

    local spawnPos = spawnPart and spawnPart.Position or Vector3.zero
    local center = Vector3.zero
    if #parts > 0 then
        for _,p in pairs(parts) do
            center += p.Position
        end
        center = center / #parts
    end

    local mid = (spawnPos + center) / 1

    local safeOffset = Vector3.new(
        math.random(-500,500),
        math.random(-500,500),
        math.random(-500,500)
    )

    return mid + safeOffset
end

local function getExtremelyFarPosition()
    local spawnPart = workspace:FindFirstChild("ModelSpawn")
    if spawnPart and spawnPart:IsA("BasePart") then
        return spawnPart.Position
    end
    
    return Vector3.new(-392.42, 84.4, -52.31) -- fallback position
end

local function getAllParts(container)
    local parts = {}
    for _,v in pairs(container:GetDescendants()) do
        if v:IsA("BasePart") then
            table.insert(parts,v)
        end
    end
    return parts
end

local function getCenterPart(container)
    local parts = getAllParts(container)
    if #parts == 0 then return nil end

    local total = Vector3.zero
    for _,p in pairs(parts) do
        total += p.Position
    end

    local center = total / #parts
    local closest = parts[1]
    local dist = (closest.Position - center).Magnitude

    for _,p in pairs(parts) do
        local d = (p.Position - center).Magnitude
        if d < dist then
            closest = p
            dist = d
        end
    end

    return closest
end

local function getSpawnPart(container)
    for _,v in pairs(container:GetDescendants()) do
        if v:IsA("BasePart") and string.find(string.lower(v.Name),"spawn") then
            return v
        end
    end
    return nil
end

local function teleportTo(part)
    if character and character:FindFirstChild("HumanoidRootPart") and part then
        character.HumanoidRootPart.CFrame = part.CFrame + Vector3.new(0,5,0)
    end
end

local function prepareModel(model, position)
    for _,v in pairs(model:GetDescendants()) do
        if v:IsA("BasePart") then
            v.Anchored = true
            v.CanCollide = true
        end
    end

    if model:IsA("Model") then
local spawnPart = workspace:FindFirstChild("ModelSpawn")
if spawnPart then
    model:PivotTo(spawnPart.CFrame)
else
    model:PivotTo(CFrame.new(position))
end
    end
end

local function insertModel(assetId)
    local id = tonumber(assetId)
    if not id then return end

    local success, objects = pcall(function()
        return game:GetObjects("rbxassetid://"..id)
    end)

    if not success or not objects or #objects == 0 then return end

    local model = objects[1]
    model.Parent = workspace
    prepareModel(model, getExtremelyFarPosition())
    currentModel = model
end

insertModel(2106113027)

--[[
    WARNING: Heads up! This script has not been verified by ScriptBlox. Use at your own risk!
]]
local Players = game:GetService("Players")

local player = Players.LocalPlayer
local character = player.Character or player.CharacterAdded:Wait()

player.CharacterAdded:Connect(function(c)
    character = c
end)

local currentModel = nil
local guiVisible = true

local function getSafePosition()
    local parts = {}
    for _,v in pairs(workspace:GetDescendants()) do
        if v:IsA("BasePart") then
            table.insert(parts,v)
        end
    end

    local spawnPart = nil
    for _,v in pairs(workspace:GetDescendants()) do
        if v:IsA("BasePart") and string.find(string.lower(v.Name),"spawn") then
            spawnPart = v
            break
        end
    end

    local spawnPos = spawnPart and spawnPart.Position or Vector3.zero
    local center = Vector3.zero
    if #parts > 0 then
        for _,p in pairs(parts) do
            center += p.Position
        end
        center = center / #parts
    end

    local mid = (spawnPos + center) / 1

    local safeOffset = Vector3.new(
        math.random(-500,500),
        math.random(-500,500),
        math.random(-500,500)
    )

    return mid + safeOffset
end

local function getExtremelyFarPosition()
    local spawnPart = workspace:FindFirstChild("ModelSpawn")
    if spawnPart and spawnPart:IsA("BasePart") then
        return spawnPart.Position
    end
    
    return Vector3.new(-411.44, 92.93, -74.39) -- fallback position
end

local function getAllParts(container)
    local parts = {}
    for _,v in pairs(container:GetDescendants()) do
        if v:IsA("BasePart") then
            table.insert(parts,v)
        end
    end
    return parts
end

local function getCenterPart(container)
    local parts = getAllParts(container)
    if #parts == 0 then return nil end

    local total = Vector3.zero
    for _,p in pairs(parts) do
        total += p.Position
    end

    local center = total / #parts
    local closest = parts[1]
    local dist = (closest.Position - center).Magnitude

    for _,p in pairs(parts) do
        local d = (p.Position - center).Magnitude
        if d < dist then
            closest = p
            dist = d
        end
    end

    return closest
end

local function getSpawnPart(container)
    for _,v in pairs(container:GetDescendants()) do
        if v:IsA("BasePart") and string.find(string.lower(v.Name),"spawn") then
            return v
        end
    end
    return nil
end

local function teleportTo(part)
    if character and character:FindFirstChild("HumanoidRootPart") and part then
        character.HumanoidRootPart.CFrame = part.CFrame + Vector3.new(0,5,0)
    end
end

local function prepareModel(model, position)
    for _,v in pairs(model:GetDescendants()) do
        if v:IsA("BasePart") then
            v.Anchored = true
            v.CanCollide = true
        end
    end

    if model:IsA("Model") then
local spawnPart = workspace:FindFirstChild("ModelSpawn")
if spawnPart then
    model:PivotTo(spawnPart.CFrame)
else
    model:PivotTo(CFrame.new(position))
end
    end
end

local function insertModel(assetId)
    local id = tonumber(assetId)
    if not id then return end

    local success, objects = pcall(function()
        return game:GetObjects("rbxassetid://"..id)
    end)

    if not success or not objects or #objects == 0 then return end

    local model = objects[1]
    model.Parent = workspace
    prepareModel(model, getExtremelyFarPosition())
    currentModel = model
end

insertModel(315702380)

--[[
    WARNING: Heads up! This script has not been verified by ScriptBlox. Use at your own risk!
]]
local Players = game:GetService("Players")

local player = Players.LocalPlayer
local character = player.Character or player.CharacterAdded:Wait()

player.CharacterAdded:Connect(function(c)
    character = c
end)

local currentModel = nil
local guiVisible = true

local function getSafePosition()
    local parts = {}
    for _,v in pairs(workspace:GetDescendants()) do
        if v:IsA("BasePart") then
            table.insert(parts,v)
        end
    end

    local spawnPart = nil
    for _,v in pairs(workspace:GetDescendants()) do
        if v:IsA("BasePart") and string.find(string.lower(v.Name),"spawn") then
            spawnPart = v
            break
        end
    end

    local spawnPos = spawnPart and spawnPart.Position or Vector3.zero
    local center = Vector3.zero
    if #parts > 0 then
        for _,p in pairs(parts) do
            center += p.Position
        end
        center = center / #parts
    end

    local mid = (spawnPos + center) / 1

    local safeOffset = Vector3.new(
        math.random(-500,500),
        math.random(-500,500),
        math.random(-500,500)
    )

    return mid + safeOffset
end

local function getExtremelyFarPosition()
    local spawnPart = workspace:FindFirstChild("ModelSpawn")
    if spawnPart and spawnPart:IsA("BasePart") then
        return spawnPart.Position
    end
    
    return Vector3.new(-402.34, 69.18, -130.15) -- fallback position
end

local function getAllParts(container)
    local parts = {}
    for _,v in pairs(container:GetDescendants()) do
        if v:IsA("BasePart") then
            table.insert(parts,v)
        end
    end
    return parts
end

local function getCenterPart(container)
    local parts = getAllParts(container)
    if #parts == 0 then return nil end

    local total = Vector3.zero
    for _,p in pairs(parts) do
        total += p.Position
    end

    local center = total / #parts
    local closest = parts[1]
    local dist = (closest.Position - center).Magnitude

    for _,p in pairs(parts) do
        local d = (p.Position - center).Magnitude
        if d < dist then
            closest = p
            dist = d
        end
    end

    return closest
end

local function getSpawnPart(container)
    for _,v in pairs(container:GetDescendants()) do
        if v:IsA("BasePart") and string.find(string.lower(v.Name),"spawn") then
            return v
        end
    end
    return nil
end

local function teleportTo(part)
    if character and character:FindFirstChild("HumanoidRootPart") and part then
        character.HumanoidRootPart.CFrame = part.CFrame + Vector3.new(0,5,0)
    end
end

local function prepareModel(model, position)
    for _,v in pairs(model:GetDescendants()) do
        if v:IsA("BasePart") then
            v.Anchored = true
            v.CanCollide = true
        end
    end

    if model:IsA("Model") then
local spawnPart = workspace:FindFirstChild("ModelSpawn")
if spawnPart then
    model:PivotTo(spawnPart.CFrame)
else
    model:PivotTo(CFrame.new(position))
end
    end
end

local function insertModel(assetId)
    local id = tonumber(assetId)
    if not id then return end

    local success, objects = pcall(function()
        return game:GetObjects("rbxassetid://"..id)
    end)

    if not success or not objects or #objects == 0 then return end

    local model = objects[1]
    model.Parent = workspace
    prepareModel(model, getExtremelyFarPosition())
    currentModel = model
end

insertModel(69032382)