def main() -> None:
    import uvicorn

    from backend import config

    # Bind to loopback only: Genth is never reachable from the network.
    uvicorn.run("backend.app:app", host=config.HOST, port=config.PORT, reload=True)
