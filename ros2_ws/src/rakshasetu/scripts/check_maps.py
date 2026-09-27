#!/usr/bin/env python3
"""Quick CARLA connectivity + map listing helper."""
import sys

import carla

HOST = sys.argv[1] if len(sys.argv) > 1 else "172.30.16.1"
PORT = int(sys.argv[2]) if len(sys.argv) > 2 else 2000

client = carla.Client(HOST, PORT)
client.set_timeout(10.0)
print("server version:", client.get_server_version())
print("current map:", client.get_world().get_map().name)
print("available maps:")
for name in client.get_available_maps():
    print(" ", name)
