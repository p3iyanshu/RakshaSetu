"""
rakshasetu_launch.py

Starts the full pipeline with one command:
    ros2 launch rakshasetu rakshasetu_launch.py

Once this is running, in a separate terminal you can inspect any stage with:
    ros2 topic echo /rakshasetu/fusion/output
    ros2 topic hz /rakshasetu/lidar/points        # confirm publish rate
    ros2 node list                                 # confirm all 6 nodes are up
"""

from launch import LaunchDescription
from launch_ros.actions import Node


def generate_launch_description():
    return LaunchDescription([
        Node(
            package="rakshasetu", executable="lidar_ingest_node",
            name="lidar_ingest_node", output="screen",
        ),
        Node(
            package="rakshasetu", executable="ego_odometry_node",
            name="ego_odometry_node", output="screen",
        ),
        Node(
            package="rakshasetu", executable="preprocessing_node",
            name="preprocessing_node", output="screen",
        ),
        Node(
            package="rakshasetu", executable="segmentation_node",
            name="segmentation_node", output="screen",
        ),
        Node(
            package="rakshasetu", executable="grid_engine_node",
            name="grid_engine_node", output="screen",
        ),
        Node(
            package="rakshasetu", executable="tracking_node",
            name="tracking_node", output="screen",
        ),
        Node(
            package="rakshasetu", executable="fusion_node",
            name="fusion_node", output="screen",
        ),
    ])
