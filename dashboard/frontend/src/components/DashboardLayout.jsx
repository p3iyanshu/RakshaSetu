import { useEffect } from "react";
import { Outlet, useLocation, useNavigate } from "react-router-dom";
import TopNav from "./TopNav.jsx";
import { useLiveFeed } from "../hooks/useLiveFeed.js";

/**
 * The unified dashboard shell: one persistent top nav plus a content pane
 * that swaps between sections (Vehicle HUD / Top-Down LiDAR / Web Command
 * Deck). One shared WebSocket connection, passed down to whichever section
 * is active via router Outlet context, instead of each section opening its
 * own.
 */
export default function DashboardLayout() {
  const feed = useLiveFeed();
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    if (feed.status === "unauthorized") {
      navigate("/login", { state: { from: location.pathname }, replace: true });
    }
  }, [feed.status, navigate, location.pathname]);

  return (
    <div className="h-screen w-screen flex flex-col overflow-hidden" style={{ background: "var(--ground)" }}>
      <TopNav status={feed.status} />
      <main className="flex-1 min-h-0 flex flex-col overflow-hidden">
        <Outlet context={feed} />
      </main>
    </div>
  );
}
