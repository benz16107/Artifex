using System.Collections;
using UnityEngine;
using UnityEngine.EventSystems;

namespace Artifex.QuestViewer
{
    /// <summary>
    /// Fixes Quest UI input on device even when the scene/prefab was never re-baked in the Editor:
    /// wires <see cref="OVRInputModule.rayTransform"/>, forces controller helpers to stay active (hand-tracking
    /// otherwise disables them), and spawns Meta <c>OVRControllerForUi</c> from Resources under hand anchors.
    /// </summary>
    public static class ArtifexQuestVrBootstrap
    {
        private const string ControllerPrefabResource = "OVRControllerForUi";

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.AfterSceneLoad)]
        private static void AfterSceneLoad()
        {
            WireOvrInputModuleRay();
            ForceControllerHelpersAlwaysActive();
            EnsureRuntimeOvrControllersForUi();
            KickDelayedModelListRefresh();
        }

        private static void WireOvrInputModuleRay()
        {
            var module = Object.FindAnyObjectByType<OVRInputModule>();
            if (module == null)
            {
                return;
            }

            if (module.rayTransform != null)
            {
                return;
            }

            var right = GameObject.Find("RightHandAnchor")?.transform;
            if (right != null)
            {
                module.rayTransform = right;
                return;
            }

            var left = GameObject.Find("LeftHandAnchor")?.transform;
            if (left != null)
            {
                module.rayTransform = left;
                return;
            }

            var center = GameObject.Find("CenterEyeAnchor")?.transform;
            if (center != null)
            {
                module.rayTransform = center;
            }
        }

        private static void ForceControllerHelpersAlwaysActive()
        {
            foreach (var h in Object.FindObjectsByType<OVRControllerHelper>(FindObjectsInactive.Include, FindObjectsSortMode.None))
            {
                h.m_showState = OVRInput.InputDeviceShowState.Always;
            }

            foreach (var hand in Object.FindObjectsByType<OVRHand>(FindObjectsInactive.Include, FindObjectsSortMode.None))
            {
                hand.m_showState = OVRInput.InputDeviceShowState.Always;
            }
        }

        private static void EnsureRuntimeOvrControllersForUi()
        {
            var prefab = Resources.Load<GameObject>(ControllerPrefabResource);
            if (prefab == null)
            {
                Debug.LogError(
                    "[ArtifexQuestViewer] Missing Resources/"
                    + ControllerPrefabResource
                    + ".prefab — copy Meta OVRControllerPrefab into Assets/Resources with that name.");
                return;
            }

            TrySpawn(prefab, "LeftHandAnchor", "ArtifexRuntimeOVRController_L", OVRInput.Controller.LTouch);
            TrySpawn(prefab, "RightHandAnchor", "ArtifexRuntimeOVRController_R", OVRInput.Controller.RTouch);
        }

        private static void TrySpawn(GameObject prefab, string anchorName, string instanceName, OVRInput.Controller controller)
        {
            var anchorGo = GameObject.Find(anchorName);
            if (anchorGo == null)
            {
                return;
            }

            var anchor = anchorGo.transform;
            if (anchor.Find(instanceName) != null)
            {
                return;
            }

            if (anchor.GetComponentInChildren<OVRControllerHelper>(true) != null)
            {
                return;
            }

            var inst = Object.Instantiate(prefab, anchor);
            inst.name = instanceName;
            inst.transform.localPosition = Vector3.zero;
            inst.transform.localRotation = Quaternion.identity;
            inst.transform.localScale = Vector3.one;

            var helper = inst.GetComponent<OVRControllerHelper>();
            if (helper != null)
            {
                helper.m_controller = controller;
                helper.m_showState = OVRInput.InputDeviceShowState.Always;
            }

            Debug.Log($"[ArtifexQuestViewer] Spawned {instanceName} for UI under {anchorName}.");
        }

        private static void KickDelayedModelListRefresh()
        {
            var host = new GameObject("_ArtifexQuestVrBootstrapRunner");
            host.AddComponent<DelayedModelListRefreshRunner>();
        }

        private sealed class DelayedModelListRefreshRunner : MonoBehaviour
        {
            private void Start()
            {
                StartCoroutine(Run());
            }

            private IEnumerator Run()
            {
                yield return null;
                yield return new WaitForSecondsRealtime(0.35f);
                foreach (var c in FindObjectsByType<ArtifexModelListController>(FindObjectsInactive.Include, FindObjectsSortMode.None))
                {
                    c.RequestRefresh();
                }

                Destroy(gameObject);
            }
        }
    }
}
