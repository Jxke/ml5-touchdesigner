op = me.parent()

# ML5
customPageList = op.customPages
for i in range(len(customPageList)):
    if(customPageList[i] == "ML5"):
        op.customPages[i].destroy()

ml5Page = op.appendCustomPage("ML5")

## Auto Port
p = ml5Page.appendToggle("Autoport", label="Auto Port", order=None, replace=True)
p.default = 1
p.val = 1

## ML5 Port
p = ml5Page.appendInt("Ml5port", label="ML5 Port", size=1, order=None, replace=True)
p.min = 1
p.clampMin = True

p.max = 65535
p.clampMax = True

p.default = 9981
p.val = 9981

## Webcam
p = ml5Page.appendMenu("Webcam", label="Webcam", order=None, replace=True)
p.menuSource = "tdu.TableMenu(me.findChildren(name='webcam_menu')[0])"
p.default = False
p.val = False

## Flip Webcam
p = ml5Page.appendToggle("Wflip", label="Flip Webcam", order=None, replace=True)
p.default = 0
p.val = 0

## Show Overlays
p = ml5Page.appendToggle("Showoverlays", label="Show Overlays", order=None, replace=True)
p.default = 1
p.val = 1

## Reset
p = ml5Page.appendPulse("Reset", label="Reset", order=None, replace=True)

## Sort
ml5Page.sort("Autoport", "Ml5port", "Webcam", "Wflip", "Showoverlays", "Reset")

# Sort
op.sortCustomPages("ML5")
