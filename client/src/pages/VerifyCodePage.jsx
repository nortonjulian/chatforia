import React, { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import axiosClient from '@/api/axiosClient';

export default function VerifyCodePage() {
  const location = useLocation();
  const navigate = useNavigate();
  const pending = location.state?.pendingRegistration;
  const verificationRequestId = location.state?.verificationRequestId;

  if (!pending || !verificationRequestId) {
    navigate('/register'); // invalid flow
    return null;
  }

  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function handleVerify(e) {
    e?.preventDefault?.();
    setError('');
    setLoading(true);

    try {
      // Verify the OTP for the verificationRequestId
      const verifyRes = await axiosClient.post('/auth/verify-phone-code', {
        verificationRequestId,
        code
      });

      // On success, the server should mark the phone verified and return something like phoneVerificationId (short-lived)
      const phoneVerificationId = verifyRes.data?.phoneVerificationId;
      if (!phoneVerificationId) {
        // if the server instead simply returns success, you can proceed with registration
      }

      // Now finalize registration by sending the user creation call including phoneVerificationId
      const payload = {
        username: pending.username.trim(),
        email: pending.email.trim(),
        password: pending.password,
        phone: pending.phone,
        phoneVerificationId, // used by backend to tie phone/consent to this account
      };

      await axiosClient.post('/auth/register', payload);

      // registration complete: redirect to onboarding/login
      navigate('/welcome'); // whatever your post-registration route is
    } catch (err) {
      console.error(err);
      setError('Invalid code or expired. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleVerify}>
      {/* Replace with your UI components */}
      <div>
        <label>Enter verification code sent to {pending.phone}</label>
        <input value={code} onChange={(e) => setCode(e.target.value)} />
        <button type="submit" disabled={loading}>Verify</button>
        {error && <div style={{ color: 'red' }}>{error}</div>}
      </div>
    </form>
  );
}
