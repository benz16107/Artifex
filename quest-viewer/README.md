# Artifex Quest Viewer (Unity)

Standalone Meta Quest app: paste a **direct GLB URL** (for example Artifex `GET /outputs/{job_id}/model.glb`), download to `persistentDataPath`, load with **glTFast**, then **grab** the model with **XR Interaction Toolkit** using **hand pinch** (OpenXR **XR Hands**) or the right controller. **Passthrough** is optional (off by default). **Right-hand placement** (pinch or trigger) works when an `OVRCameraRig` / `OVRManager` is present.

## Requirements

- **Unity** version matching [`ProjectSettings/ProjectVersion.txt`](ProjectSettings/ProjectVersion.txt) (this repo was bootstrapped from the Unity 6000.4 AR Foundation samples template; use **Unity 6** or let Unity migrate the project if you intentionally change editor version).
- **Meta Quest** with developer mode and USB or wireless deploy.
- **Meta XR Core SDK** (`com.meta.xr.sdk.core` in [`Packages/manifest.json`](Packages/manifest.json)) — resolve packages online once. (`com.meta.xr.sdk.all` is not served on Meta’s npm registry; this project depends on **Core** only, which is enough for `OVRCameraRig`, passthrough, and `OVRInput`.)
- **Unity XR Hands** (`com.unity.xr.hands` in [`Packages/manifest.json`](Packages/manifest.json)) — used for pinch poses and placement; requires **OpenXR Hand Tracking** enabled for Android (see setup step below).
- **Internet permission** is forced on in `ProjectSettings` for downloads.

## First-time setup in Unity

1. Open the **`quest-viewer`** folder with **Unity Hub** (Add project from disk).
2. Wait for **Package Manager** to finish (Meta npm registry + OpenUPM for glTFast). The project includes **TextMeshPro** (`com.unity.textmeshpro`); the first time you use TMP, Unity may prompt you to run **Window → TextMeshPro → Import TMP Essential Resources** — accept that so fonts and default assets resolve.
3. If Unity or Meta shows **Project Setup / validation** dialogs, apply the recommended fixes (XR plug-in management, Android settings, etc.).
3b. **Hand tracking (OpenXR)** — Unity 6 does **not** put OpenXR on a single flat page; follow this order:
   1. **Edit → Project Settings → XR Plug-in Management** (the top-level item in the left list).
   2. In the **right** pane, open the **Android** build-target tab (robot icon). Under **Plug-in Providers**, enable **OpenXR** for Android.  
      Until OpenXR is enabled here, **no separate “OpenXR” page exists** in Project Settings.
   3. Look at the **left** sidebar again: Unity adds a **child entry** **OpenXR** *under* **XR Plug-in Management** (same pattern as “Project Validation”). Click **OpenXR**.
   4. In the **OpenXR** page, select the **Android** tab, then scroll **OpenXR Feature Groups** / the feature list. Enable **Hand tracking** (Unity’s label; sometimes shown as **Hand Tracking Subsystem** or grouped under a feature group). That checkbox is registered by **`com.unity.xr.hands`** — if packages are still resolving, it may appear only after the editor finishes importing.
   5. Optional: **Edit → Project Settings → XR Plug-in Management → Project Validation** (Android), or **Window → XR → OpenXR → Project Validation**, and use **Fix** / **Edit** on any hand-tracking or OpenXR rules.
   6. Tip: use the **search box** at the top of the Project Settings window and type **`hand`** or **`openxr`** to jump to the right section.
4. Run menu **Artifex → Quest Viewer → Setup Main Scene**. This instantiates **`OVRCameraRig`**, world-space UI, **`XRInteractionManager`**, **`EventSystem` + `OVRInputModule`**, **`OVRRaycaster`**, hand pinch rigs under **TrackingSpace**, wires `GlbUrlLoadController` / `RayPlaceModelRoot` / `QuestPassthroughBootstrap`, saves **`Assets/Scenes/MainViewer.unity`**, and writes **`Assets/Resources/ArtifexOVRCameraRig.prefab`** so a **device build still gets an OVRCameraRig** if the scene file in git was never saved with the rig (see troubleshooting). Re-run this menu after pulling viewer changes.
5. **Build Settings**: ensure **MainViewer** is the only (or first) scene; target **Android**; **IL2CPP** + **ARM64**; set **company** / **product** if you like.
6. **Build and Run** to the headset.

If **`OVRCameraRig` prefab** is not found, confirm Meta XR Core is imported and check the prefab path under `Packages/com.meta.xr.sdk.core/` (Meta occasionally moves it). Update the paths in [`Assets/Editor/QuestViewerSceneBuilder.cs`](Assets/Editor/QuestViewerSceneBuilder.cs) if needed.

## StreamingAssets test model

A minimal triangle GLB is committed as **`Assets/StreamingAssets/test.glb`**. Regenerate anytime:

```bash
python3 Tools/gen_minimal_glb.py
```

In `GlbUrlLoadController`, enable **`loadStreamingTestOnStart`** on the component in the scene (after running the menu item) to auto-load this file on start (useful on device where `StreamingAssets` lives under a `jar:` URL — the controller copies it to disk first).

## Artifex URLs

With the Django API from the parent repo, a completed job exposes:

`http://<host>:<port>/outputs/<job_id>/model.glb`

Example on your LAN (Quest must reach the host; `localhost` on the headset is **not** your PC):

`http://192.168.1.50:8000/outputs/abc123/model.glb`

Use **HTTPS** in production. The `/outputs/...` route is served without the job API token (see root [README.md](../README.md)); treat links as capability URLs.

## Controls (after scene setup)

- **UI**: point with the right controller; use **Load GLB** after entering a URL.
- **Grab / move / rotate (hands)**: pinch (thumb + index) while your pinch point overlaps the model — a small **`XRDirectInteractor`** under **`ArtifexHandPinch_Left` / `ArtifexHandPinch_Right`** follows each hand; **`HandPinchGrabDriver`** selects the **`XRGrabInteractable`** on pinch start and releases on pinch end. Tracking uses **OpenXR + XR Hands** (step 3b). If you also rely on Meta **`OVRHand`** APIs, set **Hand Tracking Support** on the scene’s **`OVRManager`** (Quest Features) to **Controllers and Hands** or **Hands Only** — the exact inspector field replaces older `handTrackingSupport` script APIs in current **`com.meta.xr.sdk.core`** versions.
- **Place in room**: **right index trigger** (controller) **or** a **right-hand pinch** (edge-activated) while aiming — uses Meta **aim pose** when available, otherwise an index-finger ray; moves **`ModelRoot`** to the hit.
- **Passthrough**: off by default on `QuestPassthroughBootstrap` (misconfigured passthrough can show a black compositor). Enable **enableOnStart** on that component in the scene if you want Quest insight passthrough underlay on the center-eye camera.

## Optional two-hand scale

This baseline uses **`XRGrabInteractable`** defaults. For richer two-hand scaling, add **`XRGeneralGrabTransformer`** (or newer equivalents) on the loaded root in Unity or extend `LoadedModelInteractionSetup`.

## Troubleshooting

- **Black screen on headset**: the build must include an **`OVRCameraRig`** (with **`OVRManager`**). The committed **`MainViewer.unity`** may only contain a light until you run **Artifex → Quest Viewer → Setup Main Scene** in the Editor and **save/commit** the scene. The setup menu also writes **`Assets/Resources/ArtifexOVRCameraRig.prefab`**; at runtime, **`ArtifexQuestRuntimeBootstrap`** instantiates that prefab if the loaded scene has no `OVRManager`. If you still see black, confirm **XR Plug-in Management** has **OpenXR** enabled for **Android**, then check **logcat** for `[ArtifexQuestViewer]` errors.
- **Package resolve errors**: use `com.meta.xr.sdk.core` from [Meta’s UPM registry](https://developers.meta.com/horizon/documentation/unity/unity-package-manager); `com.meta.xr.sdk.all` is not published on that registry.
- **Android build: “No XR Manager settings” / `OVRManifestPreprocessor` NullReferenceException**: the project must register **OpenXR** under **XR Plug-in Management** for **Android** (and usually **Standalone** for the Editor). This repo ships `Assets/XR/XRGeneralSettingsPerBuildTarget.asset` wired to `Assets/XR/Loaders/OpenXRLoader.asset`. After pulling changes, reopen the project; in **Edit → Project Settings → XR Plug-in Management**, confirm **OpenXR** is checked for **Android**. Then use **Edit → Project Settings → Meta XR** (or **Meta → Tools → Project Setup Tool**) to apply any remaining compatibility fixes (**GameActivity** only, **Android TV** off for store builds).
- **Conflicting Meta warnings about OpenXR**: Meta’s build pipeline still expects **Unity OpenXR** as the active loader when using the **Meta XR Feature** path (`MetaXRFeature`). The message suggesting the legacy **Oculus XR Plugin** is easy to misread; for this template, **OpenXR + Meta XR** is the intended stack unless you deliberately migrate to the older plugin.
- **Cleartext HTTP on Android 9+**: for LAN `http://` tests you may need a **network security config** or use HTTPS / a tunnel — Unity/Android may block cleartext; see Android docs.
- **Large GLBs**: downloads are buffered in memory; prefer reasonable file sizes or extend with chunked download to disk.
