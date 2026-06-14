import { NavLink, Outlet } from 'react-router-dom';

const navItems = [
  { to: '/', label: 'Dashboard' },
  { to: '/circular', label: 'Circular Routing' },
  { to: '/scanner', label: 'QR Scanner' },
  { to: '/hub', label: 'Hub Console' },
  { to: '/rto-events', label: 'Exceptions' },
  { to: '/decisions', label: 'Decisions' },
  { to: '/courier-escalations', label: 'Escalations' },
  { to: '/metrics', label: 'Metrics' },
  { to: '/configuration', label: 'Settings' },
];

export default function Layout() {
  return (
    <div style={{ minHeight: '100vh', fontFamily: "Arial, sans-serif", background: '#EAEDED' }}>
      {/* Primary Navigation - Dark Navy */}
      <header style={{
        background: '#131A22',
        padding: '0.6rem 1.5rem',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '1.5rem',
      }}>
        {/* Logo */}
        <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.4rem', flexShrink: 0 }}>
          <span style={{ color: '#FFFFFF', fontSize: '1.2rem', fontWeight: 700, letterSpacing: '-0.3px' }}>
            RTO Engine
          </span>
        </div>

        {/* Search Bar */}
        <div style={{ flex: 1, maxWidth: 600, display: 'flex' }}>
          <input
            type="text"
            placeholder="Search shipments, orders, events..."
            style={{
              flex: 1,
              padding: '0.5rem 0.75rem',
              border: 'none',
              borderRadius: '4px 0 0 4px',
              fontSize: '0.9rem',
              outline: 'none',
            }}
            aria-label="Search"
          />
          <button style={{
            padding: '0.5rem 1rem',
            background: '#FF9900',
            border: 'none',
            borderRadius: '0 4px 4px 0',
            cursor: 'pointer',
            fontSize: '0.85rem',
            fontWeight: 600,
            color: '#0F1111',
          }}>
            Search
          </button>
        </div>

        {/* Right side */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '1.25rem', flexShrink: 0 }}>
          <span style={{ color: '#FFFFFF', fontSize: '0.82rem' }}>Hello, Operator</span>
          <span style={{ color: '#FFFFFF', fontSize: '0.82rem', cursor: 'pointer' }} title="Notifications">Alerts</span>
          <span style={{ color: '#FFFFFF', fontSize: '0.82rem', cursor: 'pointer' }} title="Settings">Settings</span>
        </div>
      </header>

      {/* Secondary Navigation */}
      <nav style={{
        background: '#232F3E',
        padding: '0 1.5rem',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '0',
      }}>
        {navItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === '/'}
            style={({ isActive }) => ({
              display: 'inline-block',
              padding: '0.7rem 1rem',
              color: '#FFFFFF',
              textDecoration: 'none',
              fontSize: '0.85rem',
              fontWeight: isActive ? 600 : 400,
              borderBottom: isActive ? '3px solid #FF9900' : '3px solid transparent',
              transition: 'border-color 0.15s',
            })}
          >
            {item.label}
          </NavLink>
        ))}
      </nav>

      {/* Content Area */}
      <main style={{ padding: '1.5rem', maxWidth: 1320, margin: '0 auto' }}>
        <Outlet />
      </main>
    </div>
  );
}
