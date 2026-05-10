using UnityEngine;
using UnityEngine.XR.Hands;
using UnityEngine.XR.Management;

namespace Artifex.QuestViewer
{
    /// <summary>
    /// Places <see cref="modelRoot"/> at a raycast hit from the right controller trigger or a right-hand pinch + aim.
    /// </summary>
    public sealed class RayPlaceModelRoot : MonoBehaviour
    {
        [SerializeField] private Transform modelRoot;
        [SerializeField] private Transform rightHandAnchor;
        [SerializeField] private float maxDistance = 12f;
        [SerializeField] private float surfaceOffset = 0.02f;
        [SerializeField] private LayerMask raycastMask = ~0;
        [SerializeField] private float handPinchThreshold = 0.62f;

        private XRHandSubsystem _hands;
        private bool _hadRightPinch;

        private void Update()
        {
            if (modelRoot == null || rightHandAnchor == null)
            {
                return;
            }

            if (OVRInput.GetDown(OVRInput.Button.PrimaryIndexTrigger, OVRInput.Controller.RTouch))
            {
                FirePlacementRay(rightHandAnchor.position, rightHandAnchor.forward);
                return;
            }

            if (_hands == null)
            {
                TryBindHandsSubsystem();
            }

            if (_hands == null)
            {
                return;
            }

            _hands.TryUpdateHands(XRHandSubsystem.UpdateType.Dynamic);

            var pinchStrength = ReadRightPinchStrength();
            var pinching = pinchStrength >= handPinchThreshold;
            var pinchDown = pinching && !_hadRightPinch;
            _hadRightPinch = pinching;

            if (!pinchDown)
            {
                return;
            }

            var tracking = rightHandAnchor.parent;
            if (tracking == null || !TryComputeRightHandAim(tracking, out var origin, out var dir))
            {
                return;
            }

            FirePlacementRay(origin, dir);
        }

        private void FirePlacementRay(Vector3 origin, Vector3 direction)
        {
            if (Physics.Raycast(origin, direction, out var hit, maxDistance, raycastMask, QueryTriggerInteraction.Ignore))
            {
                modelRoot.SetPositionAndRotation(
                    hit.point + hit.normal * surfaceOffset,
                    Quaternion.FromToRotation(Vector3.up, hit.normal));
            }
        }

        private float ReadRightPinchStrength()
        {
            var gestures = _hands.rightHandCommonGestures;
            if (gestures != null && gestures.TryGetPinchValue(out var pv))
            {
                return pv;
            }

            var hand = _hands.rightHand;
            if (!hand.isTracked)
            {
                return 0f;
            }

            var thumb = hand.GetJoint(XRHandJointID.ThumbTip);
            var index = hand.GetJoint(XRHandJointID.IndexTip);
            if (!thumb.TryGetPose(out var pt) || !index.TryGetPose(out var pi))
            {
                return 0f;
            }

            var d = Vector3.Distance(pt.position, pi.position);
            return Mathf.Clamp01(1f - Mathf.InverseLerp(0.09f, 0.028f, d));
        }

        private bool TryComputeRightHandAim(Transform tracking, out Vector3 origin, out Vector3 direction)
        {
            origin = default;
            direction = default;

            var originPose = new Pose(tracking.position, tracking.rotation);
            var gestures = _hands.rightHandCommonGestures;
            if (gestures != null && gestures.TryGetAimPose(out var aimLocal))
            {
                var aimWorld = TransformPose(aimLocal, originPose);
                origin = aimWorld.position;
                direction = aimWorld.rotation * Vector3.forward;
                return direction.sqrMagnitude > 1e-8f;
            }

            var hand = _hands.rightHand;
            if (!hand.isTracked)
            {
                return false;
            }

            var indexProx = hand.GetJoint(XRHandJointID.IndexProximal);
            var indexTip = hand.GetJoint(XRHandJointID.IndexTip);
            if (!indexProx.TryGetPose(out var pp) || !indexTip.TryGetPose(out var pt))
            {
                return false;
            }

            var wProx = TransformPose(pp, originPose);
            var wTip = TransformPose(pt, originPose);
            origin = wProx.position;
            direction = (wTip.position - wProx.position).normalized;
            if (direction.sqrMagnitude < 1e-6f)
            {
                direction = tracking.forward;
            }

            return true;
        }

        private static Pose TransformPose(Pose localJoint, Pose originPose)
        {
            var p = originPose.rotation * localJoint.position + originPose.position;
            var r = originPose.rotation * localJoint.rotation;
            return new Pose(p, r);
        }

        private void TryBindHandsSubsystem()
        {
            var manager = XRGeneralSettings.Instance != null ? XRGeneralSettings.Instance.Manager : null;
            var loader = manager != null ? manager.activeLoader : null;
            _hands = loader != null ? loader.GetLoadedSubsystem<XRHandSubsystem>() : null;
        }
    }
}
