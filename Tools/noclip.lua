local P = game:GetService("Players").LocalPlayer
local R = game:GetService("RunService")
local S = game:GetService("StarterGui")

local N = false
local C
local savedCollision = {}

local function T(t)
    pcall(S.SetCore, S, "SendNotification", {
        Title = "Noclip Tool",
        Text = t,
        Duration = 3,
    })
end

local function restoreCollision()
    for part, canCollide in pairs(savedCollision) do
        if part and part.Parent and part:IsA("BasePart") then
            part.CanCollide = canCollide
        end
    end
    table.clear(savedCollision)
end

local function disableNoclip()
    N = false
    if C then
        C:Disconnect()
        C = nil
    end
    restoreCollision()
end

local function enableNoclip(character)
    disableNoclip()

    if not character then
        return
    end

    N = true
    C = R.Stepped:Connect(function()
        if not N or not character.Parent then
            disableNoclip()
            return
        end

        for _, v in ipairs(character:GetDescendants()) do
            if v:IsA("BasePart") then
                if savedCollision[v] == nil then
                    savedCollision[v] = v.CanCollide
                end
                v.CanCollide = false
            end
        end
    end)

    T("Noclip Enabled")
end

local function G()
    local B = P:WaitForChild("Backpack")
    local old = B:FindFirstChild("Noclip Tool")
    if old then
        old:Destroy()
    end

    local X = Instance.new("Tool")
    X.Name = "Noclip Tool"
    X.RequiresHandle = false
    X.CanBeDropped = false
    X.Parent = B

    X.Activated:Connect(function()
        local H = P.Character
        if not H then
            T("No character")
            return
        end

        if N then
            disableNoclip()
            T("Noclip Disabled")
        else
            enableNoclip(H)
        end
    end)
end

if P.Character then
    G()
end

P.CharacterAdded:Connect(function()
    disableNoclip()
    task.wait(0.2)
    G()
end)
