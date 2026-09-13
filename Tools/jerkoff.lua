local P=game:GetService("Players").LocalPlayer
local H=P.Character:FindFirstChildWhichIsA("Humanoid")
local B=P:FindFirstChildWhichIsA("Backpack")
if not H or not B then return end
local function R()
    local h=P.Character and P.Character:FindFirstChildOfClass("Humanoid")
    return h and h.RigType==Enum.HumanoidRigType.R15
end
local T=Instance.new("Tool")
T.Name="Jerk Off"
T.ToolTip='in the stripped club. straight up "jorking it". and by "it", haha, well. lets just say. My peanits.'
T.RequiresHandle=false
T.Parent=B
local J,A=false,nil
local function S()
    J=false
    if A then A:Stop();A=nil end
end
T.Equipped:Connect(function()J=true end)
T.Unequipped:Connect(S)
H.Died:Connect(S)
while task.wait() do
    if J then
        local r=R()
        if not A then
            local a=Instance.new("Animation")
            a.AnimationId=r and "rbxassetid://698251653" or "rbxassetid://72042024"
            A=H:LoadAnimation(a)
        end
        A:Play()
        A:AdjustSpeed(r and .7 or .65)
        A.TimePosition=.6
        task.wait(.1)
        while A and A.TimePosition<(r and .7 or .65) do task.wait(.1) end
        if A then A:Stop();A=nil end
    end
end