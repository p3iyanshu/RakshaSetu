#!/usr/bin/env python3
"""
Spawns NPC vehicles (autopilot, via TrafficManager) and pedestrians
(walker.ai controllers) into an already-running CARLA world -- this is what
makes the "dynamic environment" requirement real rather than hoped-for
(PROJECT_EXECUTION_PLAN.md SS4.4). Run once, after carla_ros_bridge and
carla_spawn_objects (the ego vehicle) are already up.

Both TrafficManager autopilot and walker AI controllers run server-side
once started -- this script does not need to stay connected afterward.

    python3 spawn_traffic.py --host 172.30.16.1 --port 2000

--host defaults to the WSL2 default-gateway IP (`ip route show default`),
since that's where CARLA runs natively on Windows in this project's setup
(see ros2_ws/src/rakshasetu/README.md's "Running against CARLA" section) --
override it if your own environment differs.
"""
import argparse
import random

import os
import sys

_SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
if _SCRIPT_DIR not in sys.path:
    sys.path.insert(0, _SCRIPT_DIR)

from carla_session import connect_world


def spawn_traffic(host, port, n_vehicles, n_walkers, timeout):
    client, world = connect_world(host, port, timeout=timeout)

    tm = client.get_trafficmanager()
    tm_port = tm.get_port()
    # Must match carla_ros_bridge's synchronous_mode (run_demo.sh sets false).
    tm.set_synchronous_mode(world.get_settings().synchronous_mode)

    bp_lib = world.get_blueprint_library()
    spawn_points = world.get_map().get_spawn_points()
    random.shuffle(spawn_points)

    vehicle_bps = [bp for bp in bp_lib.filter("vehicle.*")
                   if int(bp.get_attribute("number_of_wheels")) == 4]

    # skip the first spawn point -- that's where the ego vehicle
    # (carla_spawn_objects) most likely landed
    vehicle_batch = []
    for sp in spawn_points[1:1 + n_vehicles]:
        bp = random.choice(vehicle_bps)
        if bp.has_attribute("color"):
            bp.set_attribute("color", random.choice(bp.get_attribute("color").recommended_values))
        vehicle_batch.append(carla.command.SpawnActor(bp, sp))

    vehicle_ids = []
    for r in client.apply_batch_sync(vehicle_batch, True):
        if r.error:
            print("vehicle spawn error:", r.error)
        else:
            vehicle_ids.append(r.actor_id)

    client.apply_batch_sync(
        [carla.command.SetAutopilot(vid, True, tm_port) for vid in vehicle_ids], True)
    print(f"spawned {len(vehicle_ids)} NPC vehicles with autopilot")

    walker_bps = bp_lib.filter("walker.pedestrian.*")
    walker_transforms = []
    for _ in range(n_walkers):
        loc = world.get_random_location_from_navigation()
        if loc is not None:
            walker_transforms.append(carla.Transform(loc))

    walker_batch = [carla.command.SpawnActor(random.choice(walker_bps), t) for t in walker_transforms]
    walker_ids = []
    for r in client.apply_batch_sync(walker_batch, True):
        if r.error:
            print("walker spawn error:", r.error)
        else:
            walker_ids.append(r.actor_id)

    controller_bp = bp_lib.find("controller.ai.walker")
    controller_batch = [carla.command.SpawnActor(controller_bp, carla.Transform(), wid) for wid in walker_ids]
    controller_ids = [r.actor_id for r in client.apply_batch_sync(controller_batch, True) if not r.error]

    # the bridge is the authoritative ticker in synchronous mode -- never
    # call world.tick() ourselves here, just wait for its next tick before
    # touching the walker controllers we just spawned
    world.wait_for_tick()

    for cid in controller_ids:
        controller = world.get_actor(cid)
        controller.start()
        dest = world.get_random_location_from_navigation()
        if dest is not None:
            controller.go_to_location(dest)
        controller.set_max_speed(1.0 + random.random())

    print(f"spawned {len(controller_ids)} walkers with AI controllers")
    return vehicle_ids, walker_ids, controller_ids


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--host", default="172.30.16.1")
    parser.add_argument("--port", type=int, default=2000)
    parser.add_argument("--vehicles", type=int, default=8)
    parser.add_argument("--walkers", type=int, default=8)
    parser.add_argument("--timeout", type=float, default=15.0)
    args = parser.parse_args()

    spawn_traffic(args.host, args.port, args.vehicles, args.walkers, args.timeout)
