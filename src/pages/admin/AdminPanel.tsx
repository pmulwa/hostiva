// This file is kept for backward compatibility
// The admin panel is now split into separate route-based pages
// See: AdminDashboard, AdminUsers, AdminProperties, etc.
import { Navigate } from 'react-router-dom';

export default function AdminPanel() {
  return <Navigate to="/admin" replace />;
}
