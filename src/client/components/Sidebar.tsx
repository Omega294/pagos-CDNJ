import React from 'react';
import { useAuth } from '../context/AuthContext';
import { CreditCard, History, Settings, GraduationCap, Users, Calendar, Lock } from 'lucide-react';

interface SidebarProps {
  activeTab: string;
  setActiveTab: (tab: string) => void;
}

export const Sidebar: React.FC<SidebarProps> = ({ activeTab, setActiveTab }) => {
  const { hasPermission } = useAuth();

  return (
    <aside style={{
      width: '260px',
      background: 'rgba(19, 27, 46, 0.6)',
      borderRight: '1px solid var(--border-color)',
      padding: '1.5rem 1rem',
      display: 'flex',
      flexDirection: 'column',
      gap: '2rem'
    }}>
      {/* Módulo Activo: Cobros */}
      <div>
        <div style={{
          fontSize: '0.75rem',
          fontWeight: 700,
          color: '#6b7280',
          textTransform: 'uppercase',
          letterSpacing: '0.08em',
          marginBottom: '0.75rem',
          paddingLeft: '0.75rem'
        }}>
          Módulo 1: Cobros
        </div>

        <nav style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
          {hasPermission('payments:cashier:create_payment') && (
            <button
              onClick={() => setActiveTab('cashier')}
              className={`btn ${activeTab === 'cashier' ? 'btn-primary' : 'btn-secondary'}`}
              style={{ justifyContent: 'flex-start', width: '100%' }}
            >
              <CreditCard size={18} /> Panel de Cobro
            </button>
          )}

          {hasPermission('payments:admin:view_history') && (
            <button
              onClick={() => setActiveTab('admin')}
              className={`btn ${activeTab === 'admin' ? 'btn-primary' : 'btn-secondary'}`}
              style={{ justifyContent: 'flex-start', width: '100%' }}
            >
              <History size={18} /> Supervisión & Cierre
            </button>
          )}

          {hasPermission('payments:config:manage_rates') && (
            <button
              onClick={() => setActiveTab('rates')}
              className={`btn ${activeTab === 'rates' ? 'btn-primary' : 'btn-secondary'}`}
              style={{ justifyContent: 'flex-start', width: '100%' }}
            >
              <Settings size={18} /> Config. Aranceles
            </button>
          )}
        </nav>
      </div>

      {/* Módulos Escalables Futuros */}
      <div>
        <div style={{
          fontSize: '0.75rem',
          fontWeight: 700,
          color: '#6b7280',
          textTransform: 'uppercase',
          letterSpacing: '0.08em',
          marginBottom: '0.75rem',
          paddingLeft: '0.75rem'
        }}>
          Próximos Módulos
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', opacity: 0.5 }}>
          <div className="glass-card" style={{ padding: '0.65rem 0.85rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '0.85rem' }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <GraduationCap size={16} /> Calificaciones
            </span>
            <Lock size={12} />
          </div>

          <div className="glass-card" style={{ padding: '0.65rem 0.85rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '0.85rem' }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <Users size={16} /> Matrículas
            </span>
            <Lock size={12} />
          </div>

          <div className="glass-card" style={{ padding: '0.65rem 0.85rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '0.85rem' }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <Calendar size={16} /> Asistencia
            </span>
            <Lock size={12} />
          </div>
        </div>
      </div>
    </aside>
  );
};
