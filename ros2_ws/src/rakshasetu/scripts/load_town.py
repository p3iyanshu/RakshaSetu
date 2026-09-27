#!/usr/bin/env python3
"""Load a CARLA map and print status."""
import sys
import time

import carla

HOST = sys.argv[1] if len(sys.argv) > 1 else "172.30.16.1"
PORT = int(sys.argv[2]) if len(sys.argv) > 2 else 2000
TOWN = sys.argv[3] if len(sys.argv) > 3 else "Town13"

client = carla.Client(HOST, PORT)
client.set_timeout(30.0)

for attempt in range(60):
    try:
        print("server version:", client.get_server_version())
        break
    except RuntimeError:
        print(f"waiting for CARLA server... ({attempt + 1}/60)")
        time.sleep(2)
else:
    raise SystemExit("CARLA server not reachable")

available = [m.split("/")[-1] for m in client.get_available_maps()]
print("available maps:", ", ".join(available))
if TOWN not in available:
    raise SystemExit(f"{TOWN} not in available maps")

current = client.get_world().get_map().name.split("/")[-1]
print("current map before load:", current)
if current != TOWN:
    print(f"loading {TOWN} (first load can take several minutes)...")
    client.set_timeout(300.0)
    client.load_world(TOWN)
    print("load_world returned")

client.set_timeout(30.0)
print("current map after load:", client.get_world().get_map().name)
