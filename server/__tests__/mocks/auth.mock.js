export const requireAuth = (req, _res, next) => {
  const headerId = req.headers['x-test-user-id'];
  const id = headerId ? Number(headerId) : 1;

  req.user = req.user || {
    id,
    role: req.headers['x-test-role'] || 'USER',
    plan: req.headers['x-test-plan'] || 'FREE',
  };

  next();
};

export const verifyTokenOptional = (req, _res, next) => {
  if (!req.user && req.headers['x-test-user-id']) {
    req.user = {
      id: Number(req.headers['x-test-user-id']),
      role: req.headers['x-test-role'] || 'USER',
      plan: req.headers['x-test-plan'] || 'FREE',
    };
  }

  next();
};

export const requireAdmin = (req, res, next) => {
  if (!req.user) {
    req.user = {
      id: 1,
      role: req.headers['x-test-role'] || 'ADMIN',
      plan: req.headers['x-test-plan'] || 'FREE',
    };
  }

  if (req.user.role !== 'ADMIN') {
    return res.status(403).json({ error: 'Admin access required' });
  }

  next();
};

export default requireAuth;