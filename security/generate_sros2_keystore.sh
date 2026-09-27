#!/usr/bin/env bash
# Generates the SROS2 keystore + one enclave per rakshasetu ROS 2 node.
#
# Per Member 6's brief: "ROS 2 internal security (SROS2)... this gives us
# authenticated, encrypted node-to-node traffic essentially for free."
# `ros2 security create_key` from the brief is the now-deprecated alias for
# `create_enclave` (both still work on ROS 2 Humble; this script uses the
# current name).
#
# Node names below match rakshasetu.launch.py's `nodes` list EXACTLY (no
# namespace is applied there, so each node's fully-qualified name is just
# "/<name>") -- SROS2 resolves a node's enclave by that fully-qualified
# name unless ROS_SECURITY_ENCLAVE_OVERRIDE is set, so a mismatch here
# would silently leave a node unauthenticated rather than erroring.
#
# Requires: ROS 2 Humble sourced (`source /opt/ros/humble/setup.bash`).
# Re-run any time to regenerate from scratch (wipes and rebuilds the
# keystore -- every node needs a fresh key afterward, nothing is additive).
#
# Usage (from repo root):
#   bash security/generate_sros2_keystore.sh
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
KEYSTORE="$HERE/sros2_keystore"

NODES=(
  lidar_ingest_node
  preprocessing_node
  ego_odometry_node
  segmentation_node
  grid_engine_node
  tracking_node
  fusion_node
  integration_test_harness  # security/integration_test_ros2_pipeline.py's own node -- under
                             # ROS_SECURITY_STRATEGY=Enforce every DDS participant needs an enclave
)

if ! command -v ros2 >/dev/null 2>&1; then
  echo "ERROR: 'ros2' not found on PATH -- source your ROS 2 install first, e.g.:" >&2
  echo "  source /opt/ros/humble/setup.bash" >&2
  exit 1
fi

rm -rf "$KEYSTORE"
echo "creating keystore at $KEYSTORE ..."
ros2 security create_keystore "$KEYSTORE"

for node in "${NODES[@]}"; do
  echo "creating enclave /$node ..."
  ros2 security create_enclave "$KEYSTORE" "/$node"
done

echo
echo "done. $(ros2 security list_enclaves "$KEYSTORE" | wc -l) enclaves created:"
ros2 security list_enclaves "$KEYSTORE"
echo
echo "To run the pipeline with SROS2 enforced, set before 'ros2 launch':"
echo "  export ROS_SECURITY_KEYSTORE=\"$KEYSTORE\""
echo "  export ROS_SECURITY_ENABLE=true"
echo "  export ROS_SECURITY_STRATEGY=Enforce"
echo
echo "ros2_ws/src/rakshasetu/launch/rakshasetu.launch.py already sets each"
echo "node's own ROS_SECURITY_ENCLAVE_OVERRIDE for you. If you run a node"
echo "directly with 'ros2 run' instead of through that launch file, set it"
echo "yourself, e.g.:"
echo "  export ROS_SECURITY_ENCLAVE_OVERRIDE=/segmentation_node"
echo "(required on at least this ROS 2 build -- matching an enclave by the"
echo "node's own name alone was found NOT to work; see"
echo "security/integration_test_ros2_pipeline.py and rakshasetu.launch.py's"
echo "own docstring for how this was diagnosed.)"
