using UnityEngine;

namespace Artifex.QuestViewer
{
    /// <summary>
    /// If the first scene has no <see cref="OVRManager"/>, instantiate <c>Resources/ArtifexOVRCameraRig</c>
    /// (written by <b>Artifex → Quest Viewer → Setup Main Scene</b>).
    /// </summary>
    public static class ArtifexQuestRuntimeBootstrap
    {
        private const string OvrRigResourceName = "ArtifexOVRCameraRig";

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.AfterSceneLoad)]
        private static void AfterFirstSceneLoaded()
        {
            if (!Application.isPlaying)
            {
                return;
            }

            if (Object.FindAnyObjectByType<OVRManager>() != null)
            {
                return;
            }

            var prefab = Resources.Load<GameObject>(OvrRigResourceName);
            if (prefab == null)
            {
                Debug.LogError(
                    "[ArtifexQuestViewer] No OVRManager in the loaded scene and Resources/"
                    + OvrRigResourceName
                    + " is missing. In the Unity Editor run **Artifex → Quest Viewer → Setup Main Scene**, "
                    + "then rebuild.");
                return;
            }

            Object.Instantiate(prefab);
        }
    }
}
