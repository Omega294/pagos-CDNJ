import express from 'express';
import cors from 'cors';
import path from 'path';
import { authRouter } from './modules/auth/auth.router';
import { paymentsRouter } from './modules/payments/payments.router';

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// Rutas de la API Modular
app.use('/api/auth', authRouter);
app.use('/api/payments', paymentsRouter);

// Endpoint de estado del servidor
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', system: 'CDNJ School Management Platform', timestamp: new Date() });
});

// Servir frontend en producción si existe dist/client
const clientDistPath = path.join(__dirname, '../../dist');
app.use(express.static(clientDistPath));

app.listen(PORT, () => {
  console.log(`🚀 Servidor CDNJ Backend corriendo en http://localhost:${PORT}`);
  console.log(`🔑 Endpoints de Auth: http://localhost:${PORT}/api/auth`);
  console.log(`💳 Endpoints de Cobros: http://localhost:${PORT}/api/payments`);
});
