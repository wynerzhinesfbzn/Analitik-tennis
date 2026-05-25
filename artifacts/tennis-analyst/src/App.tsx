import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";
import AnalysisPage from "@/pages/analysis";
import HistoryPage from "@/pages/history";
import GitPushPage from "@/pages/git-push";

const queryClient = new QueryClient();

function Router() {
  return (
    <Switch>
      <Route path="/" component={AnalysisPage} />
      <Route path="/history" component={HistoryPage} />
      <Route path="/git-push" component={GitPushPage} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <Router />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
