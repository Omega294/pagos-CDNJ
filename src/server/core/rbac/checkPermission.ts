import { Request, Response, NextFunction } from 'express';
import { verifyToken, TokenPayload } from '../auth/jwt';

export interface AuthenticatedRequest extends Request {
  user?: TokenPayload;
}

export function authenticate(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'No autorizado', message: 'Token no proporcionado.' });
  }

  const token = authHeader.split(' ')[1];
  try {
    const payload = verifyToken(token);
    req.user = payload;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'No autorizado', message: 'Token inválido o expirado.' });
  }
}

export function requirePermission(permissionCode: string) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({ error: 'No autorizado', message: 'Usuario no autenticado.' });
    }

    const { roles, permissions } = req.user;

    const isSuperadmin = roles.includes('SUPERADMIN') || permissions.includes('*');
    const hasPermission = isSuperadmin || permissions.includes(permissionCode);

    if (!hasPermission) {
      return res.status(403).json({
        error: 'Acceso Denegado',
        message: `No posee el permiso requerido [${permissionCode}] para ejecutar esta acción.`,
        requiredPermission: permissionCode
      });
    }

    next();
  };
}
