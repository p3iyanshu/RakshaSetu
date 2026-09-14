import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import CarView from "./views/CarView.jsx";
import AdminView from "./views/AdminView.jsx";
import LoginView from "./views/LoginView.jsx";
import RequireAuth from "./components/RequireAuth.jsx";

export default function App() {
  return (
    <BrowserRouter>
      <div className="console-field" />
      <div className="console-scanlines" />
      <div className="relative z-[2]">
        <Routes>
          <Route path="/" element={<Navigate to="/car" replace />} />
          <Route path="/login" element={<LoginView />} />
          <Route
            path="/car"
            element={
              <RequireAuth>
                <CarView />
              </RequireAuth>
            }
          />
          <Route
            path="/admin"
            element={
              <RequireAuth role="admin">
                <AdminView />
              </RequireAuth>
            }
          />
          <Route path="*" element={<Navigate to="/car" replace />} />
        </Routes>
      </div>
    </BrowserRouter>
  );
}
