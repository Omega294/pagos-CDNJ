import { Router, Response } from 'express';
import { prisma } from '../../config/prisma';
import { authenticate, requirePermission, AuthenticatedRequest } from '../../core/rbac/checkPermission';

export const paymentsRouter = Router();

// Aplicar middleware de autenticación a todas las rutas de cobros
paymentsRouter.use(authenticate);

// Tasa de cambio de referencia global (ej. 1 USD = 36.50 VES)
let currentExchangeRate = 36.50;

// ==========================================
// 1. VISTA DE CAJERA: BÚSQUEDA Y REGISTRO
// ==========================================

// GET /api/payments/students/search?q=...
paymentsRouter.get(
  '/students/search',
  requirePermission('payments:cashier:search'),
  async (req: AuthenticatedRequest, res: Response) => {
    const query = (req.query.q as string || '').trim();

    if (!query) {
      return res.json([]);
    }

    const students = await prisma.student.findMany({
      where: {
        OR: [
          { firstName: { contains: query } },
          { lastName: { contains: query } },
          { studentCode: { contains: query } },
          { docId: { contains: query } },
          {
            guardians: {
              some: {
                guardian: {
                  OR: [
                    { fullName: { contains: query } },
                    { docId: { contains: query } }
                  ]
                }
              }
            }
          }
        ]
      },
      include: {
        guardians: {
          include: { guardian: true }
        },
        debts: {
          where: { status: 'PENDING' },
          include: { feeConcept: true }
        }
      },
      take: 15
    });

    return res.json(students);
  }
);

// GET /api/payments/students/:id/debts
paymentsRouter.get(
  '/students/:id/debts',
  requirePermission('payments:cashier:search'),
  async (req: AuthenticatedRequest, res: Response) => {
    const { id } = req.params;

    const debts = await prisma.studentDebt.findMany({
      where: { studentId: id, status: 'PENDING' },
      include: { feeConcept: true }
    });

    return res.json({ debts, exchangeRate: currentExchangeRate });
  }
);

// POST /api/payments/transactions (Registrar cobro multimoneda / multimétodo)
paymentsRouter.post(
  '/transactions',
  requirePermission('payments:cashier:create_payment'),
  async (req: AuthenticatedRequest, res: Response) => {
    const { studentId, selectedDebtIds, methods, exchangeRate } = req.body;

    if (!studentId || !selectedDebtIds || !Array.isArray(selectedDebtIds) || selectedDebtIds.length === 0) {
      return res.status(400).json({ error: 'Validación fallida', message: 'Debe seleccionar al menos una deuda pendiente.' });
    }

    if (!methods || !Array.isArray(methods) || methods.length === 0) {
      return res.status(400).json({ error: 'Validación fallida', message: 'Debe indicar al menos un método de pago.' });
    }

    const rate = exchangeRate || currentExchangeRate;

    // Buscar deudas
    const debts = await prisma.studentDebt.findMany({
      where: { id: { in: selectedDebtIds }, status: 'PENDING' }
    });

    if (debts.length === 0) {
      return res.status(400).json({ error: 'Error', message: 'Las deudas seleccionadas no existen o ya fueron pagadas.' });
    }

    const totalUSD = debts.reduce((sum, d) => sum + d.amountUSD, 0);
    const totalLocal = totalUSD * rate;

    // Generar correlativo de recibo
    const count = await prisma.payment.count();
    const receiptNumber = `REC-${new Date().getFullYear()}-${String(count + 1).padStart(5, '0')}`;

    // Crear transacción en base de datos
    const payment = await prisma.payment.create({
      data: {
        receiptNumber,
        userId: req.user!.userId,
        totalUSD,
        exchangeRate: rate,
        totalLocal,
        status: 'COMPLETED',
        paymentItems: {
          create: debts.map((d) => ({
            debtId: d.id,
            amountPaidUSD: d.amountUSD
          }))
        },
        methods: {
          create: methods.map((m: any) => ({
            method: m.method,
            amount: Number(m.amount),
            currency: m.currency,
            reference: m.reference || null
          }))
        }
      },
      include: {
        paymentItems: { include: { debt: { include: { feeConcept: true } } } },
        methods: true,
        processedBy: { select: { fullName: true, username: true } }
      }
    });

    // Actualizar estado de las deudas a PAID
    await prisma.studentDebt.updateMany({
      where: { id: { in: selectedDebtIds } },
      data: { status: 'PAID' }
    });

    return res.status(201).json(payment);
  }
);

// GET /api/payments/receipts/:id
paymentsRouter.get(
  '/receipts/:id',
  requirePermission('payments:cashier:view_receipt'),
  async (req: AuthenticatedRequest, res: Response) => {
    const { id } = req.params;

    const payment = await prisma.payment.findUnique({
      where: { id },
      include: {
        processedBy: { select: { fullName: true } },
        voidedBy: { select: { fullName: true } },
        methods: true,
        paymentItems: {
          include: {
            debt: {
              include: {
                feeConcept: true,
                student: {
                  include: {
                    guardians: { include: { guardian: true } }
                  }
                }
              }
            }
          }
        }
      }
    });

    if (!payment) {
      return res.status(404).json({ error: 'No encontrado', message: 'El recibo no existe.' });
    }

    return res.json(payment);
  }
);

// ==========================================
// 2. VISTA DE ADMINISTRADOR: HISTORIAL Y ANULACIÓN
// ==========================================

// GET /api/payments/transactions (Historial general)
paymentsRouter.get(
  '/transactions',
  requirePermission('payments:admin:view_history'),
  async (req: AuthenticatedRequest, res: Response) => {
    const transactions = await prisma.payment.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        processedBy: { select: { fullName: true, username: true } },
        voidedBy: { select: { fullName: true } },
        methods: true,
        paymentItems: {
          include: {
            debt: {
              include: {
                feeConcept: true,
                student: { select: { firstName: true, lastName: true, studentCode: true, grade: true } }
              }
            }
          }
        }
      }
    });

    return res.json({ transactions, exchangeRate: currentExchangeRate });
  }
);

// POST /api/payments/transactions/:id/void (Anulación de recibo)
paymentsRouter.post(
  '/transactions/:id/void',
  requirePermission('payments:admin:void_receipt'),
  async (req: AuthenticatedRequest, res: Response) => {
    const { id } = req.params;
    const { reason } = req.body;

    if (!reason || reason.trim().length < 5) {
      return res.status(400).json({ error: 'Validación fallida', message: 'Debe especificar un motivo detallado de anulación (mínimo 5 caracteres).' });
    }

    const payment = await prisma.payment.findUnique({
      where: { id },
      include: { paymentItems: true }
    });

    if (!payment) {
      return res.status(404).json({ error: 'No encontrado', message: 'El recibo no existe.' });
    }

    if (payment.status === 'VOIDED') {
      return res.status(400).json({ error: 'Error', message: 'Este recibo ya fue anulado previamente.' });
    }

    // Anular el pago
    const voidedPayment = await prisma.payment.update({
      where: { id },
      data: {
        status: 'VOIDED',
        voidReason: reason,
        voidedById: req.user!.userId,
        voidedAt: new Date()
      }
    });

    // Reinstaurar el estado PENDING de las deudas afectadas
    const debtIds = payment.paymentItems.map((pi) => pi.debtId);
    await prisma.studentDebt.updateMany({
      where: { id: { in: debtIds } },
      data: { status: 'PENDING' }
    });

    return res.json({ message: 'Recibo anulado exitosamente y deudas restablecidas.', payment: voidedPayment });
  }
);

// ==========================================
// 3. CONFIGURACIÓN Y CIERRE DE CAJA
// ==========================================

// GET /api/payments/rates (Ver/Actualizar tasa de cambio y conceptos)
paymentsRouter.get(
  '/rates',
  requirePermission('payments:config:manage_rates'),
  async (req: AuthenticatedRequest, res: Response) => {
    const concepts = await prisma.feeConcept.findMany({ orderBy: { name: 'asc' } });
    return res.json({ exchangeRate: currentExchangeRate, concepts });
  }
);

paymentsRouter.post(
  '/rates',
  requirePermission('payments:config:manage_rates'),
  async (req: AuthenticatedRequest, res: Response) => {
    const { exchangeRate } = req.body;
    if (exchangeRate && !isNaN(Number(exchangeRate))) {
      currentExchangeRate = Number(exchangeRate);
    }
    return res.json({ message: 'Tasa de cambio actualizada con éxito.', exchangeRate: currentExchangeRate });
  }
);

// GET /api/payments/cash-closing/summary (Resumen de caja actual)
paymentsRouter.get(
  '/cash-closing/summary',
  requirePermission('payments:admin:close_box'),
  async (req: AuthenticatedRequest, res: Response) => {
    // Pagos completados hoy que no han sido anulados
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const payments = await prisma.payment.findMany({
      where: {
        status: 'COMPLETED',
        createdAt: { gte: today }
      },
      include: { methods: true }
    });

    let totalCashUSD = 0;
    let totalCashLocal = 0;
    let totalDigitalUSD = 0;
    let totalDigitalLocal = 0;

    for (const p of payments) {
      for (const m of p.methods) {
        if (m.method === 'CASH_USD') {
          totalCashUSD += m.amount;
        } else if (m.method === 'CASH_LOCAL') {
          totalCashLocal += m.amount;
        } else if (m.currency === 'USD') {
          totalDigitalUSD += m.amount;
        } else {
          totalDigitalLocal += m.amount;
        }
      }
    }

    const grandTotalUSD = totalCashUSD + (totalCashLocal / currentExchangeRate) + totalDigitalUSD + (totalDigitalLocal / currentExchangeRate);

    return res.json({
      transactionCount: payments.length,
      totalCashUSD,
      totalCashLocal,
      totalDigitalUSD,
      totalDigitalLocal,
      grandTotalUSD,
      exchangeRate: currentExchangeRate
    });
  }
);

// POST /api/payments/cash-closing (Generar Cierre de Caja)
paymentsRouter.post(
  '/cash-closing',
  requirePermission('payments:admin:close_box'),
  async (req: AuthenticatedRequest, res: Response) => {
    const { notes } = req.body;

    const count = await prisma.cashClosing.count();
    const dateStr = new Date().toISOString().split('T')[0];
    const closingNumber = `CLS-${dateStr}-${String(count + 1).padStart(3, '0')}`;

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const payments = await prisma.payment.findMany({
      where: {
        status: 'COMPLETED',
        createdAt: { gte: today }
      },
      include: { methods: true }
    });

    let totalCashUSD = 0;
    let totalCashLocal = 0;
    let totalDigitalUSD = 0;
    let totalDigitalLocal = 0;

    for (const p of payments) {
      for (const m of p.methods) {
        if (m.method === 'CASH_USD') totalCashUSD += m.amount;
        else if (m.method === 'CASH_LOCAL') totalCashLocal += m.amount;
        else if (m.currency === 'USD') totalDigitalUSD += m.amount;
        else totalDigitalLocal += m.amount;
      }
    }

    const grandTotalUSD = totalCashUSD + (totalCashLocal / currentExchangeRate) + totalDigitalUSD + (totalDigitalLocal / currentExchangeRate);

    const closing = await prisma.cashClosing.create({
      data: {
        closingNumber,
        userId: req.user!.userId,
        openedAt: today,
        closedAt: new Date(),
        totalCashUSD,
        totalCashLocal,
        totalDigitalUSD,
        totalDigitalLocal,
        grandTotalUSD,
        notes: notes || 'Cierre de caja sin observaciones'
      },
      include: { closedBy: { select: { fullName: true } } }
    });

    return res.status(201).json(closing);
  }
);
