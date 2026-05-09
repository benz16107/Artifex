using UnityEngine;

namespace Artifex.QuestViewer
{
    /// <summary>
    /// Places <see cref="modelRoot"/> at a raycast hit from the right controller trigger.
    /// </summary>
    public sealed class RayPlaceModelRoot : MonoBehaviour
    {
        [SerializeField] private Transform modelRoot;
        [SerializeField] private Transform rightHandAnchor;
        [SerializeField] private float maxDistance = 12f;
        [SerializeField] private float surfaceOffset = 0.02f;
        [SerializeField] private LayerMask raycastMask = ~0;

        private void Update()
        {
            if (modelRoot == null || rightHandAnchor == null)
            {
                return;
            }

            if (!OVRInput.GetDown(OVRInput.Button.PrimaryIndexTrigger, OVRInput.Controller.RTouch))
            {
                return;
            }

            var origin = rightHandAnchor.position;
            var dir = rightHandAnchor.forward;
            if (Physics.Raycast(origin, dir, out var hit, maxDistance, raycastMask, QueryTriggerInteraction.Ignore))
            {
                modelRoot.SetPositionAndRotation(
                    hit.point + hit.normal * surfaceOffset,
                    Quaternion.FromToRotation(Vector3.up, hit.normal));
            }
        }
    }
}
