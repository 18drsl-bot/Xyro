local Players = game:GetService("Players")
local UserInputService = game:GetService("UserInputService")

local speaker = Players.LocalPlayer
local mouse = speaker:GetMouse()

local function getRoot(character)
    if not character then return nil end
    return character:FindFirstChild("HumanoidRootPart")
end

local function breakVelocity()
    local root = getRoot(speaker.Character)
    if root then
        root.AssemblyLinearVelocity = Vector3.zero
        root.AssemblyAngularVelocity = Vector3.zero
    end
end

local TpTool = Instance.new("Tool")
TpTool.Name = "Teleport Tool"
TpTool.RequiresHandle = false
TpTool.CanBeDropped = false
TpTool.Parent = speaker:WaitForChild("Backpack")

TpTool.Activated:Connect(function()
    local root = getRoot(speaker.Character)
    if not root then return end

    local hit = mouse.Hit
    if not hit then return end

    local pos = hit.Position

    root.CFrame = CFrame.new(
        pos.X,
        pos.Y + 3,
        pos.Z,
        select(4, root.CFrame:GetComponents())
    )

    breakVelocity()
end)