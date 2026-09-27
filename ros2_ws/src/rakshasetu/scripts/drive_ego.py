#!/usr/bin/env python3
"""
Directly drives the ego vehicle with manual control -- skips autopilot/
TrafficManager entirely, since that's been the unreliable part this
session (vehicles sometimes never move under autopilot regardless of spawn
point or TM sync-mode fixes). Backs up briefly first in case it's spawned
against something, then drives forward with gentle wandering turns,
continuously, until stopped.

Run any time the car needs to be moving -- doesn't require restarting
run_demo.sh or anything else, just needs the ego_vehicle actor to already
exist (run_demo.sh already up).

    python3 drive_ego.py --host 172.30.16.1 --port 2000
"""
import argparse
import random
import time

import carla


def find_ego(world):
    for actor in world.get_actors().filter("vehicle.*"):
        if actor.attributes.get("role_name") == "ego_vehicle":
            return actor
    return None


def drive(host, port, timeout):
    client = carla.Client(host, port)
    client.set_timeout(timeout)
    world = client.get_world()

    ego = find_ego(world)
    while ego is None:
        print("waiting for ego_vehicle to spawn...")
        time.sleep(1.0)
        ego = find_ego(world)

    ego.set_autopilot(False)
    print(f"driving actor {ego.id} directly -- Ctrl+C to stop")

    print("reversing 2s first, in case it's against something...")
    t0 = time.time()
    while time.time() - t0 < 2.0:
        ego.apply_control(carla.VehicleControl(throttle=0.5, steer=0.0, reverse=True))
        time.sleep(0.1)

    steer = 0.0
    t0 = time.time()
    while True:
        steer = max(-0.4, min(0.4, steer + random.uniform(-0.05, 0.05)))
        ego.apply_control(carla.VehicleControl(throttle=0.6, steer=steer, reverse=False))
        time.sleep(0.1)
        if time.time() - t0 > 5.0:
            v = ego.get_velocity()
            speed = (v.x ** 2 + v.y ** 2 + v.z ** 2) ** 0.5
            print(f"speed: {speed:.2f} m/s")
            t0 = time.time()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--host", default="172.30.16.1")
    parser.add_argument("--port", type=int, default=2000)
    parser.add_argument("--timeout", type=float, default=15.0)
    args = parser.parse_args()
    try:
        drive(args.host, args.port, args.timeout)
    except KeyboardInterrupt:
        print("\nstopped")
