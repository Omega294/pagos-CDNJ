import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Iniciando sembrado de datos en la base de datos CDNJ...');

  // 1. Limpiar datos existentes
  await prisma.cashClosing.deleteMany();
  await prisma.paymentMethodDetail.deleteMany();
  await prisma.paymentDetail.deleteMany();
  await prisma.payment.deleteMany();
  await prisma.studentDebt.deleteMany();
  await prisma.feeConcept.deleteMany();
  await prisma.studentGuardian.deleteMany();
  await prisma.student.deleteMany();
  await prisma.guardian.deleteMany();
  await prisma.rolePermission.deleteMany();
  await prisma.userRole.deleteMany();
  await prisma.permission.deleteMany();
  await prisma.role.deleteMany();
  await prisma.user.deleteMany();

  // 2. Permisos Granulares del Sistema
  const permissionsList = [
    // Módulo de Cobros - Cajera
    { code: 'payments:cashier:search', module: 'payments', resource: 'cashier', action: 'search', description: 'Buscar estudiantes y representantes' },
    { code: 'payments:cashier:create_payment', module: 'payments', resource: 'cashier', action: 'create', description: 'Registrar pagos multimoneda y multimétodo' },
    { code: 'payments:cashier:view_receipt', module: 'payments', resource: 'cashier', action: 'view_receipt', description: 'Ver y emitir comprobantes de pago' },

    // Módulo de Cobros - Admin & Cierre
    { code: 'payments:admin:view_history', module: 'payments', resource: 'admin', action: 'view_history', description: 'Ver historial completo de transacciones' },
    { code: 'payments:admin:void_receipt', module: 'payments', resource: 'admin', action: 'void', description: 'Anular recibos de pago emitidos' },
    { code: 'payments:admin:close_box', module: 'payments', resource: 'admin', action: 'close_box', description: 'Generar reporte y cierre de caja diario' },
    { code: 'payments:config:manage_rates', module: 'payments', resource: 'config', action: 'manage', description: 'Configurar conceptos de cobro y aranceles' },

    // Core
    { code: 'core:users:manage', module: 'core', resource: 'users', action: 'manage', description: 'Gestionar usuarios y roles' },
  ];

  const dbPermissions = [];
  for (const perm of permissionsList) {
    const created = await prisma.permission.create({ data: perm });
    dbPermissions.push(created);
  }

  // 3. Crear Roles
  const roleSuperadmin = await prisma.role.create({
    data: { name: 'SUPERADMIN', description: 'Superadministrador del Sistema', isSystem: true }
  });

  const roleAdmin = await prisma.role.create({
    data: { name: 'ADMINISTRADOR', description: 'Administrador de Colegio / Finanzas', isSystem: true }
  });

  const roleCajera = await prisma.role.create({
    data: { name: 'CAJERA', description: 'Operador de Caja y Cobranza', isSystem: true }
  });

  // 4. Asignar Permisos a Roles
  // Superadmin -> Todos los permisos
  for (const perm of dbPermissions) {
    await prisma.rolePermission.create({
      data: { roleId: roleSuperadmin.id, permissionId: perm.id }
    });
  }

  // Administrador -> Todos los permisos de pagos y config
  const adminPerms = dbPermissions.filter(p => p.module === 'payments');
  for (const perm of adminPerms) {
    await prisma.rolePermission.create({
      data: { roleId: roleAdmin.id, permissionId: perm.id }
    });
  }

  // Cajera -> Solo funciones de caja (búsqueda, cobro, ver recibo)
  const cajeraPerms = dbPermissions.filter(p => p.resource === 'cashier');
  for (const perm of cajeraPerms) {
    await prisma.rolePermission.create({
      data: { roleId: roleCajera.id, permissionId: perm.id }
    });
  }

  // 5. Crear Usuarios Demo
  const passHash = await bcrypt.hash('123456', 10);

  const userSuperadmin = await prisma.user.create({
    data: {
      username: 'superadmin',
      email: 'superadmin@cdjn.edu',
      fullName: 'Super Administrador Global',
      passwordHash: passHash,
      userRoles: { create: { roleId: roleSuperadmin.id } }
    }
  });

  const userAdmin = await prisma.user.create({
    data: {
      username: 'admin',
      email: 'admin@cdjn.edu',
      fullName: 'Lic. Ana Martínez (Directora/Admin)',
      passwordHash: passHash,
      userRoles: { create: { roleId: roleAdmin.id } }
    }
  });

  const userCajera = await prisma.user.create({
    data: {
      username: 'cajera',
      email: 'cajera@cdjn.edu',
      fullName: 'María González (Cajera Principal)',
      passwordHash: passHash,
      userRoles: { create: { roleId: roleCajera.id } }
    }
  });

  // 6. Representantes y Estudiantes
  const g1 = await prisma.guardian.create({
    data: { docId: 'V-15420198', fullName: 'Carlos Alberto Mendoza', email: 'cmendoza@gmail.com', phone: '+58 414-5550192', address: 'Av. Las Palmas, Res. El Parral, Apt 4B' }
  });

  const g2 = await prisma.guardian.create({
    data: { docId: 'V-18910455', fullName: 'Mariana Isabel Rivas', email: 'mrivas@hotmail.com', phone: '+58 424-3338901', address: 'Urb. Los Mangos, Calle 3, Casa #12' }
  });

  const g3 = await prisma.guardian.create({
    data: { docId: 'V-12330981', fullName: 'José Luis Paredes', email: 'jlparedes@yahoo.es', phone: '+58 412-9994411', address: 'Sector Centro, Calle 5 de Julio #45' }
  });

  const s1 = await prisma.student.create({
    data: { studentCode: 'EST-2026-001', docId: 'V-32400111', firstName: 'Sofía Valentina', lastName: 'Mendoza Rivas', grade: '5to Grado A', status: 'ACTIVE' }
  });

  const s2 = await prisma.student.create({
    data: { studentCode: 'EST-2026-002', docId: 'V-31998222', firstName: 'Mateo Alejandro', lastName: 'Mendoza Rivas', grade: '1er Año B', status: 'ACTIVE' }
  });

  const s3 = await prisma.student.create({
    data: { studentCode: 'EST-2026-003', docId: 'V-33100555', firstName: 'Valentina Lucía', lastName: 'Paredes Rivas', grade: '3er Grado C', status: 'ACTIVE' }
  });

  // Enlazar tutores y estudiantes
  await prisma.studentGuardian.create({ data: { studentId: s1.id, guardianId: g1.id, relationship: 'Padre', isPrimary: true } });
  await prisma.studentGuardian.create({ data: { studentId: s2.id, guardianId: g1.id, relationship: 'Padre', isPrimary: true } });
  await prisma.studentGuardian.create({ data: { studentId: s3.id, guardianId: g3.id, relationship: 'Padre', isPrimary: true } });

  // 7. Conceptos de Cobro
  const c1 = await prisma.feeConcept.create({ data: { code: 'MEN-SEP-26', name: 'Mensualidad Septiembre 2026', amountUSD: 50.0, isRecurring: true } });
  const c2 = await prisma.feeConcept.create({ data: { code: 'MEN-OCT-26', name: 'Mensualidad Octubre 2026', amountUSD: 50.0, isRecurring: true } });
  const c3 = await prisma.feeConcept.create({ data: { code: 'MAT-2026', name: 'Matrícula Escolar 2026-2027', amountUSD: 120.0, isRecurring: false } });
  const c4 = await prisma.feeConcept.create({ data: { code: 'REC-MORA', name: 'Recargo por Mora en Pago', amountUSD: 10.0, isRecurring: false } });

  // 8. Crear Deudas Pendientes
  await prisma.studentDebt.create({
    data: { studentId: s1.id, feeConceptId: c3.id, amountUSD: 120.0, dueDate: new Date('2026-09-15'), status: 'PENDING' }
  });
  await prisma.studentDebt.create({
    data: { studentId: s1.id, feeConceptId: c1.id, amountUSD: 50.0, dueDate: new Date('2026-09-30'), status: 'PENDING' }
  });

  await prisma.studentDebt.create({
    data: { studentId: s2.id, feeConceptId: c3.id, amountUSD: 120.0, dueDate: new Date('2026-09-15'), status: 'PENDING' }
  });
  await prisma.studentDebt.create({
    data: { studentId: s2.id, feeConceptId: c1.id, amountUSD: 50.0, dueDate: new Date('2026-09-30'), status: 'PENDING' }
  });
  await prisma.studentDebt.create({
    data: { studentId: s2.id, feeConceptId: c4.id, amountUSD: 10.0, dueDate: new Date('2026-09-01'), status: 'PENDING' }
  });

  await prisma.studentDebt.create({
    data: { studentId: s3.id, feeConceptId: c1.id, amountUSD: 50.0, dueDate: new Date('2026-09-30'), status: 'PENDING' }
  });

  console.log('✅ Base de datos sembrada con éxito.');
  console.log('👤 Usuarios Creados (Clave para todos: 123456):');
  console.log('   - superadmin (Roles: SUPERADMIN)');
  console.log('   - admin      (Roles: ADMINISTRADOR)');
  console.log('   - cajera     (Roles: CAJERA)');
}

main()
  .catch((e) => {
    console.error('❌ Error sembrando base de datos:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
