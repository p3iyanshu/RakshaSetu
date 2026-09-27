#!/usr/bin/env python3
"""
Destroys every vehicle, walker, walker-AI-controller, and sensor actor
currently in the CARLA world -- run this before spawning fresh each time.

Why this is needed: repeated test/demo runs across a session leave actors
behind (an old run's ego vehicle, NPC traffic, etc.) even after their
owning ROS 2 processes are gone. A leftover vehicle sitting on a spawn
point causes the next carla_spawn_objects launch to fail outright with
"Spawn failed because of collision at spawn position" (observed live,
2026-09-16). Cleaning first makes every run start from a genuinely blank
slate regardless of what a previous session left behind.

    python3 clean_world.py --host 172.30.16.1 --port 2000
"""
import argparse
import os
import sys

import carla

_SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
if _SCRIPT_DIR not in sys.path:
    sys.path.insert(0, _SCRIPT_DIR)

from carla_session import connect_world


def clean(host, port, timeout, soft=False):
    try:
        client, world = connect_world(host, port, timeout=timeout, retries=8, pause=3.0)
    except RuntimeError as exc:
        if soft:
            print(f"WARNING: clean_world skipped (CARLA not responding): {exc}")
            return 1
        raise

    for controller in world.get_actors().filter("controller.ai.walker"):
        controller.stop()

    to_destroy = []
    for type_filter in ("vehicle.*", "walker.pedestrian.*", "controller.ai.walker", "sensor.*"):
        to_destroy.extend(world.get_actors().filter(type_filter))

    if not to_destroy:
        print("world already clean, nothing to destroy")
        return 0

    batch = [carla.command.DestroyActor(actor) for actor in to_destroy]
    results = client.apply_batch_sync(batch, True)
    failed = sum(1 for r in results if r.error)
    print(f"destroyed {len(to_destroy) - failed}/{len(to_destroy)} actors"
          + (f" ({failed} failed, see errors above)" if failed else ""))
    return 0


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--host", default="172.30.16.1")
    parser.add_argument("--port", type=int, default=2000)
    parser.add_argument("--timeout", type=float, default=30.0)
    parser.add_argument(
        "--soft",
        action="store_true",
        help="do not raise on connection failure (for use during demo retries)",
    )
    args = parser.parse_args()
    try:
        rc = clean(args.host, args.port, args.timeout, soft=args.soft)
    except RuntimeError:
        if args.soft:
            print("WARNING: clean_world failed")
            rc = 1
        else:
            raise
    raise SystemExit(rc)
