#!/usr/bin/env python3
"""Print x,y,z,roll,pitch,yaw for a validated Driving-lane spawn (carla_spawn_objects param)."""
import argparse
import os
import sys

_SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
if _SCRIPT_DIR not in sys.path:
    sys.path.insert(0, _SCRIPT_DIR)

from carla_session import connect_world
from ego_road_utils import iter_valid_driving_waypoints


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--host", default="172.30.16.1")
    parser.add_argument("--port", type=int, default=2000)
    args = parser.parse_args()

    _, world = connect_world(args.host, args.port)
    carla_map = world.get_map()
    spawn_points = carla_map.get_spawn_points()
    valid = sorted(
        iter_valid_driving_waypoints(carla_map, spawn_points),
        key=lambda wp: (wp.transform.location.x, wp.transform.location.y),
    )
    if not valid:
        raise SystemExit("no valid Driving spawn points on this map")
    t = valid[0].transform
    loc, rot = t.location, t.rotation
    print(f"{loc.x:.2f},{loc.y:.2f},{loc.z:.2f},{rot.roll:.2f},{rot.pitch:.2f},{rot.yaw:.2f}")


if __name__ == "__main__":
    main()
