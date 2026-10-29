from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel, Field

from backend.services.paper_export_service import build_filename, render_figure

router = APIRouter()


class FigureExportRequest(BaseModel):
    figure_type: str = Field(..., description='histogram, line, scatter, single_score_iforest, paper_score_scatter, bar, ccdf, graph, graph_compare, table, radar')
    format: str = Field('pdf', description='png, svg, pdf')
    title: str | None = None
    filename: str | None = None
    payload: dict[str, Any] = Field(default_factory=dict)


MIME_TYPES = {
    'png': 'image/png',
    'svg': 'image/svg+xml',
    'pdf': 'application/pdf',
}


@router.post('/render')
def export_figure(req: FigureExportRequest):
    fmt = req.format.lower()
    if fmt not in MIME_TYPES:
        raise HTTPException(status_code=400, detail='format must be png, svg, or pdf')
    try:
        content = render_figure(req.figure_type, req.payload, fmt)
        filename = build_filename(req.filename, req.title, req.figure_type, fmt)
        headers = {'Content-Disposition': f'attachment; filename="{filename}"'}
        return Response(content=content, media_type=MIME_TYPES[fmt], headers=headers)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))
