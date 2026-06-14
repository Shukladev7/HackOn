import { BrowserRouter, Routes, Route } from 'react-router-dom';
import Layout from './components/Layout';
import Dashboard from './pages/Dashboard';
import RTOEvents from './pages/RTOEvents';
import Decisions from './pages/Decisions';
import CourierEscalations from './pages/CourierEscalations';
import Metrics from './pages/Metrics';
import Configuration from './pages/Configuration';
import QRScanner from './pages/QRScanner';
import PassportView from './pages/PassportView';
import HubConsole from './pages/HubConsole';
import CircularDashboard from './pages/CircularDashboard';
// DemoBanner available for overlay mode if needed
// import DemoBanner from './components/DemoBanner';

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Layout />}>
          <Route index element={<Dashboard />} />
          <Route path="rto-events" element={<RTOEvents />} />
          <Route path="decisions" element={<Decisions />} />
          <Route path="courier-escalations" element={<CourierEscalations />} />
          <Route path="metrics" element={<Metrics />} />
          <Route path="configuration" element={<Configuration />} />
          <Route path="scanner" element={<QRScanner />} />
          <Route path="passport/:passportId" element={<PassportView />} />
          <Route path="hub" element={<HubConsole />} />
          <Route path="circular" element={<CircularDashboard />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}

export default App;
