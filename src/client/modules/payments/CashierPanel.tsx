import React, { useState } from 'react';
import { Search, User, CreditCard, DollarSign, CheckCircle2, AlertCircle, Plus, Trash2 } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { ReceiptModal } from './ReceiptModal';

export const CashierPanel: React.FC = () => {
  const { token } = useAuth();
  const [query, setQuery] = useState('');
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [searching, setSearching] = useState(false);
  const [selectedStudent, setSelectedStudent] = useState<any>(null);
  
  const [debts, setDebts] = useState<any[]>([]);
  const [selectedDebtIds, setSelectedDebtIds] = useState<string[]>([]);
  const [exchangeRate, setExchangeRate] = useState<number>(36.50);

  // Métodos de Pago Dinámicos
  const [paymentMethods, setPaymentMethods] = useState<Array<{ method: string; amount: number; currency: string; reference: string }>>([
    { method: 'CASH_USD', amount: 0, currency: 'USD', reference: '' }
  ]);

  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [createdPaymentId, setCreatedPaymentId] = useState<string | null>(null);

  // 1. Buscar estudiante o representante
  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!query.trim()) return;
    setSearching(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/payments/students/search?q=${encodeURIComponent(query)}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await res.json();
      setSearchResults(data);
    } catch (err) {
      console.error(err);
    } finally {
      setSearching(false);
    }
  };

  // 2. Seleccionar estudiante y cargar sus deudas
  const handleSelectStudent = async (student: any) => {
    setSelectedStudent(student);
    try {
      const res = await fetch(`/api/payments/students/${student.id}/debts`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await res.json();
      setDebts(data.debts || []);
      setExchangeRate(data.exchangeRate || 36.50);
      // Seleccionar todas por defecto
      const allIds = (data.debts || []).map((d: any) => d.id);
      setSelectedDebtIds(allIds);

      // Calcular total USD inicial
      const totalUSD = (data.debts || []).reduce((sum: number, d: any) => sum + d.amountUSD, 0);
      setPaymentMethods([{ method: 'CASH_USD', amount: totalUSD, currency: 'USD', reference: '' }]);
    } catch (err) {
      console.error(err);
    }
  };

  // Checkbox de selección de deudas
  const toggleDebtSelection = (id: string) => {
    if (selectedDebtIds.includes(id)) {
      setSelectedDebtIds(selectedDebtIds.filter(item => item !== id));
    } else {
      setSelectedDebtIds([...selectedDebtIds, id]);
    }
  };

  // Totales
  const totalToPayUSD = debts
    .filter(d => selectedDebtIds.includes(d.id))
    .reduce((sum, d) => sum + d.amountUSD, 0);

  const totalToPayLocal = totalToPayUSD * exchangeRate;

  // Manejar Métodos de Pago Multimoneda
  const addPaymentMethod = () => {
    setPaymentMethods([...paymentMethods, { method: 'TRANSFER', amount: 0, currency: 'VES', reference: '' }]);
  };

  const removePaymentMethod = (index: number) => {
    setPaymentMethods(paymentMethods.filter((_, i) => i !== index));
  };

  const updateMethodField = (index: number, field: string, value: any) => {
    const updated = [...paymentMethods];
    (updated[index] as any)[field] = value;
    setPaymentMethods(updated);
  };

  // Total abonado en USD convirtiendo moneda local a tasa de cambio
  const totalEnteredUSD = paymentMethods.reduce((sum, m) => {
    const val = Number(m.amount) || 0;
    if (m.currency === 'USD') return sum + val;
    return sum + (val / exchangeRate);
  }, 0);

  // 3. Procesar cobro
  const handleProcessPayment = async () => {
    if (selectedDebtIds.length === 0) {
      setMessage({ type: 'error', text: 'Debe seleccionar al menos un concepto a cobrar.' });
      return;
    }

    setSubmitting(true);
    setMessage(null);

    try {
      const res = await fetch('/api/payments/transactions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          studentId: selectedStudent.id,
          selectedDebtIds,
          methods: paymentMethods,
          exchangeRate
        })
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message || 'Error al procesar el pago.');
      }

      setMessage({ type: 'success', text: `Pago registrado exitosamente. Recibo: ${data.receiptNumber}` });
      setCreatedPaymentId(data.id);
      
      // Limpiar formulario
      setSelectedStudent(null);
      setDebts([]);
      setSelectedDebtIds([]);
      setSearchResults([]);
    } catch (err: any) {
      setMessage({ type: 'error', text: err.message });
    } finally {
      setSubmitting(false);
    }
  };

  const [searchMode, setSearchMode] = useState<'all' | 'rep' | 'est' | 'cedula'>('all');

  const handleModeChange = (mode: 'all' | 'rep' | 'est' | 'cedula') => {
    setSearchMode(mode);
    if (mode === 'rep') setQuery('REP-');
    else if (mode === 'est') setQuery('EST-2026-');
    else if (mode === 'cedula') setQuery('V-');
    else setQuery('');
  };

  const handleInputChange = (val: string) => {
    if (searchMode === 'rep') {
      if (!val.toUpperCase().startsWith('REP-')) {
        const digits = val.replace(/\D/g, '');
        val = digits ? 'REP-' + digits.padStart(3, '0') : 'REP-';
      }
    } else if (searchMode === 'est') {
      if (!val.toUpperCase().startsWith('EST-2026-')) {
        const digits = val.replace(/\D/g, '');
        val = digits ? 'EST-2026-' + digits.padStart(4, '0') : 'EST-2026-';
      }
    } else if (searchMode === 'cedula') {
      if (!val.toUpperCase().startsWith('V-') && !val.toUpperCase().startsWith('CE-')) {
        const digits = val.replace(/\D/g, '');
        val = digits ? 'V-' + digits : 'V-';
      }
    }
    setQuery(val);
  };

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.2fr', gap: '2rem' }}>
      
      {/* Columna Izquierda: Búsqueda y Selección de Alumno */}
      <div>
        <div className="glass-panel" style={{ padding: '1.5rem', marginBottom: '1.5rem' }}>
          <h3 style={{ fontSize: '1.1rem', fontWeight: 700, marginBottom: '1rem', color: '#f3f4f6', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <Search size={18} color="#818cf8" /> Panel de Cobro - Búsqueda de Alumno
          </h3>

          <div style={{ display: 'flex', gap: '0.35rem', marginBottom: '0.75rem', flexWrap: 'wrap' }}>
            <button
              type="button"
              onClick={() => handleModeChange('all')}
              className={`btn btn-sm ${searchMode === 'all' ? 'btn-primary' : 'btn-secondary'}`}
              style={{ fontSize: '0.75rem', padding: '0.25rem 0.6rem' }}
            >
              🔍 Todos
            </button>
            <button
              type="button"
              onClick={() => handleModeChange('rep')}
              className={`btn btn-sm ${searchMode === 'rep' ? 'btn-accent' : 'btn-secondary'}`}
              style={{ fontSize: '0.75rem', padding: '0.25rem 0.6rem' }}
            >
              🪪 Cod. Rep (REP-)
            </button>
            <button
              type="button"
              onClick={() => handleModeChange('est')}
              className={`btn btn-sm ${searchMode === 'est' ? 'btn-primary' : 'btn-secondary'}`}
              style={{ fontSize: '0.75rem', padding: '0.25rem 0.6rem', background: searchMode === 'est' ? '#8b5cf6' : '', borderColor: searchMode === 'est' ? '#8b5cf6' : '' }}
            >
              🎓 Cod. Alumno (EST-)
            </button>
            <button
              type="button"
              onClick={() => handleModeChange('cedula')}
              className={`btn btn-sm ${searchMode === 'cedula' ? 'btn-primary' : 'btn-secondary'}`}
              style={{ fontSize: '0.75rem', padding: '0.25rem 0.6rem' }}
            >
              📄 Cédula (V-)
            </button>
          </div>

          <form onSubmit={handleSearch} style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem' }}>
            <input
              type="text"
              className="input-field"
              placeholder={searchMode === 'rep' ? 'Escribe los números (ej: 015)...' : searchMode === 'est' ? 'Escribe los números (ej: 0041)...' : 'Buscar por Nombre, Cédula o Código...'}
              value={query}
              onChange={e => handleInputChange(e.target.value)}
            />
            <button type="submit" className="btn btn-primary" disabled={searching}>
              {searching ? '...' : 'Buscar'}
            </button>
          </form>

          {/* Resultados de búsqueda */}
          {searchResults.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', maxHeight: '350px', overflowY: 'auto' }}>
              {searchResults.map(student => (
                <div
                  key={student.id}
                  onClick={() => handleSelectStudent(student)}
                  className={`glass-card ${selectedStudent?.id === student.id ? 'active' : ''}`}
                  style={{
                    cursor: 'pointer',
                    borderColor: selectedStudent?.id === student.id ? '#6366f1' : undefined,
                    background: selectedStudent?.id === student.id ? 'rgba(99, 102, 241, 0.15)' : undefined
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                      <strong style={{ color: '#f3f4f6', fontSize: '0.95rem' }}>{student.firstName} {student.lastName}</strong>
                      <div style={{ fontSize: '0.8rem', color: '#9ca3af' }}>{student.grade} | Código: {student.studentCode}</div>
                    </div>
                    <span className="badge badge-warning">
                      {student.debts?.length || 0} Pendientes
                    </span>
                  </div>
                  {student.guardians[0] && (
                    <div style={{ fontSize: '0.75rem', color: '#6b7280', marginTop: '0.35rem' }}>
                      Representante: {student.guardians[0].guardian.fullName} ({student.guardians[0].guardian.docId})
                    </div>
                  )}
                </div>
              ))}
            </div>
           {/* Tarjeta Detalle de Alumno y Representante Seleccionados */}
        {selectedStudent && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            
            {/* Tarjeta 1: Estudiante (Tema Púrpura) */}
            <div className="glass-panel" style={{ padding: '1.25rem', border: '1px solid rgba(99, 102, 241, 0.4)', background: 'rgba(99, 102, 241, 0.08)', boxShadow: '0 4px 20px rgba(99, 102, 241, 0.15)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
                <h4 style={{ color: '#818cf8', fontSize: '0.95rem', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '0.4rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  <User size={18} /> Estudiante (Representado)
                </h4>
                <span className="badge badge-primary" style={{ fontSize: '0.75rem', padding: '0.25rem 0.65rem' }}>
                  {selectedStudent.studentCode}
                </span>
              </div>

              <div style={{ fontSize: '0.875rem', display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                <div><span style={{ color: '#9ca3af' }}>Nombre Completo:</span> <strong style={{ color: '#f3f4f6', fontSize: '1rem', marginLeft: '0.3rem' }}>{selectedStudent.firstName} {selectedStudent.lastName}</strong></div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'rgba(11,15,25,0.4)', padding: '0.5rem 0.75rem', borderRadius: '6px' }}>
                  <span><span style={{ color: '#9ca3af' }}>Cédula / ID:</span> <strong style={{ color: '#f3f4f6' }}>{selectedStudent.docId || 'S/D'}</strong></span>
                  <span><span style={{ color: '#9ca3af' }}>Curso:</span> <strong style={{ color: '#818cf8' }}>{selectedStudent.grade}</strong></span>
                </div>
              </div>
            </div>

            {/* Tarjeta 2: Representante Legal (Tema Esmeralda) */}
            {selectedStudent.guardians[0] && (
              <div className="glass-panel" style={{ padding: '1.25rem', border: '1px solid rgba(16, 185, 129, 0.4)', background: 'rgba(16, 185, 129, 0.08)', boxShadow: '0 4px 20px rgba(16, 185, 129, 0.15)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
                  <h4 style={{ color: '#34d399', fontSize: '0.95rem', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '0.4rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                    <User size={18} /> Representante Legal (Tutor)
                  </h4>
                  <span className="badge badge-success" style={{ fontSize: '0.75rem', padding: '0.25rem 0.65rem' }}>
                    {selectedStudent.guardians[0].guardian.guardianCode}
                  </span>
                </div>

                <div style={{ fontSize: '0.875rem', display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                  <div><span style={{ color: '#9ca3af' }}>Nombre Completo:</span> <strong style={{ color: '#f3f4f6', fontSize: '1rem', marginLeft: '0.3rem' }}>{selectedStudent.guardians[0].guardian.fullName}</strong></div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'rgba(11,15,25,0.4)', padding: '0.5rem 0.75rem', borderRadius: '6px' }}>
                    <span><span style={{ color: '#9ca3af' }}>Cédula:</span> <strong style={{ color: '#f3f4f6' }}>{selectedStudent.guardians[0].guardian.docId}</strong></span>
                    <span><span style={{ color: '#9ca3af' }}>Teléfono:</span> <strong style={{ color: '#34d399' }}>{selectedStudent.guardians[0].guardian.phone}</strong></span>
                  </div>
                </div>
              </div>
            )}

          </div>
        )}
      </div>

      {/* Columna Derecha: Selección de Deudas y Formulario Multimoneda */}
      <div>
        <div className="glass-panel" style={{ padding: '1.5rem' }}>
          <h3 style={{ fontSize: '1.1rem', fontWeight: 700, marginBottom: '1rem', color: '#f3f4f6', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <CreditCard size={18} color="#10b981" /> Deudas y Formulario de Cobro
          </h3>

          {message && (
            <div style={{
              padding: '0.75rem 1rem',
              borderRadius: '8px',
              fontSize: '0.875rem',
              marginBottom: '1rem',
              background: message.type === 'success' ? 'rgba(16, 185, 129, 0.15)' : 'rgba(239, 68, 68, 0.15)',
              border: message.type === 'success' ? '1px solid rgba(16, 185, 129, 0.3)' : '1px solid rgba(239, 68, 68, 0.3)',
              color: message.type === 'success' ? '#34d399' : '#f87171'
            }}>
              {message.text}
            </div>
          )}

          {!selectedStudent ? (
            <div style={{ padding: '3rem 1.5rem', textAlign: 'center', color: '#9ca3af' }}>
              <User size={36} style={{ opacity: 0.5, marginBottom: '0.5rem' }} />
              <p>Busca y selecciona un estudiante a la izquierda para iniciar el cobro.</p>
            </div>
          ) : debts.length === 0 ? (
            <div style={{ padding: '2rem', textAlign: 'center', color: '#34d399' }}>
              <CheckCircle2 size={36} style={{ marginBottom: '0.5rem' }} />
              <p>El estudiante no tiene deudas pendientes acumuladas.</p>
            </div>
          ) : (
            <div>
              <span style={{ fontSize: '0.8rem', fontWeight: 700, color: '#9ca3af', textTransform: 'uppercase' }}>
                1. Selecciona los Conceptos a Cobrar:
              </span>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', margin: '0.75rem 0 1.5rem 0' }}>
                {debts.map(debt => (
                  <label
                    key={debt.id}
                    className="glass-card"
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      cursor: 'pointer',
                      background: selectedDebtIds.includes(debt.id) ? 'rgba(16, 185, 129, 0.1)' : undefined
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                      <input
                        type="checkbox"
                        checked={selectedDebtIds.includes(debt.id)}
                        onChange={() => toggleDebtSelection(debt.id)}
                        style={{ width: '18px', height: '18px', accentColor: '#10b981' }}
                      />
                      <div>
                        <strong style={{ color: '#f3f4f6', fontSize: '0.9rem' }}>{debt.feeConcept?.name}</strong>
                        <div style={{ fontSize: '0.75rem', color: '#9ca3af' }}>Vence: {new Date(debt.dueDate).toLocaleDateString()}</div>
                      </div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <span style={{ fontSize: '1rem', fontWeight: 700, color: '#34d399' }}>${debt.amountUSD.toFixed(2)}</span>
                      <div style={{ fontSize: '0.75rem', color: '#6b7280' }}>{(debt.amountUSD * exchangeRate).toFixed(2)} VES</div>
                    </div>
                  </label>
                ))}
              </div>

              {/* Caja de Resumen Total */}
              <div style={{ background: 'rgba(11, 15, 25, 0.8)', padding: '1rem', borderRadius: '10px', border: '1px solid var(--border-color)', marginBottom: '1.5rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <span style={{ fontSize: '0.8rem', color: '#9ca3af' }}>Total Seleccionado:</span>
                    <h2 style={{ fontSize: '1.5rem', fontWeight: 800, color: '#34d399' }}>${totalToPayUSD.toFixed(2)} USD</h2>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <span style={{ fontSize: '0.75rem', color: '#9ca3af' }}>Tasa Ref: {exchangeRate.toFixed(2)} VES/USD</span>
                    <div style={{ fontSize: '1.1rem', fontWeight: 700, color: '#f3f4f6' }}>{totalToPayLocal.toLocaleString('es-VE', { minimumFractionDigits: 2 })} VES</div>
                  </div>
                </div>
              </div>

              {/* Sección 2: Desglose de Métodos de Pago */}
              <div style={{ marginBottom: '1.5rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
                  <span style={{ fontSize: '0.8rem', fontWeight: 700, color: '#9ca3af', textTransform: 'uppercase' }}>
                    2. Desglose de Pago (Multimoneda):
                  </span>
                  <button type="button" className="btn btn-secondary btn-sm" onClick={addPaymentMethod}>
                    <Plus size={14} /> Añadir Método
                  </button>
                </div>

                {paymentMethods.map((m, idx) => (
                  <div key={idx} style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr 1fr 1.2fr auto', gap: '0.5rem', marginBottom: '0.5rem', alignItems: 'center' }}>
                    <select
                      className="select-field"
                      value={m.method}
                      onChange={e => updateMethodField(idx, 'method', e.target.value)}
                    >
                      <option value="CASH_USD">Efectivo USD</option>
                      <option value="CASH_LOCAL">Efectivo Moneda Local</option>
                      <option value="TRANSFER">Transferencia Bancaria</option>
                      <option value="CARD">Punto de Venta / Tarjeta</option>
                      <option value="ZELLE">Zelle</option>
                      <option value="MOBILE_PAY">Pago Móvil</option>
                    </select>

                    <select
                      className="select-field"
                      value={m.currency}
                      onChange={e => updateMethodField(idx, 'currency', e.target.value)}
                    >
                      <option value="USD">USD ($)</option>
                      <option value="VES">VES (Bs.)</option>
                    </select>

                    <input
                      type="number"
                      step="0.01"
                      className="input-field"
                      placeholder="Monto"
                      value={m.amount || ''}
                      onChange={e => updateMethodField(idx, 'amount', parseFloat(e.target.value) || 0)}
                    />

                    <input
                      type="text"
                      className="input-field"
                      placeholder="Nro Ref / Lote"
                      value={m.reference}
                      onChange={e => updateMethodField(idx, 'reference', e.target.value)}
                    />

                    {paymentMethods.length > 1 && (
                      <button type="button" className="btn btn-danger btn-sm" onClick={() => removePaymentMethod(idx)}>
                        <Trash2 size={14} />
                      </button>
                    )}
                  </div>
                ))}
              </div>

              {/* Botón Finalizar Cobro */}
              <button
                type="button"
                onClick={handleProcessPayment}
                className="btn btn-accent btn-lg"
                style={{ width: '100%' }}
                disabled={submitting || totalToPayUSD === 0}
              >
                {submitting ? 'Procesando Pago y Generando Recibo...' : `Confirmar y Emitir Recibo ($${totalToPayUSD.toFixed(2)} USD)`}
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Modal del Recibo Emitido */}
      {createdPaymentId && (
        <ReceiptModal
          paymentId={createdPaymentId}
          onClose={() => setCreatedPaymentId(null)}
        />
      )}
    </div>
  );
};
