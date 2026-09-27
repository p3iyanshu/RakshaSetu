#!/usr/bin/env python3
"""One-shot: move ego_vehicle from a bad spawn (plaza/sidewalk) onto a Driving lane."""
import argparse
import time

import os
import sys

_SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
if _SCRIPT_DIR not in sys.path:
    sys.path.insert(0, _SCRIPT_DIR)

from carla_session import connect_world
from ego_road_utils import find_ego, snap_ego_to_road


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--host", default="172.30.16.1")
    parser.add_argument("--port", type=int, default=2000)
    parser.add_argument("--timeout", type=float, default=60.0)
    args = parser.parse_args()

    _, world = connect_world(args.host, args.port, timeout=args.timeout)

    ego = find_ego(world)
    while ego is None:
        print("waiting for ego_vehicle...")
        time.sleep(1.0)
        ego = find_ego(world)

    before = ego.get_transform().location
    route_wp = snap_ego_to_road(world, ego)
    after = ego.get_transform().location
    print(
        f"snapped ego {ego.id} from ({before.x:.1f},{before.y:.1f}) "
        f"to road ({after.x:.1f},{after.y:.1f})"
    )
    print(f"lane waypoint id {route_wp.id}")


if __name__ == "__main__":
    main()
