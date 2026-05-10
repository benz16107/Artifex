#if UNITY_EDITOR
using System.IO;
using Artifex.QuestViewer;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.EventSystems;
using UnityEngine.UI;
using UnityEngine.XR.Hands;
using UnityEngine.XR.Interaction.Toolkit;
using UnityEngine.XR.Interaction.Toolkit.Interactors;

namespace Artifex.QuestViewer.Editor
{
    /// <summary>
    /// One-click scene setup: OVRCameraRig, world-space UI, XR interaction, passthrough helpers.
    /// </summary>
    public static class QuestViewerSceneBuilder
    {
        private static readonly string[] OvRigPaths =
        {
            "Packages/com.meta.xr.sdk.core/Prefabs/OVRCameraRig.prefab",
            "Packages/com.meta.xr.sdk.core/OVR/Prefabs/OVRCameraRig.prefab",
            "Packages/com.meta.xr.sdk.core/Runtime/Prefabs/OVRCameraRig.prefab",
        };

        [MenuItem("Artifex/Quest Viewer/Setup Main Scene")]
        public static void SetupMainScene()
        {
            const string scenePath = "Assets/Scenes/MainViewer.unity";
            if (!File.Exists(scenePath))
            {
                Debug.LogError($"Missing scene at {scenePath}.");
                return;
            }

            EditorSceneManager.OpenScene(scenePath);

            var rig = FindOrCreateOvrCameraRig();
            if (rig == null)
            {
                Debug.LogError(
                    "Could not find OVRCameraRig prefab. Ensure com.meta.xr.sdk.core is installed (Package Manager), then retry.");
                return;
            }

            EnsureXrInteractionManager();

            var trackingSpace = rig.transform.Find("TrackingSpace");
            var centerEye = rig.transform.Find("TrackingSpace/CenterEyeAnchor");
            var rightHand = rig.transform.Find("TrackingSpace/RightHandAnchor");
            var leftHand = rig.transform.Find("TrackingSpace/LeftHandAnchor");
            EnsureEventSystemWithOvrInput(rightHand != null ? rightHand : centerEye);
            StripControllerHandInteractors(leftHand);
            StripControllerHandInteractors(rightHand);
            var xim = Object.FindAnyObjectByType<XRInteractionManager>();
            if (xim == null)
            {
                Debug.LogWarning(
                    "[ArtifexQuestViewer] XRInteractionManager not found; hand pinch grab needs it. Ensure XR Interaction Manager exists in the scene.");
            }

            EnsureHandPinchRig(trackingSpace, xim);
            EnsureOvrHandVisualsForUi(leftHand, rightHand);

            var modelRoot = GameObject.Find("ModelRoot") ?? new GameObject("ModelRoot");
            modelRoot.transform.SetParent(null);
            modelRoot.transform.position = new Vector3(0f, 1.1f, 1.2f);

            var existingCanvas = GameObject.Find("QuestViewerUICanvas");
            if (existingCanvas != null)
            {
                Object.DestroyImmediate(existingCanvas);
            }

            var canvasGo = new GameObject("QuestViewerUICanvas");
            var canvas = canvasGo.AddComponent<Canvas>();
            canvas.renderMode = RenderMode.WorldSpace;
            canvas.worldCamera = centerEye != null ? centerEye.GetComponent<Camera>() : Camera.main;
            var scaler = canvasGo.AddComponent<CanvasScaler>();
            scaler.uiScaleMode = CanvasScaler.ScaleMode.ScaleWithScreenSize;
            scaler.referenceResolution = new Vector2(920f, 1100f);
            canvasGo.AddComponent<OVRRaycaster>();

            if (centerEye != null)
            {
                canvasGo.transform.SetParent(centerEye, false);
                // Farther from the face than ~0.55m; world-space scale slightly reduced so the panel stays readable.
                canvasGo.transform.localPosition = new Vector3(0f, -0.05f, 1.22f);
                canvasGo.transform.localRotation = Quaternion.identity;
                canvasGo.transform.localScale = Vector3.one * 0.00135f;
            }

            var rect = canvasGo.GetComponent<RectTransform>();
            rect.sizeDelta = new Vector2(920f, 1100f);

            var panel = CreateUiPanel(canvasGo.transform);
            CreateTitleText(panel.transform);
            CreateHelpText(panel.transform);
            CreateStaticHint(panel.transform, "ServerHint", new Vector2(0f, 188f), new Vector2(860f, 28f), 18, "Artifex API (same machine as runserver — use LAN IP, not localhost):");
            var apiBaseField = CreateApiBaseInputField(panel.transform, "ArtifexApiBaseUrl", new Vector2(0f, 148f), new Vector2(840f, 52f));
            var refreshModelsButton = CreateSecondaryButton(panel.transform, "RefreshModels", new Vector2(0f, 88f), new Vector2(260f, 48f), "Refresh model list");
            var listContent = CreateModelListScroll(panel.transform, new Vector2(0f, -95f), new Vector2(860f, 248f));
            CreateStaticHint(panel.transform, "UrlHint", new Vector2(0f, -318f), new Vector2(860f, 26f), 17, "Or paste a full GLB URL:");
            var urlField = CreateUrlInputField(panel.transform, "UrlField", new Vector2(0f, -358f), new Vector2(840f, 56f));
            var status = CreateStatusText(panel.transform, "Status", new Vector2(0f, -448f), new Vector2(840f, 100f), 19);
            var loadButton = CreateButton(panel.transform, "LoadButton", new Vector2(0f, -538f), new Vector2(260f, 56f));

            var existingManagers = GameObject.Find("QuestViewerManagers");
            if (existingManagers != null)
            {
                Object.DestroyImmediate(existingManagers);
            }

            var managers = new GameObject("QuestViewerManagers");
            var loader = managers.AddComponent<GlbUrlLoadController>();
            var placer = managers.AddComponent<RayPlaceModelRoot>();
            var passthrough = managers.AddComponent<QuestPassthroughBootstrap>();
            AssignBool(passthrough, "enableOnStart", true);
            var catalog = managers.AddComponent<ArtifexModelListController>();

            AssignObjectReference(loader, "urlField", urlField);
            AssignObjectReference(loader, "loadButton", loadButton);
            AssignObjectReference(loader, "statusText", status);
            AssignObjectReference(loader, "modelRoot", modelRoot.transform);
            AssignBool(loader, "loadStreamingTestOnStart", false);

            AssignObjectReference(catalog, "apiBaseUrlField", apiBaseField);
            AssignObjectReference(catalog, "refreshModelsButton", refreshModelsButton);
            AssignObjectReference(catalog, "modelListContent", listContent);
            AssignObjectReference(catalog, "glbLoader", loader);

            AssignObjectReference(placer, "modelRoot", modelRoot.transform);
            AssignObjectReference(placer, "rightHandAnchor", rightHand);

            SaveOvrRigResourcesPrefab(rig);

            EditorSceneManager.MarkSceneDirty(EditorSceneManager.GetActiveScene());
            EditorSceneManager.SaveOpenScenes();
            Debug.Log(
                "[ArtifexQuestViewer] Main scene setup complete (Unity UI + passthrough on start). "
                + "OVRCameraRig was saved to Assets/Resources/ArtifexOVRCameraRig.prefab for device builds. "
                + "Re-run this menu after pulling changes so the prefab matches. "
                + "Use Meta > Tools > Project Setup Tool if the Meta XR package prompts for project fixes.");
        }

        private static void SaveOvrRigResourcesPrefab(GameObject rigRoot)
        {
            if (rigRoot == null)
            {
                return;
            }

            const string resourcesDir = "Assets/Resources";
            const string prefabPath = resourcesDir + "/ArtifexOVRCameraRig.prefab";
            try
            {
                if (!Directory.Exists(resourcesDir))
                {
                    Directory.CreateDirectory(resourcesDir);
                }

                PrefabUtility.SaveAsPrefabAsset(rigRoot, prefabPath);
                AssetDatabase.SaveAssets();
                AssetDatabase.Refresh();
            }
            catch (System.Exception ex)
            {
                Debug.LogWarning($"[ArtifexQuestViewer] Could not write Resources OVRCameraRig copy: {ex.Message}");
            }
        }

        private static GameObject FindOrCreateOvrCameraRig()
        {
            var existing = Object.FindAnyObjectByType<OVRManager>();
            if (existing != null)
            {
                return existing.gameObject;
            }

            foreach (var path in OvRigPaths)
            {
                var prefab = AssetDatabase.LoadAssetAtPath<GameObject>(path);
                if (prefab != null)
                {
                    return PrefabUtility.InstantiatePrefab(prefab) as GameObject;
                }
            }

            return null;
        }

        private static void StripControllerHandInteractors(Transform handAnchor)
        {
            if (handAnchor == null)
            {
                return;
            }

            var go = handAnchor.gameObject;
            var interactor = go.GetComponent<XRDirectInteractor>();
            if (interactor != null)
            {
                Object.DestroyImmediate(interactor);
            }

            var sphere = go.GetComponent<SphereCollider>();
            if (sphere != null && sphere.isTrigger)
            {
                Object.DestroyImmediate(sphere);
            }
        }

        /// <summary>
        /// Meta <see cref="OVRHand"/> registers with <see cref="OVRInputModule"/> on enable so pinch + aim drives Unity UI.
        /// Without these prefabs under the anchors, only controller fallback (or gaze via <c>rayTransform</c>) works.
        /// </summary>
        private static void EnsureOvrHandVisualsForUi(Transform leftAnchor, Transform rightAnchor)
        {
            TryInstantiateOvrCustomHand(
                leftAnchor,
                "ArtifexOVRHandUI_L",
                new[]
                {
                    "Packages/com.meta.xr.sdk.core/Prefabs/OVRCustomHandPrefab_L.prefab",
                });
            TryInstantiateOvrCustomHand(
                rightAnchor,
                "ArtifexOVRHandUI_R",
                new[]
                {
                    "Packages/com.meta.xr.sdk.core/Prefabs/OVRCustomHandPrefab_R.prefab",
                });
        }

        private static void TryInstantiateOvrCustomHand(Transform anchor, string instanceName, string[] prefabPaths)
        {
            if (anchor == null)
            {
                return;
            }

            if (anchor.Find(instanceName) != null)
            {
                return;
            }

            if (anchor.GetComponentInChildren<OVRHand>(true) != null)
            {
                return;
            }

            foreach (var path in prefabPaths)
            {
                var prefab = AssetDatabase.LoadAssetAtPath<GameObject>(path);
                if (prefab == null)
                {
                    continue;
                }

                var inst = PrefabUtility.InstantiatePrefab(prefab) as GameObject;
                if (inst == null)
                {
                    continue;
                }

                inst.name = instanceName;
                inst.transform.SetParent(anchor, false);
                inst.transform.localPosition = Vector3.zero;
                inst.transform.localRotation = Quaternion.identity;
                inst.transform.localScale = Vector3.one;
                Debug.Log($"[ArtifexQuestViewer] Added Meta OVR hand prefab for UI: {path} under {anchor.name}.");
                return;
            }

            Debug.LogWarning(
                $"[ArtifexQuestViewer] Could not load Meta OVRCustomHand prefab for {anchor?.name}; hand-driven UI will not register.");
        }

        private static void EnsureHandPinchRig(Transform trackingSpace, XRInteractionManager interactionManager)
        {
            if (trackingSpace == null)
            {
                return;
            }

            RemoveLegacyHandPinchRoots(trackingSpace);
            CreateHandPinchRoot(trackingSpace, interactionManager, Handedness.Left);
            CreateHandPinchRoot(trackingSpace, interactionManager, Handedness.Right);
        }

        private static void RemoveLegacyHandPinchRoots(Transform trackingSpace)
        {
            foreach (var name in new[] { "ArtifexHandPinch_Left", "ArtifexHandPinch_Right" })
            {
                var existing = trackingSpace.Find(name);
                if (existing != null)
                {
                    Object.DestroyImmediate(existing.gameObject);
                }
            }
        }

        private static void CreateHandPinchRoot(
            Transform trackingSpace,
            XRInteractionManager interactionManager,
            Handedness handedness)
        {
            var isLeft = handedness == Handedness.Left;
            var rootName = isLeft ? "ArtifexHandPinch_Left" : "ArtifexHandPinch_Right";
            var rootGo = new GameObject(rootName);
            rootGo.transform.SetParent(trackingSpace, false);

            var pinchGo = new GameObject("Pinch");
            pinchGo.transform.SetParent(rootGo.transform, false);

            var col = pinchGo.AddComponent<SphereCollider>();
            col.isTrigger = true;
            col.radius = 0.075f;

            var direct = pinchGo.AddComponent<XRDirectInteractor>();
            DisableHandInteractorSelectInputs(direct);

            var poseDriver = rootGo.AddComponent<HandPinchPoseDriver>();
            AssignHandPinchPoseDriver(poseDriver, handedness, trackingSpace, pinchGo.transform, direct);

            var grabDriver = pinchGo.AddComponent<HandPinchGrabDriver>();
            AssignHandPinchGrabDriver(grabDriver, handedness, direct, interactionManager);
        }

        private static void AssignHandPinchPoseDriver(
            HandPinchPoseDriver driver,
            Handedness handedness,
            Transform trackingSpace,
            Transform pinchRoot,
            XRDirectInteractor interactor)
        {
            var so = new SerializedObject(driver);
            SetEnumByName(so.FindProperty("handedness"), handedness.ToString());
            so.FindProperty("trackingSpace").objectReferenceValue = trackingSpace;
            so.FindProperty("pinchInteractorRoot").objectReferenceValue = pinchRoot;
            so.FindProperty("pinchInteractor").objectReferenceValue = interactor;
            so.ApplyModifiedPropertiesWithoutUndo();
        }

        private static void AssignHandPinchGrabDriver(
            HandPinchGrabDriver driver,
            Handedness handedness,
            XRDirectInteractor interactor,
            XRInteractionManager interactionManager)
        {
            var so = new SerializedObject(driver);
            so.FindProperty("interactor").objectReferenceValue = interactor;
            so.FindProperty("interactionManager").objectReferenceValue = interactionManager;
            SetEnumByName(so.FindProperty("handedness"), handedness.ToString());
            so.ApplyModifiedPropertiesWithoutUndo();
        }

        private static void SetEnumByName(SerializedProperty prop, string enumMemberName)
        {
            if (prop == null)
            {
                return;
            }

            for (var i = 0; i < prop.enumNames.Length; i++)
            {
                if (prop.enumNames[i] == enumMemberName)
                {
                    prop.enumValueIndex = i;
                    return;
                }
            }
        }

        private static void DisableHandInteractorSelectInputs(XRDirectInteractor interactor)
        {
            var so = new SerializedObject(interactor);
            ClearInputActionProperty(so, "m_SelectInput");
            ClearInputActionProperty(so, "m_ActivateInput");
            ClearInputActionProperty(so, "m_UIPressInput");
            so.ApplyModifiedPropertiesWithoutUndo();
        }

        private static void ClearInputActionProperty(SerializedObject so, string propertyName)
        {
            var p = so.FindProperty(propertyName);
            if (p == null)
            {
                return;
            }

            var useRef = p.FindPropertyRelative("m_UseReference");
            if (useRef != null)
            {
                useRef.boolValue = false;
            }

            var reference = p.FindPropertyRelative("m_Reference");
            if (reference != null)
            {
                reference.objectReferenceValue = null;
            }

            var action = p.FindPropertyRelative("m_Action");
            if (action != null)
            {
                action.objectReferenceValue = null;
            }
        }

        private static void EnsureXrInteractionManager()
        {
            if (Object.FindAnyObjectByType<XRInteractionManager>() != null)
            {
                return;
            }

            var go = new GameObject("XR Interaction Manager");
            go.AddComponent<XRInteractionManager>();
        }

        /// <summary>
        /// VR UI needs <see cref="OVRInputModule"/> with <c>rayTransform</c> set to a controller anchor or laser hits nothing.
        /// </summary>
        private static void EnsureEventSystemWithOvrInput(Transform controllerRayOrigin)
        {
            var es = Object.FindAnyObjectByType<EventSystem>();
            if (es == null)
            {
                var go = new GameObject("EventSystem");
                es = go.AddComponent<EventSystem>();
            }

            var standalone = es.GetComponent<StandaloneInputModule>();
            if (standalone != null)
            {
                Object.DestroyImmediate(standalone);
            }

            var ovr = es.GetComponent<OVRInputModule>();
            if (ovr == null)
            {
                ovr = es.gameObject.AddComponent<OVRInputModule>();
            }

            if (controllerRayOrigin != null)
            {
                ovr.rayTransform = controllerRayOrigin;
            }
        }

        private static GameObject CreateUiPanel(Transform parent)
        {
            var go = new GameObject("Panel");
            go.transform.SetParent(parent, false);
            var rt = go.AddComponent<RectTransform>();
            rt.anchorMin = Vector2.zero;
            rt.anchorMax = Vector2.one;
            rt.offsetMin = Vector2.zero;
            rt.offsetMax = Vector2.zero;
            var img = go.AddComponent<Image>();
            img.color = new Color(0.06f, 0.07f, 0.1f, 0.94f);
            return go;
        }

        private static Font DefaultUIFont()
        {
            foreach (var name in new[] { "LegacyRuntime.ttf", "Arial.ttf" })
            {
                var f = Resources.GetBuiltinResource<Font>(name);
                if (f != null)
                {
                    return f;
                }
            }

            try
            {
                return Font.CreateDynamicFontFromOSFont("Arial", 18);
            }
            catch
            {
                return null;
            }
        }

        private static void StyleUiText(Text text, int size, Color color, TextAnchor anchor)
        {
            if (text == null)
            {
                return;
            }

            var font = DefaultUIFont();
            if (font == null)
            {
                Debug.LogError(
                    "[ArtifexQuestViewer] No built-in or OS font for UI text. Install a default UI font asset or run on a platform with Arial.");
            }

            text.font = font;
            text.fontSize = size;
            text.color = color;
            text.alignment = anchor;
            text.supportRichText = false;
            text.horizontalOverflow = HorizontalWrapMode.Wrap;
            text.verticalOverflow = VerticalWrapMode.Truncate;
            text.raycastTarget = false;
        }

        private static void CreateTitleText(Transform parent)
        {
            var go = new GameObject("Title");
            go.transform.SetParent(parent, false);
            var rt = go.AddComponent<RectTransform>();
            rt.anchorMin = new Vector2(0.5f, 0.5f);
            rt.anchorMax = new Vector2(0.5f, 0.5f);
            rt.anchoredPosition = new Vector2(0f, 500f);
            rt.sizeDelta = new Vector2(880f, 52f);
            var text = go.AddComponent<Text>();
            StyleUiText(text, 32, new Color(0.65f, 0.88f, 1f), TextAnchor.MiddleCenter);
            text.fontStyle = FontStyle.Bold;
            text.horizontalOverflow = HorizontalWrapMode.Overflow;
            text.text = "Artifex Quest Viewer";
        }

        private static void CreateHelpText(Transform parent)
        {
            var go = new GameObject("Help");
            go.transform.SetParent(parent, false);
            var rt = go.AddComponent<RectTransform>();
            rt.anchorMin = new Vector2(0.5f, 0.5f);
            rt.anchorMax = new Vector2(0.5f, 0.5f);
            rt.anchoredPosition = new Vector2(0f, 318f);
            rt.sizeDelta = new Vector2(860f, 210f);
            var text = go.AddComponent<Text>();
            StyleUiText(text, 18, new Color(0.9f, 0.92f, 0.96f, 1f), TextAnchor.UpperLeft);
            text.text =
                "Controls\n"
                + "• Set **Server base URL** to your PC’s Django URL (e.g. http://192.168.1.10:8000). Run: python manage.py runserver 0.0.0.0:8000\n"
                + "• Tap **Refresh model list** — completed jobs with model.glb appear; tap a row to load (no copy/paste).\n"
                + "• Or paste a full GLB URL and tap **Load GLB**.\n"
                + "• Aim the ray, pull trigger (or pinch). Passthrough = your room behind the UI; enable in Meta Quest settings if needed.";
        }

        private static void CreateStaticHint(Transform parent, string name, Vector2 anchoredPos, Vector2 size, int fontSize, string message)
        {
            var go = new GameObject(name);
            go.transform.SetParent(parent, false);
            var rt = go.AddComponent<RectTransform>();
            rt.anchorMin = new Vector2(0.5f, 0.5f);
            rt.anchorMax = new Vector2(0.5f, 0.5f);
            rt.anchoredPosition = anchoredPos;
            rt.sizeDelta = size;
            var text = go.AddComponent<Text>();
            StyleUiText(text, fontSize, new Color(0.78f, 0.84f, 0.92f, 1f), TextAnchor.MiddleLeft);
            text.horizontalOverflow = HorizontalWrapMode.Wrap;
            text.text = message;
        }

        private static InputField CreateApiBaseInputField(Transform parent, string name, Vector2 anchoredPos, Vector2 size)
        {
            var root = new GameObject(name);
            root.transform.SetParent(parent, false);
            var rt = root.AddComponent<RectTransform>();
            rt.anchorMin = new Vector2(0.5f, 0.5f);
            rt.anchorMax = new Vector2(0.5f, 0.5f);
            rt.anchoredPosition = anchoredPos;
            rt.sizeDelta = size;

            var rootImg = root.AddComponent<Image>();
            rootImg.color = new Color(0.12f, 0.14f, 0.18f, 1f);

            var inset = new Vector2(10f, 6f);

            var placeholderGo = new GameObject("Placeholder");
            placeholderGo.transform.SetParent(root.transform, false);
            var phRt = placeholderGo.AddComponent<RectTransform>();
            phRt.anchorMin = Vector2.zero;
            phRt.anchorMax = Vector2.one;
            phRt.offsetMin = inset;
            phRt.offsetMax = -inset;
            var ph = placeholderGo.AddComponent<Text>();
            StyleUiText(ph, 18, new Color(1f, 1f, 1f, 0.35f), TextAnchor.MiddleLeft);
            ph.text = "http://192.168.1.10:8000";

            var textGo = new GameObject("Text");
            textGo.transform.SetParent(root.transform, false);
            var textRt = textGo.AddComponent<RectTransform>();
            textRt.anchorMin = Vector2.zero;
            textRt.anchorMax = Vector2.one;
            textRt.offsetMin = inset;
            textRt.offsetMax = -inset;
            var valueText = textGo.AddComponent<Text>();
            StyleUiText(valueText, 18, Color.white, TextAnchor.MiddleLeft);
            valueText.text = string.Empty;
            valueText.raycastTarget = false;

            var field = root.AddComponent<InputField>();
            field.targetGraphic = rootImg;
            field.textComponent = valueText;
            field.placeholder = ph;
            field.lineType = InputField.LineType.SingleLine;
            field.characterValidation = InputField.CharacterValidation.None;
            return field;
        }

        private static Button CreateSecondaryButton(Transform parent, string name, Vector2 anchoredPos, Vector2 size, string label)
        {
            var go = new GameObject(name);
            go.transform.SetParent(parent, false);
            var rt = go.AddComponent<RectTransform>();
            rt.anchorMin = new Vector2(0.5f, 0.5f);
            rt.anchorMax = new Vector2(0.5f, 0.5f);
            rt.anchoredPosition = anchoredPos;
            rt.sizeDelta = size;
            var img = go.AddComponent<Image>();
            img.color = new Color(0.22f, 0.24f, 0.3f, 1f);
            var btn = go.AddComponent<Button>();

            var labelGo = new GameObject("Label");
            labelGo.transform.SetParent(go.transform, false);
            var lrt = labelGo.AddComponent<RectTransform>();
            lrt.anchorMin = Vector2.zero;
            lrt.anchorMax = Vector2.one;
            lrt.offsetMin = Vector2.zero;
            lrt.offsetMax = Vector2.zero;
            var t = labelGo.AddComponent<Text>();
            StyleUiText(t, 20, new Color(0.92f, 0.94f, 0.98f), TextAnchor.MiddleCenter);
            t.text = label;
            t.fontStyle = FontStyle.Bold;
            t.raycastTarget = false;
            return btn;
        }

        private static RectTransform CreateModelListScroll(Transform parent, Vector2 anchoredPos, Vector2 size)
        {
            var root = new GameObject("ModelListScroll");
            root.transform.SetParent(parent, false);
            var rootRt = root.AddComponent<RectTransform>();
            rootRt.anchorMin = new Vector2(0.5f, 0.5f);
            rootRt.anchorMax = new Vector2(0.5f, 0.5f);
            rootRt.anchoredPosition = anchoredPos;
            rootRt.sizeDelta = size;

            var scroll = root.AddComponent<ScrollRect>();
            scroll.horizontal = false;
            scroll.vertical = true;
            scroll.movementType = ScrollRect.MovementType.Clamped;
            scroll.scrollSensitivity = 22f;

            var vp = new GameObject("Viewport");
            vp.transform.SetParent(root.transform, false);
            var vpRt = vp.AddComponent<RectTransform>();
            vpRt.anchorMin = Vector2.zero;
            vpRt.anchorMax = Vector2.one;
            vpRt.sizeDelta = Vector2.zero;
            vpRt.anchoredPosition = Vector2.zero;
            vpRt.offsetMin = Vector2.zero;
            vpRt.offsetMax = Vector2.zero;
            var vpBg = vp.AddComponent<Image>();
            vpBg.color = new Color(0.04f, 0.05f, 0.07f, 1f);
            vp.AddComponent<RectMask2D>();

            var content = new GameObject("Content");
            content.transform.SetParent(vp.transform, false);
            var contentRt = content.AddComponent<RectTransform>();
            contentRt.anchorMin = new Vector2(0f, 1f);
            contentRt.anchorMax = new Vector2(1f, 1f);
            contentRt.pivot = new Vector2(0.5f, 1f);
            contentRt.anchoredPosition = Vector2.zero;
            contentRt.sizeDelta = new Vector2(0f, 0f);

            var vlg = content.AddComponent<VerticalLayoutGroup>();
            vlg.spacing = 6f;
            vlg.padding = new RectOffset(8, 8, 8, 8);
            vlg.childAlignment = TextAnchor.UpperCenter;
            vlg.childControlHeight = true;
            vlg.childControlWidth = true;
            vlg.childForceExpandHeight = false;
            vlg.childForceExpandWidth = true;

            var fitter = content.AddComponent<ContentSizeFitter>();
            fitter.verticalFit = ContentSizeFitter.FitMode.PreferredSize;
            fitter.horizontalFit = ContentSizeFitter.FitMode.Unconstrained;

            scroll.viewport = vpRt;
            scroll.content = contentRt;
            return contentRt;
        }

        private static InputField CreateUrlInputField(Transform parent, string name, Vector2 anchoredPos, Vector2 size)
        {
            var root = new GameObject(name);
            root.transform.SetParent(parent, false);
            var rt = root.AddComponent<RectTransform>();
            rt.anchorMin = new Vector2(0.5f, 0.5f);
            rt.anchorMax = new Vector2(0.5f, 0.5f);
            rt.anchoredPosition = anchoredPos;
            rt.sizeDelta = size;

            var rootImg = root.AddComponent<Image>();
            rootImg.color = new Color(0.14f, 0.16f, 0.2f, 1f);

            // uGUI 2.x InputField has no textViewport; keep a flat hierarchy under the root.
            var inset = new Vector2(12f, 8f);

            var placeholderGo = new GameObject("Placeholder");
            placeholderGo.transform.SetParent(root.transform, false);
            var phRt = placeholderGo.AddComponent<RectTransform>();
            phRt.anchorMin = Vector2.zero;
            phRt.anchorMax = Vector2.one;
            phRt.offsetMin = inset;
            phRt.offsetMax = -inset;
            var ph = placeholderGo.AddComponent<Text>();
            StyleUiText(ph, 20, new Color(1f, 1f, 1f, 0.38f), TextAnchor.MiddleLeft);
            ph.text = "https://your-server/outputs/{job_id}/model.glb";

            var textGo = new GameObject("Text");
            textGo.transform.SetParent(root.transform, false);
            var textRt = textGo.AddComponent<RectTransform>();
            textRt.anchorMin = Vector2.zero;
            textRt.anchorMax = Vector2.one;
            textRt.offsetMin = inset;
            textRt.offsetMax = -inset;
            var valueText = textGo.AddComponent<Text>();
            StyleUiText(valueText, 20, Color.white, TextAnchor.MiddleLeft);
            valueText.text = string.Empty;
            valueText.raycastTarget = false;

            var field = root.AddComponent<InputField>();
            field.targetGraphic = rootImg;
            field.textComponent = valueText;
            field.placeholder = ph;
            field.lineType = InputField.LineType.SingleLine;
            field.characterValidation = InputField.CharacterValidation.None;
            return field;
        }

        private static Text CreateStatusText(Transform parent, string name, Vector2 anchoredPos, Vector2 size, int fontSize)
        {
            var go = new GameObject(name);
            go.transform.SetParent(parent, false);
            var rt = go.AddComponent<RectTransform>();
            rt.anchorMin = new Vector2(0.5f, 0.5f);
            rt.anchorMax = new Vector2(0.5f, 0.5f);
            rt.anchoredPosition = anchoredPos;
            rt.sizeDelta = size;
            var text = go.AddComponent<Text>();
            StyleUiText(text, fontSize, new Color(0.82f, 0.9f, 1f), TextAnchor.UpperLeft);
            text.text = "Status: set server URL, refresh list, or paste a GLB URL.";
            return text;
        }

        private static Button CreateButton(Transform parent, string name, Vector2 anchoredPos, Vector2 size)
        {
            var go = new GameObject(name);
            go.transform.SetParent(parent, false);
            var rt = go.AddComponent<RectTransform>();
            rt.anchorMin = new Vector2(0.5f, 0.5f);
            rt.anchorMax = new Vector2(0.5f, 0.5f);
            rt.anchoredPosition = anchoredPos;
            rt.sizeDelta = size;
            var img = go.AddComponent<Image>();
            img.color = new Color(0.18f, 0.48f, 0.92f, 1f);
            var btn = go.AddComponent<Button>();

            var labelGo = new GameObject("Label");
            labelGo.transform.SetParent(go.transform, false);
            var lrt = labelGo.AddComponent<RectTransform>();
            lrt.anchorMin = Vector2.zero;
            lrt.anchorMax = Vector2.one;
            lrt.offsetMin = Vector2.zero;
            lrt.offsetMax = Vector2.zero;
            var label = labelGo.AddComponent<Text>();
            StyleUiText(label, 24, Color.white, TextAnchor.MiddleCenter);
            label.text = "Load GLB";
            label.fontStyle = FontStyle.Bold;
            label.raycastTarget = false;
            return btn;
        }

        private static void AssignObjectReference(Object target, string fieldName, Object reference)
        {
            var so = new SerializedObject(target);
            var prop = so.FindProperty(fieldName);
            if (prop == null)
            {
                Debug.LogError($"Missing serialized field '{fieldName}' on {target.GetType().Name}.");
                return;
            }

            prop.objectReferenceValue = reference;
            so.ApplyModifiedPropertiesWithoutUndo();
        }

        private static void AssignBool(Object target, string fieldName, bool value)
        {
            var so = new SerializedObject(target);
            var prop = so.FindProperty(fieldName);
            if (prop == null)
            {
                Debug.LogError($"Missing serialized field '{fieldName}' on {target.GetType().Name}.");
                return;
            }

            prop.boolValue = value;
            so.ApplyModifiedPropertiesWithoutUndo();
        }
    }
}
#endif
