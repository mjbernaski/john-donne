#!/usr/bin/env python3
"""Give the background server an app identity for macOS permission prompts.

This copies only the small Python executable, leaving Homebrew's installation
unchanged. The copied executable still uses the installed Python framework.
Rebuild after upgrading Python, then re-register the app and reload the agent.
"""

import plistlib
import shutil
import subprocess
from pathlib import Path


def main():
    source = Path(
        "/usr/local/opt/python@3.10/Frameworks/Python.framework/Versions/3.10/"
        "Resources/Python.app/Contents/MacOS/Python"
    )
    app = Path(__file__).resolve().parent / "Poetry Server.app"
    executable = app / "Contents/MacOS/PoetryServer"
    executable.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(source, executable)
    (app / "Contents/Info.plist").write_bytes(plistlib.dumps({
        "CFBundleIdentifier": "com.johndonne.poetry-server",
        "CFBundleName": "Poetry Server",
        "CFBundleDisplayName": "Poetry Server",
        "CFBundleExecutable": "PoetryServer",
        "CFBundlePackageType": "APPL",
        "CFBundleVersion": "1",
        "LSUIElement": True,
        "NSLocalNetworkUsageDescription": (
            "Poetry Server connects to your local model servers for Discuss, "
            "illustrations, and narration."
        ),
    }))
    subprocess.run(["codesign", "--force", "--sign", "-", str(app)], check=True)
    print(f"Built {app}")


if __name__ == "__main__":
    main()
