from fastapi import FastAPI
from fastapi.testclient import TestClient

from bpps.frontend import mount_frontend


def test_serves_react_build_and_redirects(tmp_path):
    (tmp_path / "index.html").write_text(
        "<title>Courtside</title><div id='root'></div>"
    )
    (tmp_path / "assets").mkdir()
    (tmp_path / "assets" / "app.js").write_text("console.log('React');")
    app = FastAPI()
    mount_frontend(app, tmp_path)
    with TestClient(app) as client:
        assert client.get("/", follow_redirects=False).headers["location"] == "/ui/"
        assert "Courtside" in client.get("/ui/").text
        asset = client.get("/ui/assets/app.js")
        assert asset.status_code == 200
        assert "React" in asset.text
        assert client.get("/ui/assets/missing.js").status_code == 404
        assert client.get("/ui/../pyproject.toml").status_code == 404


def test_missing_build_keeps_api_available(tmp_path):
    app = FastAPI()

    @app.get("/health")
    def health():
        return {"status": "ok"}

    mount_frontend(app, tmp_path)
    with TestClient(app) as client:
        response = client.get("/ui/")
        assert response.status_code == 503
        assert "npm ci" in response.text
        assert client.get("/health").json() == {"status": "ok"}
        assert client.get("/docs").status_code == 200
