import { ENV } from '../config/env.js';

export async function getConnectivityOptions(req, res) {
  // Inputs you might pass from the client:
  // - req.query.country / req.query.region
  // - req.query.deviceSupportsEsim ("true"/"false") — detect on client
  // - req.user.plan ("free"/"premium") — from auth/session
  const esimEnabled = String(ENV.FEATURE_ESIM || '').toLowerCase() === 'true';
  const deviceSupportsEsim = String(req.query.deviceSupportsEsim || 'false') === 'true';

  // Default: everyone can use existing data/Wi-Fi (Twilio APIs ride on it)
  const base = {
    canUseExistingCarrier: true,
    offersEsim: esimEnabled && deviceSupportsEsim,
    offersPhysicalSim: false, // set true when you actually support logistics
    recommendation: 'existing', // could be 'existing' | 'esim' | 'dual'
  };

  // Simple example: if eSIM is enabled and device supports it, suggest it to premium users
  const plan = String(req.user?.plan || 'free').toLowerCase();
  if (base.offersEsim && plan === 'premium') {
    base.recommendation = 'dual'; // keep carrier + add Chatforia eSIM
  }

  res.json(base);
}
