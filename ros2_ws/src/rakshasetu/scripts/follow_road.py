#!/usr/bin/env python3
"""
Drives the ego vehicle continuously along the actual road network, using
CARLA's waypoint graph -- this is what makes it follow curves and stay in
its own lane, rather than driving straight off the road (steer=0 forever)
or hopping between lanes.

Also snaps the ego onto a valid Driving lane on start (plaza/sidewalk spawns
from carla_spawn_objects are common on Town10HD_Opt) and optionally moves
the spectator chase camera so the CarlaUE4 window shows the car.

    python3 follow_road.py --host 172.30.16.1 --port 2000
"""
import argparse
import math
import os
import sys
import time

_SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
if _SCRIPT_DIR not in sys.path:
    sys.path.insert(0, _SCRIPT_DIR)

from carla_session import connect_world
from ego_road_utils import find_ego, snap_ego_to_road


def drive(host, port, timeout, throttle, base_lookahead, chase_camera, cam_distance, cam_height):
    _, world = connect_world(host, port, timeout=timeout)
    time.sleep(0.5)
    carla_map = world.get_map()
    spectator = world.get_spectator() if chase_camera else None

    ego = find_ego(world)
    while ego is None:
        print("waiting for ego_vehicle to spawn...")
        time.sleep(1.0)
        ego = find_ego(world)

    route_wp = snap_ego_to_road(world, ego, carla_map)
    loc = ego.get_transform().location
    print(
        f"driving actor {ego.id} on Driving lanes from ({loc.x:.1f},{loc.y:.1f}) "
        f"-- Ctrl+C to stop"
    )
    if chase_camera:
        print("spectator chase camera enabled")

    steer_smoothed = 0.0
    t_report = time.time()
    t_stall_check = time.time()
    stall_streak = 0

    while True:
        if not ego.is_alive:
            print("ego_vehicle no longer alive -- looking for a new one...")
            ego = find_ego(world)
            while ego is None:
                time.sleep(1.0)
                ego = find_ego(world)
            route_wp = snap_ego_to_road(world, ego, carla_map)
            steer_smoothed = 0.0
            continue

        transform = ego.get_transform()
        loc = transform.location
        yaw = math.radians(transform.rotation.yaw)

        v = ego.get_velocity()
        speed = (v.x ** 2 + v.y ** 2 + v.z ** 2) ** 0.5
        lookahead = base_lookahead + speed * 0.5

        dist_to_target = math.hypot(
            route_wp.transform.location.x - loc.x,
            route_wp.transform.location.y - loc.y,
        )
        if dist_to_target < max(3.0, lookahead * 0.5):
            nxt = route_wp.next(lookahead)
            if nxt:
                route_wp = nxt[0]

        target = route_wp.transform.location
        dx = target.x - loc.x
        dy = target.y - loc.y
        desired_yaw = math.atan2(dy, dx)
        error = math.atan2(math.sin(desired_yaw - yaw), math.cos(desired_yaw - yaw))
        raw_steer = max(-1.0, min(1.0, error * 1.15))
        steer_smoothed = 0.78 * steer_smoothed + 0.22 * raw_steer
        this_throttle = throttle * max(0.35, 1.0 - abs(error) * 0.85)

        ego.apply_control(
            carla.VehicleControl(throttle=this_throttle, steer=steer_smoothed, reverse=False)
        )

        if spectator is not None:
            forward = transform.get_forward_vector()
            cam_location = transform.location - forward * cam_distance
            cam_location.z += cam_height
            cam_rotation = carla.Rotation(
                pitch=-12.0, yaw=transform.rotation.yaw, roll=0.0
            )
            spectator.set_transform(carla.Transform(cam_location, cam_rotation))

        time.sleep(0.05)

        if time.time() - t_stall_check > 3.0:
            if speed < 0.25:
                stall_streak += 1
                if stall_streak >= 2:
                    print(f"stalled at ({loc.x:.1f},{loc.y:.1f}) -- re-snapping to road")
                    route_wp = snap_ego_to_road(world, ego, carla_map)
                    steer_smoothed = 0.0
                    stall_streak = 0
            else:
                stall_streak = 0
            t_stall_check = time.time()

        if time.time() - t_report > 5.0:
            print(f"speed: {speed:.2f} m/s, location=({loc.x:.1f},{loc.y:.1f})")
            t_report = time.time()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--host", default="172.30.16.1")
    parser.add_argument("--port", type=int, default=2000)
    parser.add_argument("--timeout", type=float, default=60.0)
    parser.add_argument("--throttle", type=float, default=0.20, help="gentle cruise speed")
    parser.add_argument("--lookahead", type=float, default=5.0)
    parser.add_argument(
        "--camera",
        action="store_true",
        default=True,
        help="move spectator behind the ego (default: on)",
    )
    parser.add_argument("--no-camera", action="store_false", dest="camera")
    parser.add_argument("--cam-distance", type=float, default=9.0)
    parser.add_argument("--cam-height", type=float, default=4.5)
    args = parser.parse_args()
    try:
        drive(
            args.host,
            args.port,
            args.timeout,
            args.throttle,
            args.lookahead,
            args.camera,
            args.cam_distance,
            args.cam_height,
        )
    except KeyboardInterrupt:
        print("\nstopped")
