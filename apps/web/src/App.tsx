import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { useSession } from "./lib/session";
import { SetupPage } from "./pages/SetupPage";
import { ForgotPasswordPage, ResetPasswordPage } from "./pages/PasswordPages";
import { LoginPage } from "./pages/LoginPage";
import { InvitePage } from "./pages/InvitePage";
import { AppShell } from "./components/AppShell";
import { HomePage } from "./pages/HomePage";
import { AdminPage } from "./pages/AdminPage";
import { PagePage } from "./pages/PagePage";
import { WorkspacePage } from "./pages/WorkspacePage";
import { TrashPage } from "./pages/TrashPage";
import { RemindersPage } from "./pages/RemindersPage";
import { CapturePage } from "./components/QuickCapture";
import { PublicPage } from "./pages/PublicPage";
import { AccountPage } from "./pages/AccountPage";
import { OauthAuthorizePage } from "./pages/OauthAuthorizePage";
import { PublicFormPage } from "./pages/PublicFormPage";
import { t } from "@nootion/shared";
import { LibraryPage } from "./pages/LibraryPage";
import { lazy, Suspense } from "react";

// The graph (and its layout code) loads only when opened.
const GraphPage = lazy(() => import("./pages/GraphPage").then((m) => ({ default: m.GraphPage })));

export function App() {
  const location = useLocation();
  // Public links work for everyone, signed in or not.
  // So are forms opened from their public link.
  if (location.pathname.startsWith("/f/")) {
    return (
      <Routes>
        <Route path="/f/:token" element={<PublicFormPage />} />
      </Routes>
    );
  }
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
        <Route path="/forgot" element={<ForgotPasswordPage />} />
        <Route path="/reset/:token" element={<ResetPasswordPage />} />
        <Route path="*" element={<Navigate to="/login" replace state={{ from: location.pathname + location.search }} />} />
      </Routes>
    );
  }

  return (
    <Routes>
      <Route path="/oauth/authorize" element={<OauthAuthorizePage />} />
      <Route element={<AppShell />}>
        <Route index element={<HomePage />} />
        <Route path="/page/:id" element={<PagePage />} />
        <Route path="/workspace/:id" element={<WorkspacePage />} />
        <Route path="/trash" element={<TrashPage />} />
        <Route path="/pages" element={<LibraryPage />} />
        <Route
          path="/graph"
          element={
            <Suspense fallback={null}>
              <GraphPage />
            </Suspense>
          }
        />
        <Route path="/reminders" element={<RemindersPage />} />
        <Route path="/capture" element={<CapturePage />} />
        <Route path="/account" element={<AccountPage />} />
        {user.role === "admin" && <Route path="/admin" element={<AdminPage />} />}
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
