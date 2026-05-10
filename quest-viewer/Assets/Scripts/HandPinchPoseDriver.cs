using UnityEngine;
using UnityEngine.XR.Hands;
using UnityEngine.XR.Interaction.Toolkit.Interactors;
using UnityEngine.XR.Management;

namespace Artifex.QuestViewer
{
    /// <summary>
    /// Drives a pinch attach transform from OpenXR hand joints via <see cref="XRHandSubsystem"/>,
    /// and toggles the direct interactor only while the hand is tracked.
    /// </summary>
    [DisallowMultipleComponent]
    public sealed class HandPinchPoseDriver : MonoBehaviour
    {
        [SerializeField] private Handedness handedness = Handedness.Left;
        [Tooltip("OVRCameraRig TrackingSpace (or equivalent) used to map device-local joint poses to world space.")]
        [SerializeField] private Transform trackingSpace;
        [SerializeField] private Transform pinchInteractorRoot;
        [SerializeField] private XRDirectInteractor pinchInteractor;

        private XRHandSubsystem _subsystem;

        private void OnEnable()
        {
            TryBindSubsystem();
        }

        private void LateUpdate()
        {
            if (pinchInteractorRoot == null || trackingSpace == null)
            {
                return;
            }

            if (_subsystem == null)
            {
                TryBindSubsystem();
                if (_subsystem == null)
                {
                    SetTrackedActive(false);
                    return;
                }
            }

            _subsystem.TryUpdateHands(XRHandSubsystem.UpdateType.Dynamic);

            var hand = handedness == Handedness.Left ? _subsystem.leftHand : _subsystem.rightHand;
            if (!hand.isTracked)
            {
                SetTrackedActive(false);
                return;
            }

            var thumb = hand.GetJoint(XRHandJointID.ThumbTip);
            var index = hand.GetJoint(XRHandJointID.IndexTip);
            if (!thumb.TryGetPose(out var pThumb) || !index.TryGetPose(out var pIndex))
            {
                SetTrackedActive(false);
                return;
            }

            var originPose = new Pose(trackingSpace.position, trackingSpace.rotation);
            var wThumb = TransformPose(pThumb, originPose);
            var wIndex = TransformPose(pIndex, originPose);
            var mid = (wThumb.position + wIndex.position) * 0.5f;
            var rot = wIndex.rotation;
            pinchInteractorRoot.SetPositionAndRotation(mid, rot);
            SetTrackedActive(true);
        }

        private static Pose TransformPose(Pose localJoint, Pose originPose)
        {
            var p = originPose.rotation * localJoint.position + originPose.position;
            var r = originPose.rotation * localJoint.rotation;
            return new Pose(p, r);
        }

        private void SetTrackedActive(bool tracked)
        {
            if (pinchInteractor != null && pinchInteractor.enabled != tracked)
            {
                pinchInteractor.enabled = tracked;
            }
        }

        private void TryBindSubsystem()
        {
            var manager = XRGeneralSettings.Instance != null ? XRGeneralSettings.Instance.Manager : null;
            var loader = manager != null ? manager.activeLoader : null;
            _subsystem = loader != null ? loader.GetLoadedSubsystem<XRHandSubsystem>() : null;
        }
    }
}
