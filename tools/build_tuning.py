"""Build version-specific patches against the user's exported merged sources.

Never modify original packages, decrypt modpacks, or ship original game passages.
"""
from pathlib import Path
import json
import re
import zipfile

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "src" / "custom-tuning"
EXPORT = ROOT / "MOD" / "Degrees-of Lewdity_ExportData_20261110_211457.zip"
VERSION = "0.2.0"

# Appearance-only interactions; do not indiscriminately patch all 802 level checks.
REACTIONS = [
    "Widgets Nicknames", "Widgets Speech", "Widgets speech-Avery",
    "Widgets speech-GWYLAN", "Widgets Sydney", "Bully Pat",
    "Street Transformation Picture", "Hallways Transformation Petting Agree",
    "Deadwood Reblooms Sydney Dorm", "Gwylan Talk TF Revealed",
    "Gwylan Talk TF Revealed 2", "Gwylan Talk TF Revealed Confront",
    "Gwylan Talk TF Revealed Tail 2"
]
ANIMAL_KEYS = {"wolfgirl": "wolf", "cat": "cat", "cow": "cow", "harpy": "bird", "fox": "fox"}


def build():
    with zipfile.ZipFile(EXPORT) as archive:
        js = {Path(n).name: archive.read(n).decode("utf-8-sig") for n in archive.namelist() if n.startswith("js/") and n.endswith(".js")}
        passages = {n[8:-5]: archive.read(n).decode("utf-8-sig") for n in archive.namelist() if n.startswith("passage/") and n.endswith(".twee")}
    patches = []
    checks = []

    def patch(filename, old, new, expected=1):
        actual = js[filename].count(old)
        if actual != expected:
            raise ValueError(f"{filename}: expected {expected} match(es), found {actual}: {old}")
        patches.append({"fileName": filename, "from": old, "to": new})
        js[filename] = js[filename].replace(old, new)
        checks.append({"file": filename, "matches": actual, "target": old})

    patch("time.js", "V.willpower *= 0.99;", 'V.willpower = window.DOLmodTuning?.natural("willpower", V.willpower, V.willpower * 0.99) ?? V.willpower * 0.99;')
    for name in ["physique", "exhibitionism", "promiscuity", "deviancy"]:
        pattern = re.compile(r"V\." + name + r" = (Math\.max\([^;\n]+\));")
        matches = list(pattern.finditer(js["time.js"]))
        expected = 2 if name == "physique" else 1
        if len(matches) != expected:
            raise ValueError(f"Unexpected {name} decline count: {len(matches)}")
        for match in matches:
            expression = match.group(1)
            patch("time.js", match.group(), f'V.{name} = window.DOLmodTuning?.natural("{name}", V.{name}, {expression}) ?? {expression};')
    patch("time.js", 'statChange.skill("beauty", 100 - (V.trauma / V.traumamax) * 200);', 'statChange.skill("beauty", window.DOLmodTuning?.amount("beauty", 100 - (V.trauma / V.traumamax) * 200) ?? (100 - (V.trauma / V.traumamax) * 200));')
    patch("time.js", "statChange.purity(dailyPurity);", 'statChange.purity(window.DOLmodTuning?.amount("purity", dailyPurity) ?? dailyPurity);')
    patch("time.js", "statChange.purity(scarPurity);", 'statChange.purity(window.DOLmodTuning?.amount("purity", scarPurity) ?? scarPurity);')
    patch("ingame.js", "return tfParts;", "return window.DOLmodTuning?.filterVisible(tfParts) ?? tfParts;")
    # The framework itself still has native validation reporting two animals as
    # an error. Gate only that obsolete error, not validation of parts/traits.
    patch("ingame.js", "if (physTFs.length >= 2)", "if (physTFs.length >= 2 && !window.DOLmodTuning?.config().coexist)")

    twee = []
    reaction_checks = []
    for name in REACTIONS:
        content = passages[name]
        tags = re.findall(r"<<(?:if|elseif|switch)\s+[^>]*>>", content)
        for old in dict.fromkeys(tags):
            new = re.sub(r"\$(wolfgirl|cat|cow|harpy|fox)\b", lambda m: f'window.DOLmodTuning.appearanceLevel("{ANIMAL_KEYS[m[1]]}")', old)
            if new == old:
                continue
            twee.append({"passage": name, "findString": old, "replace": new, "all": True})
            reaction_checks.append({"passage": name, "matches": content.count(old), "target": old})

    sidebar_anchor = '<div id="overlayButtons">'
    if passages["StoryCaption"].count(sidebar_anchor) != 1:
        raise ValueError("StoryCaption sidebar anchor must match exactly once")
    sidebar_button = '\n\t\t\t<<button "转化与属性设置">><<run window.DOLmodTuning.openSettings()>><</button>>'
    twee.append({"passage": "StoryCaption", "findString": sidebar_anchor, "replace": sidebar_anchor + sidebar_button})

    boot = {
        "name": "Animal-Coexistence-Stat-Guard",
        "nickName": {"cn": "动物转化共存与属性保护（实验版）", "en": "Animal Coexistence & Stat Guard (Experimental)"},
        "version": VERSION,
        "scriptFileList": ["scripts/tuning.js"], "styleFileList": [], "tweeFileList": [], "imgFileList": [],
        "additionFile": ["README.txt", "patch-validation.json"],
        "addonPlugin": [
            {"modName": "ReplacePatcher", "addonName": "ReplacePatcherAddon", "modVersion": ">=1.3.0", "params": {"js": patches}},
            {"modName": "TweeReplacer", "addonName": "TweeReplacerAddon", "modVersion": ">=1.7.0", "params": twee}
        ],
        "dependenceInfo": [
            {"modName": "ModLoader", "version": ">=2.101.1"},
            {"modName": "GameVersion", "version": "=0.5.12.13"},
            {"modName": "maplebirch", "version": "=5.6.2"},
            {"modName": "deadwood-reblooms", "version": "=2.5.8"},
            {"modName": "ReplacePatcher", "version": ">=1.3.0"},
            {"modName": "TweeReplacer", "version": ">=1.7.0"}
        ]
    }
    report = {
        "version": VERSION, "sourceExport": EXPORT.name,
        "jsPatches": checks, "reactionPatches": reaction_checks,
        "jsPatchCount": len(checks), "reactionPatchCount": len(reaction_checks),
        "sidebarPatchCount": 1, "totalTweePatchCount": len(twee),
        "reactionPassages": REACTIONS,
        "scope": "Static match and syntax validation only. Not a claim of live-game compatibility. Reactions outside this list may still use raw levels."
    }
    dest = ROOT / "dist" / f"Animal-Coexistence-Stat-Guard-{VERSION}.mod.zip"
    dest.parent.mkdir(exist_ok=True)
    with zipfile.ZipFile(dest, "w", zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("boot.json", json.dumps(boot, ensure_ascii=False, indent=2))
        archive.writestr("patch-validation.json", json.dumps(report, ensure_ascii=False, indent=2))
        for name in ["scripts/tuning.js", "README.txt"]:
            archive.write(SOURCE / name, name)
    validate = ROOT / "work" / "validation"
    validate.mkdir(exist_ok=True, parents=True)
    for name in ["time.js", "ingame.js"]:
        (validate / name).write_text(js[name], encoding="utf-8")
    (validate / "patch-validation.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    with zipfile.ZipFile(dest) as archive:
        assert archive.testzip() is None
    print(json.dumps({"output": str(dest), "jsPatches": len(checks), "reactionPatches": len(reaction_checks), "sidebarPatches": 1}, ensure_ascii=True))


if __name__ == "__main__":
    build()
