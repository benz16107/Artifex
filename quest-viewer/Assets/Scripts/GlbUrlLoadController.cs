using System;
using System.Collections;
using System.IO;
using System.Threading.Tasks;
using GLTFast;
using TMPro;
using UnityEngine;
using UnityEngine.Networking;
using UnityEngine.UI;

namespace Artifex.QuestViewer
{
    /// <summary>
    /// Downloads a GLB from a URL (or loads StreamingAssets/test.glb) and instantiates it under <see cref="modelRoot"/>.
    /// </summary>
    public sealed class GlbUrlLoadController : MonoBehaviour
    {
        private const string LastUrlKey = "ArtifexQuestViewer.LastGlbUrl";

        [SerializeField] private TMP_InputField urlField;
        [SerializeField] private Button loadButton;
        [SerializeField] private TMP_Text statusText;
        [SerializeField] private Transform modelRoot;
        [SerializeField] private bool loadStreamingTestOnStart;

        private void Awake()
        {
            if (loadButton != null)
            {
                loadButton.onClick.AddListener(OnLoadClicked);
            }

            if (urlField != null && PlayerPrefs.HasKey(LastUrlKey))
            {
                urlField.text = PlayerPrefs.GetString(LastUrlKey);
            }
        }

        private void Start()
        {
            if (loadStreamingTestOnStart)
            {
                StartCoroutine(LoadStreamingRoutine("test.glb"));
            }
        }

        public void OnLoadClicked()
        {
            var url = urlField != null ? urlField.text.Trim() : string.Empty;
            if (string.IsNullOrEmpty(url))
            {
                SetStatus("Enter a URL.");
                return;
            }

            if (!url.StartsWith("http://", StringComparison.OrdinalIgnoreCase)
                && !url.StartsWith("https://", StringComparison.OrdinalIgnoreCase))
            {
                SetStatus("URL must start with http:// or https://");
                return;
            }

            StartCoroutine(DownloadAndLoadRoutine(url));
        }

        private IEnumerator DownloadAndLoadRoutine(string url)
        {
            SetStatus("Downloading…");
            var safeName = $"{Mathf.Abs(url.GetHashCode())}_{Guid.NewGuid():N}.glb";
            var dest = Path.Combine(Application.persistentDataPath, safeName);

            using (var req = UnityWebRequest.Get(url))
            {
                req.downloadHandler = new DownloadHandlerBuffer();
                yield return req.SendWebRequest();

                if (req.result != UnityWebRequest.Result.Success)
                {
                    SetStatus($"Download failed: {req.error}");
                    yield break;
                }

                var data = req.downloadHandler.data;
                if (data == null || data.Length == 0)
                {
                    SetStatus("Empty response.");
                    yield break;
                }

                try
                {
                    File.WriteAllBytes(dest, data);
                }
                catch (Exception ex)
                {
                    SetStatus($"Write failed: {ex.Message}");
                    yield break;
                }
            }

            yield return LoadFromPathRoutine(dest, null);
            PlayerPrefs.SetString(LastUrlKey, url);
            PlayerPrefs.Save();
        }

        private IEnumerator LoadStreamingRoutine(string fileName)
        {
            var path = Path.Combine(Application.streamingAssetsPath, fileName);
            SetStatus($"Loading {fileName}…");
            yield return LoadFromPathRoutine(path, fileName);
        }

        private IEnumerator LoadFromPathRoutine(string path, string preferredFileName)
        {
            if (modelRoot == null)
            {
                SetStatus("modelRoot is not assigned.");
                yield break;
            }

            if (path.Contains("://", StringComparison.Ordinal) && !path.StartsWith("file://", StringComparison.OrdinalIgnoreCase))
            {
                var req = UnityWebRequest.Get(path);
                req.downloadHandler = new DownloadHandlerBuffer();
                yield return req.SendWebRequest();
                if (req.result != UnityWebRequest.Result.Success)
                {
                    SetStatus($"StreamingAssets read failed: {req.error}");
                    req.Dispose();
                    yield break;
                }

                var data = req.downloadHandler.data;
                req.Dispose();
                if (data == null || data.Length == 0)
                {
                    SetStatus("StreamingAssets file is empty.");
                    yield break;
                }

                var name = string.IsNullOrEmpty(preferredFileName) ? Path.GetFileName(path) : preferredFileName;
                if (string.IsNullOrEmpty(name))
                {
                    name = "model.glb";
                }

                var dest = Path.Combine(Application.persistentDataPath, "_copy_" + name);
                try
                {
                    File.WriteAllBytes(dest, data);
                    path = dest;
                }
                catch (Exception ex)
                {
                    SetStatus($"Copy failed: {ex.Message}");
                    yield break;
                }
            }

            ClearModelChildren();

            var import = new GltfImport();
            Task<bool> loadTask = import.Load(path);
            yield return new WaitUntil(() => loadTask.IsCompleted);

            if (!loadTask.Result)
            {
                SetStatus($"glTF load failed for:\n{path}");
                yield break;
            }

            Task instTask = import.InstantiateMainSceneAsync(modelRoot);
            yield return new WaitUntil(() => instTask.IsCompleted);

            LoadedModelInteractionSetup.Configure(modelRoot.gameObject);
            long kb = 0;
            try
            {
                kb = new FileInfo(path).Length / 1024;
            }
            catch
            {
                // ignore
            }

            SetStatus($"Loaded ({kb} KB).");
        }

        private void ClearModelChildren()
        {
            for (var i = modelRoot.childCount - 1; i >= 0; i--)
            {
                Destroy(modelRoot.GetChild(i).gameObject);
            }
        }

        private void SetStatus(string message)
        {
            if (statusText != null)
            {
                statusText.text = message;
            }

            Debug.Log("[ArtifexQuestViewer] " + message);
        }
    }
}
