extends Control

const SAMPLE := "res://sample/the-last-train-game.zip"

var package: ZIPReader
var panels: Array[Dictionary] = []
var current := 0

@onready var comic_title: Label = %ComicTitle
@onready var status: Label = %Status
@onready var panel_image: TextureRect = %PanelImage
@onready var dialogue: RichTextLabel = %Dialogue
@onready var position_label: Label = %Position
@onready var previous: Button = %Previous
@onready var next: Button = %Next
@onready var picker: FileDialog = %PackagePicker


func _ready() -> void:
	%OpenZip.pressed.connect(func() -> void: picker.popup_centered())
	picker.file_selected.connect(open_package)
	previous.pressed.connect(func() -> void: show_panel(current - 1))
	next.pressed.connect(func() -> void: show_panel(current + 1))

	var args := OS.get_cmdline_user_args()
	open_package(SAMPLE if args.is_empty() else args[0])


func _input(event: InputEvent) -> void:
	if not event is InputEventKey or picker.visible:
		return
	if event.is_action_pressed("ui_left"):
		show_panel(current - 1)
	elif event.is_action_pressed("ui_right"):
		show_panel(current + 1)
	else:
		return
	get_viewport().set_input_as_handled()


func open_package(path: String) -> void:
	var candidate := ZIPReader.new()
	if candidate.open(path) != OK:
		set_status("Could not open %s." % path.get_file())
		return
	if not candidate.file_exists("manifest.json"):
		candidate.close()
		set_status("This ZIP has no manifest.json. Choose an Inkflo game package.")
		return

	var json := JSON.new()
	if json.parse(candidate.read_file("manifest.json").get_string_from_utf8()) != OK:
		candidate.close()
		set_status("The package's manifest.json could not be read.")
		return
	var manifest: Variant = json.data
	if not manifest is Dictionary or manifest.get("format") != "inkflo-game" or manifest.get("version") != 1 or not manifest.get("pages") is Array:
		candidate.close()
		set_status("This reader expects an Inkflo game package with a version 1 manifest.")
		return

	var entries: Array[Dictionary] = []
	for page in manifest.pages:
		for panel in page.panels:
			entries.append({"page": page, "panel": panel})
	if entries.is_empty():
		candidate.close()
		set_status("This package contains no panels.")
		return

	if package != null:
		package.close()
	package = candidate
	panels = entries
	comic_title.text = manifest.get("title", "Untitled comic")
	show_panel(0)


func show_panel(index: int) -> void:
	if index < 0 or index >= panels.size():
		return
	current = index
	var entry := panels[index]
	var page: Dictionary = entry.page
	var panel: Dictionary = entry.panel
	position_label.text = "Page %d · Panel %d    (%d of %d)" % [
		page.number, panel.number, index + 1, panels.size()
	]
	previous.disabled = index == 0
	next.disabled = index == panels.size() - 1

	var image := Image.new()
	var file: String = panel.image
	if package.file_exists(file) and image.load_png_from_buffer(package.read_file(file)) == OK:
		panel_image.texture = ImageTexture.create_from_image(image)
		set_status("")
	else:
		panel_image.texture = null
		set_status("Could not load %s." % file)

	var lines: Array = panel.lines
	if lines.is_empty():
		lines = page.balloons.filter(func(balloon: Dictionary) -> bool: return balloon.panel == panel.number)
	var text := PackedStringArray()
	for line in lines:
		text.append(line.text if line.speaker == null else "%s: %s" % [line.speaker, line.text])
	dialogue.text = "\n".join(text)
	dialogue.scroll_to_line(0)


func set_status(message: String) -> void:
	status.text = message
	status.visible = not message.is_empty()
