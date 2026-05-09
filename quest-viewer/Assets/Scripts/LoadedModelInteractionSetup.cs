using UnityEngine;
using UnityEngine.XR.Interaction.Toolkit;
using UnityEngine.XR.Interaction.Toolkit.Interactables;

namespace Artifex.QuestViewer
{
    /// <summary>
    /// Adds XR grab and a kinematic rigidbody + box collider from renderer bounds (two-hand scale via default grab settings where supported).
    /// </summary>
    public static class LoadedModelInteractionSetup
    {
        public static void Configure(GameObject modelRoot)
        {
            if (modelRoot == null)
            {
                return;
            }

            var renderers = modelRoot.GetComponentsInChildren<Renderer>();
            if (renderers.Length == 0)
            {
                return;
            }

            var bounds = renderers[0].bounds;
            for (var i = 1; i < renderers.Length; i++)
            {
                bounds.Encapsulate(renderers[i].bounds);
            }

            var col = modelRoot.GetComponent<BoxCollider>() ?? modelRoot.AddComponent<BoxCollider>();
            col.center = modelRoot.transform.InverseTransformPoint(bounds.center);
            var ext = bounds.size;
            var lossy = modelRoot.transform.lossyScale;
            col.size = new Vector3(
                ext.x / Mathf.Max(Mathf.Abs(lossy.x), 1e-4f),
                ext.y / Mathf.Max(Mathf.Abs(lossy.y), 1e-4f),
                ext.z / Mathf.Max(Mathf.Abs(lossy.z), 1e-4f));

            var body = modelRoot.GetComponent<Rigidbody>() ?? modelRoot.AddComponent<Rigidbody>();
            body.isKinematic = true;
            body.useGravity = false;

            var grab = modelRoot.GetComponent<XRGrabInteractable>() ?? modelRoot.AddComponent<XRGrabInteractable>();
            grab.trackPosition = true;
            grab.trackRotation = true;
        }
    }
}
