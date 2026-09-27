# Why this folder is (mostly) empty for now

The task doc mentions defining "actual ROS 2 `.msg` files." We deliberately
did NOT do that in this first version — here's why, and what to do about it
later.

Real custom `.msg` files require a separate `ament_cmake`-based interface
package (not `ament_python`, which is what `rakshasetu` is), a `CMakeLists.txt`,
and a `rosidl_generate_interfaces()` build step via `colcon build`. That's a
meaningful chunk of ROS 2 packaging knowledge to take on in Week 1 alongside
everything else that's new.

Instead, every node in this package encodes its message as a JSON string
inside a plain `std_msgs/String`. The exact field names and shapes still
follow `interfaces.md` precisely — see `rakshasetu/schemas.py`, which is the
single source of truth every node imports from. This gets you a real,
running, swappable pipeline immediately.

## When to actually build real `.msg` files

Worth doing once:
- You need real `Header` fields for `message_filters.ApproximateTimeSynchronizer`
  (std_msgs/String has no header — see the upgrade note at the bottom of
  `fusion_node.py`)
- Message sizes get large enough that JSON (de)serialization becomes a
  measurable bottleneck (unlikely to matter for your prototype's point counts)
- You want stricter type-checking than "JSON dict happens to have the right keys"

## What that upgrade looks like (do this in Week 2-3, not now)

1. Create a sibling package, e.g. `rakshasetu_msgs`, with `ament_cmake` as its
   build type instead of `ament_python`.
2. Define `.msg` files there, e.g.:
   ```
   # LidarPoints.msg
   float32[] points        # flattened N*4 array: x,y,z,intensity per point
   builtin_interfaces/Time timestamp
   string frame_id
   ```
3. Add `rosidl_generate_interfaces(${PROJECT_NAME} "msg/LidarPoints.msg" ...)`
   to that package's `CMakeLists.txt`.
4. `colcon build` the workspace — this generates real Python classes you can
   import, e.g. `from rakshasetu_msgs.msg import LidarPoints`.
5. Swap `std_msgs.msg.String` + `schemas.py`'s JSON encode/decode for the
   generated message classes, node by node. The field names in
   `interfaces.md` don't change — only how they're carried over the wire.

Don't do this until the JSON-over-String version is actually running
end-to-end with dummy data and, ideally, with at least one real member
function plugged in. Prove the pipeline shape works first.
