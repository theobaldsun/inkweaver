"""
InkWeaver 本机嵌入服务（BAAI/bge-small-zh-v1.5）。

用途：为云端 Nest 提供 HTTP /embed 与 /health；经 FRP 暴露时务必开启 Token。
输入：POST /embed { "texts": ["..."] }
输出：{ "vectors": [[...512 floats...]] }
"""

from __future__ import annotations

import os

os.environ.setdefault("HF_ENDPOINT", "https://hf-mirror.com")

from typing import List

from fastapi import Depends, FastAPI, Header, HTTPException
from pydantic import BaseModel, Field

MODEL_NAME = os.getenv("EMBED_MODEL_NAME", "BAAI/bge-small-zh-v1.5")
EXPECTED_DIM = int(os.getenv("EMBED_DIMENSIONS", "512"))
SERVICE_TOKEN = os.getenv("EMBED_SERVICE_TOKEN", "").strip()

app = FastAPI(title="InkWeaver Embed Service", version="0.1.0")
_model = None


class EmbedRequest(BaseModel):
    texts: List[str] = Field(default_factory=list)


class EmbedResponse(BaseModel):
    vectors: List[List[float]]


def require_token(authorization: str | None = Header(default=None)) -> None:
    if not SERVICE_TOKEN:
        return
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="缺少 Bearer Token")
    token = authorization.removeprefix("Bearer ").strip()
    if token != SERVICE_TOKEN:
        raise HTTPException(status_code=401, detail="Token 无效")


def get_model():
    global _model
    if _model is None:
        from sentence_transformers import SentenceTransformer

        _model = SentenceTransformer(MODEL_NAME)
    return _model


@app.get("/health")
def health(_: None = Depends(require_token)) -> dict:
    return {"ok": True, "model": MODEL_NAME, "dimensions": EXPECTED_DIM}


@app.post("/embed", response_model=EmbedResponse)
def embed(body: EmbedRequest, _: None = Depends(require_token)) -> EmbedResponse:
    if not body.texts:
        return EmbedResponse(vectors=[])

    model = get_model()
    vectors = model.encode(
        body.texts,
        normalize_embeddings=True,
        show_progress_bar=False,
    ).tolist()

    for vector in vectors:
        if len(vector) != EXPECTED_DIM:
            raise HTTPException(
                status_code=500,
                detail=f"模型输出维度 {len(vector)} 与期望 {EXPECTED_DIM} 不一致",
            )

    return EmbedResponse(vectors=vectors)
