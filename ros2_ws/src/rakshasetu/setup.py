import os
from glob import glob
from setuptools import find_packages, setup

package_name = "rakshasetu"

setup(
    name=package_name,
    version="0.1.0",
    packages=find_packages(exclude=["test"]),
    data_files=[
        ("share/ament_index/resource_index/packages", ["resource/" + package_name]),
        ("share/" + package_name, ["package.xml"]),
        (os.path.join("share", package_name, "launch"), glob("launch/*.py")),
    ],
    install_requires=["setuptools"],
    zip_safe=True,
    maintainer="Member 4 - Systems Integration",
    maintainer_email="you@example.com",
    description="RakshaSetu perception pipeline integration package (SIH PS 26053)",
    license="Apache-2.0",
    tests_require=["pytest"],
    entry_points={
        "console_scripts": [
            "lidar_ingest_node = rakshasetu.lidar_ingest_node:main",
            "ego_odometry_node = rakshasetu.ego_odometry_node:main",
            "preprocessing_node = rakshasetu.preprocessing_node:main",
            "segmentation_node = rakshasetu.segmentation_node:main",
            "grid_engine_node = rakshasetu.grid_engine_node:main",
            "tracking_node = rakshasetu.tracking_node:main",
            "fusion_node = rakshasetu.fusion_node:main",
        ],
    },
)
