using System;
using System.Collections;
using System.Collections.Generic;
using System.Text;
using System.Text.RegularExpressions;
using UnityEngine;
using UnityEngine.Networking;
using UnityEngine.UI;

namespace Artifex.QuestViewer
{
    [Serializable]
    public sealed class ViewerModelsEnvelope
    {
        public ViewerModelEntry[] items;
    }

    /// <summary>
    /// Matches <c>GET /viewer/models</c> JSON (camelCase for Unity JsonUtility).
    /// </summary>
    [Serializable]
    public sealed class ViewerModelEntry
    {
        public string jobId;
        public string status;
        public string prompt;
        public string glbPath;
    }

    /// <summary>
    /// Fetches <c>GET /viewer/models</c> from the Artifex Django API and fills a scroll list; choosing a row loads that GLB.
    /// </summary>
    public sealed class ArtifexModelListController : MonoBehaviour
    {
        public const string PrefsApiBase = "ArtifexQuestViewer.ApiBaseUrl";
        public const string PrefsApiToken = "ArtifexQuestViewer.ApiToken";
        public const string PrefsUserId = "ArtifexQuestViewer.UserId";

        /// <summary>Hardcoded LAN / tethered IP for this build (remove when you add a proper settings screen).</summary>
        public const string HardcodedApiBaseUrl = "http://172.20.10.3:8000";

        [SerializeField] private InputField apiBaseUrlField;
        [SerializeField] private Button refreshModelsButton;
        [SerializeField] private RectTransform modelListContent;
        [SerializeField] private GlbUrlLoadController glbLoader;

        private Font _uiFont;
        private bool _refreshBusy;

        private void Awake()
        {
            _uiFont = Resources.GetBuiltinResource<Font>("LegacyRuntime.ttf")
                ?? Resources.GetBuiltinResource<Font>("Arial.ttf");

            if (apiBaseUrlField != null && !string.IsNullOrEmpty(HardcodedApiBaseUrl))
            {
                apiBaseUrlField.text = HardcodedApiBaseUrl.TrimEnd('/');
                PlayerPrefs.SetString(PrefsApiBase, apiBaseUrlField.text);
                PlayerPrefs.Save();
            }

            if (refreshModelsButton != null)
            {
                refreshModelsButton.onClick.AddListener(OnRefreshClicked);
            }
        }

        private void Start()
        {
            if (apiBaseUrlField != null && !string.IsNullOrWhiteSpace(apiBaseUrlField.text))
            {
                StartCoroutine(RefreshRoutine());
            }
        }

        private void OnRefreshClicked()
        {
            if (apiBaseUrlField != null)
            {
                PlayerPrefs.SetString(PrefsApiBase, apiBaseUrlField.text.Trim());
                PlayerPrefs.Save();
            }

            StartCoroutine(RefreshRoutine());
        }

        /// <summary>Called from <see cref="ArtifexQuestVrBootstrap"/> after scene load so lists populate even if Start order was wrong.</summary>
        public void RequestRefresh()
        {
            StartCoroutine(RefreshRoutine());
        }

        private IEnumerator RefreshRoutine()
        {
            if (_refreshBusy)
            {
                yield break;
            }

            _refreshBusy = true;
            if (modelListContent == null || glbLoader == null)
            {
                _refreshBusy = false;
                yield break;
            }

            var baseUrl = apiBaseUrlField != null ? apiBaseUrlField.text.Trim().TrimEnd('/') : string.Empty;
            if (string.IsNullOrEmpty(baseUrl))
            {
                ClearList();
                glbLoader.SetCatalogStatus("Set **Server base URL** (e.g. http://192.168.1.5:8000) then tap **Refresh list**.");
                _refreshBusy = false;
                yield break;
            }

            glbLoader.SetCatalogStatus("Fetching model list…");
            ClearList();

            var url = baseUrl + "/viewer/models";
            var req = UnityWebRequest.Get(url);
            req.downloadHandler = new DownloadHandlerBuffer();
            ApplyAuthHeaders(req);
            Debug.Log("[ArtifexQuestViewer] GET " + url);
            yield return req.SendWebRequest();

            string body;
            try
            {
                body = req.downloadHandler != null ? req.downloadHandler.text : string.Empty;
                if (req.result != UnityWebRequest.Result.Success)
                {
                    var snippet = body.Length > 220 ? body.Substring(0, 220) + "…" : body;
                    glbLoader.SetCatalogStatus(
                        $"List HTTP {(int)req.responseCode} {req.error}\n{snippet}\n"
                        + "Tip: Android blocks http unless cleartext is allowed (manifest updated). Use LAN IP + runserver 0.0.0.0:8000.");
                    _refreshBusy = false;
                    yield break;
                }
            }
            finally
            {
                req.Dispose();
            }

            Debug.Log($"[ArtifexQuestViewer] viewer/models body length={body?.Length ?? 0}");

            ViewerModelsEnvelope env = null;
            try
            {
                env = JsonUtility.FromJson<ViewerModelsEnvelope>(body);
            }
            catch (Exception ex)
            {
                glbLoader.SetCatalogStatus($"Bad JSON from server: {ex.Message}\n{Truncate(body, 400)}");
                _refreshBusy = false;
                yield break;
            }

            var items = CoalesceModelItems(env, body);
            if (items.Length == 0)
            {
                glbLoader.SetCatalogStatus(
                    "No models parsed. Server must return JSON {\"items\":[...]} with jobId, or job_id strings in body. "
                    + "Jobs need model.glb and matching X-User-Id (default anonymous). Raw: "
                    + Truncate(body, 280));
                _refreshBusy = false;
                yield break;
            }

            foreach (var entry in items)
            {
                if (entry == null || string.IsNullOrEmpty(entry.jobId))
                {
                    continue;
                }

                CreateRow(baseUrl, entry);
            }

            glbLoader.SetCatalogStatus($"Found {items.Length} model(s). Tap a row to load.");
            _refreshBusy = false;
        }

        private static ViewerModelEntry[] CoalesceModelItems(ViewerModelsEnvelope env, string body)
        {
            if (env?.items != null && env.items.Length > 0)
            {
                return env.items;
            }

            return ParseJobIdsLoose(body);
        }

        /// <summary>JsonUtility sometimes returns empty arrays; regex still finds job ids in the payload.</summary>
        private static ViewerModelEntry[] ParseJobIdsLoose(string raw)
        {
            if (string.IsNullOrEmpty(raw))
            {
                return Array.Empty<ViewerModelEntry>();
            }

            var seen = new HashSet<string>();
            var list = new List<ViewerModelEntry>();
            void TryAdd(Match m)
            {
                if (!m.Success || m.Groups.Count < 2)
                {
                    return;
                }

                var id = m.Groups[1].Value;
                if (string.IsNullOrEmpty(id) || !seen.Add(id))
                {
                    return;
                }

                list.Add(
                    new ViewerModelEntry
                    {
                        jobId = id,
                        status = "?",
                        prompt = string.Empty,
                        glbPath = $"/outputs/{id}/model.glb",
                    });
            }

            foreach (Match m in Regex.Matches(raw, "\"jobId\"\\s*:\\s*\"(job_[0-9a-f]{10})\"", RegexOptions.IgnoreCase))
            {
                TryAdd(m);
            }

            foreach (Match m in Regex.Matches(raw, "\"job_id\"\\s*:\\s*\"(job_[0-9a-f]{10})\"", RegexOptions.IgnoreCase))
            {
                TryAdd(m);
            }

            return list.ToArray();
        }

        private static string Truncate(string s, int max)
        {
            if (string.IsNullOrEmpty(s))
            {
                return string.Empty;
            }

            return s.Length <= max ? s : s.Substring(0, max) + "…";
        }

        private void ApplyAuthHeaders(UnityWebRequest req)
        {
            var token = PlayerPrefs.GetString(PrefsApiToken, string.Empty);
            if (!string.IsNullOrEmpty(token))
            {
                req.SetRequestHeader("X-Api-Token", token);
            }

            var userId = PlayerPrefs.GetString(PrefsUserId, "anonymous");
            req.SetRequestHeader("X-User-Id", userId);
        }

        private void ClearList()
        {
            if (modelListContent == null)
            {
                return;
            }

            for (var i = modelListContent.childCount - 1; i >= 0; i--)
            {
                Destroy(modelListContent.GetChild(i).gameObject);
            }
        }

        private void CreateRow(string baseUrl, ViewerModelEntry entry)
        {
            var line = new GameObject("Row_" + entry.jobId);
            line.transform.SetParent(modelListContent, false);

            var rt = line.AddComponent<RectTransform>();
            rt.sizeDelta = new Vector2(0f, 52f);

            var le = line.AddComponent<LayoutElement>();
            le.minHeight = 52f;
            le.preferredHeight = 52f;

            var bg = line.AddComponent<Image>();
            bg.color = new Color(0.11f, 0.13f, 0.17f, 1f);
            bg.raycastTarget = true;

            var btn = line.AddComponent<Button>();
            btn.targetGraphic = bg;

            var labelGo = new GameObject("Label");
            labelGo.transform.SetParent(line.transform, false);
            var lrt = labelGo.AddComponent<RectTransform>();
            lrt.anchorMin = Vector2.zero;
            lrt.anchorMax = Vector2.one;
            lrt.offsetMin = new Vector2(10f, 4f);
            lrt.offsetMax = new Vector2(-10f, -4f);
            var txt = labelGo.AddComponent<Text>();
            txt.font = _uiFont;
            txt.fontSize = 17;
            txt.color = new Color(0.92f, 0.94f, 0.98f);
            txt.alignment = TextAnchor.MiddleLeft;
            txt.horizontalOverflow = HorizontalWrapMode.Wrap;
            txt.verticalOverflow = VerticalWrapMode.Truncate;
            txt.raycastTarget = false;
            var sb = new StringBuilder();
            sb.Append(entry.jobId);
            sb.Append("  [");
            sb.Append(entry.status ?? "?");
            sb.Append("]\n");
            sb.Append(string.IsNullOrEmpty(entry.prompt) ? "(no prompt)" : entry.prompt);
            txt.text = sb.ToString();

            var path = string.IsNullOrEmpty(entry.glbPath) ? $"/outputs/{entry.jobId}/model.glb" : entry.glbPath;
            if (!path.StartsWith("/", StringComparison.Ordinal))
            {
                path = "/" + path;
            }

            var full = baseUrl + path;
            btn.onClick.AddListener(() => glbLoader.LoadRemoteUrl(full));
        }
    }
}
