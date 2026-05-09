using UnityEngine;

namespace Artifex.QuestViewer
{
    /// <summary>
    /// Enables Meta Quest insight passthrough when an <see cref="OVRManager"/> is present.
    /// </summary>
    public sealed class QuestPassthroughBootstrap : MonoBehaviour
    {
        [SerializeField] private bool enableOnStart = true;

        private void Start()
        {
            if (!enableOnStart)
            {
                return;
            }

            var manager = FindFirstObjectByType<OVRManager>();
            if (manager == null)
            {
                Debug.LogWarning("[ArtifexQuestViewer] OVRManager not found; passthrough skipped.");
                return;
            }

            manager.isInsightPassthroughEnabled = true;

            var centerCam = FindCenterEyeCamera();
            if (centerCam != null && centerCam.gameObject.GetComponent<OVRPassthroughLayer>() == null)
            {
                var layer = centerCam.gameObject.AddComponent<OVRPassthroughLayer>();
                layer.overlayType = OVRPassthroughLayer.OverlayType.Underlay;
            }
        }

        private static Camera FindCenterEyeCamera()
        {
            var center = GameObject.Find("CenterEyeAnchor");
            return center != null ? center.GetComponentInChildren<Camera>() : Camera.main;
        }
    }
}
