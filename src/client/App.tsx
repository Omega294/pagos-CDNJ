import React, { useState } from 'react';
import { useAuth } from './context/AuthContext';
import { LoginPage } from './modules/auth/LoginPage';
import { Navbar } from './components/Navbar';
import { Sidebar } from './components/Sidebar';
import { CashierPanel } from './modules/payments/CashierPanel';
import { AdminPaymentsPanel } from './modules/payments/AdminPaymentsPanel';
import { FeeConfigPanel } from './modules/payments/FeeConfigPanel';
import { Can } from './components/Can';
import { Lock } from 'lucide-react';

export const AppContent: React.FC = () => {
  const { user, loading, hasPermission } = useAuth();
  const [activeTab, setActiveTab] = useState<string>('cashier');

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#0b0f19', color: '#9ca3af' }}>
        <div>Cargando plataforma CDNJ...</div>
      </div>
    );
  }

  if (!user) {
    return <LoginPage />;
  }

  return (
    <div className="app-container">
      <Sidebar activeTab={activeTab} setActiveTab={setActiveTab} />
      
      <div className="main-content">
        <Navbar />

        <main className="page-body">
          {activeTab === 'cashier' && (
            <Can
              permission="payments:cashier:create_payment"
              fallback={
                <AccessDeniedView requiredPermission="payments:cashier:create_payment" roleName={user.roles.join(', ')} />
              }
            >
              <CashierPanel />
            </Can>
          )}

          {activeTab === 'admin' && (
            <Can
              permission="payments:admin:view_history"
              fallback={
                <AccessDeniedView requiredPermission="payments:admin:view_history" roleName={user.roles.join(', ')} />
              }
            >
              <AdminPaymentsPanel />
            </Can>
          )}

          {activeTab === 'rates' && (
            <Can
              permission="payments:config:manage_rates"
              fallback={
                <AccessDeniedView requiredPermission="payments:config:manage_rates" roleName={user.roles.join(', ')} />
              }
            >
              <FeeConfigPanel />
            </Can>
          )}
        </main>
      </div>
    </div>
  );
};

const AccessDeniedView: React.FC<{ requiredPermission: string; roleName: string }> = ({ requiredPermission, roleName }) => (
  <div style={{ padding: '4rem 2rem', textAlign: 'center', maxWidth: '600px', margin: '0 auto' }}>
    <div className="glass-panel" style={{ padding: '2.5rem' }}>
      <Lock size={48} color="#ef4444" style={{ marginBottom: '1rem' }} />
      <h2 style={{ fontSize: '1.5rem', fontWeight: 800, color: '#f3f4f6', marginBottom: '0.5rem' }}>Acceso Restringido (RBAC)</h2>
      <p style={{ color: '#9ca3af', fontSize: '0.95rem', lineHeight: 1.6, marginBottom: '1.5rem' }}>
        Tu rol actual (<strong>{roleName}</strong>) no dispone del permiso granular <code style={{ color: '#818cf8', background: 'rgba(99,102,241,0.15)', padding: '0.2rem 0.5rem', borderRadius: '4px' }}>{requiredPermission}</code> para acceder a este módulo.
      </p>
      <p style={{ fontSize: '0.8rem', color: '#6b7280' }}>
        Sugerencia: Utiliza el cambiador rápido de usuario en la barra superior para alternar al rol de <strong>Administrador</strong> o <strong>Superadmin</strong>.
      </p>
    </div>
  </div>
);

export function App() {
  return <AppContent />;
}
