import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/NotFound";
import { Route, Switch } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import Home from "./pages/Home";
import Login from "@/pages/Login";
import Pricing from "./pages/Pricing";
import FAQ from "./pages/FAQ";
import CGU from "./pages/CGU";
import Privacy from "./pages/Privacy";
import Dashboard from "./pages/Dashboard";
import Templates from "./pages/Templates";
import Onboarding from "./pages/Onboarding";
import Projects from "./pages/Projects";
import ProjectEditor from "./pages/ProjectEditor";
import ApiKeys from "./pages/ApiKeys";
import Profile from "./pages/Profile";
import Billing from "./pages/Billing";
import Admin from "./pages/Admin";
import ShareProject from "@/pages/ShareProject";
import AcceptInvite from "@/pages/AcceptInvite";
import UltraDashboard from "@/pages/UltraDashboard";
import Documentation from "@/pages/Documentation";
import Blog from "@/pages/Blog";
import Support from "@/pages/Support";

function Router() {
  return (
    <Switch>
      <Route path="/" component={Home} />
      <Route path="/login" component={Login} />
      <Route path="/pricing" component={Pricing} />
      <Route path="/faq" component={FAQ} />
      <Route path="/cgu" component={CGU} />
      <Route path="/privacy" component={Privacy} />
      <Route path="/documentation" component={Documentation} />
      <Route path="/blog" component={Blog} />
      <Route path="/support" component={Support} />
      <Route path="/templates" component={Templates} />
      <Route path="/onboarding" component={Onboarding} />
      <Route path="/dashboard" component={Dashboard} />
      <Route path="/projects" component={Projects} />
      <Route path="/projects/:id" component={ProjectEditor} />
      <Route path="/projects/:id/share" component={ShareProject} />
      <Route path="/api-keys" component={ApiKeys} />
      <Route path="/profile" component={Profile} />
      <Route path="/billing" component={Billing} />
      <Route path="/invite/:token" component={AcceptInvite} />
      <Route path="/admin" component={Admin} />
      <Route path="/ultra" component={UltraDashboard} />
      <Route path="/404" component={NotFound} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider defaultTheme="dark">
        <TooltipProvider>
          <Toaster richColors position="top-right" />
          <Router />
        </TooltipProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
