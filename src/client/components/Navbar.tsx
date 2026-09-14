import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { ShieldCheck, LogOut, User, Key, RefreshCw, Eye } from 'lucide-react';

export const Navbar: React.FC = () => {
  const { user, logout, login } = useAuth();
  const [showPermsModal, setShowPermsModal] = useState(false);
  const [switching, setSwitching] = useState(false);

  // Selector rápido de roles para pruebas en vivo
  const handleQuickSwitch = async (username: string) => {
    setSwitching(true);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password: '123456' })
      });
      const data = await res.json();
      if (res.ok) {
        login(data.token, data.user);
      }
    } catch (e) {
      console.error('Error cambiando usuario demo:', e);
    } finally {
      setSwitching(false);
    }
  };

  return (
    <>
      <header className="navbar">
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <div style={{
            width: '42px',
            height: '42px',
            borderRadius: '12px',
            background: 'linear-gradient(135deg, #6366f1 0%, #10b981 100%)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: '0 4px 12px rgba(99, 102, 241, 0.4)'
          }}>
            <ShieldCheck size={26} color="#fff" />
          </div>
          <div>
            <h1 style={{ fontSize: '1.2rem', fontWeight: 700, color: '#f3f4f6', lineHeight: 1.1 }}>CDNJ Modular</h1>
            <span style={{ fontSize: '0.75rem', color: '#9ca3af' }}>Sistema de Gestión Escolar</span>
          </div>
        </div>

        {/* Demo Fast Role Switcher */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '0.5rem',
          background: 'rgba(11, 15, 25, 0.7)',
          padding: '0.35rem 0.75rem',
          borderRadius: '9999px',
          border: '1px solid rgba(255, 255, 255, 0.1)'
        }}>
          <span style={{ fontSize: '0.75rem', color: '#9ca3af', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
            <RefreshCw size={12} className={switching ? 'spin' : ''} /> Cambiar Rol Demo:
          </span>
          <button
            onClick={() => handleQuickSwitch('cajera')}
            className={`btn btn-sm ${user?.username === 'cajera' ? 'btn-accent' : 'btn-secondary'}`}
            style={{ fontSize: '0.75rem', padding: '0.2rem 0.6rem' }}
          >
            Cajera
          </button>
          <button
            onClick={() => handleQuickSwitch('admin')}
            className={`btn btn-sm ${user?.username === 'admin' ? 'btn-primary' : 'btn-secondary'}`}
            style={{ fontSize: '0.75rem', padding: '0.2rem 0.6rem' }}
          >
            Admin
          </button>
          <button
            onClick={() => handleQuickSwitch('superadmin')}
            className={`btn btn-sm ${user?.username === 'superadmin' ? 'btn-primary' : 'btn-secondary'}`}
            style={{ fontSize: '0.75rem', padding: '0.2rem 0.6rem', background: user?.username === 'superadmin' ? '#8b5cf6' : '' }}
          >
            Superadmin
          </button>
        </div>

        {/* Profile Info */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <button
            onClick={() => setShowPermsModal(true)}
            className="btn btn-secondary btn-sm"
            title="Ver Permisos Granulares de tu usuario"
            style={{ gap: '0.35rem' }}
          >
            <Key size={14} /> Permisos ({user?.permissions.length || 0})
          </button>

          <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
            <div style={{
              width: '38px',
              height: '38px',
              borderRadius: '50%',
              background: 'rgba(99, 102, 241, 0.2)',
              border: '1px solid rgba(99, 102, 241, 0.4)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#818cf8',
              fontWeight: 700
            }}>
              <User size={20} />
            </div>
            <div>
              <div style={{ fontSize: '0.875rem', fontWeight: 600, color: '#f3f4f6' }}>{user?.fullName}</div>
              <div style={{ display: 'flex', gap: '0.25rem', marginTop: '2px' }}>
                {user?.roles.map(role => (
                  <span key={role} className="badge badge-primary" style={{ fontSize: '0.65rem', padding: '0.1rem 0.4rem' }}>
                    {role}
                  </span>
                ))}
              </div>
            </div>
          </div>

          <button onClick={logout} className="btn btn-secondary btn-sm" style={{ color: '#ef4444' }} title="Cerrar Sesión">
            <LogOut size={16} />
          </button>
        </div>
      </header>

      {/* Modal de Permisos Activos del Usuario */}
      {showPermsModal && (
        <div className="modal-overlay" onClick={() => setShowPermsModal(false)}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
              <h3 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: '#f3f4f6' }}>
                <Key size={20} color="#818cf8" /> Permisos Granulares de ({user?.username})
              </h3>
              <button className="btn btn-secondary btn-sm" onClick={() => setShowPermsModal(false)}>✕</button>
            </div>
            <p style={{ fontSize: '0.875rem', color: '#9ca3af', marginBottom: '1rem' }}>
              Estos son los permisos asignados a tu token JWT actual según tus roles (<strong>{user?.roles.join(', ')}</strong>):
            </p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', maxHeight: '300px', overflowY: 'auto', padding: '0.5rem', background: 'rgba(11, 15, 25, 0.6)', borderRadius: '8px' }}>
              {user?.permissions.map(perm => (
                <span key={perm} className="badge badge-success" style={{ fontSize: '0.8rem', padding: '0.35rem 0.65rem' }}>
                  {perm}
                </span>
              ))}
            </div>
            <div style={{ marginTop: '1.5rem', textAlign: 'right' }}>
              <button className="btn btn-primary btn-sm" onClick={() => setShowPermsModal(false)}>Entendido</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
