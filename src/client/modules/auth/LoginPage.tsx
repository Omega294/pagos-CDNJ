import React, { useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { ShieldCheck, UserCheck, KeyRound, ArrowRight } from 'lucide-react';

export const LoginPage: React.FC = () => {
  const { login } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message || 'Error iniciando sesión.');
      }
      login(data.token, data.user);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleDemoLogin = (u: string, p: string) => {
    setUsername(u);
    setPassword(p);
    fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: u, password: p })
    })
      .then(res => res.json())
      .then(data => {
        if (data.token) login(data.token, data.user);
      });
  };

  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '2rem',
      background: 'radial-gradient(circle at top right, rgba(99, 102, 241, 0.15), transparent 40%), radial-gradient(circle at bottom left, rgba(16, 185, 129, 0.15), transparent 40%)'
    }}>
      <div style={{ width: '100%', maxWidth: '960px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2rem', alignItems: 'center' }}>
        
        {/* Presentación del Proyecto */}
        <div>
          <div style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '0.5rem',
            padding: '0.35rem 0.85rem',
            borderRadius: '9999px',
            background: 'rgba(99, 102, 241, 0.15)',
            border: '1px solid rgba(99, 102, 241, 0.3)',
            color: '#818cf8',
            fontSize: '0.825rem',
            fontWeight: 700,
            marginBottom: '1rem'
          }}>
            <ShieldCheck size={16} /> CDNJ School Platform v1.0
          </div>
          <h1 style={{ fontSize: '2.5rem', fontWeight: 800, lineHeight: 1.1, marginBottom: '1rem', color: '#f3f4f6' }}>
            Arquitectura Modular & RBAC Granular
          </h1>
          <p style={{ color: '#9ca3af', fontSize: '1rem', lineHeight: 1.6, marginBottom: '2rem' }}>
            Sistema de gestión escolar escalable con control de acceso estricto por roles y permisos. Prueba el primer módulo funcional de <strong>Cobro de Mensualidades y Cierre de Caja</strong>.
          </p>

          {/* Tarjetas de Usuarios Demo de Acceso Rápido */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            <span style={{ fontSize: '0.8rem', fontWeight: 700, color: '#6b7280', textTransform: 'uppercase' }}>Acceso Rápido Demo (1-Click):</span>
            
            <div
              onClick={() => handleDemoLogin('cajera', '123456')}
              className="glass-card"
              style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}
            >
              <div>
                <strong style={{ color: '#10b981', display: 'block' }}>Rol: CAJERA (María González)</strong>
                <span style={{ fontSize: '0.8rem', color: '#9ca3af' }}>Permisos: Buscar alumnos, registrar pagos multimoneda y emitir recibos.</span>
              </div>
              <ArrowRight size={18} color="#10b981" />
            </div>

            <div
              onClick={() => handleDemoLogin('admin', '123456')}
              className="glass-card"
              style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}
            >
              <div>
                <strong style={{ color: '#6366f1', display: 'block' }}>Rol: ADMINISTRADOR (Lic. Ana Martínez)</strong>
                <span style={{ fontSize: '0.8rem', color: '#9ca3af' }}>Permisos: Historial completo, anulación con motivo, tasas y cierre de caja.</span>
              </div>
              <ArrowRight size={18} color="#6366f1" />
            </div>

            <div
              onClick={() => handleDemoLogin('superadmin', '123456')}
              className="glass-card"
              style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}
            >
              <div>
                <strong style={{ color: '#a855f7', display: 'block' }}>Rol: SUPERADMIN (Global)</strong>
                <span style={{ fontSize: '0.8rem', color: '#9ca3af' }}>Permisos: Control total implícito (*) en todo el sistema.</span>
              </div>
              <ArrowRight size={18} color="#a855f7" />
            </div>
          </div>
        </div>

        {/* Formulario de Login */}
        <div className="glass-panel" style={{ padding: '2.5rem' }}>
          <h2 style={{ fontSize: '1.5rem', fontWeight: 700, marginBottom: '0.5rem', color: '#f3f4f6' }}>Iniciar Sesión</h2>
          <p style={{ fontSize: '0.875rem', color: '#9ca3af', marginBottom: '1.75rem' }}>
            Ingresa tus credenciales para acceder al panel.
          </p>

          {error && (
            <div style={{ padding: '0.75rem 1rem', background: 'rgba(239, 68, 68, 0.15)', border: '1px solid rgba(239, 68, 68, 0.3)', borderRadius: '8px', color: '#f87171', fontSize: '0.875rem', marginBottom: '1.25rem' }}>
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit}>
            <div className="form-group">
              <label className="form-label">Usuario</label>
              <div style={{ position: 'relative' }}>
                <input
                  type="text"
                  className="input-field"
                  value={username}
                  onChange={e => setUsername(e.target.value)}
                  placeholder="ej. cajera o admin"
                  required
                />
              </div>
            </div>

            <div className="form-group">
              <label className="form-label">Contraseña</label>
              <input
                type="password"
                className="input-field"
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="••••••••"
                required
              />
            </div>

            <button type="submit" className="btn btn-primary btn-lg" style={{ width: '100%', marginTop: '1rem' }} disabled={loading}>
              {loading ? 'Ingresando...' : 'Acceder al Sistema'}
            </button>
          </form>
        </div>

      </div>
    </div>
  );
};
