import { Navigate } from 'react-router-dom';
import PropTypes from 'prop-types';
import { useUser } from '../context/UserContext';

export default function AdminRoute({ children }) {
  const { currentUser } = useUser();
  if (!currentUser) return <Navigate to="/" replace />;
  if (currentUser.role !== 'ADMIN') return <Navigate to="/forbidden" replace />;
  return children;
}
AdminRoute.propTypes = { children: PropTypes.node };
