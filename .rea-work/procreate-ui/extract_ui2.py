"""Extract a second UI subset: the chrome documents omitted by the first 64-document decode.

Scope is deliberate: the canvas chrome, popover menus, gallery/library, gesture settings and
pointer/pencil button list. Standard library only; nothing is executed.
"""
import os
import shutil
import zipfile

IPA = r"D:\Downloads\Misc\Compressed\Procreate_5.4.9_Pro.ipa"
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "ui-subset2")
PREFIX = "Payload/Procreate.app/"

WANT = (
    "NotificationBar.nib",
    "ShiftingToolbarView.nib",
    "SelectionToolbarFeatherPopover.nib",
    "StylusButtonListView.nib",
    "ReferenceMediaView.nib",
    "Timelapse.nib",
    "GestureControls.storyboardc/",
    "ProLibrary.storyboardc/",
    "ProLibraryPocket.storyboardc/",
    "Preview.storyboardc/",
    "ProMenuOldResources.bundle/",
    "ProContextMenuOldResources.bundle/",
    "ProControlsDeprecatedResources.bundle/",
    "LayersResources.bundle/Layers.storyboardc/",
    "LayersResources.bundle/Layers.Cell.Layer.nib",
    "LayersResources.bundle/Layers.Cell.Group.nib",
    "LayersResources.bundle/Layers.Applicable.Blend.nib",
    "Info.plist",
)


def main() -> int:
    if os.path.isdir(OUT):
        shutil.rmtree(OUT)
    os.makedirs(OUT)
    n = 0
    with zipfile.ZipFile(IPA) as z:
        for info in z.infolist():
            if not info.filename.startswith(PREFIX):
                continue
            rel = info.filename[len(PREFIX):]
            if not any(w in rel for w in WANT):
                continue
            if not (rel.endswith(".nib") or rel.endswith("Info.plist")):
                continue
            target = os.path.join(OUT, info.filename.replace("/", os.sep))
            os.makedirs(os.path.dirname(target), exist_ok=True)
            with z.open(info) as src, open(target, "wb") as dst:
                shutil.copyfileobj(src, dst)
            n += 1
    print(f"extracted {n} members into {OUT}")
    return 0


if __name__ == "__main__":
    main()
