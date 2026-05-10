from __future__ import annotations

from django.urls import path, re_path
from django.views.static import serve

from app.config import OUTPUTS_DIR
from app import views_api, views_composio

urlpatterns = [
    path("health", views_api.health),
    path("ready", views_api.ready),
    path("composio/toolkits", views_composio.composio_toolkits),
    path("composio/connect", views_composio.composio_connect),
    path("composio/disconnect", views_composio.composio_disconnect),
    path("composio/fetch", views_composio.composio_fetch),
    path("composio/drive/browse", views_composio.composio_drive_browse),
    path("generate", views_api.generate),
    path("assets/analyze", views_api.analyze_assets),
    path("viewer/models", views_api.list_viewer_models),
    path("jobs", views_api.list_jobs),
    path("jobs/<str:job_id>", views_api.job_route),
    path("jobs/<str:job_id>/confirm-image-generation", views_api.confirm_image_generation),
    path("jobs/<str:job_id>/save-image-generation-preview", views_api.save_image_generation_preview),
    path("jobs/<str:job_id>/confirm-concept", views_api.confirm_concept),
    path("jobs/<str:job_id>/regenerate-concept", views_api.regenerate_concept_references),
    path("jobs/<str:job_id>/add-concept-style", views_api.add_concept_style),
    path("jobs/<str:job_id>/select-concept-style", views_api.select_concept_style),
    path("jobs/<str:job_id>/regenerate-3d", views_api.regenerate_mesh),
    path("jobs/<str:job_id>/manufacturing-brief", views_api.manufacturing_brief),
    path("jobs/<str:job_id>/supplier-contact", views_api.supplier_contact),
    path("jobs/<str:job_id>/cancel", views_api.cancel_job),
    re_path(
        r"^outputs/(?P<path>.*)$",
        serve,
        {"document_root": str(OUTPUTS_DIR)},
    ),
]
