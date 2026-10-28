import { Navigate, Route, Routes } from "react-router-dom";
import { useSession } from "./lib/session";
import { SetupPage } from "./pages/SetupPage";
import { LoginPage } from "./pages/LoginPage";
import { InvitePage } from "./pages/InvitePage";
import { AppShell } from "./components/AppShell";
import { HomePage } from "./pages/HomePage";
import { AdminPage } from "./pages/AdminPage";

export function App() {
  const { user, needsSetup, loading } = useSession();
  if (loading) return <div className="flex h-full items-center justify-center text-sm text-neutral-500">Chargement…</div>;

  if (needsSetup) {
    return (
      <Routes>
        <Route path="/setup" element={<SetupPage />} />
        <Route path="*" element={<Navigate to="/setup" replace />} />
      </Routes>
    );
  }

  if (!user) {
    return (
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/invite/:token" element={<InvitePage />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    );
  }

  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route index element={<HomePage />} />
        {user.role === "admin" && <Route path="/admin" element={<AdminPage />} />}
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
