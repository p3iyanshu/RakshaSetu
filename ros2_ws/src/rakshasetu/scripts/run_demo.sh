#!/bin/bash
# Live-demo launcher: bridge -> ego vehicle + lidar/odom -> NPC traffic ->
# the full rakshasetu pipeline, all against a real running CARLA server.
#
# Run this from ONE WSL2 terminal and keep that terminal open for the whole
# demo -- a WSL2 quirk means background processes started here die if the
# invoking terminal/session closes, `nohup`/`disown` notwithstanding (see
# README's "Running against CARLA" section). Run other ros2 commands
# (topic echo, hz, etc.) from a SECOND terminal tab while this one keeps
# everything alive.
#
# Prerequisite: CARLA is already running on Windows
# (D:\SIH2026\CARLA_0.9.15\WindowsNoEditor\CarlaUE4.exe -quality-level=Low)
#
#   bash run_demo.sh [carla_host] [town_name]
#
# carla_host defaults to the WSL2 default-gateway IP (where CARLA runs
# natively on Windows in this project's setup) -- override if that's
# changed since 2026-09-15 (check with: ip route show default).
# town_name is optional. When omitted, the bridge reuses whatever map CARLA
# already has loaded (avoids a slow Town13 switch that can wedge the server).
# Pass an explicit name to force a reload (e.g. Town13, Town10HD_Opt).

set -e
CARLA_HOST="${1:-172.30.16.1}"
CARLA_PORT=2000
TOWN_OVERRIDE="${2:-}"
SCRIPT_DIR="/mnt/d/SIH2026/ros2_ws/src/rakshasetu"

source /opt/ros/humble/setup.bash
source ~/carla_ros_bridge_ws/install/setup.bash
source /mnt/d/SIH2026/ros2_ws/install/setup.bash

echo "=== checking CARLA server at ${CARLA_HOST}:${CARLA_PORT} ==="
python3 -c "
import carla, time
c = carla.Client('${CARLA_HOST}', ${CARLA_PORT})
for attempt in range(6):
    c.set_timeout(30.0)
    try:
        print('server version:', c.get_server_version())
        print('current map:', c.get_world().get_map().name)
        break
    except RuntimeError as exc:
        if attempt == 5:
            raise
        print(f'waiting for simulator... ({attempt + 1}/6): {exc}')
        time.sleep(5)
" || { echo "CARLA not reachable -- start CarlaUE4.exe on Windows first."; exit 1; }

pkill -f "carla_ros_bridge/lib" 2>/dev/null || true
pkill -f "carla_spawn_objects" 2>/dev/null || true
# NOTE: must be specific -- a bare "rakshasetu" pattern also matches this
# script's own path (.../rakshasetu/scripts/run_demo.sh) and pkill would
# kill itself. Match the installed node executables' path instead.
pkill -f "install/rakshasetu/lib" 2>/dev/null || true
sleep 1

echo "=== cleaning up any actors left by a previous run ==="
python3 "${SCRIPT_DIR}/scripts/clean_world.py" --host "${CARLA_HOST}" --port ${CARLA_PORT} --timeout 90 \
  || { echo "CARLA busy -- restart CarlaUE4.exe on Windows, then re-run this script."; exit 1; }

if [ -n "${TOWN_OVERRIDE}" ]; then
  TARGET_MAP="${TOWN_OVERRIDE}"
  BRIDGE_TIMEOUT=300
  echo "    target map: ${TARGET_MAP} (explicit reload requested, bridge timeout ${BRIDGE_TIMEOUT}s)"
else
  TARGET_MAP=$(python3 -c "
import carla
c = carla.Client('${CARLA_HOST}', ${CARLA_PORT}); c.set_timeout(30.0)
print(c.get_world().get_map().name)
")
  BRIDGE_TIMEOUT=120
  echo "    target map: ${TARGET_MAP} (reusing map already loaded in CARLA)"
fi

start_bridge() {
  pkill -f "carla_ros_bridge/lib" 2>/dev/null || true
  sleep 1
  # synchronous_mode:=false avoids 120s lidar spawn stalls on heavy maps (Town13).
  ros2 launch carla_ros_bridge carla_ros_bridge.launch.py \
    host:="${CARLA_HOST}" port:=${CARLA_PORT} town:="${TARGET_MAP}" \
    timeout:=${BRIDGE_TIMEOUT} synchronous_mode:=false \
    > /tmp/demo_bridge.log 2>&1 &
  BRIDGE_PID=$!
}

wait_for_bridge() {
  local i=0
  while [ $i -lt 45 ]; do
    if ! kill -0 "${BRIDGE_PID}" 2>/dev/null; then
      echo "    carla_ros_bridge exited early -- last lines of /tmp/demo_bridge.log:"
      tail -n 15 /tmp/demo_bridge.log 2>/dev/null || true
      return 1
    fi
    if ros2 topic list 2>/dev/null | grep -q "/carla/status"; then
      echo "    bridge ready after ~$((i*3))s"
      return 0
    fi
    sleep 3; i=$((i+1))
  done
  echo "carla_ros_bridge did not become ready -- see /tmp/demo_bridge.log"
  return 1
}

echo ""
echo "=== [1/4] launching carla_ros_bridge ==="
start_bridge
wait_for_bridge || exit 1

echo "=== [2/4] spawning ego vehicle + lidar + odometry ==="
EGO_SPAWN_FILE="${SCRIPT_DIR}/config/demo_ego_spawn.txt"
EGO_SPAWN_POINT=$(head -n1 "${EGO_SPAWN_FILE}" 2>/dev/null | tr -d '[:space:]')
if [ -z "${EGO_SPAWN_POINT}" ]; then
  echo "    (no cached spawn in demo_ego_spawn.txt -- querying CARLA, may take ~1 min)"
  EGO_SPAWN_POINT=$(python3 "${SCRIPT_DIR}/scripts/pick_ego_spawn.py" --host "${CARLA_HOST}" --port ${CARLA_PORT}) \
    || { echo "could not pick a Driving-lane spawn point on the current map"; exit 1; }
fi
echo "    ego spawn point: ${EGO_SPAWN_POINT}"

set +e
SPAWN_OK=0
for attempt in 1 2 3; do
  pkill -f "carla_spawn_objects" 2>/dev/null || true
  sleep 2

  if ! kill -0 "${BRIDGE_PID}" 2>/dev/null; then
    echo "    bridge crashed during spawn -- restarting (attempt ${attempt})..."
    start_bridge
    wait_for_bridge || continue
    python3 "${SCRIPT_DIR}/scripts/clean_world.py" --host "${CARLA_HOST}" --port ${CARLA_PORT} --timeout 90 --soft
  elif [ "${attempt}" -gt 1 ]; then
    python3 "${SCRIPT_DIR}/scripts/clean_world.py" --host "${CARLA_HOST}" --port ${CARLA_PORT} --timeout 90 --soft
  fi

  ros2 launch carla_spawn_objects carla_spawn_objects.launch.py \
    objects_definition_file:="${SCRIPT_DIR}/config/objects.json" \
    spawn_point_ego_vehicle:="${EGO_SPAWN_POINT}" \
    > "/tmp/demo_spawn_attempt${attempt}.log" 2>&1 &

  i=0
  while [ $i -lt 60 ]; do
    if ros2 topic list 2>/dev/null | grep -q "/carla/ego_vehicle/lidar"; then
      SPAWN_OK=1
      break
    fi
    if grep -q "All objects spawned" "/tmp/demo_spawn_attempt${attempt}.log" 2>/dev/null; then
      SPAWN_OK=1
      break
    fi
    if grep -qE "FATAL|Spawn failed|Error while spawning|Error spawning object" "/tmp/demo_spawn_attempt${attempt}.log" 2>/dev/null; then
      break
    fi
    if ! kill -0 "${BRIDGE_PID}" 2>/dev/null; then
      echo "    bridge died while waiting for lidar (see /tmp/demo_bridge.log)"
      break
    fi
    sleep 2; i=$((i+2))
  done
  if [ "$SPAWN_OK" = "1" ]; then
    echo "    ego vehicle ready on attempt ${attempt} after ~${i}s"
    break
  fi
  echo "    attempt ${attempt} failed (see /tmp/demo_spawn_attempt${attempt}.log), retrying..."
done
set -e
if [ "$SPAWN_OK" != "1" ]; then
  echo "ego vehicle failed to spawn after 3 attempts -- check /tmp/demo_bridge.log and spawn logs."
  exit 1
fi

echo "=== [3/4] spawning NPC traffic + lane-following drive + chase camera ==="
python3 "${SCRIPT_DIR}/scripts/spawn_traffic.py" --host "${CARLA_HOST}" --port ${CARLA_PORT} --timeout 60.0 || echo "traffic spawn failed -- continuing anyway, ego vehicle is already up"
python3 -u "${SCRIPT_DIR}/scripts/follow_road.py" \
  --host "${CARLA_HOST}" --port ${CARLA_PORT} --timeout 90 --throttle 0.20 --lookahead 5.0 --camera \
  > /tmp/demo_autopilot.log 2>&1 &
sleep 5
echo "    $(tail -n 2 /tmp/demo_autopilot.log 2>/dev/null)"

echo "=== [4/4] launching the rakshasetu pipeline (real CARLA feed) ==="
ros2 launch rakshasetu rakshasetu.launch.py > /tmp/demo_rakshasetu.log 2>&1 &

i=0
while [ $i -lt 40 ]; do
  ros2 topic list 2>/dev/null | grep -q "/rakshasetu/fusion/output" && break
  sleep 3; i=$((i+1))
done
echo "    pipeline nodes up after ~$((i*3))s"

echo ""
echo "================================================================"
echo " DEMO IS LIVE. CARLA window should follow the ego on the road network"
echo " (lane-following drive + chase cam). Do NOT also run follow_ego_vehicle.py."
echo " Useful commands for a SECOND terminal:"
echo ""
echo "   ros2 topic list"
echo "   ros2 topic hz /rakshasetu/fusion/output"
echo "   ros2 topic echo /rakshasetu/fusion/output --once"
echo ""
echo " Press Ctrl+C here to stop everything."
echo "================================================================"

wait
