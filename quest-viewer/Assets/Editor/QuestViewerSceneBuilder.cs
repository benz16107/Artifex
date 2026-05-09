#if UNITY_EDITOR
using System.IO;
using Artifex.QuestViewer;
using UnityEditor;
using UnityEditor.SceneManagement;
using TMPro;
using UnityEngine;
using UnityEngine.EventSystems;
using UnityEngine.UI;
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
                    "Could not find OVRCameraRig prefab. Ensure Meta XR All-in-One SDK is installed, then retry.");
                return;
            }

            EnsureXrInteractionManager();
            EnsureEventSystemWithOvrInput();

            var centerEye = rig.transform.Find("TrackingSpace/CenterEyeAnchor");
            var rightHand = rig.transform.Find("TrackingSpace/RightHandAnchor");
            var leftHand = rig.transform.Find("TrackingSpace/LeftHandAnchor");
            EnsureDirectInteractor(leftHand);
            EnsureDirectInteractor(rightHand);

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
            canvasGo.AddComponent<CanvasScaler>().uiScaleMode = CanvasScaler.ScaleMode.ScaleWithScreenSize;
            canvasGo.AddComponent<OVRRaycaster>();

            if (centerEye != null)
            {
                canvasGo.transform.SetParent(centerEye, false);
                canvasGo.transform.localPosition = new Vector3(0f, 0f, 0.55f);
                canvasGo.transform.localRotation = Quaternion.identity;
                canvasGo.transform.localScale = Vector3.one * 0.0015f;
            }

            var rect = canvasGo.GetComponent<RectTransform>();
            rect.sizeDelta = new Vector2(800f, 480f);

            var panel = CreateUiPanel(canvasGo.transform);
            var urlField = CreateInputField(panel.transform, "UrlField", new Vector2(0f, 120f), new Vector2(720f, 72f));
            var status = CreateLabel(panel.transform, "Status", new Vector2(0f, 20f), new Vector2(720f, 140f), 22);
            var loadButton = CreateButton(panel.transform, "LoadButton", new Vector2(0f, -140f), new Vector2(200f, 64f));

            var existingManagers = GameObject.Find("QuestViewerManagers");
            if (existingManagers != null)
            {
                Object.DestroyImmediate(existingManagers);
            }

            var managers = new GameObject("QuestViewerManagers");
            var loader = managers.AddComponent<GlbUrlLoadController>();
            var placer = managers.AddComponent<RayPlaceModelRoot>();
            managers.AddComponent<QuestPassthroughBootstrap>();

            AssignObjectReference(loader, "urlField", urlField);
            AssignObjectReference(loader, "loadButton", loadButton);
            AssignObjectReference(loader, "statusText", status);
            AssignObjectReference(loader, "modelRoot", modelRoot.transform);
            AssignBool(loader, "loadStreamingTestOnStart", false);

            AssignObjectReference(placer, "modelRoot", modelRoot.transform);
            AssignObjectReference(placer, "rightHandAnchor", rightHand);

            EditorSceneManager.MarkSceneDirty(EditorSceneManager.GetActiveScene());
            EditorSceneManager.SaveOpenScenes();
            Debug.Log(
                "[ArtifexQuestViewer] Main scene setup complete. Use Meta > Tools > Project Setup Tool if the Meta XR package prompts for project fixes.");
        }

        private static GameObject FindOrCreateOvrCameraRig()
        {
            var existing = Object.FindFirstObjectByType<OVRManager>();
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

        private static void EnsureDirectInteractor(Transform handAnchor)
        {
            if (handAnchor == null)
            {
                return;
            }

            var go = handAnchor.gameObject;
            if (go.GetComponent<XRDirectInteractor>() == null)
            {
                go.AddComponent<XRDirectInteractor>();
            }

            var sphere = go.GetComponent<SphereCollider>() ?? go.AddComponent<SphereCollider>();
            sphere.isTrigger = true;
            sphere.radius = 0.09f;
        }

        private static void EnsureXrInteractionManager()
        {
            if (Object.FindFirstObjectByType<XRInteractionManager>() != null)
            {
                return;
            }

            var go = new GameObject("XR Interaction Manager");
            go.AddComponent<XRInteractionManager>();
        }

        private static void EnsureEventSystemWithOvrInput()
        {
            var es = Object.FindFirstObjectByType<EventSystem>();
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

            if (es.GetComponent<OVRInputModule>() == null)
            {
                es.gameObject.AddComponent<OVRInputModule>();
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
            img.color = new Color(0.08f, 0.08f, 0.1f, 0.92f);
            return go;
        }

        private static TMP_InputField CreateInputField(Transform parent, string name, Vector2 anchoredPos, Vector2 size)
        {
            var root = new GameObject(name);
            root.transform.SetParent(parent, false);
            var rt = root.AddComponent<RectTransform>();
            rt.anchorMin = new Vector2(0.5f, 0.5f);
            rt.anchorMax = new Vector2(0.5f, 0.5f);
            rt.anchoredPosition = anchoredPos;
            rt.sizeDelta = size;

            var rootImg = root.AddComponent<Image>();
            rootImg.color = new Color(0.15f, 0.15f, 0.18f, 1f);

            var textArea = new GameObject("Text Area");
            textArea.transform.SetParent(root.transform, false);
            var taRt = textArea.AddComponent<RectTransform>();
            taRt.anchorMin = Vector2.zero;
            taRt.anchorMax = Vector2.one;
            taRt.offsetMin = new Vector2(10f, 6f);
            taRt.offsetMax = new Vector2(-10f, -6f);
            textArea.AddComponent<RectMask2D>();

            var placeholderGo = new GameObject("Placeholder");
            placeholderGo.transform.SetParent(textArea.transform, false);
            var phRt = placeholderGo.AddComponent<RectTransform>();
            phRt.anchorMin = Vector2.zero;
            phRt.anchorMax = Vector2.one;
            phRt.offsetMin = Vector2.zero;
            phRt.offsetMax = Vector2.zero;
            var ph = placeholderGo.AddComponent<TextMeshProUGUI>();
            ph.text = "https://host:8000/outputs/{job_id}/model.glb";
            ph.fontSize = 22f;
            ph.color = new Color(1f, 1f, 1f, 0.35f);
            ph.alignment = TextAlignmentOptions.Left;

            var textGo = new GameObject("Text");
            textGo.transform.SetParent(textArea.transform, false);
            var textRt = textGo.AddComponent<RectTransform>();
            textRt.anchorMin = Vector2.zero;
            textRt.anchorMax = Vector2.one;
            textRt.offsetMin = Vector2.zero;
            textRt.offsetMax = Vector2.zero;
            var tmp = textGo.AddComponent<TextMeshProUGUI>();
            tmp.text = string.Empty;
            tmp.fontSize = 22f;
            tmp.color = Color.white;
            tmp.alignment = TextAlignmentOptions.Left;

            var field = root.AddComponent<TMP_InputField>();
            field.targetGraphic = rootImg;
            field.textViewport = taRt;
            field.textComponent = tmp;
            field.placeholder = ph;
            field.lineType = TMP_InputField.LineType.SingleLine;
            return field;
        }

        private static TMP_Text CreateLabel(Transform parent, string name, Vector2 anchoredPos, Vector2 size, int fontSize)
        {
            var go = new GameObject(name);
            go.transform.SetParent(parent, false);
            var rt = go.AddComponent<RectTransform>();
            rt.anchorMin = new Vector2(0.5f, 0.5f);
            rt.anchorMax = new Vector2(0.5f, 0.5f);
            rt.anchoredPosition = anchoredPos;
            rt.sizeDelta = size;
            var text = go.AddComponent<TextMeshProUGUI>();
            text.fontSize = fontSize;
            text.color = new Color(0.85f, 0.9f, 1f);
            text.text = "Status…";
            text.alignment = TextAlignmentOptions.TopLeft;
            text.enableWordWrapping = true;
            text.overflowMode = TextOverflowModes.Ellipsis;
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
            img.color = new Color(0.2f, 0.45f, 0.85f, 1f);
            var btn = go.AddComponent<Button>();

            var labelGo = new GameObject("Label");
            labelGo.transform.SetParent(go.transform, false);
            var lrt = labelGo.AddComponent<RectTransform>();
            lrt.anchorMin = Vector2.zero;
            lrt.anchorMax = Vector2.one;
            lrt.offsetMin = Vector2.zero;
            lrt.offsetMax = Vector2.zero;
            var label = labelGo.AddComponent<TextMeshProUGUI>();
            label.text = "Load GLB";
            label.fontSize = 26f;
            label.alignment = TextAlignmentOptions.Center;
            label.color = Color.white;
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
