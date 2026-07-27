from fastapi import APIRouter, Depends, Query

from app.docs_analysis.models import DocsAnalysisSummary, DocsGenerateRequest, DocsGenerateResponse
from app.docs_analysis.service import DocsAnalysisService

router = APIRouter(prefix="/docs", tags=["docs-analysis"])

_docs_analysis_service = DocsAnalysisService()


def get_docs_analysis_service() -> DocsAnalysisService:
    return _docs_analysis_service


@router.get("/analyze")
def analyze_workspace(
    workspace_root: str = Query(min_length=1),
    max_files: int = Query(default=5, ge=1, le=20),
    service: DocsAnalysisService = Depends(get_docs_analysis_service),
) -> DocsAnalysisSummary:
    return service.analyze_workspace(workspace_root, max_files=max_files)


@router.post("/generate")
def generate_docs(
    request: DocsGenerateRequest,
    service: DocsAnalysisService = Depends(get_docs_analysis_service),
) -> DocsGenerateResponse:
    return service.generate_markdown(request.workspace_root, max_files=request.max_files)
