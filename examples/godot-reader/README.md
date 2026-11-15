# Inkflo game export test in Godot

1. Open `project.godot` in Godot 4.4 or later and press **F5**. *The Last Train* loads automatically.
2. In Inkflo, open a comic and go to **Export → Export files → Apps & games → Game engine package (.zip)**. Export at 1024 px for a quick test.
3. In Godot, click **Open ZIP…** and pick the exported file. Use **Previous**, **Next**, or the arrow keys to step through panels.

The reader uses the manifest's page and panel order and draws each PNG with its transparency. It shows the Script dialogue below the image and uses the panel's balloons where Script has no lines. This test reads dialogue from the manifest, so it requires no Yarn Spinner or Ink plugin.

You can also pass a ZIP on launch with `godot --path . -- "C:/path/to/my-comic-game.zip"`.

The bundled sample is a 1024 px export of Inkflo's **Open starter comic** example with both dialogue formats selected.
