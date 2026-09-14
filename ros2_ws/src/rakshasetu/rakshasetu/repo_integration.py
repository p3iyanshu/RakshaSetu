"""
repo_integration.py

Wires this ROS 2 package to the real Members 1-3 modules that live
alongside `ros2_ws/` at the repo root (models/, grid_engine/, tracking/,
shared/, data/) -- see HANDOVER_TO_MEMBER4.md for what each one exports.
None of those directories are installed Python packages (no __init__.py --
same flat-module convention tests/test_contracts.py already uses to reach
them); they're made importable here via sys.path insertion instead, per
team_tasks/04_systems_integration_ros2.md's "Python environment conflicts"
pitfall -- rclpy runs on the system/ROS Python, not the venv Members 1-3
use for PyTorch/Open3D/scikit-learn, so this keeps the coupling to a
sys.path edit rather than trying to make the two environments identical.

Imported once, for its side effect, by rakshasetu/__init__.py -- every
node gets these paths for free just by `from rakshasetu import <anything>`
(Python always runs a package's __init__.py before any of its submodules),
no per-node boilerplate needed.

Caveat: REPO_ROOT is derived by climbing up from this file's own path, so
it only resolves correctly when running out of the source tree (a plain
`colcon build`/`--symlink-install` keeps this file's real location; a
`colcon build` WITHOUT --symlink-install copies files into install/ and
this climb would land in the wrong place). Fine for this project's
single-machine demo use; would need a real installed-package story
(rosdep / setup.py install_requires) to survive a non-symlink install.
"""
import os
import sys

# .../ros2_ws/src/rakshasetu/rakshasetu/repo_integration.py -> repo root
# is 4 directories up from this file's own directory.
REPO_ROOT = os.path.abspath(
    os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "..", "..")
)

for _sub in ("models", "grid_engine", "tracking", "shared", "data"):
    _path = os.path.join(REPO_ROOT, _sub)
    if _path not in sys.path:
        sys.path.insert(0, _path)
