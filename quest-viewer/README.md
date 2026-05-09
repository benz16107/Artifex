# Artifex Quest Viewer (Unity)

Standalone Meta Quest app: paste a **direct GLB URL** (for example Artifex `GET /outputs/{job_id}/model.glb`), download to `persistentDataPath`, load with **glTFast**, then **grab** the model with **XR Interaction Toolkit**. **Passthrough** and **right-trigger placement** are enabled when an `OVRCameraRig` / `OVRManager` is present.

## Requirements

- **Unity** version matching [`ProjectSettings/ProjectVersion.txt`](ProjectSettings/ProjectVersion.txt) (this repo was bootstrapped from the Unity 6000.4 AR Foundation samples template; use **Unity 6** or let Unity migrate the project if you intentionally change editor version).
- **Meta Quest** with developer mode and USB or wireless deploy.
- **Meta XR All-in-One SDK** (`com.meta.xr.sdk.all` in [`Packages/manifest.json`](Packages/manifest.json)) — resolve packages online once.
- **Internet permission** is forced on in `ProjectSettings` for downloads.

## First-time setup in Unity

1. Open the **`quest-viewer`** folder with **Unity Hub** (Add project from disk).
2. Wait for **Package Manager** to finish (Meta npm registry + OpenUPM for glTFast). The project includes **TextMeshPro** (`com.unity.textmeshpro`); the first time you use TMP, Unity may prompt you to run **Window → TextMeshPro → Import TMP Essential Resources** — accept that so fonts and default assets resolve.
3. If Unity or Meta shows **Project Setup / validation** dialogs, apply the recommended fixes (XR plug-in management, Android settings, etc.).
4. Run menu **Artifex → Quest Viewer → Setup Main Scene**. This instantiates **`OVRCameraRig`**, world-space UI, **`XRInteractionManager`**, **`EventSystem` + `OVRInputModule`**, **`OVRRaycaster`**, wires `GlbUrlLoadController` / `RayPlaceModelRoot` / `QuestPassthroughBootstrap`, and saves **`Assets/Scenes/MainViewer.unity`**.
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
- **Grab / move / rotate** the loaded model by moving a controller **into** the mesh so the hand’s **`XRDirectInteractor`** overlap hits the model’s collider (XR grab interactable + kinematic rigidbody + box collider fit to bounds).
- **Place in room**: pull the **right index trigger** while aiming — raycasts from **`RightHandAnchor`** and moves **`ModelRoot`** to the hit (world-locked).
- **Passthrough**: enabled at start via `OVRManager` + `OVRPassthroughLayer` (underlay on the center eye camera).

## Optional two-hand scale

This baseline uses **`XRGrabInteractable`** defaults. For richer two-hand scaling, add **`XRGeneralGrabTransformer`** (or newer equivalents) on the loaded root in Unity or extend `LoadedModelInteractionSetup`.

## Troubleshooting

- **Package resolve errors**: bump `com.meta.xr.sdk.all` to a version listed on [Meta’s UPM registry](https://developers.meta.com/horizon/documentation/unity/unity-package-manager) or the Meta download hub.
- **Cleartext HTTP on Android 9+**: for LAN `http://` tests you may need a **network security config** or use HTTPS / a tunnel — Unity/Android may block cleartext; see Android docs.
- **Large GLBs**: downloads are buffered in memory; prefer reasonable file sizes or extend with chunked download to disk.
