import React, { useEffect, useState } from 'react';
import { History, AlertTriangle, FileText, Ban, DollarSign, Calculator, Eye, CheckCircle2 } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { ReceiptModal } from './ReceiptModal';
import { Can } from '../../components/Can';

export const AdminPaymentsPanel: React.FC = () => {
  const { token } = useAuth();
  const [transactions, setTransactions] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedReceiptId, setSelectedReceiptId] = useState<string | null>(null);

  // Estados para Modal de Anulación
  const [voidingPayment, setVoidingPayment] = useState<any | null>(null);
  const [voidReason, setVoidReason] = useState('');
  const [voidSubmitting, setVoidSubmitting] = useState(false);

  // Estados para Cierre de Caja
  const [showClosingModal, setShowClosingModal] = useState(false);
  const [closingData, setClosingData] = useState<any | null>(null);
  const [closingNotes, setClosingNotes] = useState('');
  const [closingSubmitting, setClosingSubmitting] = useState(false);
  const [selectedClosingCashier, setSelectedClosingCashier] = useState('ALL');

  const fetchTransactions = () => {
    setLoading(true);
    fetch('/api/payments/transactions', {
      headers: { Authorization: `Bearer ${token}` }
    })
      .then(res => res.json())
      .then(data => {
        setTransactions(data.transactions || []);
        setLoading(false);
      })
      .catch(e => {
        console.error(e);
        setLoading(false);
      });
  };

  useEffect(() => {
    fetchTransactions();
  }, [token]);

  // Cargar resumen para Cierre de Caja
  const handleOpenClosingModal = (cashierId = 'ALL') => {
    setSelectedClosingCashier(cashierId);
    fetch(`/api/payments/cash-closing/summary?cashierId=${encodeURIComponent(cashierId)}`, {
      headers: { Authorization: `Bearer ${token}` }
    })
      .then(res => res.json())
      .then(data => {
        setClosingData(data);
        setShowClosingModal(true);
      });
  };

  // Ejecutar Anulación
  const handleConfirmVoid = async () => {
    if (!voidReason || voidReason.trim().length < 5) {
      alert('Por favor documente un motivo explícito de anulación (mínimo 5 caracteres).');
      return;
    }

    setVoidSubmitting(true);
    try {
      const res = await fetch(`/api/payments/transactions/${voidingPayment.id}/void`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ reason: voidReason })
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message || 'Error al anular transacción.');
      }

      alert('Recibo anulado exitosamente y deudas reinstauradas.');
      setVoidingPayment(null);
      setVoidReason('');
      fetchTransactions();
    } catch (err: any) {
      alert(err.message);
    } finally {
      setVoidSubmitting(false);
    }
  };

  // Ejecutar Cierre de Caja
  const handleConfirmClosing = async () => {
    setClosingSubmitting(true);
    try {
      const res = await fetch('/api/payments/cash-closing', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ 
          notes: closingNotes,
          cashierId: selectedClosingCashier
        })
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message || 'Error al generar cierre de caja.');
      }

      alert(`Cierre de caja generado con éxito! Nro: ${data.closingNumber}`);
      setShowClosingModal(false);
    } catch (err: any) {
      alert(err.message);
    } finally {
      setClosingSubmitting(false);
    }
  };

  // Estadísticas rápidas
  const totalVolumeUSD = transactions.filter(t => t.status === 'COMPLETED').reduce((sum, t) => sum + t.totalUSD, 0);
  const totalTransactionsCount = transactions.length;
  const voidedCount = transactions.filter(t => t.status === 'VOIDED').length;

  return (
    <div>
      
      {/* Header de la Sección y Botón de Cierre de Caja */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
        <div>
          <h2 style={{ fontSize: '1.5rem', fontWeight: 800, color: '#f3f4f6' }}>Panel de Supervisión y Control Finanzas</h2>
          <p style={{ color: '#9ca3af', fontSize: '0.875rem' }}>Historial auditado de transacciones y cierres de caja por turno.</p>
        </div>

        <Can permission="payments:admin:close_box">
          <button className="btn btn-accent btn-lg" onClick={handleOpenClosingModal}>
            <Calculator size={18} /> Cierre de Caja Diario
          </button>
        </Can>
      </div>

      {/* Tarjetas Estadísticas */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '1.25rem', marginBottom: '2rem' }}>
        <div className="glass-panel" style={{ padding: '1.25rem' }}>
          <div style={{ fontSize: '0.8rem', color: '#9ca3af', textTransform: 'uppercase', fontWeight: 700 }}>Total Recaudado (Efectivo & Digital)</div>
          <div style={{ fontSize: '2rem', fontWeight: 800, color: '#34d399', margin: '0.25rem 0' }}>${totalVolumeUSD.toFixed(2)} USD</div>
          <div style={{ fontSize: '0.75rem', color: '#6b7280' }}>Transacciones Completadas</div>
        </div>

        <div className="glass-panel" style={{ padding: '1.25rem' }}>
          <div style={{ fontSize: '0.8rem', color: '#9ca3af', textTransform: 'uppercase', fontWeight: 700 }}>Total Recibos Emitidos</div>
          <div style={{ fontSize: '2rem', fontWeight: 800, color: '#818cf8', margin: '0.25rem 0' }}>{totalTransactionsCount}</div>
          <div style={{ fontSize: '0.75rem', color: '#6b7280' }}>Registros de Cobro</div>
        </div>

        <div className="glass-panel" style={{ padding: '1.25rem' }}>
          <div style={{ fontSize: '0.8rem', color: '#9ca3af', textTransform: 'uppercase', fontWeight: 700 }}>Recibos Anulados</div>
          <div style={{ fontSize: '2rem', fontWeight: 800, color: '#f87171', margin: '0.25rem 0' }}>{voidedCount}</div>
          <div style={{ fontSize: '0.75rem', color: '#6b7280' }}>Con motivo documentado</div>
        </div>
      </div>

      {/* Tabla de Historial Auditado */}
      <div className="table-container">
        <table className="custom-table">
          <thead>
            <tr>
              <th>Nro. Recibo</th>
              <th>Fecha y Hora</th>
              <th>Estudiante / Grado</th>
              <th>Monto ($ USD)</th>
              <th>Cajera / Usuario</th>
              <th>Estado</th>
              <th style={{ textAlign: 'right' }}>Acciones Permiso RBAC</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={7} style={{ textAlign: 'center', padding: '2rem' }}>Cargando transacciones...</td>
              </tr>
            ) : transactions.length === 0 ? (
              <tr>
                <td colSpan={7} style={{ textAlign: 'center', padding: '2rem' }}>No hay transacciones registradas.</td>
              </tr>
            ) : (
              transactions.map(tx => {
                const student = tx.paymentItems[0]?.debt?.student;
                const isVoided = tx.status === 'VOIDED';

                return (
                  <tr key={tx.id} style={{ opacity: isVoided ? 0.6 : 1 }}>
                    <td style={{ fontWeight: 700, color: '#818cf8' }}>{tx.receiptNumber}</td>
                    <td>{new Date(tx.createdAt).toLocaleString()}</td>
                    <td>
                      <div><strong>{student ? `${student.firstName} ${student.lastName}` : 'N/A'}</strong></div>
                      <div style={{ fontSize: '0.75rem', color: '#9ca3af' }}>{student?.grade}</div>
                    </td>
                    <td style={{ fontWeight: 700, color: '#34d399' }}>
                      ${tx.totalUSD.toFixed(2)} USD
                    </td>
                    <td>{tx.processedBy?.fullName}</td>
                    <td>
                      {isVoided ? (
                        <span className="badge badge-danger">ANULADO</span>
                      ) : (
                        <span className="badge badge-success">COMPLETADO</span>
                      )}
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
                        <button
                          className="btn btn-secondary btn-sm"
                          onClick={() => setSelectedReceiptId(tx.id)}
                          title="Ver Recibo Completo"
                        >
                          <Eye size={14} /> Ver Recibo
                        </button>

                        {!isVoided && (
                          <Can permission="payments:admin:void_receipt">
                            <button
                              className="btn btn-danger btn-sm"
                              onClick={() => { setVoidingPayment(tx); setVoidReason(''); }}
                              title="Anular Recibo con Motivo Auditado"
                            >
                              <Ban size={14} /> Anular
                            </button>
                          </Can>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Modal de Detalle de Recibo */}
      {selectedReceiptId && (
        <ReceiptModal
          paymentId={selectedReceiptId}
          onClose={() => setSelectedReceiptId(null)}
        />
      )}

      {/* Modal de Anulación con Motivo Obligatorio */}
      {voidingPayment && (
        <div className="modal-overlay" onClick={() => setVoidingPayment(null)}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <h3 style={{ color: '#ef4444', display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1rem' }}>
              <AlertTriangle size={22} /> Anulación de Recibo ({voidingPayment.receiptNumber})
            </h3>
            <p style={{ fontSize: '0.875rem', color: '#9ca3af', marginBottom: '1rem' }}>
              La anulación es una acción reversible en la deuda que revertirá el pago de <strong>${voidingPayment.totalUSD.toFixed(2)} USD</strong> y volverá a marcar la deuda del estudiante como PENDIENTE.
            </p>

            <div className="form-group">
              <label className="form-label">Motivo de Anulación (Requerido para la Auditoría)</label>
              <textarea
                rows={3}
                className="textarea-field"
                placeholder="Indique explícitamente el motivo (ej. Error en método de pago seleccionado por la cajera)..."
                value={voidReason}
                onChange={e => setVoidReason(e.target.value)}
                required
              />
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', marginTop: '1.5rem' }}>
              <button className="btn btn-secondary" onClick={() => setVoidingPayment(null)}>
                Cancelar
              </button>
              <button className="btn btn-danger" onClick={handleConfirmVoid} disabled={voidSubmitting}>
                {voidSubmitting ? 'Anulando...' : 'Confirmar Anulación'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal de Generación de Cierre de Caja */}
      {showClosingModal && closingData && (
        <div className="modal-overlay" onClick={() => setShowClosingModal(false)}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <h3 style={{ color: '#10b981', display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1rem' }}>
              <Calculator size={22} /> Reporte de Cierre de Caja Diario
            </h3>

            {/* Selector de Puesto de Caja / Consolidado */}
            <div style={{ marginBottom: '1rem', background: 'rgba(255,255,255,0.03)', padding: '0.75rem', borderRadius: '8px', border: '1px solid var(--border-color)' }}>
              <label style={{ display: 'block', fontSize: '0.8rem', color: '#9ca3af', marginBottom: '0.35rem', fontWeight: 600 }}>
                Filtrar Arqueo por Cajera / Puesto:
              </label>
              <select
                className="select-field"
                style={{ width: '100%', background: '#131b2e', color: '#f3f4f6', border: '1px solid var(--border-color)', padding: '0.5rem', borderRadius: '6px' }}
                value={selectedClosingCashier}
                onChange={e => handleOpenClosingModal(e.target.value)}
              >
                <option value="ALL">🏢 Todas las Cajas (Consolidado General)</option>
                {closingData.availableCashiers?.map((c: any) => (
                  <option key={c.id} value={c.id}>
                    👤 {c.fullName} (@{c.username})
                  </option>
                ))}
              </select>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', background: 'rgba(11, 15, 25, 0.6)', padding: '1rem', borderRadius: '8px', marginBottom: '1.25rem' }}>
              <div>
                <span style={{ fontSize: '0.8rem', color: '#9ca3af' }}>Efectivo USD en Caja:</span>
                <div style={{ fontSize: '1.2rem', fontWeight: 800, color: '#34d399' }}>${closingData.totalCashUSD.toFixed(2)} USD</div>
              </div>
              <div>
                <span style={{ fontSize: '0.8rem', color: '#9ca3af' }}>Efectivo Moneda Local:</span>
                <div style={{ fontSize: '1.2rem', fontWeight: 800, color: '#f3f4f6' }}>{closingData.totalCashLocal.toFixed(2)} VES</div>
              </div>
              <div>
                <span style={{ fontSize: '0.8rem', color: '#9ca3af' }}>Pagos Digitales USD (Zelle):</span>
                <div style={{ fontSize: '1.2rem', fontWeight: 800, color: '#818cf8' }}>${closingData.totalDigitalUSD.toFixed(2)} USD</div>
              </div>
              <div>
                <span style={{ fontSize: '0.8rem', color: '#9ca3af' }}>Pagos Digitales VES (Transf/P.Móvil):</span>
                <div style={{ fontSize: '1.2rem', fontWeight: 800, color: '#f59e0b' }}>{closingData.totalDigitalLocal.toFixed(2)} VES</div>
              </div>
            </div>

            <div style={{ textAlign: 'right', marginBottom: '1.25rem', borderTop: '1px solid var(--border-color)', paddingTop: '0.75rem' }}>
              <span style={{ fontSize: '0.85rem', color: '#9ca3af' }}>Gran Total Consolidado (USD):</span>
              <h2 style={{ fontSize: '2rem', fontWeight: 800, color: '#34d399' }}>${closingData.grandTotalUSD.toFixed(2)} USD</h2>
            </div>

            <div className="form-group">
              <label className="form-label">Observaciones del Cierre</label>
              <textarea
                rows={2}
                className="textarea-field"
                placeholder="Observaciones adicionales para el reporte financiero..."
                value={closingNotes}
                onChange={e => setClosingNotes(e.target.value)}
              />
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', marginTop: '1.5rem' }}>
              <button className="btn btn-secondary" onClick={() => setShowClosingModal(false)}>
                Cancelar
              </button>
              <button className="btn btn-accent" onClick={handleConfirmClosing} disabled={closingSubmitting}>
                {closingSubmitting ? 'Generando Cierre...' : 'Confirmar Cierre de Caja'}
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
};
