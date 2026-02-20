import { useState } from "react";

export default function VerifyPhoneConsent({ phoneNumber, onContinue, onCancel }) {
  const [agreed, setAgreed] = useState(false);

  return (
    <div className="min-h-screen flex items-center justify-center bg-neutral-100 p-6">
      <div className="max-w-md w-full bg-white rounded-2xl shadow-lg p-8 space-y-6">
        <div className="text-center">
          <h1 className="text-2xl font-semibold">Verify your phone number</h1>
          <p className="text-sm text-neutral-600 mt-2">
            We will send a verification code to
          </p>
          <p className="font-medium mt-1">{phoneNumber}</p>
        </div>

        <div className="bg-neutral-50 border rounded-xl p-4 text-sm text-neutral-700 space-y-2">
          <p>
            Chatforia uses SMS to verify your account and notify you about
            new messages and account activity.
          </p>
          <p className="font-medium">By continuing, you agree to receive SMS messages from Chatforia.</p>
          <ul className="list-disc list-inside text-neutral-600 space-y-1 mt-2">
            <li>Message frequency varies</li>
            <li>Message & data rates may apply</li>
            <li>Reply STOP to opt out</li>
            <li>Reply HELP for help</li>
          </ul>
        </div>

        <label className="flex items-start gap-3 cursor-pointer">
          <input
            type="checkbox"
            className="mt-1 accent-orange-500"
            checked={agreed}
            onChange={(e) => setAgreed(e.target.checked)}
          />
          <span className="text-sm text-neutral-700">
            I agree to receive SMS messages from Chatforia for verification and notifications.
          </span>
        </label>

        <div className="flex gap-3">
          <button
            className="flex-1 py-3 rounded-xl bg-neutral-200 hover:bg-neutral-300 text-neutral-800"
            onClick={onCancel}
          >
            Cancel
          </button>

          <button
            disabled={!agreed}
            onClick={onContinue}
            className={`flex-1 py-3 rounded-xl text-white font-medium transition $${
              agreed ? " bg-orange-500 hover:bg-orange-600" : " bg-orange-300 cursor-not-allowed"
            }`}
          >
            Send verification code
          </button>
        </div>

        <p className="text-xs text-neutral-500 text-center">
          You can opt out at any time by replying STOP. For assistance reply HELP.
        </p>
      </div>
    </div>
  );
}
