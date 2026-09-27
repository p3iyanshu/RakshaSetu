"""Connect to CARLA with retries (Town13 + sync bridge can stall brief RPCs)."""
import time

import carla


def connect_world(host, port, timeout=60.0, retries=12, pause=2.0):
    """Return a live carla.World, or raise RuntimeError."""
    last_err = None
    client = carla.Client(host, port)
    for attempt in range(retries):
        client.set_timeout(timeout)
        try:
            world = client.get_world()
            return client, world
        except RuntimeError as exc:
            last_err = exc
            if attempt + 1 < retries:
                time.sleep(pause)
    raise RuntimeError(
        f"could not connect to CARLA at {host}:{port} after {retries} tries: {last_err}"
    )
