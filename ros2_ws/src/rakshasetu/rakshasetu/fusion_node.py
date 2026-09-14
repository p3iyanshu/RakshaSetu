"""
fusion_node.py

This is YOUR real logic, not a wrapper around someone else's function (see
task doc section 5). It merges GridEngine's static/terrain layer with
Tracking's dynamic-object layer into one combined output, streamed onward
for Member 5's dashboard.

interfaces.md v2 fix #3: this is a REAL reconciliation, not blind
packaging. Every tracked object gets mapped onto the grid cell its position
falls into (using the exact same range/angular binning GridEngine uses --
see schemas.position_to_range_angular_bin, which delegates to Member 2's
own grid_engine.grid_builder.position_to_bin so the two can't drift apart),
and that cell gets tagged with the object's track_id. Without this, the
dashboard would receive two disconnected lists with no way to know which
grid cell a pedestrian is actually standing in.

Also publishes shared/schemas.py's FusedFrame.metrics field
({"fps", "latency_ms", "miou", "compute_savings_pct"}) -- fps and
latency_ms are computed live from real wall-clock timing; miou and
compute_savings_pct are Member 1's/Member 2's real offline-validated
numbers (see schemas.SEGMENTATION_MIOU / schemas.GRID_COMPUTE_SAVINGS_PCT
docstrings for why those two aren't recomputed live).

SYNCHRONIZATION APPROACH IN THIS VERSION:
This stub uses simple "cache the latest message from each topic, merge on
whichever arrives second" logic — good enough to get a working pipeline
today, but not real timestamp-accurate synchronization.

>>> UPGRADE PATH (Week 2, per the roadmap) <<<
Replace the manual caching below with rclpy's message_filters.ApproximateTimeSynchronizer,
which matches messages across topics by actual timestamp rather than "whichever
arrived most recently." This matters once frame timing isn't perfectly
lockstep (e.g., GridEngine and Tracking take different amounts of compute
time per frame, which will absolutely happen with real models). Example of
what that upgrade looks like is sketched at the bottom of this file in a
comment — don't wire it in yet, this file's job right now is "prove the
merge logic works," not "be timestamp-perfect."
"""

import time
from collections import deque

import rclpy
from rclpy.node import Node
from std_msgs.msg import String

from rakshasetu import schemas

GRID_TOPIC = "/rakshasetu/grid/occupancy"
TRACKING_TOPIC = "/rakshasetu/tracking/objects"
OUTPUT_TOPIC = "/rakshasetu/fusion/output"

FPS_WINDOW = 30  # rolling window size for the live fps estimate


def reconcile(grid: dict, objects: list):
    """
    interfaces.md v2 fix #3, the actual logic:
      1. every object gets grid_range_bin / grid_angular_bin added
      2. every grid cell an object maps onto gets dynamic_track_id added

    `grid` here is already JSON-key-safe (e.g. {"2_88": {...}}), matching
    what GridEngine publishes and what schemas.make_grid_msg expects back.
    """
    # work on a shallow copy per cell so we don't mutate the caller's dict
    # in a way that surprises them if they reuse it
    grid_out = {k: dict(v) for k, v in grid.items()}
    objects_out = []

    for obj in objects:
        x, y, z = obj["position"]
        range_bin, angular_bin = schemas.position_to_range_angular_bin(x, y)
        key = schemas.grid_key(range_bin, angular_bin)

        obj_out = dict(obj)
        obj_out["grid_range_bin"] = range_bin
        obj_out["grid_angular_bin"] = angular_bin
        objects_out.append(obj_out)

        if key in grid_out:
            grid_out[key]["dynamic_track_id"] = obj["track_id"]
        # if the object's cell isn't in the static grid at all (e.g. it's
        # beyond the grid's max range), that's fine — the object still
        # carries its own grid_range_bin/grid_angular_bin for reference,
        # there's just no static cell to tag.

    return grid_out, objects_out


class FusionNode(Node):
    def __init__(self):
        super().__init__("fusion_node")

        self.latest_grid = None
        self.latest_objects = None
        self._publish_times = deque(maxlen=FPS_WINDOW)

        self.grid_sub = self.create_subscription(String, GRID_TOPIC, self.on_grid, 10)
        self.tracking_sub = self.create_subscription(String, TRACKING_TOPIC, self.on_tracking, 10)
        self.publisher = self.create_publisher(String, OUTPUT_TOPIC, 10)

        self.get_logger().info(
            f"fusion_node listening on {GRID_TOPIC} and {TRACKING_TOPIC}, publishing {OUTPUT_TOPIC}"
        )

    def on_grid(self, msg: String):
        self.latest_grid = schemas.parse(msg.data)
        self.try_fuse()

    def on_tracking(self, msg: String):
        self.latest_objects = schemas.parse(msg.data)
        self.try_fuse()

    def _compute_metrics(self, frame_timestamp: float) -> dict:
        now = time.time()

        self._publish_times.append(now)
        if len(self._publish_times) >= 2:
            span = self._publish_times[-1] - self._publish_times[0]
            fps = (len(self._publish_times) - 1) / span if span > 0 else 0.0
        else:
            fps = 0.0

        # real elapsed wall-clock time from this frame's own LidarIngest
        # timestamp (propagated unchanged through every stage, per
        # interfaces.md's "must match the timestamp of..." rule) to right
        # now -- genuine end-to-end pipeline latency for this frame.
        latency_ms = max((now - frame_timestamp) * 1000.0, 0.0)

        return {
            "fps": round(fps, 2),
            "latency_ms": round(latency_ms, 2),
            "miou": schemas.SEGMENTATION_MIOU,
            "compute_savings_pct": schemas.GRID_COMPUTE_SAVINGS_PCT,
        }

    def try_fuse(self):
        if self.latest_grid is None or self.latest_objects is None:
            return  # haven't received at least one of each yet

        # NOTE: this does not check that grid and objects are from the SAME
        # frame timestamp — it just fuses whatever's most recently cached
        # from each topic. Fine for proving the merge shape works; this is
        # exactly what the message_filters upgrade (see module docstring)
        # is meant to fix.
        grid_out, objects_out = reconcile(
            self.latest_grid["grid"], self.latest_objects["objects"]
        )

        metrics = self._compute_metrics(self.latest_grid["timestamp"])

        fused = schemas.make_fusion_msg(
            grid=grid_out,
            objects=objects_out,
            timestamp=self.latest_grid["timestamp"],
            frame_id=self.latest_grid["frame_id"],
            metrics=metrics,
        )

        out = String()
        out.data = fused
        self.publisher.publish(out)


def main(args=None):
    rclpy.init(args=args)
    node = FusionNode()
    try:
        rclpy.spin(node)
    except KeyboardInterrupt:
        pass
    finally:
        node.destroy_node()
        rclpy.shutdown()


if __name__ == "__main__":
    main()


# ---------------------------------------------------------------------------
# WEEK 2 UPGRADE SKETCH — message_filters.ApproximateTimeSynchronizer
# (Do not wire this in until real per-frame timestamps need strict alignment
#  and you've read the message_filters docs — this is a reference, not a
#  drop-in replacement, since message_filters expects messages with a real
#  Header, and std_msgs/String has no header field. Realistically this means
#  switching GridEngine/Tracking to publish a message type with a Header
#  once you're ready for this — e.g. a custom .msg, at which point you're
#  also picking up real ROS 2 Time instead of the float timestamps used
#  here.)
#
# import message_filters
#
# grid_sub = message_filters.Subscriber(self, YourGridMsgType, GRID_TOPIC)
# tracking_sub = message_filters.Subscriber(self, YourTrackingMsgType, TRACKING_TOPIC)
# ts = message_filters.ApproximateTimeSynchronizer(
#     [grid_sub, tracking_sub], queue_size=10, slop=0.05
# )
# ts.registerCallback(self.on_synced_pair)
# ---------------------------------------------------------------------------
