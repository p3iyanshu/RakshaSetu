# RakshaSetu Android apps

Two Android apps built from one project, each wrapping the web dashboard in
`../dashboard` in a fullscreen WebView:

| Flavour     | APK name                  | App id                     | Opens        |
|-------------|---------------------------|----------------------------|--------------|
| `dashboard` | RakshaSetu                | `com.rakshasetu.dashboard` | `index.html` |
| `admin`     | RakshaSetu Admin          | `com.rakshasetu.admin`     | `admin.html` |

The dashboard files are copied into the APK at build time (`syncWebAssets`),
so the apps run offline and always ship the current `dashboard/` code. They
are served from `https://appassets.androidplatform.net/` inside the app,
because the dashboard's ES modules won't load over `file://`. Requires a
device with OpenGL ES 3 / WebGL2 (Android 7.0+).

## Build

Needs JDK 17+ (Android Studio's bundled JBR works) and the Android SDK
(`local.properties` → `sdk.dir=...`).

```bash
./gradlew assembleDashboardDebug assembleAdminDebug
```

APKs land in `app/build/outputs/apk/<flavour>/debug/`.

On Windows, if Gradle fails with `Unable to establish loopback connection`,
the temp path is too long for Java's internal socket; point it at a short
folder first:

```bash
export JAVA_TOOL_OPTIONS="-Djdk.net.unixdomain.tmpdir=D:/tmp-gradle"
```

These are debug-signed builds for sideloading and demos. For Play Store
distribution, add a release signing config and build `assemble*Release`.
