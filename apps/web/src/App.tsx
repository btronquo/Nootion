import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { useSession } from "./lib/session";
import { SetupPage } from "./pages/SetupPage";
import { LoginPage } from "./pages/LoginPage";
import { InvitePage } from "./pages/InvitePage";
import { AppShell } from "./components/AppShell";
import { HomePage } from "./pages/HomePage";
import { AdminPage } from "./pages/AdminPage";
import { PagePage } from "./pages/PagePage";
import { WorkspacePage } from "./pages/WorkspacePage";
import { TrashPage } from "./pages/TrashPage";
import { PublicPage } from "./pages/PublicPage";
import { AccountPage } from "./pages/AccountPage";
import { t } from "@nootion/shared";

export function App() {
  const location = useLocation();
  // Public links work for everyone, signed in or not.
  if (location.pathname.startsWith("/p/")) {
    return (
      <Routes>
        <Route path="/p/:token" element={<PublicPage />} />
        <Route path="/p/:token/:pageId" element={<PublicPage />} />
      </Routes>
    );
  }
  return <PrivateApp />;
}

function PrivateApp() {
  const { user, needsSetup, loading } = useSession();
  const location = useLocation();
  if (loading) return <div className="flex h-full items-center justify-center text-sm text-neutral-500">{t("common.loading")}</div>;

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
        <Route path="*" element={<Navigate to="/login" replace state={{ from: location.pathname }} />} />
      </Routes>
    );
  }

  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route index element={<HomePage />} />
        <Route path="/page/:id" element={<PagePage />} />
        <Route path="/workspace/:id" element={<WorkspacePage />} />
        <Route path="/trash" element={<TrashPage />} />
        <Route path="/account" element={<AccountPage />} />
        {user.role === "admin" && <Route path="/admin" element={<AdminPage />} />}
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
