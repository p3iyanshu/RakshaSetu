// RakshaSetu Admin Console — Windows desktop host.
//
// A single-file WinForms app that shows dashboard/admin.html in an embedded
// Microsoft Edge WebView2. Everything it needs is embedded in the exe:
//   - the admin web files (www.zip)
//   - the WebView2 managed DLLs, loaded from memory via AssemblyResolve
//   - the native WebView2Loader.dll, extracted next to the web files
// The web files are served from a private https host name, because the
// dashboard's ES modules will not load over file://.
//
// Written for the C# 5 compiler that ships with .NET Framework 4.8.

using System;
using System.Drawing;
using System.IO;
using System.IO.Compression;
using System.Reflection;
using System.Runtime.CompilerServices;
using System.Security.Cryptography;
using System.Windows.Forms;

namespace RakshaSetu.Admin
{
    internal static class Program
    {
        private const string HostName = "appassets.rakshasetu";
        private const string StartPage = "admin.html";

        [STAThread]
        private static int Main()
        {
            AppDomain.CurrentDomain.AssemblyResolve += ResolveEmbeddedAssembly;
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            try
            {
                string root = PrepareFiles();
                Run(root);
                return 0;
            }
            catch (Exception ex)
            {
                MessageBox.Show("RakshaSetu Admin Console could not start.\n\n" + ex.Message,
                    "RakshaSetu Admin Console", MessageBoxButtons.OK, MessageBoxIcon.Error);
                return 1;
            }
        }

        // Kept out of Main so the WebView2 types are only resolved after the
        // AssemblyResolve handler is registered.
        [MethodImpl(MethodImplOptions.NoInlining)]
        private static void Run(string root)
        {
            Application.Run(new MainForm(root, HostName, StartPage));
        }

        /// <summary>Unpack web files + native loader into a per-build folder.</summary>
        private static string PrepareFiles()
        {
            byte[] zip = ReadResource("www.zip");
            string build = Hash(zip);
            string baseDir = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "RakshaSetuAdmin");
            string root = Path.Combine(baseDir, "build-" + build);
            string marker = Path.Combine(root, ".ready");
            if (!File.Exists(marker))
            {
                if (Directory.Exists(root)) Directory.Delete(root, true);
                Directory.CreateDirectory(root);
                string zipPath = Path.Combine(root, "www.zip");
                File.WriteAllBytes(zipPath, zip);
                ZipFile.ExtractToDirectory(zipPath, Path.Combine(root, "www"));
                File.Delete(zipPath);
                File.WriteAllBytes(Path.Combine(root, "WebView2Loader.dll"), ReadResource("WebView2Loader.dll"));
                File.WriteAllText(marker, build);
                CleanOldBuilds(baseDir, root);
            }
            return root;
        }

        private static void CleanOldBuilds(string baseDir, string keep)
        {
            foreach (string dir in Directory.GetDirectories(baseDir, "build-*"))
            {
                if (string.Equals(dir, keep, StringComparison.OrdinalIgnoreCase)) continue;
                try { Directory.Delete(dir, true); } catch (IOException) { } catch (UnauthorizedAccessException) { }
            }
        }

        private static Assembly ResolveEmbeddedAssembly(object sender, ResolveEventArgs args)
        {
            string name = new AssemblyName(args.Name).Name + ".dll";
            byte[] bytes = TryReadResource(name);
            return bytes == null ? null : Assembly.Load(bytes);
        }

        internal static byte[] ReadResource(string name)
        {
            byte[] bytes = TryReadResource(name);
            if (bytes == null) throw new InvalidOperationException("Missing embedded resource: " + name);
            return bytes;
        }

        private static byte[] TryReadResource(string name)
        {
            using (Stream s = Assembly.GetExecutingAssembly().GetManifestResourceStream(name))
            {
                if (s == null) return null;
                using (var ms = new MemoryStream())
                {
                    s.CopyTo(ms);
                    return ms.ToArray();
                }
            }
        }

        private static string Hash(byte[] data)
        {
            using (var sha = SHA256.Create())
            {
                return BitConverter.ToString(sha.ComputeHash(data), 0, 6).Replace("-", "").ToLowerInvariant();
            }
        }
    }

    internal sealed class MainForm : Form
    {
        private readonly string root;
        private readonly string hostName;
        private readonly string startPage;
        private Microsoft.Web.WebView2.WinForms.WebView2 view;
        private FormWindowState stateBeforeFullScreen;
        private bool fullScreen;

        public MainForm(string root, string hostName, string startPage)
        {
            this.root = root;
            this.hostName = hostName;
            this.startPage = startPage;

            Text = "RakshaSetu Admin Console";
            BackColor = Color.FromArgb(3, 6, 12);
            MinimumSize = new Size(960, 600);
            Size = new Size(1440, 900);
            StartPosition = FormStartPosition.CenterScreen;
            WindowState = FormWindowState.Maximized;
            using (Stream ico = Assembly.GetExecutingAssembly().GetManifestResourceStream("app.ico"))
            {
                if (ico != null) Icon = new Icon(ico);
            }

            view = new Microsoft.Web.WebView2.WinForms.WebView2();
            view.Dock = DockStyle.Fill;
            view.DefaultBackgroundColor = Color.FromArgb(3, 6, 12);
            view.CreationProperties = new Microsoft.Web.WebView2.WinForms.CoreWebView2CreationProperties();
            view.CreationProperties.UserDataFolder = Path.Combine(root, "profile");
            Controls.Add(view);

            Load += OnLoad;
        }

        private async void OnLoad(object sender, EventArgs e)
        {
            try
            {
                Microsoft.Web.WebView2.Core.CoreWebView2Environment.SetLoaderDllFolderPath(root);
                await view.EnsureCoreWebView2Async(null);
            }
            catch (Microsoft.Web.WebView2.Core.WebView2RuntimeNotFoundException)
            {
                MessageBox.Show(this,
                    "This app needs the Microsoft Edge WebView2 Runtime, which is included with " +
                    "Windows 10 and 11 but missing on this PC.\n\n" +
                    "Install it from https://go.microsoft.com/fwlink/p/?LinkId=2124703 and start the app again.",
                    Text, MessageBoxButtons.OK, MessageBoxIcon.Warning);
                Close();
                return;
            }

            var core = view.CoreWebView2;
            core.Settings.AreDevToolsEnabled = false;
            core.Settings.AreDefaultContextMenusEnabled = false;
            core.Settings.IsStatusBarEnabled = false;
            core.Settings.IsZoomControlEnabled = true;
            core.SetVirtualHostNameToFolderMapping(hostName, Path.Combine(root, "www"),
                Microsoft.Web.WebView2.Core.CoreWebView2HostResourceAccessKind.Allow);

            // Stay inside the bundled pages; no pop-up windows
            core.NewWindowRequested += delegate(object s, Microsoft.Web.WebView2.Core.CoreWebView2NewWindowRequestedEventArgs a)
            {
                a.Handled = true;
            };
            core.NavigationStarting += delegate(object s, Microsoft.Web.WebView2.Core.CoreWebView2NavigationStartingEventArgs a)
            {
                Uri uri;
                if (!Uri.TryCreate(a.Uri, UriKind.Absolute, out uri) ||
                    !string.Equals(uri.Host, hostName, StringComparison.OrdinalIgnoreCase))
                {
                    a.Cancel = true;
                }
            };
            core.DocumentTitleChanged += delegate
            {
                string t = core.DocumentTitle;
                Text = string.IsNullOrEmpty(t) ? "RakshaSetu Admin Console" : t;
            };

            // The web view keeps keyboard focus, so F11 / Esc are caught in the page
            // and passed to the window over the WebView2 message channel.
            await core.AddScriptToExecuteOnDocumentCreatedAsync(
                "document.addEventListener('keydown', function (e) {" +
                "  if (e.key === 'F11') { e.preventDefault(); window.chrome.webview.postMessage('toggle-fullscreen'); }" +
                "  else if (e.key === 'Escape') { window.chrome.webview.postMessage('exit-fullscreen'); }" +
                "}, true);");
            core.WebMessageReceived += delegate(object s, Microsoft.Web.WebView2.Core.CoreWebView2WebMessageReceivedEventArgs a)
            {
                string msg = a.TryGetWebMessageAsString();
                if (msg == "toggle-fullscreen") SetFullScreen(!fullScreen);
                else if (msg == "exit-fullscreen") SetFullScreen(false);
            };

            core.Navigate("https://" + hostName + "/" + startPage);
        }

        // F11 toggles full screen, Esc leaves it (keys arrive from the page, see OnLoad)
        private void SetFullScreen(bool on)
        {
            if (on == fullScreen) return;
            fullScreen = on;
            if (on)
            {
                stateBeforeFullScreen = WindowState;
                FormBorderStyle = FormBorderStyle.None;
                WindowState = FormWindowState.Normal;   // re-maximise so it covers the taskbar
                WindowState = FormWindowState.Maximized;
            }
            else
            {
                FormBorderStyle = FormBorderStyle.Sizable;
                WindowState = stateBeforeFullScreen;
            }
        }
    }
}
