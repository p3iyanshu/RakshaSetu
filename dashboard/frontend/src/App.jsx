import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import CarView from "./views/CarView.jsx";
import AdminView from "./views/AdminView.jsx";
import TopDownLidarView from "./views/TopDownLidarView.jsx";
import LiveView from "./views/LiveView.jsx";
import LoginView from "./views/LoginView.jsx";
import RequireAuth from "./components/RequireAuth.jsx";
import DashboardLayout from "./components/DashboardLayout.jsx";

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Navigate to="/dashboard/lidar" replace />} />
        <Route path="/login" element={<LoginView />} />
        <Route
          path="/dashboard"
          element={
            <RequireAuth>
              <DashboardLayout />
            </RequireAuth>
          }
        >
          <Route index element={<Navigate to="lidar" replace />} />
          <Route path="lidar" element={<TopDownLidarView />} />
          <Route path="live" element={<LiveView />} />
          <Route path="car" element={<CarView />} />
          <Route
            path="admin"
            element={
              <RequireAuth role="admin">
                <AdminView />
              </RequireAuth>
            }
          />
        </Route>
        {/* Legacy top-level and pre-redesign paths. */}
        <Route path="/car" element={<Navigate to="/dashboard/car" replace />} />
        <Route path="/live" element={<Navigate to="/dashboard/lidar" replace />} />
        <Route path="/admin" element={<Navigate to="/dashboard/admin" replace />} />
        <Route path="*" element={<Navigate to="/dashboard/lidar" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
