#!/usr/bin/env python3
"""Give the background server an app identity for macOS permission prompts.

This copies only the small Python executable, leaving Homebrew's installation
unchanged. The copied executable still uses the installed Python framework.
Requires an Apple-issued signing identity; ad hoc signing is not supported.
Unchanged builds preserve the app. Changed builds retain a rollback copy.
Rebuild after upgrading Python, then re-register the app and reload the agent.
"""

import argparse
import hashlib
import json
import os
import plistlib
import shutil
import subprocess
import tempfile
from pathlib import Path


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--identity', default=os.environ.get('POETRY_SIGNING_IDENTITY'),
                        help='Apple Development or Developer ID Application certificate name or SHA-1')
    args = parser.parse_args()
    if not args.identity or args.identity == '-':
        parser.error('An Apple-issued signing identity is required. Run security find-identity -v -p codesigning. The installed app has not been changed.')
    source = Path(
        "/usr/local/opt/python@3.10/Frameworks/Python.framework/Versions/3.10/"
        "Resources/Python.app/Contents/MacOS/Python"
    )
    app = Path(__file__).resolve().parent / "Poetry Server.app"
    info = plistlib.dumps({
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
    })
    recipe = {'source_sha256': hashlib.sha256(source.read_bytes()).hexdigest(),
              'info_sha256': hashlib.sha256(info).hexdigest(), 'identity': args.identity}
    receipt = Path('Contents/Resources/build.json')
    # Apple trust anchor prevents accepting a self-signed or ad hoc replacement.
    requirement = 'anchor apple generic and identifier "com.johndonne.poetry-server"'

    def verify(bundle):
        subprocess.run(['codesign', '--verify', '--strict', '-R=' + requirement, str(bundle)], check=True)

    if (app / receipt).exists() and json.loads((app / receipt).read_text()) == recipe:
        verify(app)
        print(f'Already current; preserved app identity: {app}')
        return

    # Signing and validation happen before moving the installed app.
    with tempfile.TemporaryDirectory(prefix='poetry-build-', dir=app.parent) as temporary:
        staged = Path(temporary) / app.name
        executable = staged / 'Contents/MacOS/PoetryServer'
        executable.parent.mkdir(parents=True)
        shutil.copy2(source, executable)
        (staged / 'Contents/Info.plist').write_bytes(info)
        (staged / receipt).parent.mkdir(parents=True)
        (staged / receipt).write_text(json.dumps(recipe, sort_keys=True) + '\n')
        subprocess.run(['codesign', '--force', '--sign', args.identity, str(staged)], check=True)
        verify(staged)
        backup = app.with_name('Poetry Server.previous.app')
        if backup.exists():
            raise SystemExit(f'Previous app backup already exists: {backup}. Archive it before rebuilding.')
        existed = app.exists()
        if existed:
            app.rename(backup)
        try:
            staged.rename(app)
        except OSError:
            if existed:
                backup.rename(app)
            raise
    print(f'Built and verified {app}')
    print('Register the app with lsregister, then reload its launch agent. Local Network approval may be required.')


if __name__ == "__main__":
    main()
