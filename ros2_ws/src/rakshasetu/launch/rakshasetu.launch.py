"""
Brings up the full pipeline: lidar_ingest -> preprocessing -> segmentation
-> {grid_engine, tracking (+ ego_odometry)} -> fusion.

    ros2 launch rakshasetu rakshasetu.launch.py

lidar_ingest_node/ego_odometry_node consume carla-ros-bridge's real
/carla/ego_vehicle/lidar and /carla/ego_vehicle/odometry topics (Task 3,
team_tasks/04_systems_integration_ros2.md -- done); run this only after the
bridge and carla_spawn_objects are already up (see this package's README's
"Running against CARLA" section for the launch sequence), otherwise these
two nodes just sit idle with nothing to subscribe to.

SROS2 (Member 6): each Node below gets ROS_SECURITY_ENCLAVE_OVERRIDE set to
its own "/<name>" enclave explicitly. This is required, not optional, on at
least this ROS 2 Humble build -- matching-an-enclave-by-node's-own-name
without an explicit override was found NOT to work here (verified via
security/integration_test_ros2_pipeline.py: omitting the override made every
node resolve to the keystore's ROOT enclave -- which has no cert.pem/key.pem
of its own -- and fail to start with "couldn't find all security files!").
Harmless when security is off: ROS_SECURITY_ENABLE unset/false means rcl
never reads ROS_SECURITY_ENCLAVE_OVERRIDE in the first place, so this
env var is simply inert until someone sets ROS_SECURITY_ENABLE=true (see
security/generate_sros2_keystore.sh's printed instructions for the full
set of env vars to export before this launch file).
"""
from launch import LaunchDescription
from launch_ros.actions import Node


def generate_launch_description():
    package = "rakshasetu"
    nodes = [
        "lidar_ingest_node",
        "preprocessing_node",
        "ego_odometry_node",
        "segmentation_node",
        "grid_engine_node",
        "tracking_node",
        "fusion_node",
    ]
    return LaunchDescription([
        Node(
            package=package, executable=name, name=name, output="screen",
            additional_env={"ROS_SECURITY_ENCLAVE_OVERRIDE": f"/{name}"},
        )
        for name in nodes
    ])
