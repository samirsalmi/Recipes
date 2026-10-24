from fastapi import Depends, FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text
from sqlalchemy.orm import Session

from .database import get_db
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


@app.get("/api/health/db")
def health_db(db: Session = Depends(get_db)):
    """Also touches the database: point a keep-warm pinger here so both the API and the
    database wake up before someone opens the app."""
    db.execute(text("SELECT 1"))
    return {"status": "alive", "database": "reachable"}
