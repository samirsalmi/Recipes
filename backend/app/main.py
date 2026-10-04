from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .config import settings
from .routers import auth, images, recipes, storage

app = FastAPI(title="Recipe Manager API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router)
app.include_router(images.router)
app.include_router(recipes.router)
app.include_router(storage.router)


@app.get("/api/health")
def health():
    return {"status": "ok"}
