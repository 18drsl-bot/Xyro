local P,R,S=game:GetService("Players").LocalPlayer,game:GetService("RunService"),game:GetService("StarterGui")
local N,C

local function T(t)
	pcall(S.SetCore,S,"SendNotification",{Title="Noclip Tool",Text=t,Duration=3})
end

local function G()
	local B=P:WaitForChild("Backpack")
	if B:FindFirstChild("Noclip Tool") then B["Noclip Tool"]:Destroy() end
	local X=Instance.new("Tool")
	X.Name="Noclip Tool"
	X.RequiresHandle=false
	X.CanBeDropped=false
	X.Parent=B
	X.Activated:Connect(function()
		local H=P.Character
		if not H then return end
		N=not N
		if C then C:Disconnect() end
		if N then
			C=R.Stepped:Connect(function()
				for _,v in ipairs(H:GetDescendants()) do
					if v:IsA("BasePart") then
						v.CanCollide=false
					end
				end
			end)
			T("Noclip Enabled")
		else
			for _,v in ipairs(H:GetDescendants()) do
				if v:IsA("BasePart") then
					v.CanCollide=true
				end
			end
			T("Noclip Disabled")
		end
	end)
end

if P.Character then G() end
P.CharacterAdded:Connect(function()
	N=false
	if C then C:Disconnect() end
	task.wait(.2)
	G()
end)