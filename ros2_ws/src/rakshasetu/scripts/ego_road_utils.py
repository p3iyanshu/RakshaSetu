"""Shared helpers: snap ego vehicle onto Driving lanes and pick route waypoints."""
import math
import random
import time

import carla


def find_ego(world):
    for actor in world.get_actors().filter("vehicle.*"):
        if actor.attributes.get("role_name") == "ego_vehicle":
            return actor
    return None


def forward_vector(rotation_yaw_deg):
    yaw = math.radians(rotation_yaw_deg)
    return math.cos(yaw), math.sin(yaw)


def iter_valid_driving_waypoints(carla_map, spawn_points):
    """Spawn points on plazas/sidewalks fail the distance check; keep only real lanes."""
    for sp in spawn_points:
        wp = carla_map.get_waypoint(
            sp.location, project_to_road=True, lane_type=carla.LaneType.Driving
        )
        if wp is None:
            continue
        if sp.location.distance(wp.transform.location) > 2.5:
            continue
        if not wp.next(2.0):
            continue
        yield wp


def choose_driving_waypoint(carla_map, rng=None, prefer_near=None):
    rng = rng or random.Random()
    spawn_points = carla_map.get_spawn_points()
    valid = list(iter_valid_driving_waypoints(carla_map, spawn_points))
    if not valid:
        wp = carla_map.get_waypoint(
            spawn_points[0].location,
            project_to_road=True,
            lane_type=carla.LaneType.Driving,
        )
        if wp is None:
            raise RuntimeError("no Driving lane waypoints on this map")
        return wp
    if prefer_near is not None:
        valid.sort(key=lambda w: w.transform.location.distance(prefer_near))
        return valid[0]
    return rng.choice(valid)


def pick_forward_waypoint(carla_map, ego, base_wp=None):
    """Lane-aligned waypoint ahead of the vehicle (avoids U-turn on wrong lane)."""
    transform = ego.get_transform()
    loc = transform.location
    fwd_x, fwd_y = forward_vector(transform.rotation.yaw)
    wp = base_wp or carla_map.get_waypoint(
        loc, project_to_road=True, lane_type=carla.LaneType.Driving
    )
    if wp is None:
        return choose_driving_waypoint(carla_map, prefer_near=loc)

    candidates = []
    nxt = wp.next(3.0)
    if nxt:
        candidates.append(nxt[0])
    prv = wp.previous(3.0)
    if prv:
        candidates.append(prv[0])
    if not candidates:
        return wp

    def alignment(candidate_wp):
        dx = candidate_wp.transform.location.x - loc.x
        dy = candidate_wp.transform.location.y - loc.y
        norm = math.hypot(dx, dy) or 1e-6
        return (dx / norm) * fwd_x + (dy / norm) * fwd_y

    return max(candidates, key=alignment)


def settle_ego_on_waypoint(world, ego, wp):
    """Teleport onto lane centerline and let physics settle (reduces ground clip / float)."""
    z = wp.transform.location.z + 0.25
    target = carla.Transform(
        carla.Location(wp.transform.location.x, wp.transform.location.y, z),
        wp.transform.rotation,
    )
    ego.set_autopilot(False)
    ego.set_target_velocity(carla.Vector3D(0.0, 0.0, 0.0))
    ego.set_target_angular_velocity(carla.Vector3D(0.0, 0.0, 0.0))
    ego.set_transform(target)
    ego.apply_control(carla.VehicleControl(throttle=0.0, brake=1.0, hand_brake=True))
    # Do not call wait_for_tick() here: with carla_ros_bridge synchronous_mode
    # enabled, extra clients block until the bridge ticks and Town13 RPCs stall.
    time.sleep(1.0)
    ego.apply_control(carla.VehicleControl(throttle=0.0, brake=0.0, hand_brake=False))


def snap_ego_to_road(world, ego, carla_map=None, rng=None):
    carla_map = carla_map or world.get_map()
    loc = ego.get_transform().location
    wp = carla_map.get_waypoint(
        loc, project_to_road=True, lane_type=carla.LaneType.Driving
    )
    if wp is None or loc.distance(wp.transform.location) > 2.5:
        wp = choose_driving_waypoint(carla_map, rng=rng, prefer_near=loc)
    route_wp = pick_forward_waypoint(carla_map, ego, base_wp=wp)
    settle_ego_on_waypoint(world, ego, route_wp)
    return route_wp
