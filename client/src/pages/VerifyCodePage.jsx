import { Navigate } from 'react-router-dom';

// Retired signup step. Keep existing route links safe without collecting a phone.
export default function VerifyCodePage() {
  return <Navigate to="/register" replace />;
}
