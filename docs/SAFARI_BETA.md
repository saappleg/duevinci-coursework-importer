# Safari beta package

The Safari release asset is the Web Extension source package. Apple requires a
Safari Web Extension App/Xcode wrapper before the extension can be enabled in
Safari; the beta package intentionally does not include signing credentials or
an app certificate.

On macOS with Xcode installed:

```sh
xcrun safari-web-extension-packager . \
  --project-location safari-project \
  --app-name "DueVinci Coursework Importer" \
  --swift
```

Open the generated project in Xcode, select the macOS or iOS app target, run it,
and enable **DueVinci Coursework Importer** in Safari → Settings → Extensions.
Keep a signed-in `duevinci.tech` tab open while testing imports. The same
review-first WGU and Maestro adapters are used by Chrome/Chromium and Safari.

This is a beta source build. Do not use it with production coursework unless
you have reviewed the preview and are comfortable with the test release.
