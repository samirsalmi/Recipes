from app.database import sync_url


def test_sync_url_normalizes_hosted_postgres_urls():
    assert sync_url("postgres://u:p@h:1234/db") == "postgresql+psycopg://u:p@h:1234/db"
    assert sync_url("postgresql://u:p@h:1234/db") == "postgresql+psycopg://u:p@h:1234/db"
    assert sync_url("postgresql+asyncpg://u:p@h:1234/db") == "postgresql+psycopg://u:p@h:1234/db"
    assert sync_url("postgresql+psycopg://u:p@h:1234/db") == "postgresql+psycopg://u:p@h:1234/db"


def test_sync_url_translates_ssl_flag_for_psycopg3():
    assert sync_url("postgresql://u:p@h:1234/db?ssl=true") == "postgresql+psycopg://u:p@h:1234/db?sslmode=require"
    assert sync_url("postgres://u:p@h:1234/db?ssl=require&application_name=mise") == (
        "postgresql+psycopg://u:p@h:1234/db?sslmode=require&application_name=mise"
    )
    assert sync_url("postgresql://u:p@h:1234/db?ssl=false") == "postgresql+psycopg://u:p@h:1234/db?sslmode=disable"
