#!/usr/bin/env python3
"""
Puts the ego vehicle on autopilot (so it roams the streets on its own)
and moves CARLA's spectator camera into a chase-cam position behind it
every tick, so the CarlaUE4 window actually shows the vehicle driving
through traffic -- by default the spectator camera is a free-floating
viewpoint completely independent of any spawned actor, so without this the
window just shows wherever it was last pointed (see this project's own
discovery of that on 2026-09-15).

LiDAR detection itself needs nothing extra here -- the ego vehicle's
sensor.lidar.ray_cast (config/objects.json) is already streaming into
carla_ros_bridge -> lidar_ingest_node -> the real segmentation/grid/
tracking/fusion pipeline the moment the car exists, roaming or not. This
script only makes that visually obvious by giving you a camera that
actually watches it happen.

Prefer letting run_demo.sh start follow_road.py (--camera) instead -- that
snaps the car onto Driving lanes and follows curves. Only use this script
if you started the pipeline without run_demo.sh.

Run AFTER the ego_vehicle actor exists. Ctrl+C to stop.

    python3 follow_ego_vehicle.py --host 172.30.16.1 --port 2000
"""
import argparse
import os
import sys
import time

import carla

_SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
if _SCRIPT_DIR not in sys.path:
    sys.path.insert(0, _SCRIPT_DIR)

from ego_road_utils import snap_ego_to_road


def find_ego(world):
    for actor in world.get_actors().filter("vehicle.*"):
        if actor.attributes.get("role_name") == "ego_vehicle":
            return actor
    return None


def follow(host, port, timeout, distance, height):
    client = carla.Client(host, port)
    client.set_timeout(timeout)
    world = client.get_world()

    ego = find_ego(world)
    while ego is None:
        print("waiting for ego_vehicle to spawn...")
        time.sleep(1.0)
        ego = find_ego(world)

    snap_ego_to_road(world, ego)
    tm_port = client.get_trafficmanager().get_port()
    ego.set_autopilot(True, tm_port)
    print(f"found ego_vehicle (actor {ego.id}), snapped to road, autopilot on")
    print("following with the spectator camera -- Ctrl+C to stop")

    spectator = world.get_spectator()

    while True:
        world.wait_for_tick()
        if not ego.is_alive:
            # e.g. run_demo.sh was restarted in another terminal and a new
            # ego_vehicle actor was spawned -- don't just crash, pick it up
            print("ego_vehicle actor no longer alive -- looking for a new one...")
            ego = find_ego(world)
            while ego is None:
                time.sleep(1.0)
                ego = find_ego(world)
            ego.set_autopilot(True, tm_port)
            print(f"found ego_vehicle (actor {ego.id}), autopilot on -- resuming follow")
            continue

        transform = ego.get_transform()
        forward = transform.get_forward_vector()
        cam_location = transform.location - forward * distance
        cam_location.z += height
        cam_rotation = carla.Rotation(pitch=-15.0, yaw=transform.rotation.yaw, roll=0.0)
        spectator.set_transform(carla.Transform(cam_location, cam_rotation))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--host", default="172.30.16.1")
    parser.add_argument("--port", type=int, default=2000)
    parser.add_argument("--timeout", type=float, default=15.0)
    parser.add_argument("--distance", type=float, default=8.0, help="meters behind the vehicle")
    parser.add_argument("--height", type=float, default=4.0, help="meters above the vehicle")
    args = parser.parse_args()

    try:
        follow(args.host, args.port, args.timeout, args.distance, args.height)
    except KeyboardInterrupt:
        print("\nstopped")
