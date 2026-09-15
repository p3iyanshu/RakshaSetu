import PerceptionView from "../components/perception/PerceptionView.jsx";

/** Route-level wrapper; the dashboard shell and perception scene live in
 * components/perception/PerceptionView.jsx and use DashboardLayout's shared
 * live-feed connection. */
export default function LiveView() {
  return <PerceptionView />;
}
