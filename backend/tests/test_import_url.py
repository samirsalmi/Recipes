"""import-url: JSON-LD parsing on a saved page (no network) and the SSRF guard."""

from pathlib import Path

import pytest

from app.import_url import ImportError_, check_url, parse_duration, parse_recipe_html

FIXTURE = Path(__file__).parent / "fixtures" / "recipe_page.html"


def test_parses_schema_org_recipe_from_graph():
    draft = parse_recipe_html(FIXTURE.read_text(encoding="utf-8"), "https://example.com/lentil-soup")
    assert draft["name"] == "Red Lentil Soup & Lemon"
    assert draft["description"] == "A quick, warming soup."
    assert draft["image"] == "https://images.example.com/lentil-soup.jpg"
    assert draft["servings"] == 4
    assert (draft["prepTime"], draft["cookTime"], draft["totalTime"]) == (10, 25, 35)
    assert draft["cuisine"] == "Turkish"
    assert draft["mealTypes"] == ["dinner"]
    assert draft["tags"] == ["soup", "lentils", "vegan"]
    assert draft["ingredientLines"][0] == "1 ½ cups red lentils"
    assert draft["steps"] == [
        "Soften the onion in the oil for 5 minutes.",
        "Add lentils and 1 l water; simmer 20 minutes.",
        "Season and serve with lemon.",
    ]
    assert draft["nutrition"] == {"calories": 310.0}
    assert draft["source"]["url"] == "https://example.com/lentil-soup"
    assert draft["source"]["title"] == "Example Kitchen"
    assert draft["source"]["author"] == "Sam Cook"
    assert draft["isPublic"] is False


def test_page_without_recipe_is_rejected():
    with pytest.raises(ImportError_):
        parse_recipe_html("<html><head><title>x</title></head></html>", "https://example.com")


def test_durations():
    assert parse_duration("PT1H30M") == 90
    assert parse_duration("P1DT2H") == 1560
    assert parse_duration("PT45S") == 0
    assert parse_duration("soon") is None
    assert parse_duration(None) is None


@pytest.mark.parametrize("url", [
    "file:///etc/passwd",
    "ftp://example.com/x",
    "http://127.0.0.1/",
    "http://localhost:8000/api",
    "http://10.0.0.5/",
    "http://192.168.1.1/",
    "http://169.254.169.254/latest/meta-data/",
    "http://[::1]/",
    "http://[::ffff:127.0.0.1]/",
    "http://0.0.0.0/",
    "http://100.64.0.1/",
    "http://user:pw@93.184.216.34/",
])
def test_ssrf_guard_blocks(url):
    with pytest.raises(ImportError_):
        check_url(url)


def test_ssrf_guard_allows_public_ip_literal():
    check_url("https://93.184.216.34/recipe")  # IP literal: resolves locally, no network


def test_import_endpoint_requires_auth_and_rejects_private(client, register):
    assert client.post("/api/recipes/import-url", json={"url": "https://example.com"}).status_code == 401
    h = register("cook")
    res = client.post("/api/recipes/import-url", headers=h, json={"url": "http://127.0.0.1:8000/"})
    assert res.status_code == 422
    assert "allowed" in res.json()["detail"]
