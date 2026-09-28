"""
Build RakshaSetu-Admin.exe: a single-file Windows app for the admin console.

Usage:
    python build.py [--wv2 <unpacked Microsoft.Web.WebView2 nupkg dir>] [--out <dir>]

Needs only what ships with Windows plus the WebView2 SDK package:
  - C# compiler from .NET Framework 4.8 (csc.exe)
  - Microsoft.Web.WebView2 NuGet package, unpacked (default: ./wv2)
  - Pillow (for the icon)
"""
import argparse
import os
import shutil
import subprocess
import sys
import zipfile

from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
DASHBOARD = os.path.join(HERE, '..', 'dashboard')
CSC = r'C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe'
FW = r'C:\Windows\Microsoft.NET\Framework64\v4.0.30319'


def make_web_zip(path):
    """Admin console + the pages it links to (index.html for "Live Perception")."""
    with zipfile.ZipFile(path, 'w', zipfile.ZIP_DEFLATED) as z:
        for name in ('admin.html', 'index.html'):
            z.write(os.path.join(DASHBOARD, name), name)
        for folder in ('src', 'styles'):
            base = os.path.join(DASHBOARD, folder)
            for dirpath, _, files in os.walk(base):
                for f in files:
                    full = os.path.join(dirpath, f)
                    z.write(full, os.path.relpath(full, DASHBOARD).replace(os.sep, '/'))


def make_icon(path):
    """Dark tile, road with lane dashes, LiDAR arcs, amber (admin) accent."""
    size = 256
    img = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    s = size / 108.0
    d.rounded_rectangle([10 * s, 10 * s, 98 * s, 98 * s], radius=10 * s, fill=(3, 6, 12, 255))
    amber = (245, 158, 11, 255)
    for r in (24, 34):
        d.arc([(54 - r) * s, (80 - r) * s, (54 + r) * s, (80 + r) * s], 180, 360, fill=amber, width=int(3 * s))
    d.polygon([(46 * s, 96 * s), (50 * s, 26 * s), (58 * s, 26 * s), (62 * s, 96 * s)], fill=(27, 37, 48, 255))
    for y0, y1 in ((81, 90), (66, 74), (51, 58)):
        d.rectangle([53.3 * s, y0 * s, 54.7 * s, y1 * s], fill=(250, 204, 21, 255))
    d.rectangle([49 * s, 86 * s, 59 * s, 94 * s], fill=amber)
    d.polygon([(54 * s, 20 * s), (58 * s, 27 * s), (50 * s, 27 * s)], fill=amber)
    img.save(path, sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--wv2', default=os.path.join(HERE, 'wv2'))
    ap.add_argument('--out', default=os.path.join(HERE, 'dist'))
    args = ap.parse_args()

    lib = os.path.join(args.wv2, 'lib', 'net462')
    loader = os.path.join(args.wv2, 'runtimes', 'win-x64', 'native', 'WebView2Loader.dll')
    for p in (CSC, os.path.join(lib, 'Microsoft.Web.WebView2.Core.dll'), loader):
        if not os.path.exists(p):
            sys.exit('Missing: ' + p)

    work = os.path.join(HERE, 'obj')
    shutil.rmtree(work, ignore_errors=True)
    os.makedirs(work)
    os.makedirs(args.out, exist_ok=True)
    web_zip = os.path.join(work, 'www.zip')
    icon = os.path.join(work, 'app.ico')
    make_web_zip(web_zip)
    make_icon(icon)

    core = os.path.join(lib, 'Microsoft.Web.WebView2.Core.dll')
    winforms = os.path.join(lib, 'Microsoft.Web.WebView2.WinForms.dll')
    out_exe = os.path.join(args.out, 'RakshaSetu-Admin.exe')
    cmd = [
        CSC, '/nologo', '/target:winexe', '/platform:x64', '/optimize+',
        '/out:' + out_exe, '/win32icon:' + icon,
        '/r:' + core, '/r:' + winforms,
        '/r:' + os.path.join(FW, 'System.IO.Compression.dll'),
        '/r:' + os.path.join(FW, 'System.IO.Compression.FileSystem.dll'),
        '/r:System.Windows.Forms.dll', '/r:System.Drawing.dll',
        '/resource:' + web_zip + ',www.zip',
        '/resource:' + icon + ',app.ico',
        '/resource:' + core + ',Microsoft.Web.WebView2.Core.dll',
        '/resource:' + winforms + ',Microsoft.Web.WebView2.WinForms.dll',
        '/resource:' + loader + ',WebView2Loader.dll',
        os.path.join(HERE, 'Program.cs'),
    ]
    subprocess.run(cmd, check=True)
    print('Built', out_exe, os.path.getsize(out_exe), 'bytes')


if __name__ == '__main__':
    main()
