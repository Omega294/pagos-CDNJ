import React, { useEffect, useState } from 'react';
import { Settings, RefreshCw, DollarSign, CheckCircle2 } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';

export const FeeConfigPanel: React.FC = () => {
  const { token } = useAuth();
  const [exchangeRate, setExchangeRate] = useState<number>(36.50);
  const [newRate, setNewRate] = useState<string>('36.50');
  const [concepts, setConcepts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<string | null>(null);

  const fetchRatesAndConcepts = () => {
    setLoading(true);
    fetch('/api/payments/rates', {
      headers: { Authorization: `Bearer ${token}` }
    })
      .then(res => res.json())
      .then(data => {
        setExchangeRate(data.exchangeRate);
        setNewRate(String(data.exchangeRate));
        setConcepts(data.concepts || []);
        setLoading(false);
      })
      .catch(e => {
        console.error(e);
        setLoading(false);
      });
  };

  useEffect(() => {
    fetchRatesAndConcepts();
  }, [token]);

  const handleUpdateRate = async (e: React.FormEvent) => {
    e.preventDefault();
    setMessage(null);
    try {
      const res = await fetch('/api/payments/rates', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ exchangeRate: parseFloat(newRate) })
      });
      const data = await res.json();
      setExchangeRate(data.exchangeRate);
      setMessage('Tasa de cambio de referencia actualizada exitosamente.');
    } catch (err: any) {
      console.error(err);
    }
  };

  return (
    <div style={{ maxWidth: '800px' }}>
      <h2 style={{ fontSize: '1.5rem', fontWeight: 800, color: '#f3f4f6', marginBottom: '0.5rem' }}>
        Configuración de Aranceles y Tasa de Cambio
      </h2>
      <p style={{ color: '#9ca3af', fontSize: '0.875rem', marginBottom: '1.5rem' }}>
        Gestión de parámetros monetarios globales para la emisión de cobros y facturación.
      </p>

      {message && (
        <div style={{ padding: '0.75rem 1rem', background: 'rgba(16, 185, 129, 0.15)', border: '1px solid rgba(16, 185, 129, 0.3)', borderRadius: '8px', color: '#34d399', fontSize: '0.875rem', marginBottom: '1.5rem' }}>
          {message}
        </div>
      )}

      {/* Ajuste de Tasa de Cambio de Referencia */}
      <div className="glass-panel" style={{ padding: '1.5rem', marginBottom: '2rem' }}>
        <h3 style={{ fontSize: '1.1rem', fontWeight: 700, color: '#f3f4f6', marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <RefreshCw size={18} color="#818cf8" /> Tasa de Cambio de Referencia Diaria (USD / Moneda Local)
        </h3>

        <form onSubmit={handleUpdateRate} style={{ display: 'flex', gap: '1rem', alignItems: 'flex-end' }}>
          <div className="form-group" style={{ flex: 1, marginBottom: 0 }}>
            <label className="form-label">Tasa Actual (VES por 1.00 USD)</label>
            <input
              type="number"
              step="0.01"
              className="input-field"
              value={newRate}
              onChange={e => setNewRate(e.target.value)}
              required
            />
          </div>
          <button type="submit" className="btn btn-primary">
            Guardar Nueva Tasa
          </button>
        </form>
      </div>

      {/* Catálogo de Conceptos de Cobro y Tarifas */}
      <div className="glass-panel" style={{ padding: '1.5rem' }}>
        <h3 style={{ fontSize: '1.1rem', fontWeight: 700, color: '#f3f4f6', marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <DollarSign size={18} color="#10b981" /> Catálogo de Aranceles y Mensualidades Configuradas
        </h3>

        <div className="table-container">
          <table className="custom-table">
            <thead>
              <tr>
                <th>Código</th>
                <th>Nombre del Concepto</th>
                <th>Monto USD</th>
                <th>Equivalente Actual</th>
                <th>Tipo</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={5} style={{ textAlign: 'center', padding: '1.5rem' }}>Cargando conceptos...</td></tr>
              ) : concepts.map(c => (
                <tr key={c.id}>
                  <td style={{ fontWeight: 700, color: '#818cf8' }}>{c.code}</td>
                  <td>{c.name}</td>
                  <td style={{ fontWeight: 700, color: '#34d399' }}>${c.amountUSD.toFixed(2)} USD</td>
                  <td>{(c.amountUSD * exchangeRate).toFixed(2)} VES</td>
                  <td>
                    {c.isRecurring ? (
                      <span className="badge badge-primary">Recurrente</span>
                    ) : (
                      <span className="badge badge-warning">Único</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

    </div>
  );
};
