import { Router, Response } from 'express';
import { prisma } from '../../config/prisma';
import { comparePassword, generateToken } from '../../core/auth/jwt';
import { authenticate, AuthenticatedRequest } from '../../core/rbac/checkPermission';

export const authRouter = Router();

// POST /api/auth/login
authRouter.post('/login', async (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: 'Datos incompletos', message: 'Se requiere usuario y contraseña.' });
  }

  const user = await prisma.user.findUnique({
    where: { username },
    include: {
      userRoles: {
        include: {
          role: {
            include: {
              rolePermissions: {
                include: { permission: true }
              }
            }
          }
        }
      }
    }
  });

  if (!user || !user.isActive) {
    return res.status(401).json({ error: 'Credenciales inválidas', message: 'Usuario o contraseña incorrectos.' });
  }

  const validPassword = await comparePassword(password, user.passwordHash);
  if (!validPassword) {
    return res.status(401).json({ error: 'Credenciales inválidas', message: 'Usuario o contraseña incorrectos.' });
  }

  // Extraer roles y lista única de códigos de permiso
  const roles = user.userRoles.map((ur) => ur.role.name);
  const permissionsSet = new Set<string>();

  for (const userRole of user.userRoles) {
    if (userRole.role.name === 'SUPERADMIN') {
      permissionsSet.add('*');
    }
    for (const rp of userRole.role.rolePermissions) {
      permissionsSet.add(rp.permission.code);
    }
  }

  const permissions = Array.from(permissionsSet);

  const token = generateToken({
    userId: user.id,
    username: user.username,
    roles,
    permissions
  });

  return res.json({
    token,
    user: {
      id: user.id,
      username: user.username,
      email: user.email,
      fullName: user.fullName,
      roles,
      permissions
    }
  });
});

// GET /api/auth/me
authRouter.get('/me', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  if (!req.user) return res.status(401).json({ message: 'No autenticado' });

  const user = await prisma.user.findUnique({
    where: { id: req.user.userId },
    select: { id: true, username: true, email: true, fullName: true }
  });

  return res.json({
    user: {
      ...user,
      roles: req.user.roles,
      permissions: req.user.permissions
    }
  });
});
