import { Navigate, useLocation } from "react-router-dom";
import { getRole, isAuthenticated } from "../lib/auth.js";

/** Route guard: redirects to /login if unauthenticated, or to /car if the
 * signed-in role doesn't satisfy `role` (e.g. a viewer hitting /admin). */
export default function RequireAuth({ role, children }) {
  const location = useLocation();

  if (!isAuthenticated()) {
    return <Navigate to="/login" state={{ from: location.pathname }} replace />;
  }
  if (role && getRole() !== role) {
    return <Navigate to="/car" replace />;
  }
  return children;
}
