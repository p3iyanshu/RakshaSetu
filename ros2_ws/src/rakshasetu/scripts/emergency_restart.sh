#!/bin/bash
# Full force-restart: kills and relaunches CARLA itself (from inside WSL --
# no separate Windows terminal needed, WSL2 can invoke .exe files directly),
# then brings up bridge + ego vehicle + NPC traffic, then drives the ego
# vehicle with DIRECT manual control instead of autopilot.
#
# Why manual control, not autopilot: found live on 2026-09-16 that the ego
# vehicle can spawn at an invalid (0,0,0) point off the road network, which
# TrafficManager's autopilot can never route from -- it just sits there
# forever. Manual control sidesteps that entirely and is what's proven to
# actually work. Revisit giving the ego vehicle an explicit, known-good
# spawn_point in config/objects.json when there's time to find one.
#
# Run this directly:  bash emergency_restart.sh

set -e
CARLA_HOST=172.30.16.1
CARLA_PORT=2000
SCRIPT_DIR="/mnt/d/SIH2026/ros2_ws/src/rakshasetu"

echo "=== force-killing any existing CARLA process ==="
taskkill.exe /F /IM CarlaUE4.exe /T 2>/dev/null || true
taskkill.exe /F /IM CarlaUE4-Win64-Shipping.exe /T 2>/dev/null || true
sleep 2

echo "=== relaunching CARLA ==="
"/mnt/d/SIH2026/CARLA_0.9.15/WindowsNoEditor/CarlaUE4.exe" -quality-level=Low > /tmp/carla_stdout.log 2>&1 &
disown

echo "=== waiting for CARLA to be ready (shader cache is warm, should be fast) ==="
source /opt/ros/humble/setup.bash
i=0
while [ $i -lt 60 ]; do
  if python3 -c "import carla; c=carla.Client('${CARLA_HOST}',${CARLA_PORT}); c.set_timeout(3.0); c.get_server_version()" 2>/dev/null; then
    break
  fi
  sleep 2; i=$((i+2))
done
echo "CARLA ready after ~${i}s"

source ~/carla_ros_bridge_ws/install/setup.bash
source /mnt/d/SIH2026/ros2_ws/install/setup.bash
pkill -f "carla_ros_bridge/lib" 2>/dev/null || true
pkill -f "carla_spawn_objects" 2>/dev/null || true
pkill -f "install/rakshasetu/lib" 2>/dev/null || true
sleep 1

echo "=== [1/4] bridge ==="
ros2 launch carla_ros_bridge carla_ros_bridge.launch.py \
  host:="${CARLA_HOST}" port:=${CARLA_PORT} town:=Town13 timeout:=120 \
  > /tmp/emergency_bridge.log 2>&1 &
i=0
while [ $i -lt 30 ]; do ros2 topic list 2>/dev/null | grep -q "/carla/status" && break; sleep 3; i=$((i+1)); done
echo "bridge ready after ~$((i*3))s"

echo "=== [2/4] ego vehicle + lidar + odom ==="
ros2 launch carla_spawn_objects carla_spawn_objects.launch.py \
  objects_definition_file:="${SCRIPT_DIR}/config/objects.json" \
  > /tmp/emergency_spawn2.log 2>&1 &
i=0
while [ $i -lt 30 ]; do ros2 topic list 2>/dev/null | grep -q "/carla/ego_vehicle/lidar" && break; sleep 3; i=$((i+1)); done
echo "ego ready after ~$((i*3))s"

echo "=== [3/4] NPC traffic ==="
python3 "${SCRIPT_DIR}/scripts/spawn_traffic.py" --host "${CARLA_HOST}" --port ${CARLA_PORT}

echo "=== [4/4] launching rakshasetu pipeline ==="
ros2 launch rakshasetu rakshasetu.launch.py > /tmp/emergency_rakshasetu.log 2>&1 &

echo ""
echo "================================================================"
echo " Bringing the ego vehicle under DIRECT manual control now --"
echo " it will drive on its own with gentle wandering turns."
echo " Press Ctrl+C to stop. Re-run this whole script any time."
echo "================================================================"
sleep 3

python3 -u -c "
import time, random, carla
c = carla.Client('${CARLA_HOST}', ${CARLA_PORT}); c.set_timeout(15.0)
w = c.get_world()
ego = None
while ego is None:
    for a in w.get_actors().filter('vehicle.*'):
        if a.attributes.get('role_name') == 'ego_vehicle':
            ego = a
    if ego is None:
        print('waiting for ego_vehicle...'); time.sleep(1.0)
ego.set_autopilot(False)
print('driving actor', ego.id)
steer = 0.0
t0 = time.time()
while True:
    steer = max(-0.4, min(0.4, steer + random.uniform(-0.05, 0.05)))
    ego.apply_control(carla.VehicleControl(throttle=0.55, steer=steer, reverse=False))
    time.sleep(0.1)
    if time.time() - t0 > 5.0:
        v = ego.get_velocity()
        print(f'speed: {(v.x**2+v.y**2+v.z**2)**0.5:.2f} m/s')
        t0 = time.time()
"
