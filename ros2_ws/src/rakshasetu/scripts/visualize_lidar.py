#!/usr/bin/env python3
"""
Draws the ego vehicle's live LiDAR scan as colored points directly in the
CARLA window -- makes the sensor's actual detections visible for a demo,
rather than just trusting that it's "working" from a topic rate number.

Attaches its own listener to the same LiDAR sensor actor carla_ros_bridge
is already streaming from (config/objects.json) -- CARLA sensors support
multiple simultaneous listeners, so this doesn't interfere with the real
pipeline (lidar_ingest_node keeps getting the full, real data either way).
This script only ever reads sensor data and draws debug points; nothing it
does is visible to, or can affect, the actual rakshasetu pipeline.

Points are colored by height above the sensor (green = low/ground, red =
high) and heavily subsampled (STRIDE) -- a full scan is ~10-30k points/
frame, and drawing every one of them as a separate debug-point RPC call
would flood the connection and stall the simulation.

Run in its own terminal AFTER run_demo.sh has reached "DEMO IS LIVE":

    python3 visualize_lidar.py --host 172.30.16.1 --port 2000
"""
import argparse
import time

import carla

STRIDE = 15  # draw every Nth point -- tune down for a denser look, up if it stutters
POINT_SIZE = 0.06
LIFE_TIME = 0.15  # slightly longer than one scan interval so points don't flicker


def find_ego_lidar(world):
    for actor in world.get_actors().filter("sensor.lidar.ray_cast"):
        parent = actor.parent
        if parent is not None and parent.attributes.get("role_name") == "ego_vehicle":
            return actor
    return None


def height_to_color(z):
    # z is height relative to the sensor (roughly ground level and below at
    # the low end, up to a couple meters for tall obstacles/vehicles) --
    # clamp and map to a green(low) -> yellow -> red(high) gradient.
    t = max(0.0, min(1.0, (z + 1.0) / 4.0))
    r = int(255 * t)
    g = int(255 * (1.0 - t))
    return carla.Color(r=r, g=g, b=40)


def make_callback(world, stats):
    def on_lidar_data(measurement):
        stats["frames"] += 1
        stats["points_last_frame"] = len(measurement)
        sensor_transform = measurement.transform
        for i in range(0, len(measurement), STRIDE):
            detection = measurement[i]
            local = carla.Location(x=detection.point.x, y=detection.point.y, z=detection.point.z)
            world_point = sensor_transform.transform(local)
            world.debug.draw_point(
                world_point, size=POINT_SIZE, color=height_to_color(detection.point.z),
                life_time=LIFE_TIME,
            )
    return on_lidar_data


def main(host, port, timeout):
    client = carla.Client(host, port)
    client.set_timeout(timeout)
    world = client.get_world()

    lidar = find_ego_lidar(world)
    while lidar is None:
        print("waiting for ego_vehicle's lidar sensor to spawn...")
        time.sleep(1.0)
        lidar = find_ego_lidar(world)

    print(f"found lidar sensor (actor {lidar.id}) -- drawing scan in the CARLA window")
    print(f"stride={STRIDE} (drawing 1 in every {STRIDE} points), Ctrl+C to stop")

    stats = {"frames": 0, "points_last_frame": 0}
    lidar.listen(make_callback(world, stats))

    try:
        while True:
            time.sleep(2.0)
            print(f"  frames drawn: {stats['frames']}, "
                  f"last frame: {stats['points_last_frame']} points "
                  f"({stats['points_last_frame'] // STRIDE} drawn)")
    except KeyboardInterrupt:
        print("\nstopping (the sensor keeps streaming to the real pipeline regardless)")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--host", default="172.30.16.1")
    parser.add_argument("--port", type=int, default=2000)
    parser.add_argument("--timeout", type=float, default=15.0)
    args = parser.parse_args()
    main(args.host, args.port, args.timeout)
