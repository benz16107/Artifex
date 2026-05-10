using UnityEngine;

namespace Artifex.QuestViewer
{
    /// <summary>
    /// Enables Meta Quest insight passthrough when an <see cref="OVRManager"/> is present.
    /// Clears the center-eye camera to transparent solid color so the underlay passthrough is visible.
    /// </summary>
    [DefaultExecutionOrder(-200)]
    public sealed class QuestPassthroughBootstrap : MonoBehaviour
    {
        [SerializeField] private bool enableOnStart;

        private void Awake()
        {
            if (!enableOnStart)
            {
                return;
            }

            ApplyTransparentCenterEyeCamera();
        }

        private void Start()
        {
            if (!enableOnStart)
            {
                return;
            }

            var manager = FindAnyObjectByType<OVRManager>();
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
                layer.overlayType = OVROverlay.OverlayType.Underlay;
            }

            ApplyTransparentCenterEyeCamera();
        }

        private static void ApplyTransparentCenterEyeCamera()
        {
            var centerCam = FindCenterEyeCamera();
            if (centerCam == null)
            {
                return;
            }

            centerCam.clearFlags = CameraClearFlags.SolidColor;
            centerCam.backgroundColor = new Color(0f, 0f, 0f, 0f);
        }

        private static Camera FindCenterEyeCamera()
        {
            var center = GameObject.Find("CenterEyeAnchor");
            return center != null ? center.GetComponentInChildren<Camera>() : Camera.main;
        }
    }
}
