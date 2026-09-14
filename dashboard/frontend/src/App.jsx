import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import CarView from "./views/CarView.jsx";
import AdminView from "./views/AdminView.jsx";

export default function App() {
  return (
    <BrowserRouter>
      <div className="console-field" />
      <div className="console-scanlines" />
      <div className="relative z-[2]">
        <Routes>
          <Route path="/" element={<Navigate to="/car" replace />} />
          <Route path="/car" element={<CarView />} />
          <Route path="/admin" element={<AdminView />} />
          <Route path="*" element={<Navigate to="/car" replace />} />
        </Routes>
      </div>
    </BrowserRouter>
  );
}
