import sys
from pathlib import Path
from fastapi import Request

# Add project root directory to sys.path
ROOT_DIR = Path(__file__).resolve().parent.parent
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

from backend.main import app

@app.middleware("http")
async def handle_vercel_routing(request: Request, call_next):
    raw_path = request.scope.get("raw_path", b"").decode("utf-8")
    path = request.scope.get("path", "")
    
    # Restore original path if rewritten to /api/index.py or /api
    if "index.py" in path or path == "/api":
        orig = request.headers.get("x-matched-path") or request.headers.get("x-forwarded-uri") or raw_path
        if orig and orig.startswith("/api"):
            request.scope["path"] = orig
        elif path.startswith("/api/index.py/"):
            request.scope["path"] = path.replace("/api/index.py", "")
        elif path.startswith("/index.py/"):
            request.scope["path"] = path.replace("/index.py", "")
    
    return await call_next(request)
