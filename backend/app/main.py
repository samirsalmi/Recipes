from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .routers import auth, favorites, groceries, household, images, plan, recipes, storage

app = FastAPI(title="Mise API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router)
app.include_router(images.router)
app.include_router(recipes.router)
app.include_router(storage.router)
app.include_router(household.router)
app.include_router(plan.router)
app.include_router(favorites.router)
app.include_router(groceries.router)


@app.get("/health")
@app.get("/api/health")
def health_check():
    return {"status": "alive"}
