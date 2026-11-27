"""python -m web  →  http://localhost:8000"""
import os

import uvicorn


def main() -> None:
    host = os.getenv("WEB_HOST", "127.0.0.1")
    port = int(os.getenv("WEB_PORT", "8000"))
    print(f"Проверка ТЗ: откройте http://localhost:{port}")
    uvicorn.run("web.app:app", host=host, port=port, reload=os.getenv("WEB_RELOAD") == "1")


if __name__ == "__main__":
    main()
