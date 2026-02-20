import { useLocation, useNavigate } from "react-router-dom";
import VerifyPhoneConsent from "../components/VerifyPhoneConsent";

export default function VerifyPhoneConsentPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const phoneNumber = location.state?.phoneNumber || "";

  if (!phoneNumber) {
    // If someone navigates directly here without a phone, send them back to register
    navigate("/register");
    return null;
  }

  async function sendOtp(phone) {
    try {
      const res = await fetch("/auth/request-phone-verification", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phoneNumber: phone })
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.error || "Failed to request verification");
      }

      // On success, navigate to the OTP entry page and pass phoneNumber
      navigate("/verify-code", { state: { phoneNumber: phone } });
    } catch (e) {
      console.error("sendOtp error:", e);
      // show user-friendly error UI in production — for now alert
      alert("Unable to send verification code. Please try again.");
    }
  }

  return (
    <VerifyPhoneConsent
      phoneNumber={phoneNumber}
      onContinue={() => sendOtp(phoneNumber)}
      onCancel={() => navigate(-1)}
    />
  );
}
