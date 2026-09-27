from setuptools import find_packages, setup

package_name = "rakshasetu"

setup(
    name=package_name,
    version="0.1.0",
    packages=find_packages(exclude=["test"]),
    data_files=[
        ("share/ament_index/resource_index/packages", ["resource/" + package_name]),
        ("share/" + package_name, ["package.xml"]),
        ("share/" + package_name + "/launch", ["launch/rakshasetu.launch.py"]),
    ],
    install_requires=["setuptools"],
    zip_safe=True,
    maintainer="p3iyanshu",
    maintainer_email="priyanshu.sona1291@gmail.com",
    description="RakshaSetu pipeline nodes -- ROS 2 wrappers per ros2_ws/interfaces.md",
    license="Apache-2.0",
    tests_require=["pytest"],
    entry_points={
        "console_scripts": [
            "lidar_ingest_node = rakshasetu.lidar_ingest_node:main",
            "preprocessing_node = rakshasetu.preprocessing_node:main",
            "ego_odometry_node = rakshasetu.ego_odometry_node:main",
            "segmentation_node = rakshasetu.segmentation_node:main",
            "grid_engine_node = rakshasetu.grid_engine_node:main",
            "tracking_node = rakshasetu.tracking_node:main",
            "fusion_node = rakshasetu.fusion_node:main",
        ],
    },
)
