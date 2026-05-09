from __future__ import annotations

from django.urls import path, re_path
from django.views.static import serve

from app.config import OUTPUTS_DIR
from app import views_api, views_composio

urlpatterns = [
    path("health", views_api.health),
    path("ready", views_api.ready),
    path("sample-prompts", views_api.sample_prompts),
    path("composio/toolkits", views_composio.composio_toolkits),
    path("composio/connect", views_composio.composio_connect),
    path("composio/disconnect", views_composio.composio_disconnect),
    path("composio/fetch", views_composio.composio_fetch),
    path("composio/drive/browse", views_composio.composio_drive_browse),
    path("generate", views_api.generate),
    path("jobs/<str:job_id>", views_api.get_job),
    path("jobs/<str:job_id>/confirm-concept", views_api.confirm_concept),
    path("jobs/<str:job_id>/cancel", views_api.cancel_job),
    re_path(
        r"^outputs/(?P<path>.*)$",
        serve,
        {"document_root": str(OUTPUTS_DIR)},
    ),
]
