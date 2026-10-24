def test_health_is_lightweight(client):
    for path in ("/health", "/api/health"):
        res = client.get(path)
        assert res.status_code == 200
        assert res.json() == {"status": "alive"}


def test_db_health_touches_the_database(client):
    res = client.get("/api/health/db")
    assert res.status_code == 200
    assert res.json() == {"status": "alive", "database": "reachable"}


def test_cors_allows_any_origin(client):
    res = client.get("/health", headers={"Origin": "https://example.vercel.app"})
    assert res.headers["access-control-allow-origin"] == "*"
