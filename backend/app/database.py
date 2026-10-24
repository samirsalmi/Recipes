from sqlalchemy import create_engine, event
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker
from sqlalchemy.pool import StaticPool

from .config import settings


def _make_engine(url: str):
    # The test suite runs on in-memory SQLite (one shared connection); the app runs on PostgreSQL.
    if url.startswith("sqlite"):
        # In-memory (tests): one shared connection, or each connection would get its own empty
        # database. File-based (local QA runs): a normal pool - sharing one connection across
        # FastAPI's worker threads corrupts its state.
        in_memory = url in ("sqlite://", "sqlite:///:memory:")
        eng = create_engine(
            url,
            connect_args={"check_same_thread": False},
            **({"poolclass": StaticPool} if in_memory else {}),
        )

        @event.listens_for(eng, "connect")
        def _fk_on(dbapi_connection, _record):
            dbapi_connection.execute("PRAGMA foreign_keys=ON")

        return eng
    return create_engine(url, pool_pre_ping=True)


engine = _make_engine(settings.database_url)
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)


class Base(DeclarativeBase):
    pass


def get_db():
    db: Session = SessionLocal()
    try:
        yield db
    finally:
        db.close()
