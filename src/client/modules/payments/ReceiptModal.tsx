import React, { useEffect, useState } from 'react';
import { Printer, CheckCircle, AlertTriangle, X } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';

interface ReceiptModalProps {
  paymentId: string;
  onClose: () => void;
}

export const ReceiptModal: React.FC<ReceiptModalProps> = ({ paymentId, onClose }) => {
  const { token } = useAuth();
  const [receipt, setReceipt] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`/api/payments/receipts/${paymentId}`, {
      headers: { Authorization: `Bearer ${token}` }
    })
      .then(res => res.json())
      .then(data => {
        setReceipt(data);
        setLoading(false);
      })
      .catch(e => {
        console.error(e);
        setLoading(false);
      });
  }, [paymentId, token]);

  if (loading) {
    return (
      <div className="modal-overlay">
        <div className="modal-content" style={{ textAlign: 'center', padding: '3rem' }}>
          <div className="spin" style={{ fontSize: '2rem' }}>🌀</div>
          <p style={{ marginTop: '1rem', color: '#9ca3af' }}>Cargando comprobante de pago...</p>
        </div>
      </div>
    );
  }

  if (!receipt) return null;

  const isVoided = receipt.status === 'VOIDED';
  const firstItem = receipt.paymentItems[0]?.debt;
  const student = firstItem?.student;
  const guardian = student?.guardians[0]?.guardian;

  const [emailMsg, setEmailMsg] = useState<string | null>(null);

  const handleSendEmail = async () => {
    try {
      const res = await fetch(`/api/payments/receipts/${paymentId}/send-email`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await res.json();
      if (data.success) {
        setEmailMsg(`Comprobante digital enviado al correo: ${data.email}`);
      }
    } catch (e) {
      console.error(e);
    }
  };

  const handlePrintAndEmail = () => {
    handleSendEmail();
    window.print();
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" style={{ maxWidth: '700px' }} onClick={e => e.stopPropagation()}>
        
        {/* Header de Acciones */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
          <h3 style={{ color: '#f3f4f6', fontSize: '1.25rem' }}>Comprobante Oficial de Pago</h3>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button className="btn btn-accent btn-sm" onClick={handlePrintAndEmail}>
              <Printer size={16} /> Imprimir & Enviar al Correo
            </button>
            <button className="btn btn-secondary btn-sm" onClick={onClose}>
              <X size={18} />
            </button>
          </div>
        </div>

        {emailMsg && (
          <div style={{ padding: '0.75rem 1rem', background: 'rgba(16, 185, 129, 0.15)', border: '1px solid rgba(16, 185, 129, 0.3)', borderRadius: '8px', color: '#34d399', fontSize: '0.85rem', fontWeight: 600, marginBottom: '1rem' }}>
            <CheckCircle size={16} style={{ display: 'inline', marginRight: '0.35rem' }} /> {emailMsg}
          </div>
        )}

        {/* Tarjeta de Recibo Estilo Recibo Digital/Impreso */}
        <div className="receipt-printable" style={{ position: 'relative', border: isVoided ? '3px red dashed' : '1px #e5e7eb solid' }}>
          
          {isVoided && (
            <div style={{
              position: 'absolute',
              top: '40%',
              left: '50%',
              transform: 'translate(-50%, -50%) rotate(-20deg)',
              border: '5px solid #ef4444',
              color: '#ef4444',
              fontSize: '3rem',
              fontWeight: 900,
              padding: '0.5rem 2rem',
              borderRadius: '12px',
              textTransform: 'uppercase',
              opacity: 0.85,
              pointerEvents: 'none'
            }}>
              ANULADO
            </div>
          )}

          <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '2px solid #111827', paddingBottom: '1rem', marginBottom: '1rem' }}>
            <div>
              <h2 style={{ fontSize: '1.2rem', fontWeight: 800, margin: 0 }}>UNIDAD EDUCATIVA CDNJ</h2>
              <p style={{ fontSize: '0.8rem', margin: '2px 0' }}>RIF: J-30492019-2 | Tel: (0212) 555-0199</p>
              <p style={{ fontSize: '0.8rem', margin: 0 }}>Av. Principal de Los Palos Grandes, Caracas</p>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: '1.1rem', fontWeight: 800, color: '#4f46e5' }}>{receipt.receiptNumber}</div>
              <p style={{ fontSize: '0.75rem', margin: '4px 0' }}>Fecha: {new Date(receipt.createdAt).toLocaleString()}</p>
              <p style={{ fontSize: '0.75rem', margin: 0 }}>Atendido por: {receipt.processedBy?.fullName}</p>
            </div>
          </div>

          {/* Información del Estudiante y Representante */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', background: '#f9fafb', padding: '0.75rem', borderRadius: '6px', fontSize: '0.85rem', marginBottom: '1rem' }}>
            <div>
              <strong>Estudiante:</strong> {student ? `${student.firstName} ${student.lastName}` : 'N/A'}<br />
              <strong>Grado/Curso:</strong> {student?.grade || 'N/A'}<br />
              <strong>Código Estudiantil:</strong> {student?.studentCode || 'N/A'}
            </div>
            <div>
              <strong>Representante:</strong> {guardian?.fullName || 'N/A'}<br />
              <strong>Cédula / DNI:</strong> {guardian?.docId || 'N/A'}<br />
              <strong>Teléfono:</strong> {guardian?.phone || 'N/A'}
            </div>
          </div>

          {/* Tabla de Detalle de Conceptos Pagados */}
          <table style={{ width: '100%', fontSize: '0.85rem', borderCollapse: 'collapse', marginBottom: '1rem' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid #111827', textAlign: 'left' }}>
                <th style={{ padding: '0.4rem 0' }}>Concepto de Cobro</th>
                <th style={{ textAlign: 'right', padding: '0.4rem 0' }}>Monto (USD)</th>
              </tr>
            </thead>
            <tbody>
              {receipt.paymentItems.map((item: any) => (
                <tr key={item.id} style={{ borderBottom: '1px #e5e7eb solid' }}>
                  <td style={{ padding: '0.5rem 0' }}>{item.debt?.feeConcept?.name}</td>
                  <td style={{ textAlign: 'right', padding: '0.5rem 0' }}>${item.amountPaidUSD.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>

          {/* Totales y Tasa */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: '2px solid #111827', paddingTop: '0.75rem', marginTop: '1rem' }}>
            <div>
              <span style={{ fontSize: '0.75rem' }}>Tasa de Cambio Ref: <strong>{receipt.exchangeRate.toFixed(2)} VES/USD</strong></span>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: '1.25rem', fontWeight: 800 }}>Total: ${receipt.totalUSD.toFixed(2)} USD</div>
              <div style={{ fontSize: '0.9rem', color: '#4b5563' }}>Equivalente: {receipt.totalLocal.toLocaleString('es-VE', { minimumFractionDigits: 2 })} VES</div>
            </div>
          </div>

          {/* Formas de Pago Desglosadas */}
          <div style={{ marginTop: '1rem', background: '#f3f4f6', padding: '0.75rem', borderRadius: '6px', fontSize: '0.75rem' }}>
            <strong>Métodos de Pago Utilizados:</strong>
            <ul style={{ margin: '0.25rem 0 0 1rem', padding: 0 }}>
              {receipt.methods.map((m: any) => (
                <li key={m.id}>
                  {m.method} - {m.currency === 'USD' ? `$${m.amount.toFixed(2)} USD` : `${m.amount.toFixed(2)} VES`}
                  {m.reference ? ` (Ref: ${m.reference})` : ''}
                </li>
              ))}
            </ul>
          </div>

          {isVoided && (
            <div style={{ marginTop: '1rem', background: '#fee2e2', color: '#991b1b', padding: '0.75rem', borderRadius: '6px', fontSize: '0.8rem' }}>
              <strong>Motivo de Anulación:</strong> {receipt.voidReason}<br />
              <strong>Anulado por:</strong> {receipt.voidedBy?.fullName} el {new Date(receipt.voidedAt).toLocaleString()}
            </div>
          )}

        </div>

      </div>
    </div>
  );
};
