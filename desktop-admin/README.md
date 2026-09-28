# RakshaSetu Admin Console — Windows app

Builds `RakshaSetu-Admin.exe`, a single-file Windows app that shows the admin
console (`../dashboard/admin.html`) in an embedded Microsoft Edge WebView2.

- One exe, no installer, works offline. The admin web files, the WebView2
  managed DLLs and the native loader are embedded; on first run they are
  unpacked to `%LOCALAPPDATA%\RakshaSetuAdmin`.
- Uses the Microsoft Edge WebView2 Runtime, which ships with Windows 10/11.
  If it is missing, the app shows a message with the download link.
- Opens maximised; **F11** toggles full screen, **Esc** leaves it.

## Build

Needs only Windows' own .NET Framework 4.8 C# compiler, Python with Pillow,
and the Microsoft.Web.WebView2 NuGet package unpacked into `./wv2`:

```bash
curl -L -o wv2.nupkg https://www.nuget.org/api/v2/package/Microsoft.Web.WebView2/1.0.2903.40
python -c "import zipfile; zipfile.ZipFile('wv2.nupkg').extractall('wv2')"
python build.py
```

Output: `dist/RakshaSetu-Admin.exe`. Rebuild after any dashboard change;
the build always packs the current `../dashboard` files.

The exe is not code-signed, so Windows SmartScreen may show "Windows
protected your PC" on first run: choose **More info → Run anyway**.
