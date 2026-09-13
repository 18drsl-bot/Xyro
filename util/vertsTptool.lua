local Players = game:GetService("Players")
local UserInputService = game:GetService("UserInputService")
local player = Players.LocalPlayer
local mouse = player:GetMouse()
local VERTICAL_OFFSET = 3

local function isValidTeleportPosition(targetPart, targetPosition)
    if not targetPart then
        return false
    end
    if targetPart.Transparency >= 1 and targetPart.CanCollide then
        return false
    end
    if targetPosition.Y < -100 then
        return false
    end
    return true
end

local function teleport()
    local character = player.Character
    if not character then return end
    local humanoid = character:FindFirstChildOfClass("Humanoid")
    local rootPart = character:FindFirstChild("HumanoidRootPart")
    
    if not humanoid or humanoid.Health <= 0 or not rootPart then return end
    
    local target = mouse.Hit
    local targetPart = mouse.Target
    
    if not target then return end
    if not isValidTeleportPosition(targetPart, target.Position) then return end
    
    local teleportPosition = target.Position + Vector3.new(0, VERTICAL_OFFSET, 0)
    rootPart.CFrame = CFrame.new(teleportPosition)
end

UserInputService.InputBegan:Connect(function(input, gameProcessed)
    if gameProcessed then return end
    
    if input.KeyCode == Enum.KeyCode.R then
        if UserInputService:IsKeyDown(Enum.KeyCode.LeftControl) or UserInputService:IsKeyDown(Enum.KeyCode.RightControl) then
            teleport()
        end
    end
end) 