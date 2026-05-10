using UnityEngine;
using UnityEngine.XR.Hands;
using UnityEngine.XR.Interaction.Toolkit;
using UnityEngine.XR.Interaction.Toolkit.Interactables;
using UnityEngine.XR.Interaction.Toolkit.Interactors;
using UnityEngine.XR.Management;

namespace Artifex.QuestViewer
{
    /// <summary>
    /// Pinch-driven grab/release for <see cref="XRGrabInteractable"/> using <see cref="XRInteractionManager"/>
    /// (hand <see cref="XRDirectInteractor"/> has no controller select action in this project).
    /// </summary>
    [DisallowMultipleComponent]
    public sealed class HandPinchGrabDriver : MonoBehaviour
    {
        private static readonly Collider[] OverlapBuffer = new Collider[24];

        [SerializeField] private XRDirectInteractor interactor;
        [SerializeField] private XRInteractionManager interactionManager;
        [SerializeField] private Handedness handedness = Handedness.Left;
        [SerializeField] private float pinchOnThreshold = 0.62f;
        [SerializeField] private float overlapRadius = 0.075f;
        [SerializeField] private LayerMask overlapMask = ~0;

        private XRHandSubsystem _subsystem;
        private bool _pinching;

        private void OnEnable()
        {
            TryBindSubsystem();
        }

        private void LateUpdate()
        {
            if (interactor == null)
            {
                return;
            }

            if (interactionManager == null)
            {
                interactionManager = FindAnyObjectByType<XRInteractionManager>();
            }

            if (_subsystem == null)
            {
                TryBindSubsystem();
            }

            if (_subsystem == null || interactionManager == null)
            {
                return;
            }

            _subsystem.TryUpdateHands(XRHandSubsystem.UpdateType.Dynamic);

            var pinching = TryGetPinchStrength(out var strength) && strength >= pinchOnThreshold;

            if (pinching && !_pinching)
            {
                TryGrabOnPinchStart();
            }
            else if (!pinching && _pinching)
            {
                TryReleaseOnPinchEnd();
            }

            _pinching = pinching;
        }

        private bool TryGetPinchStrength(out float strength)
        {
            strength = 0f;
            if (_subsystem == null)
            {
                return false;
            }

            var gestures = handedness == Handedness.Left ? _subsystem.leftHandCommonGestures : _subsystem.rightHandCommonGestures;
            if (gestures != null && gestures.TryGetPinchValue(out strength))
            {
                return true;
            }

            var hand = handedness == Handedness.Left ? _subsystem.leftHand : _subsystem.rightHand;
            if (!hand.isTracked)
            {
                return false;
            }

            var thumb = hand.GetJoint(XRHandJointID.ThumbTip);
            var index = hand.GetJoint(XRHandJointID.IndexTip);
            if (!thumb.TryGetPose(out var pt) || !index.TryGetPose(out var pi))
            {
                return false;
            }

            var d = Vector3.Distance(pt.position, pi.position);
            strength = Mathf.Clamp01(1f - Mathf.InverseLerp(0.09f, 0.028f, d));
            return true;
        }

        private void TryGrabOnPinchStart()
        {
            if (interactor.hasSelection)
            {
                return;
            }

            var n = Physics.OverlapSphereNonAlloc(transform.position, overlapRadius, OverlapBuffer, overlapMask, QueryTriggerInteraction.Ignore);
            for (var i = 0; i < n; i++)
            {
                var col = OverlapBuffer[i];
                if (col == null)
                {
                    continue;
                }

                var grab = col.GetComponentInParent<XRGrabInteractable>();
                if (grab == null)
                {
                    continue;
                }

                interactionManager.SelectEnter((IXRSelectInteractor)interactor, (IXRSelectInteractable)grab);
                return;
            }
        }

        private void TryReleaseOnPinchEnd()
        {
            if (!interactor.hasSelection)
            {
                return;
            }

            var copy = interactor.interactablesSelected;
            for (var i = 0; i < copy.Count; i++)
            {
                var selectable = copy[i];
                if (selectable != null)
                {
                    interactionManager.SelectExit((IXRSelectInteractor)interactor, selectable);
                }
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
